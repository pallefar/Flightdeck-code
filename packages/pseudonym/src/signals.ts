/**
 * QUASI-IDENTIFIER AND SPECIAL-CATEGORY SIGNALS — authored here, and the
 * honest limits of them stated up front.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A "SIGNAL" IS AND IS NOT
 * ─────────────────────────────────────────────────────────────────────────
 * Tokenization removes DIRECT identifiers. What it cannot remove is context:
 *
 *     "the works council at Bensheim rejected <person:1>'s fixed-term
 *      contract on <date:2>"
 *
 * There is no name in that sentence and it identifies a person, because the
 * population it selects from is small. That is the quasi-identifier problem,
 * and no scanner solves it — solving it needs the population size, which is
 * in the world, not in the string.
 *
 * So these lists do NOT claim to detect re-identifiability. They detect
 * PHRASES THAT INDICATE A NARROW POPULATION, and they are used in one
 * direction only: to REFUSE a tier reduction. A hit means "not reducible
 * below 3". A miss means nothing at all — `assessTier` never reduces past 3
 * on the strength of a miss, precisely because absence of a listed word is
 * not evidence of a large population.
 *
 * A one-directional detector is allowed to be incomplete. One used in both
 * directions would not be, and that is the difference between this file and
 * a false assurance.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THESE WORDS
 * ─────────────────────────────────────────────────────────────────────────
 * German employment law, which is the domain: a `Betriebsrat` exists per
 * site, a `Standort` names one of a handful, a `Geschäftsführer` is a
 * singleton per entity. Each of these turns "an employee" into "one of very
 * few". The English equivalents are carried because the payload may be in
 * either language — and because the MODEL may answer in either, so
 * `assessTier` can be run on model output too.
 *
 * Matching is on a STEM plus a bounded ending, over a lowercased,
 * umlaut-folded copy of both the text AND the list entry — so
 * `Geschäftsführer`, `Geschaeftsfuehrer`, `geschaftsfuhrer` and
 * `Geschäftsführerin` all hit. The full argument, and the stated cost of the
 * window, is at `signalStem` below. All three lists are compiled-in
 * constants, so a reported signal is loggable — it names a word from this
 * file, never a span of the scanned text.
 */

/** GDPR Art. 9 — the categories whose processing is prohibited absent a
 * specific condition. In the payload these appear as PROSE, not field names;
 * `packages/guardrails` covers the field-name side and this is the free-text
 * side of the same concern. Overlap with that list is deliberate: they are
 * consulted in different places. */
export const SPECIAL_CATEGORY_SIGNALS: readonly string[] = [
  // health
  "arbeitsunfahig",
  "arbeitsunfahigkeit",
  "krankmeldung",
  "krankschreibung",
  // Separable-prefix participles. `signalStem` trims a TAIL, so it can never
  // reach `krankgemeldet` from `krankmeldung` — the `ge` infix is not a tail.
  // Carried as their own entries rather than pretended to be covered.
  "krankgemeldet",
  "krankgeschrieben",
  "arztlich",
  "betriebsarzt",
  "gesundheitszustand",
  "psychisch",
  "therapie",
  "rehabilitation",
  "krankheit",
  "diagnose",
  "attest",
  "schwerbehinderung",
  "schwerbehindert",
  "behinderung",
  "wiedereingliederung",
  "mutterschutz",
  "schwanger",
  "schwangerschaft",
  "sick leave",
  "sick note",
  "medical certificate",
  "disability",
  "diagnosis",
  "pregnancy",
  "pregnant",
  "occupational health",
  // trade union membership
  "gewerkschaft",
  "gewerkschaftsmitglied",
  "verdi",
  "ig metall",
  "trade union",
  "union member",
  "union membership",
  // religion
  "kirchensteuer",
  "konfession",
  "religionszugehorigkeit",
  "church tax",
  "religious denomination",
  // racial/ethnic origin, political opinion, sexual orientation
  "ethnische herkunft",
  "ethnic origin",
  "ethnicity",
  "racial origin",
  "political opinion",
  "parteimitglied",
  "sexual orientation",
  "sexuelle orientierung",
];

/** Words that narrow the population a pseudonymised person is drawn from.
 * A hit refuses a reduction; a miss proves nothing. */
