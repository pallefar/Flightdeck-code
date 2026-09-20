/** `@subapp` — Flightdeck Studio, as a Flightdeck sub-app.
 *
 * Studio runs INSIDE Flightdeck OS at `/api/apps/studio`, under the same kill
 * switch, install row and consent screen as every other sub-app. It converts a
 * Cowork workflow — a skill file: YAML frontmatter plus a `## Procedure` of
 * numbered steps — into a database-free MINI-APP: the `shell-reference` floor,
 * `initSchema: () => {}`, no schema.ts, no DDL, no migration.
 *
 * ⭐ THE PRODUCT IS SPLIT ACROSS THE REPOSITORY LINE, AND THAT IS THE DESIGN.
 * GENERATION is `studio/conversion.ts` and the three engine packages behind
 * it. It runs in Studio, stays in Studio, and produces a JSON bundle. FILING
 * is `server/subapps/studio/**` and `web/src/subapps/studio/**`, which travel
 * into a host checkout and mount there.
 *
 * The split is not tidiness. A sub-app that imports sibling packages from the
 * Studio repo is not a sub-app the host can build: mounting the engine meant
 * vendoring forty-six modules authored against Studio's own tsconfig, and the
 * host's `npm run typecheck` went red on them. Filing, by contrast, is the
 * half that genuinely needs a host — the kill switch, the install row, the
 * consent screen, the audit chain and the Inbox are things Studio cannot
 * provide for itself. So each half lives where its dependencies are.
 *
 * ⛔ AND IT CANNOT INSTALL WHAT IT GENERATES. A sub-app route reaches the host
 * only through the injected capability adapter, whose entire surface is
 * `readContracts` / `writeInboxProposal` / `listOwnInboxProposals` /
 * `auditAppend` / `resolveSigningAuthority`. There is no filesystem write on
 * it. So Studio files ONE inbox proposal; a human applies it. That is not a
 * limitation being worked around — it is the host's own guardrail 4 and
 * contract rule 7, and the whole product is shaped by it.
 *
 * ⛔ AND THE BUNDLE IS NOT BELIEVED. It arrives over HTTP carrying a report of
 * a gate run the host did not witness. `service/admit.ts` re-derives the host's
 * own verdict from the bundle's bytes, and the proposal keeps the two apart by
 * name. A claim is provenance; it is never a credential.
 *
 * What lives where:
 *   `emit.ts`                    which emitted file takes which host path, and
 *                                what the install actually requires
 *   `server/subapps/studio/**`   the sub-app's server source (emitted)
 *   `web/src/subapps/studio/**`  the console page (emitted)
 *   `tests/subapps/studio/**`    the host tests that travel with it (emitted)
 *   `studio/conversion.ts`       the engine run — Studio-side, never emitted
 *   everything else under `server/` and `web/`  host STAND-INS, never emitted */
export {
  EMIT_MANIFEST,
  HOST_DEPENDENCIES,
  HOST_STANDINS,
  INSTALL_STEPS,
  NODE_BUILTINS_IN_TESTS,
  REGISTRY_EDIT,
  STUDIO_MIN_HOST_VERSION,
  STUDIO_ONLY,
  STUDIO_ROUTE_PREFIX,
  STUDIO_SUBAPP_ID,
  type EmittedFile,
} from "./emit.js";

/* ── The emitted sub-app ──────────────────────────────────────────────── */
export { studioManifest } from "./server/subapps/studio/manifest.js";
export { STUDIO_SUBAPP_ID as STUDIO_GUARD_ID, StudioDisabledError, requireStudioEnabled } from "./server/subapps/studio/guard.js";
export { registerStudioRoutes } from "./server/subapps/studio/routes/index.js";
export {
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_FILES,
  MAX_FILE_BYTES,
  STUDIO_BUNDLE_SCHEMA,
  bundleBytes,
  studioBundleSchema,
  type BundleFile,
  type BundleFinding,
  type BundleGate,
  type BundleRegistry,
  type BundleSpec,
  type StudioBundle,
} from "./server/subapps/studio/service/bundle.js";
export {
  ADMISSION_CHECKS,
  BUNDLE_SCOPE,
  HOST_CAPABILITIES,
  HOST_NAV_SECTIONS,
  HOST_ROLES,
  HOST_VERSION,
  admitBundle,
  demandsNewerHost,
  type AdmissionFinding,
  type AdmissionReport,
  type AdmissionRule,
  type AdmissionSeverity,
} from "./server/subapps/studio/service/admit.js";
export {
  STUDIO_PROPOSAL_KIND,
  buildProposalBody,
  findFiledProposal,
  proposalFileNameFor,
  proposalPrefixFor,
  summarizeFiles,
  type ProposalFileSummary,
  type StudioProposalBody,
} from "./server/subapps/studio/service/proposal.js";

/* ── Studio's side of the line. Never emitted. ────────────────────────── */
export {
  STUDIO_PRODUCER,
  bundleFrom,
  convertWorkflow,
  type BundleOptions,
  type StudioConversion,
  type StudioConversionInput,
  type StudioFileSummary,
  type StudioGateSummary,
  type StudioGeneratedFile,
  type StudioRegistryEdit,
  type StudioSpecSummary,
  type StudioStepSummary,
} from "./studio/conversion.js";
