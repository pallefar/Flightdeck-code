/**
 * `withPseudonymisation` — THE ROUND TRIP IS THE UNIT, and it is the only
 * unit this package hands out.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS TO CLOSE, AND WHY THE PREVIOUS FIX COULD NOT
 * ─────────────────────────────────────────────────────────────────────────
 * The package used to export `tokenize`, `detokenize`, `Vault` and
 * `vaultClasses`. Holding a `Vault` and being able to call `detokenize` on it
 * IS the capability to read every value in it, because a tag is one of seven
 * compiled-in class words plus a small counter — a caller does not need the
 * tag list, they can write it out by hand:
 *
 *     for (const cls of vaultClasses(vault))
 *       for (let i = 1; i <= vault.size; i++)
 *         out.push(detokenize(`<${cls}:${i}>`, vault).text);   // the vault
 *
 * The previous round of fixes answered that by having `detokenize` REFUSE an
 * input that restores two or more entries while carrying nothing of the
 * model's own (`VaultDumpError`). That check reads THE SHAPE OF ONE CALL, so
 * it refuses `detokenize(allTags, vault)` and says nothing at all about the
 * loop above, which asks for one tag per call and never trips it. A check on
 * the shape of a call is one `for` loop away from being irrelevant, in the
 * same way `packages/approvals` already recorded that "a validating `if` is
 * one edit away from being forgotten".
 *
 * ⭐ SO THE CAPABILITY IS NOT HANDED OUT ANY MORE. The whole purpose of a
 * vault is a round trip — tokenize, send, restore — and a caller has no
 * legitimate reason to hold the key BETWEEN those steps. This function is
 * that round trip:
 *
 *   - the `Vault` is created HERE, is a local of this frame, and is never
 *     returned, never put on the payload, and never passed to `send`;
 *   - `send` receives ONLY the tokenized text, the tier assessment and the
 *     tokenize findings — tags, class names from the closed vocabulary and
 *     counts, no value of any kind;
 *   - the reply comes back from `send` and is restored HERE;
 *   - the vault is discarded in a `finally`, so a `send` that throws destroys
 *     it on exactly the same path as one that returns.
 *
 * THE STRUCTURAL ARGUMENT, STATED SO IT CAN BE CHECKED. There is no longer a
 * public expression whose value is a `Vault`, so there is nothing for an
 * attacker's loop to iterate against. The only text that ever enters a vault
 * is text the caller passed to THIS function in the same call — so the worst
 * a hostile `send` can do is echo the payload back and receive the caller's
 * own source text, which it supplied a moment earlier. "Dumping the vault"
 * and "being handed back your own input" have become the same operation, and
 * that is what makes the dump uninteresting rather than merely refused.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ WHAT IS STILL TRUE, STATED PRECISELY RATHER THAN OMITTED
 * ─────────────────────────────────────────────────────────────────────────
 * 1. THIS IS A SURFACE, NOT A SANDBOX. Anything in this process can
 *    `import { vaultEntries } from "./vault"`. Module privacy is not a
 *    capability boundary in a bundled JavaScript process and this package has
 *    never claimed otherwise (see the header of `vault.ts`). What changed is
 *    that a CONSUMER of the package — someone writing `import { … } from
 *    "@pseudonym"` — is no longer offered the pieces, so the dump is no
 *    longer something an ordinary caller can fall into or assemble by
 *    accident. The existing tests still drive `tokenize`/`detokenize`
 *    directly by importing the modules; that is the same door, and it is
 *    inside the package.
 * 2. `send` SEES THE TOKENIZED TEXT and may keep it. That is the payload —
 *    it is what goes to the model either way — and `assessTier` has already
 *    said what it may be treated as, below.
 * 3. RESTORATION PUTS REAL VALUES IN THE RETURNED TEXT. That is the feature.
 *    The returned text is as sensitive as the source; only the REPORT is
 *    safe to log, and every field of it is a tag, a class name, a reason code
 *    or a count.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `assessTier` IS AN ENFORCEMENT POINT HERE, NOT ADVICE
 * ─────────────────────────────────────────────────────────────────────────
 * It used to be a function a caller was told to call before sending, which
 * means it was a comment with a return value: the caller held the payload and
 * could simply not call it. Here it runs BEFORE `send`, inside, and its
 * verdict decides whether `send` is called at all. `maxPayloadTier` (default
 * 3) is the ceiling; a payload above it raises `PayloadTierError` and nothing
 * is transmitted. A caller who genuinely means to send a category-4 payload
 * says `maxPayloadTier: 4`, which is a sentence in their code rather than an
 * omission in it.
 *
 * Note what the default refuses that nothing used to: a caller who declares
 * no names over text with name-shaped spans gets `payloadTier` 4 (see
 * `unverified-name-shaped-content` in `tier.ts`) and therefore gets no send.
 * Forgetting to declare names is the cheapest mistake in this package and it
 * now stops the request instead of quietly widening it.
 */

