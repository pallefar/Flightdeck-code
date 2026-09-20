/**
 * THE SHAPES — and the one rule that governs every one of them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ A CONTROL MAY REFUSE. IT MAY NEVER CERTIFY.
 * ─────────────────────────────────────────────────────────────────────────
 * Every failure in this project came from a control saying "no personal data"
 * when what had actually happened was that it failed to find any. `classify()`
 * returned tier 1 for a record behind five `JSON.stringify` calls; `assessTier`
 * returned "no-personal-data-in-payload" for a paragraph naming a person's job,
 * site and sole-officer status. Neither was lying about what it had done. Both
 * were lying about what that meant.
 *
 * So there is no field anywhere in this file called `clean`, `safe`, `ok` (in
 * the sense of the data), `piiFree` or `verified`. The positive output of this
 * package is an `Envelope`, and an `Envelope` does not assert that the payload
 * contains no personal data. It asserts something narrower and checkable:
 *
 *     EVERY VALUE IN IT WAS DRAWN FROM A COMPILED-IN LIST, OR IS A BOUNDED
 *     INTEGER, OR IS A TEXT FACT THAT CAME WITH ITS OWN COVERAGE REPORT AND
 *     IS THEREFORE NOT SENDABLE WITHOUT A HUMAN.
 *
 * And it carries an `Assurance` that names, every time, which classes were
 * looked at and which were not. `Assurance.notChecked` is never empty. A
 * caller that wants a green light will not find one here.
 */

import type { FactKind } from "./allowlists";
import type { ProvenanceStatementCode } from "./coverage";

// ─────────────────────────────────────────────────────────────────────────
// Facts
// ─────────────────────────────────────────────────────────────────────────

/**
 * The closed union. Transcribed in shape from the host's `AiFact`, with one
 * deliberate difference: the host's `text` fact carries a `Redacted` branded
 * string produced by its own one-way `redact()`. Studio's carries a string
 * that came out of `packages/pseudonym` TOGETHER WITH the coverage report
 * that says what that proves and what it does not. A brand asserts a fact
 * about history that a cast can forge (`as Redacted` — the host says so
 * itself); a coverage report carries its own limits and cannot be
 * misunderstood as a certificate.
 */
export type EnvelopeFact =
  | { readonly kind: "enum"; readonly vocabulary: string; readonly value: string }
  /**
   * ⚠ `value` IS A RUNG OF `COUNT_LADDER`, NOT THE CALLER'S NUMBER. It is the
   * smallest rung at or above what the caller said, so it reads as an UPPER
   * BOUND on their count. The reason is in `allowlists.ts`: a per-key ceiling
   * bounds the magnitude and leaves the precision unbounded, and the
   * precision is where a birth year, a monthly gross and the tail of an IBAN
   * ride a channel that only admits "counts". Small counts are rungs
   * themselves, so a spec with 12 fields is still 12.
   */
  | { readonly kind: "count"; readonly value: number }
  | { readonly kind: "fieldName"; readonly value: string }
  | { readonly kind: "text"; readonly value: string; readonly provenance: TextProvenance };

/**
 * WHAT IS KNOWN ABOUT A TEXT FACT'S HISTORY. Copied out of the caller's
 * pseudonymiser report — never the vault, never a value, never a tag list.
 *
 * `basis` says in one word which kind of fact this is, because the honest
 * distinction between the two halves of this package is the thing most likely
 * to be lost in a summary:
 *
 *   "allowlisted"   a value that could only ever have been one of N
 *                   compiled-in strings. Structurally incapable of carrying
 *                   caller data.
 *   "pseudonymised" arbitrary text with the direct identifiers replaced, over
 *                   a PARTIAL set of classes. Bounded, reported, and not
 *                   sendable without a human.
 */
