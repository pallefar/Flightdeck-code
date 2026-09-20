/**
 * Small deterministic string helpers shared by the schema and the planner gates.
 *
 * Everything here is mechanical: a spelling normalization is allowed to run silently,
 * anything semantic has to become a question instead. Keep it that way.
 */

/** `Contract gap finder` -> `contract-gap-finder`. Mechanical, so safe to apply silently. */
export function slugify(raw: string, separator: "-" | "_" = "-"): string {
  const stripped = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator);
  const trimmed = separator === "-" ? stripped.replace(/^-+|-+$/g, "") : stripped.replace(/^_+|_+$/g, "");
  return separator === "-" ? trimmed.replace(/-{2,}/g, "-") : trimmed.replace(/_{2,}/g, "_");
}

/** Table/column identifiers: `Works council date` -> `works_council_date`. */
export const snakeify = (raw: string): string => slugify(raw, "_");

/**
 * Normalizes text for evidence matching: case-folded, punctuation flattened, whitespace
 * collapsed. Used to check that a quote the model attributes to the user is really in the
 * user's words - the difference between consent and a fabricated citation.
 */
export function normalizeForMatch(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Shortest quote we will accept as evidence; below this it matches everything. */
export const MIN_EVIDENCE_CHARS = 8;

/**
 * True when `quote` really occurs in one of the consent sources (the original prompt and
 * any answers the user gave to earlier clarifying questions).
 */
export function quoteIsGrounded(quote: string, sources: readonly string[]): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length < MIN_EVIDENCE_CHARS) {
    return false;
  }
  return sources.some((source) => normalizeForMatch(source).includes(needle));
}

export function truncate(raw: string, max: number): string {
  return raw.length <= max ? raw : `${raw.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * An icon is "an emoji in practice" (contract §2). We accept a short pictographic string
 * and reject prose, so `icon: "contract"` never reaches the manifest.
 */
export function isLikelyEmoji(value: string): boolean {
  if (value.length === 0 || [...value].length > 6) {
    return false;
  }
  if (/[A-Za-z]/.test(value)) {
    return false;
  }
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value);
}

/** `checkout.flow.title` looks like an i18n key; the host renders `label` verbatim. */
export function looksLikeI18nKey(value: string): boolean {
  return /^[a-z0-9]+(?:[._][a-z0-9]+)+$/.test(value.trim());
}

/** A single, targeted question ends in a question mark - enforced so prompts stay askable. */
export const endsWithQuestionMark = (value: string): boolean => value.trim().endsWith("?");
