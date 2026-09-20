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
 *   const { text, vault } = tokenize(source, { names: ["Jane Doe"] });
 *   const verdict = assessTier(text, vault);      // ask BEFORE sending
 *   const answer  = await model(text);            // the vault does not go
 *   const { text: final, report } = detokenize(answer, vault);
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS TO UNDERSTAND BEFORE USING IT
 * ─────────────────────────────────────────────────────────────────────────
 * 1. THIS IS PSEUDONYMISATION, NOT ANONYMISATION. GDPR Recital 26: data that
 *    can be re-attributed using additional information is still personal
 *    data. The vault IS that additional information. The transmitted payload
 *    gets a real, useful tier reduction — the model never sees the values —
 *    and the vault is category 4 forever. `assessTier` says both, every time.
 *
 * 2. THE TIER REDUCTION IS EARNED PER PAYLOAD, NOT GRANTED BY THE TOOL.
 *    `assessTier` refuses to reduce when quasi-identifiers remain and refuses
 *    to reduce at all when Art. 9 prose remains. 4 → 1 is never claimed. If
 *    you want a function that always returns "safe", this is the wrong
 *    package and there should not be a right one.
 *
 * 3. NOTHING HERE IS TRUSTED TO HAVE WORKED. `tokenize` proves its own output
 *    clean with the HOST'S OWN scanner before returning, and refuses on
 *    residue. `detokenize` treats model output as hostile and restores
 *    strictly by vault lookup.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT EXPORTED
 * ─────────────────────────────────────────────────────────────────────────
 * `vaultEntries`, `lookupOrdinal` and `internValue` read or write the values.
 * `detokenize` and `assessTier` need them and import them directly from
 * `./vault`; they are not part of the package's surface, so the obvious way
 * to use this package is also the safe one. That is a guard rail, not a
 * boundary — see the header of `vault.ts` for exactly what is and is not
 * claimed.
 */

export {
  PseudonymError,
  ResidualPiiError,
  TagCollisionError,
  TagIntegrityError,
  VaultCapacityError,
  VaultSealedError,
  VaultSerializationError,
} from "./errors";

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

/** The handle only. The store, and every function that can read it, stay in
 * `./vault`. `size` and `toString()` are the whole of what a Vault will tell
 * you about itself, and `JSON.stringify` on one throws. */
export { Vault, vaultClasses, vaultTags } from "./vault";

export { type TokenizeFinding, type TokenizeOptions, type TokenizeResult, tokenize } from "./tokenize";

export {
  type DetokenizeOptions,
  type DetokenizeReport,
  type DetokenizeResult,
  type RejectedTag,
  type RestoredTag,
  type TagRejectReason,
  detokenize,
} from "./detokenize";

export {
  type AssessTierOptions,
  type Tier,
  type TierAssessment,
  type TierCoverage,
  type TierReason,
  type TierReasonCode,
  PII_CLASSES_NOT_CHECKED,
  assessTier,
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
 * `signalStem` so they can see what each entry was actually reduced to
 * rather than trusting that the reduction was sensible. */
export {
  PERSON_REFERENT_SIGNALS,
  QUASI_IDENTIFIER_SIGNALS,
  SPECIAL_CATEGORY_SIGNALS,
  foldForSignals,
  signalHits,
  signalStem,
} from "./signals";
