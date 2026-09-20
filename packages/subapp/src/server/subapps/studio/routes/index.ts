/** Studio's routes. Three of them, and the split between them is the design.
 *
 * ── `requireStudioEnabled` IS THE FIRST STATEMENT IN EVERY HANDLER ──────
 * Not the first interesting statement — the first one. Before the body is
 * parsed, before a capability adapter is resolved, before anything is read.
 * The shell's manifest-derived RBAC rule enforces ROLES ONLY and never
 * enable-state for a sub-app's own routes, so a handler that checked later
 * would do real work with the kill switch off. `@conformance`'s `guard-first`
 * check exists because this is easy to get almost right.
 *
 * ── PREVIEW AND PROPOSE ARE SEPARATE ROUTES, NOT A FLAG ─────────────────
 * `POST /preview` runs the whole pipeline and answers. It does not call
 * `writeInboxProposal` anywhere in its body, so it cannot write — that is a
 * property of the code's shape, not of a boolean somebody remembered to check.
 * `POST /proposals` is the one handler that writes, and it writes exactly once.
 *
 * ── WHAT "WRITES" EVEN MEANS HERE ───────────────────────────────────────
 * One file, under `memory/proposals/`, through `caps.writeInboxProposal`. The
 * capability adapter is the ONLY surface these routes may use to touch
 * anything — `readContracts`, `writeInboxProposal`, `listOwnInboxProposals`,
 * `auditAppend`, `resolveSigningAuthority` — and it has no filesystem write on
 * it. So Studio cannot install the sub-app it just generated, and the answer
 * says so in as many words. A human applies the proposal. Contract rule 7.
 *
 * ── THE WORKFLOW ARRIVES IN THE BODY ────────────────────────────────────
 * Never off disk. No capability grants a filesystem read, and reading the repo
 * from a route would be a capability escape (contract rule 3). `node:fs` is not
 * imported here, in the pipeline, or anywhere in this file's static import
 * closure — which `__tests__/import-closure.test.ts` walks rather than asserts.
 *
 * ── WHAT EACH ANSWER MEANS ──────────────────────────────────────────────
 *   400 `{ error:"invalid body", issues }`              the Zod issue text
 *   403 `{ error, code:"subapp_disabled" }`             kill switch / install row
 *   403 `{ error, code:"capability_denied", scope }`    an ungranted scope
 *   403 `{ error }` with no code                        RBAC, from the shell
 *   422 `{ status:"blocked" | "unreadable" | "rejected" | "gate_blocked", … }`
 *                                                       understood, not convertible
 *   200 `{ status:"needs_input", questions, … }`        the document does not say
 *   200 `{ status:"ready", spec, gate, files, … }`      preview only; nothing written
 *   200 `{ status:"proposed", proposalPath, … }`        one proposal filed
 *   200 `{ status:"already_proposed", proposalPath }`   nothing written
 */
import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import { CapabilityDeniedError } from "../../capabilities.js";
import type { RegisterRoutesCtx } from "../../types.js";
import type { WorkspaceRuntime } from "../../../workspace/types.js";
import { STUDIO_SUBAPP_ID, StudioDisabledError, requireStudioEnabled } from "../guard.js";
import {
  buildProposalBody,
  convertWorkflow,
  findFiledProposal,
  proposalFileNameFor,
  type StudioConversion,
} from "../service/pipeline.js";

/** A skill file. Bounded because an unbounded body is a trust boundary with no
 * fence — the biggest workflow in this repo is under 6 KB, and the ceiling is
 * generous rather than tight so a long procedure is never the thing that
 * fails. */
const MAX_WORKFLOW_BYTES = 256_000;

/** Answers to an earlier `needs_input`, keyed by question id. The ids come
 * from `@spec`'s own question set (`icon`, `navSection`, `visibleToRoles`,
 * `consent:<capability>`, …), so the key charset is pinned to that shape
 * rather than left open. */
const answerKey = z.string().regex(/^[a-z][A-Za-z0-9_.:-]{0,63}$/, "answer key must be a question id");

/** `.strict()` is load-bearing on both of these. An unknown key here would be a
 * silent widening: a caller that posted `tables: [...]` or `profile:
 * "table-backed"` and got a 200 back would reasonably believe Studio had read
 * it. It did not, and a strict schema says so instead of ignoring it. */
const conversionBody = z
  .object({
    /** The workflow's markdown, posted. Never a path. */
    workflow: z.string().min(1, "workflow must not be empty").max(MAX_WORKFLOW_BYTES),
    answers: z.record(answerKey, z.string().max(500)).optional(),
    /** Provenance only — rendered verbatim into the generated files' headers
     * and never opened, which is why the charset is pinned to something that
     * cannot be mistaken for anything else when it lands in a comment. */
    source: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "source must be a plain path-like label")
      .optional(),
  })
  .strict();

export type StudioConversionBody = z.infer<typeof conversionBody>;

/** Every refusal that crosses a handler boundary, mapped once. Anything not
 * named here is a bug and is rethrown, because answering 500 for a condition
 * nobody modelled is more honest than answering 403 for all of them. */
function mapError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof StudioDisabledError) {
    return reply.code(403).send({ error: err.message, code: "subapp_disabled" });
  }
  if (err instanceof CapabilityDeniedError) {
    return reply.code(403).send({ error: err.message, code: "capability_denied", scope: err.scope ?? null });
  }
  throw err;
}

