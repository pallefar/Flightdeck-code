/**
 * Who is asking, and who signed off — which must never be the same kind of
 * thing, AND MUST NEVER BE THE THING THAT SAYS SO.
 *
 * `boot.json` guardrail 4: "Security, access, and connector permissions require
 * explicit human approval." An approval that a tool or an agent can mint is not
 * an approval, it is a formality.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED, AND WHY THE OLD SHAPE WAS NOT A CONTROL
 * ─────────────────────────────────────────────────────────────────────────
 * This file used to derive "is this a named human" from the stored row itself:
 * `record.approvedBy.kind === "human"` plus a non-blank `displayName`. Both
 * fields are written by whoever writes the row, so the row declared its own
 * eligibility. `{kind:"human", id:"svc-ci-runner", displayName:"CI Runner
 * (service)"}` passed, and so did `{kind:"human", id:"system"}`. That is the
 * same defect class as a caller-declared data tier: a control anchored on an
 * ASSERTION about a fact the system can look up for itself.
 *
 * So `kind` and `displayName` are now RESOLVED, through `IdentityDirectory`
 * (`./directory.ts`), from the subject id — the one field on the row that is a
 * reference to something outside it. A row may still SAY `kind: "human"`;
 * nothing reads it. `DirectoryEntry` is the only place a kind is believed, and
 * `namedHumanIdentity()` is the only producer of `NamedHuman`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AND THERE IS NOW ONE DEFINITION OF "A NAME", NOT TWO
 * ─────────────────────────────────────────────────────────────────────────
 * `packages/guardrails/src/approval.ts` already had one — `isNamedHuman()`,
 * with the `NON_NAMES` denylist ("system", "automation", "agent", "studio",
 * "admin", "unknown", "the approver", …). This package had a second, weaker
 * one: "a non-blank string". The two disagreed on all seven of those names,
 * and which gate a caller happened to route through decided the answer — the
 * host's "never a second, divergent eligibility query" defect, in one repo.
 *
 * The weaker one is DELETED. The rule below imports guardrails' and applies it
 * to the resolved display name AND to the subject id, so there is exactly one
 * `NON_NAMES` list in the repository and exactly one function that consults it.
 */

import { isNamedHuman } from "../../guardrails/src/approval";

export const ACTOR_KINDS = ["human", "tool", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface Actor {
  readonly kind: ActorKind;
  /** Stable subject id. For a `tool` actor this is the tool id. */
  readonly id: string;
  /**
   * ⛔ DESCRIPTIVE ONLY, AND NOT READ BY ANY DECISION. Kept on the type so an
   * existing row still parses and so a UI has something to render before the
   * directory answers. Every authorization question about an actor goes
   * through `IdentityDirectory` instead — see the header.
   */
  readonly displayName?: string | undefined;
}

/**
 * What the directory says about a subject id. The AUTHORITY on `kind` and
 * `displayName`; the stored row is the authority on neither.
 *
 * `active` is separate from existence because a departed employee's id does not
 * vanish from an audit trail — their signature stays readable, and it stops
 * being usable. Deleting the entry would make an old approval unexplainable;
 * marking it inactive makes it unusable AND explainable.
 */
export interface DirectoryEntry {
  readonly id: string;
  readonly kind: ActorKind;
  readonly displayName: string;
  readonly active: boolean;
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

export function isDirectoryEntry(value: DirectoryEntry | null | undefined): value is DirectoryEntry {
  return (
    !!value &&
    typeof value === "object" &&
    isActorKind(value.kind) &&
    !blank(value.id) &&
    typeof value.displayName === "string" &&
    typeof value.active === "boolean"
  );
}

/**
 * Why a resolved identity is not usable as an approver. A code, not a boolean,
 * because "we have never heard of this subject" and "this person has left" send
 * an operator to two different places.
 */
export type IdentityDefect = "unknown" | "not-human" | "inactive" | "unnamed";

/**
 * The ONLY producer of `NamedHuman`, and it takes a `DirectoryEntry` — never an
 * `Actor`. That parameter type is the control: there is no overload, no
 * fallback and no second entry point that accepts a self-described actor, so a
 * caller that has not consulted the directory has nothing to pass.
 */
export function namedHumanIdentity(entry: DirectoryEntry | null | undefined): NamedHuman | null {
  return identityDefect(entry) === null && entry
    ? { kind: "human", id: entry.id, displayName: entry.displayName }
    : null;
}

/** The same question, answering WHY rather than WHETHER. One implementation. */
export function identityDefect(entry: DirectoryEntry | null | undefined): IdentityDefect | null {
  if (!isDirectoryEntry(entry)) return "unknown";
  if (entry.kind !== "human") return "not-human";
  if (!entry.active) return "inactive";
  // ONE definition of "a name", imported from guardrails. Applied to the id as
  // well as to the display name: an account called `system` with a display name
  // of "System Operator" is still the system.
  if (!isNamedHuman(entry.displayName)) return "unnamed";
  if (!isNamedHuman(entry.id)) return "unnamed";
  return null;
}

/**
 * Self-approval, in the only sense that survives contact with reality: the
 * approver's subject id IS the thing being approved. A tool that approves
 * itself, or a human account created to carry a tool's identity, both land here.
 * Compared case-insensitively because an id casing difference is not a second
 * person.
 */
export function isSelfApproval(approverId: string, toolId: string): boolean {
  return sameSubject(approverId, toolId);
}

/**
 * FOUR EYES. The requester and the approver must be two subjects.
 *
 * The old code compared the approver only to the TOOL, so an agent could ask
 * and the same subject id could sign, and nothing in the package called that a
 * defect. Guardrail 4 asks for "explicit human approval" of an action; an
 * approval by the party that wants the action is a signature on its own
 * request.
 */
export function sameSubject(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
