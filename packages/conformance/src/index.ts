/** `@conformance` — the gate that proves a generated sub-app is safe to
 * add to the Flightdeck host, statically, before a byte of it is written.
 *
 * ```ts
 * // Statically, in milliseconds — "does this obey the contract?"
 * const report = runConformanceGate({ files });
 * if (!report.ok) return refuse(formatReport(report));
 *
 * // Contract + compiler + a sandboxed mount — "does this work?"
 * const verdict = await verifySubApp({ files }, { repoRoot });
 *
 * // The same three answers, and the write, behind one call.
 * await shipSubApp({ files }, { root: hostRepo });
 * ```
 *
 * The first is a fast opinion for an editor. The last two are the gate:
 * `shipSubApp` is the only exported way to put a generated sub-app on a
 * disk, and it does not exist as a path that skips the verification.
 *
 * `docs/FLIGHTDECK-SUBAPP-CONTRACT.md` is the law this package enforces.
 * Deliberately self-contained: it imports neither the host nor Studio's
 * generator, because its job is to judge text it did not produce — a file
 * a model wrote, a file a human edited after generation, a file from last
 * month's generator. A gate that shared a derivation with the thing it
 * judges would agree with it about the wrong answer. */
export { runConformanceGate, assertShippable, ConformanceError, CHECKS, type GateOptions, type GateReport } from "./gate";
export {
  verifySubApp,
  assertVerified,
  type StageName,
  type VerificationReport,
  type VerificationStage,
  type VerifyOptions,
} from "./verify";
export { shipSubApp, ShipRefused, type ShipOptions, type ShipReport, type WriteOutcome, type WriteStatus } from "./ship";
export { typecheckCandidate, type TypecheckOptions, type TypecheckResult } from "./verify/typecheck";
export { FLIGHTDECK_HOST_SURFACE, type HostSurface } from "./verify/host-surface";
export { mountProbe, type MountContext, type MountOptions, type MountResult } from "./verify/mount";
export { isolationAvailable, redactSecrets } from "./verify/sandbox";
export type { ProbeResult, ProbeRoute, ProbeInvocation } from "./verify/harness";
export { formatFinding, formatReport, formatRuleCatalog, formatVerification } from "./report";
export {
  CANDIDATE_SCOPE,
  RULES,
  RULE_IDS,
  sortFindings,
  type Finding,
  type Position,
  type RuleId,
  type RuleSpec,
  type Severity,
} from "./finding";
export {
  analyzeCandidate,
  mountedFiles,
  mountedServerFiles,
  type AnalysisResult,
  type AnalyzedFile,
  type AnalyzedSubApp,
  type CandidateFile,
  type CandidateSubApp,
  type FileRole,
} from "./analyze";
export type { Check, CheckContext } from "./check";
export { manifestCheck } from "./checks/manifest";
export { importClosureCheck } from "./checks/import-closure";
export { capabilityEscapeCheck } from "./checks/capability-escape";
export { guardFirstCheck } from "./checks/guard-first";
export { cachedBooleanCheck } from "./checks/cached-boolean";
export { tablePrefixCheck } from "./checks/table-prefix";
export { mountCheck } from "./checks/mount";
export {
  HOST_LEAF_MODULES,
  FORBIDDEN_HOST_MODULES,
  classifyImport,
  normalizePath,
  type ImportTarget,
  type ResolvedImport,
} from "./resolve";
export { subAppManifestSchema, validateManifestData, exceedsHostCeiling, type SubAppManifestData } from "./manifest-schema";
export { readManifestSource, parseLiteralText, type ManifestSource, type ManifestReadResult } from "./manifest-read";
export { scanFile, type ScannedFile, type ImportRef, type StringLiteral } from "./scan";
export { extractRouteHandlers, type RouteHandler, type HandlerScan } from "./handlers";
export * as derive from "./derive";
