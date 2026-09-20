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
 * Matching is on THE WHOLE ENTRY plus one ending from a closed inflection
 * list, over a lowercased, umlaut-folded copy of both the text AND the list
 * entry — so `Geschäftsführer`, `Geschaeftsfuehrer`, `geschaftsfuhrer` and
 * `Geschäftsführerin` all hit, while `Psychologe` does not hit `psychisch`
 * and `behindert` does not hit `behinderung`. The full argument, and what the
 * closed list costs, is at `signalPattern` below. All three lists are
 * compiled-in constants, so a reported signal is loggable — it names a word
 * from this file, never a span of the scanned text.
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
  // Separable-prefix participles. An entry is matched as ITSELF plus an
  // inflectional ending, so `krankgemeldet` is not reachable from
  // `krankmeldung`. Carried as their own entries rather than pretended to be
  // covered — the same answer this file gives for every derivation that is
  // not the entry plus an ending.
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
  // English `-y` -> `-ies` and `-is` -> `-es` are not the entry plus an
  // ending, so they are their own entries rather than reached by a stem.
  "disabilities",
  "diagnosis",
  "diagnoses",
  "pregnancy",
  "pregnancies",
  "pregnant",
  "occupational health",
  // trade union membership
  "gewerkschaft",
  "gewerkschaftsmitglied",
  "verdi",
  "ig metall",
  "trade union",
  "trade unions",
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
 * WHY AN ENTRY IS MATCHED AS ITSELF PLUS A BOUNDED INFLECTION
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
 * ⚠ THE FIRST FIX FOR THAT WAS TOO WIDE, AND THIS IS THE SECOND. It TRIMMED A
 * DERIVATIONAL TAIL off the entry and then allowed up to five arbitrary
 * letters after the remainder. The trimmed remainder is frequently a
 * DIFFERENT WORD, so the window walked straight into unrelated vocabulary:
 *
 *     schwanger    -> schwang   -> `schwangen`  (past tense of *schwingen*)
 *     behinderung  -> behinder  -> `behindert`  (the ordinary verb *behindern*)
 *     abteilung    -> abteil    -> `Abteil`     (a train compartment)
 *     psychisch    -> psych     -> `Psychologe`
 *     head of      -> head of   -> `head office`
 *
 * The first two fire the Art. 9 floor — the one floor `assessTier` will not
 * reduce — so a false positive there is the expensive kind: an ordinary
 * sentence pins a whole document at tier 4 forever. A one-directional
 * detector is allowed to be incomplete; it is NOT licensed to be wrong about
 * words it never listed, because "a hit only refuses a reduction" stops being
 * a cheap cost once the hit is unconditional.
 *
 * So NOTHING IS TRIMMED ANY MORE. An entry is matched as:
 *
 *     `\b` + the FOLDED ENTRY IN FULL + one optional ending from
 *     `SIGNAL_INFLECTIONS` + `\b`
 *
 * Both ends are still anchored, and the ending comes from a CLOSED LIST of
 * German and English inflectional endings rather than from a window of
 * arbitrary letters. That is what makes the match a form OF THE ENTRY instead
 * of any word that happens to start with a fragment of it:
 *
 *     krankmeldung   + en     -> `Krankmeldungen`                ✓
 *     betriebsrat    + in     -> `Betriebsrätin`                 ✓ (folded)
 *     betriebsrat    + s      -> `Betriebsrats`                  ✓
 *     werksleiter    + in     -> `Werksleiterin`                 ✓
 *     abteilung      + en     -> `Abteilungen`                   ✓
 *     schwanger      + e/en   -> `schwangere`, `schwangeren`     ✓
 *     schwanger      + —      -> `schwangen`                     ✗ not a form
 *     behinderung    + —      -> `behindert`                     ✗ not a form
 *     abteilung      + —      -> `Abteil`                        ✗ not a form
 *     psychisch      + —      -> `Psychologe`                    ✗ not a form
 *     head of        + —      -> `head office`                   ✗ not a form
 *
 * ⚠ WHAT THAT COSTS, STATED: a derivation that is not the entry plus an
 * ending is no longer reachable — `Schwerbehindertenvertreterin` cannot be
 * produced from `…vertretung`, and `disabilities` cannot be produced from
 * `disability`. Those forms are CARRIED AS THEIR OWN ENTRIES above, which is
 * the same answer this file already gave for separable-prefix participles
 * (`krankgemeldet`). A listed form is a form somebody decided on; a trimmed
 * stem plus five letters was a form nobody had looked at.
 *
 * ⚠ AND ONE ENTRY IS AN ORDINARY VERB. English `plant` (and German `plant`,
 * from *planen*) is a verb as often as it is a site, so `We plant trees` and
 * `Die Abteilung plant eine Umstrukturierung` both fired the site signal.
 * `NOUN_ONLY_SIGNALS` requires a determiner or preposition in front of those
 * entries, which is the cheapest approximation of "used as a noun" that does
 * not need a parser.
 */

