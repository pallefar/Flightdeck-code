/**
 * Who proposed, and who signed — the second of this package's three borrowing
 * leaves (see `identity.ts` for why they are leaves).
 *
 * `packages/approvals/src/actor.ts` already encodes `boot.json` guardrail 4 in
 * the only way that survives contact with a type checker: `namedHuman()` is the
 * ONLY producer of a `NamedHuman`, and it returns `null` for a tool, an agent,
 * the system and an anonymous human. Re-deciding "what is a human" here would
 * give this repo two answers to a security question, so this file adds none.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DOES ADD: THE SECOND HALF OF "NOTHING SELF-APPROVES"
 * ─────────────────────────────────────────────────────────────────────────
 * `isSelfApproval(approver, toolId)` catches the tool signing for itself — an
 * agent whose subject id IS the artifact's. That is the case approvals needed,
 * because a grant is asked for BY a tool.
 *
 * A registry proposal has a second party approvals does not model: a PROPOSER.
 * The lifecycle this package exists for is
 *
 *     proposed -> approved (BY A NAMED HUMAN) -> registered -> reusable
 *
 * and the interesting attack is not a tool with a clever id, it is the same
 * actor occupying both ends of the arrow: the agent that generated the
 * mini-app also recording the approval of it, or a human waving through their
 * own submission. Both are "self-approval" in the sense that matters — one
 * party, not two — and neither is caught by comparing against the ARTIFACT id.
 * So `isSameActor` exists, `approverDefect` uses it, and the refusal has its
 * own reason code rather than being folded into the tool case: an operator
 * reading an audit trail needs to know WHICH of the two happened.
 */

export { ACTOR_KINDS, isActor, isActorKind, isSelfApproval, namedHuman } from "../../approvals/src/actor";
export type { Actor, ActorKind, NamedHuman } from "../../approvals/src/actor";

import { isActor, type Actor } from "../../approvals/src/actor";

/**
 * Two references to the same party. Compared on `(kind, id)` case-insensitively
 * because an id casing difference is not a second person — the same reasoning
 * `isSelfApproval` gives — and on kind as well because a human account and a
 * service account may legitimately share a name in two different directories.
 */
export function isSameActor(a: Actor | null | undefined, b: Actor | null | undefined): boolean {
  if (!isActor(a) || !isActor(b)) return false;
  return a.kind === b.kind && a.id.trim().toLowerCase() === b.id.trim().toLowerCase();
}
