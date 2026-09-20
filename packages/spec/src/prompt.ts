/**
 * Prompt construction for the intake model.
 *
 * The prompts are built from the same constants the schema validates against, so the
 * instructions can never drift from the rules. `EXAMPLE_DRAFT` is parsed by the draft schema
 * in the test suite - if the wire format changes, the example fails before a model sees it.
 *
 * The prompt asks for evidence and offers an explicit "I do not know" channel
 * (`clarifications`). It is still only a prompt: `gates` re-checks every claim it makes.
 */

import { CAPABILITIES, HOST_VERSION, NAV_SECTIONS, ROLES } from "./vocabulary";
import { truncate } from "./text";
import type { PlannerDraft } from "./draft";

export interface PromptInput {
  readonly prompt: string;
  /** Previously asked questions with the user's answers, oldest first. */
  readonly answers: readonly { readonly question: string; readonly answer: string }[];
  readonly existingSubAppIds: readonly string[];
  readonly hostVersion: string;
}

/** A complete, valid draft. Doubles as the few-shot example and as a wire-format test. */
export const EXAMPLE_DRAFT: PlannerDraft = {
  understanding: "List contracts whose works-council consultation date is missing, for HR reviewers.",
  blocked: null,
  clarifications: [],
  spec: {
    id: "works-council-gaps",
    label: "Works council gaps",
    icon: "🗓️",
    navSection: "Contract pipeline",
    purpose: "Flags contracts that have no works-council consultation date recorded.",
    visibleToRoles: { roles: ["hr_reviewer", "wc_liaison"], evidence: "for HR reviewers and the works council liaison" },
    capabilities: [{ capability: "read:contracts", evidence: "contracts missing a works-council date" }],
    routes: [
      {
        id: "list-gaps",
        method: "GET",
        path: "/gaps",
        summary: "Contracts with no works-council date",
        kind: "read",
        capabilities: ["read:contracts"],
      },
    ],
    tables: [
      {
        name: "gap_snapshot",
        purpose: "Last computed gap list, so the page loads without re-scanning.",
        columns: [
          { name: "contract_id", type: "text", nullable: false, pii: false },
          { name: "checked_at", type: "timestamptz", nullable: false, pii: false },
        ],
      },
    ],
    widgets: [],
    settingsPanel: null,
  },
};

export const EXAMPLE_DRAFT_JSON = JSON.stringify(EXAMPLE_DRAFT, null, 2);

const bullet = (values: readonly string[]): string => values.map((value) => `  - ${value}`).join("\n");

export function buildSystemPrompt(input: PromptInput): string {
  return `You turn one sentence from an HR or legal user into a draft sub-app spec for Flightdeck OS.
You are an intake clerk, not a designer: you write down what was asked and you flag what was not said.

THE HOST IS LITERAL. These strings are compared with ===; there is no sixth option and no synonyms.
navSection (exactly one):
${bullet(NAV_SECTIONS)}
capabilities (the only scopes that exist; [] is normal and common):
${bullet(CAPABILITIES)}
visibleToRoles (at least one, required):
${bullet(ROLES)}
minHostVersion must be <= ${input.hostVersion}.

THE THREE RULES YOU CANNOT BEND
1. Never propose a capability the user did not ask for. Every entry in "capabilities" carries
   "evidence": a verbatim quote from the user's own words that asks for it. A quote you cannot
   copy from their text is a fabricated consent - raise a clarification instead. The capabilities
   array is the consent screen a human signs.
2. Never guess a field. If the nav section, the audience, the name or the point of the app is not
   in the user's words, leave that field null and add one targeted clarification for it. A wrong
   guess boots the server down or shows HR data to the wrong role; an extra question costs seconds.
3. A sub-app proposes, it never mutates. There is no route kind that approves, advances, signs or
   resolves a step. If that is what was asked for, set "blocked" and stop.

WHAT YOU DO NOT DECIDE
Route prefix, web module id, nav path, env var and table prefixes are derived from the id by the
host. Do not emit them. Give table names without a prefix.

ROUTES
"kind" is "read" (reads host data) or "propose" (writes a proposal into the review inbox).
"propose" requires the write:inbox-proposal scope, so it requires evidence for it too.
Paths are lowercase segments below the route prefix, e.g. "/gaps" or "/gaps/:contractId".

REPLY FORMAT
Reply with one JSON object and nothing else - no prose, no code fence. Unknown keys are rejected.
Every field below must be present. Use null and [] rather than omitting a key.

${EXAMPLE_DRAFT_JSON}

"blocked" is null or {"rule": one of "propose-not-mutate" | "capability-escape" | "audit-hash" |
"sibling-import" | "out-of-scope", "evidence": quote, "explanation": one sentence}.
"clarifications" entries are {"field": one of "id" | "label" | "icon" | "navSection" | "purpose" |
"visibleToRoles" | "capabilities" | "routes" | "tables", "question": one sentence ending in "?",
"options": array of allowed answers or null}.`;
}

export function buildUserPrompt(input: PromptInput): string {
  const sections: string[] = [`USER REQUEST\n"""\n${input.prompt.trim()}\n"""`];

  if (input.answers.length > 0) {
    const answered = input.answers
      .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
      .join("\n\n");
    sections.push(
      `ANSWERS THE USER HAS ALREADY GIVEN (these count as their words - you may quote them as evidence)\n"""\n${answered}\n"""`,
    );
  }

  if (input.existingSubAppIds.length > 0) {
    sections.push(
      `IDS ALREADY TAKEN (an id is locked once shipped; pick a different one)\n${bullet(input.existingSubAppIds)}`,
    );
  }

  sections.push(
    "Draft the spec. Anything they did not say goes in clarifications, not in a guess. Reply with the JSON object only.",
  );

  return sections.join("\n\n");
}

/** One bounded repair round-trip: the model sees its own reply and exactly what was wrong. */
export function buildRepairPrompt(previousReply: string, issues: readonly string[]): string {
  return `Your previous reply did not fit the required JSON shape.

YOUR REPLY
"""
${truncate(previousReply, 4000)}
"""

PROBLEMS
${bullet(issues)}

Reply again with the corrected JSON object only. Do not add keys that were not in the format, and do
not invent values to satisfy a problem - if something is genuinely unknown, use null and add a
clarification.`;
}
