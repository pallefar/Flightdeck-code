/**
 * `planFromPrompt` - one natural-language goal in, one outcome out.
 *
 * The model call is a parameter, not an import. The function is otherwise deterministic:
 * no clock, no network, no module state, no `process.env`. That is what makes the consent
 * rules in `gates` testable, and it is also the only way this can be exercised in CI.
 *
 * Shape of the run:
 *
 *   prompt -> (too thin? ask, without spending a call)
 *          -> model draft -> JSON extraction -> strict wire-format parse
 *          -> one bounded repair round-trip if the model broke its own format
 *          -> deterministic gates -> planned | needs_input | blocked | invalid_draft
 *
 * Note what is *not* here: no partial spec is ever returned. Codegen either gets a spec that
 * satisfies the manifest contract or it gets nothing and the user gets a question.
 */

import { HOST_VERSION } from "./vocabulary";
import { truncate } from "./text";
import { extractJsonObject } from "./json";
import { draftSchema } from "./draft";
import { formatIssues } from "./schema";
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt";
import { DEFAULT_APP_VERSION, evaluateDraft } from "./gates";
import type { GateContext } from "./gates";
import { missingFieldQuestion } from "./questions";
import type { ClarifyingQuestion } from "./questions";
import type { PlanOutcome } from "./outcome";

export interface PlannerRequest {
  readonly system: string;
  readonly user: string;
  readonly purpose: "draft" | "repair";
  /** 1-based; a caller can raise temperature or swap models on a retry. */
  readonly attempt: number;
}

export interface PlannerCompletion {
  readonly text: string;
  /** Set when the provider stopped on a token limit - the JSON is unusable, retry is pointless without it. */
  readonly truncated?: boolean;
}

/** The injected boundary. Anything async that returns text can play this part. */
export type PlannerLlm = (request: PlannerRequest) => Promise<PlannerCompletion>;

export interface PlanInput {
  readonly prompt: string;
  /** Answers to questions from an earlier `needs_input`, keyed by question id. */
  readonly answers?: Readonly<Record<string, string>>;
  /** The questions those answers belong to, so the model sees the exchange in context. */
  readonly askedQuestions?: readonly ClarifyingQuestion[];
  readonly existingSubAppIds?: readonly string[];
  readonly hostVersion?: string;
  readonly appVersion?: string;
  /** Total model calls allowed, including the repair round-trip. Default 2. */
  readonly maxAttempts?: number;
}

/** Below this, there is nothing to plan from and no point spending a model call. */
export const MIN_PROMPT_WORDS = 3;

function pairAnswers(
  answers: Readonly<Record<string, string>>,
  asked: readonly ClarifyingQuestion[],
): { question: string; answer: string }[] {
  const byId = new Map(asked.map((question) => [question.id, question.question]));
  return Object.entries(answers)
    .filter(([, answer]) => typeof answer === "string" && answer.trim() !== "")
    .map(([id, answer]) => ({ question: byId.get(id) ?? id, answer: answer.trim() }));
}

export async function planFromPrompt(input: PlanInput, llm: PlannerLlm): Promise<PlanOutcome> {
  const prompt = input.prompt.trim();
  const answers = input.answers ?? {};
  const asked = input.askedQuestions ?? [];
  const existingSubAppIds = input.existingSubAppIds ?? [];
  const hostVersion = input.hostVersion ?? HOST_VERSION;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2);

  if (prompt.split(/\s+/).filter(Boolean).length < MIN_PROMPT_WORDS) {
    return {
      status: "needs_input",
      understanding: "",
      warnings: [],
      draft: draftSchema.parse({ understanding: "", spec: {} }),
      questions: [
        missingFieldQuestion(
          "purpose",
          "What should this mini app do, in one sentence - what should it show, and to whom?",
          "failLoud",
        ),
      ],
    };
  }

  const promptInput = { prompt, answers: pairAnswers(answers, asked), existingSubAppIds, hostVersion };
  const system = buildSystemPrompt(promptInput);
  const context: GateContext = {
    prompt,
    answers,
    existingSubAppIds,
    hostVersion,
    appVersion: input.appVersion ?? DEFAULT_APP_VERSION,
  };

  let lastRaw: string | null = null;
  let issues: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const user =
      attempt === 1 || lastRaw === null ? buildUserPrompt(promptInput) : buildRepairPrompt(lastRaw, issues);

    let completion: PlannerCompletion;
    try {
      completion = await llm({ system, user, purpose: attempt === 1 ? "draft" : "repair", attempt });
    } catch (error) {
      issues = [`the planner model call failed: ${error instanceof Error ? error.message : String(error)}`];
      continue;
    }

    lastRaw = completion.text;

    if (completion.truncated === true) {
      issues = ["the reply was cut off before the JSON object was complete"];
      continue;
    }

    const extracted = extractJsonObject(completion.text);
    if (!extracted.ok) {
      issues = [extracted.reason];
      continue;
    }

    const parsed = draftSchema.safeParse(extracted.value);
    if (!parsed.success) {
      issues = formatIssues(parsed.error);
      continue;
    }

    return evaluateDraft(parsed.data, context);
  }

  return {
    status: "invalid_draft",
    issues,
    raw: lastRaw === null ? null : truncate(lastRaw, 2000),
    attempts: maxAttempts,
  };
}
