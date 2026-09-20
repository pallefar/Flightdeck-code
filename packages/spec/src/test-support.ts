/**
 * Test-only helpers. Not exported from `index.ts` - nothing in the shipping surface depends
 * on them, and they must never be imported by codegen.
 */

import { draftSchema } from "./draft";
import type { PlannerDraft } from "./draft";
import type { PlannerCompletion, PlannerLlm, PlannerRequest } from "./planner";

/** Builds a valid draft from a partial body, filling the wire format's defaults. */
export function makeDraft(
  spec: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): PlannerDraft {
  return draftSchema.parse({ understanding: "A test draft.", spec, ...extras });
}

export interface FakeLlm {
  readonly llm: PlannerLlm;
  /** Every request the planner made, in order. */
  readonly calls: PlannerRequest[];
}

/**
 * Replies in order; the last reply repeats if the planner asks again. A reply may be a raw
 * string, a completion object (to simulate truncation), or an Error to throw.
 */
export function fakeLlm(...replies: (string | PlannerCompletion | Error | PlannerDraft)[]): FakeLlm {
  const calls: PlannerRequest[] = [];
  let index = 0;

  const llm: PlannerLlm = async (request) => {
    calls.push(request);
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply === undefined) {
      throw new Error("fakeLlm was called but no replies were configured");
    }
    if (reply instanceof Error) {
      throw reply;
    }
    if (typeof reply === "string") {
      return { text: reply };
    }
    if ("text" in reply) {
      return reply;
    }
    return { text: JSON.stringify(reply) };
  };

  return { llm, calls };
}
