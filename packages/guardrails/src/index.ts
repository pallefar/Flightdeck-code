/**
 * `@guardrails` — Flightdeck Studio's data-classification and privacy layer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS PACKAGE IS
 * ─────────────────────────────────────────────────────────────────────────
 * It is a CONNECTION to the OS's existing guardrails, not a second opinion
 * about them. Every list it judges with is transcribed from
 * `pallefar/project-contract` and held to that source by
 * `__tests__/divergence.test.ts`; every tier is derived from the host's own
 * vocabulary; every refusal is reported in the host's own shape — classes and
 * locations, never values.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW OTHER PACKAGES USE IT
 * ─────────────────────────────────────────────────────────────────────────
 * Four pure functions. None of them performs the action it judges, so a
 * caller can always see the decision before acting on it — boot.json
 * guardrail 5, "proposed, never auto-applied, and audited".
 *
 *   registry / subapp   gateRegistration(spec, { actor, approval })
 *   providers           gateModelRequest(request, { actor }, { onTier3, onTier4 })
 *   spec / intake       gateWorkflowIntake(markdown, { actor }, { intakeId })
 *   codegen / harness   gateGeneratedArtifacts(files, { actor })
 *
 * Each returns a `GateDecision` carrying `decision`, `tier`, `findings`, a
 * constant `reason`, a `contentHash` a human can approve, and an `audit` body.
 *
 * ⚠ THE AUDIT BODY IS NOT APPENDED HERE and carries no hash. Hand
 * `decision.audit` to the capability adapter, which knows the chain's tail.
 * `./audit.ts` explains why a second hasher is how a hash chain forks.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE CALLER'S ONE OBLIGATION
 * ─────────────────────────────────────────────────────────────────────────
 * Pass `declaredNames` when you know whose data this is. Names are not a
 * pattern — no regex recognises a person — so a name the caller knows and does
 * not declare is a name this package cannot mask out of a reported path. Same
 * bargain the host strikes in `redact({ names })`: "declaring a name here is
 * the caller's ONE obligation; everything else is handled or refused."
 */

export { classify, classifyText, deniedPiiField, nameHits, requiresApproval } from "./classify";
export type { ClassifyOptions, NameHit } from "./classify";

export { dedupe, initials, joinPath, maxTier, sanitizePathSegment, tierOf } from "./findings";
export type { Classification, Finding, FindingVia, Tier } from "./findings";

export {
  BUSINESS_SEGMENTS,
  PII_DENIED_SEGMENTS,
  PII_DENIED_SUBSTRINGS,
  PII_PATTERNS,
  PII_PATTERN_NAMES,
  SPECIAL_CATEGORY_SEGMENTS,
  SPECIAL_CATEGORY_SUBSTRINGS,
  normalizeToken,
} from "./lists";
export type { PiiPattern } from "./lists";

export { MAX_TEXT_CHARS, redactTree, scrub } from "./scrub";
export type { RedactTreeResult, ScrubOptions } from "./scrub";

export { PROSE_SCOPES, RECORDING_PROVENANCE_TOKENS, classifyMarkdown, labelsOf } from "./markdown";

export { canonicalJson, checkApproval, contentHash, isNamedHuman } from "./approval";
export type { Approval, ApprovalCheck, ApprovalProblem } from "./approval";

export { MAX_LOCATIONS_IN_EVENT, auditBody, classesOf, locationsOf } from "./audit";
export type { AuditBodyInput, GuardrailAuditBody, GuardrailEventName } from "./audit";

export {
  GATE_POLICY,
  gateGeneratedArtifacts,
  gateModelRequest,
  gateRegistration,
  gateWorkflowIntake,
} from "./gates";
export type {
  GateContext,
  GateDecision,
  GateDecisionKind,
  GateName,
  GeneratedFile,
  ModelRequestConfig,
  ModelRequestDecision,
  TierPolicy,
  WorkflowIntakeOptions,
} from "./gates";

export {
  HOST_ENVELOPE,
  HOST_ROOT,
  HOST_WIDGET_TYPES,
  hostAvailability,
  readHostPiiPatterns,
  readHostSource,
  readNumberConst,
  readStringArray,
} from "./host-source";
export type { HostAvailability, HostPattern } from "./host-source";
