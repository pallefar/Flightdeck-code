/** Flightdeck Studio — codegen.
 *
 * Takes a validated MiniAppSpec and emits the source files of a Flightdeck
 * sub-app: `manifest.ts`, `guard.ts`, `routes/index.ts` plus one file per
 * domain, `schema.ts` when the spec declares tables, the web module's
 * `index.tsx`, and the `registry.ts` edit as a patch.
 *
 * `docs/FLIGHTDECK-SUBAPP-CONTRACT.md` is the law this package implements.
 * The rules it cannot let an emitted sub-app break — guard first, no cached
 * booleans, no capability escape, no sibling imports, Zod at every
 * boundary, audit only through the injected adapter, the
 * `subapp_<id>_` table prefix, `minHostVersion: "5.0.0"` — are checked on
 * the emitted TEXT by `invariants.ts` before `generateSubApp` returns. */
export { generateSubApp, type GenerateOptions, type GeneratedSubApp } from "./generate";
export { planSubApp, SpecRejectedError, type SubAppPlan, type PlannedDomain, type PlannedRoute, type PlannedTable } from "./plan";
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
  CAPABILITY_SCOPES,
  HOST_VERSION,
  MANAGED_COLUMNS,
  NAV_SECTIONS,
  RESERVED_SUBAPP_IDS,
  WORKSPACE_ROLES,
  type MiniAppSpec,
  type DomainSpec,
  type RouteSpec,
  type Operation,
  type FieldSpec,
  type TableSpec,
} from "./spec-contract";
export * as naming from "./naming";
