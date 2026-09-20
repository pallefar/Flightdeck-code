/**
 * `buildEnvelope` — THE CONTROL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE QUESTION THIS ASKS, AND THE QUESTION IT REFUSES TO ASK
 * ─────────────────────────────────────────────────────────────────────────
 * It asks: CAN THIS BE EXPRESSED IN THE ALLOWED SHAPE?
 * It does not ask: DOES A SCAN FIND SOMETHING?
 *
 * The difference is the whole point, and it is the difference between a
 * bounded question and an unbounded one. "Is there personal data in this
 * arbitrary payload?" has no bounded answer — the payload can be spelled an
 * unlimited number of ways (nested JSON, percent-encoding, base64, an
 * unfamiliar transliteration) and the scanner must win every time. "Is every
 * value in this request a member of a list I compiled in?" is decidable by
 * looking at the list.
 *
 * So refusal is the DEFAULT here, not the alarm. Nothing is admitted because
 * it looked harmless. Things are admitted because they are enumerated.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ SECTION D — THE FREE-TEXT PATH, WHICH IS THE HONEST HARD PART
 * ─────────────────────────────────────────────────────────────────────────
 * An allowlist answers the structured case completely and it CANNOT answer
 * this one. A pasted Cowork workflow is arbitrary text, and it is the
 * product: Studio exists to turn it into a mini-app. There is no list of
 * permitted workflows, and pretending otherwise would just move the lie.
 *
 * What this package does about it, exactly:
 *
 *   1. A text fact cannot be written into `facts` at all. `{ kind: "text" }`
 *      there is REFUSED (`text-must-use-the-pseudonymised-channel`). The only
 *      way in is the separate `text` channel.
 *   2. That channel takes text that has ALREADY been through
 *      `packages/pseudonym`, together with the coverage report `assessTier`
 *      produced for it. Missing report → refused. Malformed report → refused.
 *   3. ⭐ THE REPORT IS VALIDATED, NOT CARRIED. Its limits travel with the
 *      payload in `TextProvenance` — but every string in it must be a member
 *      of a compiled-in vocabulary (`coverage.ts`), and the pseudonymiser's
 *      prose `statement` is DROPPED and replaced by a code this package owns.
 *
 *      This is the hole the last round found and it is worth stating in full,
 *      because the instinct that opened it is the natural one: the report is
 *      metadata, the metadata came from a trusted package, so it was copied
 *      through after a SHAPE check. Shape is not membership. `assessment` was
 *      an unallowlisted, string-typed, caller-supplied region copied VERBATIM
 *      onto the wire, and it re-opened every representation attack the
 *      allowlist had closed one field over: the five-times-nested stringify
 *      built ok:true; a 20,000-character `statement` built ok:true at 20,320
 *      bytes on a channel advertising 2,000; regex-evading German prose rode
 *      it with nothing but `assertNoResidualPii` — the unbounded scanner this
 *      package exists to stop relying on — in the way.
 *
 *      ⛔ THE RULE, WITHOUT AN EXCEPTION FOR "IT IS ONLY METADATA": if a
 *      caller can author the bytes, they do not go on the wire unless they
 *      are a member of a compiled-in set. `buildEnvelope` is a public export,
 *      so "the pseudonymiser wrote this" is a claim about history that
 *      nothing here can check — the same reason `types.ts` refuses to trust
 *      the host's `as Redacted` brand.
 *   4. The text is INDEPENDENTLY re-scanned here with the host's own
 *      `residualPiiFindings`. That is not trust in the pseudonymiser; it is
 *      the same belt-and-braces `serializeAiRequest` applies to `redact()`.
 *   4b. AND THE ADVERTISED BOUND BOUNDS THE WHOLE ENTRY. `MAX_TEXT_CHARS`
 *      used to bound `text` and nothing beside it. `MAX_TEXT_FACT_CHARS` is
 *      derived from it plus the largest provenance the vocabularies can
 *      express, so the metadata is inside the bound rather than next to it.
 *   5. An envelope carrying a text fact is NEVER `ready`. It is
 *      `requires-human-approval`, unconditionally — there is no option, no
 *      coverage report and no tier that makes one auto-sendable, because
 *      `coverage.unchecked` is never empty and a partial scan is not a clean
 *      one.
 *
 * ⚠ SAY WHICH IT IS. A `fieldName` fact is structurally incapable of carrying
 * caller data: its value must be one of a few dozen compiled-in words. A text
 * fact is arbitrary prose with the direct identifiers replaced over a partial
 * class set. They are not the same kind of safe and this package never
 * reports them as though they were — `TextProvenance.basis` says
 * `"pseudonymised"` on the fact itself, and `approvalReasons` says it again
 * on the envelope.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT A REFUSAL MAY SAY
 * ─────────────────────────────────────────────────────────────────────────
 * A key, when the key is a compiled-in constant. An ordinal, when it is not.
 * A code from `RefusalCode`. A compiled-in `expected`. Never a value, never
 * an unlisted key, never a span of text, NEVER AN UNRECOGNISED COVERAGE CLASS
 * — a caller wrote that one too. See `ExpressionFailure`.
 *
 * ⚠ THE SAME RULE GOVERNS `Assurance`, INCLUDING ON A REFUSAL. `notChecked`
 * absorbs the report's `unchecked` list, and `statement` interpolates it, so
 * both were carrying caller prose into a field documented as "safe to log"
 * whenever a request was refused for some LATER reason. They are compiled-in
 * constants again because the report is now admitted by membership before
 * anything is absorbed from it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ AND A COUNT IS NOT A NUMERIC CHANNEL — see `COUNT_LADDER`
 * ─────────────────────────────────────────────────────────────────────────
 * A per-key ceiling bounds the MAGNITUDE and says nothing about the
 * PRECISION: `docCount <= 10_000` admits 1985, 4200 and 2051 intact. A count
 * is therefore snapped UP to a rung of a compiled-in ladder, and at most
 * `MAX_COUNT_FACTS` of them travel together. `COUNT_CHANNEL_BITS` measures
 * what is left and the `Assurance` says the number out loud, because a
 * control may refuse and may never certify.
 */

