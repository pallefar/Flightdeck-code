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
 * Matching is on word boundaries over a lowercased, umlaut-folded copy, so
 * `Geschäftsführer`, `Geschaeftsfuehrer` and `geschaftsfuhrer` all hit. Both
 * lists are compiled-in constants, so a reported signal is loggable — it names
 * a word from this file, never a span of the scanned text.
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
 * Which listed signals appear in `text`, as whole words.
 *
 * Returns the LIST ENTRY that matched — a compiled-in constant — never the
 * span of `text` that matched it. `\b` on both ends so `werk` does not fire
 * on `Bewerkstelligung` and `bem` does not fire on `bemerkt`.
 */
export function signalHits(text: string, signals: readonly string[]): string[] {
  const folded = foldForSignals(text);
  const hits: string[] = [];
  for (const signal of signals) {
    if (new RegExp(`\\b${escapeRegExp(signal)}\\b`).test(folded)) hits.push(signal);
  }
  return [...new Set(hits)].sort();
}
