/**
 * The host's redaction RECIPE, transcribed — and the one place Studio is
 * allowed to modify data rather than just judge it.
 *
 * `scrub()` is `redact()` from `flightdeck/server/services/ai/envelope.ts`,
 * minus the `Redacted` brand (a `unique symbol` declared and never exported
 * in the host module, so it is structurally unreachable from this checkout).
 * Order is the host's order and matters for the same reason it matters there:
 * declared names first, then `PII_PATTERNS` in array order (email before
 * digits), then truncation LAST — "scrubbing first means a redaction
 * placeholder can never be cut in half into something that reads like the
 * original."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY SCRUBBING A VALUE IS NOT ENOUGH, AND `redactTree` EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * `{ salary: 82000 }` survives `scrub()` completely intact. The host measured
 * this and wrote it down (`envelope.ts`, the count branch): "Measured against
 * this module's own PII_PATTERNS, 92000, 250000, 4200 and 49.87 all scan
 * clean". The disclosure there is the FIELD NAME plus a number, and no
 * value-level scrubber can see it.
 *
 * So redaction of a structure has two halves:
 *   - tier-4 field-name hits are DROPPED, key and value together — the key is
 *     half the disclosure, so blanking only the value leaves `{ salary: null }`
 *     which still says this record has a salary;
 *   - every remaining string goes through `scrub()`.
 *
 * And then the result is RE-CLASSIFIED by the caller. `gateModelRequest` never
 * trusts that redaction worked; it checks, exactly as `serializeAiRequest`
 * calls `assertNoResidualPii` after building the payload rather than assuming
 * `redact()` did its job.
 */

import { PII_PATTERNS } from "./lists";
import { escapeRegExpLiteral, initials } from "./findings";
import { nameHits } from "./classify";

/** Transcribed from `envelope.ts`. Included in the divergence test: a limit
 * that silently grows in one checkout and not the other is the same class of
 * bug as a list that does. */
export const MAX_TEXT_CHARS = 2000;

export interface ScrubOptions {
  readonly names?: readonly string[];
  /** Set false to keep full length — used when scrubbing a whole artifact file
   * rather than one AI text fact, where truncating would corrupt the file it
   * is trying to clean. */
  readonly truncate?: boolean;
}

export function scrub(raw: string, opts: ScrubOptions = {}): string {
  let out = raw;
  for (const name of opts.names ?? []) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue; // a one-char "name" would match everything
    out = out.replace(new RegExp(escapeRegExpLiteral(trimmed), "gi"), initials(trimmed));
    // Also mask each part on its own — a surname alone is still the person.
    for (const part of trimmed.split(/\s+/).filter((p) => p.length >= 3)) {
      out = out.replace(new RegExp(`\\b${escapeRegExpLiteral(part)}\\b`, "gi"), initials(part));
    }
  }
  for (const { re, placeholder } of PII_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), placeholder);
  }
  if ((opts.truncate ?? true) && out.length > MAX_TEXT_CHARS) out = out.slice(0, MAX_TEXT_CHARS);
  return out;
}

export interface RedactTreeResult {
  readonly value: unknown;
  /** Paths whose key AND value were removed entirely, reported through the
   * same sanitiser as any other path — dropping a field must not leak the
   * field's name back out in the report of having dropped it. */
  readonly droppedClasses: readonly string[];
}

function isTierFourName(rawPath: string): string | null {
  for (const hit of nameHits(rawPath)) {
    if (hit.tier === 4) return hit.token;
  }
  return null;
}

/**
 * Drop tier-4-by-name branches, scrub every surviving string. Pure: the input
 * is not mutated.
 */
export function redactTree(input: unknown, opts: ScrubOptions = {}): RedactTreeResult {
  const dropped = new Set<string>();

  const walk = (value: unknown, rawPath: string): unknown => {
    if (typeof value === "string") return scrub(value, { ...opts, truncate: opts.truncate ?? false });
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item, i) => walk(item, `${rawPath}[${i}]`));

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = rawPath === "" ? key : `${rawPath}.${key}`;
      const token = isTierFourName(childPath);
      if (token !== null) {
        // Only the CLASS is recorded. Not the key, not the value.
        dropped.add(token);
        continue;
      }
      out[key] = walk(child, childPath);
    }
    return out;
  };

  return { value: walk(input, ""), droppedClasses: [...dropped].sort() };
}
