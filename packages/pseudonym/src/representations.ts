/**
 * ONE ADDRESS, EVERY SPELLING — the residual proof, widened past the single
 * encoding it used to be anchored on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS CLOSES
 * ─────────────────────────────────────────────────────────────────────────
 * `tokenize` step 4 proved its output clean by running the host's regex set
 * over the transmitted bytes AS WRITTEN. That is a proof about ONE
 * REPRESENTATION of the payload, and it was reported as a proof about the
 * payload:
 *
 *     tokenize("Kontakt: anna%40acme.de")   → text UNCHANGED, no refusal
 *     residualPiiFindings(that text)        → []            "proved clean"
 *     assessTier(that text, vault)          → tier 2, reduced, reason
 *                                             "no-personal-data-in-payload"
 *
 * The address was reachable the whole time; only the spelling had moved.
 * This is the same shape `check-contracts-boundary.sh` recorded for PATHS —
 * data untracked from one path while an identical copy lived at another —
 * and the same shape `packages/guardrails/src/representations.ts` closes for
 * STRUCTURED VALUES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A SECOND COPY OF `guardrails/representations.ts`
 * ─────────────────────────────────────────────────────────────────────────
 * Stated rather than hidden, because a second module with a near-identical
 * name needs a reason.
 *
 * `guardrails/representations.ts` answers "what TIER is this VALUE?". It
 * walks an object graph, re-reads every node through `classify()`,
 * `classifyMarkdown()` and `classifyCode()`, and returns the MAXIMUM tier. Its
 * vocabulary is the guardrails denylists; its unit of work is a node.
 *
 * This file answers a strictly narrower question: "what other STRINGS is this
 * ONE STRING also readable as?". It has no classifier, no lists and no tier.
 * It derives alternate readings of a piece of text and hands each one to the
 * host's own `residualPiiFindings` — the same scanner this package has always
 * used, unmodified, still divergence-tested in `host-mirror.ts`.
 *
 * So the two are layered, not duplicated: guardrails re-reads a VALUE as
 * other VALUES, this re-reads a TEXT as other TEXTS. They share the base64
 * idea and nothing else, and neither can drift into disagreeing about a list,
 * because neither owns one. If a third caller ever needs both, the right move
 * is to call both, not to merge them.
 *
 * ⛔ IT IS ADDITIVE AND IT NEVER CLEARS A FINDING. The `as-written` reading
 * is always the first one scanned and its findings are kept verbatim, so this
 * function is a superset of `residualPiiFindings` and swapping one for the
 * other cannot turn a refusal into an allowance.
 *
 * ⚠ STATED LIMITS, because an unstated one is a lie:
 *   - it derives the readings named in `TEXT_REPRESENTATIONS_DERIVED` and no
 *     others. An encoding nobody here thought of is NOT covered, and the
 *     honest place to say so is that exported constant plus the `unchecked`
 *     list `assessTier` reports.
 *   - derivation is BOUNDED (text length, decode rounds, base64 attempts).
 *     Exhausting a bound sets `budgetExhausted`, and both callers treat that
 *     as a refusal / a refusal to reduce — never as a clean result.
 *   - it proves nothing about classes the host's patterns do not cover. A
 *     passport number is invisible in every representation, because it is
 *     invisible in the first one.
 */

import { type RedactOptions, residualPiiFindings } from "./host-mirror";
import { foldForSignals } from "./signals";

/**
 * Exactly which second spellings are derived. Exported so the coverage claim
 * is documentation a caller can read rather than a comment they must trust.
 */
export const TEXT_REPRESENTATIONS_DERIVED: readonly string[] = [
  "as-written", // the exact bytes, scanned first, findings kept verbatim
  "unicode-normalized", // NFKC — fullwidth ＠, ligatures, compatibility forms
  "percent-decoded", // anna%40acme.de
  "html-entity-decoded", // anna&#64;acme.de, anna&commat;acme.de
  "escape-decoded", // a backslash-u or backslash-x escape of the @
  "deobfuscated", // anna (at) acme (dot) de
  "base64-decoded", // YW5uYS5tdWVsbGVyQGFjbWUuZGU=
  "format-folded", // anna<ZWSP>@acme.de, anna @ acme.de, annа@acme.de (Cyrillic а)
  "transliteration-folded", // Mueller when the caller declared Müller
];

export interface RepresentationBudget {
  /** Longest text a decoder will be handed. */
  readonly maxTextChars?: number | undefined;
  /** How many times a decoded reading may itself be decoded again. */
  readonly maxRounds?: number | undefined;
  /** How many base64-shaped tokens may be tried across all readings. */
  readonly maxBase64Attempts?: number | undefined;
  /** Ceiling on distinct readings held at once. */
  readonly maxReadings?: number | undefined;
}

