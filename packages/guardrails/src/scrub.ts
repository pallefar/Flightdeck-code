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

import { PII_PATTERNS, STUDIO_PATTERNS } from "./lists";
import { escapeRegExpLiteral, initials } from "./findings";
import { nameHits } from "./names";

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
  /**
   * The lowest tier of FIELD-NAME hit that gets dropped key-and-value.
   * Default 4.
   *
   * It is a parameter rather than a constant because the caller's config
   * decides which tiers it is redacting at all, and dropping less than it
   * refuses would be incoherent: a gate configured to redact tier 3 that left
   * `person.surname` standing would then refuse its own redaction on the
   * re-scan, every time, and "redact" would silently mean "refuse".
   */
  readonly dropTier?: 3 | 4;
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
  // The host's patterns first, in the HOST'S ORDER — "email runs before
  // digits, otherwise a numeric local-part would be partly eaten and the
  // address would survive as a recognisable fragment". Then the
  // Studio-authored patterns, which are additive and cannot reorder the host's
  // five. A class this package can DETECT but not REDACT would make `redact`
  // mean less than `classify`, and `gateModelRequest` would refuse its own
  // redaction forever — so the two lists are the same list here as they are in
  // `classifyText`.
  for (const { re, placeholder } of [...PII_PATTERNS, ...STUDIO_PATTERNS]) {
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

function droppableName(rawPath: string, dropTier: 3 | 4): string | null {
  for (const hit of nameHits(rawPath)) {
    if (hit.tier >= dropTier) return hit.token;
  }
  return null;
}

/**
 * Drop by-name branches at or above `dropTier`, scrub every surviving string.
 * Pure: the input is not mutated.
 */
export function redactTree(input: unknown, opts: ScrubOptions = {}): RedactTreeResult {
  const dropTier = opts.dropTier ?? 4;
  const dropped = new Set<string>();

  const walk = (value: unknown, rawPath: string): unknown => {
    if (typeof value === "string") return scrub(value, { ...opts, truncate: opts.truncate ?? false });
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item, i) => walk(item, `${rawPath}[${i}]`));

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = rawPath === "" ? key : `${rawPath}.${key}`;
      const token = droppableName(childPath, dropTier);
      if (token !== null) {
        // Only the CLASS is recorded. Not the key, not the value.
        dropped.add(token);
        continue;
      }
      // ⚠ THE KEY GOES THROUGH THE SCRUBBER TOO. Redacting only values leaves
      // `{ "Erika Musterfrau": { … } }` fully intact, and the host has already
      // paid for this lesson once: `envelope.ts`'s closed key policy records
      // that a fact key "was a free-text channel straight to (1) the wire,
      // (2) the append-only hash-chained audit event, (3) the refusal
      // messages … and (4) the edge function's 400 bodies". A redactor that
      // hands back a payload keyed by a person's name has redacted nothing.
      // Caught by `__tests__/no-value-leak.test.ts`, not by review.
      let safeKey = scrub(key, { ...opts, truncate: false });
      if (safeKey !== key && Object.hasOwn(out, safeKey)) {
        // Two distinct keys can scrub to the same placeholder. Suffix rather
        // than silently drop one: losing a field is a correctness bug, and a
        // redactor that loses data quietly is one nobody will trust.
        let n = 2;
        while (Object.hasOwn(out, `${safeKey}#${n}`)) n += 1;
        safeKey = `${safeKey}#${n}`;
      }
      out[safeKey] = walk(child, childPath);
    }
    return out;
  };

  return { value: walk(input, ""), droppedClasses: [...dropped].sort() };
}
