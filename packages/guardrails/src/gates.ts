/**
 * THE FOUR GATES.
 *
 * Every one of them is a PURE FUNCTION from a proposal to a decision. None
 * registers anything, none calls a provider, none writes a file, none appends
 * to the audit chain. That is boot.json guardrail 5 taken literally — "all
 * actions touching guardrails are proposed, never auto-applied, and audited" —
 * and it is also what makes every rule below directly testable without a
 * running system, the same property `packages/spec/src/gates.ts` gives the
 * planner side.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE POLICY TABLE IS IN ONE PLACE AND IS VISIBLE
 * ─────────────────────────────────────────────────────────────────────────
 * `GATE_POLICY` below is the whole answer to "what happens at tier 3 and tier
 * 4". It is a table rather than four scattered `if`s because changing it is a
 * GOVERNANCE decision — the host uses exactly that phrasing for its own
 * limits ("raising this is a governance change, not a tuning knob") — and a
 * governance decision that is spread across four functions cannot be reviewed
 * in one sitting.
 *
 * The four rows are not uniform, and the differences are the argument:
 *
 *   registration        3,4 approvable. A mini-app that handles confidential
 *                       data is a legitimate thing to want; what it needs is a
 *                       named human bound to THIS version of the spec.
 *
 *   model-request       3,4 NEVER approvable. Refuse, or redact per config.
 *                       This gate exists so Studio cannot become a side
 *                       channel around the AI gateway's 422, and an approval
 *                       flag is precisely such a side channel: it would let a
 *                       caller carry data out of the building that the gateway
 *                       itself would have rejected on arrival. The gateway
 *                       does not take an approval header; neither does this.
 *
 *   workflow-intake     3 approvable, 4 never. A recording-derived workflow
 *                       that mentions a start date is a judgement call a human
 *                       can make. A document carrying an Art. 9 category or a
 *                       salary is not: whatever is generated from it will
 *                       reproduce that content in examples and fixtures, and
 *                       "approved" does not un-reproduce it. Clean the source.
 *
 *   generated-artifacts 3,4 NEVER approvable, and this is the strictest row on
 *                       purpose. These files are written by Studio, from a
 *                       source Studio already gated. PII here is a BUG in
 *                       generation, and the remedy for a bug is to fix it, not
 *                       to sign it off. An approval path here would quietly
 *                       become the normal path.
 */

import { classify, type ClassifyOptions } from "./classify";
import { classifyProseAndCode } from "./markdown";
import { type Classification, type Finding, type Tier, dedupe, sanitizePath, tierOf } from "./findings";
import { redactTree } from "./scrub";
import { type Approval, type ApprovalCheck, checkApproval, contentHash } from "./approval";
import { type GuardrailAuditBody, type GuardrailEventName, auditBody } from "./audit";

export type GateName = "registration" | "model-request" | "workflow-intake" | "generated-artifacts";
export type GateDecisionKind = "allow" | "refuse" | "approval-required";

/** Per-tier disposition. `approvable` means a valid named-human approval bound
 * to the content hash turns `approval-required` into `allow`. */
export interface TierPolicy {
  readonly tier3: "allow" | "approvable" | "refuse";
  readonly tier4: "allow" | "approvable" | "refuse";
}

export const GATE_POLICY: Readonly<Record<GateName, TierPolicy>> = {
  registration: { tier3: "approvable", tier4: "approvable" },
  "model-request": { tier3: "refuse", tier4: "refuse" },
  "workflow-intake": { tier3: "approvable", tier4: "refuse" },
  "generated-artifacts": { tier3: "refuse", tier4: "refuse" },
};

export interface GateDecision {
  readonly gate: GateName;
  readonly decision: GateDecisionKind;
  readonly tier: Tier;
  readonly findings: readonly Finding[];
  /** A constant phrase. Never interpolates scanned data — a reason string ends
   * up in logs and error bodies exactly like a finding does. */
  readonly reason: string;
  /** The body to append through the capability adapter. Carries no hash: see
   * `./audit.ts`. */
  readonly audit: GuardrailAuditBody;
  /** The hash a human would be approving. Present on every decision so a
   * refusal can be turned into an approval request without recomputing it. */
  readonly contentHash: string;
  readonly approval?: ApprovalCheck;
}

