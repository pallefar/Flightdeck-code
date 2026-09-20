/**
 * `assessTier` — the JUSTIFIED verdict, which is sometimes "no".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ A REDUCTION IS A POSITIVE CLAIM AND NEEDS POSITIVE GROUNDS
 * ─────────────────────────────────────────────────────────────────────────
 * This function used to be written the other way round. It tried to PROVE THE
 * PAYLOAD CLEAN and defaulted to clean when it found nothing, and that is
 * backwards for a safety control. Absence of detection is not evidence of
 * absence, and for the classes outside the host's patterns — a bare
 * undeclared name, a passport number, a percent-encoded address — it can
 * never be evidence, because those classes were never looked at.
 *
 * The defect that made concrete:
 *
 *     assessTier("Anna Müller ist Werksleiter am Standort Bremen und die
 *                 einzige Prokuristin.", new Vault())
 *       → payloadTier 2, reduced: true, "no-personal-data-in-payload",
 *         "payload may be treated as tier 2 (from 4)"
 *
 * …while `signalHits` on that same string returned `werksleiter`,
 * `standort`, `prokuristin`, `die einzige`. The evidence was computed and
 * then thrown away by one clause — `if (quasi.length > 0 && aboutAPerson)` —
 * because `aboutAPerson` came only from the VAULT. Declare the name and the
 * verdict was 3 with the risk named; forget it and the verdict was an
 * affirmative all-clear. The tool was SAFEST when the caller was most careful
 * and MOST DANGEROUS when they forgot, which turns a caller's omission into a
 * licence to transmit.
 *
 * So the shape is inverted, in four places:
 *
 *   1. PERSONHOOD IS READ FROM THE TEXT AS WELL AS THE VAULT. The quasi
 *      identifier hits, the Art. 9 hits, person-referent words, name-shaped
 *      spans and identifier-shaped tokens all vote. The vault is one witness
 *      among several and no longer the gate the others hang behind.
 *   2. THE QUASI-IDENTIFIER FLOOR IS UNCONDITIONAL. A hit floors at 3 whether
 *      or not the vault holds anything. That clause was the bug.
 *   3. UNRESOLVED IDENTIFYING CONTENT BLOCKS THE REDUCTION ENTIRELY when the
 *      caller declared no names, because then NOTHING checked the name class
 *      and something in the text is shaped like a name. A caller who declares
 *      nothing gets a more cautious answer, not a cleaner one.
 *   4. THE VERDICT CARRIES ITS OWN COVERAGE. `coverage.checked` and
 *      `coverage.unchecked` ship with every assessment, and the statement
 *      says out loud that a miss over a known-partial class set is not a
 *      clean bill of health.
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
 *     is proved, not assumed (`tokenize` step 4) — now over every
 *     representation of the payload, not one (`representations.ts`).
 *   - THE VAULT is category 4. Always. `vaultTier` below is the literal
 *     `4` — there is no branch that can produce another number, because there
 *     is no input under which another number would be true.
 *
 * So the ladder this function will climb down is short and it stops early:
 *
 *   4 → 3   ROUTINE, and the point of the package. Direct identifiers are
 *           gone and proved gone.
 *   3 → 2   ONLY when NOTHING — not the vault, not the tags, not the signal
 *           lists, not the shape of the text, not any derived representation
 *           of it — indicates a natural person. Tokenizing a text ABOUT A
 *           PERSON never reaches 2, because Recital 26 says the result is
 *           still information about an identifiable natural person.
 *   → 1     NEVER. Tier 1 is Public, and "may be published" is a decision a
 *           human makes about consequences, not a property a scanner can read
 *           off a string. `tier-1-not-claimable` is an unconditional floor.
 *
 * ⚠ AND 2 IS STILL NOT A CLEAN BILL OF HEALTH. It means "nothing in a
 * bounded, partial set of checks indicated a person". `coverage.unchecked`
 * names what that set does not include, and it ships with the verdict so no
 * reader has to take the number on trust.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HIGHER TIER WINS, INCLUDING OVER THE CALLER
 * ─────────────────────────────────────────────────────────────────────────
 * `sourceTier` is what the caller says the input was. The verdict is the MAX
 * of every floor below, and it is NOT capped at `sourceTier`: a caller who
 * declares 3 and hands over Art. 9 prose gets 4 back. A classifier that can
 * only ever agree downwards with its caller is not a classifier.
 */

import { PII_PATTERNS } from "./host-mirror";
import { UNRESOLVED_IDENTIFIER_INDICATIONS, textIndications } from "./indications";
import { TEXT_REPRESENTATIONS_DERIVED, residualPiiEveryRepresentation } from "./representations";
import { QUASI_IDENTIFIER_SIGNALS, SPECIAL_CATEGORY_SIGNALS, signalHits } from "./signals";
import { PERSONAL_TAG_CLASSES, type TagClass, findTagCandidates, maskMintedTags } from "./tags";
import { Vault, vaultEntries } from "./vault";

