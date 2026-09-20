/**
 * The lifecycle, as a closed state machine.
 *
 *     proposed ──approve──> approved ──register──> registered
 *        │                     │                      │
 *        │ reject              │ retire               ├─ supersede ─> superseded
 *        v                     v                      └─ retire ────> retired
 *     rejected               retired
 *
 * ⭐ WHY `superseded` IS A STATE AND NOT A DELETION. "Re-proposing changed
 * content after approval must come back as a NEW proposal, not ride the old
 * approval." The mechanism is that a ledger entry is keyed by
 * `(artifactId, contentHash)` — a REVISION, not a name. Proposing changed
 * content mints a second entry in `proposed`; the first one keeps its state,
 * its approver and its timestamp until the second is registered, at which point
 * the first moves to `superseded` and stops being what new projects enable.
 *
 * Nothing is ever removed. `superseded` and `retired` are archive states in the
 * same sense as the host's `revokedAt`-set-row-stays idiom and
 * `packages/approvals`' revocation: "the audit trail keeps naming the human who
 * once approved it".
 *
 * ⛔ THERE IS NO EDGE BACK INTO `approved`. An entry that was rejected, retired
 * or superseded cannot be revived by a second approve call — the way back is a
 * new proposal, which means a new content hash or a new human. That is what
 * makes the arrow "approved BY A NAMED HUMAN" load-bearing rather than
 * decorative: there is no path to `registered` that does not pass through a
 * signature over THIS revision.
 */

export const LIFECYCLE_STATES = [
  "proposed",
  "approved",
  "registered",
  "rejected",
  "superseded",
  "retired",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === "string" && (LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 * Every legal edge, in one table. Exhaustive by type: a state added to
 * `LIFECYCLE_STATES` without an entry here fails to compile, so there is no
 * such thing as a state whose outgoing edges nobody decided.
 */
export const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = Object.freeze({
  proposed: Object.freeze(["approved", "rejected"]),
  approved: Object.freeze(["registered", "retired"]),
  registered: Object.freeze(["superseded", "retired"]),
  rejected: Object.freeze([]),
  superseded: Object.freeze([]),
  retired: Object.freeze([]),
}) as Readonly<Record<LifecycleState, readonly LifecycleState[]>>;

/** States from which nothing further happens. Derived, never a second list. */
export const TERMINAL_STATES: readonly LifecycleState[] = Object.freeze(
  LIFECYCLE_STATES.filter((s) => TRANSITIONS[s].length === 0),
);

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Whether this revision is the one a project may be pointed at. NOT stored on
 * the entry: Ph27 Pitfall 5 / contract §5 rule 2 — "Never cache a boolean" —
 * and a stored `reusable` flag is exactly the boolean that goes stale the
 * moment a newer revision is registered.
 */
export function isReusableState(state: LifecycleState): boolean {
  return state === "registered";
}
