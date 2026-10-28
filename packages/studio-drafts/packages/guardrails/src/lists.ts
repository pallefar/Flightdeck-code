/**
 * STUDIO'S COPIES OF THE HOST'S SECURITY LISTS — and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A COPY EXISTS AT ALL
 * ─────────────────────────────────────────────────────────────────────────
 * Studio is a separate checkout from `pallefar/project-contract`. It cannot
 * `import` the host's `server/services/ai/envelope.ts` or `server/widgets/
 * types.ts` — different tsconfig, different module graph, and at runtime the
 * host may not be on disk at all. So the lists are carried.
 *
 * The host says the quiet part out loud in its own gateway test
 * (`flightdeck/tests/aiProxyEdgeFunction.test.ts:12`):
 *
 *     "Two copies of a security list that can silently diverge is worse than
 *      one. These cases are the mechanism that makes the duplication safe —
 *      they FAIL on divergence, in either direction."
 *
 * That mechanism, for these copies, is `__tests__/divergence.test.ts`. It
 * reads the host's TWO source files off disk and compares them entry by entry
 * against this file. If the host adds a pattern and Studio does not, it goes
 * red and names the entry and the direction. There is no other justification
 * for the duplication and no other thing keeping it honest.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT MAY BE EDITED HERE
 * ─────────────────────────────────────────────────────────────────────────
 * HOST_* below are transcriptions. Editing one without the same edit in the
 * host is not a fix — it is the divergence the test exists to catch. The only
 * list authored HERE is `SPECIAL_CATEGORY_*` (GDPR Art. 9), which the host has
 * no equivalent of; it is excluded from the divergence comparison by
 * construction, because it is not a copy of anything.
 */

// ─────────────────────────────────────────────────────────────────────────
// COPY 1 — envelope.ts `PII_PATTERNS`
// ─────────────────────────────────────────────────────────────────────────

/** Transcribed from `flightdeck/server/services/ai/envelope.ts`.
 *
 * ORDER IS LOAD-BEARING and is part of what the divergence test compares:
 * the host's header says `email` must run before `digits`, "otherwise a
 * numeric local-part would be partly eaten and the address would survive as a
 * recognisable fragment". `scrub()` in `./scrub.ts` walks this array in order
 * for exactly that reason. */
export interface PiiPattern {
  readonly name: string;
  readonly re: RegExp;
  readonly placeholder: string;
}

export const PII_PATTERNS: readonly PiiPattern[] = [
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, placeholder: "<email>" },
  { name: "iban", re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}\b/g, placeholder: "<iban>" },
  { name: "digits", re: /\b\d[\d /.-]{5,}\d\b/g, placeholder: "<number>" },
  { name: "amount", re: /(?:€|EUR|\bUSD\b|\$)\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|EUR)/g, placeholder: "<amount>" },
  { name: "date", re: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})\b/g, placeholder: "<date>" },
];

/** Every class name the host can report. Used to check that a finding's
 * `class` is drawn from a constant vocabulary rather than from data — the
 * property that lets a finding be logged at all. */
export const PII_PATTERN_NAMES: readonly string[] = PII_PATTERNS.map((p) => p.name);

// ─────────────────────────────────────────────────────────────────────────
// COPY 2 — widgets/types.ts `PII_DENIED_SEGMENTS` / `PII_DENIED_SUBSTRINGS`
// ─────────────────────────────────────────────────────────────────────────

/** Transcribed from `flightdeck/server/widgets/types.ts`.
 *
 * The host's own distinction, kept verbatim: SEGMENTS are matched as a whole
 * normalized path segment because their names are generic ("city" must not
 * block "capacity"); SUBSTRINGS are matched anywhere because they "have no
 * legitimate appearance in an overview at all". */
export const PII_DENIED_SEGMENTS: readonly string[] = [
  "person",
  "personname",
  "employeename",
  "candidatename",
  "name",
  "firstname",
  "lastname",
  "surname",
  "email",
  "phone",
  "mobile",
  "dob",
  "street",
  "postcode",
  "zip",
  "city",
  "houseno",
  "housenumber",
];