/**
 * ⭐ WHO WROTE THE WORDS. The one distinction that lets a prompt-to-spec
 * builder exist without weakening the gate.
 *
 * `disposition` used to be `textFacts > 0 ? "requires-human-approval" :
 * "ready"` — ANY free text needed a human, whatever its tier — and
 * `gateModelRequest` never calls `checkApproval`, so nothing could open it.
 * That is right for CONTENT: a contract, a workflow document, a recording
 * transcript. Nobody in the room authored it, an allowlist can prove nothing
 * about it, and a person should look before it goes to a model.
 *
 * It is ceremony for an INSTRUCTION the operator typed into this app, in this
 * session, under their own name. Asking them to approve their own sentence
 * does not add a reviewer; it adds a click and teaches people to click.
 *
 * ⚠ SO THE DISTINCTION IS AUTHORSHIP, NOT CONTENT, AND IT IS NARROW. A
 * first-party instruction is `ready` ONLY when all four hold — see
 * `build.ts`'s disposition block, where each is checked and named:
 *   1. the caller declared it first-party
 *   2. a NAMED human is the actor (`isNamedHuman`, same rule approvals use)
 *   3. pseudonymisation actually reduced it: payloadTier <= 2
 *   4. the host's own scanner re-proved the text and found nothing
 * Fail any one and it is `requires-human-approval` exactly as before.
 *
 * ⛔ A CALLER CANNOT LAUNDER CONTENT THROUGH THIS. Pasting a contract into the
 * prompt box does not make it first-party — it makes it text the operator is
 * accountable for having pasted, with their name on the audit event, and it
 * still has to survive (3) and (4). What the flag buys is the removal of a
 * rubber stamp, not the removal of a check.
 */
/** The closed set, as data — so a test can assert over it and `build.ts` can
 * validate against it rather than against two string literals in two places. */
export const TEXT_AUTHORSHIPS = ["first-party-operator", "third-party-content"] as const;

export type TextAuthorship =
  /** Typed by the acting human, here, now. They are the reviewer. */
  | "first-party-operator"
  /** Anything else: a document, a transcript, a record, a paste of one. */
  | "third-party-content";

export interface TextProvenance {
  readonly basis: "pseudonymised";
  /** See `TextAuthorship`. Absent is treated as third-party — the safe
   * default is the one that costs nothing if the caller forgot. */
  readonly authorship: TextAuthorship;
  /** The package that produced the text and the report. A compiled-in
   * literal: it is what this envelope REQUIRES the caller to have used, not
   * something the caller gets to name. */
  readonly by: "packages/pseudonym";
  /** What the pseudonymiser said the TRANSMITTED text may be treated as. A
   * bounded integer, 1-4, checked before it is carried. */
  readonly payloadTier: 1 | 2 | 3 | 4;
  /** What it said the vault is. Always 4, and the vault is not here — a
   * report that says anything else is malformed, not interesting. */
  readonly vaultTier: 4;
  /** Detectors that ran. ⭐ EVERY MEMBER IS DRAWN FROM
   * `COVERAGE_DETECTOR_VOCABULARY` BY IDENTITY. A report naming a detector
   * this package has not compiled in is REFUSED, not passed through. */
  readonly checked: readonly string[];
  /** Classes of personal data that scan CANNOT see. Members of
   * `COVERAGE_CLASS_VOCABULARY`, by identity. */
  readonly unchecked: readonly string[];
  /** Which spellings of the payload the residual proof covered. Members of
   * `COVERAGE_REPRESENTATION_VOCABULARY`, by identity. */
  readonly representations: readonly string[];
  /**
   * ⭐ WHAT REPLACED THE PSEUDONYMISER'S PROSE `statement`.
   *
   * The report's `statement` was carried VERBATIM onto the wire, which made
   * it an unbounded, unallowlisted, caller-authored free-text channel inside
   * the one region this package had told itself was closed — the 20,000-char
   * statement, the nested stringify and the regex-evading prose all rode it.
   * It is now DROPPED at the door. This code is derived by the envelope from
   * the report's two structured fields and is one of four compiled-in
   * constants. See `coverage.ts`.
   */
  readonly statementCode: ProvenanceStatementCode;
}

// ─────────────────────────────────────────────────────────────────────────
// The coverage report a text fact must arrive with
// ─────────────────────────────────────────────────────────────────────────

/**
 * The shape `packages/pseudonym`'s `TierAssessment` already has.
 *
 * ⚠ DECLARED STRUCTURALLY RATHER THAN IMPORTED AS A VALUE, on purpose, and
 * the reason is worth keeping: this package must not depend on the
 * pseudonymiser's RUNTIME. If it imported `assessTier` it could call it
 * itself, and then a caller could hand `buildEnvelope` raw text and get back
 * an envelope — which would make this package the thing that decides text is
 * safe, which is precisely the job it exists to refuse. The report is
 * EVIDENCE THE CALLER BRINGS. The envelope checks the evidence is present and
 * well-formed, re-proves what it can independently, and then still refuses to
 * mark the result sendable.
 *
 * `__tests__/free-text.test.ts` holds a compile-time assertion that
 * `TierAssessment` is assignable to this, so the two cannot drift apart
 * without a red build.
 */
