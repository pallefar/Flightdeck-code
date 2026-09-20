/**
 * THE SEAL — what makes a `GrantDecision` something this package MINTED rather
 * than something a caller wrote down.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT
 * ─────────────────────────────────────────────────────────────────────────
 * `EffectiveGrant` in `grant.ts` is branded with a module-private `unique
 * symbol` and cannot be forged — but it never leaves the package. The type that
 * actually carries `allowed` is `GrantDecision`, and it was a plain structural
 * interface, so
 *
 *     const forged: GrantDecision = { ...real, allowed: true, reason: "allowed" };
 *
 * compiled, ran, and was indistinguishable from an answer. The guard was
 * protecting the value nobody consumes and leaving the one everybody does.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A SYMBOL BRAND ALONE WOULD NOT HAVE FIXED IT — SAID PLAINLY
 * ─────────────────────────────────────────────────────────────────────────
 * Two honest limits of a TypeScript brand, both of which the attack above
 * walks straight through:
 *
 *   1. A brand is a COMPILE-TIME claim. `{} as GrantDecision` erases it, and an
 *      `as` cast costs an attacker one line.
 *   2. Object spread COPIES own enumerable SYMBOL properties. `{...real,
 *      allowed: true}` carries the brand along with the lie, so a brand whose
 *      value is `true` certifies the forgery.
 *
 * So the brand's VALUE is not `true`. It is an HMAC over the decision's own
 * semantic fields, keyed by a secret this module generates at load and does not
 * export. Spreading a real decision copies a seal that no longer describes the
 * fields beside it, so `verifyDecision()` rejects it; writing a fresh object
 * needs a seal the forger cannot compute. The check is at RUNTIME and does not
 * depend on the type system's goodwill.
 *
 * ⚠ WHAT THIS IS NOT. It is not a signature anyone else can verify, and it does
 * not survive `JSON.stringify` (symbol keys are dropped — which is also why it
 * never reaches a wire format or an audit body). A decision that crossed a
 * process or a serialization boundary is not verifiable, and that is correct: a
 * decision is a RECORD OF AN ANSWER, not a transferable capability. Code inside
 * this process that can `import` this module can call `sealOf` — the seal stops
 * a caller forging a decision, not a maintainer rewriting the package.
 *
 * ⛔ AND IT IS NOT A CACHE. `revocation.test.ts` scans the deciding modules for
 * module-level mutable state, and this file is on that list. `SEAL_KEY` is a
 * `const` holding random bytes: it stores no decision, no row and no boolean,
 * it is never mutated, and possessing it tells you nothing about whether
 * anything is allowed. Nothing about a sealed decision is fresher than the
 * moment it was computed — see `expiresAt` in `decision.ts`.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../guardrails/src/approval";

/**
 * A REAL symbol, module-private, following `grant.ts`'s reasoning: no other
 * module can name this key, so no other module can write the property.
 */
const DECISION_SEAL: unique symbol = Symbol("approvals.decisionSeal");

/** Per-process, never exported, never logged. See the header on what it is not. */
const SEAL_KEY = randomBytes(32);

/** The brand slot. Carried by every minted decision; `true` is never a value of it. */
export interface Sealed {
  readonly [DECISION_SEAL]: string;
}

/**
 * The seal over a canonical projection of the fields that MEAN something.
 * `canonicalJson` is guardrails' — one canonicaliser in the repository, the
 * same one `contentHash()` uses — so two structurally equal decisions seal
 * equal regardless of key insertion order.
 */
export function sealOf(semanticFields: unknown): string {
  return createHmac("sha256", SEAL_KEY).update(canonicalJson(semanticFields), "utf8").digest("hex");
}

/** Attach the seal. The only call site is `decide()` in `decision.ts`. */
export function withSeal<T extends object>(value: T, semanticFields: unknown): T & Sealed {
  return Object.freeze(
    Object.defineProperty(value, DECISION_SEAL, {
      value: sealOf(semanticFields),
      enumerable: false,
      writable: false,
      configurable: false,
    }),
  ) as T & Sealed;
}

/**
 * Recompute the seal from the object's OWN current fields and compare in
 * constant time. A spread-and-edit copy fails here because the seal it carried
 * over describes the values it was taken from, not the values it now sits with.
 */
export function sealMatches(value: object, semanticFields: unknown): boolean {
  const presented: unknown = (value as Partial<Sealed>)[DECISION_SEAL];
  if (typeof presented !== "string") return false;
  const expected = sealOf(semanticFields);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented, "utf8"), Buffer.from(expected, "utf8"));
}
