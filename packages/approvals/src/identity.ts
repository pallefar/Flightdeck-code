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

import { contentHash as guardrailsContentHash } from "../../guardrails/src/approval";

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
 * A content hash as this package handles it: OPAQUE. We compare it and we
 * record it; we never parse it. `sha256:<hex>` and bare hex both pass; what is
 * refused is blank, whitespace-bearing, or short enough to be a placeholder
 * someone typed. It exists to validate the hash STORED on an approval row,
 * which was written by an earlier version of the code or by an operator tool.
 *
 * ⛔ STILL NO HASH IMPLEMENTATION IN THIS PACKAGE. Sub-app contract §5 rule 5:
 * "Never construct an audit hash. Only `appendFlightdeckAudit()` /
 * `caps.auditAppend()`." That rule is about the AUDIT CHAIN and it is still
 * obeyed — `audit.ts` has no chain, no `prev_hash` and no hasher.
 *
 * ⭐ WHAT CHANGED: the TOOL content hash is no longer accepted from the caller
 * either. It used to be an opaque string the requester supplied, so "approve a
 * tool, change one byte, present the OLD hash" was not a defect this package
 * could see — the content-binding the whole approval rests on was delegated to
 * a caller that did not exist yet. `toolContentHash()` below computes it from
 * the tool content instead. It does NOT introduce a second hasher: it calls
 * `packages/guardrails`' `contentHash()`, which is the one implementation in
 * this repository and the one `checkApproval()` there already verifies against.
 * A second hashing implementation is a second answer; a single shared one is
 * the opposite.
 */
export const CONTENT_HASH_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/;

/**
 * The hash of a tool AS IT WILL RUN — computed, never accepted.
 *
 * `guardrailsContentHash` is `sha256(canonicalJson(value))`: object keys sorted
 * at every depth, so key insertion order cannot produce two hashes for one
 * tool, and arrays keep their order because order is meaning in an array.
 */
export function toolContentHash(toolContent: unknown): string {
  return guardrailsContentHash(toolContent);
}

export function isValidProjectId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === CEILING_PROJECT_ID) return true;
  return value.length <= PROJECT_ID_MAX && PROJECT_SLUG_RE.test(value);
}

/**
 * ⭐ WHAT A *REQUEST* MAY NAME, which is strictly less than what a ROW may name.
 *
 * `'*'` is a valid project id for a STORED ROW — it is where the ceiling lives.
 * It is not a valid project id for a QUESTION. The two were the same predicate,
 * and that single fact was a complete bypass of per-project narrowing: a project
 * narrowed to tier 1 under a tier-2 ceiling asked again with `projectId: "*"`,
 * `decision.ts` made the ceiling row BE the project row, and the narrowing
 * evaporated. The `'*'` sentinel is genuinely uncollidable (the leading-
 * alphanumeric rule above is the proof, and it holds); the defect was never
 * that `'*'` could be SPOOFED, it was that `'*'` was REACHABLE from a caller-
 * supplied field. A caller that can name its own scope as the ceiling writes
 * its own ceiling.
 *
 * So the read path and the write path get different predicates, and the
 * difference is one line rather than a convention someone has to remember.
 */
export function isRequestableProjectId(value: unknown): value is string {
  return value !== CEILING_PROJECT_ID && isValidProjectId(value);
}

export function isValidToolId(value: unknown): value is string {
  return typeof value === "string" && value.length <= TOOL_ID_MAX && TOOL_ID_RE.test(value);
}

export function isValidContentHash(value: unknown): value is string {
  return typeof value === "string" && CONTENT_HASH_RE.test(value);
}
