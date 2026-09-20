/**
 * WHAT THE PAYLOAD ITSELF SAYS ABOUT WHETHER A PERSON IS IN IT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS FOR
 * ─────────────────────────────────────────────────────────────────────────
 * `assessTier` decided "is a natural person involved?" from the VAULT —
 * `vaultEntries()` plus minted tags — and from nothing else. So any
 * identifying text the tokenizer never touched produced not a missed
 * detection but an AFFIRMATIVE CLEAN VERDICT:
 *
 *     assessTier("Anna Müller ist Werksleiter am Standort Bremen und die
 *                 einzige Prokuristin.", new Vault())
 *       → payloadTier 2, reduced: true, "no-personal-data-in-payload"
 *
 * …while `signalHits` on that same string returned `werksleiter`,
 * `standort`, `prokuristin`, `die einzige`. The evidence was computed and
 * thrown away, because the quasi-identifier floor was gated behind the vault
 * (`if (quasi.length > 0 && aboutAPerson)`).
 *
 * The consequence is the wrong way round: the tool was SAFEST when the caller
 * declared every name and MOST DANGEROUS when they forgot, because an
 * omission in `names[]` emptied the vault and an empty vault read as "no
 * person here". A caller who declares nothing must get a MORE cautious answer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE CLAIMS, AND WHAT IT CAREFULLY DOES NOT
 * ─────────────────────────────────────────────────────────────────────────
 * It does NOT detect people. There is no regex for a person; the host says so
 * outright about `redact()` and this package repeats it in three other
 * headers. Nothing here changes that.
 *
 * What it detects is SHAPES THAT CANNOT BE RULED OUT — a capitalised bigram
 * that reads like a personal name, a mixed letter/digit token that reads like
 * a reference number. Each is used in ONE DIRECTION ONLY: to withhold a tier
 * reduction. A hit never adds a claim about who the person is, never appears
 * in evidence as a span of the text, and never lowers a tier.
 *
 * That one-directional use is what lets the heuristic be crude. It over-fires
 * on German prose — `Firma Acme`, `Projekt Nordstern` and `Standort Bremen`
 * are all capitalised bigrams — and over-firing costs a tier reduction, while
 * under-firing puts a named person on the wire. Those costs are not
 * comparable, so this is the side to be wrong on.
 *
 * ⛔ EVERY VALUE THIS FILE RETURNS IS A COMPILED-IN CONSTANT from
 * `TEXT_INDICATIONS`. The span that matched is never returned, never logged
 * and never put in a reason's evidence — same rule as `signals.ts`, for the
 * same reason.
 */

import { PERSON_REFERENT_SIGNALS, foldForSignals, signalHits } from "./signals";
import { TAG_CLASSES } from "./tags";

/** The closed vocabulary of things the text can say. Closed so a reported
 * indication is a constant a log line may carry. */
export const TEXT_INDICATIONS = [
  /** Two or three adjacent capitalised words that are not function words —
   * the shape of `Anna Müller`, and also of `Firma Acme`. */
  "name-shaped-span",
  /** A title (`Frau`, `Dr.`, `Mr`) followed by a capitalised word. */
  "titled-name-span",
  /** A mixed letter/digit token no host pattern claimed — `C01X00T47`. The
   * shape of a passport, staff, case or reference number. */
  "identifier-shaped-token",
  /** A word that says the subject is a natural person without naming one. */
  "person-referent-word",
] as const;

export type TextIndication = (typeof TEXT_INDICATIONS)[number];