import { PayloadTierError, PseudonymError } from "./errors";
import { type DetokenizeOptions, type RejectedTag, type RestoredTag, detokenize } from "./detokenize";
import { type TagClass } from "./tags";
import { type Tier, type TierAssessment, assessTier } from "./tier";
import { type TokenizeFinding, type TokenizeOptions, tokenize } from "./tokenize";
import { discardVault } from "./vault";

/**
 * Everything `send` is given. Constructed here, deep-frozen, and containing
 * no `Vault` and no value — by construction, not by review: `text` is the
 * transmitted payload, `findings` are the tag/class/count records `tokenize`
 * already treats as log-safe, and `assessment` is built from reason codes and
 * compiled-in evidence words.
 */
export interface PseudonymisedPayload {
  /** The tokenized text. This is what goes to the model. */
  readonly text: string;
  /** What the payload may be treated as, and the limits of the scan that
   * decided. Already enforced against `maxPayloadTier` before `send` was
   * called — passed on so the caller can put it on an audit event. */
  readonly assessment: TierAssessment;
  /** One record per vault entry: tag, class, occurrence count. No values. */
  readonly findings: readonly TokenizeFinding[];
  /** Tag classes a declared name is spelled inside; a downstream host scan
   * with the same names will flag these. See `tokenize`'s header. */
  readonly tagClassNameCollisions: readonly TagClass[];
}

/**
 * The caller's one job: take the payload to the model and resolve with the
 * model's reply text.
 *
 * It is given no way to reach the vault, so it cannot be written to leak one,
 * and it does not have to be trusted not to.
 */
export type SendPseudonymised = (payload: PseudonymisedPayload) => string | Promise<string>;

export interface WithPseudonymisationOptions extends TokenizeOptions {
  /** The tier of the ORIGINAL text, passed straight to `assessTier`.
   * Default 4 — the assumption that costs nothing if wrong this way round. */
  readonly sourceTier?: Tier | undefined;

  /**
   * ⭐ THE ENFORCEMENT POINT. The highest `payloadTier` this call may
   * transmit. Default 3: pseudonymised personal data may go, a payload that
   * could not be reduced below category 4 may not. Above it, `send` is never
   * called and `PayloadTierError` is raised.
   */
  readonly maxPayloadTier?: Tier | undefined;

  /** Passed to `detokenize`. See its options; the defaults are its defaults. */
  readonly onRejected?: DetokenizeOptions["onRejected"];
  readonly onTagOnlyOutput?: DetokenizeOptions["onTagOnlyOutput"];
}

/**
 * What happened, BY TAG. Every field is a tag, a class name from the closed
 * vocabulary, a reason code, or a count — the same rule as `DetokenizeReport`
 * and `TokenizeFinding`, which is what this is assembled from. Safe to log in
 * full; the restored TEXT is not.
 */