/** German and English inflectional endings an entry may carry. A CLOSED list:
 * every one of these turns the entry into a FORM OF THE ENTRY, never into a
 * different word. Longest first for readability; the regex backtracks anyway. */
const SIGNAL_INFLECTIONS: readonly string[] = [
  "innen", // Betriebsrätinnen
  "ern", // Werken
  "nen", // Kolleginnen after a trailing -in entry
  "en", // Krankmeldungen, Gewerkschaften
  "es", // Betriebsrates, offices
  "er", // Standorter, managers
  "in", // Betriebsrätin, Werksleiterin
  "e", // Standorte, schwangere
  "n", // Diagnosen, Therapien
  "s", // Betriebsrats, departments
];

/**
 * Entries that are an ordinary VERB in their own language as well as a noun
 * on this list. They count only where a determiner or preposition puts them
 * in noun position — `at the plant` yes, `we plant trees` no.
 *
 * Kept as a named set of TWO characters of policy rather than deleted from
 * the list: `the plant` genuinely narrows a population and dropping it would
 * be a miss, which is the expensive direction.
 */
const NOUN_ONLY_SIGNALS: ReadonlySet<string> = new Set(["plant"]);

/** Determiners and prepositions that put the next word in noun position.
 * Folded, lowercase — the same shape the scanned text is folded into. */
const NOUN_DETERMINERS: readonly string[] = [
  "the", "a", "an", "our", "your", "their", "its", "his", "her", "this", "that",
  "these", "those", "each", "every", "one", "another", "any", "no",
  "at", "in", "on", "from", "to", "of", "per", "near", "by", "for",
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem",
  "eines", "einer", "im", "am", "zum", "zur", "vom", "unser", "unsere", "unserem",
];

/**
 * The form a signal entry is matched by. Exported so a test — and a reader —
 * can see exactly what each entry was reduced to rather than trusting that
 * the reduction was sensible.
 *
 * ⚠ THE ANSWER IS NOW "NOTHING WAS REDUCED": this returns the folded entry IN
 * FULL. It kept its name because the previous answer — a trimmed stem — was
 * the defect, and a reader who checks this function is entitled to see that
 * the reduction is gone rather than to find the function gone.
 */
export function signalStem(signal: string): string {
  return foldForSignals(signal);
}

/** `\b` entry `(?:ending)?` `\b`, with a determiner required in front of the
 * handful of entries that are also ordinary verbs. Both ends anchored, and
 * the ending comes from a closed list, so the match is always a FORM OF THE
 * ENTRY and never a word that merely begins like one. */
function signalPattern(signal: string): RegExp {
  const folded = foldForSignals(signal);
  const endings = SIGNAL_INFLECTIONS.map(escapeRegExp).join("|");
  const word = `\\b${escapeRegExp(folded)}(?:${endings})?\\b`;
  if (!NOUN_ONLY_SIGNALS.has(folded)) return new RegExp(word);
  return new RegExp(`\\b(?:${NOUN_DETERMINERS.map(escapeRegExp).join("|")})\\s+${word}`);
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