/**
 * Words that start a German or English sentence or glue one together. A
 * capitalised token that is one of these is capitalisation, not a name.
 *
 * German capitalises every noun, so without this list every second sentence
 * is a "name-shaped span" and the signal is worthless. With it, `Der
 * Genehmigungsschritt` is prose and `Anna Müller` is not.
 *
 * ⚠ It is a stoplist, not a lexicon: `Firma Acme` still reads as name-shaped.
 * See the header for why that is the acceptable direction to be wrong in.
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  // German determiners, pronouns, prepositions, conjunctions, common verbs
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem",
  "eines", "einer", "kein", "keine", "keinen", "dieser", "diese", "dieses",
  "jeder", "jede", "jedes", "alle", "allen", "beide", "mehrere", "andere",
  "im", "am", "in", "an", "auf", "aus", "bei", "mit", "nach", "seit", "von",
  "vom", "zu", "zum", "zur", "uber", "unter", "vor", "hinter", "neben",
  "fur", "ohne", "gegen", "um", "durch", "wegen", "trotz", "wahrend",
  "und", "oder", "aber", "denn", "sondern", "wenn", "weil", "dass", "damit",
  "ob", "als", "wie", "wo", "was", "wer", "warum", "welche", "welcher",
  "ich", "du", "er", "sie", "es", "wir", "ihr", "man", "sich", "mein",
  "dein", "sein", "ihre", "unser", "euer", "hier", "dort", "heute", "morgen",
  "gestern", "jetzt", "dann", "noch", "nur", "auch", "sehr", "mehr", "nicht",
  "ist", "sind", "war", "waren", "hat", "haben", "hatte", "wird", "werden",
  "kann", "konnen", "muss", "mussen", "soll", "sollen", "darf", "durfen",
  "bitte", "danke", "hallo", "guten", "liebe", "lieber", "betreff",
  // English
  "the", "a", "an", "this", "that", "these", "those", "each", "every", "all",
  "some", "any", "no", "and", "or", "but", "if", "because", "while", "when",
  "where", "what", "who", "why", "how", "for", "from", "to", "with", "without",
  "at", "by", "on", "in", "of", "about", "after", "before", "under", "over",
  "i", "you", "he", "she", "it", "we", "they", "my", "your", "his", "her",
  "its", "our", "their", "is", "are", "was", "were", "has", "have", "had",
  "will", "would", "can", "could", "must", "should", "may", "might",
  "please", "thanks", "hello", "dear", "subject", "re", "fw", "note", "here",
  "there", "today", "now", "then", "also", "only", "very", "not",
]);

/** A title, so `Frau Musterfrau` and `Dr. Berger` read as named people even
 * though only one of the two tokens is a name. */
const NAME_TITLES: ReadonlySet<string> = new Set([
  "herr", "herrn", "frau", "dr", "prof", "dipl", "mr", "mrs", "ms", "miss", "dame", "sir",
]);

/** Our own class words, so a mangled or lower-cased tag cannot read as a
 * name once the minted ones have been masked out. */
const TAG_WORDS: ReadonlySet<string> = new Set<string>(TAG_CLASSES);

/** One capitalised word: an initial capital (including umlauts) and at least
 * one more letter. Hyphens and apostrophes are name punctuation. */
