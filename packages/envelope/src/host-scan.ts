/**
 * THE LAST LINE OF DEFENCE — the host's own residual scan, transcribed, run
 * over the SERIALISED envelope exactly as `serializeAiRequest` runs it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BELT AND BRACES, AND WHICH ONE THIS IS
 * ─────────────────────────────────────────────────────────────────────────
 * This is the BRACES. The belt is `allowlists.ts`: a value that is not a
 * member of a compiled-in list cannot be expressed as a fact at all, so by the
 * time these regexes run there is — by construction — nothing for them to
 * find except a mistake in this package. That is the only reason it is
 * honest to run five regexes over a payload and carry on: they are not the
 * control, they are the check on the control.
 *
 * The host states the same relationship about itself: `serializeAiRequest`
 * calls `assertNoResidualPii` on the finished JSON "even though every text
 * fact already went through `redact()` — because `as Redacted` is a lie a
 * caller can write, and 'I scrubbed it' is a lie a function can tell itself".
 *
 * ⛔ WHAT A PASS HERE DOES NOT MEAN. It does not mean the payload is clean. It
 * means five named classes did not match. `Assurance` in `types.ts` is what
 * gets reported, and it names what was NOT looked at every single time.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A COPY OF THE FUNCTIONS, AND NOT OF THE LIST
 * ─────────────────────────────────────────────────────────────────────────
 * Stated rather than hidden, because a further copy of a security control
 * needs a reason.
 *
 *   THE LIST is NOT copied here. `PII_PATTERNS` is imported from
 *   `packages/guardrails/src/lists.ts`, which already carries the one Studio
 *   copy and already holds it to the host both directions. A third copy of
 *   five regexes would be three chances to drift.
 *
 *   THE TWO FUNCTIONS are copied, because neither `guardrails` nor this
 *   package can import the host module (`envelope.ts` imports
 *   `./providers.js`, which does not resolve from this checkout, and the host
 *   may not be on disk at all). `packages/pseudonym/src/host-mirror.ts`
 *   reached the same conclusion and carries its own copy.
 *
 * Both copies are anchored to the HOST, which is ground truth for both, never
 * to each other — "anchoring on the peer instead would make two wrongs pass".
 * `__tests__/divergence.test.ts` compares the three blocks below to the host
 * file character for character, with ZERO permitted substitutions: even the
 * error class keeps the host's name.
 *
 * ⛔ EVERYTHING BELOW IS A TRANSCRIPTION. Editing one without the same edit in
 * the host is not a fix — it is the divergence the test exists to catch.
 */

import { PII_PATTERNS } from "../../guardrails/src/lists";
import { escapeRegExpLiteral } from "../../guardrails/src/findings";

/** Transcribed from `envelope.ts`'s `RedactOptions`. Only `names` is carried:
 * it is the whole of the host's interface, and the same contract — declaring
 * a known name is the caller's ONE obligation. (`| undefined` is required by
 * this repo's `exactOptionalPropertyTypes`; the host's tsconfig differs. It
 * changes no behaviour and is outside the compared blocks.) */
export interface RedactOptions {
  readonly names?: readonly string[] | undefined;
}

/** Transcribed from `envelope.ts`. */
export class PiiRefusalError extends Error {
  constructor(readonly findings: string[]) {
    super(`refused: residual PII classes in payload: ${findings.join(", ")}`);
    this.name = "PiiRefusalError";
  }
}

/** Transcribed from `envelope.ts`. Returns the NAMES of every PII class still
 * present in `text`, plus `"declaredName"` if any declared name survived.
 * Empty array = five classes did not match. NOT "clean". Never the matched
 * text — "so an audit event, a log line and a 422 body can all say what
 * tripped without reproducing the thing that tripped it". */
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

/** Transcribed from `envelope.ts`. Throws `PiiRefusalError` if `json` still
 * matches any PII class. The error message carries CLASS NAMES only. */
export function assertNoResidualPii(json: string, opts: RedactOptions = {}): void {
  const findings = residualPiiFindings(json, opts);
  if (findings.length > 0) throw new PiiRefusalError(findings);
}

/** The class names this scan is able to report, as data. Used to build the
 * `checked` half of an `Assurance` so the claim is derived from the list that
 * actually ran rather than typed out a second time. */
export const SCANNED_CLASSES: readonly string[] = PII_PATTERNS.map((p) => p.name);
