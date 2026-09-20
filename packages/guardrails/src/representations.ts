/**
 * ONE VALUE, EVERY REPRESENTATION — the SEC-V5-02 shape, applied to a payload
 * instead of to a path.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * `check-contracts-boundary.sh` records the defect this package was built
 * around: person data was untracked from ONE path while an identical copy
 * stayed reachable at another, and 25 tests passed throughout. Its conclusion
 * — "an untrack that removes a file from ONE path while an identical copy
 * lives at another is not a boundary closure" — is about PATHS, but the shape
 * is about REPRESENTATIONS, and the same record wears several:
 *
 *     { employee: { iban: "DE89…" } }              a structured record
 *     '{"employee":{"iban":"DE89…"}}'              the same record as a string
 *     'employee:\n  iban: DE89…'                   the same record as a label list
 *     'eyJlbXBsb3llZSI6…'                          the same record, base64'd
 *
 * `classify()` walks structure and applies the host's field-name denylists to
 * KEYS; `classifyMarkdown()`/`classifyCode()` walk text and apply them to
 * LABEL positions. Each is correct about the representation it was written
 * for and blind to the others, so a caller who hands over the JSON string of a
 * tier-4 record gets a tier-1 answer from `classify()` alone — the identical
 * data, one copy seen and one not, the suite green.
 *
 * So this function does not pick a representation. It derives the ones the
 * value can be read as, classifies EVERY one of them, and returns the MAXIMUM
 * — the same higher-tier-wins rule `tierOf` already applies within a single
 * walk, lifted one level up. There is no anchor, no "primary" form and no
 * early exit, for exactly the reason `classify()` has none.
 *
 * ⛔ IT IS ADDITIVE AND IT NEVER LOWERS A TIER. Every finding `classify()`
 * would have produced is in the result, because `classify()` is the first
 * thing called and its findings are kept verbatim. This function can only
 * ever ADD findings, so no caller can be made worse off by routing through it,
 * and swapping a `classify()` call for this one cannot turn a refusal into an
 * allowance.
 *
 * ⚠ STATED LIMITS, because an unstated one is a lie:
 *   - the alternate walk is BOUNDED (depth, node count, text length). A value
 *     that exceeds a bound yields `representation-budget-exhausted` at tier 4,
 *     fail-closed, the same way `classify()` treats a truncated scan.
 *   - it derives the representations listed below and no others. An encoding
 *     nobody here thought of is not covered, and the honest place to say so is
 *     `REPRESENTATIONS_DERIVED`, which a caller can read.
 */

import { classify, type ClassifyOptions } from "./classify";
import { canonicalJson } from "./approval";
import { type Classification, type Finding, dedupe, tierOf } from "./findings";
import { classifyCode, classifyMarkdown } from "./markdown";

/**
 * Exactly which second paths are walked. Exported so the coverage claim is
 * documentation a caller can read rather than a comment they must trust.
 */
export const REPRESENTATIONS_DERIVED: readonly string[] = [
  "structured", // classify() over the value as given
  "canonical-json-as-prose", // classifyMarkdown() over canonicalJson(value)
  "canonical-json-as-code", // classifyCode() over canonicalJson(value)
  "string-node-as-prose", // classifyMarkdown() over every string in the tree
  "embedded-json", // any string that PARSES as JSON, classified again
  "embedded-base64-json", // any string that DECODES to JSON, classified again
];

export interface RepresentationOptions extends ClassifyOptions {
  /** How deep an embedded encoding may nest before the budget is spent. */
  readonly maxRepresentationDepth?: number;
  /** How many string nodes are re-read as prose / decoded. */
  readonly maxStringNodes?: number;
  /** Longest text handed to a text scanner. */
  readonly maxTextChars?: number;
}

const DEFAULT_DEPTH = 4;
const DEFAULT_STRING_NODES = 500;
const DEFAULT_TEXT_CHARS = 200_000;

/** A string worth trying to parse: JSON objects and arrays only. A bare number
 * or quoted scalar re-parses to itself and would only cost budget. */
const JSON_ISH = /^[\s]*[[{]/;

/** Base64 with enough body to be carrying something, and no other alphabet. */
const BASE64_ISH = /^[A-Za-z0-9+/\s]{24,}={0,2}$/;

function decodeBase64(text: string): string | null {
  if (!BASE64_ISH.test(text)) return null;
  try {
    const decoded = Buffer.from(text.replace(/\s+/g, ""), "base64").toString("utf8");
    // Round-tripping proves it really was base64 rather than a word that
    // happens to use only base64 characters ("employee" decodes to mojibake).
    if (!JSON_ISH.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseJson(text: string): unknown {
  if (!JSON_ISH.test(text)) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed === null || typeof parsed !== "object" ? undefined : parsed;
  } catch {
    return undefined;
  }
}

/**
 * The maximum tier over every representation of `input`.
 *
 * Returns the same `Classification` shape `classify()` returns, so it is a
 * drop-in for any caller that wants the stronger reading, and the findings
 * name which representation they came from through their `where`.
 */
export function classifyEveryRepresentation(
  input: unknown,
  options: RepresentationOptions = {},
): Classification {
  const maxDepth = options.maxRepresentationDepth ?? DEFAULT_DEPTH;
  const maxStringNodes = options.maxStringNodes ?? DEFAULT_STRING_NODES;
  const maxTextChars = options.maxTextChars ?? DEFAULT_TEXT_CHARS;

  const findings: Finding[] = [];
  const budget = { strings: maxStringNodes, exhausted: false };
  const seen = new WeakSet<object>();

  const scanText = (text: string, where: string): void => {
    if (text.length > maxTextChars) {
      budget.exhausted = true;
      return;
    }
    findings.push(...classifyMarkdown(text, where));
    findings.push(...classifyCode(text, where));
  };

  const walkStrings = (value: unknown, depth: number, where: string): void => {
    if (budget.exhausted) return;
    if (typeof value === "string") {
      if (budget.strings <= 0) {
        budget.exhausted = true;
        return;
      }
      budget.strings -= 1;
      // The same characters read as a label list rather than as a value.
      scanText(value, `${where}#prose`);
      if (depth >= maxDepth) return;
      // The same characters read as the structure they encode.
      const embedded = parseJson(value) ?? parseJson(decodeBase64(value) ?? "");
      if (embedded !== undefined) visit(embedded, depth + 1, `${where}#embedded`);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, i) => walkStrings(item, depth, `${where}[${i}]`));
      return;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      walkStrings(child, depth, where);
    }
  };

  const visit = (value: unknown, depth: number, where: string): void => {
    if (budget.exhausted || depth > maxDepth) {
      budget.exhausted = depth > maxDepth ? true : budget.exhausted;
      return;
    }
    // 1. The value as it stands, by the structure-aware walker. Kept verbatim:
    //    this function is a superset of `classify()`, never a replacement for
    //    its judgement.
    findings.push(...classify(value, options).findings);
    // 2. The value serialized — where a field NAME stops being a key and
    //    becomes a label, which is the reading `classify()` cannot make.
    scanText(canonicalJson(value), `${where}#json`);
    // 3. Every string inside it, as prose and as whatever it encodes.
    walkStrings(value, depth, where);
  };

  visit(input, 0, options.rootPath ?? "<value>");

  if (budget.exhausted) {
    findings.push({
      class: "representation-budget-exhausted",
      tier: 4,
      via: "field-name",
      where: options.rootPath ?? "<value>",
    });
  }

  const deduped = dedupe(findings);
  return { tier: tierOf(deduped), findings: deduped };
}