export interface PseudonymisationReport {
  readonly assessment: TierAssessment;
  /** What went into the vault, per entry. */
  readonly tokenized: readonly TokenizeFinding[];
  /** Tags the model used and we restored, with counts and mangles. */
  readonly restored: readonly RestoredTag[];
  /** Tag-shaped spans in the reply that were NOT restored, by reason. */
  readonly rejected: readonly RejectedTag[];
  /** Vault tags the reply never used. */
  readonly dropped: readonly string[];
  /** Restored tags whose entry unified several surface forms of one name, so
   * those occurrences came back canonicalised rather than byte-exact. */
  readonly canonicalised: readonly string[];
  /** Every vault tag appeared, nothing rejected, nothing canonicalised. */
  readonly exact: boolean;
  readonly tagClassNameCollisions: readonly TagClass[];
}

export interface PseudonymisationResult {
  /** The model's reply with the real values restored. As sensitive as the
   * source text it came from. */
  readonly text: string;
  /** Tags and counts only. This is the part that may go in a log. */
  readonly report: PseudonymisationReport;
}

/** Freeze the payload all the way down, so a `send` that mutates what it was
 * given cannot change the report the caller gets back afterwards. Cheap: the
 * payload is a handful of small arrays of records. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * Tokenize `source`, assess it, hand the payload to `send`, restore the
 * reply, and destroy the vault on the way out — whichever way out it is.
 *
 *   const { text, report } = await withPseudonymisation(
 *     source,
 *     { names: ["Jane Doe"] },
 *     async ({ text, assessment }) => {
 *       audit(assessment.statement);        // codes and counts only
 *       return await model(text);           // no vault exists out here
 *     },
 *   );
 */
export async function withPseudonymisation(
  source: string,
  opts: WithPseudonymisationOptions,
  send: SendPseudonymised,
): Promise<PseudonymisationResult> {
  const { maxPayloadTier, sourceTier, onRejected, onTagOnlyOutput, ...tokenizeOpts } = opts;
  const ceiling: Tier = maxPayloadTier ?? 3;

  // The vault is born here and dies in the `finally` below. It is a local of
  // this frame for its whole life: no caller of this module is ever in a
  // position to name it.
  const { text: payloadText, vault, findings, tagClassNameCollisions } = tokenize(source, tokenizeOpts);

  try {
    // ── THE GATE, BEFORE ANYTHING IS TRANSMITTED ──────────────────────
    // Not "ask before sending" in a comment — `send` is below this line and
    // cannot be reached past a refusal.
    const assessment = assessTier(payloadText, vault, {
      ...(sourceTier === undefined ? {} : { sourceTier }),
      ...(tokenizeOpts.names === undefined ? {} : { names: tokenizeOpts.names }),
    });
    if (assessment.payloadTier > ceiling) {
      throw new PayloadTierError(
        assessment.payloadTier,
        ceiling,
        assessment.reasons.filter((r) => r.floor > ceiling).map((r) => r.code),
      );
    }

    const payload = deepFreeze<PseudonymisedPayload>({
      text: payloadText,
      assessment,
      findings,
      tagClassNameCollisions,
    });

    const reply = await send(payload);
    if (typeof reply !== "string") {
      // A non-string reply means the caller wired something else up. Refuse
      // rather than stringify: `String(someObjectHoldingText)` is how an
      // unrestored payload ends up being returned as if it were an answer.
      throw new PseudonymError(
        "refused: `send` must resolve to the model's reply as a string; " +
          `it resolved to ${reply === null ? "null" : typeof reply}`,
      );
    }

    const restoration = detokenize(reply, vault, {
      ...(onRejected === undefined ? {} : { onRejected }),
      ...(onTagOnlyOutput === undefined ? {} : { onTagOnlyOutput }),
    });

    return {
      text: restoration.text,
      report: {
        assessment,
        tokenized: findings,
        ...restoration.report,
        tagClassNameCollisions,
      },
    };
  } finally {
    // ⭐ ONE EXIT FOR EVERY OUTCOME. Returned, refused by the tier gate,
    // thrown out of by `send`, thrown out of by restoration: the vault's
    // store is deleted on all four paths, so even a reference captured by
    // some other means is a dead object from here on. Letting it go out of
    // scope would rely on nobody having captured it; this does not.
    discardVault(vault);
  }
}