import {
  AI_TASKS,
  COUNT_LADDER,
  FACT_KEY_POLICY,
  FIELD_NAME_ALLOWLIST,
  MAX_COUNT,
  MAX_COUNT_FACTS,
  MAX_REQUEST_BYTES,
  MAX_TEXT_CHARS,
  MAX_TEXT_FACTS,
  factKeyPolicy,
  isKnownModel,
  isSelectableProvider,
  snapCount,
  vocabulary,
} from "./allowlists";
import {
  COVERAGE_CLASS_VOCABULARY,
  COVERAGE_DETECTOR_VOCABULARY,
  COVERAGE_REPRESENTATION_VOCABULARY,
  MAX_TEXT_FACT_CHARS,
  admitCoverageList,
  provenanceStatementCode,
} from "./coverage";
import { DEFAULT_MODEL } from "../../providers/src/config";
import { PiiRefusalError, SCANNED_CLASSES, assertNoResidualPii, residualPiiFindings } from "./host-scan";
import {
  ENVELOPE_CLASSES_NOT_CHECKED,
  type Assurance,
  type RefusalCode,
  type TextProvenance,
  type BuildResult,
  type CoverageReportLike,
  type Envelope,
  type EnvelopeFact,
  type ExpressionFailure,
  type Refusal,
} from "./types";

/** The provider Studio resolves by default. Like the host, provider and model
 * are NOT caller input — "resolved from admin config by the gateway, never
 * chosen by a caller — they are on the request only so the serialised bytes
 * (and therefore the audit event) record which one was used". They are build
 * OPTIONS here for the same reason and with the same rule. */
export const DEFAULT_PROVIDER = "anthropic";

export interface BuildOptions {
  /** Names the caller KNOWS are involved. The caller's one obligation, same
   * bargain as the host's `redact({ names })`. Declaring them widens the
   * residual scan by the `declaredName` class; NOT declaring them does not
   * make the answer cleaner, it moves that class into `notChecked`. */
  readonly names?: readonly string[] | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
}

/** Top-level members an input may have. Anything else is refused: a request
 * with a `notes:` field is a request with a free-text channel in it, which is
 * exactly what this package exists to not have. */
