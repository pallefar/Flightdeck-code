/**
 * The refusals. Every one of them carries CLASS NAMES or TAGS — never a value.
 *
 * That is the host's rule, stated above `PII_PATTERNS` in
 * `flightdeck/server/services/ai/envelope.ts`:
 *
 *     "Findings are reported by NAME only — never the matched text — so an
 *      audit event, a log line and a 422 body can all say what tripped
 *      without reproducing the thing that tripped it."
 *
 * It matters more here than anywhere else in the system, because this package
 * is the one that HOLDS the values. An error thrown from a tokenizer is the
 * shortest path from a vault to a log aggregator, and an `Error` is exactly
 * the kind of object that gets `JSON.stringify`d into one.
 *
 * So: a tag (`<person:1>`) is safe to put in a message — by construction it
 * carries nothing about the value it stands for (see `tags.ts`). A class name
 * (`email`) is safe — it comes from a compiled-in list. Anything else does not
 * go in an error.
 */

/** Base for everything this package refuses. Catchable as one thing by a
 * caller that wants "the pseudonymiser said no" without caring which way. */
export class PseudonymError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PseudonymError";
  }
}

/** The proof gate fired: after tokenizing, the host's OWN residual scanner
 * still found something. The payload is not shipped.
 *
 * `findings` are PII class names from `PII_PATTERNS` plus possibly
 * `"declaredName"` — the exact vocabulary the host's `residualPiiFindings`
 * returns, so a refusal here reads identically to a refusal from
 * `serializeAiRequest`. */
export class ResidualPiiError extends PseudonymError {
  constructor(readonly findings: readonly string[]) {
    super(`refused: residual PII classes survived tokenization: ${findings.join(", ")}`);
    this.name = "ResidualPiiError";
  }
}

/** Somebody tried to serialise a vault. The vault is the re-identification
 * key; it is category 4 always and it never leaves this process.
 *
 * This is thrown from `Vault.prototype.toJSON`, which means it fires on the
 * accident that actually happens — `JSON.stringify({ text, vault })` on the
 * way to `fetch` — not only on a deliberate call. */
export class VaultSerializationError extends PseudonymError {
  constructor() {
    super(
      "refused: a Vault must never be serialised. It is the re-identification key " +
        "(GDPR Recital 26) and is category 4 regardless of the tier of the payload it " +
        "was derived from. Send `result.text`; keep `result.vault` host-side.",
    );
    this.name = "VaultSerializationError";
  }
}

/** The source text genuinely contained something the detokenizer would read
 * back as a tag, and the caller chose `onSourceTagShapedText: "refuse"`.
 *
 * The default policy is not this — it is to tokenize the literal, which is
 * lossless. This exists for callers who would rather not transmit anything
 * tag-shaped at all. `count` is a number; the offending text is not echoed. */
export class TagCollisionError extends PseudonymError {
  constructor(readonly count: number) {
    super(
      `refused: the source contains ${count} span(s) the detokenizer would read as a tag. ` +
        `Use onSourceTagShapedText: "tokenize" (the default) to carry them losslessly.`,
    );
    this.name = "TagCollisionError";
  }
}

/** More distinct values than the vault will hold.
 *
 * The ceiling is not arbitrary — see `MAX_VAULT_ENTRIES` in `tags.ts`. It is
 * what keeps an ordinal to at most four digits, which is what keeps a tag
 * below the host's `digits` class (7+ characters). Raising it would let a tag
 * trip the host's own scanner. */
export class VaultCapacityError extends PseudonymError {
  constructor(readonly maxEntries: number) {
    super(`refused: more than ${maxEntries} distinct values in one vault`);
    this.name = "VaultCapacityError";
  }
}

/** A sealed vault was asked to mint. Vaults are sealed at the end of
 * `tokenize` so that a later caller cannot quietly add an entry and change
 * what an already-assessed payload means. */
export class VaultSealedError extends PseudonymError {
  constructor() {
    super("refused: this vault is sealed; a vault is built once, by tokenize()");
    this.name = "VaultSealedError";
  }
}

/** `detokenize({ onRejected: "throw" })` found a tag it will not restore.
 * `reasons` are codes from a closed vocabulary, never model text. */
export class TagIntegrityError extends PseudonymError {
  constructor(readonly reasons: readonly string[]) {
    super(`refused: the model's output contains tags that cannot be restored: ${reasons.join(", ")}`);
    this.name = "TagIntegrityError";
  }
}
