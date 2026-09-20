/**
 * THE MATCHING LAYER — one implementation of "does this text carry a denied
 * name, a denied value shape, or a person".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AS A FILE
 * ─────────────────────────────────────────────────────────────────────────
 * It used to live inside `classify.ts`, and `markdown.ts` imported it from
 * there. That import direction is what made the hole this round is about
 * possible to write without noticing: `classify.ts` owned the vocabulary AND
 * decided where to apply it, and it applied it to object KEYS only, while
 * `markdown.ts` — reading the same bytes — applied it to everything. Same
 * lists, same functions, two different answers, and nothing in either file
 * said which one was the scanner.
 *
 * So the vocabulary, the matching and the decoding now sit below both. There
 * is one `nameHits`, one `classifyText`, one set of decoders, and the callers
 * above differ only in WHAT they hand down, never in what the answer means.
 * `__tests__/representation.test.ts` asserts that as a property: the same
 * record, as an object / as a JSON string / as markdown / as code, classifies
 * to the same tier.
 */

import {
  ALL_VALUE_PATTERNS,
  BUSINESS_SEGMENTS,
  PERSON_REFERENT_TOKENS,
  PII_DENIED_SEGMENTS,
  PII_DENIED_SUBSTRINGS,
  PROSE_AMBIGUOUS_TOKENS,
  SPECIAL_CATEGORY_SEGMENTS,
  SPECIAL_CATEGORY_SUBSTRINGS,
  STUDIO_PERSONAL_TOKENS,
  STUDIO_RESTRICTED_SUBSTRINGS,
  STUDIO_RESTRICTED_TOKENS,
  foldToken,
  normalizeToken,
  splitTokens,
} from "./lists";
import type { Finding } from "./findings";

/**
 * Keys that are metadata ABOUT a field rather than a field. Only tokens that
 * actually collide with the host's segment list belong here, which today is
 * exactly one: `name`.
 *
 * ⚠ The suppression is narrow on purpose. It drops only the tier-3 SEGMENT
 * hit produced by the metakey itself. A tier-4 substring hit is never
 * suppressed (`salaryName` still reports `salary`), and the value under the
 * metakey is scanned in its place — so `{ name: "salaryEur" }` is tier 4, by
 * the value, which is where the disclosure actually is.
 *
 * ⚠ STATED RESIDUAL: `{ name: "Erika Musterfrau" }` in a schema is detected
 * only by `looksLikePersonName` below, which is a shape heuristic and not a
 * decision procedure. The reliable cover for the known case is still
 * `declaredNames`, the same bargain the host strikes in `redact({ names })`.
 */
export const SCHEMA_METAKEYS: readonly string[] = ["name"];

/** A string value shaped like a field reference: `salaryEur`,
 * `employee.salary_eur`, `rows[0].iban`. Anything with a space, or starting
 * with a digit, is prose or data and is not read as a field name. */
const FIELD_POINTER = /^[A-Za-z_$][A-Za-z0-9_$.[\]-]{0,63}$/;

/** Exported for the code scanner, which asks the same question of a string
 * LITERAL it finds in emitted source. One definition, so "what counts as a
 * field reference" cannot mean two things. */
export function looksLikeFieldPointer(value: string): boolean {
  return FIELD_POINTER.test(value.normalize("NFKC"));
}

/**
 * A short multi-word phrase that could be a column heading rather than a
 * sentence — `employee salary`, `Date of birth`, `Bank details`.
 *
 * This exists because `looksLikeFieldPointer` rejects anything with a space,
 * and a one-character change therefore defeated the code scanner:
 * `"employeeSalary"` was caught and `"employee salary"` was not. A field name
 * with a space in it is a field name; the space is a spelling.
 *
 * The bound is four words and no sentence punctuation, and matching against a
 * phrase additionally skips `PROSE_AMBIGUOUS_TOKENS` — see `nameHits`.
 */
