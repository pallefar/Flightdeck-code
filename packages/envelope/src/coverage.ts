/**
 * ⭐ THE SAME MOVE, ONE LEVEL IN — the PROVENANCE region, allowlisted.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT WAS OPEN, AND FOR HOW LONG
 * ─────────────────────────────────────────────────────────────────────────
 * `allowlists.ts` closed the payload: a fact's value must be a member of a
 * compiled-in list, a bounded integer, or a bounded text fact. The header of
 * that file says "THERE IS NO FREE-FORM PAYLOAD, SO THERE IS NOTHING TO NEST
 * JSON INTO", and for `facts` that was true.
 *
 * It was not true of the thing that RODE ALONGSIDE a text fact. The coverage
 * report — `text[].assessment` — was read field by field for SHAPE and then
 * copied VERBATIM into `TextProvenance`, which is inside `facts`, which is
 * inside `envelope.wire`. Every string in it was caller-supplied and
 * unallowlisted, so:
 *
 *   - `assessment.statement` was an unbounded free-text channel. A
 *     20,000-character statement built an `ok: true` envelope at 20,320
 *     bytes — ten times the `MAX_TEXT_CHARS` the channel advertises, through
 *     the same request.
 *   - `coverage.unchecked` carried the five-times-nested `JSON.stringify`
 *     record onto the wire, ok: true. The attack this package was built to
 *     make INEXPRESSIBLE was expressible again, one field over.
 *   - regex-evading German prose naming a person, an address and a disability
 *     rode it untouched, defended by nothing but `assertNoResidualPii` — i.e.
 *     by exactly the unbounded scanner this package exists to stop relying on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ THE RULE, APPLIED WITHOUT AN EXCEPTION FOR "IT IS ONLY METADATA"
 * ─────────────────────────────────────────────────────────────────────────
 *     IF A CALLER CAN AUTHOR THE BYTES, THEY DO NOT GO ON THE WIRE UNLESS
 *     THEY ARE A MEMBER OF A COMPILED-IN SET.
 *
 * A coverage report is EVIDENCE THE CALLER BRINGS. Evidence is VALIDATED, not
 * carried. Every string below is drawn from a closed vocabulary; the
 * pseudonymiser's prose `statement` is dropped and replaced by a code THIS
 * package owns; and the residual scan stays exactly where `host-scan.ts` puts
 * it — the braces, never the reason a field is allowed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE TRANSCRIPTIONS AND NOT IMPORTS
 * ─────────────────────────────────────────────────────────────────────────
 * Same reason `types.ts` declares `CoverageReportLike` structurally rather
 * than importing `TierAssessment` as a value: THIS PACKAGE MUST NOT DEPEND ON
 * THE PSEUDONYMISER'S RUNTIME. If it imported `PII_CLASSES_NOT_CHECKED` it
 * would be one import away from importing `assessTier`, and then a caller
 * could hand `buildEnvelope` raw text and get an envelope back — which is the
 * job this package exists to refuse.
 *
 * The duplication is made safe the way every other copy in this repo is made
 * safe: `__tests__/coverage-vocabulary.test.ts` reads
 * `packages/pseudonym/src/tier.ts` and `representations.ts` OFF DISK and
 * fails on divergence IN BOTH DIRECTIONS. A class the pseudonymiser starts
 * reporting and this file has not learned is refused — loudly, at the test —
 * rather than passed through.
 */

import { MAX_TEXT_CHARS } from "./allowlists";
import { SCANNED_CLASSES } from "./host-scan";
import { ENVELOPE_CLASSES_NOT_CHECKED } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// The three closed vocabularies a coverage report may draw from
// ─────────────────────────────────────────────────────────────────────────

/**
 * TRANSCRIBED from `packages/pseudonym/src/tier.ts` — `PII_CLASSES_NOT_CHECKED`
 * plus the one class `assessTier` appends when the caller declared no names.
 * These are the only class names that package can put in `coverage.unchecked`.
 */
export const PSEUDONYM_UNCHECKED_CLASSES: readonly string[] = [
  "undeclared-personal-name",
  "postal-address",
  "phone-number-without-a-long-digit-run",
  "passport-or-id-document-number",
  "tax-or-social-insurance-number",
  "vehicle-registration",
  "online-identifier-or-device-id",
  "biometric-or-photo-reference",
  "free-text-detail-that-identifies-by-context",
  "an-encoding-outside-TEXT_REPRESENTATIONS_DERIVED",
  "declared-name-none-supplied",
];

/**
 * TRANSCRIBED from `tier.ts`'s `DETECTORS_CHECKED`. The host's five pattern
 * names and `declaredName` are NOT transcribed — they are taken from
 * `SCANNED_CLASSES`, which is derived from the patterns that actually run, so
 * a class added to the host's list is admitted here without a second edit.
 */
export const PSEUDONYM_DETECTORS_CHECKED: readonly string[] = [
  "quasi-identifier-signal-words",
  "special-category-signal-words",
  "person-referent-words",
  "name-shaped-span",
  "identifier-shaped-token",
  "minted-tag-classes",
  "vault-entry-classes",
];

/** TRANSCRIBED from `packages/pseudonym/src/representations.ts` —
 * `TEXT_REPRESENTATIONS_DERIVED`, the only spellings that package derives. */
export const PSEUDONYM_REPRESENTATIONS: readonly string[] = [
  "as-written",
  "unicode-normalized",
  "percent-decoded",
  "html-entity-decoded",
  "escape-decoded",
  "deobfuscated",
  "base64-decoded",
  "format-folded",
  "transliteration-folded",
];

