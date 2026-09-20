/**
 * Why a decision went the way it did — as a CODE, never as a sentence.
 *
 * ⛔ THE DISCIPLINE THIS FILE ENFORCES. The host's refusals are structural:
 * `BlockedOutcome` carries a `rule`, `ProviderError` carries a `kind`, and the
 * rule everywhere is "never string-match an error". A UI renders these by
 * looking the code up in its own dictionary, in the reader's own language, with
 * its own placeholders filled from `GrantDecision`'s numeric fields. Spliced
 * English prose in a decision is a string another surface will eventually parse.
 *
 * So: one code per DISTINGUISHABLE SITUATION, and the situations are
 * distinguishable on purpose. "The Function never consented" and "this project
 * turned it off" are different sentences a human needs, and the host paid for
 * that lesson once already — `EffectiveSubAppState.projectConsented` exists
 * because a masked state was byte-identical to a never-enabled one on the wire
 * and "every console sentence about it was a guess, and three of them were
 * measurably false."
 */

export const GRANT_REASONS = [
  /** The only non-refusal. */
  "allowed",

  // — malformed request: refuse before reading anything ————————————————
  "invalid_tool_id",
  "invalid_project_id",
  "invalid_content_hash",
  "invalid_datasource",
  "invalid_tier",
  "invalid_requester",

  // — the ceiling layer ('*') —————————————————————————————————————————
  /** No `'*'` row for this tool at all: the Function never consented. */
  "no_ceiling_row",
  /** The ceiling row exists but was revoked. */
  "ceiling_revoked",
  /** The ceiling row does not name THIS datasource — including the case where
   *  it names the parent connector but not this sub-scope. */
  "no_ceiling_grant_for_datasource",

  // — the project layer ——————————————————————————————————————————————
  "no_project_row",
  "project_revoked",
  "no_project_grant_for_datasource",

  // — the tier ————————————————————————————————————————————————————————
  /** Above what the ceiling reaches. A project cannot fix this; the Function must. */
  "tier_above_ceiling",
  /** Within the ceiling, but this project narrowed itself below it. */
  "tier_above_project",

  // — approval (tier 3 and 4) ——————————————————————————————————————————
  /** Nothing on record for this (tool, project, datasource). */
  "approval_required",
  "approval_revoked",
  /** The tool's content changed: the old approval does not describe this tool. */
  "approval_content_hash_mismatch",
  "approval_actor_missing",
  /** A tool, an agent or the system tried to sign off. Guardrail 4. */
  "approval_actor_not_human",
  /** A human actor whose subject id IS the tool. */
  "approval_self_approved",
  /** Recorded at a lower tier than the one being asked for. */
  "approval_tier_insufficient",
] as const;

export type GrantReason = (typeof GRANT_REASONS)[number];

export function isRefusal(reason: GrantReason): boolean {
  return reason !== "allowed";
}
