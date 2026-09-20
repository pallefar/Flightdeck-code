/**
 * ⭐ WHAT BINDS A TIER CLAIM TO THE TEXT IT DESCRIBES.
 *
 * Every other field of a coverage report is admitted against a closed
 * vocabulary in `coverage.ts`, so a caller cannot invent a class name or a
 * detector. `payloadTier` had no such check: it is a number, 1–4, and
 * `buildEnvelope` read it to decide whether a request may go out as `ready`
 * or must stop for a human. A caller who hand-wrote
 *
 *     { payloadTier: 2, reduced: true, coverage: {...copied from a real run} }
 *
 * got `ready` over arbitrary text. Every membership check in this package
 * passed, because none of them was looking at that number. The four
 * conditions for `ready` reduced, in practice, to five regexes plus three
 * strings the caller typed.
 *
 * This module adds the missing half: TWO INVARIANTS OF THE PRODUCER THAT ARE
 * CHECKABLE FROM THE TEXT THIS PACKAGE ALREADY HOLDS. Neither needs a secret,
 * a signature, or the pseudonymiser's runtime — which this package still must
 * not import (see the header of `coverage.ts`).
 *
 *   1. TIER 1 IS NOT PRODUCIBLE. `assessTier` pushes two unconditional
 *      floor-2 reasons before it looks at anything — `tier-1-not-claimable`
 *      and `bounded-scan-coverage` — so its output is ALWAYS >= 2. A report
 *      claiming 1 did not come from it. This is an absolute: no input to the
 *      producer yields 1, so there is no false positive to trade against.
 *
 *   2. A PSEUDONYMISED PAYLOAD IS AT LEAST TIER 3. When the text carries a
 *      personal tag, `assessTier` pushes `pseudonymised-natural-person` at
 *      floor 3 (GDPR Recital 26: pseudonymised data is still personal data).
 *      So a report claiming <= 2 over text containing `<person:a1>` did not
 *      come from it either.
 *
 * NOTE WHAT THIS IS NOT. It is not a new policy. The producer already rates
 * pseudonymised text tier 3, and `buildEnvelope` already withholds `ready`
 * above tier 2 — a TRUTHFUL report has always taken that path. This only
 * makes the existing rule enforceable against a caller who lies, which is the
 * difference between a rule and a comment.
 *
 * ⚠ THE DETECTOR BELOW IS DELIBERATELY WIDER THAN THE PRODUCER'S.
 * The two directions are not symmetric:
 *
 *   - MISSING a tag the producer would catch reopens the hole exactly: the
 *     forged `payloadTier: 2` stands and the text goes out as `ready`.
 *   - FIRING on something the producer would not is a refusal, and a refusal
 *     is always available to a control. The cost is that first-party text
 *     mentioning a literal `<date>` — a format string, say — stops for a
 *     human instead of going straight out.
 *
 * So this errs wide, and `__tests__/tier-claim-drift.test.ts` proves the
 * superset property BY EXECUTION rather than by comparing regex sources: it
 * imports the producer's own `findTagCandidates` and asserts that wherever it
 * reports a personal tag, this module fires too.
 */

/**
 * TRANSCRIBED from `packages/pseudonym/src/tags.ts` — `PERSONAL_TAG_CLASSES`.
 * `literal` is deliberately ABSENT: it is the one tag class the producer does
 * not count as a natural person, so it does not carry the floor-3 reason.
 */
export const PERSONAL_TAG_CLASSES: ReadonlySet<string> = new Set<string>([
  "email",
  "iban",
  "number",
  "amount",
  "date",
  "person",
]);

/** The producer's unconditional floor — `tier-1-not-claimable`. */
export const PRODUCER_FLOOR = 2;

/** The floor a personal tag carries — `pseudonymised-natural-person`. */
export const PSEUDONYMISED_FLOOR = 3;

/**
 * Wider than `TAG_CANDIDATE_RE`: any bracket form the producer accepts, any
 * alphabetic class name up to 12 chars, any discriminator that is not itself
 * a bracket. Membership in `PERSONAL_TAG_CLASSES` is checked after matching,
 * so widening the shape cannot smuggle in a class this module does not know.
 */
const TAG_SHAPE = /(?:<|&lt;|&#60;|&#[xX]3[cC];)\s*([A-Za-z]{1,12})\s*(?::[^<>]{0,64})?\s*(?:>|&gt;|&#62;|&#[xX]3[eE];)/g;

/** True when the text carries a tag the producer would floor at 3. */
export function textIsPseudonymised(text: string): boolean {
  for (const match of text.matchAll(TAG_SHAPE)) {
    const cls = match[1];
    if (cls !== undefined && PERSONAL_TAG_CLASSES.has(cls.toLowerCase())) return true;
  }
  return false;
}

/** The lowest `payloadTier` a truthful report over this text can carry. */
export function tierFloorForText(text: string): number {
  return textIsPseudonymised(text) ? PSEUDONYMISED_FLOOR : PRODUCER_FLOOR;
}

export type TierClaimAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "text-tier-below-producer-floor" | "text-tier-contradicted-by-payload" };

/**
 * ⭐ THE CHECK. `claimed` is caller data; `text` is the bytes that will
 * actually travel. Where they contradict each other, the bytes win.
 */
export function admitTierClaim(claimed: number, text: string): TierClaimAdmission {
  if (claimed < PRODUCER_FLOOR) return { ok: false, code: "text-tier-below-producer-floor" };
  if (claimed < tierFloorForText(text)) return { ok: false, code: "text-tier-contradicted-by-payload" };
  return { ok: true };
}
