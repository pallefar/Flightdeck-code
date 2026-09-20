/**
 * Why a lifecycle call went the way it did — as a CODE, never a sentence.
 *
 * Same discipline as `packages/approvals/src/reasons.ts`, for the same reason:
 * "never string-match an error". A console renders these through its own
 * dictionary in the reader's own language; spliced English prose in a refusal
 * is a string some other surface eventually parses.
 *
 * ⭐ ONE CODE PER DISTINGUISHABLE SITUATION, and the situations here are
 * distinguishable because an operator's NEXT ACTION differs. "This content was
 * never proposed", "it was proposed but nobody signed", "it was signed for a
 * different revision" and "you signed your own submission" send four different
 * people to four different places. The host paid for that lesson once already:
 * `EffectiveSubAppState.projectConsented` exists because a masked state was
 * byte-identical to a never-enabled one on the wire.
 */

export const REGISTRY_REASONS = [
  /** The only non-refusal. */
  "ok",

  // ── malformed input: refuse before touching the ledger ──────────────────
  "invalid_artifact_id",
  "invalid_artifact_kind",
  "invalid_artifact_version",
  "invalid_capability",
  "invalid_workflow_id",
  "invalid_project_id",
  "invalid_actor",
  "invalid_timestamp",
  "invalid_content_hash",
  /** No files. An artifact with no content is not a thing a human can read. */
  "empty_artifact",
  /** Two files claiming the same path — the digest would depend on iteration order. */
  "duplicate_file_path",
  /** An absolute path, a `..` escape or a NUL byte. Refused, never normalized. */
  "unsafe_file_path",

  // ── proposing ───────────────────────────────────────────────────────────
  /** This exact revision is already open for review. Re-proposing is a no-op,
   *  and silently appending a second entry would give one revision two
   *  approvals to disagree about. */
  "already_proposed",
  /** This exact revision already carries a signature; propose something new or
   *  register what is approved. */
  "already_approved",
  /** This exact revision is already in the catalogue. */
  "already_registered",
  /** This exact revision was rejected, superseded or retired. It comes back as
   *  a CHANGED artifact or not at all — a resubmission of byte-identical
   *  content is a request to overturn a decision, which is a human
   *  conversation, not a state transition. */
  "revision_closed",
  /** A second artifact id cannot claim a kind the first one did not have: the
   *  host derives the env var, the nav path and every table prefix from `id`
   *  (contract §3), so `wc-clock` the script and `wc-clock` the mini-app would
   *  collide in the host's namespace. */
  "kind_conflict",

  // ── approving ───────────────────────────────────────────────────────────
  /** Nothing on record for this (artifactId, contentHash). */
  "unknown_revision",
  /** On record, but not in a state this call may leave. */
  "wrong_state",
  /** The caller's hash does not match anything proposed for this id — the
   *  content moved between proposal and signature. */
  "content_hash_mismatch",
  /** A tool, an agent or the system tried to sign off. `boot.json` guardrail 4. */
  "approval_actor_not_human",
  /** A human with no name. An opaque subject id is not a named human to the
   *  person reading the audit trail six months later. */
  "approval_actor_missing",
  /** The approver's subject id IS the artifact's: the tool signing for itself. */
  "approval_self_approved",
  /** The approver is the actor who proposed it. One party, not two. */
  "approval_by_proposer",

  // ── registering ─────────────────────────────────────────────────────────
  /** Registration without a signature over THIS revision. */
  "not_approved",

  // ── enabling, and reuse in a future project ─────────────────────────────
  /** No registered revision for this id at all. */
  "no_ceiling_row",
  /** Registered, but not enabled Function-wide. A project may narrow a
   *  Function's consent, never widen it (host: `installRoutes.ts`, D-05 /
   *  guardrail 4) — so the ceiling has to be open first. */
  "ceiling_not_enabled",
  /** Already in that state for that project; the write would be a no-op that
   *  still appended a history row. */
  "already_enabled",
  "not_enabled",
  /** The ceiling row cannot be enabled per-project: `'*'` is not a project. */
  "ceiling_is_not_a_project",
  /** The bytes on hand hash to something other than the registered revision.
   *  The approval describes code that is not what is about to run. */
  "content_drift",
] as const;

export type RegistryReason = (typeof REGISTRY_REASONS)[number];

export function isRefusal(reason: RegistryReason): boolean {
  return reason !== "ok";
}

/**
 * Refusals that mean "a human signed the wrong way round". Grouped because an
 * operator dashboard should surface these differently from a typo in a project
 * id: every one of them is an attempt, successful or not, to get past
 * guardrail 4.
 */
export const SELF_APPROVAL_REASONS: readonly RegistryReason[] = Object.freeze([
  "approval_actor_not_human",
  "approval_actor_missing",
  "approval_self_approved",
  "approval_by_proposer",
]);
