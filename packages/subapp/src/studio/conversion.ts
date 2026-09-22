/** The conversion itself: one Cowork workflow in, one reviewable BUNDLE out.
 *
 * ⭐ THIS FILE RUNS IN STUDIO, NOT IN THE HOST. That is the one structural
 * fact about it, and it is new. An earlier version of this module lived at
 * `server/subapps/studio/service/pipeline.ts` — inside the EMITTED tree — and
 * imported `@spec`, `@codegen/pure` and `@conformance/gate`. Those imports are
 * `node:`-free, so the sub-app's route closure was clean and the app mounted.
 * It still did not INSTALL. The three engine packages are forty-six modules of
 * Studio's own source, authored against Studio's `moduleResolution: bundler`
 * tsconfig, and putting them in a Flightdeck checkout meant vendoring all
 * forty-six plus path aliases the host does not have. The host's own
 * `npm run typecheck` then went red on the vendored tree — stack [4/5] of its
 * compliance gate. A sub-app that imports sibling packages from the Studio
 * repo is not a sub-app the host can build.
 *
 * So the line moved to where the work is. GENERATION is this file, and it
 * stays here, where the engine already lives and already has tests. FILING is
 * `server/subapps/studio/**`, which travels to the host, because filing is the
 * half that needs a host at all: the kill switch, the install row, the consent
 * screen, the audit chain and the Inbox. What crosses between them is a JSON
 * bundle, and the host re-derives its own opinion of it rather than believing
 * anything in it.
 *
 * ⭐ THREE STAGES, ALL IN MEMORY, NONE OF THEM TOUCHING A DISK.
 *
 *   @spec        reads the workflow markdown and derives a database-free
 *                `MiniAppSpec` whose `steps` are the workflow's own steps.
 *   @codegen     turns that spec into the sub-app's source TEXT.
 *   @conformance judges that text against the contract before a byte of it
 *                goes anywhere.
 *
 * ⛔ AND NOTHING HERE WRITES. Generation produces text, the text becomes a
 * bundle, the bundle becomes ONE inbox proposal in the host, and a human
 * applies it. Contract rule 7 — propose, don't mutate — is the shape of the
 * whole product, not an obstacle it works around.
 *
 * ── THE MINI-APP FLOOR IS ENFORCED HERE, TWICE ──────────────────────────
 * A converted workflow is a MINI-APP: `manifest.ts`, `guard.ts`,
 * `routes/index.ts`, a web module — the `shell-reference` floor, with
 * `initSchema: () => {}` and no `schema.ts`, no DDL, no migration. Table
 * support is a different product and a converted workflow does not get one.
 * `@spec` already refuses to plan tables out of a workflow, and `@codegen`'s
 * `mini-app` profile already refuses a spec that declares them — so this file
 * checks BOTH the spec going in and the file set coming out. A property that
 * matters should not depend on one refusal two packages away still being
 * there.
 */
import {
  parseWorkflowMarkdown,
  planFromWorkflow,
  type ClarifyingQuestion,
  type MiniAppSpec as DerivedSpec,
  type PlanWarning,
  type SpecStep,
} from "@spec/index";
import {
  CodegenInvariantError,
  RESERVED_SUBAPP_IDS,
  SpecRejectedError,
  generateSubApp,
} from "@codegen/pure";
import { runConformanceGate } from "@conformance/gate";
import type { Finding } from "@conformance/finding";
import {
  PROPOSAL_TEMPLATES,
  proposeOperation,
  resolveProposalTemplate,
  type ProposalTemplate,
  type TemplateResolution,
} from "../../../pipeline/src/proposal-templates.js";
import { STUDIO_BUNDLE_SCHEMA, type StudioBundle } from "../server/subapps/studio/service/bundle.js";

/** The one domain a converted workflow emits. Every generated route lives in
 * `routes/workflow.ts`; a workflow conversion never needs a second file. */
const WORKFLOW_DOMAIN = "workflow";

/** The catalogue template a converted workflow's proposal step files — owner
 * ruling 2026-09-22 (8): proposing apps come ONLY from approved templates, and
 * this one is in the catalogue WITHOUT an approval until the owner gives one. */
const CONVERSION_TEMPLATE = "step";