/** The arms that mean "understood, and not convertible". 422 rather than 400:
 * the request was well-formed, the workflow was read, and the refusal is about
 * what the document asks for. */
function isRefusal(conversion: StudioConversion): boolean {
  return (
    conversion.status === "blocked" ||
    conversion.status === "unreadable" ||
    conversion.status === "rejected" ||
    conversion.status === "gate_blocked"
  );
}

export function registerStudioRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void {
  /* ── GET /proposals ───────────────────────────────────────────────────
   * What Studio has already filed. Gated by `write:inbox-proposal`, the same
   * scope the write needs, and scoped by the adapter to this sub-app's own
   * `studio-` prefix — Studio cannot see another app's proposals through it. */
  app.get("/api/apps/studio/proposals", async (req, reply) => {
    let rt: WorkspaceRuntime;
    try {
      rt = await requireStudioEnabled(req);
    } catch (err) {
      return mapError(err, reply);
    }
    const caps = await ctx.capabilitiesFor(rt.id);
    try {
      return { proposals: caps.listOwnInboxProposals() };
    } catch (err) {
      return mapError(err, reply);
    }
  });

  /* ── POST /preview ────────────────────────────────────────────────────
   * The whole pipeline, and no write. `caps` is never resolved in this
   * handler, so there is no adapter in scope to write THROUGH — the
   * read-only-ness is structural. */
  app.post("/api/apps/studio/preview", async (req, reply) => {
    try {
      await requireStudioEnabled(req);
    } catch (err) {
      return mapError(err, reply);
    }
    const parsed = conversionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", issues: parsed.error.issues });

    const conversion = convertWorkflow(parsed.data);
    if (isRefusal(conversion)) return reply.code(422).send(conversion);
    if (conversion.status !== "ready") return conversion;
    // The file BODIES are dropped rather than echoed. A preview answers "what
    // would be proposed, and does it pass?"; `fileSummaries` carries the paths
    // and sizes, and the text itself rides in the proposal, where the person
    // applying it reads it.
    const { files: _files, ...preview } = conversion;
    return {
      ...preview,
      installs: false,
      note: "Nothing has been written. Filing the proposal writes one file under memory/proposals/; a human applies it.",
    };
  });

  /* ── POST /proposals ──────────────────────────────────────────────────
   * The one handler that writes, and it writes once. */
  app.post("/api/apps/studio/proposals", async (req, reply) => {
    let rt: WorkspaceRuntime;
    try {
      rt = await requireStudioEnabled(req);
    } catch (err) {
      return mapError(err, reply);
    }
    const parsed = conversionBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body", issues: parsed.error.issues });

    // Convert BEFORE resolving the adapter and before touching the proposals
    // directory: a workflow the gate blocks must not cause a read either, and
    // ordering it this way makes "a blocked gate wrote nothing" a property of
    // the control flow rather than of a branch somebody has to keep correct.
    const conversion = convertWorkflow(parsed.data);
    if (isRefusal(conversion)) return reply.code(422).send(conversion);
    if (conversion.status !== "ready") return conversion;

    const caps = await ctx.capabilitiesFor(rt.id);
    try {
      // Idempotency, read back from the only durable state a database-free
      // sub-app has: the filenames it wrote itself.
      const already = findFiledProposal(caps.listOwnInboxProposals(), conversion.subAppId);
      if (already !== null) {
        return {
          status: "already_proposed",
          subAppId: conversion.subAppId,
          proposalPath: `memory/proposals/${already}`,
          installs: false,
          note: `An open proposal for "${conversion.subAppId}" is already on file. Nothing was written. Resolve or withdraw it in the Inbox before proposing this workflow again.`,
        };
      }

      // WHO asked — resolved server-side from the session principal, never
      // from the body. Null only with auth off, when no person exists; never a
      // literal stand-in.
      const proposedBy = req.principal
        ? { username: req.principal.username, displayName: req.principal.displayName }
        : null;

      const proposalPath = caps.writeInboxProposal(
        proposalFileNameFor(conversion.subAppId, Date.now()),
        buildProposalBody(conversion, proposedBy, parsed.data.source, new Date().toISOString()),
      );

      // Never construct an audit hash — only the adapter does that. And name
      // FIELDS, not values: the workflow's text, the generated source and the
      // person's display name stay out of the event (contract rule 8). What is
      // recorded is what a reviewer needs to find the proposal and know what
      // judged it.
      caps.auditAppend({
        event: "studio.mini-app-proposed",
        actor: STUDIO_SUBAPP_ID,
        proposalPath,
        subAppId: conversion.subAppId,
        fileCount: conversion.files.length,
        gateChecks: conversion.gate.checks.length,
        gateWarnings: conversion.gate.warnings.length,
        conversionWarnings: conversion.warnings.length,
        proposedBy: proposedBy?.username ?? null,
      });

      return {
        status: "proposed",
        subAppId: conversion.subAppId,
        label: conversion.label,
        proposalPath,
        proposedBy,
        spec: conversion.spec,
        fileSummaries: conversion.fileSummaries,
        registry: conversion.registry,
        gate: conversion.gate,
        warnings: conversion.warnings,
        installs: false,
        note: "Filing this proposal installed nothing. The generated files are text inside memory/proposals/ until a human writes them into the host repo and makes the registry.ts edit.",
      };
    } catch (err) {
      return mapError(err, reply);
    }
  });
}
