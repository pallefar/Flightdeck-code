/**
 * The id vocabulary this package uses — BORROWED, not re-spelled.
 *
 * ⚠ THIS IS ONE OF ONLY THREE FILES IN `packages/registry` THAT NAMES ANOTHER
 * STUDIO PACKAGE (the others are `actor.ts` and `hash.ts`). Keeping the
 * dependency in a leaf is the same discipline the host applies to
 * `server/subapps/installRow.ts`: the read has no host edges, so it lives
 * where importing it drags nothing else in.
 *
 * `packages/approvals/src/identity.ts` already mirrored the host's
 * `flightdeck/server/project/types.ts` — `PROJECT_SLUG_RE`, the `'*'` ceiling
 * sentinel, `SUBAPP_ID_PATTERN` as a tool id, and what counts as a content
 * hash. Copying those four rules a second time here would be the divergent-
 * second-opinion defect the host names by name in `installRow.ts` ("never a
 * second, divergent eligibility query"), so this file re-exports them and adds
 * only what the registry needs and approvals does not have: a workflow id.
 *
 * ⭐ WHY `'*'` MATTERS HERE SPECIFICALLY. `CEILING_PROJECT_ID` is the host's
 * `WORKSPACE_SCOPE_PROJECT_ID`: the Function-wide row that a project may narrow
 * and never widen. In this package it is the project id an artifact is enabled
 * AT when it becomes reusable Function-wide, which is precisely the state
 * `subapps.json#installs[].enabled` records. A project that could name itself
 * `*` could write its own ceiling; `PROJECT_SLUG_RE` demands a leading
 * alphanumeric, so it cannot, and that is an invariant rather than a
 * reserved-word list someone has to remember.
 */

export {
  CEILING_PROJECT_ID,
  CONTENT_HASH_RE,
  DEFAULT_PROJECT_ID,
  PROJECT_ID_MAX,
  PROJECT_SLUG_RE,
  TOOL_ID_MAX,
  TOOL_ID_RE,
  isValidContentHash,
  isValidProjectId,
  isValidToolId,
} from "../../approvals/src/identity";

/**
 * A registered artifact's id. Identical rule to a tool/sub-app id, because for
 * a mini-app it IS the sub-app id the host locks once shipped (contract §2:
 * "Locked once shipped — derives the env var, nav path and table prefix"), and
 * a script has no reason to spell its name differently from the mini-app
 * standing next to it in the same ledger.
 */
export { TOOL_ID_RE as ARTIFACT_ID_RE, isValidToolId as isValidArtifactId } from "../../approvals/src/identity";

/**
 * The workflow an artifact came from. In this codebase a workflow IS a skill
 * file (`packages/spec/src/workflow.ts`: "YAML frontmatter carrying `name` and
 * a long `description`"), and skills are addressed by directory slug —
 * `orchestrate-workflow`, `quality-check`. Same slug shape as everything else
 * here, kept as its own name so a reader of a proposal can see which of the two
 * ids is provenance and which is identity.
 *
 * Provenance is REQUIRED on a proposal, never optional: "which workflow
 * produced this" is the first question asked of an artifact somebody is being
 * invited to reuse in a project they did not build it for.
 */
export const WORKFLOW_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const WORKFLOW_ID_MAX = 64;

export function isValidWorkflowId(value: unknown): value is string {
  return typeof value === "string" && value.length <= WORKFLOW_ID_MAX && WORKFLOW_ID_RE.test(value);
}
