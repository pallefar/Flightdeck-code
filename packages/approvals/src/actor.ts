/**
 * Who is asking, and who signed off — which must never be the same kind of
 * thing.
 *
 * `boot.json` guardrail 4: "Security, access, and connector permissions require
 * explicit human approval." An approval that a tool or an agent can mint is not
 * an approval, it is a formality, so the type system here refuses to call one an
 * approver: `namedHuman()` is the only way to obtain a `NamedHuman`, and
 * `ApprovalRecord.approvedBy` is a plain `Actor` precisely so that the narrowing
 * has to happen — a caller cannot skip a check it has to perform to get the
 * value it needs.
 *
 * A DISPLAY NAME IS REQUIRED, NOT DECORATION. Guardrail 4 says "explicit human
 * approval", and an opaque subject id ("u_81f3") is not a named human to the
 * person reading the audit trail six months later. Both are recorded: `id` is
 * what the system matched, `displayName` is who the organization thinks that is.
 */

export const ACTOR_KINDS = ["human", "tool", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface Actor {
  readonly kind: ActorKind;
  /** Stable subject id. For a `tool` actor this is the tool id. */
  readonly id: string;
  /** Required in practice for `human` — see `namedHuman`. */
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
 * system, an anonymous human, or an absent actor — every case guardrail 4 means
 * to exclude, in one place, so no caller can approximate it with `kind ===
 * "human"` and forget the name.
 */
export function namedHuman(actor: Actor | null | undefined): NamedHuman | null {
  if (!isActor(actor)) return null;
  if (actor.kind !== "human") return null;
  if (blank(actor.displayName)) return null;
  return { kind: "human", id: actor.id, displayName: actor.displayName as string };
}

/**
 * Self-approval, in the only sense that survives contact with reality: the
 * approver's subject id IS the thing being approved. A tool that approves
 * itself, or a human account created to carry a tool's identity, both land here.
 * Compared case-insensitively because an id casing difference is not a second
 * person.
 */
export function isSelfApproval(approver: Actor, toolId: string): boolean {
  return approver.id.trim().toLowerCase() === toolId.trim().toLowerCase();
}
