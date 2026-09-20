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
 *   model-request       3,4 NEVER approvable. This gate exists so Studio cannot
 *                       become a side channel around the AI gateway's 422, and
 *                       an approval flag is precisely such a side channel: it
 *                       would let a caller carry data out of the building that
 *                       the gateway itself would have rejected on arrival. The
 *                       gateway does not take an approval header; neither does
 *                       this.
 *
 *                       ⭐ AND THIS ROW NOW BARELY RUNS. `gateModelRequest`
 *                       delegates to `packages/envelope`: the question is "can
 *                       this be expressed in the allowed shape?", not "does a
 *                       scan find something?". A tier only ever ANNOTATES that
 *                       gate's refusals now. The row stays because the policy
 *                       it states is still true and still asserted.
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
import { type Approval, type ApprovalCheck, checkApproval, contentHash } from "./approval";
import { type GuardrailAuditBody, type GuardrailEventName, auditBody } from "./audit";
import { buildEnvelope } from "../../envelope/src/build";
import type { Envelope, ExpressionFailure } from "../../envelope/src/types";

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
  // ── model-request, after the envelope rewire. The three below are the whole
  // vocabulary of that gate now, and not one of them is a statement about what
  // a scan failed to find.
  expressible:
    "every value in this request was drawn from a compiled-in list or is a bounded integer — see decision.envelope.assurance for what was and was not checked",
  notExpressible:
    "refused: this request cannot be expressed in the envelope's allowed shape — see decision.failures, which name keys and codes, never values",
  textNeedsHuman:
    "expressible, but it carries a bounded text fact: pseudonymised prose over a partial class set, which a named human sends deliberately or not at all",
  redactionNotARoute:
    "refused: redaction is not a route to the wire — a request must be EXPRESSIBLE in the envelope's allowed shape, and scrubbing an arbitrary payload does not make it so",
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

/**
 * ⚠ RETAINED, AND NO LONGER A ROUTE TO THE WIRE.
 *
 * @deprecated Both dials used to be able to turn a tier 3/4 refusal into an
 * `allow` by scrubbing the payload and re-scanning it. That path is gone, and
 * the reason is the whole reason this gate was rewired: re-scanning proves
 * only that the SAME scanner that failed to see the data the first time also
 * failed to see it the second. `packages/guardrails/src/__tests__/
 * representation.test.ts` records what that cost — a payload of a named person
 * plus an Art. 9 disclosure came back ALLOW, redacted, because the one
 * scanner behind it could see neither a person in a value nor a German
 * disability term.
 *
 * Setting either dial to `"redact"` now changes exactly one thing: the
 * refusal says so (`REASONS.redactionNotARoute`), so a caller who was relying
 * on it learns why rather than wondering where their payload went. It is kept
 * on the signature deliberately — silently ignoring a security option is how
 * a caller keeps believing in it.
 */
export interface ModelRequestConfig {
  readonly onTier3?: "refuse" | "redact";
  readonly onTier4?: "refuse" | "redact";
}

export interface ModelRequestDecision extends GateDecision {
  /** Present when the request WAS expressible. This is what may be sent —
   * `envelope.wire` — and only when `envelope.disposition` is `"ready"`.
   * It carries its own `assurance`, which names what was not checked. */
  readonly envelope?: Envelope;
  /** Present on a refusal: what could not be expressed. Keys where the key is
   * a compiled-in constant, ordinals where it is not; codes from a compiled-in
   * vocabulary; never a value. */
  readonly failures?: readonly ExpressionFailure[];
  /** ⛔ NEVER SET ANY MORE. Retained so that callers and tests written against
   * the old redaction path fail LOUDLY on `undefined` rather than silently
   * sending something this gate no longer vouches for. */
  readonly redactedPayload?: unknown;
  readonly droppedClasses?: readonly string[];
}

/** Build a model-request decision. Separate from `resolve()` because this gate
 * no longer derives its decision from a tier: the tier is an ANNOTATION here,
 * and the decision comes from whether the request could be built. */
function modelRequestDecision(
  kind: GateDecisionKind,
  subject: string,
  classification: Classification,
  ctx: GateContext,
  proposal: unknown,
  reason: string,
  extra: { envelope?: Envelope; failures?: readonly ExpressionFailure[] } = {},
): ModelRequestDecision {
  const hash = contentHash(proposal);
  return {
    gate: "model-request",
    decision: kind,
    tier: classification.tier,
    findings: classification.findings,
    reason,
    contentHash: hash,
    audit: auditBody({
      event: EVENTS["model-request"][kind],
      actor: ctx.actor,
      subject,
      decision: kind === "approval-required" ? "approval-required" : kind,
      classification,
      ...(ctx.approval?.approver === undefined ? {} : { approver: ctx.approval.approver }),
      contentHash: hash,
    }),
    ...(extra.envelope === undefined ? {} : { envelope: extra.envelope }),
    ...(extra.failures === undefined ? {} : { failures: extra.failures }),
  };
}