export const PII_DENIED_SUBSTRINGS: readonly string[] = [
  "salary",
  "compensation",
  "address",
  "iban",
  "bankaccount",
  "ssn",
  "socialsecurity",
  "taxid",
  "birthdate",
  "dateofbirth",
];

/** The host's `normalize` from `widgets/types.ts`, transcribed: lowercase and
 * strip everything that is not a letter or digit, so `salary_eur`, `salaryEUR`
 * and `salary-eur` all normalize alike. */
export function normalizeToken(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ─────────────────────────────────────────────────────────────────────────
// FOLDING — the host's normalize is not enough on its own
// ─────────────────────────────────────────────────────────────────────────

/**
 * `normalizeToken` is a transcription and stays one: it is compared against
 * the host's `normalize` by `__tests__/divergence.test.ts` and reproduced by
 * `deniedPiiField`. It also has a hole that only shows up on input the host
 * never sees, because the host reads field names its own schema declared and
 * Studio reads field names a CALLER chose:
 *
 *     normalizeToken("\uFF53alary")  === "alary"   // fullwidth s, DELETED
 *     normalizeToken("ib\u0430n")    === "ibn"     // Cyrillic a, DELETED
 *
 * `[^a-z0-9]` deletes a homoglyph rather than folding it, so a one-codepoint
 * substitution does not just evade the denylist — it produces a NEW token that
 * matches nothing, and the tier-4 hit is silently lost. That is the same class
 * of failure as the rest of this round: a control anchored on ONE
 * representation of a name while an identical-looking second representation
 * reaches the same place.
 *
 * So matching folds first:
 *   1. NFKC          — fullwidth, circled, ligature and compatibility forms.
 *   2. confusables   — Cyrillic/Greek lookalikes mapped to their Latin twin.
 *   3. mark stripping — combining accents removed (NFD, drop \p{M}).
 *   4. the host's own `normalizeToken`, unchanged, on the folded text.
 *
 * Folding is ADDITIVE: every token the host's normalize matched still matches,
 * because step 4 is the host's function and steps 1-3 are the identity on
 * plain ASCII.
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic → Latin
  "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
  "\u0445": "x", "\u0443": "y", "\u0456": "i", "\u0458": "j", "\u0455": "s",
  "\u04bb": "h", "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041a": "K",
  "\u041c": "M", "\u041d": "H", "\u041e": "O", "\u0420": "P", "\u0421": "C",
  "\u0422": "T", "\u0425": "X", "\u0406": "I", "\u0405": "S", "\u0408": "J",
  // Greek → Latin
  "\u03b1": "a", "\u03b2": "b", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k",
  "\u03bd": "v", "\u03bf": "o", "\u03c1": "p", "\u03c3": "o", "\u03c4": "t",
  "\u03c5": "u", "\u03c7": "x", "\u0391": "A", "\u0392": "B", "\u0395": "E",
  "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039a": "K", "\u039c": "M",
  "\u039d": "N", "\u039f": "O", "\u03a1": "P", "\u03a4": "T", "\u03a5": "Y",
  "\u03a7": "X",
  // Latin lookalikes that survive NFKC
  "\u0131": "i", "\u0142": "l", "\u00f8": "o", "\u0111": "d",
  // German sharp s, expanded the way German expands it
  "\u00df": "ss",
};

/** NFKC + confusable folding + accent stripping, CASE PRESERVED. Case is kept
 * because `splitTokens` needs camelCase boundaries, which `normalizeToken`
 * destroys. */
export function foldChars(part: string): string {
  let out = "";
  for (const ch of part.normalize("NFKC")) out += CONFUSABLES[ch] ?? ch;
  return out.normalize("NFD").replace(/\p{M}+/gu, "");
}

/** The host's `normalizeToken`, applied to folded text. This is what every
 * denylist match in this package goes through. */
export function foldToken(part: string): string {
  return normalizeToken(foldChars(part));
}

/**
 * WORD TOKENS of a field name — `ageAtSigning` → `["age","at","signing"]`.
 *
 * `normalizeToken` deliberately destroys word boundaries so that `salary_eur`,
 * `salaryEUR` and `salary-eur` compare equal. That is right for the host's two
 * lists, whose SEGMENTS are matched against whole path segments, and it is why
 * a generic word can only ever be listed as a segment: `age` cannot be a
 * substring rule because `package`, `storage`, `message` and `average` all
 * contain it.
 *
 * But a caller does not have to use a separator. `ageAtSigning` normalizes
 * whole to `ageatsigning`, which is neither the segment `age` nor a substring
 * anything may safely match — so a generic word is undetectable in camelCase
 * however it is listed. Splitting on camel and letter/digit boundaries as well
 * as on punctuation gives a generic word a safe home, and it is used ONLY for
 * the Studio-authored lists below: the host's segment list keeps the host's
 * exact segment semantics, because widening `name` to every `tableName` and
 * `columnName` is precisely the "fires on every spec" failure that
 * `ClassifyMode` exists to avoid.
 */
export function splitTokens(raw: string): string[] {
  return foldChars(raw)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────
// AUTHORED HERE — GDPR Art. 9 special categories
// ─────────────────────────────────────────────────────────────────────────

/** Art. 9(1) special categories, as FIELD-NAME tokens. Not a copy of anything
 * in the host, so the divergence test does not compare it.
 *
 * ⚠ STATED LIMIT, because an unstated one is a lie: special categories are
 * detected by NAME, never by reading the value. There is no regex for "this
 * sentence discloses a health condition", and a guess dressed as a detector
 * would be worse than a documented gap. A free-text field whose NAME is
 * innocent and whose VALUE discloses a diagnosis classifies on its value's
 * patterns alone (tier 3 at best) and is NOT raised to 4. The mitigation is
 * `gateWorkflowIntake`, which refuses free text wholesale rather than
 * pretending to understand it.
 *
 * Split on the same rule the host uses for its own two tiers: unambiguous
 * compounds match anywhere; single generic words must be a whole segment,
 * because "health" appears in "health check" and "union" in "unionize". */
export const SPECIAL_CATEGORY_SUBSTRINGS: readonly string[] = [
  "unionmembership",
  "tradeunion",
  "gewerkschaft",
  "healthdata",
  "healthstatus",
  "medicalrecord",
  "medicalcertificate",
  "sicknote",
  "bloodtype",
  "geneticdata",
  "biometric",
  "fingerprint",
  "sexualorientation",
  "sexlife",
  "ethnicorigin",
  "ethnicity",
  "racialorigin",
  "politicalopinion",
  "politicalaffiliation",
  // German employment/payroll specifics that disclose an Art. 9 category
  // outright: church tax and denomination disclose religion; Schwerbehinderung
  // and Mutterschutz disclose health.
  "kirchensteuer",
  "konfession",
  "religionszugehoerigkeit",
  "schwerbehinderung",
  "schwerbehindert",
  "mutterschutz",
];

export const SPECIAL_CATEGORY_SEGMENTS: readonly string[] = [
  "health",
  "medical",
  "diagnosis",
  "disability",
  "religion",
  "religious",
  "creed",
  "race",
  "union",
  "genetics",
  "biometrics",
  "pregnancy",
];

// ─────────────────────────────────────────────────────────────────────────
// Tier 2 — the "contract/ticket data carrying no person fields" vocabulary
// ─────────────────────────────────────────────────────────────────────────

/** A hit here is tier 2 (Internal) and ONLY ever tier 2: it is the floor for
 * business data, never a ceiling, and the higher-tier-wins rule in
 * `./tiers.ts` means a tier-2 token on the same object as a tier-4 one cannot
 * pull the result down. */
export const BUSINESS_SEGMENTS: readonly string[] = [
  "contract",
  "contractid",
  "ticket",
  "ticketid",
  "template",
  "revision",
  "entity",
  "site",
  "band",
  "scope",
  "clause",
  "status",
  "step",
  "workflow",
  "process",
  "pack",
];

// ─────────────────────────────────────────────────────────────────────────
// AUTHORED HERE — the vocabulary the host's two lists do not carry
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠ NOT A COPY, AND DELIBERATELY NOT ADDED TO THE HOST LISTS ABOVE.
 *
 * Adding `remuneration` to `PII_DENIED_SUBSTRINGS` would turn Studio's copy
 * into a fork of the host's list and `__tests__/divergence.test.ts` would go
 * red naming the entry — correctly, because a transcription that gains an
 * entry is no longer a transcription. So the additions live in their own
 * lists, on the same footing as `SPECIAL_CATEGORY_*`: authored here, excluded
 * from the divergence comparison by construction, and asserted DISJOINT from
 * the host lists so the comparison stays meaningful.
 *
 * What they are for: the host's compensation vocabulary is one English word,
 * `salary`, plus `compensation`. The class of failure that costs is not "one
 * word is missing" — it is "the control is anchored on ONE spelling of the
 * thing", which is the same disease as anchoring on one representation. A
 * German payroll product whose data says `Gehalt`, an HR export that says
 * `payBand`, and a contract that says `annualRemuneration` all carry category
 * 4 pay data and none of them contains the substring `salary`.
 *
 * Every entry below is a word that has no ordinary non-personal use as a field
 * name. Words that DO — `pay` (payment, payload), `bonus` (bonus points),
 * `earnings` (a company's) — are deliberately absent: a gate that fires on
 * every checkout form gets rubber-stamped, which is the same end state as no
 * gate.
 */
export const STUDIO_RESTRICTED_SUBSTRINGS: readonly string[] = [
  // compensation, in the spellings the host list misses
  "remuneration",
  "payband",
  "payrate",
  "payscale",
  "payslip",
  "payroll",
  "grosspay",
  "netpay",
  "basepay",
  "takehome",
  "gehalt",
  "lohn",
  "vergutung",
  "verguetung",
  "bezuge",
  "bezuege",
  "honorar",
  // bank and government identifiers the host names only in one spelling
  "bankdetails",
  "accountnumber",
  "accountno",
  "sortcode",
  "swiftbic",
  "creditcard",
  "cardnumber",
  "passportnumber",
  "passportno",
  "nationalinsurance",
  "insurancenumber",
  "steuernummer",
  "sozialversicherung",
  "personalnummer",
  // date and place of birth, and the German address words `address` misses
  "geburtsdatum",
  "geburtstag",
  "geburtsort",
  "adresse",
  "anschrift",
  "wohnort",
];

/** Tier 4, matched as a WHOLE WORD TOKEN (`splitTokens`), because these are
 * short enough that a substring rule would collide: `wage` is inside `wager`,
 * `cvv` inside nothing useful but kept here for symmetry. */
export const STUDIO_RESTRICTED_TOKENS: readonly string[] = [
  "wage",
  "wages",
  "salaries",
  "stipend",
  "cvv",
  "cvc",
  "pin",
];

/**
 * Tier 3 — person attributes that are not special categories and not on the
 * host's segment list. Whole word tokens only, for the reason in
 * `splitTokens`: `age` as a substring matches `package`.
 */
export const STUDIO_PERSONAL_TOKENS: readonly string[] = [
  "age",
  "ages",
  "birthday",
  "nationality",
  "citizenship",
  "gender",
  "geschlecht",
  "familienstand",
  "maritalstatus",
  "telefon",
  "handynummer",
];

/**
 * Field names that REFER TO A PERSON without being a person's name.
 *
 * On their own these are worth nothing: `owner` is a resource owner as often
 * as a human, and making `owner` a tier-3 field name by itself would put every
 * dashboard spec in the approval queue. They are used ONLY in combination with
 * a value that is SHAPED like a personal name (`looksLikePersonName`), which
 * is the whole rule: a person-referring field name plus a name-shaped value is
 * a person, and neither half alone is.
 *
 * ⚠ STATED RESIDUAL: this is a heuristic over a class no regex can decide.
 * `{ owner: "Open Items" }` is a false positive and `{ note: "ask Erika" }` is
 * a false negative. `declaredNames` remains the reliable route and is still
 * the caller's one obligation; this pair rule is what closes the case where
 * the caller declared nothing at all.
 */
export const PERSON_REFERENT_TOKENS: readonly string[] = [
  "owner",
  "assignee",
  "contact",
  "employee",
  "candidate",
  "applicant",
  "requester",
  "reporter",
  "manager",
  "supervisor",
  "worker",
  "colleague",
  "participant",
  "attendee",
  "recipient",
  "approver",
  "signatory",
  "mitarbeiter",
  "ansprechpartner",
  "kollege",
  "teilnehmer",
  "inhaber",
];

/**
 * Denylist tokens that are also ordinary words of running prose.
 *
 * `markdown.ts` states the case with the one word that proves it: `address` is
 * in `PII_DENIED_SUBSTRINGS`, and "address the works-council question" is an
 * ordinary sentence in every workflow doc in this repo. Field-name rules are
 * therefore applied in LABEL positions, not to free text — and where a scanner
 * does have to read a free-text PHRASE as a possible field name (a multi-word
 * string literal in emitted code), these tokens are the ones it must not match
 * on, or it refuses the sentence along with the field.
 *
 * It is a list rather than a rule because the distinction is lexical: no
 * property of `address` other than "it is also an English verb" separates it
 * from `iban`.
 */
export const PROSE_AMBIGUOUS_TOKENS: readonly string[] = ["address", "compensation", "pin"];

// ─────────────────────────────────────────────────────────────────────────
// AUTHORED HERE — value patterns the host's five do not cover
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠ NOT A COPY EITHER, and kept out of `PII_PATTERNS` for the same reason as
 * the lists above: `PII_PATTERNS` is compared to the host entry for entry,
 * regex source and flags included.
 *
 * The class NAMES are reused from the host's vocabulary on purpose. An
 * apostrophe-grouped Swiss amount and a `€` amount are the same disclosure,
 * and an audit event that called one `amount` and the other
 * `amount-swiss-variant` would make two facts out of one. A finding's class is
 * what a human routes on; the regex that found it is an implementation
 * detail.
 *
 * Why these three:
 *   amount — the host's pattern knows `€|EUR|USD|$`. `CHF 82'000` contains no
 *            currency it knows and no digit run the `digits` pattern can see
 *            (the apostrophe is not in `[\d /.-]`), so pay data in a fourth
 *            currency is invisible to all five host patterns.
 *   digits — the same apostrophe grouping, without a currency.
 *   date   — the host's pattern knows ISO and `d.m.y`. `1 September 2026` and
 *            `September 1, 2026` are dates in every document a human writes.
 */
export const STUDIO_PATTERNS: readonly PiiPattern[] = [
  {
    name: "amount",
    re: /(?:CHF|GBP|£|¥|JPY|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|CAD|AUD|CNY|INR)\s?\d[\d'’ .,]*\d|\d[\d'’ .,]*\d\s?(?:CHF|GBP|SEK|NOK|DKK|PLN|CZK|HUF|RON|TRY|CAD|AUD|CNY|INR)\b/g,
    placeholder: "<amount>",
  },
  {
    name: "digits",
    re: /\b\d{1,3}(?:['’]\d{3})+\b/g,
    placeholder: "<number>",
  },
  {
    name: "date",
    re: /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Januar|Februar|März|Maerz|Mai|Juni|Juli|Oktober|Dezember)\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/gi,
    placeholder: "<date>",
  },
];

/** Every class name this package can report from a VALUE — the host's five
 * plus the Studio patterns, which reuse the host's names. */
export const ALL_VALUE_PATTERNS: readonly PiiPattern[] = [...PII_PATTERNS, ...STUDIO_PATTERNS];
