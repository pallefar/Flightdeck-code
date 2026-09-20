/**
 * `@pseudonym` — the REVERSIBLE sibling of the host's `redact()`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY "PSEUDONYM" AND NOT "TOKENIZER"
 * ─────────────────────────────────────────────────────────────────────────
 * Two reasons, both load-bearing. "Pseudonymisation" is the term GDPR Art.
 * 4(5) actually defines, and using it keeps the package honest about what it
 * does — a name that said "anonymise" would be a claim this code cannot
 * support. And "token" in a codebase that talks to language models already
 * means a unit of text; a `tokenizer` here would be read as the wrong thing
 * on sight.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE HOST ALREADY HAS, AND WHAT THIS ADDS
 * ─────────────────────────────────────────────────────────────────────────
 * `flightdeck/server/services/ai/envelope.ts` has `redact()`: ONE-WAY and
 * LOSSY on purpose. Every email becomes the same `<email>`, and there is no
 * restore path. That is the right tool when the answer does not need the
 * values back, and it is deliberately not this.
 *
 * This package is the case `redact()` cannot serve: the model has to reason
 * about identity ("`<person:1>` reports to `<person:2>`") and the answer has
 * to come back with the real names in it. So the values are replaced by
 * UNIQUE tags, kept host-side in a vault that is never transmitted, and
 * restored into the model's answer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ THE SURFACE IS ONE FUNCTION, AND THAT IS THE SAFETY PROPERTY
 * ─────────────────────────────────────────────────────────────────────────
 *   const { text, report } = await withPseudonymisation(
 *     source,
 *     { names: ["Jane Doe"] },
 *     async ({ text, assessment }) => {
 *       audit(assessment.statement);   // tags, codes and counts only
 *       return await model(text);      // no vault exists out here
 *     },
 *   );
 *
 * The vault is created inside that call, is never returned and never passed
 * to `send`, and is destroyed in a `finally` — on the returning path, on the
 * refusing path, and on the path where `send` throws.
 *
 * ⚠ IT USED TO BE FOUR FUNCTIONS, AND THAT WAS THE BUG. `tokenize`,
 * `detokenize`, `Vault` and `vaultClasses` were all exported. Holding a Vault
 * and being able to call `detokenize` on it IS the capability to read every
 * value in it, because a tag is one of seven compiled-in class words plus a
 * counter and can be written out by hand:
 *
 *     for (const cls of vaultClasses(vault))
 *       for (let i = 1; i <= vault.size; i++)
 *         out.push(detokenize(`<${cls}:${i}>`, vault).text);   // the vault
 *
 * The previous fix made `detokenize` refuse an input that restores two or
 * more entries while carrying nothing of the model's own. That inspects THE
 * SHAPE OF ONE CALL, so it refuses the one-line spelling and is silent about
 * the loop, which asks for one tag at a time. A check on the shape of a call
 * is one `for` loop away from being irrelevant — the same lesson
 * `packages/approvals` records as "a validating `if` is one edit away from
 * being forgotten". So the capability is no longer handed out. The refusal
 * stays as a second line of defence (`VaultDumpError`), but it is no longer
 * what the claim rests on.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS TO UNDERSTAND BEFORE USING IT
 * ─────────────────────────────────────────────────────────────────────────
 * 1. THIS IS PSEUDONYMISATION, NOT ANONYMISATION. GDPR Recital 26: data that
 *    can be re-attributed using additional information is still personal
 *    data. The vault IS that additional information. The transmitted payload
 *    gets a real, useful tier reduction — the model never sees the values —
 *    and the vault is category 4 for the few milliseconds it exists.
 *
 * 2. THE TIER REDUCTION IS EARNED PER PAYLOAD, NOT GRANTED BY THE TOOL, and
 *    it is now ENFORCED rather than advised. `assessTier` runs inside
 *    `withPseudonymisation`, before `send`, and a payload above
 *    `maxPayloadTier` (default 3) raises `PayloadTierError` with nothing
 *    transmitted. It refuses to reduce when quasi-identifiers remain, refuses
 *    to reduce at all when Art. 9 prose remains, and refuses when the caller
 *    declared no names over name-shaped text. 4 → 1 is never claimed.
 *
 * 3. NOTHING HERE IS TRUSTED TO HAVE WORKED. Tokenization proves its own
 *    output clean with the HOST'S OWN scanner, over every representation of
 *    the payload, before anything is sent, and refuses on residue.
 *    Restoration treats model output as hostile and restores strictly by
 *    vault lookup.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ WHAT IS CLAIMED, EXACTLY
 * ─────────────────────────────────────────────────────────────────────────
 * THE OBVIOUS WAY TO USE THIS PACKAGE IS ALSO THE SAFE ONE — and now for a
 * structural reason rather than a policed one: there is no expression a
 * consumer can write whose value is a `Vault`, so there is nothing for a
 * dumping loop to run against. The only text that ever enters a vault is text
 * the caller passed to `withPseudonymisation` in the same call, so the most a
 * hostile `send` can obtain is the caller's own source text, which it
 * supplied a moment earlier.
 *
 * WHAT IS NOT CLAIMED, stated rather than omitted:
 *   - THIS IS A SURFACE, NOT A SANDBOX. Anything in this process can
 *     `import { vaultEntries } from "./vault"`. Module privacy is not a
 *     capability boundary in a bundled JavaScript process, and this package
 *     has never pretended otherwise — see the header of `vault.ts`. The
 *     package's own tests drive `tokenize` and `detokenize` through exactly
 *     that door. What changed is that a CONSUMER is no longer offered the
 *     pieces, so assembling a dump now means editing this package rather than
 *     calling it.
 *   - `send` SEES THE TOKENIZED PAYLOAD and may keep it. That is what goes to
 *     the model either way, and `assessTier` has already ruled on it.
 *   - THE RESTORED TEXT CONTAINS REAL VALUES. That is the feature. Only the
 *     REPORT is safe to log: every field of it is a tag, a class name from
 *     the closed vocabulary, a reason code or a count.
 */