/** 1 Public · 2 Internal · 3 Confidential · 4 Restricted. The same four the
 * rest of Studio uses (`packages/guardrails/src/findings.ts`), restated here
 * rather than imported so this package has no build-order dependency on a
 * sibling; the values are the values. */
export type Tier = 1 | 2 | 3 | 4;

export type TierReasonCode =
  /** The residual scan found a PII class still in the payload AS WRITTEN. */
  | "residual-direct-identifier"
  /** A PII class reachable only in a DERIVED representation — percent, entity,
   * escape, base64, an obfuscated separator, a transliterated name. */
  | "residual-direct-identifier-encoded"
  /** A bound stopped the representation walk. Fail-closed: no reduction. */
  | "representation-budget-exhausted"
  /** Something is shaped like an identifier and the caller declared no names,
   * so nothing checked that class. No reduction. */
  | "unverified-name-shaped-content"
  /** Same shape, but names WERE declared and proved gone, so what remains is
   * residual risk rather than an unchecked class. Floor 3. */
  | "residual-name-shaped-content"
  /** The payload stands for a natural person via the vault. Recital 26. */
  | "pseudonymised-natural-person"
  /** The TEXT — not the vault — says a natural person is the subject. */
  | "text-indicates-natural-person"
  /** Art. 9 prose survives tokenization. */
  | "special-category-signal"
  /** Context still narrows the population. */
  | "quasi-identifier-signal"
  /** Nothing indicated a person — the only route to 2. NOT a proof of
   * absence; read it together with `coverage.unchecked`. */
  | "no-personal-data-in-payload"
  /** Always present. Names the classes this scan does NOT cover. */
  | "bounded-scan-coverage"
  /** Publication is a human decision. Unconditional. */
  | "tier-1-not-claimable"
  /** Always present, always 4, never about the payload. */
  | "vault-is-re-identification-key";

export interface TierReason {
  readonly code: TierReasonCode;
  /** The tier this reason will not let the verdict go below. */
  readonly floor: Tier;
  /** Compiled-in constants only — PII class names from the host's patterns,
   * signal words from `signals.ts`, indication names from `indications.ts`,
   * representation names from `representations.ts`. Never a span of the
   * scanned text. */
  readonly evidence: readonly string[];
}

/**
 * WHAT WAS CHECKED AND WHAT COULD NOT BE — shipped with the verdict, because
 * a tier number on its own invites the reading "we looked and it was fine",
 * and this scan is not able to support that reading.
 */
export interface TierCoverage {
  /** Classes and detectors that actually ran against this payload. */
  readonly checked: readonly string[];
  /** Classes of personal data this scan CANNOT see. A reduction is never
   * justified by their absence, only by positive grounds elsewhere. */
  readonly unchecked: readonly string[];
  /** Which representations of the payload the residual proof covered. */
  readonly representations: readonly string[];
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
  /** The limits of the scan that produced `payloadTier`. */
  readonly coverage: TierCoverage;
  /** One line, safe to put in an audit event: codes and compiled-in words. */
  readonly statement: string;
}

export interface AssessTierOptions {
  /** The tier of the ORIGINAL text. Default 4 — the assumption that costs
   * nothing if wrong in this direction. */
  readonly sourceTier?: Tier | undefined;
  /** The same declared names `tokenize` was given, so the residual scan is
   * the same scan. Supplying NONE does not make the answer cleaner — it moves
   * the declared-name class from `coverage.checked` to `coverage.unchecked`
   * and blocks any reduction past a name-shaped span. */
  readonly names?: readonly string[] | undefined;
}

/**
 * Host PII classes that, when they survive, mean a NATURAL PERSON is in the
 * payload rather than merely a number. An amount or a date on its own does
 * not identify anyone; an address, an account or a declared name does.
 */
const PERSONAL_RESIDUAL_CLASSES: ReadonlySet<string> = new Set(["email", "iban", "declaredName"]);

/**
 * The classes of personal data this package CANNOT see, whatever the payload
 * says. Compiled-in, exported, and reported on every assessment, because the
 * honest place to record the limits of a detector is in its output rather
 * than in a comment the caller never reads.
 *
 * `residualPiiFindings` is the host's five regexes plus declared names. That
 * set is what it is; these are the things it is not.
 */
export const PII_CLASSES_NOT_CHECKED: readonly string[] = [
  "undeclared-personal-name",
  "postal-address",
  "phone-number-without-a-long-digit-run",
  "passport-or-id-document-number",
  "tax-or-social-insurance-number",
  "vehicle-registration",
  "online-identifier-or-device-id",
  "biometric-or-photo-reference",
  "free-text-detail-that-identifies-by-context",
  "an-encoding-outside-TEXT_REPRESENTATIONS_DERIVED",
];