const CAPITALISED = /^[A-ZÄÖÜ][\p{L}]*(?:[-'’][\p{L}]+)*$/u;

/** `C01X00T47`, `AB-123-CD`, `ISO9001`: one token, at least two letters AND
 * at least two digits, long enough not to be a version number or a unit.
 *
 * The classes the host's patterns DO cover (an IBAN, a long digit run, a
 * date) are reported by the residual scan instead; overlapping with them here
 * costs nothing, because both routes only ever withhold a reduction. */
const IDENTIFIER_SPLIT = /[^\p{L}\p{N}-]+/u;

function looksLikeIdentifier(token: string): boolean {
  if (token.length < 6 || token.length > 64) return false;
  const letters = (token.match(/\p{L}/gu) ?? []).length;
  const digits = (token.match(/\p{N}/gu) ?? []).length;
  return letters >= 2 && digits >= 2;
}

/** Split into word-ish tokens, keeping sentence punctuation out of them but
 * keeping the ORDER, because a name-shaped span is about adjacency. A
 * sentence boundary breaks adjacency: `…beendet. Anna hat…` must not read as
 * the bigram `beendet Anna`. */
function tokenSequences(text: string): string[][] {
  const sequences: string[][] = [];
  for (const sentence of text.split(/(?<=[.!?:;•\n])\s+|\n+/)) {
    const tokens = sentence.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
    if (tokens.length > 0) sequences.push(tokens);
  }
  return sequences;
}

function isOrdinaryWord(token: string): boolean {
  const lowered = token.toLowerCase();
  return FUNCTION_WORDS.has(lowered) || TAG_WORDS.has(lowered);
}

/**
 * Every indication the TEXT carries, as compiled-in constants.
 *
 * ⚠ `text` should already have this package's minted tags masked
 * (`maskMintedTags`), so `<person:1>` is not read as prose. `assessTier`
 * does that before calling.
 *
 * ⚠ `signalWords` is the set of quasi-identifier and special-category entries
 * that already hit. A capitalised token that is one of them is a ROLE or a
 * SITE, not a name — this is what keeps `Standort Bensheim` out of
 * `name-shaped-span` while leaving `Anna Müller` in it. Those spans are
 * already floored by their own signal, so nothing is lost by excluding them.
 */
export function textIndications(text: string, signalWords: readonly string[] = []): TextIndication[] {
  const found = new Set<TextIndication>();

  // Folded on BOTH sides, so `Geschäftsführer` in the text is recognised as
  // the entry `geschaftsfuhrer` that already hit. Comparing raw lower case
  // would have excluded only the signals that happen to have no umlaut.
  const signalStems = new Set<string>();
  for (const word of signalWords) {
    for (const part of foldForSignals(word).split(/[^a-z0-9]+/)) {
      if (part.length > 0) signalStems.add(part);
    }
  }
  const excluded = (token: string): boolean => {
    if (isOrdinaryWord(token)) return true;
    const folded = foldForSignals(token);
    if (signalStems.has(folded)) return true;
    // `Werksleiterin` against the entry `werksleiter`: the same bounded
    // ending `signals.ts` allows, so the exclusion cannot be defeated by
    // inflecting the role word.
    for (const stem of signalStems) {
      if (stem.length >= 5 && folded.startsWith(stem) && folded.length - stem.length <= 5) return true;
    }
    return false;
  };

  for (const tokens of tokenSequences(text)) {
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i] ?? "";
      const next = tokens[i + 1] ?? "";
      if (next === "" || !CAPITALISED.test(next) || excluded(next)) continue;
      if (NAME_TITLES.has(token.toLowerCase().replace(/[.]$/, ""))) {
        found.add("titled-name-span");
        continue;
      }
      // The first token of a sentence is capitalised by grammar, not by being
      // a name — but a name is very often exactly there, so it counts as long
      // as it is not an ordinary word. That is the whole content of the
      // stoplist above.
      if (CAPITALISED.test(token) && !excluded(token)) found.add("name-shaped-span");
    }
  }

  for (const token of text.split(IDENTIFIER_SPLIT)) {
    if (looksLikeIdentifier(token)) {
      found.add("identifier-shaped-token");
      break;
    }
  }

  if (signalHits(text, PERSON_REFERENT_SIGNALS).length > 0) found.add("person-referent-word");

  return TEXT_INDICATIONS.filter((i) => found.has(i));
}

/**
 * The indications that mean "something in this text may still BE an
 * identifier", as opposed to "this text is about a person".
 *
 * The split matters to `assessTier`: an unresolved name-shaped span is
 * residual identifying CONTENT and is treated like residue, whereas a
 * person-referent word only establishes that a natural person is the subject
 * and carries the ordinary Recital 26 floor of 3.
 */
export const UNRESOLVED_IDENTIFIER_INDICATIONS: ReadonlySet<TextIndication> = new Set<TextIndication>([
  "name-shaped-span",
  "titled-name-span",
  "identifier-shaped-token",
]);
