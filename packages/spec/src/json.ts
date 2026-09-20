/**
 * Pulling one JSON object out of a model reply.
 *
 * Models wrap JSON in prose, in ```json fences, or emit a prelude before the object. A
 * regex like /\{[\s\S]*\}/ mis-parses any reply containing a brace inside a string, so this
 * scans with a real depth counter that understands strings and escapes. Failure is a typed
 * result, never a throw: the planner turns it into a repair round-trip.
 */

export type JsonExtraction =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** Strips leading/trailing markdown fences if the whole reply is one fenced block. */
function stripFences(raw: string): string {
  const fenced = /^\s*```(?:json|jsonc|json5)?\s*\n([\s\S]*?)\n?\s*```\s*$/i.exec(raw);
  return fenced?.[1] ?? raw;
}

/** Index range of the first balanced `{...}` object, ignoring braces inside strings. */
function findObjectSpan(text: string): readonly [number, number] | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return [start, i + 1] as const;
      }
      if (depth < 0) {
        return null;
      }
    }
  }
  return null;
}

export function extractJsonObject(raw: string): JsonExtraction {
  const text = stripFences(raw.replace(/^﻿/, "")).trim();
  if (text.length === 0) {
    return { ok: false, reason: "the model returned an empty reply" };
  }

  const span = findObjectSpan(text);
  if (!span) {
    return { ok: false, reason: "no balanced JSON object found in the reply" };
  }

  const [start, end] = span;
  try {
    const value: unknown = JSON.parse(text.slice(start, end));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, reason: "the reply parsed to something other than a JSON object" };
    }
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the JSON object in the reply did not parse: ${message}` };
  }
}