const LABEL_PHRASE = /^[A-Za-z][A-Za-z0-9]*(?:[ _-][A-Za-z0-9]+){1,3}$/;

export function looksLikeLabelPhrase(value: string): boolean {
  const t = value.normalize("NFKC").trim();
  return t.length <= 48 && LABEL_PHRASE.test(t);
}

export interface NameHit {
  readonly token: string;
  readonly tier: 2 | 3 | 4;
  readonly via: "field-name" | "special-category";
}

export interface NameHitOptions {
  /**
   * The text is a free-text PHRASE (a multi-word string literal), not an
   * identifier. Tokens that are also ordinary words of prose are skipped —
   * otherwise `"Please address this"` refuses as hard as `homeAddress`, and
   * `markdown.ts` has the full argument for why that makes a gate useless.
   */
  readonly phrase?: boolean;
}

/**
 * Every denylist token in `path`, not just the first.
 *
 * The host's `deniedPiiField` returns the FIRST offending token because it
 * only needs to name a reason for one rejection. A classifier needs all of
 * them: `person.salary` is tier 4 for `salary` and tier 3 for `person`, and a
 * refusal that mentions only one of those under-reports what was exposed.
 * `deniedPiiField` below preserves the host's exact first-token behaviour for
 * parity checking; this is the superset.
 *
 * Three vocabularies, three scopes, and the scopes are the argument:
 *   - host SUBSTRINGS  → the whole folded path. The host's own rule.
 *   - host SEGMENTS    → whole path segments. The host's own rule, kept
 *     exactly: widening `name` to `tableName` puts every spec in the approval
 *     queue, which is the "fires on everything" failure.
 *   - Studio TOKENS    → whole WORD tokens, camelCase included. A generic
 *     word like `age` has no safe home in either host scope; see
 *     `splitTokens`.
 */
export function nameHits(path: string, options: NameHitOptions = {}): NameHit[] {
  const hits: NameHit[] = [];
  const whole = foldToken(path);
  // Split on path separators too, not just object-path punctuation. The host's
  // `deniedPiiField` only ever sees a widget field pointer, so `.` and `[]`
  // are all it needs; `nameHits` also judges FILE paths for
  // `gateGeneratedArtifacts`, and without `/` a segment rule could never fire
  // on `data/person/name.json` — the exact-segment tier would be dead for
  // every artifact path. Additive: a field pointer never contains a slash.
  const segments = path
    .split(/[.[\]/\\]+/)
    .filter(Boolean)
    .map(foldToken)
    .filter(Boolean);
  const tokens = new Set(splitTokens(path));
  const skip = (token: string): boolean =>
    options.phrase === true && PROSE_AMBIGUOUS_TOKENS.includes(token);

  for (const bad of SPECIAL_CATEGORY_SUBSTRINGS) {
    if (whole.includes(bad)) hits.push({ token: bad, tier: 4, via: "special-category" });
  }
  for (const bad of SPECIAL_CATEGORY_SEGMENTS) {
    if (segments.includes(bad)) hits.push({ token: bad, tier: 4, via: "special-category" });
  }
  for (const bad of PII_DENIED_SUBSTRINGS) {
    if (whole.includes(bad) && !skip(bad)) hits.push({ token: bad, tier: 4, via: "field-name" });
  }
  for (const bad of STUDIO_RESTRICTED_SUBSTRINGS) {
    if (whole.includes(bad) && !skip(bad)) hits.push({ token: bad, tier: 4, via: "field-name" });
  }
  for (const bad of STUDIO_RESTRICTED_TOKENS) {
    if (tokens.has(bad) && !skip(bad)) hits.push({ token: bad, tier: 4, via: "field-name" });
  }
  for (const bad of PII_DENIED_SEGMENTS) {
    if (segments.includes(bad)) hits.push({ token: bad, tier: 3, via: "field-name" });
  }
  for (const bad of STUDIO_PERSONAL_TOKENS) {
    if (tokens.has(bad) && !skip(bad)) hits.push({ token: bad, tier: 3, via: "field-name" });
  }
  for (const bad of BUSINESS_SEGMENTS) {
    if (segments.includes(bad)) hits.push({ token: bad, tier: 2, via: "field-name" });
  }
  return hits;
}