export const QUASI_IDENTIFIER_SIGNALS: readonly string[] = [
  // works constitution bodies — one per site, membership is public inside it
  "betriebsrat",
  "betriebsratsvorsitzende",
  "betriebsratsvorsitzender",
  "gesamtbetriebsrat",
  "konzernbetriebsrat",
  "schwerbehindertenvertretung",
  // The `-vertreter` derivation is a different stem from `-vertretung`, so
  // the person form needs its own entry; `-vertreterin` is then in the window.
  "schwerbehindertenvertreter",
  "vertrauensperson",
  "wahlvorstand",
  "datenschutzbeauftragte",
  "jugend- und auszubildendenvertretung",
  "works council",
  "works agreement",
  "betriebsvereinbarung",
  // site / org unit — turns "an employee" into "one of the people at X"
  "standort",
  "werk",
  "niederlassung",
  "filiale",
  "abteilung",
  "fachbereich",
  "kostenstelle",
  "staatsangehorigkeit",
  "site",
  "plant",
  "branch office",
  "department",
  "cost centre",
  "cost center",
  // singleton roles — one holder per entity
  "geschaftsfuhrer",
  "geschaftsfuhrerin",
  "prokurist",
  "prokuristin",
  "vorstand",
  "werksleiter",
  "standortleiter",
  "abteilungsleiter",
  "bereichsleiter",
  "teamleiter",
  "personalleiter",
  "personalleiterin",
  "leitender angestellter",
  "managing director",
  "chief executive",
  "ceo",
  "cfo",
  "coo",
  "head of",
  "plant manager",
  "site manager",
  // explicit small-population language
  "der einzige",
  "die einzige",
  "das einzige",
  "einzige mitarbeiter",
  "einziger mitarbeiter",
  "the only",
  "the sole",
  "sole employee",
  "only employee",
];

/**
 * Words that say a NATURAL PERSON is the subject of the text, without naming
 * one. `Der Mitarbeiter hat Urlaub beantragt` has no identifier in it and is
 * unambiguously about a person.
 *
 * This list exists because `assessTier` used to decide "is a natural person
 * involved?" from the VAULT alone — so a payload whose person was never
 * tokenized (an undeclared name, a re-encoded address) read as impersonal and
 * earned an affirmative clean verdict. The text gets a vote now, and this is
 * one of the things it votes with.
 *
 * Same one-directional contract as the two lists above: a hit refuses a
 * reduction, a miss proves nothing.
 */
export const PERSON_REFERENT_SIGNALS: readonly string[] = [
  "mitarbeiter",
  "mitarbeiterin",
  "beschaftigte",
  "angestellte",
  "arbeitnehmer",
  "kollege",
  "kollegin",
  "bewerber",
  "bewerberin",
  "praktikant",
  "auszubildende",
  "antragsteller",
  "betroffene",
  "herr",
  "frau",
  "employee",
  "colleague",
  "candidate",
  "applicant",
  "staff member",
  "data subject",
];

/** Lowercase and fold the German umlauts and eszett, so one spelling of a
 * signal catches all of them. Applied to the SCANNED text and, at module
 * load, to the lists themselves — which is why the lists above are written
 * already folded. */
export function foldForSignals(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY MATCHING IS ON A STEM AND NOT ON A WHOLE WORD
 * ─────────────────────────────────────────────────────────────────────────
 * It used to be `\b<entry>\b` — the entry as a whole word, both ends
 * anchored. That is one-representation anchoring again, and the representation
 * it was anchored on was ONE SURFACE FORM OF A WORD:
 *
 *     "Krankmeldung"                hit       "Krankmeldungen"   MISSED
 *     "Betriebsrat"                 hit       "Betriebsrätin"    MISSED
 *     "Schwerbehindertenvertretung" hit       "…vertreterin"     MISSED
 *
 * A sick-leave document written in ordinary inflected German therefore lost
 * the Art. 9 floor entirely. German is an inflecting language; a list of
 * nominative singulars is a list of one spelling each, and the whole-word
 * anchor made that the only spelling that counted.
 *
 * So an entry is now matched as STEM + A BOUNDED ENDING:
 *
 *   1. the entry is FOLDED (`foldForSignals`) before anything else. This also
 *      fixes a latent miss — the list was required to be "written already
 *      folded" and `sexuelle orientierung` was not (folding turns `ue` into
 *      `u`, so the entry could never match its own folded text).
 *   2. ONE derivational tail is trimmed if the entry is long enough and the
 *      remainder is still at least `STEM_MIN` characters: `krankmeldung` →
 *      `krankmeld`, `schwerbehindertenvertretung` → `schwerbehindertenvertret`,
 *      `krankheit` → `krank`, `prokurist` → `prokur`.
 *   3. the match is `\b` + stem + up to `SUFFIX_WINDOW` more letters + `\b`.
 *      BOTH ends are still anchored — the trailing `\b` is what keeps this a
 *      bounded ending rather than a prefix match, and it is why
 *      `bewerkstelligt` still does not fire anything.
 *
 * Entries shorter than `STEMMABLE_MIN` are matched as whole words exactly as
 * before. That is not timidity, it is the difference between a signal and
 * noise: `verdi` + an ending would fire on `verdient`, and `werk` + an ending
 * would fire on `Werkzeug`.
 *
 * ⚠ STATED COST: the window admits compounds nobody listed — `sick note`
 * reaches `sick nothing`, `head of` reaches `head office`. Every one of those
 * is a FALSE POSITIVE IN THE SAFE DIRECTION: a hit only ever REFUSES a tier
 * reduction. A miss ships a document. The asymmetry is the whole reason these
 * lists are one-directional, and it is why the window is not tightened
 * further.
 *
 * ⚠ STATED LIMIT: a stem is not a lemmatiser. Separable-prefix verb forms
 * (`krankgemeldet` from `Krankmeldung`) are NOT reachable by trimming a tail,
 * so the forms that matter in this domain are carried as their own entries
 * above rather than pretended to be covered.
 */

