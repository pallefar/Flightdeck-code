/** The route-safe surface of @guardrails: every gate, no node builtin.
 *
 * ⭐ WHY THIS FILE EXISTS, AND IT IS NOT A STYLE PREFERENCE.
 *
 * `packages/conformance` lists "crypto" in `NODE_BUILTINS`, and FD-C001
 * refuses any mounted sub-app module that imports one — "a mounted sub-app
 * module has the host process's full filesystem and network access, and that
 * is how it escapes the capabilities its manifest declares". The host does not
 * take that on trust: `tests/subapps/subappImportClosure.test.ts` walks a
 * route's STATIC IMPORT CLOSURE and fails on an import that is merely PRESENT.
 *
 * `gates.ts` imported `contentHash`; `contentHash` imports `node:crypto`. So
 * until this split, NOT ONE GATE IN THIS PACKAGE COULD BE CALLED FROM A STUDIO
 * ROUTE — the single process the contract says this work happens in. The
 * guardrails were unreachable from the thing they exist to guard.
 *
 * ⚠ AND ~136 TESTS PASSED THE WHOLE TIME. Every one of them runs in Node,
 * where the builtin is simply there. A package can be exhaustively and
 * adversarially tested and still not fit through the seam it was written for,
 * because the tests measure the code and not the seam. That is the same shape
 * as the sub-app that served HTTP 200 while it did not typecheck, and the
 * stylesheet that satisfied every selector while defining none of the tokens.
 *
 * So: import from here in a route and pass `ctx.digest`. Import from
 * `index.ts` on the CLI and host side, where `node:crypto` is supplied for you
 * and nothing changes. `pure-closure.test.ts` walks this file's closure on
 * every run, so the guarantee is checked rather than promised.
 */
export {
  GATE_POLICY,
  GuardrailDigestMissingError,
  gateGeneratedArtifacts,
  gateModelRequest,
  gateRegistration,
  gateWorkflowIntake,
  refuseAtPayloadTierCeiling,
} from "./gates";
export type {
  GateContext,
  PayloadTierCeilingRefusal,
  GateDecision,
  GateDecisionKind,
  GateName,
  GeneratedFile,
  ModelRequestConfig,
  ModelRequestDecision,
  TierPolicy,
  WorkflowIntakeOptions,
} from "./gates";

export { canonicalJson, contentHashWith } from "./hash";

/** ⭐ THE DIGEST A ROUTE CAN ACTUALLY USE. A mounted sub-app may not import
 * node:crypto (FD-C001), SubAppCapabilities exposes none, and Web Crypto is
 * async while these gates are sync. `sha256.ts` supplies it, differentially
 * tested against node:crypto over every length to 200, the UTF-8 boundaries
 * and 3000 random inputs. Content identity only — never a secret operation. */
export { pureDigest, sha256Hex } from "./sha256";
export type { Digest } from "./hash";

export { checkApprovalWith } from "./approval-pure";
export type { Approval, ApprovalCheck, ApprovalProblem } from "./approval-pure";

export { classify } from "./classify";
export type { ClassifyOptions } from "./classify";
export { dedupe, initials, joinPath, maxTier, sanitizePath, sanitizePathSegment, tierOf } from "./findings";
export type { Classification, Finding, Tier } from "./findings";