export interface CoverageReportLike {
  readonly payloadTier: number;
  readonly vaultTier: number;
  readonly reduced: boolean;
  readonly coverage: {
    readonly checked: readonly string[];
    readonly unchecked: readonly string[];
    readonly representations: readonly string[];
  };
  /** ⛔ READ, TYPE-CHECKED, AND THEN DROPPED. It is the pseudonymiser's prose,
   * and prose authored elsewhere does not reach the wire — see
   * `TextProvenance.statementCode`. It stays on this interface because
   * `TierAssessment` really does have it and the compile-time assignability
   * assertion must keep holding; it is a field the envelope READS to decide
   * the report is well-formed, not a field the envelope CARRIES. */
  readonly statement: string;
}

/** One bounded text fact, offered for the envelope's free-text channel. */
export interface PseudonymisedText {
  /** Must be a key whose policy kind is `text`. */
  readonly key: string;
  /** The output of `tokenize()` — NOT the source. */
  readonly text: string;
  /** The output of `assessTier()` for that exact text. */
  readonly assessment: CoverageReportLike;
}

// ─────────────────────────────────────────────────────────────────────────
// Assurance
// ─────────────────────────────────────────────────────────────────────────

/**
 * WHAT WAS CHECKED, AND WHAT WAS NOT. Attached to every envelope AND every
 * refusal, because the limits of a control are not a detail of its successes.
 *
 * Modelled directly on `TierCoverage` in `packages/pseudonym/src/tier.ts`,
 * which learned it the hard way: "the honest place to record the limits of a
 * detector is in its output rather than in a comment the caller never reads".
 */
export interface Assurance {
  /** The compiled-in tables every admitted value was drawn from. This — not
   * the scan — is the actual control. */
  readonly constructedFrom: readonly string[];
  /** PII classes the residual scan ran for, over the serialised facts. */
  readonly scanned: readonly string[];
  /** Classes of personal data NOTHING here looked at. NEVER EMPTY. */
  readonly notChecked: readonly string[];
  /** One line, safe to log: compiled-in words and counts only. It says what
   * ran and what did not, and it never says the payload is clean. */
  readonly statement: string;
}

/**
 * The classes this package cannot see, whatever the payload says.
 *
 * The first entry is the load-bearing one: the envelope's allowlist makes an
 * undeclared personal name UNEXPRESSIBLE as an enum, a field name or a count,
 * which is a real structural answer — but it says nothing at all about what is
 * inside a bounded text fact. The rest are the host's five regexes' blind
 * spots, named the same way `packages/pseudonym`'s `PII_CLASSES_NOT_CHECKED`
 * names them so the two lists read as one vocabulary.
 */
export const ENVELOPE_CLASSES_NOT_CHECKED: readonly string[] = [
  "undeclared-personal-name",
  "postal-address",
  "phone-number-without-a-long-digit-run",
  "passport-or-id-document-number",
  "tax-or-social-insurance-number",
  "vehicle-registration",
  "online-identifier-or-device-id",
  "biometric-or-photo-reference",
  "free-text-detail-that-identifies-by-context",
  "an-encoding-the-serialised-form-does-not-reveal",
  // ⭐ THE COUNT CHANNEL'S RESIDUE, NAMED. A `count` is a bounded integer and
  // is now snapped to a member of `COUNT_LADDER`, which destroys the
  // precision a birth year, a monthly gross or an IBAN tail needs. What it
  // cannot destroy is the CHOICE of bucket: a caller who controls several
  // count facts still controls a few bits per request. `buildEnvelope` states
  // the measured figure in its `Assurance`; nothing here looks for it.
  "information-encoded-in-the-choice-of-bounded-integers",
  // Added with the enum and fieldName caps. Naming only the integer channel
  // while two others rode beside it uncapped was the list certifying by
  // omission: a reader takes an absent channel for a closed one.
  "information-encoded-in-the-choice-of-vocabulary-members",
  "information-encoded-in-the-choice-of-field-names",
];

// ─────────────────────────────────────────────────────────────────────────
// Refusal
// ─────────────────────────────────────────────────────────────────────────

/**
 * Why something could not be expressed. Every code is a compiled-in constant,
 * so the whole of a refusal is loggable — the host's rule, applied to the
 * thing that reports the refusal rather than only to the thing that finds it.
 */