/** `@codegen`'s `workflowStepSchema` caps `n` at 99. A document numbering past
 * that is not a procedure anybody holds in their head. */
const MAX_STEP_ORDINAL = 99;

export interface StudioConversionInput {
  /** The workflow's markdown, as POSTED. Never a path: a sub-app route has no
   * filesystem read, so Studio cannot open a skill file even if it wanted to,
   * and reading the repo from a route would be a capability escape. */
  readonly workflow: string;
  /** Answers to questions from an earlier `needs_input`, keyed by question id.
   * `| undefined` is explicit because the host compiles under
   * `exactOptionalPropertyTypes`, where a Zod-parsed optional field really is
   * `T | undefined` and "absent" and "present as undefined" are different
   * types. Accepting both is what lets a parsed body be passed straight in. */
  readonly answers?: Readonly<Record<string, string>> | undefined;
  /** Where the workflow came from, e.g. `skills/orchestrate-workflow/SKILL.md`.
   * Rendered verbatim as provenance in the generated files; never opened. */
  readonly source?: string | undefined;
}

export interface StudioGeneratedFile {
  /** Repo-relative path in the HOST, which is where a human will place it. */
  readonly path: string;
  readonly contents: string;
  readonly kind: string;
}

export interface StudioFileSummary {
  readonly path: string;
  readonly kind: string;
  readonly bytes: number;
}

export interface StudioStepSummary {
  readonly ordinal: string;
  readonly title: string;
  readonly kind: SpecStep["kind"];
  /** True when the source says a PERSON decides this step. The generated page
   * shows it and stops there; it is never a licence to advance it. */
  readonly gated: boolean;
}

/** What the review screen renders. Deliberately not the whole `MiniAppSpec`:
 * the spec carries `sourcePrompt`, which is the entire posted markdown, and
 * echoing it back inside every bundle is bytes nobody reads. */
export interface StudioSpecSummary {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly version: string;
  readonly minHostVersion: string;
  readonly navSection: string;
  readonly routePrefix: string;
  readonly webModuleId: string;
  readonly enableEnvVar: string;
  readonly purpose: string;
  readonly capabilities: readonly string[];
  readonly visibleToRoles: readonly string[];
  readonly steps: readonly StudioStepSummary[];
}

export interface StudioGateSummary {
  readonly ok: boolean;
  /** Names of the checks that RAN. A gate that quietly skipped half its rules
   * and reported "no findings" would be worse than no gate, so a partial run
   * can never be mistaken for a clean one. */
  readonly checks: readonly string[];
  readonly findings: readonly Finding[];
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
  readonly filesChecked: number;
}

/** The registry edit a human still has to make. Studio cannot make it: a
 * sub-app is code-declared, `registry.ts` is a host file, and the capability
 * adapter has no way to touch it. So the two lines travel WITH the proposal. */
export interface StudioRegistryEdit {
  readonly file: string;
  readonly importLine: string;
  readonly entryLines: readonly string[];
}

export type StudioConversion =
  /** The document does not say something the manifest requires. No manifest
   * field is ever guessed: `navSection` is an exact-match join key against five
   * host literals and no workflow carries one. */
  | {
      readonly status: "needs_input";
      readonly understanding: string;
      readonly questions: readonly ClarifyingQuestion[];
      readonly warnings: readonly PlanWarning[];
    }
  /** A step asks the mini-app to advance, approve or resolve a gated or
   * statutory step by itself. Refused outright, naming the sentence. */
  | {
      readonly status: "blocked";
      readonly understanding: string;
      readonly rule: string;
      readonly explanation: string;
      readonly evidence: string;
      readonly evidenceGrounded: boolean;
      readonly contractRule: string;
    }
  /** The markdown is not a workflow this reader can read. */
  | { readonly status: "unreadable"; readonly issues: readonly string[] }
  /** The derived spec is not generatable — including the mini-app floor
   * refusals this file makes itself. */
  | { readonly status: "rejected"; readonly issues: readonly string[] }
  /** The files were generated and the contract gate found ERROR findings.
   * Nothing is written, and the findings are the answer. */
  | {
      readonly status: "gate_blocked";
      readonly subAppId: string;
      readonly gate: StudioGateSummary;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: "ready";
      readonly understanding: string;
      readonly subAppId: string;
      readonly label: string;
      readonly spec: StudioSpecSummary;
      readonly files: readonly StudioGeneratedFile[];
      readonly fileSummaries: readonly StudioFileSummary[];
      readonly registry: StudioRegistryEdit;
      readonly gate: StudioGateSummary;
      /** Narrowings and omissions, in English. Never a refusal — those are the
       * `blocked` and `rejected` arms above. */
      readonly warnings: readonly string[];
    };