/** An entry must be at least this long before any ending is allowed. */
const STEMMABLE_MIN = 6;
/** What is left after trimming a tail must be at least this long. */
const STEM_MIN = 5;
/** How many extra letters may follow the stem before the word must end. */
const SUFFIX_WINDOW = 5;

/** German and English derivational/inflectional tails, LONGEST FIRST so that
 * `ungen` is trimmed before `en` and `erin` before `in`. Only one is ever
 * trimmed. Each is short enough that the window can still reach the entry's
 * own spelling, which is checked by `signalPattern`. */
const DERIVATIONAL_TAILS: readonly string[] = [
  "ungen",
  "ung",
  "heit",
  "keit",
  "isch",
  "erin",
  "ist",
  "ern",
  "en",
  "er",
  "in",
  "es",
  "is",
  "e",
  "s",
  "y",
];

/**
 * The stem a signal entry is matched by. Exported so a test — and a reader —
 * can see exactly what each entry was reduced to rather than trusting that
 * the reduction was sensible.
 */
export function signalStem(signal: string): string {
  const folded = foldForSignals(signal);
  if (folded.length < STEMMABLE_MIN) return folded;
  for (const tail of DERIVATIONAL_TAILS) {
    if (tail.length > SUFFIX_WINDOW) continue; // the window could not reach the entry again
    if (!folded.endsWith(tail)) continue;
    const stem = folded.slice(0, folded.length - tail.length);
    if (stem.length >= STEM_MIN && /[a-z]$/.test(stem)) return stem;
  }
  return folded;
}

/** `\b` stem `[a-z]{0,N}` `\b`. Both ends anchored: the window is a bounded
 * ENDING, never an open prefix. */
function signalPattern(signal: string): RegExp {
  const folded = foldForSignals(signal);
  const stem = signalStem(signal);
  if (stem === folded && folded.length < STEMMABLE_MIN) {
    return new RegExp(`\\b${escapeRegExp(folded)}\\b`);
  }
  return new RegExp(`\\b${escapeRegExp(stem)}[a-z]{0,${SUFFIX_WINDOW}}\\b`);
}

/** Compiled once. The lists are module constants, so the cache is bounded by
 * them and cannot be grown by scanned text. */
const PATTERN_CACHE = new Map<string, RegExp>();

function patternFor(signal: string): RegExp {
  const cached = PATTERN_CACHE.get(signal);
  if (cached !== undefined) return cached;
  const built = signalPattern(signal);
  PATTERN_CACHE.set(signal, built);
  return built;
}

/**
 * Which listed signals appear in `text`, as a stem plus a bounded ending.
 *
 * Returns the LIST ENTRY that matched — a compiled-in constant — never the
 * span of `text` that matched it, so a hit is safe to put in an audit event.
 */
export function signalHits(text: string, signals: readonly string[]): string[] {
  const folded = foldForSignals(text);
  const hits: string[] = [];
  for (const signal of signals) {
    if (patternFor(signal).test(folded)) hits.push(signal);
  }
  return [...new Set(hits)].sort();
}