/** The detectors that DO run, named the same way, so `checked` and
 * `unchecked` read as one list split in two rather than as two vocabularies. */
const DETECTORS_CHECKED: readonly string[] = [
  "quasi-identifier-signal-words",
  "special-category-signal-words",
  "person-referent-words",
  "name-shaped-span",
  "identifier-shaped-token",
  "minted-tag-classes",
  "vault-entry-classes",
];

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

  // ── Direct identifiers, in EVERY representation ───────────────────────
  // Masked for the same reason `tokenize` masks: a minted tag is this
  // package's own compiled-in vocabulary, not caller data. `maskMintedTags`
  // uses the NARROW mint shape, so a mangled or invented tag in untrusted
  // text cannot hide behind the mask.
  //
  // The scan is `residualPiiEveryRepresentation`, not `residualPiiFindings`,
  // because the old proof was anchored on ONE spelling: `anna%40acme.de`
  // passed it, and the verdict built on that pass read "no personal data in
  // payload". It is additive — the as-written findings are the host's own,
  // unmodified — so nothing that used to be caught stops being caught.
  const masked = maskMintedTags(tokenizedText);
  const scan = residualPiiEveryRepresentation(masked, { names });

  if (scan.asWritten.length > 0) {
    reasons.push({ code: "residual-direct-identifier", floor: sourceTier, evidence: scan.asWritten });
  }
  if (scan.encoded.length > 0) {
    reasons.push({ code: "residual-direct-identifier-encoded", floor: sourceTier, evidence: scan.encoded });
  }
  if (scan.budgetExhausted) {
    // A scan that ran out of budget did not finish, and an unfinished scan is
    // not a clean one. Same fail-closed rule `guardrails` applies to its own
    // representation budget.
    reasons.push({ code: "representation-budget-exhausted", floor: sourceTier, evidence: [] });
  }

  // ── Is there a natural person behind this payload at all? ─────────────
  // FOUR independent readings now, because any one alone can be wrong and the
  // union is the only fail-safe answer:
  //   the VAULT says what was taken out;
  //   the TAGS say what the payload still refers to;
  //   the SIGNAL LISTS say what the prose is about;
  //   the SHAPE of the text says what was never taken out at all.
  // The fourth is the one that was missing, and its absence is what let an
  // undeclared name read as an empty vault and therefore as nobody.
  const found = new Set<TagClass>();
  for (const e of vaultEntries(vault)) {
    if (PERSONAL_TAG_CLASSES.has(e.cls)) found.add(e.cls);
  }
  for (const { verdict } of findTagCandidates(tokenizedText)) {
    if (verdict.kind !== "canonical" && verdict.kind !== "mangled") continue;
    if (PERSONAL_TAG_CLASSES.has(verdict.cls)) found.add(verdict.cls);
  }
  const classes = [...found].sort();
  const pseudonymised = classes.length > 0;

  // ── Context that survives tokenization ────────────────────────────────
  // Computed ONCE and then USED. The previous version computed `quasi` and
  // discarded it whenever the vault happened to be empty.
  const special = signalHits(masked, SPECIAL_CATEGORY_SIGNALS);
  const quasi = signalHits(masked, QUASI_IDENTIFIER_SIGNALS);
  const indications = textIndications(masked, [...quasi, ...special]);
  const unresolved = indications.filter((i) => UNRESOLVED_IDENTIFIER_INDICATIONS.has(i));
  const personalResidual = scan.findings.filter((c) => PERSONAL_RESIDUAL_CLASSES.has(c));

  const textSaysPerson =
    quasi.length > 0 || special.length > 0 || indications.length > 0 || personalResidual.length > 0;
  const aboutAPerson = pseudonymised || textSaysPerson;

  if (pseudonymised) {
    reasons.push({ code: "pseudonymised-natural-person", floor: 3, evidence: classes });
  }
  if (textSaysPerson) {
    const evidence = new Set<string>([...indications, ...personalResidual]);
    if (quasi.length > 0) evidence.add("quasi-identifier-signal");
    if (special.length > 0) evidence.add("special-category-signal");
    reasons.push({ code: "text-indicates-natural-person", floor: 3, evidence: [...evidence].sort() });
  }

  // ── Content that still LOOKS like an identifier ───────────────────────
  // A name-shaped span or a reference-number-shaped token that survived.
  //
  // The split on `names.length` is the whole answer to "a caller's omission
  // must not become a clean verdict". With names declared, the declared ones
  // are proved gone and what is left is residual risk — floor 3. With NO
  // names declared, the name class was never checked by anything, so the
  // reduction has no grounds at all and is refused outright.
  if (unresolved.length > 0) {
    if (names.length === 0) {
      reasons.push({
        code: "unverified-name-shaped-content",
        floor: maxTier(sourceTier, 3),
        evidence: unresolved,
      });
    } else {
      reasons.push({ code: "residual-name-shaped-content", floor: 3, evidence: unresolved });
    }
  }

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

  // ⭐ UNCONDITIONAL. This clause used to read `quasi.length > 0 &&
  // aboutAPerson`, which threw the hits away exactly when the vault was empty
  // — that is, exactly when nothing else was protecting the payload either.
  // Quasi-identifiers narrow a population whether or not a vault exists.
  if (quasi.length > 0) {
    reasons.push({ code: "quasi-identifier-signal", floor: 3, evidence: quasi });
  }

  // ── The only route to 2, and what it does and does not mean ───────────
  const nothingIndicated = !aboutAPerson && scan.findings.length === 0 && !scan.budgetExhausted;
  if (nothingIndicated) {
    reasons.push({ code: "no-personal-data-in-payload", floor: 2, evidence: [] });
  }

  const coverage: TierCoverage = {
    checked: [
      ...PII_PATTERNS.map((p) => p.name),
      ...(names.length > 0 ? ["declaredName"] : []),
      ...DETECTORS_CHECKED,
    ].sort(),
    unchecked: [
      ...PII_CLASSES_NOT_CHECKED,
      ...(names.length === 0 ? ["declared-name-none-supplied"] : []),
    ].sort(),
    representations: scan.representations,
  };
  reasons.push({ code: "bounded-scan-coverage", floor: 2, evidence: coverage.unchecked });

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
    coverage,
    statement: statementFor(payloadTier, sourceTier, ordered, coverage),
  };
}

