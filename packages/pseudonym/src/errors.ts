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
        "was derived from. Send the `text` withPseudonymisation() hands your `send` " +
        "callback; the vault stays inside that call and is destroyed when it ends.",
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

/**
 * `detokenize` was handed A TAG LIST RATHER THAN A REPLY.
 *
 * The attack this refuses is two lines long and used to be spelled entirely
 * out of this package's own public surface:
 *
 *     const tags = vaultTags(vault);               // the whole key ring
 *     detokenize(tags.join(" "), vault).text;      // every plaintext value
 *
 * `vaultTags` is no longer exported (see `index.ts`), but no export list can
 * fix this on its own: a tag is seven ASCII words and a counter, so anyone
 * holding a bare `Vault` can write the list out by hand.
 *
 * ⚠ AND NEITHER CAN THIS REFUSAL, WHICH IS WHY IT IS NO LONGER THE FIX. It
 * reads the shape of ONE call, so the same dump asked for one tag per call
 * walks straight past it. What closes the dump is that nobody outside the
 * package is holding a `Vault` at all: `withPseudonymisation` owns it for the
 * length of one round trip. This error now covers the case where the
 * untrusted REPLY is what asks for the key ring — prompt injection aimed at
 * this layer looks exactly like a list of tags.
 *
 * ⛔ WHAT IS REFUSED, EXACTLY: an input that restores TWO OR MORE DISTINCT
 * vault entries while containing nothing of the model's own — no word, no
 * punctuation, nothing but whitespace, commas and semicolons between the
 * tags. That is the shape of a key ring joined with a separator, and it is
 * not the shape of a generated answer. `count` is a number; no tag and no
 * value goes into the message.
 *
 * A caller who genuinely wants a bare list restored says so with
 * `detokenize(text, vault, { onTagOnlyOutput: "restore" })`. The point is not
 * that reading a vault is impossible — `vault.ts` has always said it is not —
 * it is that reading one has to be ASKED FOR rather than fallen into.
 */
export class VaultDumpError extends PseudonymError {
  constructor(readonly count: number) {
    super(
      `refused: this is a tag list, not a model reply — restoring it would read ${count} ` +
        `vault entries out of an input that carries none of the model's own text. ` +
        `Pass onTagOnlyOutput: "restore" if that is genuinely what you want.`,
    );
    this.name = "VaultDumpError";
  }
}

/**
 * `assessTier` — running INSIDE `withPseudonymisation`, before anything is
 * transmitted — put the payload above the ceiling the caller allowed, so
 * `send` was never called.
 *
 * ⭐ THIS IS THE DIFFERENCE BETWEEN A VERDICT AND A CONTROL. `assessTier`
 * used to be a function a caller was advised to call while holding the
 * payload, which made it a comment with a return value: skipping it cost
 * nothing and looked like nothing. It now sits between tokenization and the
 * network on the only path this package offers, and this error is what that
 * path does when the answer is no.
 *
 * The default ceiling is 3 — pseudonymised personal data may be sent; a
 * payload that could not be reduced below category 4 may not. The commonest
 * way to hit it is declaring no `names` over text containing name-shaped
 * spans: nothing then checked that class, so `tier.ts` refuses the reduction
 * outright rather than reporting an all-clear it has no grounds for.
 *
 * `reasons` are `TierReasonCode`s — a closed vocabulary. The tiers are
 * numbers. Neither the payload nor a value goes into the message.
 */
export class PayloadTierError extends PseudonymError {
  constructor(
    readonly payloadTier: number,
    readonly maxPayloadTier: number,
    readonly reasons: readonly string[],
  ) {
    super(
      `refused: the payload assesses as tier ${payloadTier}, above the ${maxPayloadTier} this call ` +
        `allows, so nothing was sent (${reasons.join(", ") || "no reason above the ceiling"}). ` +
        `Declare the names you know are in the text, or pass maxPayloadTier: ${payloadTier} to ` +
        `say in code that you mean to transmit it.`,
    );
    this.name = "PayloadTierError";
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
