/**
 * The host's own id vocabulary, mirrored — not re-invented.
 *
 * Source of truth is `project-contract/flightdeck/server/project/types.ts`.
 * Studio is a separate repo and cannot import the host's modules, so these are
 * copies with the host's reasoning attached. If the two ever disagree, THE HOST
 * WINS and these get re-derived.
 *
 * ⭐ WHY `"*"` IS SAFE AS A SENTINEL, in the host's words: it is "structurally
 * uncollidable with a real project id rather than reserved by convention —
 * `PROJECT_SLUG_RE` demands an alphanumeric FIRST character, so `*` can never be
 * created. This matters because it is the difference between an invariant and a
 * reserved-word list someone has to remember."
 *
 * That property is load-bearing HERE too: the ceiling grant row lives at project
 * `"*"`, so a project that could name itself `*` would be able to write its own
 * ceiling. It cannot, and the regex below is why.
 */

/** Host: `WORKSPACE_SCOPE_PROJECT_ID`. The workspace-wide CEILING row. */
export const CEILING_PROJECT_ID = "*";

/** Host: `DEFAULT_PROJECT_ID`. The synthesized project every workspace has. */
export const DEFAULT_PROJECT_ID = "general";

/** Host: `PROJECT_SLUG_RE`. Leading alphanumeric is the uncollidability proof. */
export const PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Host: `PROJECT_ID_MAX` — a bound on what may be MINTED, chosen against ext4. */
export const PROJECT_ID_MAX = 64;

/** Host: `SUBAPP_ID_PATTERN`. A tool id is a sub-app id. */
export const TOOL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
export const TOOL_ID_MAX = 64;

/**
 * A content hash as this package handles it: OPAQUE. We compare it, we record
 * it, we never compute it and never parse it. `sha256:<hex>` and bare hex both
 * pass; what is refused is blank, whitespace-bearing, or short enough to be a
 * placeholder someone typed.
 *
 * ⛔ NEVER HASH ANYTHING IN THIS PACKAGE. Sub-app contract §5 rule 5: "Never
 * construct an audit hash. Only `appendFlightdeckAudit()` / `caps.auditAppend()`."
 * The tool's content hash comes from the caller for the same reason — a second
 * hashing implementation is a second answer.
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