/* ══════════════════════════════════════════════════════════════════════════
 * Stage 1 -> 2: the derived spec, translated into what the generator parses
 *
 * The two packages model the same app from different ends, so this is a real
 * translation rather than a cast. `@spec` describes a workflow reading —
 * routes with a `kind`, steps with a `gated` flag. `@codegen` describes an
 * emission — domains of routes bound to a CLOSED union of operations, and a
 * workflow whose steps name the route that performs them. The closed operation
 * union is the generator's whole safety argument: a generated route cannot
 * express "read this file" because no operation kind means it.
 * ═══════════════════════════════════════════════════════════════════════ */

interface TranslationResult {
  readonly spec: Record<string, unknown>;
  /** What the emitted manifest declares — the plan's, less anything dropped. */
  readonly capabilities: readonly string[];
  readonly warnings: readonly string[];
  /** Set when nothing generatable is left; the conversion is then rejected. */
  readonly refusal: string | null;
}

/** Why the conversion's template cannot be generated from, in words. */
function templateProblem(problem: Exclude<TemplateResolution, { ok: true }>["problem"]): string {
  switch (problem) {
    case "unapproved":
      return "has no approval record — the owner has not approved it";
    case "unknown-template":
      return "is not in the catalogue";
    case "unnamed-approver":
      return "carries an approval that names no human";
    case "undated-approval":
      return "carries an approval with no real date";
    case "content-changed-since-approval":
      return "has changed since it was approved, so the approval no longer covers what it writes";
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** `"2b"` -> `2`. The document's own numbering is kept on screen; this is only
 * the sort key the generator binds actions to. */
function ordinalNumber(ordinal: string): number | null {
  const digits = ordinal.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;
  const n = Number(digits);
  return Number.isInteger(n) && n >= 1 && n <= MAX_STEP_ORDINAL ? n : null;
}

function translate(
  spec: DerivedSpec,
  workflowName: string,
  source: string | undefined,
  catalogue: readonly ProposalTemplate[],
): TranslationResult {
  const warnings: string[] = [];
  const reads = spec.capabilities.includes("read:contracts");
  const wantsProposals = spec.capabilities.includes("write:inbox-proposal");

  /* ── Owner ruling 2026-09-22 (8) ──────────────────────────────────────
   * "Proposing apps are generated ONLY from a closed catalogue of proposal
   * templates the owner approves … generation refuses unapproved ones." This
   * conversion used to write its `step` proposal (`ticket`, `step`, `note`)
   * in code, outside the catalogue. That shape is now the catalogue's `step`
   * template, resolved here like any other — and while it carries no valid
   * approval, no proposing route is emitted, and neither is the
   * `write:inbox-proposal` it would need. The fields come from the template,
   * never from this file. */
  const template = wantsProposals ? resolveProposalTemplate(CONVERSION_TEMPLATE, catalogue) : null;
  const proposes = template !== null && template.ok;
  const refusedTemplate =
    template !== null && !template.ok
      ? `owner ruling 2026-09-22 (8) generates proposing apps only from an approved template, and the catalogue's \`${CONVERSION_TEMPLATE}\` proposal template ${templateProblem(template.problem)}`
      : null;
  let droppedProposals = false;

  /* ── Routes ───────────────────────────────────────────────────────────
   * A workflow conversion produces a small, fixed route set, and every one of
   * them maps onto a capability-only operation. Nothing table-backed can be
   * reached from here: `list-rows`, `get-row` and `insert-row` are not emitted
   * for any input, which is the mini-app floor expressed as code rather than
   * as a comment. */
  const routes: Array<Record<string, unknown>> = [];
  for (const route of spec.routes) {
    if (route.kind === "propose") {
      if (!wantsProposals) {
        warnings.push(
          `dropped the ${route.method} ${route.path} route: it files a proposal, but the app does not declare write:inbox-proposal`,
        );
        continue;
      }
      if (template === null || !template.ok) {
        droppedProposals = true;
        warnings.push(`dropped the ${route.method} ${route.path} route: it would file a proposal — ${refusedTemplate ?? "no template resolved"}`);
        continue;
      }
      routes.push({
        method: "POST",
        path: route.path,
        summary: truncate(route.summary, 200),
        // FIELD NAMES only ever reach an audit event, never values (contract
        // rule 8). The generator enforces that; the event is namespaced under
        // the sub-app id because the host's audit reader groups on it.
        operation: proposeOperation(template.template, spec.id),
      });
      continue;
    }
    if (route.capabilities.includes("read:contracts")) {
      if (!reads) {
        warnings.push(
          `dropped the ${route.method} ${route.path} route: it reads contract folders, but the app does not declare read:contracts`,
        );
        continue;
      }
      routes.push({ method: "GET", path: route.path, summary: truncate(route.summary, 200), operation: { kind: "list-contracts" } });
      continue;
    }
    // Everything else a workflow reading produces is the app reading its own
    // text out loud — the `/steps` route is the whole `## Procedure`, which the
    // generated page already carries as a data literal. A route that answers
    // what the page already knows is a round trip for nothing, and buying a
    // capability to serve it would put a line on the consent screen nobody
    // asked for.
    warnings.push(
      `dropped the ${route.method} ${route.path} route: the generated page renders the procedure from its own step data, so the route would answer what the page already has`,
    );
  }
  // Least privilege (contract rule 9): with no route that files a proposal, a
  // `write:inbox-proposal` line on the consent screen would grant a write the
  // app never makes — and the proposals list below would read an inbox this
  // app can no longer write to.
  const capabilities = spec.capabilities.filter((scope) => proposes || scope !== "write:inbox-proposal");
  if (wantsProposals && !proposes) {
    warnings.push(
      `dropped write:inbox-proposal from the app's capabilities: ${refusedTemplate ?? "no template resolved"}. Its proposal steps are shown on the rail and file nothing until the owner approves that template`,
    );
  }
  if (proposes) {
    // The step rail's only honest source of state. A mini-app stores nothing,
    // so "this step has been proposed" can only be read back from the
    // proposals this app itself wrote. Gated by `write:inbox-proposal`, which
    // the app already declares — so the read costs no extra consent.
    routes.push({
      method: "GET",
      path: "/proposals",
      summary: "Proposals this app has already filed for its steps",
      operation: { kind: "list-proposals" },
    });
  }

  /* ── Steps ────────────────────────────────────────────────────────────── */
  const steps: Array<Record<string, unknown>> = [];
  const seen = new Set<number>();
  for (const step of spec.steps ?? []) {
    const n = ordinalNumber(step.ordinal);
    if (n === null) {
      warnings.push(`dropped step "${step.ordinal}": the generator numbers steps 1-${String(MAX_STEP_ORDINAL)}`);
      continue;
    }
    if (seen.has(n)) {
      warnings.push(`dropped step "${step.ordinal}": step ${String(n)} is already on the rail`);
      continue;
    }
    seen.add(n);

    const entry: Record<string, unknown> = {
      n,
      title: truncate(step.title, 120),
      // `gated` is "the source says a person decides this". Anything else is
      // "the source names no human gate" — which is what `auto` means to the
      // generator. Neither one lets the page advance anything: the rail shows
      // the step and stops, because nothing in a mini-app may resolve a gate.
      gate: step.gated ? "human" : "auto",
    };
    if (step.detail.length > 0) entry.detail = truncate(step.detail, 600);
    if (step.kind === "propose" && proposes) {
      const target = routes.find((r) => r.method === "POST");
      if (target !== undefined) {
        entry.action = { domain: WORKFLOW_DOMAIN, method: "POST", path: target.path };
      }
    } else if (step.kind === "read" && reads) {
      const target = routes.find((r) => r.method === "GET" && r.path !== "/proposals");
      if (target !== undefined) {
        entry.action = { domain: WORKFLOW_DOMAIN, method: "GET", path: target.path };
      }
    }
    steps.push(entry);
  }

  const workflow: Record<string, unknown> = {
    name: truncate(workflowName, 80),
    description: truncate(spec.purpose, 600),
    steps,
  };
  if (source !== undefined && source.length > 0) workflow.source = truncate(source, 200);

  const refusal =
    routes.length === 0 && droppedProposals
      ? `nothing is left to generate: every route this workflow needs files a proposal — ${refusedTemplate ?? "no template resolved"}`
      : null;

  return {
    warnings,
    capabilities,
    refusal,
    spec: {
      // Named, not defaulted. The generator's `mini-app` profile is what
      // refuses tables, and a spec that relied on the default to be
      // database-free would become table-backed the day the default moved.
      profile: "mini-app",
      id: spec.id,
      label: spec.label,
      version: spec.version,
      icon: spec.icon,
      navSection: spec.navSection,
      summary: truncate(spec.purpose, 300),
      capabilities: [...capabilities],
      visibleToRoles: [...spec.visibleToRoles],
      webModuleId: spec.derived.webModuleId,
      workflow,
      domains: [{ name: WORKFLOW_DOMAIN, title: truncate(spec.label, 80), routes }],
    },
  };
}

/** `capabilities` is what the emitted manifest declares, which is what the
 * review screen must show — not the plan's, when a route was dropped. */
function summarize(spec: DerivedSpec, capabilities: readonly string[]): StudioSpecSummary {
  return {
    id: spec.id,
    label: spec.label,
    icon: spec.icon,
    version: spec.version,
    minHostVersion: spec.minHostVersion,
    navSection: spec.navSection,
    routePrefix: spec.derived.routePrefix,
    webModuleId: spec.derived.webModuleId,
    enableEnvVar: spec.derived.enableEnvVar,
    purpose: spec.purpose,
    capabilities: [...capabilities],
    visibleToRoles: [...spec.visibleToRoles],
    steps: (spec.steps ?? []).map((step) => ({
      ordinal: step.ordinal,
      title: step.title,
      kind: step.kind,
      gated: step.gated,
    })),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * The conversion
 * ═══════════════════════════════════════════════════════════════════════ */

export interface StudioConversionOptions {
  /** The proposal-template catalogue. TESTS ONLY — so the approved path can be
   * exercised without the production catalogue approving anything. Every
   * production caller passes nothing and gets `PROPOSAL_TEMPLATES`. Never
   * taken from a request: it is a parameter, not a field of the input. */
  readonly catalogue?: readonly ProposalTemplate[];
}

export function convertWorkflow(input: StudioConversionInput, options: StudioConversionOptions = {}): StudioConversion {
  // Read the document once for its own name before planning, so a file that is
  // not a workflow at all is answered as such rather than as a spec problem.
  const parsed = parseWorkflowMarkdown(input.workflow);
  if (!parsed.ok) return { status: "unreadable", issues: parsed.issues };
  const workflowName = parsed.doc.frontmatter.name ?? parsed.doc.title ?? "workflow";

  const planInput: Parameters<typeof planFromWorkflow>[0] = {
    workflow: input.workflow,
    // Studio cannot enumerate the host's `SUBAPP_MANIFESTS` from a route —
    // importing the registry is a sibling-import violation and there is no
    // filesystem read either way. So the collision list is the generator's own
    // reserved set plus Studio itself, and the REAL fence is the human who
    // applies the proposal into a repo where a duplicate id would not compile.
    existingSubAppIds: [...RESERVED_SUBAPP_IDS, "studio"],
    ...(input.answers === undefined ? {} : { answers: input.answers }),
  };
  const outcome = planFromWorkflow(planInput);

  if (outcome.status === "needs_input") {
    return {
      status: "needs_input",
      understanding: outcome.understanding,
      questions: outcome.questions,
      warnings: outcome.warnings,
    };
  }
  if (outcome.status === "blocked") {
    return {
      status: "blocked",
      understanding: outcome.understanding,
      rule: outcome.rule,
      explanation: outcome.explanation,
      evidence: outcome.evidence,
      evidenceGrounded: outcome.evidenceGrounded,
      contractRule: outcome.contractRule,
    };
  }
  if (outcome.status === "invalid_draft") {
    return { status: "unreadable", issues: outcome.issues };
  }

  const derived = outcome.spec;

  // ⛔ THE MINI-APP FLOOR, ON THE WAY IN. `@spec` plans no tables out of a
  // workflow, so this is unreachable-by-design — which is exactly why it is
  // written down. The database-free property should not depend on a refusal in
  // another package still being there.
  if (derived.tables.length > 0) {
    return {
      status: "rejected",
      issues: [
        `the derived spec declares ${String(derived.tables.length)} table(s) (${derived.tables
          .map((t) => t.name)
          .join(", ")}). A converted workflow is a mini-app: database-free, no schema.ts, no DDL, no migration. Table support is not the mini-app path.`,
      ],
    };
  }
  if (derived.steps === undefined || derived.steps.length === 0) {
    return {
      status: "rejected",
      issues: [
        "the derived spec carries no steps, so there is no procedure to convert. A Cowork workflow needs a '## Procedure' section of numbered steps.",
      ],
    };
  }

  const translation = translate(derived, workflowName, input.source, options.catalogue ?? PROPOSAL_TEMPLATES);
  if (translation.refusal !== null) {
    return { status: "rejected", issues: [translation.refusal] };
  }

  let generated: ReturnType<typeof generateSubApp>;
  try {
    generated = generateSubApp(translation.spec);
  } catch (err) {
    if (err instanceof SpecRejectedError) {
      return { status: "rejected", issues: err.issues.length > 0 ? err.issues : [err.message] };
    }
    if (err instanceof CodegenInvariantError) {
      // The generator checked its OWN output against the contract and refused.
      // This is a Studio bug, not a bad workflow — so it is reported with the
      // rule ids intact rather than flattened into "could not generate".
      return {
        status: "rejected",
        issues: err.violations.map((v) => `[${v.rule}] ${v.file}: ${v.detail}`),
      };
    }
    throw err;
  }

  // ⛔ THE MINI-APP FLOOR, ON THE WAY OUT. The `mini-app` profile already
  // refuses to emit a `schema.ts`; this reads the file set that actually came
  // back rather than trusting that it did.
  const schemaFile = generated.files.find((file) => file.kind === "schema" || file.path.endsWith("/schema.ts"));
  if (schemaFile !== undefined) {
    return {
      status: "rejected",
      issues: [`the generator emitted ${schemaFile.path}; a mini-app is database-free and must ship no schema`],
    };
  }

  /**
   * ⭐ THE HOST HALF, AND THE HOST'S OWN RULE IS WHY.
   *
   * `generateSubApp` also emits the standalone harness — every sub-app runs
   * outside Flightdeck OS as well as inside it. That harness must NOT be in
   * this bundle: `admit.ts`'s ADM-020 refuses "a path outside the sub-app's
   * own directories", and the harness deliberately contains
   * `server/subapps/registry.ts` and `server/subapps/types.ts`, which are the
   * host's own files.
   *
   * ⛔ THE WRONG FIX WOULD HAVE BEEN A SECOND FILE LIST ON THE BUNDLE that
   * admission does not check. That is an unchecked region carried inside a
   * checked one — the exact shape this repo has spent the session closing.
   * ADM-020 is right, it is working, and it stays untouched.
   *
   * The harness reaches a person through the generator instead:
   * `codegen --standalone <dir>` writes it to a root of its own, and
   * `scripts/standalone-smoke.sh` proves the result runs.
   */
  const files: StudioGeneratedFile[] = generated.files
    .filter((file) => file.kind !== "standalone")
    .map((file) => ({
      path: file.path,
      contents: file.contents,
      kind: file.kind,
    }));

  const report = runConformanceGate({ files: files.map((file) => ({ path: file.path, contents: file.contents })) });
  const gate: StudioGateSummary = {
    ok: report.ok,
    checks: report.checks,
    findings: report.findings,
    errors: report.errors,
    warnings: report.warnings,
    filesChecked: report.filesChecked,
  };
  const warnings = [...translation.warnings, ...generated.warnings];

  if (!gate.ok) {
    return { status: "gate_blocked", subAppId: derived.id, gate, warnings };
  }

  return {
    status: "ready",
    understanding: outcome.understanding,
    subAppId: derived.id,
    label: derived.label,
    spec: summarize(derived, translation.capabilities),
    files,
    fileSummaries: files.map((file) => ({ path: file.path, kind: file.kind, bytes: file.contents.length })),
    registry: {
      file: generated.registryPatch.file,
      importLine: generated.registryPatch.importLine,
      entryLines: generated.registryPatch.entryLines,
    },
    gate,
    warnings,
  };
}


/* ══════════════════════════════════════════════════════════════════════════
 * The bundle
 *
 * ⭐ THE ONE ARTEFACT THAT CROSSES THE REPOSITORY LINE. Everything above runs
 * in Studio, against Studio's engine and Studio's tsconfig. Everything the
 * host does runs against `server/subapps/studio/service/bundle.ts`, which is
 * host-authored, imports nothing but `zod`, and does not know this file
 * exists. The dependency is deliberately ONE-WAY: Studio reads the host's
 * contract, the host never reads Studio's.
 *
 * So the schema is imported from the emitted tree rather than restated here.
 * A bundle this function builds that the host's own schema would reject is a
 * bug caught at Studio's typecheck instead of at somebody's 400, and
 * `__tests__/bundle-contract.test.ts` parses a real one through the real
 * schema on every run.
 *
 * ⛔ AND THE GATE BLOCK IS A CLAIM, NOT A CREDENTIAL. It travels so a
 * reviewer can see what judged the files and what that judgement said. It
 * buys the bundle nothing: the host refuses a bundle reporting a blocked
 * gate, and admits one only on its OWN checks, which it re-derives from these
 * same file contents. Studio cannot vouch for itself across a network, and
 * this bundle does not pretend to.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Named here rather than read from `package.json`: this file must not import
 * anything that opens one, and a version string in an artefact is provenance
 * for a human, not a dependency check. */
export const STUDIO_PRODUCER = "flightdeck-studio/0.1.0";

export interface BundleOptions {
  /** Where the workflow came from. Provenance, rendered verbatim, never
   * opened. */
  readonly source?: string | undefined;
  /** ISO timestamp. Injected so a bundle is byte-deterministic under test. */
  readonly at?: string | undefined;
  readonly producedBy?: string | undefined;
}

/** A `ready` conversion, rendered as the JSON a Flightdeck host will accept.
 *
 * Only `ready` — the other six arms are refusals, and a refusal has nothing to
 * file. The type makes that a compile error rather than a runtime check. */
export function bundleFrom(
  ready: Extract<StudioConversion, { status: "ready" }>,
  options: BundleOptions = {},
): StudioBundle {
  return {
    bundle: STUDIO_BUNDLE_SCHEMA,
    producedBy: options.producedBy ?? STUDIO_PRODUCER,
    producedAt: options.at ?? new Date().toISOString(),
    subAppId: ready.subAppId,
    label: ready.label,
    spec: {
      id: ready.spec.id,
      label: ready.spec.label,
      icon: ready.spec.icon,
      version: ready.spec.version,
      minHostVersion: ready.spec.minHostVersion,
      navSection: ready.spec.navSection,
      routePrefix: ready.spec.routePrefix,
      webModuleId: ready.spec.webModuleId,
      enableEnvVar: ready.spec.enableEnvVar,
      purpose: ready.spec.purpose,
      capabilities: [...ready.spec.capabilities],
      visibleToRoles: [...ready.spec.visibleToRoles],
      steps: ready.spec.steps.map((step) => ({
        ordinal: step.ordinal,
        title: step.title,
        kind: step.kind,
        gated: step.gated,
      })),
    },
    files: ready.files.map((file) => ({ path: file.path, kind: file.kind, contents: file.contents })),
    registry: {
      file: ready.registry.file,
      importLine: ready.registry.importLine,
      entryLines: [...ready.registry.entryLines],
    },
    gate: {
      ok: ready.gate.ok,
      checks: [...ready.gate.checks],
      findings: ready.gate.findings.map((finding) => ({
        rule: finding.rule,
        severity: finding.severity,
        file: finding.file,
        line: finding.line,
        column: finding.column,
        message: finding.message,
        evidence: finding.evidence,
      })),
      filesChecked: ready.gate.filesChecked,
    },
    warnings: [...ready.warnings],
    workflowSource: options.source === undefined || options.source.length === 0 ? null : options.source,
  };
}