export {
  PayloadTierError,
  PseudonymError,
  ResidualPiiError,
  TagCollisionError,
  TagIntegrityError,
  VaultCapacityError,
  VaultDumpError,
  VaultSealedError,
  VaultSerializationError,
} from "./errors";

/** ⭐ THE SURFACE. One function, one round trip, one vault lifetime. */
export {
  type PseudonymisationReport,
  type PseudonymisationResult,
  type PseudonymisedPayload,
  type SendPseudonymised,
  type WithPseudonymisationOptions,
  withPseudonymisation,
} from "./with-pseudonymisation";

/** The vocabulary a tag is built from. Compiled-in constants and a pure
 * string function: a tag minted out here buys nothing, because nothing on
 * this surface will trade one for a value. Exported so a downstream scanner
 * can recognise this package's tags rather than guess at them. */
export {
  MAX_VAULT_ENTRIES,
  PERSONAL_TAG_CLASSES,
  TAG_CANDIDATE_RE,
  TAG_CLASSES,
  TAG_MINT_RE,
  type TagClass,
  type TagMangle,
  mintTag,
} from "./tags";

/** ⛔ `Vault`, `vaultClasses`, `vaultTags`, `tokenize` and `detokenize` ARE
 * NOT HERE, and their absence is the fix rather than tidying — see the header.
 * They stay module-internal: `withPseudonymisation` composes them, and the
 * package's tests import the modules directly. The TYPES below are the shapes
 * of what `withPseudonymisation` hands back, none of which can be traded for
 * a value: a `TokenizeFinding` is a tag, a class and a count. */
export { type TokenizeFinding, type TokenizeOptions } from "./tokenize";

export {
  type DetokenizeReport,
  type RejectedTag,
  type RestoredTag,
  type TagRejectReason,
} from "./detokenize";

/** The verdict's shapes. `assessTier` itself is no longer exported: it takes
 * a `Vault`, and there is no longer a way for a consumer to be holding one.
 * That is deliberate — it ran as advice before and runs as a gate now. */
export {
  type Tier,
  type TierAssessment,
  type TierCoverage,
  type TierReason,
  type TierReasonCode,
  PII_CLASSES_NOT_CHECKED,
} from "./tier";

/** THE LIMITS, AS DATA. A caller should not have to read a comment to learn
 * what the verdict did not look at: `TierAssessment.coverage` names it on
 * every assessment, `PII_CLASSES_NOT_CHECKED` is the compiled-in list it
 * draws from, and `TEXT_REPRESENTATIONS_DERIVED` is exactly which spellings
 * of a payload the residual proof covers. Exported so the coverage claim is
 * checkable rather than trusted. */
export {
  type RepresentationBudget,
  type RepresentationScan,
  TEXT_REPRESENTATIONS_DERIVED,
  residualPiiEveryRepresentation,
} from "./representations";

export { TEXT_INDICATIONS, type TextIndication, textIndications } from "./indications";

/** The host's scanner, transcribed and divergence-tested. Re-exported because
 * a caller that wants to re-prove a payload downstream should use the SAME
 * function this package proved it with, not a second opinion. */
export {
  PII_PATTERNS,
  type PiiPattern,
  type RedactOptions,
  assertNoResidualPii,
  residualPiiFindings,
} from "./host-mirror";

/** Named so a caller can see which words a refusal was built from, and
 * `signalStem` so they can see what each entry is actually matched by rather
 * than trusting that the reduction was sensible — the answer is now "the
 * whole entry", because a trimmed stem plus an open window read `schwangen`
 * as `schwanger` and `Psychologe` as `psychisch`. */
export {
  PERSON_REFERENT_SIGNALS,
  QUASI_IDENTIFIER_SIGNALS,
  SPECIAL_CATEGORY_SIGNALS,
  foldForSignals,
  signalHits,
  signalStem,
} from "./signals";
