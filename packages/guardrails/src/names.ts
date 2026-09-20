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
    const isInitial = word.endsWith("."); // the `Q.` of `Jane Q. Doe`
    const w = word.replace(/[.,;:]$/, "");
    if (w.length === 0) return false;
    const lower = w.toLowerCase().replace(/[^a-z]/g, "");
    if (ORG_TOKENS.has(lower)) return false;
    if (NAME_PARTICLES.has(lower)) continue;
    if (!/^[A-ZÀ-ɏ][A-Za-zÀ-ɏ'’-]*$/u.test(w)) return false;
    if (w.replace(/[^A-Za-zÀ-ɏ]/g, "").length < 2 && !isInitial) return false;
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
/**
 * ⚠ TWO BOUNDS, AND WHY A SCANNER NEEDS THEM.
 *
 * The host's `email` pattern is `[A-Za-z0-9._%+-]+@…`. On a long run of word
 * characters with no `@`, the `+` matches to the end, fails, backtracks one
 * character at a time, and then the engine advances the start position and
 * does it again — quadratic. Measured here: a single 200 000-character value
 * cost 43 SECONDS inside `classify()`. That is not a detection bug, it is a
 * denial of service on the gate that sits in front of every outbound model
 * call, and the fix cannot be "edit the regex": `PII_PATTERNS` is compared to
 * the host entry for entry, regex source included, and a Studio-only rewrite
 * of it is exactly the divergence `lists.ts` exists to prevent.
 *
 * So the pattern is left alone and the WAY IT IS RUN is bounded:
 *
 *   1. a cheap precondition — a pattern that cannot match without an `@` or a
 *      digit is not run on text that has none. Exact, not approximate: it
 *      skips only runs that provably cannot match.
 *   2. a sliding window with an overlap longer than any pattern can match, so
 *      cost is linear in the text and no match is cut in half. A match is
 *      counted in the window its START falls in, so the overlap does not
 *      double-count it.
 *
 * Neither bound can hide a match, which is the property that matters: this is
 * a performance fix, not a scope reduction, and a scope reduction dressed as a
 * performance fix is how the hole at the top of `classify.ts` would grow back.
 */
const SCAN_WINDOW = 2048;
/** Longer than the longest string any pattern here can match (an IBAN is at
 * most 34 characters; a long email address is well under 256). */
const SCAN_OVERLAP = 512;

/** Exact, cheap reasons a pattern CANNOT match — never a guess. */
function cannotMatch(name: string, text: string): boolean {
  if (name === "email") return !text.includes("@");
  if (name === "iban") return !/[A-Z]/.test(text);
  return !/\d/.test(text); // digits, amount, date all require a digit
}

export function classifyText(text: string, where: string): Finding[] {
  const out: Finding[] = [];
  for (const { name, re } of ALL_VALUE_PATTERNS) {
    if (cannotMatch(name, text)) continue;
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let first = -1;
    let count = 0;
    for (let start = 0; start < Math.max(text.length, 1); start += SCAN_WINDOW) {
      const chunk = text.slice(start, start + SCAN_WINDOW + SCAN_OVERLAP);
      if (cannotMatch(name, chunk)) continue;
      rx.lastIndex = 0;
      for (const m of chunk.matchAll(rx)) {
        const at = m.index ?? 0;
        // Counted in the window its start falls in, so the overlap is read
        // twice and reported once.
        if (at >= SCAN_WINDOW && start + SCAN_WINDOW < text.length) break;
        if (first < 0) first = start + at;
        count += 1;
      }
    }
    if (count > 0) out.push({ class: name, tier: 3, via: "value-pattern", where, offset: first, count });
  }
  return out;
}

/**
 * COMPOSITES — two findings that are a third thing together.
 *
 * `{ ageAtSigning: 34, referenceDate: "2026-09-01" }` is a date of birth. It
 * scored tier 3 as a generic `date`, and tier 3 at `gateWorkflowIntake` is
 * APPROVABLE — so a category-4 date of birth was rubber-stampable because
 * nothing ever called it a date of birth. An age plus a reference date is
 * recoverable to the day; naming it `dateofbirth` is arithmetic, not
 * suspicion.
 *
 * ⚠ It lives HERE, below both scanners, and is applied by `classify()` and by
 * the text scanner alike. A composite rule that existed in the record walker
 * only would be the same defect this round is about: the same two facts, one
 * representation scoring 4 and the other scoring 3, and the lower one sitting
 * behind the gate with an approval path.
 *
 * Kept to the ONE composite that is arithmetic. A list of clever combinations
 * would be a list of false positives.
 */
const AGE_CLASSES = new Set(["age", "ages", "birthday"]);

export function compositeFindings(findings: readonly Finding[]): Finding[] {
  const hasAge = findings.some(
    (f) => AGE_CLASSES.has(f.class) && (f.via === "field-name" || f.via === "label"),
  );
  if (!hasAge) return [];
  const date = findings.find((f) => f.class === "date" && f.via === "value-pattern");
  if (!date) return [];
  return [{ class: "dateofbirth", tier: 4, via: "value-shape", where: date.where }];
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
/** 12 characters is 9 decoded bytes — short enough to carry `a@b.de`, long
 * enough that ordinary short identifiers are not run through a decoder. */
const BASE64_SHAPE = /^[A-Za-z0-9+/_-]{12,}={0,2}$/;

/**
 * Is this decoded byte string plausibly TEXT rather than binary?
 *
 * ⚠ The first version of this asked for a letter RATIO of 30%, which reads
 * like a sensible way to keep PNG headers out of the scanner and is in fact
 * the same mistake this whole round is about, in miniature: it is a rule
 * anchored on one shape of the thing being protected. `DE89370400440532013000`
 * is 22 characters and two letters — 9% — so a base64-encoded German IBAN was
 * rejected as binary and never scanned, while a base64-encoded sentence was.
 * The test is therefore "mostly printable, with at least a couple of letters",
 * which admits an IBAN, a number-heavy CSV row and a sentence alike, and still
 * rejects the compressed and the encrypted, which nothing here can read
 * anyway.
 */
function looksLikeText(s: string): boolean {
  if (s.length < 6) return false;
  let printable = 0;
  let letters = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 160) printable += 1;
    if (/[A-Za-z]/.test(ch)) letters += 1;
  }
  return printable / s.length >= 0.9 && letters >= 2;
}

function decodeBase64(s: string): string | null {
  const compact = s.replace(/\s+/g, "");
  if (!BASE64_SHAPE.test(compact)) return null;
  const normalised = compact.replace(/-/g, "+").replace(/_/g, "/");
  if (normalised.replace(/=+$/, "").length % 4 === 1) return null;
  try {
    // `atob` + `TextDecoder` rather than `Buffer`, for the reason in
    // `envelope/src/utf8.ts`. `atob` is STRICTER than `Buffer.from(_, "base64")`,
    // which silently skips characters outside the alphabet — but `BASE64_SHAPE`
    // has already rejected those, and a throw here is caught below and read as
    // "not base64", which is the same answer Buffer's leniency would have to
    // reach the long way round.
    // ⚠ AND THE PADDING IS REBUILT, which is not cosmetic. `Buffer.from(_,
    // "base64")` decodes a string whose padding is wrong — "…g2n==" where
    // the length calls for one "=" — and `atob` throws on it. Measured
    // against the old path over 13,378 shaped inputs, that was the ONLY
    // remaining difference, and it ran the wrong way: 24 strings that
    // `Buffer` decoded to clean text became "not base64", so a name hidden
    // in sloppily-padded base64 would have stopped being found. A detector
    // that gets quieter is the one kind of regression a green suite reports
    // as a pass.
    const stripped = normalised.replace(/=+$/, "");
    const binary = atob(stripped + "=".repeat((4 - (stripped.length % 4)) % 4));
    const octets = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) octets[i] = binary.charCodeAt(i);
    const decoded = new TextDecoder("utf-8").decode(octets);
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
