/**
 * `assessTier` — the JUSTIFIED verdict, which is sometimes "no".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE CLAIM THIS PACKAGE IS ALLOWED TO MAKE, AND THE ONE IT IS NOT
 * ─────────────────────────────────────────────────────────────────────────
 * Reversible tokenization is PSEUDONYMISATION. GDPR Recital 26: personal data
 * which have undergone pseudonymisation, and which could be attributed to a
 * natural person by the use of additional information, SHOULD BE CONSIDERED
 * INFORMATION ON AN IDENTIFIABLE NATURAL PERSON. The vault is that additional
 * information and it is three metres away in the same process.
 *
 * What genuinely changes is who can see what:
 *   - THE TRANSMITTED PAYLOAD no longer contains direct identifiers, and that
 *     is proved, not assumed (`tokenize` step 4). The model never sees the
 *     data. This is the real win and it is worth having.
 *   - THE VAULT is category 4. Always. `vaultTier` below is the literal
 *     `4` — there is no branch that can produce another number, because there
 *     is no input under which another number would be true.
 *
 * So the ladder this function will climb down is short and it stops early:
 *
 *   4 → 3   ROUTINE, and the point of the package. Direct identifiers are
 *           gone and proved gone.
 *   3 → 2   ONLY when the payload turns out to hold no personal data at all —
 *           no personal-class vault entry, no signals. Tokenizing a text
 *           ABOUT A PERSON never reaches 2, because Recital 26 says the
 *           result is still information about an identifiable natural person.
 *   → 1     NEVER. Tier 1 is Public, and "may be published" is a decision a
 *           human makes about consequences, not a property a scanner can read
 *           off a string. `tier-1-not-claimable` is an unconditional floor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AND IT REFUSES TO CLIMB DOWN AT ALL WHEN THE CONTEXT STILL IDENTIFIES
 * ─────────────────────────────────────────────────────────────────────────
 * "the works council at Bensheim rejected <person:1>'s fixed-term contract on
 * <date:2>" contains no identifier and identifies someone. Quasi-identifiers
 * survive tokenization because they were never identifiers to begin with.
 *
 * `signals.ts` names the phrases that indicate a narrow population, and a hit
 * pins the verdict at 3 with `quasi-identifier-signal` — the statement reads
 * "residual re-identification risk — not reducible below 3". A MISS proves
 * nothing and is never treated as evidence of safety: the Recital 26 floor at
 * 3 applies either way, so the only thing a miss can do is leave the tier
 * where the Recital already put it.
 *
 * Special-category prose (Art. 9) about a pseudonymised person does not
 * reduce AT ALL: `special-category-signal` floors at 4. Art. 9 data about an
 * identifiable person is Art. 9 data whether or not the name is in the
 * string, and the whole reason `assessTier` exists rather than a constant is
 * that some inputs have to come back with no reduction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HIGHER TIER WINS, INCLUDING OVER THE CALLER
 * ─────────────────────────────────────────────────────────────────────────
 * `sourceTier` is what the caller says the input was. The verdict is the MAX
 * of every floor below, and it is NOT capped at `sourceTier`: a caller who
 * declares 3 and hands over Art. 9 prose gets 4 back. A classifier that can
 * only ever agree downwards with its caller is not a classifier.
 */

import { residualPiiFindings } from "./host-mirror";
import { QUASI_IDENTIFIER_SIGNALS, SPECIAL_CATEGORY_SIGNALS, signalHits } from "./signals";
import { PERSONAL_TAG_CLASSES, type TagClass, findTagCandidates, maskMintedTags } from "./tags";
import { Vault, vaultEntries } from "./vault";

/** 1 Public · 2 Internal · 3 Confidential · 4 Restricted. The same four the
 * rest of Studio uses (`packages/guardrails/src/findings.ts`), restated here
 * rather than imported so this package has no build-order dependency on a
 * sibling; the values are the values. */
export type Tier = 1 | 2 | 3 | 4;

export type TierReasonCode =
  /** The residual scan found a PII class still in the payload. No reduction. */
  | "residual-direct-identifier"
  /** The payload stands for a natural person via the vault. Recital 26. */
  | "pseudonymised-natural-person"
  /** Art. 9 prose survives tokenization. */
  | "special-category-signal"
  /** Context still narrows the population. */
  | "quasi-identifier-signal"
  /** Nothing personal was found — the only route to 2. */
  | "no-personal-data-in-payload"
  /** Publication is a human decision. Unconditional. */
  | "tier-1-not-claimable"
  /** Always present, always 4, never about the payload. */
  | "vault-is-re-identification-key";

export interface TierReason {
  readonly code: TierReasonCode;
  /** The tier this reason will not let the verdict go below. */
  readonly floor: Tier;
  /** Compiled-in constants only — PII class names from the host's patterns,
   * or signal words from `signals.ts`. Never a span of the scanned text. */
  readonly evidence: readonly string[];
}

export interface TierAssessment {
  /** What the TRANSMITTED payload may be treated as. */
  readonly payloadTier: Tier;
  /** What the VAULT is. Always 4. Not a judgement; a fact about what it is. */
  readonly vaultTier: 4;
  /** What the caller said the input was. */
  readonly sourceTier: Tier;
  /** Whether the payload may be treated as lower than the source. */
  readonly reduced: boolean;
  /** Every floor that applied, highest first. */
  readonly reasons: readonly TierReason[];
  /** One line, safe to put in an audit event: codes and compiled-in words. */
  readonly statement: string;
}

export interface AssessTierOptions {
  /** The tier of the ORIGINAL text. Default 4 — the assumption that costs
   * nothing if wrong in this direction. */
  readonly sourceTier?: Tier | undefined;
  /** The same declared names `tokenize` was given, so the residual scan is
   * the same scan. */
  readonly names?: readonly string[] | undefined;
}