const DEFAULT_TEXT_CHARS = 1_000_000;
const DEFAULT_ROUNDS = 3;
/** Decode attempts, not tokens: an ordinary long German compound word is
 * base64-SHAPED and costs one attempt even though it decodes to rubbish. The
 * bound has to sit far above what real prose produces or a long document
 * refuses for no reason, and far below what makes a decode bomb pay — an
 * attempt is one `atob` plus one UTF-8 decode of a short string, so 20k of
 * them is a fraction of a second. */
const DEFAULT_BASE64_ATTEMPTS = 20_000;
const DEFAULT_READINGS = 64;

/**
 * One way of reading a piece of text, plus the declared names that reading
 * should be scanned WITH.
 *
 * The names travel with the reading because one reading changes both sides:
 * `transliteration-folded` folds the text AND the caller's names, so that
 * "Mueller" in the payload is caught against a declared "Müller". Every other
 * reading carries the caller's names unchanged.
 */
export interface Reading {
  /** A name from `TEXT_REPRESENTATIONS_DERIVED`. A compiled-in constant. */
  readonly name: string;
  readonly text: string;
  readonly names: readonly string[];
}

export interface DerivedReadings {
  readonly readings: readonly Reading[];
  /** True when a bound stopped the derivation. Never treated as "clean". */
  readonly budgetExhausted: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// THE DECODERS
// Each one takes text and returns text. A decoder that changes nothing
// returns an identical string and the reading is dropped as a duplicate.
// ─────────────────────────────────────────────────────────────────────────

/** NFKC: fullwidth `＠` and `．`, compatibility ligatures, circled letters. */
function unicodeNormalize(text: string): string {
  try {
    return text.normalize("NFKC");
  } catch {
    return text;
  }
}

/**
 * `%40` → `@`. Decoded in RUNS so a multi-byte UTF-8 sequence (`%C3%BC`)
 * comes back as one character. A malformed run is left exactly as written —
 * this is a widening pass, so failing to decode costs a reading, never a
 * finding.
 */
function percentDecode(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/** The entity names that matter for an identifier. Deliberately short: this
 * is not an HTML parser, it is the set of characters an address is spelled
 * with plus the ones used to hide the brackets around one. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  commat: "@",
  period: ".",
  dot: ".",
  fullstop: ".",
  lowbar: "_",
  hyphen: "-",
  dash: "-",
  plus: "+",
  sol: "/",
  colon: ":",
  num: "#",
  percnt: "%",
  lpar: "(",
  rpar: ")",
  lsqb: "[",
  rsqb: "]",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
};

function htmlEntityDecode(text: string): string {
  return text
    .replace(/&#x([0-9A-Fa-f]{1,6});/g, (raw, hex: string) => codePoint(parseInt(hex, 16), raw))
    .replace(/&#(\d{1,7});/g, (raw, dec: string) => codePoint(parseInt(dec, 10), raw))
    .replace(/&([A-Za-z][A-Za-z0-9]{1,9});/g, (raw, entity: string) => {
      const mapped = NAMED_ENTITIES[entity.toLowerCase()];
      return mapped ?? raw;
    });
}

function codePoint(value: number, raw: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return raw;
  try {
    return String.fromCodePoint(value);
  } catch {
    return raw;
  }
}

/** `@`, `\u{40}` and `\x40` — the spelling a JSON or source-code
 * round trip leaves behind. */
function escapeDecode(text: string): string {
  return text
    .replace(/\\u\{([0-9A-Fa-f]{1,6})\}/g, (raw, hex: string) => codePoint(parseInt(hex, 16), raw))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (raw, hex: string) => codePoint(parseInt(hex, 16), raw))
    .replace(/\\x([0-9A-Fa-f]{2})/g, (raw, hex: string) => codePoint(parseInt(hex, 16), raw));
}

/**
 * `anna (at) acme (dot) de` → `anna@acme.de`.
 *
 * Three rules, and the split between them is the false-positive argument:
 *
 *   BRACKETED separators are unambiguous. `(at)`, `[at]`, `{at}`, `(dot)`,
 *   `[punkt]` do not occur in prose for any other reason, so they are
 *   rewritten wherever they appear.
 *
 *   A SPELLED-OUT `dot` is nearly as unambiguous: `acme dot de` is not a
 *   sentence in either language this package reads, so `local at domain dot
 *   tld` is rewritten on sight.
 *
 *   A BARE `at` in front of an already-dotted domain is the dangerous one,
 *   because `at` is the commonest preposition in English and a dotted domain
 *   is ordinary prose content. THIS RULE CAUSED A REGRESSION AND IS THE
 *   REASON THE GATE BELOW EXISTS:
 *
 *       tokenize("I looked at github.com and found nothing.")
 *         → the reading "I@github.com" → `email` → ResidualPiiError THROWN
 *
 *   A clean sentence took the caller down. A false positive that WARNS costs
 *   a tier reduction; a false positive that THROWS costs the request, and the
 *   two are not the same size — the asymmetry argument that licenses this
 *   whole file runs the other way once a derived READING can throw on text
 *   that is clean as written.
 *
 * ⚠ SO A BARE `at` NEEDS CORROBORATION, one of exactly two kinds:
 *     - the local part is SHAPED LIKE A LOCAL PART: it carries a `.`, `_`,
 *       `%`, `+` or a digit (`anna.mueller at acme.de`), or
 *     - the span is introduced by a MAIL CUE that is adjacent to it, with
 *       nothing but a connective between (`E-Mail: sales at acme.de`,
 *       `write to sales at acme.de`, `erreichbar unter sales at acme.de`).
 *   `I looked at github.com`, `we met at acme.de yesterday` and
 *   `redirect at example.com` have neither and are left exactly as written.
 *
 * ⚠ STATED COST, AND IT IS A REAL ONE: a bare role mailbox with no cue —
 * `sales at acme.de` standing alone in a sentence — is no longer read as an
 * address. That is a miss, and misses are the expensive direction. It is
 * accepted here because the alternative is a hard refusal fired by the most
 * common preposition in the language, and because every OTHER reading in this
 * file is a MECHANICAL DECODING (percent, entity, escape, base64, NFKC,
 * format characters) whose inverse is a function rather than a guess. Those
 * keep their refusal; this one heuristic had to earn its.
 */

/** A local part that is shaped like a local part rather than like a word. */
const ADDRESS_SHAPED_LOCAL = /[._%+]|\d/;

/** A mail cue IMMEDIATELY before the span — cue, then at most a connective
 * and punctuation, then the local part. Anchored at the end of the text that
 * precedes the match, so "contact us — I looked at github.com" does not
 * qualify: there is a clause between the cue and the `at`. */
const MAIL_CUE_BEFORE =
  /\b(?:e-?mails?|mail(?:adresse|address)?|kontakt|contact|erreichbar|schreib(?:en|t|e)?|write|reach)\b[\s:.,\u2013-]*(?:to|an|unter|us|me|uns|at|per)?[\s:.,\u2013-]*$/i;

function bareAtIsAnAddress(local: string, before: string): boolean {
  return ADDRESS_SHAPED_LOCAL.test(local) || MAIL_CUE_BEFORE.test(before);
}

function deobfuscate(text: string): string {
  return (
    text
      // bracketed separators — unambiguous
      .replace(/\s*[([{<]\s*(?:at|ät|@)\s*[)\]}>]\s*/gi, "@")
      .replace(/\s*[([{<]\s*(?:dot|punkt|\.)\s*[)\]}>]\s*/gi, ".")
      // fully spelled-out address: local AT domain DOT tld
      .replace(
        /\b([A-Za-z0-9._%+-]{1,64})\s+at\s+([A-Za-z0-9-]{1,63})\s+(?:dot|punkt)\s+([A-Za-z]{2,24})\b/gi,
        "$1@$2.$3",
      )
      // local AT domain.tld — ONLY with corroboration; see the header.
      .replace(
        /\b([A-Za-z0-9._%+-]{1,64})\s+at\s+((?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,24})\b/gi,
        (raw: string, local: string, domain: string, offset: number, whole: string) =>
          // Only the 64 characters immediately before the span: the cue has to
          // be adjacent to count, and slicing the whole prefix at every match
          // would make a long document quadratic.
          bareAtIsAnAddress(local, whole.slice(Math.max(0, offset - 64), offset))
            ? `${local}@${domain}`
            : raw,
      )
  );
}

/**
 * ⭐ THE INVISIBLE-CHARACTER READING: format characters stripped, whitespace
 * inside an address collapsed, confusable letters folded to Latin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS CLOSES
 * ─────────────────────────────────────────────────────────────────────────
 * Every decoder above rewrites a SPELLING of a character. None of them
 * removes a character that has no spelling at all, and NFKC does not either:
 * Unicode general category Cf (ZERO WIDTH SPACE, SOFT HYPHEN, ZWJ/ZWNJ, BOM,
 * the bidi controls) survives normalization by design. Nor did any reading
 * collapse whitespace, so a line break did the same job:
 *
 *     "Kontakt: anna\u200B@acme.de"   → text UNCHANGED, no refusal
 *     "Kontakt: anna @acme.de"        → text UNCHANGED, no refusal
 *     "Kontakt: anna\n@acme.de"       → text UNCHANGED, no refusal
 *     assessTier(any of them)         → tier 2, "no-personal-data-in-payload"
 *
 * The same hole swallowed a HOMOGLYPH: `annа@acme.de` with a Cyrillic `а`
 * before the `@` is not an email to the host's `[A-Za-z0-9._%+-]+@…` pattern,
 * and nothing folded it. It belongs in this reading and not in its own,
 * because it is the same defect — a character that LOOKS like part of an
 * address but is not the byte the scanner is anchored on.
 *
 * ⚠ BOUNDED ON PURPOSE. Whitespace is collapsed only where an address is
 * already in evidence — immediately around an `@`, and inside the dotted
 * domain that follows one. Collapsing whitespace everywhere would MANUFACTURE
 * findings out of prose ("Punkt 1. 2. 2024" would become a `date`), and a
 * reading that invents a finding is the regression this file just had.
 */

/** Unicode Cf (format) plus the variation selectors and the Mongolian
 * separators. Every one of them is invisible and none of them is removed by
 * NFKC. */
const INVISIBLE_CHARS = /[\p{Cf}\uFE00-\uFE0F\u180B-\u180E]/gu;

/** Cyrillic and Greek letters that are drawn like Latin ones. A closed table,
 * not a general confusable database: these are the letters an address is
 * spelled with. */
const CONFUSABLES: Readonly<Record<string, string>> = {
  "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c",
  "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u0455": "s",
  "\u04CF": "l", "\u0501": "d", "\u043A": "k", "\u043C": "m", "\u043D": "h",
  "\u0442": "t", "\u0432": "b",
  "\u0410": "A", "\u0415": "E", "\u041E": "O", "\u0420": "P", "\u0421": "C",
  "\u0423": "Y", "\u0425": "X", "\u0406": "I", "\u0408": "J", "\u0405": "S",
  "\u041A": "K", "\u041C": "M", "\u041D": "H", "\u0422": "T", "\u0412": "B",
  "\u03B1": "a", "\u03B5": "e", "\u03BF": "o", "\u03C1": "p", "\u03C5": "u",
  "\u03B9": "i", "\u03BA": "k", "\u03C4": "t", "\u03C7": "x", "\u03BD": "v",
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0397": "H", "\u0399": "I",
  "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P",
  "\u03A4": "T", "\u03A5": "Y", "\u03A7": "X",
};

const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "g");