/**
 * ⭐ REWIRED. THE QUESTION IS NO LONGER "DOES A SCAN FIND SOMETHING?".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE OLD SHAPE HAD TO GO
 * ─────────────────────────────────────────────────────────────────────────
 * This gate used to `classify()` an arbitrary payload and allow what came
 * back tier 1-2. That is a scanner asked to prove an ARBITRARY payload clean,
 * and it is unbounded by construction: the payload can be spelled an
 * unlimited number of ways and the scanner has to win every time. It did not.
 * The last red-team round put a personal record behind five nested
 * `JSON.stringify` calls and `classify()` returned tier 1 — and `classify()`
 * was the only scanner behind this gate, so tier 1 meant ALLOW, meaning SEND.
 *
 * The replacement is the host's own answer (`packages/envelope`, modelled on
 * `flightdeck/server/services/ai/envelope.ts`): the request is CONSTRUCTED
 * from compiled-in lists — a closed task set, closed vocabularies, an
 * allowlist of field NAMES, a per-key policy with ceilings — and anything not
 * expressible in that shape is refused. Five nested stringifies produce a
 * string, and a string is expressible here only as a member of a compiled-in
 * list. So the nested payload is refused for the same reason `"hello"` is
 * refused: not because something recognised it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT `classify()` DOES HERE NOW: IT IS A DETECTOR, NOT AN AUTHORITY
 * ─────────────────────────────────────────────────────────────────────────
 * It runs only on the REFUSAL path, and only to ANNOTATE: the audit body gets
 * the classes and the tier it recognised, so a human reading the refusal
 * learns "there was an IBAN in there" rather than only "not expressible".
 * Nothing it returns can turn a refusal into an allow. A tier-1 verdict from
 * it means "this detector recognised nothing", which is worth exactly that
 * much and no more.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT `tier` MEANS ON AN ALLOW
 * ─────────────────────────────────────────────────────────────────────────
 * 2, never 1. A constructed envelope is compiled-in constants and bounded
 * integers, which is Internal, and tier 1 is Public — "a decision a human
 * makes about consequences, not a property a scanner can read off a string"
 * (`packages/pseudonym/src/tier.ts`). This gate does not hand out tier 1 and
 * `GATE_POLICY` is untouched: tier 3/4 still refuse, and no approval object
 * has ever been able to open this gate. It still cannot — `checkApproval` is
 * not called here at all.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FREE-TEXT PATH ENDS IN A HUMAN, NOT IN AN ALLOW
 * ─────────────────────────────────────────────────────────────────────────
 * An envelope carrying a bounded text fact — a pasted Cowork workflow that has
 * been through `packages/pseudonym` and arrived with its coverage report — is
 * `requires-human-approval`, and this gate REFUSES it. The refusal carries the
 * envelope, so the human sees exactly what they would be sending, including
 * the pseudonymiser's `unchecked` list. "Refuse" here means "this gate will
 * not send it", not "throw it away".
 */
export function gateModelRequest(
  request: unknown,
  ctx: GateContext,
  config: ModelRequestConfig = {},
): ModelRequestDecision {
  const subject = subjectOf(request, "<model-request>");
  const names = ctx.declaredNames ?? [];
  const built = buildEnvelope(request, names.length > 0 ? { names } : {});

  if (!built.ok) {
    // THE DETECTOR, demoted: it annotates this refusal and cannot lift it.
    const options: ClassifyOptions = ctx.declaredNames ? { declaredNames: ctx.declaredNames } : {};
    const detected = classify(request, options);
    const askedToRedact = config.onTier3 === "redact" || config.onTier4 === "redact";
    return modelRequestDecision(
      "refuse",
      subject,
      detected,
      ctx,
      request,
      askedToRedact ? REASONS.redactionNotARoute : REASONS.notExpressible,
      { failures: built.failures },
    );
  }

  if (built.disposition === "requires-human-approval") {
    // The tier is the pseudonymiser's own verdict on the text it carries,
    // floored at 2 — this gate never reports tier 1.
    let tier: Tier = 2;
    for (const fact of Object.values(built.facts)) {
      if (fact.kind === "text" && fact.provenance.payloadTier > tier) {
        tier = Math.min(4, Math.max(1, Math.trunc(fact.provenance.payloadTier))) as Tier;
      }
    }
    return modelRequestDecision("refuse", subject, { tier, findings: [] }, ctx, request, REASONS.textNeedsHuman, {
      envelope: built,
    });
  }

  return modelRequestDecision("allow", subject, { tier: 2, findings: [] }, ctx, request, REASONS.expressible, {
    envelope: built,
  });
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