function maxTier(a: Tier, b: Tier): Tier {
  return (a > b ? a : b) as Tier;
}

export function assessTier(tokenizedText: string, vault: Vault, opts: AssessTierOptions = {}): TierAssessment {
  const sourceTier: Tier = opts.sourceTier ?? 4;
  const names = opts.names ?? [];
  const reasons: TierReason[] = [];

  // The vault. First, unconditional, and not a function of anything.
  reasons.push({ code: "vault-is-re-identification-key", floor: 4, evidence: [] });

  // Tier 1 is never claimed. Also unconditional.
  reasons.push({ code: "tier-1-not-claimable", floor: 2, evidence: [] });

  // ── Direct identifiers ────────────────────────────────────────────────
  // Masked for the same reason `tokenize` masks: a minted tag is this
  // package's own compiled-in vocabulary, not caller data. `maskMintedTags`
  // uses the NARROW mint shape, so a mangled or invented tag in untrusted
  // text cannot hide behind the mask.
  const masked = maskMintedTags(tokenizedText);
  const residual = residualPiiFindings(masked, { names });
  if (residual.length > 0) {
    reasons.push({ code: "residual-direct-identifier", floor: sourceTier, evidence: residual });
  }

  // ── Is there a natural person behind this payload at all? ─────────────
  // Two independent readings, because either alone can be wrong: the VAULT
  // says what was taken out, the TEXT says what is actually still referenced.
  // A payload trimmed after tokenization may reference fewer tags than the
  // vault holds; a payload assessed against the wrong vault may reference
  // more. The union is the fail-safe answer.
  const found = new Set<TagClass>();
  for (const e of vaultEntries(vault)) {
    if (PERSONAL_TAG_CLASSES.has(e.cls)) found.add(e.cls);
  }
  for (const { verdict } of findTagCandidates(tokenizedText)) {
    if (verdict.kind !== "canonical" && verdict.kind !== "mangled") continue;
    if (PERSONAL_TAG_CLASSES.has(verdict.cls)) found.add(verdict.cls);
  }
  const classes = [...found].sort();
  const aboutAPerson = classes.length > 0;

  if (aboutAPerson) {
    reasons.push({ code: "pseudonymised-natural-person", floor: 3, evidence: classes });
  } else {
    reasons.push({ code: "no-personal-data-in-payload", floor: 2, evidence: [] });
  }

  // ── Context that survives tokenization ────────────────────────────────
  const special = signalHits(tokenizedText, SPECIAL_CATEGORY_SIGNALS);
  if (special.length > 0) {
    // Art. 9 prose ABOUT a pseudonymised person does not reduce at all. Art. 9
    // prose with no subject in it is still confidential, but it is not about
    // an identifiable person, so it does not carry the restricted floor.
    reasons.push({
      code: "special-category-signal",
      floor: aboutAPerson ? 4 : 3,
      evidence: special,
    });
  }

  const quasi = signalHits(tokenizedText, QUASI_IDENTIFIER_SIGNALS);
  if (quasi.length > 0 && aboutAPerson) {
    reasons.push({ code: "quasi-identifier-signal", floor: 3, evidence: quasi });
  }

  let payloadTier: Tier = 1;
  for (const r of reasons) {
    if (r.code === "vault-is-re-identification-key") continue; // about the vault, not the payload
    payloadTier = maxTier(payloadTier, r.floor);
  }

  const ordered = [...reasons].sort((a, b) => b.floor - a.floor || a.code.localeCompare(b.code));
  return {
    payloadTier,
    vaultTier: 4,
    sourceTier,
    reduced: payloadTier < sourceTier,
    reasons: ordered,
    statement: statementFor(payloadTier, sourceTier, ordered),
  };
}

/** One line for an audit event. Built only from codes, tier numbers and the
 * compiled-in evidence words, so it is safe wherever a finding is safe. */
function statementFor(payloadTier: Tier, sourceTier: Tier, reasons: readonly TierReason[]): string {
  const has = (code: TierReasonCode): boolean => reasons.some((r) => r.code === code);
  const parts: string[] = [];

  if (has("residual-direct-identifier")) {
    parts.push(`no reduction: direct identifiers survived tokenization (${evidenceOf(reasons, "residual-direct-identifier")})`);
  } else if (payloadTier >= sourceTier) {
    parts.push(`no reduction: payload remains tier ${payloadTier}`);
  } else {
    parts.push(`payload may be treated as tier ${payloadTier} (from ${sourceTier})`);
  }

  const specialFloor = reasons.find((r) => r.code === "special-category-signal")?.floor;
  if (specialFloor !== undefined) {
    parts.push(
      `special-category content present (${evidenceOf(reasons, "special-category-signal")}) — not reducible below ${specialFloor}`,
    );
  }
  if (has("quasi-identifier-signal")) {
    parts.push(`residual re-identification risk (${evidenceOf(reasons, "quasi-identifier-signal")}) — not reducible below 3`);
  }
  if (has("pseudonymised-natural-person") && !has("quasi-identifier-signal")) {
    parts.push("pseudonymised, not anonymised — still personal data under Recital 26, floor 3");
  }
  parts.push("vault is tier 4 and must not be transmitted, logged or persisted");
  return parts.join("; ");
}

function evidenceOf(reasons: readonly TierReason[], code: TierReasonCode): string {
  const reason = reasons.find((r) => r.code === code);
  const evidence = reason?.evidence ?? [];
  return evidence.length > 3 ? `${evidence.slice(0, 3).join(", ")}, +${evidence.length - 3}` : evidence.join(", ");
}
