/**
 * Reading a JSON reply, with the truncation trap closed.
 *
 * ⛔ THE RULE THIS FILE EXISTS TO ENFORCE. A completion that stopped on the
 * token ceiling is a FRAGMENT. `JSON.parse` on a fragment either throws (noisy,
 * fine) or — far worse — succeeds, because the model happened to be inside a
 * complete sub-object when the ceiling hit, and the caller gets a plausible
 * object that is missing fields nobody will notice until production. So the
 * truncation check happens BEFORE the parse, and a truncated completion is
 * reported without its text ever being handed to a parser.
 */

import type { Completion } from "./types";

export type JsonRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string; readonly truncated: boolean };

export function readJson(completion: Completion): JsonRead {
  // Deliberately first, and deliberately not `&& looksLikeJson(text)`.
  if (completion.truncated) {
    return {
      ok: false,
      truncated: true,
      reason:
        `the reply was cut off at the token ceiling after ${completion.usage.outputTokens} output tokens, ` +
        "so it was not parsed — raise maxTokens or ask for less",
    };
  }

  if (completion.stopReason === "refusal") {
    return { ok: false, truncated: false, reason: "the provider refused the request" };
  }

  const text = completion.text.trim();
  if (text === "") {
    return { ok: false, truncated: false, reason: "the reply had no text content" };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      ok: false,
      truncated: false,
      reason: `the reply was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