/** True when this path segment REFERS TO a person without naming one. Only
 * ever acted on together with a name-shaped value — see
 * `PERSON_REFERENT_TOKENS`. */
export function isPersonReferent(key: string): boolean {
  const tokens = splitTokens(key);
  return tokens.some((t) => PERSON_REFERENT_TOKENS.includes(t));
}

/** Organisation suffixes: `Erika Musterfrau` is a person, `Musterfrau GmbH`
 * is a company, and refusing every vendor name would be the "fires on
 * everything" failure in its supplier-list costume. */
const ORG_TOKENS = new Set([
  "gmbh", "ag", "se", "kg", "ohg", "ug", "ltd", "limited", "inc", "llc", "plc", "bv", "nv",
  "sa", "srl", "spa", "oy", "ab", "as", "co", "corp", "company", "group", "holding", "ev",
  "gbr", "partners", "team", "board", "council", "committee", "department",
]);

/** Particles that sit inside a personal name in lower case. */
const NAME_PARTICLES = new Set(["van", "von", "der", "den", "de", "di", "da", "del", "la", "le", "bin", "al"]);

/**
 * Does this VALUE look like a personal name?
 *
 * ⚠ A HEURISTIC, AND LABELLED ONE. There is no regex for a person — the
 * package says so in three other places and this does not change it. What it
 * can do is recognise the SHAPE: two or three capitalised words, letters and
 * name punctuation only, no organisation suffix, short.
 *
 * It is never used alone. It fires only under a field name that already refers
 * to a person (`isPersonReferent`), so both halves have to agree before
 * anything is reported. `{ owner: "platform-team" }` fails the shape,
 * `{ label: "Open Items" }` fails the referent, and `{ owner: "Erika
 * Musterfrau" }` fails neither — which is the case that was walking out of the
 * building at tier 1.
 */
