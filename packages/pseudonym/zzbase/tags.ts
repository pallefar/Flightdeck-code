/**
 * THE TAG SYNTAX. `<person:1>`, `<email:2>`, `<amount:3>`.
 *
 * One shape, three properties it has to have, and the reason it has each.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 1. IT EXTENDS THE HOST'S VOCABULARY RATHER THAN COMPETING WITH IT
 * ─────────────────────────────────────────────────────────────────────────
 * `envelope.ts` already writes `<email>`, `<iban>`, `<number>`, `<amount>`,
 * `<date>` — those are its `PII_PATTERNS[].placeholder` values. A tag is the
 * SAME word in the SAME brackets with `:n` appended, so anything downstream
 * that eyeballs a payload sees the vocabulary it already knows.
 *
 * Note `digits` -> `<number:n>`: the class names here are the host's
 * PLACEHOLDER words, not its pattern names, because the placeholder is what a
 * reader of a payload has seen before.
 *
 * Two classes are AUTHORED HERE and are not in the host:
 *   `person`   the host has no placeholder for a declared name — it reduces
 *              one to initials instead ("J. D."), which is lossy by design.
 *              A reversible sibling needs a placeholder, so there is one.
 *   `literal`  the collision escape. See property 3.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2. IT SURVIVES A MODEL ROUND TRIP
 * ─────────────────────────────────────────────────────────────────────────
 * A model does not echo its input; it rewrites prose. So every property below
 * is about what a rewrite does to a token.
 *
 *   ANGLE BRACKETS, NO SPACES. `<person:1>` reads as a template placeholder —
 *   the single most common "copy this verbatim" shape in anything a model has
 *   been trained on. It contains no whitespace, so a reflow or a line wrap
 *   cannot split it; wrapping happens at spaces.
 *
 *   NOT A WORD. There is no bare word for a model to translate. Asked for
 *   German output a model writes "Der Mitarbeiter <person:1> …" — the tag is
 *   punctuation-delimited and stays. A bare `PERSON_1` is a word-shaped token
 *   and gets translated, hyphenated, or wrapped in backticks.
 *
 *   ASCII, LOWERCASE, SHORT. No case for a model to fold that we cannot fold
 *   back (the class is matched case-insensitively against a CLOSED list), no
 *   plural inside the tag (a model writes "<person:1>s" — the `s` lands
 *   OUTSIDE the `>` and restoration leaves it alone), and at most 4 ordinal
 *   digits so nothing invites a thousands separator.
 *
 *   AND WE DO NOT TRUST ANY OF THAT. `detokenize` has an explicit recovery
 *   policy for the mangles that do happen — case, HTML entities, whitespace
 *   pushed inside the brackets — and reports every one of them. The syntax
 *   makes mangling rare; the report makes it visible; nothing guesses.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 3. IT IS COLLISION-PROOF AGAINST REAL INPUT TEXT
 * ─────────────────────────────────────────────────────────────────────────
 * The naive failure: source text already containing `<email>` (the host's own
 * lossy placeholder — extremely likely, since `redact()` produces it) or
 * `<person:1>` (a template, a bug report, a prompt about this very system).
 * On the way back those would be read as tags and "restored" to values that
 * were never there, or rejected as invented.
 *
 * The mechanism is that DETECTION AND RESTORATION USE THE SAME PREDICATE.
 * `TAG_CANDIDATE_RE` below is the widest shape `detokenize` will ever treat
 * as a tag. `tokenize` runs that exact regex over the RAW SOURCE first, before
 * anything else, and every hit is carried in the vault as a `<literal:n>`
 * entry that restores to the original characters.
 *
 * So the invariant is not "collisions are unlikely". It is: after the first
 * pass, the text contains no span matching `TAG_CANDIDATE_RE` that is not a
 * tag this package minted. There is no gap between the two definitions
 * because there is only one definition.
 *
 * (`onSourceTagShapedText: "refuse"` is available for callers who would
 * rather send nothing tag-shaped at all. It is not the default, because
 * refusing loses data that can be carried losslessly.)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 4. IT CARRIES NO INFORMATION ABOUT THE VALUE
 * ─────────────────────────────────────────────────────────────────────────
 * A tag is a class plus a counter. Not a length, not initials, not a hash
 * prefix, not a type-of-name hint. `<person:1>` is the same eleven characters
 * whether it stands for "Li" or for "Maximiliane von Habsburg-Lothringen".
 *
 * The ordinal is assigned by ORDER OF FIRST APPEARANCE in the document, never
 * derived from the value. That is deliberate in both directions:
 *   - order of appearance tells a reader nothing about the value;
 *   - a value-derived id (a hash) would be a STABLE pseudonym across
 *     documents, which is a worse privacy property than a per-document
 *     counter, not a better one. Two vaults built from the same person give
 *     different ordinals, on purpose.
 *
 * ⚠ STATED RESIDUAL: the SET of tags does disclose structure — how many
 * distinct values of each class a document holds, and the order they first
 * appear in. That is inherent in keeping identity at all (the entire reason a
 * vault exists rather than lossy redaction) and cannot be removed without
 * removing the feature. It is metadata about the document, not about a person.
 */

