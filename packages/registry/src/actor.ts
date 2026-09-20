import { isNamedHuman } from "../../guardrails/src/approval-pure";

/**
 * WHO PROPOSED, AND WHO SIGNED — which must never be the same party.
 *
 * `boot.json` guardrail 4: "Security, access, and connector permissions require
 * explicit human approval." An approval a tool or an agent can mint is not an
 * approval, it is a formality, so the type system here refuses to call one an
 * approver: `namedHuman()` is the ONLY producer of a `NamedHuman`, and
 * `ApprovalSignature.approver` holds that type — a caller cannot skip a check it
 * has to perform to get the value it needs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ WHY THIS IS LOCAL AND NOT BORROWED FROM `packages/approvals`
 * ─────────────────────────────────────────────────────────────────────────
 * `packages/approvals/src/actor.ts` answers a NEIGHBOURING question and is, at
 * the time of writing, being reshaped around a directory-backed identity model
 * (`DirectoryEntry`, `namedHumanIdentity`, `identityDefect`, `sameSubject`):
 * there, "is this a named human" is a lookup against an org directory that can
 * also say `inactive`. That is the right model for a GRANT decision, which
 * happens at request time with a live directory to hand.
 *
 * A registry approval is a different moment. It records what a human signed,
 * possibly years before anyone reads it back, and the record must stay legible
 * after that person has left — so the name is CAPTURED INTO the signature
 * rather than resolved from a directory each time it is displayed. Depending on
 * a live lookup to render a historical fact would make an old approval
 * unreadable the day the account is deactivated.
 *
 * The two therefore stay separate on IDENTITY — this package captures a name
 * into a signature, `approvals` resolves one through a live directory.
 *
 * ⭐ THE NAME RULE ITSELF IS NOT SEPARATE, and used to be. `namedHuman` here
 * read `blank(actor.displayName)`: any non-blank string was a named human.
 * Measured against `guardrails`' `isNamedHuman`, 18 of 21 probes disagreed —
 * "system", "automation", "agent", "admin", "service", "bot", "anonymous",
 * "the approver" and a bare "x" all passed HERE and were refused THERE. That
 * was the THIRD copy of this rule in the repository and the weakest of the
 * three; `approvals` had already replaced its own with an import.
 *
 * It is imported now, and `__tests__/one-named-human-rule.test.ts` asserts
 * both that the two agree and that this file holds no local NON_NAMES list —
 * a copy that agrees today is a copy that can drift tomorrow. What stays
 * local is the directory question, not the spelling of a name. When `approvals`' directory surface settles, the
 * intended convergence is narrow and specific: a caller resolves a
 * `DirectoryEntry` through `identityDefect()` BEFORE calling `approve()`, and
 * passes the resulting person in as the `Actor` here. Directory liveness is a
 * precondition of signing; it is not a property of a signature.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * "SELF-APPROVAL" IS TWO DIFFERENT HOLES
 * ─────────────────────────────────────────────────────────────────────────
 * `isSelfApproval(approver, artifactId)` catches the approver whose subject id
 * IS the artifact's — the tool signing for itself, or an account minted to
 * carry a tool's name past a "must be human" check.
 *
 * `isSameActor(approver, proposedBy)` catches the other one, which no
 * comparison against the artifact id can see: the agent that generated the
 * artifact also recording the approval of it, or a person waving through their
 * own submission. One party, not two. Both are refused, with different reason
 * codes, because an operator reading the trail needs to know which happened.
 */

export const ACTOR_KINDS = ["human", "tool", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface Actor {
  readonly kind: ActorKind;
  /** Stable subject id. For a `tool` actor this is the tool/artifact id. */
  readonly id: string;
  /**
   * Required in practice for `human` — see `namedHuman`. Recorded ALONGSIDE
   * `id`, never instead of it: `id` is what the system matched, `displayName`
   * is who the organization thinks that is, and an audit trail six months later
   * needs both.
   */
  readonly displayName?: string | undefined;
}

export interface NamedHuman {
  readonly kind: "human";
  readonly id: string;
  readonly displayName: string;
}

const blank = (value: unknown): boolean => typeof value !== "string" || value.trim().length === 0;

export function isActorKind(value: unknown): value is ActorKind {
  return typeof value === "string" && (ACTOR_KINDS as readonly string[]).includes(value);
}

/** Well-formed enough to name in an audit entry, whatever kind it is. */
export function isActor(value: Actor | null | undefined): value is Actor {
  return !!value && typeof value === "object" && isActorKind(value.kind) && !blank(value.id);
}

/**
 * The ONLY producer of `NamedHuman`. Returns `null` for a tool, an agent, the
 * system, an anonymous human and an absent actor — every case guardrail 4 means
 * to exclude, in one place, so no caller can approximate it with
 * `kind === "human"` and forget the name.
 */
export function namedHuman(actor: Actor | null | undefined): NamedHuman | null {
  if (!isActor(actor)) return null;
  if (actor.kind !== "human") return null;
  // ⭐ THE ONE RULE, IMPORTED — this was the THIRD copy in the repository and
  // the weakest of the three.
  //
  // It read `blank(actor.displayName)`: any non-blank string was a named
  // human. Measured against `isNamedHuman`, 18 of 21 probes disagreed —
  // "system", "automation", "agent", "admin", "service", "bot", "anonymous",
  // "the approver" and a bare "x" all passed HERE and are refused THERE.
  //
  // That is not cosmetic in this package. The registry is what makes an
  // approved tool reusable by later projects, so an approval it accepts
  // travels: "approved by system" would have been a permanent, citable fact
  // about a tool every future project inherits.
  //
  // `packages/approvals` fixed the same divergence by importing this
  // function and checking BOTH fields; this now does the same, so there is
  // one NON_NAMES list in the repository and no way to approximate it.
  if (!isNamedHuman(actor.displayName)) return null;
  if (!isNamedHuman(actor.id)) return null;
  return Object.freeze({ kind: "human" as const, id: actor.id, displayName: actor.displayName as string });
}

/**
 * The approver's subject id IS the thing being approved. Compared
 * case-insensitively: an id casing difference is not a second person.
 */
export function isSelfApproval(approver: Actor, artifactId: string): boolean {
  return approver.id.trim().toLowerCase() === artifactId.trim().toLowerCase();
}

/**
 * Two references to the same party. Compared on `(kind, id)` — on kind as well,
 * because a person and a service account may legitimately share a name in two
 * different directories, and treating those as one party would refuse a
 * legitimate approval.
 */
export function isSameActor(a: Actor | null | undefined, b: Actor | null | undefined): boolean {
  if (!isActor(a) || !isActor(b)) return false;
  return a.kind === b.kind && a.id.trim().toLowerCase() === b.id.trim().toLowerCase();
}
