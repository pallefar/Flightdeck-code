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
 *   3. The report is carried ON the envelope, in `TextProvenance`, including
 *      its `unchecked` list. The limits travel with the payload.
 *   4. The text is INDEPENDENTLY re-scanned here with the host's own
 *      `residualPiiFindings`. That is not trust in the pseudonymiser; it is
 *      the same belt-and-braces `serializeAiRequest` applies to `redact()`.
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
 * an unlisted key, never a span of text. See `ExpressionFailure`.
 */

import {
  AI_TASKS,
  FIELD_NAME_ALLOWLIST,
  MAX_COUNT,
  MAX_REQUEST_BYTES,
  MAX_TEXT_CHARS,
  MAX_TEXT_FACTS,
  factKeyPolicy,
  isKnownModel,
  isSelectableProvider,
  vocabulary,
} from "./allowlists";
import { DEFAULT_MODEL } from "../../providers/src/config";
import { PiiRefusalError, SCANNED_CLASSES, assertNoResidualPii, residualPiiFindings } from "./host-scan";
import {
  ENVELOPE_CLASSES_NOT_CHECKED,
  type Assurance,
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

/** A well-formed coverage report, checked field by field. A report is
 * EVIDENCE; evidence that cannot be read is not evidence. */
function readCoverageReport(value: unknown): CoverageReportLike | null {
  if (!isPlainObject(value)) return null;
  const coverage = own(value, "coverage");
  if (!isPlainObject(coverage)) return null;
  const checked = own(coverage, "checked");
  const unchecked = own(coverage, "unchecked");
  const representations = own(coverage, "representations");
  const payloadTier = own(value, "payloadTier");
  const vaultTier = own(value, "vaultTier");
  const reduced = own(value, "reduced");
  const statement = own(value, "statement");
  if (!isStringArray(checked) || !isStringArray(unchecked) || !isStringArray(representations)) return null;
  if (typeof payloadTier !== "number" || !Number.isInteger(payloadTier) || payloadTier < 1 || payloadTier > 4) {
    return null;
  }
  if (typeof vaultTier !== "number" || typeof reduced !== "boolean" || typeof statement !== "string") return null;
  return { payloadTier, vaultTier, reduced, coverage: { checked, unchecked, representations }, statement };
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
      `checked, and a class that was checked and did not match, are both merely unfound.`,
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
            built.set(key, { kind: "count", value });
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
        const report = readCoverageReport(rawReport);
        if (report === null) {
          failures.push({ code: "text-coverage-report-malformed", at: `text.${key}` });
          continue;
        }
        // The report's own limits become the envelope's limits, now, before
        // any decision is taken about the text.
        extraUnchecked.push(...report.coverage.unchecked);
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
        built.set(key, {
          kind: "text",
          value: text,
          provenance: {
            basis: "pseudonymised",
            by: "packages/pseudonym",
            payloadTier: report.payloadTier,
            vaultTier: report.vaultTier,
            checked: report.coverage.checked,
            unchecked: report.coverage.unchecked,
            representations: report.coverage.representations,
            statement: report.statement,
          },
        });
        // ⭐ UNCONDITIONAL. There is no branch below this that can produce a
        // `ready` envelope once a text fact is in it.
        approvalReasons.add(APPROVAL_REASON_CODES.boundedText);
        if (report.coverage.unchecked.length > 0) approvalReasons.add(APPROVAL_REASON_CODES.partialCoverage);
        if (!report.reduced) approvalReasons.add(APPROVAL_REASON_CODES.notReduced);
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
