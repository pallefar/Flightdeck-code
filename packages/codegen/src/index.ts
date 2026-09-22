/** Flightdeck Studio — codegen.
 *
 * Takes a validated MiniAppSpec and emits the source files of a Flightdeck
 * MINI-APP: the database-free, `shell-reference`-shaped floor —
 * `manifest.ts` with `initSchema: () => {}`, `guard.ts`, `routes/index.ts`
 * plus one file per domain, the web module's `index.tsx`, the conformance
 * test that travels with them, and the `registry.ts` edit as a patch. No
 * `schema.ts`, no DDL, no migration: a spec that declares tables is refused
 * by name unless it says `profile: "table-backed"` (see `profile.ts`).
 *
 * Nothing in the GENERATOR writes to disk. `generateSubApp` returns text,
 * which is what lets Studio run as a sub-app of the host it generates for:
 * a sub-app route reaches the world only through the injected capability
 * adapter, which has no filesystem write. The generated set becomes ONE
 * inbox proposal that a human applies.
 *
 * ⛔ BUT DO NOT IMPORT THIS MODULE FROM A ROUTE. This file re-exports
 * `apply.ts` — the CLI half, the part a human runs — and `apply.ts`
 * imports `node:fs`. The host fails a sub-app whose static import closure
 * merely CONTAINS the filesystem, called or not
 * (`tests/subapps/subappImportClosure.test.ts`). A Studio route imports
 * `./pure` instead, whose closure is checked on every run by
 * `__tests__/pure-closure.test.ts`.
 *
 * `docs/FLIGHTDECK-SUBAPP-CONTRACT.md` is the law this package implements.
 * The rules it cannot let an emitted sub-app break — guard first, no cached
 * booleans, no capability escape, no sibling imports, Zod at every
 * boundary, audit only through the injected adapter, the
 * `subapp_<id>_` table prefix, `minHostVersion: "5.0.0"` — are checked on
 * the emitted TEXT by `invariants.ts` before `generateSubApp` returns. */
export { generateSubApp, type GenerateOptions, type GeneratedSubApp } from "./generate";
export {
  JOURNAL_DIR,
  PathEscapeError,
  applyGeneratedFiles,
  applyWrites,
  fingerprint,
  journalPathFor,
  planWrites,
  resolveWithinRoot,
  sha256,
  sortForCommit,
  writeAction,
  type ActionReport,
  type ActionStatus,
  type ApplyFailure,
  type ApplyOptions,
  type ApplyOutcome,
  type ApplyReport,
  type Disposition,
  type Reconciliation,
  type Refusal,
  type RefusalReason,
  type WriteAction,
  type WritePayload,
} from "./apply";
export {
  planSubApp,
  SpecRejectedError,
  type PlanOptions,
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
export { readEmittedManifest, ManifestReadError } from "./testing/readEmittedManifest";
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
  type MiniAppSpec,
  type WorkflowGate,
  type WorkflowSpec,
  type WorkflowStepSpec,
  type DomainSpec,
  type RouteSpec,
  type Operation,
  type FieldSpec,
  type TableSpec,
} from "./spec-contract";
export {
  PROPOSAL_TEMPLATES,
  approvedTemplateMenu,
  checkTemplateApproval,
  proposeOperation,
  proposeOperationProblem,
  resolveProposalTemplate,
  templateContentHash,
  type ProposalTemplate,
  type ProposalTemplateMenuEntry,
  type ProposeOperation,
  type TemplateApproval,
  type TemplateApprovalProblem,
  type TemplateResolution,
} from "./proposal-templates";
export * as naming from "./naming";

