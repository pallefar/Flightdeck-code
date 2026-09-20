/**
 * THE HOST'S OWN SCANNER, TRANSCRIBED — and the thing that keeps the
 * transcription honest is `__tests__/divergence.test.ts`, not this comment.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A COPY EXISTS AT ALL
 * ─────────────────────────────────────────────────────────────────────────
 * Studio is a separate checkout from `pallefar/project-contract`. It cannot
 * `import` the host's `server/services/ai/envelope.ts`: different tsconfig,
 * different module graph, and at runtime the host may not be on disk at all.
 * `packages/guardrails/src/lists.ts` reached the same conclusion first and
 * states the bargain the host itself wrote down in
 * `flightdeck/tests/aiProxyEdgeFunction.test.ts:12`:
 *
 *     "Two copies of a security list that can silently diverge is worse than
 *      one. These cases are the mechanism that makes the duplication safe —
 *      they FAIL on divergence, in either direction."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SECOND TRANSCRIPTION AND NOT AN IMPORT FROM `guardrails`
 * ─────────────────────────────────────────────────────────────────────────
 * Stated rather than hidden, because a third copy of a security list needs a
 * reason. `guardrails` carries `PII_PATTERNS` and a transcription of
 * `redact()`. It does NOT carry `residualPiiFindings` / `assertNoResidualPii`
 * — the two functions that are the entire point of section C of this package,
 * because they are what turns "we tokenized it" into "we proved it".
 *
 * The copy that matters is therefore checked against the HOST, which is
 * ground truth for both packages, not against the other copy. If `guardrails`
 * and this file both agree with the host, they agree with each other by
 * construction; if one drifts, its own divergence test names it. Anchoring on
 * the peer instead would make two wrongs pass.
 *
 * ⛔ EVERY EXPORT BELOW IS A TRANSCRIPTION. Editing one without the same edit
 * in the host is not a fix — it is the divergence the test exists to catch.
 * Nothing authored by this package belongs in this file; put it in `tags.ts`,
 * `signals.ts` or `tokenize.ts`.
 */

import { ResidualPiiError } from "./errors";

/** Transcribed from `envelope.ts`. ORDER IS LOAD-BEARING and is compared by
 * the divergence test: the host's header says `email` must run before
 * `digits`, "otherwise a numeric local-part would be partly eaten and the
 * address would survive as a recognisable fragment".
 *
 * Note the `digits` class's PLACEHOLDER is `<number>`, not `<digits>`. This
 * package's tag classes are the PLACEHOLDER words, not the class names, so
 * that `<number:3>` reads as an extension of the host's own vocabulary rather
 * than as a competing one. The divergence test compares both fields. */
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

/** Transcribed from `envelope.ts`. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts.map((p) => (p[0] ?? "").toUpperCase() + ".").join(" ");
}

/** Transcribed from `envelope.ts`. */
export function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Transcribed from `envelope.ts`'s `RedactOptions`. Only `names` is carried:
 * it is the whole of the host's interface, and it is the same contract here —
 * declaring a known name is the caller's ONE obligation. */
export interface RedactOptions {
  readonly names?: readonly string[] | undefined;
}

/** Transcribed from `envelope.ts`.
 *
 * ⭐ THIS IS THE FUNCTION SECTION C IS ABOUT. `tokenize()` does not assume it
 * worked; it calls this on its own output and refuses if anything comes back.
 * Returns the NAMES of every PII class still present, plus `"declaredName"`
 * if any declared name survived. Empty array = clean. Never the matched text. */
export function residualPiiFindings(text: string, opts: RedactOptions = {}): string[] {
  const found = new Set<string>();
  for (const { name, re } of PII_PATTERNS) {
    if (new RegExp(re.source, re.flags.replace("g", "")).test(text)) found.add(name);
  }
  for (const name of opts.names ?? []) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue;
    if (new RegExp(escapeRegExpLiteral(trimmed), "i").test(text)) found.add("declaredName");
    for (const part of trimmed.split(/\s+/).filter((p) => p.length >= 3)) {
      if (new RegExp(`\\b${escapeRegExpLiteral(part)}\\b`, "i").test(text)) found.add("declaredName");
    }
  }
  return [...found].sort();
}

/** Transcribed from `envelope.ts`, with the host's `PiiRefusalError` replaced
 * by this package's `ResidualPiiError` — same shape (`findings: string[]`),
 * same class-names-only message, a name that says which module refused.
 * The divergence test compares the BODY, and treats that one substitution as
 * the single permitted edit. */
export function assertNoResidualPii(json: string, opts: RedactOptions = {}): void {
  const findings = residualPiiFindings(json, opts);
  if (findings.length > 0) throw new ResidualPiiError(findings);
}
