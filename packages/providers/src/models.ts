/**
 * The model id, alone, with nothing else in the module.
 *
 * ⭐ WHY THIS IS ITS OWN FILE. `packages/envelope` needs exactly one thing
 * from this package — the default model id, so a request naming a model can
 * be checked against a compiled-in constant rather than a caller's string.
 * It imported that from `config.ts`, which also holds
 * `anthropicConfigFromEnv`, whose default parameter is `process.env`.
 *
 * Import closure is TEXTUAL: `packages/conformance`'s FD-C001 refuses a
 * mounted sub-app module for what is PRESENT in its closure, not for what it
 * calls. So one constant pulled the whole env-reading module into the pure
 * surface that `guardrails/pure.ts` advertises — and `process` does not
 * merely fail a rule in a sub-app, it is undefined there.
 *
 * Splitting the constant out is the fix that holds: nothing can grow in this
 * file that the envelope should not reach, because there is nothing here to
 * grow into.
 */

/**
 * ⛔ EXACTLY THIS STRING. No date suffix. `claude-opus-5-20260401` and friends
 * are not real model ids — a date-suffixed variant is a 404, not an alias.
 */
export const DEFAULT_MODEL = "claude-opus-5";