export type RefusalCode =
  | "not-an-object"
  | "unknown-top-level-field"
  | "unknown-task"
  | "provider-not-selectable"
  | "model-not-known"
  | "facts-not-an-object"
  | "fact-not-a-tagged-fact"
  | "key-not-in-policy"
  | "kind-mismatch"
  | "unknown-vocabulary"
  | "value-not-in-vocabulary"
  | "field-name-not-allowlisted"
  | "count-not-a-safe-integer"
  | "count-negative"
  | "count-over-ceiling"
  /** More `count` facts in one request than `MAX_COUNT_FACTS`. A ceiling on
   * one integer bounds one integer; a ceiling on how many of them travel
   * together is what bounds the request's aggregate capacity. */
  | "too-many-count-facts"
  /** More `enum` facts in one request than `MAX_ENUM_FACTS`. The bound on the
   * REQUEST's selection channel, not on one fact's alphabet. */
  | "too-many-enum-facts"
  /** More `fieldName` facts in one request than `MAX_FIELD_NAME_FACTS`. */
  | "too-many-field-name-facts"
  /** A text entry declared an `authorship` that is not one of the two. The
   * value is NOT echoed — it is caller data like any other. */
  | "text-authorship-not-in-vocabulary"
  | "text-must-use-the-pseudonymised-channel"
  | "text-channel-not-an-array"
  | "text-entry-malformed"
  | "text-key-is-not-a-text-key"
  | "text-missing-coverage-report"
  | "text-coverage-report-malformed"
  | "text-payload-tier-restricted"
  | "text-over-max-chars"
  /** The whole text entry — bounded text PLUS bounded provenance — is over
   * `MAX_TEXT_FACT_CHARS`. The advertised bound now bounds the metadata too. */
  | "text-fact-over-max-chars"
  /** `coverage.unchecked` named a class that is not in
   * `COVERAGE_CLASS_VOCABULARY`. The offending string is NOT echoed. */
  | "text-coverage-class-not-in-vocabulary"
  /** `coverage.checked` named a detector that is not in
   * `COVERAGE_DETECTOR_VOCABULARY`. */
  | "text-coverage-detector-not-in-vocabulary"
  /** `coverage.representations` named a spelling that is not in
   * `COVERAGE_REPRESENTATION_VOCABULARY`. */
  | "text-representation-not-in-vocabulary"
  | "too-many-text-facts"
  | "text-residual-pii"
  | "duplicate-fact-key"
  | "residual-pii-in-serialised-form"
  | "over-byte-cap";

/**
 * ONE THING THAT COULD NOT BE EXPRESSED.
 *
 * ⚠ `at` IS NAMED BY KEY ONLY WHEN THE KEY IS A COMPILED-IN CONSTANT. An
 * allowlisted key came out of `FACT_KEY_POLICY`, so naming it discloses
 * nothing. A key that is NOT in the policy is caller free text — the host's
 * whole reason for having a key policy at all — so it is named POSITIONALLY,
 * `facts.#3`. The host refuses "by POSITIONAL INDEX rather than by echoing the
 * key", because "a refusal that quotes the offending key would itself put it
 * in the log".
 *
 * `expected` is likewise compiled-in: a kind name, a vocabulary name, a
 * ceiling, a class name. The offending VALUE never appears, because the value
 * may BE the personal data.
 */
export interface ExpressionFailure {
  readonly code: RefusalCode;
  readonly at: string;
  readonly expected?: string;
}

export interface Refusal {
  readonly ok: false;
  readonly failures: readonly ExpressionFailure[];
  /** A constant phrase. Nothing scanned is interpolated. */
  readonly reason: string;
  /** A refusal states its own limits too. A thing this package refused is not
   * thereby the only thing wrong with the input. */
  readonly assurance: Assurance;
}

// ─────────────────────────────────────────────────────────────────────────
// Envelope
// ─────────────────────────────────────────────────────────────────────────

/**
 * `ready`                     every fact was drawn from a compiled-in list or
 *                             is a bounded integer. No text facts.
 * `requires-human-approval`   the envelope carries a bounded text fact. A
 *                             named human decides; this package does not, and
 *                             no option makes it.
 */
export type Disposition = "ready" | "requires-human-approval";

export interface Envelope {
  readonly ok: true;
  readonly task: string;
  readonly provider: string;
  readonly model: string;
  /** Sorted by key, so the wire form is deterministic and hashable. */
  readonly facts: Readonly<Record<string, EnvelopeFact>>;
  readonly disposition: Disposition;
  /** Compiled-in codes saying why a human is needed. Empty when `ready`. */
  readonly approvalReasons: readonly string[];
  readonly assurance: Assurance;
  /** The exact bytes that would leave the machine, already scanned. */
  readonly wire: string;
  readonly bytes: number;
}

export type BuildResult = Envelope | Refusal;

export function isEnvelope(result: BuildResult): result is Envelope {
  return result.ok;
}

export function isRefusal(result: BuildResult): result is Refusal {
  return !result.ok;
}
