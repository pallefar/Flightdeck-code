/** Studio's routes. Three of them, and the split between them is the design.
 *
 * ── `requireStudioEnabled` IS THE FIRST STATEMENT IN EVERY HANDLER ──────
 * Not the first interesting statement — the first one. Before the body is
 * parsed, before a capability adapter is resolved, before anything is read.
 * The shell's manifest-derived RBAC rule enforces ROLES ONLY and never
 * enable-state for a sub-app's own routes, so a handler that checked later
 * would do real work with the kill switch off.
 *
 * ── WHAT ARRIVES HERE IS A BUNDLE, NOT A WORKFLOW ───────────────────────
 * Studio's engine — the `@spec` reader, the `@codegen` emitters, the
 * `@conformance` gate — is forty-six modules and about twelve thousand lines,
 * authored against Studio's own tsconfig. Mounting it here would mean copying
 * all of it into this repository and making it compile under these settings,
 * which is a fork of Studio living in the host, not a sub-app. So generation
 * stays in Studio, where the engine and its tests already are, and this
 * sub-app does the half that actually needs a host: consent, audit, the kill
 * switch and the Inbox. `service/bundle.ts` is the artefact that crosses.
 *
 * ⛔ AND THE BUNDLE IS NOT BELIEVED. Its `gate` block reports a run this
 * process did not witness, sent by whoever could reach this route.
 * `service/admit.ts` re-derives what matters from the files themselves — where
 * they would land, whether the manifest would boot, what the code can reach,
 * whether the handlers guard first — and THAT is what decides. A bundle whose
 * admission fails is refused however clean its own report is.
 *
 * ── ADMIT AND PROPOSE ARE SEPARATE ROUTES, NOT A FLAG ───────────────────
 * `POST /admit` runs the whole admission and answers. It does not call
 * `ctx.capabilitiesFor` anywhere in its body, so there is no adapter in scope
 * to write THROUGH — the read-only-ness is a property of the code's shape, not
 * of a boolean somebody remembered to check. `POST /proposals` is the one
 * handler that writes, and it writes exactly once.
 *
 * ── WHAT "WRITES" EVEN MEANS HERE ───────────────────────────────────────
 * One file, under `memory/proposals/`, through `caps.writeInboxProposal`. The
 * capability adapter is the ONLY surface these routes may use — `readContracts`,
 * `writeInboxProposal`, `listOwnInboxProposals`, `auditAppend`,
 * `resolveSigningAuthority` — and it has no filesystem write on it. So Studio
 * cannot install the sub-app in the bundle, and the answer says so in as many
 * words. A human applies the proposal. Contract rule 7.
 *
 * ── WHAT EACH ANSWER MEANS ──────────────────────────────────────────────
 *   400 `{ error:"invalid bundle", issues }`            the Zod issue text
 *   403 `{ error, code:"subapp_disabled" }`             kill switch / install row
 *   403 `{ error, code:"capability_denied", scope }`    an ungranted scope
 *   403 `{ error }` with no code                        RBAC, from the shell
 *   422 `{ status:"not_admissible", admission, … }`     well-formed, refused
 *   200 `{ status:"admissible", admission, … }`         dry run; nothing written
 *   200 `{ status:"proposed", proposalPath, … }`        one proposal filed
 *   200 `{ status:"already_proposed", proposalPath }`   nothing written
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { CapabilityDeniedError } from "../../capabilities.js";
import type { RegisterRoutesCtx } from "../../types.js";
import type { WorkspaceRuntime } from "../../../workspace/types.js";
import { STUDIO_SUBAPP_ID, StudioDisabledError, requireStudioEnabled } from "../guard.js";
import { studioBundleSchema, type StudioBundle } from "../service/bundle.js";
import { admitBundle, type AdmissionReport } from "../service/admit.js";
import {
  buildProposalBody,
  findFiledProposal,
  proposalFileNameFor,
  summarizeFiles,
} from "../service/proposal.js";

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

/** What both writing routes answer with about a bundle they accepted or
 * refused. Built once so the dry run and the real thing cannot drift into
 * describing the same bundle differently. */