export interface GateContext {
  /** Named human or service acting. Goes into the audit body as `actor`. */
  readonly actor: string;
  readonly approval?: Approval;
  readonly declaredNames?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Shared resolution
// ─────────────────────────────────────────────────────────────────────────

const EVENTS: Record<GateName, Record<GateDecisionKind, GuardrailEventName>> = {
  registration: {
    allow: "guardrails.registration-allowed",
    refuse: "guardrails.registration-refused",
    "approval-required": "guardrails.registration-approval-required",
  },
  "model-request": {
    allow: "guardrails.model-request-allowed",
    refuse: "guardrails.model-request-refused",
    "approval-required": "guardrails.model-request-refused",
  },
  "workflow-intake": {
    allow: "guardrails.workflow-intake-allowed",
    refuse: "guardrails.workflow-intake-refused",
    "approval-required": "guardrails.workflow-intake-refused",
  },
  "generated-artifacts": {
    allow: "guardrails.generated-artifacts-allowed",
    refuse: "guardrails.generated-artifacts-refused",
    "approval-required": "guardrails.generated-artifacts-refused",
  },
};

const REASONS = {
  clean: "tier 1-2: no confidential or restricted classes found",
  approved: "tier 3-4 present, and a named human approved this exact content hash",
  needsApproval: "tier 3-4 present: an explicit named-human approval bound to this content hash is required",
  refusedByPolicy: "tier 3-4 present and this gate admits no approval path",
  refusedTier4Intake: "tier 4 present: restricted data cannot be approved into generated examples — clean the source",
  redacted: "tier 3-4 present: payload redacted with the host recipe and re-scanned clean",
  redactionInsufficient: "tier 3-4 present and survived redaction: refused rather than sent partially scrubbed",
} as const;

function resolve(
  gate: GateName,
  subject: string,
  classification: Classification,
  ctx: GateContext,
  proposal: unknown,
): GateDecision {
  const hash = contentHash(proposal);
  const policy = GATE_POLICY[gate];
  const disposition = classification.tier === 4 ? policy.tier4 : classification.tier === 3 ? policy.tier3 : "allow";

  const build = (
    decision: GateDecisionKind,
    reason: string,
    approval?: ApprovalCheck,
  ): GateDecision => ({
    gate,
    decision,
    tier: classification.tier,
    findings: classification.findings,
    reason,
    contentHash: hash,
    audit: auditBody({
      event: EVENTS[gate][decision],
      actor: ctx.actor,
      subject,
      decision: decision === "approval-required" ? "approval-required" : decision,
      classification,
      ...(ctx.approval?.approver === undefined ? {} : { approver: ctx.approval.approver }),
      contentHash: hash,
      ...(approval?.problem === undefined ? {} : { approvalProblem: approval.problem }),
    }),
    ...(approval === undefined ? {} : { approval }),
  });

  if (classification.tier <= 2) return build("allow", REASONS.clean);
  if (disposition === "allow") return build("allow", REASONS.clean);
  if (disposition === "refuse") {
    const reason =
      gate === "workflow-intake" && classification.tier === 4
        ? REASONS.refusedTier4Intake
        : REASONS.refusedByPolicy;
    return build("refuse", reason);
  }

  const check = checkApproval(proposal, gate as Approval["scope"], ctx.approval);
  if (check.ok) return build("allow", REASONS.approved, check);
  return build("approval-required", REASONS.needsApproval, check);
}

/** A subject identifier for the audit body, taken from the proposal's own `id`
 * when it has one. Run through the same sanitiser as any path segment: an `id`
 * is caller-supplied, and this value goes into an append-only chain. */
function subjectOf(value: unknown, fallback: string): string {
  if (value !== null && typeof value === "object") {
    const id = (value as Record<string, unknown>)["id"];
    if (typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) return id;
  }
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 1 — registration
// ─────────────────────────────────────────────────────────────────────────

/**
 * A mini-app declaring cat 3/4 data cannot be registered or enabled without a
 * named-human approval bound to this spec's content hash.
 *
 * ⚠ The WHOLE spec is classified, not a `spec.dataFields` sub-object. That is
 * the SEC-V5-02 lesson applied at the gate: a scope that looks at one declared
 * location is exactly the guard that missed `archive/snapshots-2026-06-24/`
 * while watching `contracts/`. A column named `employee_salary` reaches the
 * same place whether it is declared under `tables`, quoted in a widget filter,
 * named in a route, or sitting in a seed fixture — so every one of those is
 * walked.
 *
 * `spec` is typed `unknown` deliberately: importing `MiniAppSpec` from
 * `@spec` would couple this gate to one shape of proposal, and a gate that
 * only understands the shape it was told about is a gate with a blind spot.
 */
export function gateRegistration(spec: unknown, ctx: GateContext): GateDecision {
  // `schema` mode: a spec DECLARES field names as values (`{ name: "salaryEur" }`).
  // See `ClassifyMode` for what reading it as a record instead does to every
  // registration in the system.
  const options: ClassifyOptions = ctx.declaredNames
    ? { declaredNames: ctx.declaredNames, mode: "schema" }
    : { mode: "schema" };
  return resolve("registration", subjectOf(spec, "<unidentified-spec>"), classify(spec, options), ctx, spec);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 2 — outbound model request
// ─────────────────────────────────────────────────────────────────────────

export interface ModelRequestConfig {
  /** What to do with a tier-3 hit. Default `refuse` — fail-closed, the same
   * direction `.pii-boundary` fails when the switch file is missing. */
  readonly onTier3?: "refuse" | "redact";
  readonly onTier4?: "refuse" | "redact";
}

export interface ModelRequestDecision extends GateDecision {
  /** Present only when the decision is `allow` under `redact`. This is what
   * the caller may send — and it is what was RE-SCANNED, not what redaction
   * was assumed to have produced. */
  readonly redactedPayload?: unknown;
  readonly droppedClasses?: readonly string[];
}

/**
 * Runs on every outbound provider call.
 *
 * Two properties worth stating because they are easy to lose:
 *
 * 1. NO APPROVAL PATH. See the header. The gateway answers 422 on residual
 *    personal-data classes and names classes only; if an approval flag could
 *    get a payload past this gate, Studio would be the documented way around
 *    that 422.
 *
 * 2. REDACTION IS VERIFIED, NOT ASSUMED. After `redactTree` the result is
 *    classified again from scratch, and a residual tier 3/4 refuses. This
 *    mirrors `serializeAiRequest`, which calls `assertNoResidualPii` on the
 *    finished JSON even though every text fact already went through
 *    `redact()` — because `as Redacted` is a lie a caller can write, and
 *    "I scrubbed it" is a lie a function can tell itself.
 */
export function gateModelRequest(
  request: unknown,
  ctx: GateContext,
  config: ModelRequestConfig = {},
): ModelRequestDecision {
  const options: ClassifyOptions = ctx.declaredNames ? { declaredNames: ctx.declaredNames } : {};
  const first = classify(request, options);
  const subject = subjectOf(request, "<model-request>");

  if (first.tier <= 2) return resolve("model-request", subject, first, ctx, request);

  const mode = first.tier === 4 ? (config.onTier4 ?? "refuse") : (config.onTier3 ?? "refuse");
  if (mode === "refuse") return resolve("model-request", subject, first, ctx, request);

  const names = ctx.declaredNames ?? [];
  // Drop at the LOWEST tier this config is redacting rather than refusing.
  // A config that redacts tier 3 but only drops tier-4 names would leave
  // `person.surname` standing, fail its own re-scan every time, and turn
  // "redact" into a slower "refuse".
  const dropTier: 3 | 4 = (config.onTier3 ?? "refuse") === "redact" ? 3 : 4;
  const { value, droppedClasses } = redactTree(
    request,
    names.length > 0 ? { names, dropTier } : { dropTier },
  );
  const after = classify(value, options);

  if (after.tier >= 3) {
    // Residual classes survived. Refuse — do NOT send a partially scrubbed
    // payload. The findings reported are the RESIDUAL ones, because those are
    // what a human has to fix.
    const decision = resolve("model-request", subject, after, ctx, request);
    return { ...decision, decision: "refuse", reason: REASONS.redactionInsufficient };
  }

  const merged: Classification = { tier: first.tier, findings: dedupe([...first.findings]) };
  const base = resolve("model-request", subject, { tier: 1, findings: [] }, ctx, request);
  return {
    ...base,
    decision: "allow",
    reason: REASONS.redacted,
    tier: merged.tier,
    findings: merged.findings,
    audit: auditBody({
      event: "guardrails.model-request-redacted",
      actor: ctx.actor,
      subject,
      decision: "redact",
      classification: merged,
      contentHash: base.contentHash,
    }),
    redactedPayload: value,
    droppedClasses,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 3 — workflow intake
// ─────────────────────────────────────────────────────────────────────────

export interface WorkflowIntakeOptions {
  /** An id for the audit body. The DOCUMENT is never used as a subject — a
   * pasted workflow can begin with a person's name. */
  readonly intakeId?: string;
}

/**
 * A pasted Cowork workflow is scanned BEFORE anything is generated from it.
 *
 * The order is the whole point. Once a mini-app has been generated, the
 * source document's content is in its examples, its fixtures, its seed rows
 * and its tests, and every one of those is a second path to the same person
 * data — the SEC-V5-02 shape again. Refusing at intake is the only place one
 * decision closes all of them.
 */
export function gateWorkflowIntake(
  markdown: string,
  ctx: GateContext,
  options: WorkflowIntakeOptions = {},
): GateDecision {
  // Read BOTH ways — see `classifyProseAndCode`. A pasted workflow is prose,
  // and a pasted workflow with a fenced `ts` block in it is also code; which
  // one the author pasted is not a security property.
  const findings = classifyProseAndCode(markdown, "<intake>");
  const classification: Classification = { tier: tierOf(findings), findings };
  // The proposal hashed for approval is the document itself: approving one
  // paste must not bless an edited re-paste.
  return resolve("workflow-intake", options.intakeId ?? "<intake>", classification, ctx, markdown);
}

// ─────────────────────────────────────────────────────────────────────────
// Gate 4 — generated artifacts
// ─────────────────────────────────────────────────────────────────────────

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Emitted code, tests AND FIXTURES carry no PII and no cat 3/4 literals.
 *
 * Fixtures are named explicitly because they are the classic leak: the
 * generator writes a plausible example, and the most plausible example
 * available to it is the one in the source workflow — a real name, a real
 * salary. A fixture is also the file least likely to be read in review and
 * most likely to be committed, so it is the worst possible carrier.
 *
 * There is NO exemption for `.test.ts`, `__tests__/`, `fixtures/` or
 * `.example.json`. An exemption is how the leak gets a home.
 *
 * Both halves of each file are classified: the CONTENT as prose (a literal in
 * generated code is prose to a scanner) and the PATH as a field name, because
 * `fixtures/employee-salaries.json` discloses before it is even opened.
 */
export function gateGeneratedArtifacts(
  files: readonly GeneratedFile[],
  ctx: GateContext,
): GateDecision {
  const names = ctx.declaredNames ?? [];
  const all: Finding[] = [];
  for (const file of files) {
    // ⚠ The path is reported SANITISED and matched RAW. A generated file can
    // be named after what it holds, so the raw path is what the denylists must
    // see and the sanitised one is what a finding may say. Passing the raw
    // path into `where` here was a real leak, caught by
    // `__tests__/no-value-leak.test.ts` rather than by review.
    const safe = sanitizePath(file.path, names);
    // The path, judged as a field name — `nameHits` via classify's rootPath.
    all.push(...classify(null, { rootPath: file.path, declaredNames: names }).findings);
    // The content, judged as CODE — emitted TypeScript does not quote its
    // object keys, and a prose scanner reads straight past `{ salaryEur: 1 }`.
    // A generated `.md` gets the prose pass as well: the union is the point,
    // since guessing a file's genre from its extension is one more anchor.
    all.push(...classifyProseAndCode(file.content, safe));
  }
  const findings = dedupe(all);
  const classification: Classification = { tier: tierOf(findings), findings };
  return resolve("generated-artifacts", `<${files.length} files>`, classification, ctx, files);
}