/** One line for an audit event. Built only from codes, tier numbers and the
 * compiled-in evidence words, so it is safe wherever a finding is safe. */
function statementFor(
  payloadTier: Tier,
  sourceTier: Tier,
  reasons: readonly TierReason[],
  coverage: TierCoverage,
): string {
  const has = (code: TierReasonCode): boolean => reasons.some((r) => r.code === code);
  const parts: string[] = [];

  if (has("residual-direct-identifier")) {
    parts.push(`no reduction: direct identifiers survived tokenization (${evidenceOf(reasons, "residual-direct-identifier")})`);
  } else if (has("residual-direct-identifier-encoded")) {
    parts.push(
      `no reduction: direct identifiers survived tokenization in a re-encoded form (${evidenceOf(reasons, "residual-direct-identifier-encoded")})`,
    );
  } else if (payloadTier >= sourceTier) {
    parts.push(`no reduction: payload remains tier ${payloadTier}`);
  } else {
    parts.push(`payload may be treated as tier ${payloadTier} (from ${sourceTier})`);
  }

  if (has("representation-budget-exhausted")) {
    parts.push("the representation walk did not finish — an unfinished scan is not a clean one");
  }
  if (has("unverified-name-shaped-content")) {
    parts.push(
      `identifier-shaped content remains and NO names were declared, so nothing checked that class (${evidenceOf(reasons, "unverified-name-shaped-content")}) — no reduction`,
    );
  }
  if (has("residual-name-shaped-content")) {
    parts.push(
      `identifier-shaped content remains after the declared names were removed (${evidenceOf(reasons, "residual-name-shaped-content")}) — not reducible below 3`,
    );
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
  if (has("text-indicates-natural-person") && !has("quasi-identifier-signal") && !has("special-category-signal")) {
    parts.push(
      `the payload text itself indicates a natural person (${evidenceOf(reasons, "text-indicates-natural-person")}) — not reducible below 3`,
    );
  }
  if (has("pseudonymised-natural-person") && !has("quasi-identifier-signal")) {
    parts.push("pseudonymised, not anonymised — still personal data under Recital 26, floor 3");
  }

  // ⭐ ALWAYS. The sentence that keeps a number from being read as a proof.
  parts.push(
    `this is a BOUNDED scan over ${coverage.representations.length} representation(s) of ${TEXT_REPRESENTATIONS_DERIVED.length} known forms; ` +
      `a miss is not a clean bill of health — NOT checked: ${list(coverage.unchecked)}`,
  );
  parts.push("vault is tier 4 and must not be transmitted, logged or persisted");
  return parts.join("; ");
}

function evidenceOf(reasons: readonly TierReason[], code: TierReasonCode): string {
  const reason = reasons.find((r) => r.code === code);
  return list(reason?.evidence ?? []);
}

function list(evidence: readonly string[]): string {
  return evidence.length > 3 ? `${evidence.slice(0, 3).join(", ")}, +${evidence.length - 3}` : evidence.join(", ");
}
