/**
 * Clarifying questions - what intake returns instead of a guess.
 *
 * A question is targeted: it names one field, says why Studio may not decide it, and
 * offers the closed set of answers when the field has one. It carries a stable `id` so the
 * caller can round-trip an answer back into `planFromPrompt({ answers })`.
 */

import { CAPABILITIES, CONTRACT_RULES, NAV_SECTIONS, ROLES } from "./vocabulary";
import type { Capability, ContractRule, NavSection, Role } from "./vocabulary";

export const QUESTION_SEVERITIES = ["consent", "required", "ambiguity"] as const;
export type QuestionSeverity = (typeof QUESTION_SEVERITIES)[number];

export type SpecField =
  | "id"
  | "label"
  | "icon"
  | "navSection"
  | "purpose"
  | "visibleToRoles"
  | "capabilities"
  | "routes"
  | "tables";

export interface ClarifyingQuestion {
  /** Stable key; answer with `answers[id] = "..."` on the next call. */
  readonly id: string;
  readonly field: SpecField;
  readonly severity: QuestionSeverity;
  /** One sentence, ending in a question mark. */
  readonly question: string;
  /** Why Studio will not decide this itself, quoting the contract. */
  readonly because: string;
  /** Closed answer set when the field is an enum, otherwise null (free text). */
  readonly options: readonly string[] | null;
}

const rule = (key: ContractRule): string => CONTRACT_RULES[key];

/** The answer key for a capability consent question. Exported so callers can build answers. */
export const consentQuestionId = (capability: string): string => `consent:${capability}`;

export function capabilityConsentQuestion(capability: Capability, trigger: string): ClarifyingQuestion {
  const what =
    capability === "read:contracts"
      ? "read contract records from the host"
      : "write proposals into the review inbox";
  return {
    id: consentQuestionId(capability),
    field: "capabilities",
    severity: "consent",
    question: `${trigger} May this mini app hold "${capability}" so it can ${what}?`,
    because: rule("leastPrivilege"),
    options: ["yes", "no"],
  };
}

export function unknownCapabilityQuestion(raw: string): ClarifyingQuestion {
  return {
    id: `capabilities:unknown:${raw}`,
    field: "capabilities",
    severity: "consent",
    question: `"${raw}" is not a scope this host grants - which of the two real scopes does this mini app need, if any?`,
    because: rule("leastPrivilege"),
    options: [...CAPABILITIES, "none"],
  };
}

export function navSectionQuestion(raw: string | null): ClarifyingQuestion {
  const lead =
    raw === null
      ? "Which nav section should this mini app live in"
      : `"${raw}" is not one of the host's nav sections - which one should it live in`;
  return {
    id: "navSection",
    field: "navSection",
    severity: raw === null ? "required" : "ambiguity",
    question: `${lead}?`,
    because: rule("navSectionExact"),
    options: NAV_SECTIONS,
  };
}

export function rolesQuestion(raw: readonly string[] = []): ClarifyingQuestion {
  const unknown = raw.filter((value) => !(ROLES as readonly string[]).includes(value));
  const lead =
    unknown.length > 0
      ? `${unknown.map((value) => `"${value}"`).join(", ")} ${unknown.length === 1 ? "is not a role" : "are not roles"} this host knows - who should see this mini app`
      : "Who should see this mini app";
  return {
    id: "visibleToRoles",
    field: "visibleToRoles",
    severity: "required",
    question: `${lead}?`,
    because: rule("rolesRequired"),
    options: ROLES,
  };
}

export function missingFieldQuestion(
  field: SpecField,
  question: string,
  because: ContractRule,
): ClarifyingQuestion {
  return { id: field, field, severity: "required", question, because: rule(because), options: null };
}

export function idCollisionQuestion(id: string): ClarifyingQuestion {
  return {
    id: "id:collision",
    field: "id",
    severity: "required",
    question: `A sub-app with the id "${id}" already exists - what should this one be called instead?`,
    because: rule("idLocked"),
    options: null,
  };
}

/** A question the planner model raised itself, kept only if it names a real field. */
export function modelRaisedQuestion(
  field: SpecField,
  question: string,
  options: readonly string[] | null,
): ClarifyingQuestion {
  const text = question.trim();
  return {
    id: `ask:${field}:${text.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    field,
    severity: "ambiguity",
    question: text.endsWith("?") ? text : `${text}?`,
    because: rule("failLoud"),
    options,
  };
}

const severityRank: Record<QuestionSeverity, number> = { consent: 0, required: 1, ambiguity: 2 };

/**
 * De-duplicates by id (first wins) and orders consent first, then missing required fields,
 * then ambiguities - so a UI asks the consent question before anything cosmetic.
 */
export function orderQuestions(questions: readonly ClarifyingQuestion[]): ClarifyingQuestion[] {
  const byId = new Map<string, ClarifyingQuestion>();
  for (const question of questions) {
    if (!byId.has(question.id)) {
      byId.set(question.id, question);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity];
    return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id);
  });
}

export type { Capability, NavSection, Role };
