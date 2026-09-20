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