const TOP_LEVEL_FIELDS: readonly string[] = ["task", "facts", "text"];

export const REFUSAL_REASON =
  "refused: this could not be expressed in the envelope's allowed shape — see failures, which name keys and codes, never values";

export const APPROVAL_REASON_CODES = {
  boundedText: "bounded-text-fact-present",
  partialCoverage: "pseudonymiser-coverage-is-partial",
  notReduced: "pseudonymiser-did-not-reduce-the-payload-tier",
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Small readers. Every one of them is total: no throw, no cast that lies.
// ─────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * ⭐ THE COVERAGE REPORT IS VALIDATED, NOT CARRIED.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FUNCTION USED TO BE, AND WHY THAT WAS THE HOLE
 * ─────────────────────────────────────────────────────────────────────────
 * It used to check the report's SHAPE — three string arrays, a number, a
 * boolean, a string — and then hand the strings straight through to
 * `TextProvenance`, which is inside `facts`, which is inside `envelope.wire`.
 * Shape is not membership. `["<the five-times-nested record>"]` is a string
 * array; a 20,000-character paragraph is a string. Every representation
 * attack the allowlist closed in `facts` was open again in the metadata
 * riding beside it, and the only thing on that path was
 * `assertNoResidualPii` — the unbounded scanner this package exists to stop
 * relying on.
 *
 * So this function now ADMITS rather than reads:
 *
 *   - every member of `checked`, `unchecked` and `representations` must be a
 *     member of a compiled-in vocabulary BY IDENTITY (`coverage.ts`);
 *   - `payloadTier` is a bounded integer, `vaultTier` must be exactly 4
 *     (there is no input under which another number is true — the
 *     pseudonymiser's own type says `4`);
 *   - `statement` must be PRESENT and a string, because a report without one
 *     is not the pseudonymiser's output — and it is then DROPPED. What
 *     travels in its place is a code this package owns.
 *
 * Nothing string-typed and caller-supplied survives onto the wire.
 *
 * ⚠ THE OFFENDING STRING IS NEVER RETURNED. A refusal over an unrecognised
 * class name must not quote the unrecognised class name, for the same reason
 * an unlisted fact key is refused positionally: the caller wrote it, so it
 * may BE the disclosure.
 */
type ReportAdmission =
  | { readonly ok: true; readonly provenance: TextProvenance; readonly reduced: boolean }
  | { readonly ok: false; readonly code: RefusalCode };

function admitCoverageReport(value: unknown): ReportAdmission {
  const malformed = { ok: false, code: "text-coverage-report-malformed" } as const;
  if (!isPlainObject(value)) return malformed;
  const coverage = own(value, "coverage");
  if (!isPlainObject(coverage)) return malformed;
  const rawChecked = own(coverage, "checked");
  const rawUnchecked = own(coverage, "unchecked");
  const rawRepresentations = own(coverage, "representations");
  const payloadTier = own(value, "payloadTier");
  const vaultTier = own(value, "vaultTier");
  const reduced = own(value, "reduced");
  const statement = own(value, "statement");
  if (!isStringArray(rawChecked) || !isStringArray(rawUnchecked) || !isStringArray(rawRepresentations)) {
    return malformed;
  }
  if (typeof payloadTier !== "number" || !Number.isInteger(payloadTier) || payloadTier < 1 || payloadTier > 4) {
    return malformed;
  }
  // `vaultTier` was previously `typeof === "number"` and copied through, so a
  // report could put 1e308, -5 or 4.7 on the wire under a field documented as
  // "Always 4".
  if (vaultTier !== 4) return malformed;
  if (typeof reduced !== "boolean" || typeof statement !== "string") return malformed;

  // ── MEMBERSHIP. Each list, against its own compiled-in vocabulary.
  const unchecked = admitCoverageList(rawUnchecked, COVERAGE_CLASS_VOCABULARY);
  if (unchecked === null) return { ok: false, code: "text-coverage-class-not-in-vocabulary" };
  const checked = admitCoverageList(rawChecked, COVERAGE_DETECTOR_VOCABULARY);
  if (checked === null) return { ok: false, code: "text-coverage-detector-not-in-vocabulary" };
  const representations = admitCoverageList(rawRepresentations, COVERAGE_REPRESENTATION_VOCABULARY);
  if (representations === null) return { ok: false, code: "text-representation-not-in-vocabulary" };

  return {
    ok: true,
    reduced,
    provenance: {
      basis: "pseudonymised",
      by: "packages/pseudonym",
      payloadTier: payloadTier as 1 | 2 | 3 | 4,
      vaultTier: 4,
      checked,
      unchecked,
      representations,
      // ⛔ The caller's prose does not travel. This does.
      statementCode: provenanceStatementCode(reduced, unchecked.length),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Assurance
// ─────────────────────────────────────────────────────────────────────────

function assuranceFor(
  opts: BuildOptions,
  extraUnchecked: readonly string[],
  summary: string,
): Assurance {
  const scanned = opts.names && opts.names.length > 0 ? [...SCANNED_CLASSES, "declaredName"] : [...SCANNED_CLASSES];
  const notChecked = [...new Set([...ENVELOPE_CLASSES_NOT_CHECKED, ...extraUnchecked])].sort();
  return {
    constructedFrom: ["AI_TASKS", "FACT_KEY_POLICY", "VOCABULARIES", "FIELD_NAME_ALLOWLIST", "PROVIDER_MODELS"],
    scanned,
    notChecked,
    // ⭐ THE SENTENCE THE WHOLE PACKAGE IS JUDGED BY. It says what ran, what
    // it found, and what nothing looked at — and it does not contain the
    // words "clean", "safe" or "no personal data".
    statement:
      `${summary} Classes checked by the residual scan over the serialised facts: ${scanned.join(", ")}; ` +
      `none matched. NOT checked, by anything here: ${notChecked.join(", ")}. ` +
      `This is a record of which checks ran. It is NOT a certificate of absence — a class that was not ` +
      `checked, and a class that was checked and did not match, are both merely unfound. ` +
      // ⭐ THE RESIDUE, MEASURED AND STATED. An allowlist makes an undeclared
      // name unexpressible; it does not stop a caller CHOOSING which rungs of
      // COUNT_LADDER and which vocabulary members to send. The figure is
      // derived from the tables (see COUNT_CHANNEL_BITS), so it moves when the
      // tables move, and it is compiled-in words and numbers only.
      `At most ${MAX_COUNT_FACTS} bounded integer(s) may travel together, each snapped up to a rung of ` +
      `COUNT_LADDER: a measured residual capacity of about ${COUNT_CHANNEL_BITS} bits per request in the ` +
      `choice of rungs, which nothing here inspects.`,
  };
}

function refuse(failures: readonly ExpressionFailure[], opts: BuildOptions, extraUnchecked: readonly string[]): Refusal {
  return {
    ok: false,
    failures,
    reason: REFUSAL_REASON,
    assurance: assuranceFor(
      opts,
      extraUnchecked,
      `Refused: ${failures.length} part(s) of this request could not be built from the compiled-in lists.`,
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// buildEnvelope
// ─────────────────────────────────────────────────────────────────────────

export function buildEnvelope(input: unknown, opts: BuildOptions = {}): BuildResult {
  const failures: ExpressionFailure[] = [];
  const extraUnchecked: string[] = [];

  if (!isPlainObject(input)) {
    return refuse([{ code: "not-an-object", at: "<input>" }], opts, extraUnchecked);
  }

  // ── Headers. Compiled-in on both sides, which is what lets the residual
  // scan below cover `facts` alone (see `serialize`).
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  const model = opts.model ?? DEFAULT_MODEL;
  if (!isSelectableProvider(provider)) failures.push({ code: "provider-not-selectable", at: "provider" });
  else if (!isKnownModel(provider, model)) failures.push({ code: "model-not-known", at: "model" });

  const rawTask = own(input, "task");
  // The offending task id is NOT echoed. It is caller free text like any other
  // unlisted string.
  const task = typeof rawTask === "string" && AI_TASKS.includes(rawTask) ? rawTask : null;
  if (task === null) failures.push({ code: "unknown-task", at: "task", expected: "a member of AI_TASKS" });

  // ── Top-level shape. An unrecognised member is a free-text channel by
  // another name — `{ task, facts, notes: "confirm with …" }` is how the data
  // actually travels in practice.
  let topOrdinal = 0;
  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_FIELDS.includes(key)) {
      failures.push({
        code: "unknown-top-level-field",
        at: `#${topOrdinal}`,
        expected: TOP_LEVEL_FIELDS.join("|"),
      });
    }
    topOrdinal += 1;
  }

  // ── Facts.
  const built = new Map<string, EnvelopeFact>();
  const rawFacts = own(input, "facts");
  if (rawFacts !== undefined) {
    if (!isPlainObject(rawFacts)) {
      failures.push({ code: "facts-not-an-object", at: "facts" });
    } else {
      let index = 0;
      for (const key of Object.keys(rawFacts)) {
        const fact = rawFacts[key];
        const policy = factKeyPolicy(key);
        if (policy === undefined) {
          // ⚠ POSITIONAL. The key is not in the policy, so the key is caller
          // data, so naming it here would put it in the log — the fourth
          // exposure the host's key policy closes.
          failures.push({ code: "key-not-in-policy", at: `facts.#${index}` });
          index += 1;
          continue;
        }
        // From here the key IS a compiled-in constant and may be named.
        const at = `facts.${key}`;
        if (!isPlainObject(fact) || typeof own(fact, "kind") !== "string") {
          failures.push({ code: "fact-not-a-tagged-fact", at, expected: policy.kind });
          index += 1;
          continue;
        }
        const kind = own(fact, "kind") as string;
        if (kind !== policy.kind) {
          failures.push({ code: "kind-mismatch", at, expected: policy.kind });
          index += 1;
          continue;
        }
        switch (policy.kind) {
          case "text": {
            // The one door, and it is not this one.
            failures.push({ code: "text-must-use-the-pseudonymised-channel", at, expected: "input.text[]" });
            break;
          }
          case "enum": {
            // The declared vocabulary name is caller data and is NOT echoed —
            // a deliberate tightening of the host, which interpolates it into
            // an Error that its logger then writes down. `expected` names the
            // KEY's vocabulary instead, which is compiled-in.
            const vocabName = own(fact, "vocabulary");
            const members = typeof vocabName === "string" ? vocabulary(vocabName) : undefined;
            if (typeof vocabName !== "string" || members === undefined) {
              failures.push({ code: "unknown-vocabulary", at, expected: `the vocabulary named "${key}"` });
              break;
            }
            const value = own(fact, "value");
            if (typeof value !== "string" || !members.includes(value)) {
              failures.push({ code: "value-not-in-vocabulary", at, expected: `a member of ${key}` });
              break;
            }
            built.set(key, { kind: "enum", vocabulary: vocabName, value });
            break;
          }
          case "fieldName": {
            const value = own(fact, "value");
            if (typeof value !== "string" || !FIELD_NAME_ALLOWLIST.includes(value)) {
              failures.push({ code: "field-name-not-allowlisted", at, expected: "a member of FIELD_NAME_ALLOWLIST" });
              break;
            }
            built.set(key, { kind: "fieldName", value });
            break;
          }
          case "count": {
            // The host's reasoning, kept: `Number.isFinite` alone "made this an
            // unbounded numeric channel … a salary, a birth year or a geo
            // coordinate rode the 'we only send counts' channel intact".
            // `isSafeInteger` closes decimals, exponential notation and >2^53
            // in one predicate; the ceiling comes from the KEY, so the bound
            // is semantic rather than one global guess. Neither the value nor
            // a span of it is echoed: the value may BE the disclosure.
            const max = policy.max ?? MAX_COUNT;
            const value = own(fact, "value");
            if (typeof value !== "number" || !Number.isSafeInteger(value)) {
              failures.push({ code: "count-not-a-safe-integer", at });
              break;
            }
            if (value < 0) {
              failures.push({ code: "count-negative", at });
              break;
            }
            if (value > max) {
              failures.push({ code: "count-over-ceiling", at, expected: String(max) });
              break;
            }
            // ⭐ THE PRECISION, BOUNDED TOO — see `COUNT_LADDER`. The ceiling
            // bounds the magnitude and does nothing about the low bits, and
            // the low bits are where a birth year, a monthly gross and the
            // tail of an IBAN ride a channel that only admits "counts". What
            // goes on the wire is the RUNG, which is a member of a
            // compiled-in list, exactly like an enum value.
            //
            // `snapCount` returns null only past the top rung, which the
            // key's own ceiling has already refused; the load-time check in
            // `allowlists.ts` proves every ceiling is itself a rung, so the
            // snapped value can never climb past `max`. Handled rather than
            // cast, because a cast is how an unchecked number reaches the
            // wire the day someone edits the ladder.
            const rung = snapCount(value);
            if (rung === null || rung > max) {
              failures.push({ code: "count-over-ceiling", at, expected: String(max) });
              break;
            }
            if (countKindFacts(built) + 1 > MAX_COUNT_FACTS) {
              // The bound on the REQUEST, not on one integer. Twelve counts
              // at a few bits each is a salary and a date of birth together.
              failures.push({ code: "too-many-count-facts", at, expected: String(MAX_COUNT_FACTS) });
              break;
            }
            built.set(key, { kind: "count", value: rung });
            break;
          }
        }
        index += 1;
      }
    }
  }

  // ── Section D: the pseudonymised free-text channel.
  const approvalReasons = new Set<string>();
  const rawText = own(input, "text");
  if (rawText !== undefined) {
    if (!Array.isArray(rawText)) {
      failures.push({ code: "text-channel-not-an-array", at: "text" });
    } else {
      let index = 0;
      for (const entry of rawText) {
        const at = `text.#${index}`;
        index += 1;
        if (!isPlainObject(entry)) {
          failures.push({ code: "text-entry-malformed", at });
          continue;
        }
        const key = own(entry, "key");
        const text = own(entry, "text");
        if (typeof key !== "string" || typeof text !== "string") {
          failures.push({ code: "text-entry-malformed", at });
          continue;
        }
        const policy = factKeyPolicy(key);
        if (policy === undefined || policy.kind !== "text") {
          // Positional: an unlisted key is caller data even here.
          failures.push({ code: "text-key-is-not-a-text-key", at });
          continue;
        }
        if (built.has(key)) {
          failures.push({ code: "duplicate-fact-key", at: `text.${key}` });
          continue;
        }
        const rawReport = own(entry, "assessment");
        if (rawReport === undefined) {
          failures.push({
            code: "text-missing-coverage-report",
            at: `text.${key}`,
            expected: "assessTier() output from packages/pseudonym",
          });
          continue;
        }
        const admitted = admitCoverageReport(rawReport);
        if (!admitted.ok) {
          failures.push({ code: admitted.code, at: `text.${key}` });
          continue;
        }
        const report = admitted.provenance;
        // ⭐ THE REPORT'S OWN LIMITS BECOME THE ENVELOPE'S LIMITS, NOW, before
        // any decision is taken about the text — AND THEY ARE SAFE TO DO THAT
        // WITH, which they were not before. This push used to happen with the
        // caller's raw strings and BEFORE the checks below, so a request
        // refused for something else still came back with
        // `assurance.notChecked` and `assurance.statement` carrying
        // "Anna Müller salary 92000 EUR DE02120300000000202051" verbatim —
        // in a field documented as "One line, safe to log: compiled-in words
        // and counts only" and on a REFUSAL, documented as naming keys and
        // codes "never by value". Both are true again because every member
        // of `unchecked` is now a compiled-in constant.
        extraUnchecked.push(...report.unchecked);
        if (report.payloadTier >= 4) {
          // Restricted text is not a thing a human approval can fix — the same
          // position `GATE_POLICY` takes for tier 4 at workflow intake:
          // "clean the source".
          failures.push({ code: "text-payload-tier-restricted", at: `text.${key}`, expected: "payloadTier <= 3" });
          continue;
        }
        if (text.length > MAX_TEXT_CHARS) {
          failures.push({ code: "text-over-max-chars", at: `text.${key}`, expected: String(MAX_TEXT_CHARS) });
          continue;
        }
        // INDEPENDENT RE-PROOF. Not trust in the pseudonymiser: the same
        // belt-and-braces the host applies to its own `redact()`.
        const residual = residualPiiFindings(text, opts);
        if (residual.length > 0) {
          // Class names are compiled-in constants, so naming them is safe —
          // and they are the only thing a human can act on.
          failures.push({ code: "text-residual-pii", at: `text.${key}`, expected: residual.join("+") });
          continue;
        }
        if (countTextFacts(built) + 1 > MAX_TEXT_FACTS) {
          failures.push({ code: "too-many-text-facts", at: `text.${key}`, expected: String(MAX_TEXT_FACTS) });
          continue;
        }
        const fact: EnvelopeFact = { kind: "text", value: text, provenance: report };
        // ⭐ THE ADVERTISED BOUND, OVER THE WHOLE ENTRY. `MAX_TEXT_CHARS` used
        // to bound `text` and nothing else, which is how a 20,000-character
        // statement built an ok:true envelope on a channel advertising 2,000.
        // `MAX_TEXT_FACT_CHARS` is derived in `coverage.ts` from that number
        // plus the largest provenance the vocabularies can express, so the
        // metadata is inside the bound rather than beside it.
        //
        // ⚠ UNREACHABLE WHILE THE VOCABULARIES HOLD, stated rather than
        // hidden: every string in the provenance is now a compiled-in member,
        // so the sum cannot exceed the derived ceiling. It is the belt for a
        // future widening of `coverage.ts`, and `coverage.ts` asserts the same
        // relationship at import. Do NOT count it as live coverage.
        if (JSON.stringify(fact).length > MAX_TEXT_FACT_CHARS) {
          failures.push({ code: "text-fact-over-max-chars", at: `text.${key}`, expected: String(MAX_TEXT_FACT_CHARS) });
          continue;
        }
        built.set(key, fact);
        // ⭐ UNCONDITIONAL. There is no branch below this that can produce a
        // `ready` envelope once a text fact is in it.
        approvalReasons.add(APPROVAL_REASON_CODES.boundedText);
        if (report.unchecked.length > 0) approvalReasons.add(APPROVAL_REASON_CODES.partialCoverage);
        if (!admitted.reduced) approvalReasons.add(APPROVAL_REASON_CODES.notReduced);
      }
    }
  }

  if (failures.length > 0) return refuse(failures, opts, extraUnchecked);
  if (task === null) {
    // ⚠ UNREACHABLE and stated rather than hidden: a task that is not in
    // AI_TASKS pushed a failure above, and the line before this one returned.
    // It is here because the alternative is a cast, and a cast is how an
    // unvalidated header reaches the wire the day someone reorders these two
    // blocks. Do NOT count it as live coverage.
    return refuse([{ code: "unknown-task", at: "task" }], opts, extraUnchecked);
  }

  // ── Serialise, then re-scan the caller-supplied region, then cap the bytes.
  const facts: Record<string, EnvelopeFact> = {};
  for (const key of [...built.keys()].sort()) {
    const fact = built.get(key);
    if (fact !== undefined) facts[key] = fact;
  }

  // ⚠ THE SCAN COVERS `facts`, NOT THE THREE HEADERS — the host's reasoning,
  // transcribed because it is easy to mistake for a weakening: `task`,
  // `provider` and `model` are each validated against a compiled-in list
  // above, so they cannot carry caller data at all, while `facts` is the only
  // caller-influenced region. Scanning the headers too would be worse than
  // useless: a date-stamped model id trips the `digits` class, and "a gate
  // that fires on its own constants is a gate that gets deleted".
  try {
    assertNoResidualPii(JSON.stringify(facts), opts);
  } catch (error) {
    if (error instanceof PiiRefusalError) {
      return refuse(
        [{ code: "residual-pii-in-serialised-form", at: "facts", expected: error.findings.join("+") }],
        opts,
        extraUnchecked,
      );
    }
    throw error;
  }

  const wire = JSON.stringify({ task, provider, model, facts });
  const bytes = Buffer.byteLength(wire, "utf8");
  // ⚠ EFFECTIVELY UNREACHABLE TODAY, stated rather than hidden. The host keeps
  // this cap because its `facts` is a `Record<string, AiFact>` with no breadth
  // limit — "nothing stops a caller adding 10,000 counts". Here the KEYS are
  // an allowlist of a few dozen, each usable once, and the two text facts cap
  // at MAX_TEXT_CHARS apiece, so a legal request cannot approach 32 KiB. It
  // stays as belt: it is the only thing standing between a future widening of
  // the key policy and an unbounded request. Do NOT count it as live coverage.
  if (bytes > MAX_REQUEST_BYTES) {
    return refuse(
      [{ code: "over-byte-cap", at: "<request>", expected: String(MAX_REQUEST_BYTES) }],
      opts,
      extraUnchecked,
    );
  }

  const textFacts = countTextFacts(built);
  const allowlisted = [...built.values()].filter((f) => f.kind === "enum" || f.kind === "fieldName").length;
  const counts = [...built.values()].filter((f) => f.kind === "count").length;
  const disposition = textFacts > 0 ? "requires-human-approval" : "ready";

  return {
    ok: true,
    task,
    provider,
    model,
    facts,
    disposition,
    approvalReasons: [...approvalReasons].sort(),
    assurance: assuranceFor(
      opts,
      extraUnchecked,
      `Built ${built.size} fact(s): ${allowlisted} drawn from compiled-in lists, ${counts} bounded integer(s), ` +
        `${textFacts} bounded text fact(s)` +
        (textFacts > 0
          ? ` — pseudonymised prose, NOT allowlisted values, and this envelope therefore requires a named human.`
          : `.`),
    ),
    wire,
    bytes,
  };
}

function countTextFacts(built: ReadonlyMap<string, EnvelopeFact>): number {
  let n = 0;
  for (const fact of built.values()) if (fact.kind === "text") n += 1;
  return n;
}

function countKindFacts(built: ReadonlyMap<string, EnvelopeFact>): number {
  let n = 0;
  for (const fact of built.values()) if (fact.kind === "count") n += 1;
  return n;
}

/**
 * ⭐ THE MEASURED CAPACITY OF THE BOUNDED-INTEGER CHANNEL, in bits per
 * request, COMPUTED FROM THE TABLES rather than asserted in a comment.
 *
 * A count fact carries one choice among the rungs at or below its key's
 * ceiling; `MAX_COUNT_FACTS` of them may travel together. The figure is the
 * largest such sum, and it goes into the `Assurance` because the honest place
 * to record the limits of a control is in its output. Before the ladder and
 * this cap the same measurement read ~146 bits across the twelve count keys —
 * "enough for a salary and a date of birth together".
 */
export const COUNT_CHANNEL_BITS: number = (() => {
  const perKey = Object.values(FACT_KEY_POLICY)
    .filter((policy) => policy.kind === "count")
    .map((policy) => COUNT_LADDER.filter((rung) => rung <= (policy.max ?? MAX_COUNT)).length)
    .map((rungs) => Math.log2(Math.max(rungs, 1)))
    .sort((a, b) => b - a);
  const bits = perKey.slice(0, MAX_COUNT_FACTS).reduce((sum, b) => sum + b, 0);
  return Math.round(bits);
})();

/**
 * The audit-safe description of an envelope: the task, the sorted fact KEYS
 * (each one a compiled-in constant), a per-kind count, and the disposition.
 * Never a value, never the text. The host's `describeAiRequest`, with the
 * disposition added because "a human still has to approve this" is exactly
 * the sort of thing an append-only chain should record.
 */
export function describeEnvelope(envelope: Envelope): {
  task: string;
  factKeys: string[];
  kindCounts: Record<string, number>;
  disposition: string;
} {
  const kindCounts: Record<string, number> = {};
  for (const fact of Object.values(envelope.facts)) {
    kindCounts[fact.kind] = (kindCounts[fact.kind] ?? 0) + 1;
  }
  return {
    task: envelope.task,
    factKeys: Object.keys(envelope.facts).sort(),
    kindCounts,
    disposition: envelope.disposition,
  };
}
