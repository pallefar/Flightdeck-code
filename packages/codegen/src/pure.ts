/** The route-safe surface of @codegen: generation, and nothing that
 * touches a disk.
 *
 * ⭐ WHY THIS FILE EXISTS, AND WHY IT IS NOT A STYLE PREFERENCE.
 * Studio runs INSIDE Flightdeck OS, as a sub-app at `/api/apps/studio`. A
 * sub-app route reaches the world only through the injected capability
 * adapter — `readContracts`, `writeInboxProposal`, `listOwnInboxProposals`,
 * `auditAppend`, `resolveSigningAuthority` — and contract rule 3 forbids a
 * route from importing `node:fs`, a database driver or a host reader
 * module. The host does not take that on trust: `tests/subapps/
 * subappImportClosure.test.ts` walks a route's STATIC IMPORT CLOSURE, and
 * an import that is merely *present* in the closure fails it, whether or
 * not the code ever calls it.
 *
 * `index.ts` re-exports `apply.ts`, which imports `node:fs`, `node:path`
 * and `node:crypto` — correctly, because that is the CLI half, the part a
 * human runs to apply an approved proposal. But it means a Studio route
 * writing `import { generateSubApp } from "@codegen"` would pull the
 * filesystem into its own closure and fail the host's fence, with a
 * generator that never opens a file.
 *
 * So the split is by REACHABILITY, not by intent: import from here in a
 * route, from `index.ts` in the CLI and in tests. `pure-closure.test.ts`
 * walks this file's closure on every run and fails on the first `node:`
 * specifier it finds, so the guarantee is checked rather than promised.
 *
 * What a route does with the result is the other half of the same design:
 * generation happens in memory, the emitted files become ONE inbox
 * proposal, and a human applies it. Propose, don't mutate (contract rule
 * 7) is why there is no write path here to miss. */
export { generateSubApp, type GenerateOptions, type GeneratedSubApp } from "./generate";
export {
  planSubApp,
  SpecRejectedError,
  type PlannedDomain,
  type PlannedRoute,
  type PlannedTable,
  type PlannedWorkflow,
  type PlannedWorkflowStep,
  type SubAppPlan,
} from "./plan";
export { DEFAULT_PROFILE, MINI_APP_FLOOR, PROFILES, isMiniApp, tableRefusalReason, type Profile } from "./profile";
export {
  CodegenInvariantError,
  checkEmittedInvariants,
  stripComments,
  type GeneratedFile,
  type Violation,
} from "./invariants";
export {
  REGISTRY_PATH,
  RegistryPatchError,
  buildRegistryPatch,
  formatUnifiedDiff,
  type RegistryPatch,
  type RegistryInsertion,
} from "./registry-patch";
export { assertManifestWouldBoot, subAppManifestSchema, ManifestRuleError, isVersionNewer, type SubAppManifestData } from "./manifest-rules";
export {
  miniAppSpecSchema,
  profileOf,
  workflowSpecSchema,
  workflowStepSchema,
  CAPABILITY_SCOPES,
  HOST_VERSION,
  MANAGED_COLUMNS,
  NAV_SECTIONS,
  RESERVED_SUBAPP_IDS,
  WORKFLOW_GATES,
  WORKSPACE_ROLES,
  type DomainSpec,
  type FieldSpec,
  type MiniAppSpec,
  type Operation,
  type RouteSpec,
  type TableSpec,
  type WorkflowGate,
  type WorkflowSpec,
  type WorkflowStepSpec,
} from "./spec-contract";
export * as naming from "./naming";