function describe(bundle: StudioBundle, admission: AdmissionReport): Record<string, unknown> {
  return {
    subAppId: bundle.subAppId,
    label: bundle.label,
    spec: bundle.spec,
    fileSummaries: summarizeFiles(bundle),
    registry: bundle.registry,
    admission,
    gate: {
      reportedBy: bundle.producedBy,
      reportedAt: bundle.producedAt,
      ok: bundle.gate.ok,
      checks: bundle.gate.checks,
      findings: bundle.gate.findings,
    },
    warnings: bundle.warnings,
  };
}

export function registerStudioRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void {
  /* ── GET /proposals ───────────────────────────────────────────────────
   * What Studio has already filed. Gated by `write:inbox-proposal`, the same
   * scope the write needs, and scoped by the adapter to this sub-app's own
   * prefix — Studio cannot see another app's proposals through it. */
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

  /* ── POST /admit ──────────────────────────────────────────────────────
   * The whole admission, and no write. `caps` is never resolved in this
   * handler, so there is nothing in scope to write through. */
  app.post("/api/apps/studio/admit", async (req, reply) => {
    try {
      await requireStudioEnabled(req);
    } catch (err) {
      return mapError(err, reply);
    }
    const parsed = studioBundleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid bundle", issues: parsed.error.issues });

    const admission = admitBundle(parsed.data);
    const answer = {
      ...describe(parsed.data, admission),
      installs: false,
      note: "Nothing has been written. Filing the proposal writes one file under memory/proposals/; a human applies it.",
    };
    if (!admission.ok) return reply.code(422).send({ status: "not_admissible", ...answer });
    return { status: "admissible", ...answer };
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
    const parsed = studioBundleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid bundle", issues: parsed.error.issues });

    // Admit BEFORE resolving the adapter and before touching the proposals
    // directory: a bundle the host refuses must not cause a read either, and
    // ordering it this way makes "a refused bundle wrote nothing" a property
    // of the control flow rather than of a branch somebody has to keep
    // correct.
    const bundle = parsed.data;
    const admission = admitBundle(bundle);
    if (!admission.ok) {
      return reply.code(422).send({
        status: "not_admissible",
        ...describe(bundle, admission),
        installs: false,
        note: "Nothing was written. The bundle is well-formed, and this host refused it for the reasons in `admission.findings`.",
      });
    }

    const caps = await ctx.capabilitiesFor(rt.id);
    try {
      // Idempotency, read back from the only durable state a database-free
      // sub-app has: the filenames it wrote itself.
      const already = findFiledProposal(caps.listOwnInboxProposals(), bundle.subAppId);
      if (already !== null) {
        return {
          status: "already_proposed",
          subAppId: bundle.subAppId,
          proposalPath: `memory/proposals/${already}`,
          installs: false,
          note: `An open proposal for "${bundle.subAppId}" is already on file. Nothing was written. Resolve or withdraw it in the Inbox before proposing this bundle again.`,
        };
      }

      // WHO asked — resolved server-side from the session principal, never
      // from the body. Null only with auth off, when no person exists; never a
      // literal stand-in.
      const proposedBy = req.principal
        ? { username: req.principal.username, displayName: req.principal.displayName }
        : null;

      const proposalPath = caps.writeInboxProposal(
        proposalFileNameFor(bundle.subAppId, Date.now()),
        buildProposalBody(bundle, admission, proposedBy, new Date().toISOString()),
      );

      // Never construct an audit hash — only the adapter does that. And name
      // FIELDS, not values: the generated source, the bundle's own text and
      // the person's display name stay out of the event (contract rule 8).
      // What is recorded is what a reviewer needs to find the proposal and
      // know what judged it.
      caps.auditAppend({
        event: "studio.mini-app-proposed",
        actor: STUDIO_SUBAPP_ID,
        proposalPath,
        subAppId: bundle.subAppId,
        fileCount: bundle.files.length,
        admissionChecks: admission.checks.length,
        admissionWarnings: admission.warnings.length,
        reportedGateChecks: bundle.gate.checks.length,
        bundleWarnings: bundle.warnings.length,
        proposedBy: proposedBy?.username ?? null,
      });

      return {
        status: "proposed",
        proposalPath,
        proposedBy,
        ...describe(bundle, admission),
        installs: false,
        note: "Filing this proposal installed nothing. The generated files are text inside memory/proposals/ until a human writes them into the host repo and makes the registry.ts edit.",
      };
    } catch (err) {
      return mapError(err, reply);
    }
  });
}