import { PII_PATTERNS } from "./host-mirror";

/** The closed tag vocabulary. Five transcribed from the host's placeholders,
 * two authored here. Closed because it is what makes a tag reportable: a
 * class in a log line is a compiled-in constant, never scanned data. */
export const TAG_CLASSES = ["email", "iban", "number", "amount", "date", "person", "literal"] as const;
export type TagClass = (typeof TAG_CLASSES)[number];

/** Host PII class name -> this package's tag class. The host's `digits` class
 * places `<number>`; the tag class is the placeholder word. Checked against
 * `PII_PATTERNS` at module load below, so a host rename cannot pass silently. */
export const HOST_CLASS_TO_TAG_CLASS: Readonly<Record<string, TagClass>> = {
  email: "email",
  iban: "iban",
  digits: "number",
  amount: "amount",
  date: "date",
};

/** Classes that stand for PERSONAL data. `literal` does not: it stands for
 * text the SOURCE already contained in tag shape, carried through unchanged.
 * `assessTier` keys its Recital 26 floor off this set. */
export const PERSONAL_TAG_CLASSES: ReadonlySet<TagClass> = new Set<TagClass>([
  "email",
  "iban",
  "number",
  "amount",
  "date",
  "person",
]);

/**
 * THE CEILING, AND WHY IT IS THIS NUMBER.
 *
 * 9999 keeps every ordinal to at most FOUR digits. The host's `digits` class
 * is `/\b\d[\d \/.-]{5,}\d\b/` — it needs SEVEN characters. So no tag this
 * package mints can ever trip the host's own residual scanner, which is the
 * gate `tokenize` has to pass in order to ship anything at all.
 *
 * ⛔ Raising this past 99999 would let a six-or-seven-digit ordinal match
 * `digits` and turn every large document into a refusal. It is a derived
 * bound, not a tuning knob. `__tests__/tags.test.ts` pins the derivation.
 */
export const MAX_VAULT_ENTRIES = 9_999;

/** What we MINT. Deliberately narrow: exactly the bytes this package writes.
 * No leading zeros, no whitespace, lowercase only. */
export const TAG_MINT_RE = new RegExp(`<(${TAG_CLASSES.join("|")}):([1-9][0-9]{0,3})>`, "g");

/**
 * What we will ever READ BACK as a tag — deliberately WIDER than what we mint,
 * and the single source of truth for "is this span tag-shaped?".
 *
 * Wider in exactly three ways, each one a mangle that real models produce:
 *   - the delimiters may be HTML-escaped (`&lt;` / `&gt;` / `&#60;` / `&#62;`
 *     / `&#x3c;`), which is what happens when a model emits markdown that a
 *     renderer escapes, or answers in HTML;
 *   - whitespace may appear inside the brackets, around the class, the colon
 *     or the ordinal;
 *   - the class may be in any case.
 *
 * It is ALSO wider in ways that are not recoveries but detections: the
 * ordinal may be absent (`<person>` — a model collapsing the tag back to the
 * host's lossy placeholder) or malformed (`<person:007>`, `<person:x>`). Those
 * match here so that `classifyTagCandidate` can REPORT them. Matching is not
 * accepting; nothing in this regex restores anything.
 *
 * The class alternation is the closed vocabulary, so ordinary markup (`<b>`,
 * `<div>`, `<br/>`) is not tag-shaped and is never touched.
 */
const OPEN = "(?:<|&lt;|&#60;|&#[xX]3[cC];)";
const CLOSE = "(?:>|&gt;|&#62;|&#[xX]3[eE];)";
export const TAG_CANDIDATE_RE = new RegExp(
  `${OPEN}\\s*(${TAG_CLASSES.join("|")})\\s*(?::\\s*([A-Za-z0-9_-]{1,8})\\s*)?${CLOSE}`,
  "gi",
);

/** Mint the canonical bytes for a class and ordinal. The ONLY place a tag is
 * constructed, so the mint shape has exactly one definition. */
export function mintTag(cls: TagClass, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > MAX_VAULT_ENTRIES) {
    throw new RangeError(`ordinal out of range: must be 1..${MAX_VAULT_ENTRIES}`);
  }
  return `<${cls}:${ordinal}>`;
}

/** U+FFFC OBJECT REPLACEMENT CHARACTER: one codepoint, neither letter nor
 * digit, so a masked tag cannot join with its neighbours to form a match in
 * any host pattern (all five need letters or digits). */
export const TAG_MASK = "\uFFFC";

/**
 * Replace every tag THIS PACKAGE MINTED with `TAG_MASK`.
 *
 * Used by the residual proof and by `assessTier` to scan the caller-supplied
 * region without the scan firing on this package's own compiled-in
 * vocabulary. It is safe ONLY because `tokenize` step 1 guarantees that no
 * other tag-shaped span survives, and that guarantee is asserted, not assumed.
 * It uses `TAG_MINT_RE` — the narrow shape — not `TAG_CANDIDATE_RE`, so no
 * mangled or invented tag in untrusted text can hide behind the mask.
 */