export function looksLikePersonName(value: string): boolean {
  const text = value.normalize("NFKC").trim();
  if (text.length < 4 || text.length > 60) return false;
  if (/[0-9@/\\|<>{}[\]()_=+*#%$]/.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  let capitalised = 0;
  for (const word of words) {
    const w = word.replace(/[.,;:]$/, "");
    if (w.length === 0) return false;
    const lower = w.toLowerCase().replace(/[^a-z]/g, "");
    if (ORG_TOKENS.has(lower)) return false;
    if (NAME_PARTICLES.has(lower)) continue;
    if (!/^[A-ZÀ-ɏ][A-Za-zÀ-ɏ'’-]*\.?$/u.test(w)) return false;
    if (w.replace(/[^A-Za-zÀ-ɏ]/g, "").length < 2 && !w.endsWith(".")) return false;
    capitalised += 1;
  }
  return capitalised >= 2;
}

/**
 * The host's `deniedPiiField` from `flightdeck/server/widgets/types.ts`,
 * transcribed byte-for-byte in behaviour: the FIRST denied token in `path`, or
 * null. Kept even though `nameHits` supersedes it, because the divergence test
 * asserts the HOST's function still consults the two lists in this order —
 * substrings over the whole path first, then segments. A host that reordered
 * those tiers would change what "tier 4" means here without changing a single
 * list entry, and a list-only comparison would not see it.
 *
 * ⚠ It uses the host's `normalizeToken`, NOT `foldToken`, and that is the
 * point: this function is a transcription of the host's behaviour including
 * the host's blind spots. `nameHits` is where Studio is allowed to be
 * stricter.
 */
export function deniedPiiField(path: string): string | null {
  const whole = normalizeToken(path);
  for (const bad of PII_DENIED_SUBSTRINGS) {
    if (whole.includes(bad)) return bad;
  }
  for (const seg of path.split(/[.[\]]+/)) {
    if (!seg) continue;
    const n = normalizeToken(seg);
    if (PII_DENIED_SEGMENTS.includes(n)) return n;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Values
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every PII class present in `text`, with the offset of the first occurrence
 * and how many there were. The matched text is read and immediately dropped —
 * `m[0]` is never stored, never returned and never interpolated into a
 * message. `m.index` is a number and a number cannot carry a name.
 */
export function classifyText(text: string, where: string): Finding[] {
  const out: Finding[] = [];
  for (const { name, re } of ALL_VALUE_PATTERNS) {
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let first = -1;
    let count = 0;
    for (const m of text.matchAll(rx)) {
      if (first < 0) first = m.index ?? 0;
      count += 1;
    }
    if (count > 0) out.push({ class: name, tier: 3, via: "value-pattern", where, offset: first, count });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Decoding — the second representation that is not a second location
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE HONEST VERSION OF THIS FUNCTION IS INCOMPLETE AND SAYS SO.
 *
 * You cannot decode everything. There is no total defence here: a caller who
 * encrypts, compresses, ROT13s, or splits-and-XORs a record will get it past
 * any decoder this package could carry, and a package that claimed otherwise
 * would be lying in the direction that gets people hurt.
 *
 * What IS worth doing is the encodings that appear by accident and by casual
 * evasion, where a decode either yields plausible text or yields nothing:
 *   - percent-encoding — `%40` is an `@` and the email pattern needs a literal
 *     one; this is one `decodeURIComponent` away and turns up in any URL.
 *   - base64 / base64url — the default way a blob gets into a JSON field.
 *
 * A decode is ACCEPTED only when the result looks like text (mostly printable,
 * contains letters), so a PNG does not get scanned as prose and a random hash
 * does not become a finding. Depth is bounded at two, so base64-of-percent
 * works and a decode bomb does not.
 */
const BASE64_SHAPE = /^[A-Za-z0-9+/_-]{16,}={0,2}$/;

function looksLikeText(s: string): boolean {
  if (s.length < 6) return false;
  let printable = 0;
  let letters = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 160) printable += 1;
    if (/[A-Za-z]/.test(ch)) letters += 1;
  }
  return printable / s.length >= 0.9 && letters / s.length >= 0.3;
}

function decodeBase64(s: string): string | null {
  const compact = s.replace(/\s+/g, "");
  if (!BASE64_SHAPE.test(compact)) return null;
  const normalised = compact.replace(/-/g, "+").replace(/_/g, "/");
  if (normalised.replace(/=+$/, "").length % 4 === 1) return null;
  try {
    const decoded = Buffer.from(normalised, "base64").toString("utf8");
    if (decoded.includes("�")) return null;
    return looksLikeText(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function decodePercent(s: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return null;
  try {
    const decoded = decodeURIComponent(s.replace(/\+/g, " "));
    return decoded === s ? null : decoded;
  } catch {
    return null;
  }
}

/** Decoded readings of `text` that are NOT `text`, at most a handful, at most
 * two decodes deep. The original is not included. */
export function decodedVariants(text: string, depth = 2): string[] {
  if (depth <= 0 || text.length > 8192) return [];
  const out: string[] = [];
  for (const decoded of [decodePercent(text), decodeBase64(text)]) {
    if (decoded === null || decoded === text) continue;
    out.push(decoded);
    for (const deeper of decodedVariants(decoded, depth - 1)) {
      if (!out.includes(deeper)) out.push(deeper);
    }
  }
  return out;
}

/** A string that is a serialised object or array — the representation that
 * carried a whole record past a scanner reading only object keys. Returns the
 * parsed value, or null when the text is not one. */
export function parseEmbeddedJson(text: string): unknown {
  const t = text.trim();
  if (t.length < 2 || t.length > 1_000_000) return null;
  const first = t[0];
  if (first !== "{" && first !== "[") return null;
  try {
    const parsed: unknown = JSON.parse(t);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
