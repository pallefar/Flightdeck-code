/**
 * The host's id vocabulary, MIRRORED — not invented, and not borrowed from a
 * sibling package that is mirroring the same thing.
 *
 * Source of truth is `project-contract/flightdeck/server/project/types.ts` and
 * `server/subapps/types.ts`. Studio is a separate repo and cannot import the
 * host's modules, so these are copies with the host's reasoning attached. If
 * this file and the host ever disagree, THE HOST WINS and this gets re-derived.
 *
 * ⚠ TWO SIBLING MIRRORS EXIST, ON PURPOSE. `packages/approvals/src/identity.ts`
 * and `packages/spec/src/vocabulary.ts` carry copies of the same host literals,
 * each for its own package's reasons. That is the established shape here: every
 * package mirrors the HOST and names it, rather than one package importing
 * another's copy and inheriting its refactors. A chain of copies has one true
 * source; a chain of imports has a build that breaks when a neighbour is
 * mid-edit. The rule is not "one copy" — it is "one source, named in every
 * copy", which is what makes a drift check mechanical.
 *
 * ⭐ WHY `"*"` IS SAFE AS A SENTINEL, in the host's own words: it is
 * "structurally uncollidable with a real project id rather than reserved by
 * convention — `PROJECT_SLUG_RE` demands an alphanumeric FIRST character, so
 * `*` can never be created. This matters because it is the difference between
 * an invariant and a reserved-word list someone has to remember."
 *
 * That property is load-bearing HERE: the Function-wide ceiling row lives at
 * project `"*"`, and a project that could name itself `*` could write its own
 * ceiling — which is precisely the widening the host forbids.
 */

/** Host: `WORKSPACE_SCOPE_PROJECT_ID`. The workspace-wide CEILING row. */
export const CEILING_PROJECT_ID = "*";

/** Host: `DEFAULT_PROJECT_ID`. The synthesized project every workspace has. */
export const DEFAULT_PROJECT_ID = "general";

/** Host: `PROJECT_SLUG_RE`. Leading alphanumeric is the uncollidability proof. */
export const PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Host: `PROJECT_ID_MAX` — a bound on what may be MINTED, chosen against ext4. */
export const PROJECT_ID_MAX = 64;

/** Host: `SUBAPP_ID_RE` from `server/subapps/types.ts`. A tool id is a sub-app id. */
export const TOOL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const TOOL_ID_MAX = 64;

/**
 * A content hash as this package handles it. `hash.ts` PRODUCES bare lowercase
 * sha256 hex; this predicate additionally admits a `sha256:<hex>` prefix and
 * other opaque digests, because a hash that arrives from a caller is compared
 * and recorded, never parsed.
 *
 * ⚠ DELIBERATELY THE SAME ADMITTED SET as `packages/approvals`'
 * `CONTENT_HASH_RE` (`/^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/`), so a hash minted
 * here can be handed straight to `effectiveGrant()` without a second spelling
 * of the same digest. What is refused is blank, whitespace-bearing, or short
 * enough to be a placeholder someone typed.
 */
export const CONTENT_HASH_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/;

export function isValidProjectId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === CEILING_PROJECT_ID) return true;
  return value.length <= PROJECT_ID_MAX && PROJECT_SLUG_RE.test(value);
}

export function isValidToolId(value: unknown): value is string {
  return typeof value === "string" && value.length <= TOOL_ID_MAX && TOOL_ID_RE.test(value);
}

export function isValidContentHash(value: unknown): value is string {
  return typeof value === "string" && CONTENT_HASH_RE.test(value);
}

/**
 * A registered artifact's id. Identical rule to a tool/sub-app id, because for
 * a mini-app it IS the sub-app id the host locks once shipped (contract §2:
 * "Locked once shipped — derives the env var, nav path and table prefix"), and
 * a script has no reason to spell its name differently from the mini-app
 * standing next to it in the same ledger.
 */
export const ARTIFACT_ID_RE = TOOL_ID_RE;
export const isValidArtifactId = isValidToolId;

/**
 * The workflow an artifact came from. In this codebase a workflow IS a skill
 * file (`packages/spec/src/workflow.ts`: "YAML frontmatter carrying `name` and
 * a long `description`"), and skills are addressed by directory slug —
 * `orchestrate-workflow`, `quality-check`. Same slug shape as everything else
 * here, kept under its own name so a reader of a proposal can see which of the
 * two ids is provenance and which is identity.
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