export function maskMintedTags(text: string): string {
  return text.replace(new RegExp(TAG_MINT_RE.source, TAG_MINT_RE.flags), TAG_MASK);
}

/** How a candidate deviated from the mint shape. Reported, never inferred
 * past this list. */
export type TagMangle = "case" | "html-entity" | "whitespace";

export type TagCandidateVerdict =
  /** Byte-identical to what we mint. */
  | { readonly kind: "canonical"; readonly cls: TagClass; readonly ordinal: number }
  /** Recoverable: the class and ordinal are unambiguous after undoing a
   * mangle from the closed list above. */
  | { readonly kind: "mangled"; readonly cls: TagClass; readonly ordinal: number; readonly mangles: readonly TagMangle[] }
  /** Tag-shaped, class known, but NO ordinal — the model collapsed it back to
   * the host's lossy placeholder. There is nothing to look up. */
  | { readonly kind: "degraded"; readonly cls: TagClass }
  /** Tag-shaped, class known, ordinal present but not a shape we mint
   * (`007`, `0`, `x`, `12345`). Recovering it would mean GUESSING which entry
   * was meant. We do not guess. */
  | { readonly kind: "malformed"; readonly cls: TagClass };

/**
 * Classify one `TAG_CANDIDATE_RE` match. Pure, total, and the only place the
 * recovery policy lives.
 *
 * ⚠ THE POLICY, STATED: a mangle is undone only when undoing it is a FUNCTION
 * — one input, one output, no choice. Case folds to lowercase against a
 * closed seven-member vocabulary. An HTML entity has one unescaped form.
 * Whitespace inside brackets is dropped. The ORDINAL'S DIGITS ARE NEVER
 * TOUCHED: `007` is not read as `7`, because "strip leading zeros" is a guess
 * about what the model meant, and a wrong guess restores one person's name
 * where another's belonged. That is the one failure mode this package must
 * never have, so the ambiguous cases are refusals with a name, not repairs.
 */
export function classifyTagCandidate(raw: string, cls: string, ordinal: string | undefined): TagCandidateVerdict {
  const lowered = cls.toLowerCase();
  // `TAG_CANDIDATE_RE`'s alternation is the vocabulary, so this always holds;
  // it is asserted rather than assumed because the cast below depends on it.
  if (!(TAG_CLASSES as readonly string[]).includes(lowered)) {
    throw new Error("classifyTagCandidate called with a class outside TAG_CLASSES");
  }
  const tagClass = lowered as TagClass;

  if (ordinal === undefined) return { kind: "degraded", cls: tagClass };
  if (!/^[1-9][0-9]{0,3}$/.test(ordinal)) return { kind: "malformed", cls: tagClass };

  const n = Number(ordinal);
  const canonical = mintTag(tagClass, n);
  if (raw === canonical) return { kind: "canonical", cls: tagClass, ordinal: n };

  const mangles: TagMangle[] = [];
  if (raw.includes("&")) mangles.push("html-entity");
  if (/\s/.test(raw)) mangles.push("whitespace");
  if (cls !== lowered) mangles.push("case");
  // A candidate that differs from canonical in no NAMED way cannot happen —
  // the regex admits exactly the three deviations above — but a future widening
  // of TAG_CANDIDATE_RE would land here, and an unnamed deviation must not be
  // silently accepted as a recovery.
  if (mangles.length === 0) return { kind: "malformed", cls: tagClass };
  return { kind: "mangled", cls: tagClass, ordinal: n, mangles };
}

/** Every tag-shaped span in `text`, with its offset. One pass; used by
 * `tokenize` for the collision sweep and by `detokenize` for restoration, so
 * both see exactly the same spans. */
export interface TagCandidateMatch {
  readonly raw: string;
  readonly index: number;
  readonly verdict: TagCandidateVerdict;
}

export function findTagCandidates(text: string): TagCandidateMatch[] {
  const re = new RegExp(TAG_CANDIDATE_RE.source, TAG_CANDIDATE_RE.flags);
  const out: TagCandidateMatch[] = [];
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const cls = m[1];
    if (cls === undefined) continue; // unreachable: group 1 is not optional
    out.push({ raw, index: m.index, verdict: classifyTagCandidate(raw, cls, m[2]) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Load-time checks on the transcription
// ─────────────────────────────────────────────────────────────────────────

/** The host's placeholders are `<name>`; a tag class is the word inside. If
 * the host renames a placeholder, this map is wrong and the whole "extends
 * the host's vocabulary" claim is wrong with it. `__tests__/divergence.test.ts`
 * is the real gate; this is the cheap one that fires at import time. */
for (const { name, placeholder } of PII_PATTERNS) {
  const mapped = HOST_CLASS_TO_TAG_CLASS[name];
  if (mapped === undefined) {
    throw new Error(`host PII class "${name}" has no tag class — HOST_CLASS_TO_TAG_CLASS is stale`);
  }
  if (placeholder !== `<${mapped}>`) {
    throw new Error(`host placeholder "${placeholder}" does not match tag class "${mapped}"`);
  }
}