/** Admissible members of `coverage.unchecked`. The envelope's own classes are
 * included because `assuranceFor` merges the two lists anyway: a report that
 * names one of them is naming a compiled-in constant either way. */
export const COVERAGE_CLASS_VOCABULARY: readonly string[] = [
  ...new Set([...PSEUDONYM_UNCHECKED_CLASSES, ...ENVELOPE_CLASSES_NOT_CHECKED]),
].sort();

/** Admissible members of `coverage.checked`. */
export const COVERAGE_DETECTOR_VOCABULARY: readonly string[] = [
  ...new Set([...SCANNED_CLASSES, "declaredName", ...PSEUDONYM_DETECTORS_CHECKED]),
].sort();

/** Admissible members of `coverage.representations`. */
export const COVERAGE_REPRESENTATION_VOCABULARY: readonly string[] = [...PSEUDONYM_REPRESENTATIONS].sort();

/**
 * Ceiling on how many entries a report may OFFER for one list, before
 * membership is even considered. Membership already bounds what SURVIVES (a
 * deduplicated subset of a vocabulary), so this bounds only the work: a report
 * offering ten thousand copies of one legal class name is refused rather than
 * scanned.
 */
export const MAX_COVERAGE_ENTRIES = 64;

// ─────────────────────────────────────────────────────────────────────────
// The statement, replaced
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⛔ THE PSEUDONYMISER'S `statement` DOES NOT GO ON THE WIRE. It is prose, and
 * prose authored elsewhere must not reach the wire because A CALLER CAN AUTHOR
 * IT — `buildEnvelope` is a public export and the report is an ordinary
 * object literal, so "the pseudonymiser wrote this" is a claim about history
 * that nothing here can check. (`packages/envelope/src/types.ts` says the same
 * thing about the host's `as Redacted` brand.)
 *
 * What travels instead is one of these four codes, DERIVED by this package
 * from the report's two structured fields. It says the only thing a reader
 * needed the statement for — was the tier reduced, and was the coverage
 * partial — in words this package compiled in.
 */
export const PROVENANCE_STATEMENT_CODES = [
  "pseudonymised-reduced-coverage-partial",
  "pseudonymised-reduced-coverage-claimed-complete",
  "pseudonymised-not-reduced-coverage-partial",
  "pseudonymised-not-reduced-coverage-claimed-complete",
] as const;

export type ProvenanceStatementCode = (typeof PROVENANCE_STATEMENT_CODES)[number];

export function provenanceStatementCode(reduced: boolean, uncheckedCount: number): ProvenanceStatementCode {
  if (reduced) {
    return uncheckedCount > 0
      ? "pseudonymised-reduced-coverage-partial"
      : "pseudonymised-reduced-coverage-claimed-complete";
  }
  return uncheckedCount > 0
    ? "pseudonymised-not-reduced-coverage-partial"
    : "pseudonymised-not-reduced-coverage-claimed-complete";
}

// ─────────────────────────────────────────────────────────────────────────
// Admission
// ─────────────────────────────────────────────────────────────────────────

/**
 * MEMBERSHIP BY IDENTITY, then deduplication, in the order the report gave.
 * `null` means "something in this list is not a member", and the CALLER'S
 * STRING IS NOT RETURNED — a refusal over an unrecognised class must not
 * quote the unrecognised class, for the same reason a refusal over an
 * unlisted fact key is positional.
 */
export function admitCoverageList(value: unknown, vocabulary: readonly string[]): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_COVERAGE_ENTRIES) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    if (!vocabulary.includes(entry)) return null;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// ⭐ THE ADVERTISED BOUND, MADE TO ACTUALLY BOUND THE CHANNEL
// ─────────────────────────────────────────────────────────────────────────

/**
 * The largest `TextProvenance` that can now exist, in characters, COMPUTED
 * rather than guessed: every member of every vocabulary present at once.
 *
 * This is what makes `MAX_TEXT_CHARS` an honest number again. Before, the
 * provenance region was unbounded and a 20,000-character statement travelled
 * a channel advertising 2,000 — "the bound being decorative". Now the whole
 * text entry, text plus provenance, is bounded by a compiled-in constant, and
 * the load-time assertion below refuses to start a build in which the
 * metadata could outgrow the text it describes.
 */
export const MAX_PROVENANCE_CHARS = JSON.stringify({
  basis: "pseudonymised",
  by: "packages/pseudonym",
  payloadTier: 4,
  vaultTier: 4,
  checked: COVERAGE_DETECTOR_VOCABULARY,
  unchecked: COVERAGE_CLASS_VOCABULARY,
  representations: COVERAGE_REPRESENTATION_VOCABULARY,
  statementCode: [...PROVENANCE_STATEMENT_CODES].sort((a, b) => b.length - a.length)[0],
}).length;

/** The whole of one text-channel entry: the bounded text plus the bounded
 * provenance. Derived from the two, so widening either moves this. */
export const MAX_TEXT_FACT_CHARS = MAX_TEXT_CHARS + MAX_PROVENANCE_CHARS;

/**
 * ⚠ RUNS AT IMPORT AND THROWS, like `assertTablesCohere`. A metadata region
 * that can outgrow the payload region it describes is not a condition to
 * handle at request time; it is a build that should not start.
 */
if (MAX_PROVENANCE_CHARS >= MAX_TEXT_CHARS) {
  throw new Error(
    `envelope: the worst-case provenance is ${MAX_PROVENANCE_CHARS} chars, at or above MAX_TEXT_CHARS ` +
      `(${MAX_TEXT_CHARS}) — the coverage vocabularies have grown into a channel of their own`,
  );
}
