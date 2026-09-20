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
 *   providers           gateModelRequest(request, { actor })
 *   spec / intake       gateWorkflowIntake(markdown, { actor }, { intakeId })
 *   codegen / harness   gateGeneratedArtifacts(files, { actor })
 *
 * ⭐ `gateModelRequest` IS NOT A SCANNER ANY MORE. It delegates to
 * `packages/envelope`: the question is "can this be expressed in the allowed
 * shape?", not "does a scan find something?". A caller passes a request built
 * from that package's allowlists and gets back `decision.envelope` (with its
 * own `assurance`) or `decision.failures` naming what could not be expressed.
 * Its `{ onTier3, onTier4 }` redaction dials are DEPRECATED and no longer a
 * route to the wire; setting one changes only the wording of the refusal.
 *
 * The other three gates still classify, because their input genuinely is
 * arbitrary — a pasted workflow, a spec, a generated file. In those,
 * `classify()` is a DETECTOR THAT ESCALATES TO A HUMAN. It is not an
 * authority that certifies a payload clean, and nothing in this package will
 * tell you that a payload has no personal data in it: a tier ≤ 2 means the
 * compiled-in classes did not match, which is not the same claim.
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

export {
  FINDING_CLASSES,
  SCHEMA_METAKEYS,
  classify,
  classifyText,
  compositeFindings,
  decodedVariants,
  deniedPiiField,
  isPersonReferent,
  looksLikeFieldPointer,
  looksLikeLabelPhrase,
  looksLikePersonName,
  nameHits,
  parseEmbeddedJson,
  requiresApproval,
} from "./classify";
export type { ClassifyMode, ClassifyOptions, NameHit, NameHitOptions } from "./classify";

export { dedupe, initials, joinPath, maxTier, sanitizePath, sanitizePathSegment, tierOf } from "./findings";
export type { Classification, Finding, FindingVia, Tier } from "./findings";

export {
  ALL_VALUE_PATTERNS,
  BUSINESS_SEGMENTS,
  PERSON_REFERENT_TOKENS,
  PII_DENIED_SEGMENTS,
  PII_DENIED_SUBSTRINGS,
  PII_PATTERNS,
  PII_PATTERN_NAMES,
  PROSE_AMBIGUOUS_TOKENS,
  SPECIAL_CATEGORY_SEGMENTS,
  SPECIAL_CATEGORY_SUBSTRINGS,
  STUDIO_PATTERNS,
  STUDIO_PERSONAL_TOKENS,
  STUDIO_RESTRICTED_SUBSTRINGS,
  STUDIO_RESTRICTED_TOKENS,
  foldChars,
  foldToken,
  normalizeToken,
  splitTokens,
} from "./lists";
export type { PiiPattern } from "./lists";

export { MAX_TEXT_CHARS, redactTree, scrub } from "./scrub";
export type { RedactTreeResult, ScrubOptions } from "./scrub";

export {
  PROSE_SCOPES,
  RECORDING_PROVENANCE_TOKENS,
  classifyCode,
  classifyMarkdown,
  classifyProseAndCode,
  labelsOf,
} from "./markdown";
export type { TextStyle } from "./markdown";

export { canonicalJson, checkApproval, contentHash, isNamedHuman } from "./approval";
export type { Approval, ApprovalCheck, ApprovalProblem } from "./approval";
export { nodeDigest } from "./approval";
export type { Digest } from "./hash";

import { nodeDigest } from "./approval";
import {
  gateGeneratedArtifacts as rawGateGeneratedArtifacts,
  gateModelRequest as rawGateModelRequest,
  gateRegistration as rawGateRegistration,
  gateWorkflowIntake as rawGateWorkflowIntake,
  type GateContext,
  type GateDecision,
  type GeneratedFile,
  type ModelRequestConfig,
  type ModelRequestDecision,
  type WorkflowIntakeOptions,
} from "./gates";

export { MAX_LOCATIONS_IN_EVENT, auditBody, classesOf, locationsOf } from "./audit";
export type { AuditBodyInput, GuardrailAuditBody, GuardrailEventName } from "./audit";

/**
 * ⭐ THE NODE-SIDE GATES. Same functions, with `node:crypto` supplied.
 *
 * `./gates` is now pure — it hashes with `ctx.digest` and imports no builtin —
 * because `packages/conformance` lists "crypto" in `NODE_BUILTINS` and FD-C001
 * refuses a mounted sub-app module that imports one. Until this split, a Studio
 * ROUTE could not call a single gate in this package, and ~136 passing tests
 * never noticed: they all run in Node, where the builtin is simply present.
 *
 * Import from HERE on the CLI and host side and nothing changes. Import from
 * `./pure` inside a sub-app and pass your own digest.
 */
export { GATE_POLICY } from "./gates";

/** One line each, explicit, because a clever generic over four different
 * signatures types worse than four functions and reads worse too. */
const onNode = (ctx: GateContext): GateContext => ({ ...ctx, digest: ctx.digest ?? nodeDigest });

export function gateRegistration(spec: unknown, ctx: GateContext): GateDecision {
  return rawGateRegistration(spec, onNode(ctx));
}

export function gateModelRequest(
  request: unknown,
  ctx: GateContext,
  config: ModelRequestConfig = {},
): ModelRequestDecision {
  return rawGateModelRequest(request, onNode(ctx), config);
}

export function gateWorkflowIntake(
  markdown: string,
  ctx: GateContext,
  options: WorkflowIntakeOptions = {},
): GateDecision {
  return rawGateWorkflowIntake(markdown, onNode(ctx), options);
}

export function gateGeneratedArtifacts(files: readonly GeneratedFile[], ctx: GateContext): GateDecision {
  return rawGateGeneratedArtifacts(files, onNode(ctx));
}
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
  HOST_ABSENCE_ACK_ENV,
  HOST_ABSENCE_ACK_VALUE,
  HOST_ENVELOPE,
  HOST_ROOT,
  HOST_WIDGET_TYPES,
  hostAvailability,
  readHostPiiPatterns,
  readHostSource,
  readNumberConst,
  readRegexLiteral,
  readStringArray,
  stripCommentLines,
} from "./host-source";
export type { HostAvailability, HostPattern } from "./host-source";

export { REPRESENTATIONS_DERIVED, classifyEveryRepresentation } from "./representations";
export type { RepresentationOptions } from "./representations";