function formatFold(text: string): string {
  const stripped = text.replace(INVISIBLE_CHARS, "").replace(CONFUSABLE_RE, (ch) => CONFUSABLES[ch] ?? ch);
  return (
    stripped
      // whitespace hugging an `@` — the separator is in evidence, so this is
      // inside an address and not between two sentences
      .replace(/[\s]*@[\s]*/g, "@")
      // …and inside the dotted domain that follows one: `@acme . de`
      .replace(/@((?:[A-Za-z0-9-]+[ \t]*\.[ \t]*)+[A-Za-z]{2,24})\b/g, (_raw, domain: string) =>
        `@${domain.replace(/[ \t]+/g, "")}`,
      )
  );
}

/** A token long enough to be carrying something, in either base64 alphabet. */
const BASE64_TOKEN = /[A-Za-z0-9+/_-]{16,}={0,2}/g;

/** Everything a human-readable identifier is spelled with. A base64 token
 * that decodes to bytes outside this set decoded to binary, not to text, and
 * scanning binary for an email address only manufactures noise. */
const PRINTABLE = /^[\t\n\r\x20-\x7E\u00A0-\u024F]+$/;

function base64ToText(token: string): string | null {
  const body = token.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (body.length < 16) return null;
  const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.length < 6) return null;
    if (!PRINTABLE.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Every base64-shaped token replaced IN PLACE by what it decodes to, so the
 * surrounding prose is preserved and the host's patterns see the decoded
 * address in an ordinary sentence.
 *
 * `fatal: true` on the UTF-8 decoder plus the printability test do the
 * filtering: an ordinary long German word decodes to high-byte rubbish and is
 * rejected, so this does not turn `unterschriebenhaben` into a finding.
 */
function base64Decode(text: string, budget: { attempts: number; exhausted: boolean }): string {
  return text.replace(BASE64_TOKEN, (token) => {
    if (budget.attempts <= 0) {
      budget.exhausted = true;
      return token;
    }
    budget.attempts -= 1;
    return base64ToText(token) ?? token;
  });
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * Every reading of `text`, bounded.
 *
 * Breadth-first: the as-written reading is decoded by each decoder; anything
 * that came out different is itself decoded again, up to `maxRounds`. That is
 * what catches double encoding (`%2540`, an entity inside a percent escape)
 * without an unbounded loop.
 */
export function derivedReadings(
  text: string,
  opts: RedactOptions & RepresentationBudget = {},
): DerivedReadings {
  const names = opts.names ?? [];
  const maxTextChars = opts.maxTextChars ?? DEFAULT_TEXT_CHARS;
  const maxRounds = opts.maxRounds ?? DEFAULT_ROUNDS;
  const maxReadings = opts.maxReadings ?? DEFAULT_READINGS;
  const budget = { attempts: opts.maxBase64Attempts ?? DEFAULT_BASE64_ATTEMPTS, exhausted: false };

  const readings: Reading[] = [{ name: "as-written", text, names }];
  const seen = new Set<string>([text]);

  if (text.length > maxTextChars) {
    // Too long to re-read. The as-written scan still happens; the widening
    // does not, and the caller is told so rather than being handed a result
    // that looks complete.
    return { readings, budgetExhausted: true };
  }

  const decoders: readonly { name: string; run: (t: string) => string }[] = [
    { name: "unicode-normalized", run: unicodeNormalize },
    { name: "percent-decoded", run: percentDecode },
    { name: "html-entity-decoded", run: htmlEntityDecode },
    { name: "escape-decoded", run: escapeDecode },
    { name: "deobfuscated", run: deobfuscate },
    { name: "base64-decoded", run: (t) => base64Decode(t, budget) },
    { name: "format-folded", run: formatFold },
  ];

  let frontier: string[] = [text];
  for (let round = 0; round < maxRounds; round += 1) {
    const next: string[] = [];
    for (const source of frontier) {
      for (const { name, run } of decoders) {
        if (readings.length >= maxReadings) return { readings, budgetExhausted: true };
        let decoded: string;
        try {
          decoded = run(source);
        } catch {
          budget.exhausted = true;
          continue;
        }
        if (decoded === source || decoded.length > maxTextChars || seen.has(decoded)) continue;
        seen.add(decoded);
        readings.push({ name, text: decoded, names });
        next.push(decoded);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  // The transliteration reading folds BOTH sides, so it is derived from the
  // names rather than from a decoder. Only worth deriving when folding
  // actually changes a declared name — otherwise it is the as-written scan
  // with its case thrown away.
  const foldedNames = names.map((n) => foldForSignals(n));
  if (foldedNames.some((folded, i) => folded !== (names[i] ?? "").toLowerCase())) {
    const folded = foldForSignals(text);
    readings.push({ name: "transliteration-folded", text: folded, names: foldedNames });
  }

  return { readings, budgetExhausted: budget.exhausted };
}

export interface RepresentationScan {
  /** Host PII class names, union over every reading. A superset of
   * `residualPiiFindings(text, opts)`, which is `asWritten` below. */
  readonly findings: readonly string[];
  /** What the host's scanner finds in the exact transmitted bytes. */
  readonly asWritten: readonly string[];
  /** `class:reading` for every class found ONLY in a derived reading. Both
   * halves are compiled-in constants, so this is loggable. */
  readonly encoded: readonly string[];
  /** Which readings were actually derived, by name. */
  readonly representations: readonly string[];
  /** A bound stopped the derivation. NOT a clean result. */
  readonly budgetExhausted: boolean;
}

/**
 * The host's residual scan, run over every reading of the text.
 *
 * ⛔ ADDITIVE. `asWritten` is `residualPiiFindings` called with the caller's
 * exact arguments, computed first and returned unmodified, so no caller is
 * made worse off by routing through this.
 */
export function residualPiiEveryRepresentation(
  text: string,
  opts: RedactOptions & RepresentationBudget = {},
): RepresentationScan {
  const asWritten = residualPiiFindings(text, { names: opts.names });
  const { readings, budgetExhausted } = derivedReadings(text, opts);

  const all = new Set<string>(asWritten);
  const encoded = new Set<string>();
  for (const reading of readings) {
    if (reading.name === "as-written") continue;
    for (const cls of residualPiiFindings(reading.text, { names: reading.names })) {
      if (!all.has(cls)) encoded.add(`${cls}:${reading.name}`);
      all.add(cls);
    }
  }

  return {
    findings: [...all].sort(),
    asWritten,
    encoded: [...encoded].sort(),
    representations: [...new Set(readings.map((r) => r.name))].sort(),
    budgetExhausted,
  };
}
