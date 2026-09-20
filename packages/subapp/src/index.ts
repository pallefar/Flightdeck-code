/** `@subapp` — Flightdeck Studio, as a Flightdeck sub-app.
 *
 * Studio runs INSIDE Flightdeck OS at `/api/apps/studio`, under the same kill
 * switch, install row and consent screen as every other sub-app. It converts a
 * Cowork workflow — a skill file: YAML frontmatter plus a `## Procedure` of
 * numbered steps — into a database-free MINI-APP: the `shell-reference` floor,
 * `initSchema: () => {}`, no schema.ts, no DDL, no migration.
 *
 * ⛔ AND IT CANNOT INSTALL WHAT IT GENERATES. A sub-app route reaches the host
 * only through the injected capability adapter, whose entire surface is
 * `readContracts` / `writeInboxProposal` / `listOwnInboxProposals` /
 * `auditAppend` / `resolveSigningAuthority`. There is no filesystem write on
 * it. So Studio generates in memory and files ONE inbox proposal; a human
 * applies it. That is not a limitation being worked around — it is the host's
 * own guardrail 4 and contract rule 7, and the whole product is shaped by it.
 *
 * What lives where:
 *   `emit.ts`            which emitted file takes which host path
 *   `server/subapps/studio/**`  the sub-app's server source (emitted)
 *   `web/src/subapps/studio/**` the console page (emitted)
 *   everything else under `server/` and `web/`  host STAND-INS, never emitted */
export {
  EMIT_MANIFEST,
  EXCLUDED_FROM_VENDORING,
  HOST_STANDINS,
  REGISTRY_EDIT,
  STUDIO_MIN_HOST_VERSION,
  STUDIO_ROUTE_PREFIX,
  STUDIO_SUBAPP_ID,
  VENDORED_PACKAGES,
  type EmittedFile,
} from "./emit.js";

export { studioManifest } from "./server/subapps/studio/manifest.js";
export { STUDIO_SUBAPP_ID as STUDIO_GUARD_ID, StudioDisabledError, requireStudioEnabled } from "./server/subapps/studio/guard.js";
export { registerStudioRoutes, type StudioConversionBody } from "./server/subapps/studio/routes/index.js";
export {
  STUDIO_PROPOSAL_KIND,
  buildProposalBody,
  convertWorkflow,
  findFiledProposal,
  proposalFileNameFor,
  proposalPrefixFor,
  type StudioConversion,
  type StudioConversionInput,
  type StudioFileSummary,
  type StudioGateSummary,
  type StudioGeneratedFile,
  type StudioProposalBody,
  type StudioRegistryEdit,
  type StudioSpecSummary,
  type StudioStepSummary,
} from "./server/subapps/studio/service/pipeline.js";
