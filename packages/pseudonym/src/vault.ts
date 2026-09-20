/**
 * THE VAULT — the re-identification key, and therefore the most dangerous
 * object in this package.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT IS, LEGALLY, SO THE CODE CAN BE HONEST ABOUT IT
 * ─────────────────────────────────────────────────────────────────────────
 * Reversible tokenization is PSEUDONYMISATION, not anonymisation. GDPR
 * Recital 26: personal data which have undergone pseudonymisation, and which
 * could be attributed to a natural person by the use of ADDITIONAL
 * INFORMATION, should be considered information on an identifiable natural
 * person. This object IS that additional information.
 *
 * So the vault is category 4. Always. Not "category 4 if the source was" —
 * always, because it is the key. `assessTier` reports `vaultTier: 4`
 * unconditionally and has no branch that can say otherwise.
 *
 * ⛔ A vault must never be: serialised into a request, written to a log,
 * placed on an audit event, returned from an HTTP handler, or persisted.
 * The payload goes on the wire; the vault stays in the process that made it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW THAT IS MADE STRUCTURALLY HARD RATHER THAN MERELY DOCUMENTED
 * ─────────────────────────────────────────────────────────────────────────
 * The accident this is built against is not malice. It is one line:
 *
 *     await fetch(url, { body: JSON.stringify({ text, vault }) });
 *
 * Four defences, in the order that line would hit them:
 *
 *   1. `toJSON()` THROWS. `JSON.stringify` calls `toJSON` on any value that
 *      has one, at any depth. So the line above throws
 *      `VaultSerializationError` before a byte is produced — it does not
 *      quietly emit `{}`, which is what a plain object with hidden state
 *      would do and which is far worse, because it looks like it worked.
 *
 *   2. THE STORE IS NOT ON THE OBJECT AT ALL. It lives in a module-level
 *      `WeakMap` keyed by the Vault instance, so a Vault has NO own
 *      properties of any kind: `Object.keys`, `Object.entries`, spread,
 *      `for...in`, a structural clone AND `Object.getOwnPropertySymbols` all
 *      come back empty.
 *
 *      ⚠ IT DID NOT USED TO BE. This defence previously read "the store is
 *      symbol-keyed and non-enumerable… the symbol is module-private —
 *      declared here, never exported — so only this file can read the store
 *      at all", and that sentence was FALSE.
 *      `Object.getOwnPropertySymbols` ignores enumerability, so
 *      `vault[Object.getOwnPropertySymbols(vault)[0]]` handed back every
 *      plaintext value and, because the state object it returned is mutable,
 *      setting `sealed = false` re-opened a vault `tokenize` had sealed.
 *      Non-enumerable is not private; a symbol key is not a capability. A
 *      comment that overstates a defence is worse than no comment, because it
 *      is the thing a reviewer checks INSTEAD of checking the code — so the
 *      mechanism was replaced rather than the sentence softened.
 *
 *   3. `toString` AND `util.inspect` ARE OVERRIDDEN. `${vault}` in a prompt
 *      template and `console.log(vault)` are the two ways state leaks out of
 *      an object that refuses `JSON`. Both yield `[Vault 3 entries]`. Note
 *      the count is deliberate: it is already in `tokenize`'s findings, and a
 *      debugger that cannot tell an empty vault from a full one gets used
 *      less carefully, not more.
 *
 *   4. THE VALUES ARE NOT PROPERTIES OF ANYTHING REACHABLE. `vaultEntries`
 *      is exported for `detokenize` only; `index.ts` does not re-export it.
 *
 * ⚠ WHAT THIS IS NOT: a capability boundary. Anything in this process can
 * `import { vaultEntries } from "./vault"` and read every value. That is not
 * a defect to fix — `detokenize` has to read them, so the module must expose
 * them somehow, and TypeScript `private` is erased at runtime anyway. The
 * claim is exactly: an ACCIDENT cannot serialise a vault, and no ordinary
 * inspection of one prints its contents. A determined caller is out of scope
 * and saying otherwise would be the overclaim this package exists to avoid.
 */

import { PseudonymError, VaultCapacityError, VaultSealedError, VaultSerializationError } from "./errors";
import { MAX_VAULT_ENTRIES, mintTag, type TagClass } from "./tags";

/** One value the model never sees. NOT exported from `index.ts`. */
export interface VaultEntry {
  readonly tag: string;
  readonly cls: TagClass;
  readonly ordinal: number;
  /** The text restoration writes back. For a declared name under
   * `nameAliasing: "unify"` this is the CANONICAL declared form, which may
   * differ from a given occurrence in the source — see `aliasForms`. */
  readonly value: string;
  /** How many distinct surface forms of the source collapsed onto this tag.
   * 1 means restoration is byte-exact for every occurrence. >1 means short
   * forms were canonicalised, and `tokenize` reports it as a finding. A
   * COUNT, never the forms themselves. */
  readonly aliasForms: number;
}

interface VaultState {
  readonly byOrdinal: Map<number, VaultEntry>;
  /** Exact source text -> ordinal. This is what makes the same value get the
   * same tag, which is the entire reason a vault exists rather than lossy
   * redaction: the model can be told `<person:1>` reports to `<person:2>`. */
  readonly byValue: Map<string, number>;
  next: number;
  sealed: boolean;
  readonly maxEntries: number;
}

/**
 * ⭐ THE STORE. A module-level `WeakMap`, not a property of the Vault.
 *
 * This is the difference between "hard to reach" and "not there". A symbol
 * key — even a non-enumerable, never-exported one — is still an OWN PROPERTY,
 * and `Object.getOwnPropertySymbols` enumerates own symbols regardless of
 * enumerability. One line of ordinary reflection therefore read the whole
 * store and could write to it.
 *
 * Keyed by the instance, so a Vault that becomes garbage takes its values
 * with it, and holding a reference to the Vault is the ONLY way to reach the
 * state — which is to say, code inside this module.
 *
 * ⚠ STILL NOT A CAPABILITY BOUNDARY, and the header says so: anything in this
 * process can `import { vaultEntries } from "./vault"`. What changed is that
 * reflection on the OBJECT no longer yields anything, so the claim in
 * defence 2 is now a claim the code actually supports.
 */
const STORE = new WeakMap<Vault, VaultState>();

/**
 * Vaults whose store has been DELETED on purpose, rather than never having
 * had one. Kept so `stateOf` can tell "this round trip is over" apart from
 * "this is not one of our objects" — two different bugs, and a caller who
 * gets the wrong message goes looking in the wrong place.
 *
 * `withPseudonymisation` discards the vault in a `finally`, so a reference
 * captured out of that frame by any means is a dead object afterwards rather
 * than a live key ring.
 */
const DISCARDED = new WeakSet<Vault>();

const INSPECT: symbol = Symbol.for("nodejs.util.inspect.custom");

export class Vault {
  /** No fields, declared or installed. A declared field would be an own
   * enumerable property; an installed symbol-keyed one would be an own
   * property `Object.getOwnPropertySymbols` hands out. The state goes into
   * the module's `WeakMap` and is read only through `stateOf` below, so a
   * Vault instance has nothing on it to find. */
  constructor(maxEntries: number = MAX_VAULT_ENTRIES) {
    STORE.set(this, {
      byOrdinal: new Map(),
      byValue: new Map(),
      next: 1,
      sealed: false,
      maxEntries: Math.min(maxEntries, MAX_VAULT_ENTRIES),
    });
  }

  /** ⭐ Defence 1. `JSON.stringify` calls this at any depth. */
  toJSON(): never {
    throw new VaultSerializationError();
  }

  /** Defence 3a — string interpolation into a prompt template.
   *
   * Deliberately does NOT go through `stateOf`: a discarded vault must still
   * be printable. A debug path that throws is a debug path that gets wrapped
   * in a `try` and then ignored. */
  toString(): string {
    if (DISCARDED.has(this)) return "[Vault discarded]";
    return `[Vault ${stateOf(this).byOrdinal.size} entries]`;
  }

  /** Safe metadata. A count is a number; a number cannot carry a name. */
  get size(): number {
    return stateOf(this).byOrdinal.size;
  }
}

/** Defence 3b — `console.log(vault)` / `util.inspect`. Installed on the
 * prototype rather than written as a class member because the key comes from
 * `Symbol.for`, which is a plain `symbol` and not the `unique symbol` a
 * computed class member name requires. Using the well-known registry key
 * means this file never imports `node:util`, so a browser build still works. */
Object.defineProperty(Vault.prototype, INSPECT, {
  value: function inspectVault(this: Vault): string {
    return this.toString();
  },
  enumerable: false,
  writable: false,
  configurable: false,
});

// ─────────────────────────────────────────────────────────────────────────
// PACKAGE-INTERNAL ACCESS
// Everything below reads or writes the store. `index.ts` re-exports none of it.
// ─────────────────────────────────────────────────────────────────────────

/** The one door to the state, and it is inside this module.
 *
 * A Vault built by some other means than the constructor — `Object.create`,
 * a structured clone, a deserialised look-alike — is not in the `WeakMap`, so
 * this throws rather than silently behaving like an empty vault. An empty
 * vault that detokenizes to nothing and assesses as "no personal data" is the
 * failure this refuses to produce. */
function stateOf(vault: Vault): VaultState {
  const state = STORE.get(vault);
  if (state === undefined) {
    if (DISCARDED.has(vault)) {
      throw new PseudonymError(
        "refused: this vault was discarded when its round trip ended — a vault lives for " +
          "exactly one withPseudonymisation() call and is destroyed on every exit from it",
      );
    }
    throw new PseudonymError(
      "refused: this object is not a Vault built by this module — its store does not exist, " +
        "and treating it as an empty vault would silently report a payload as carrying nothing",
    );
  }
  return state;
}

/**
 * Get the tag for `value`, minting one if this vault has not seen it.
 *
 * The two invariants the tests pin:
 *   - SAME value, SAME tag (the `byValue` map);
 *   - DIFFERENT values, DIFFERENT tags (a fresh ordinal per new value, and
 *     ordinals are never reused).
 *
 * `canonicalFor` is the declared-name case: several surface forms of one
 * declared identity intern to the SAME entry, whose `value` is the canonical
 * form. Passing it is what makes "Jane Doe" and a later bare "Doe" read to
 * the model as one person instead of two.
 */
export function internValue(
  vault: Vault,
  cls: TagClass,
  value: string,
  canonicalFor?: string,
): VaultEntry {
  const state = stateOf(vault);
  if (state.sealed) throw new VaultSealedError();

  const identity = canonicalFor ?? value;
  const existingOrdinal = state.byValue.get(value);
  if (existingOrdinal !== undefined) {
    const hit = state.byOrdinal.get(existingOrdinal);
    if (hit === undefined) throw new Error("vault invariant: byValue points at a missing ordinal");
    return hit;
  }

  // A second surface form of an identity already interned: reuse its entry,
  // register this form so the next occurrence is a straight hit, and count it.
  const byIdentity = state.byValue.get(identity);
  if (canonicalFor !== undefined && byIdentity !== undefined) {
    const hit = state.byOrdinal.get(byIdentity);
    if (hit === undefined) throw new Error("vault invariant: byValue points at a missing ordinal");
    const widened: VaultEntry = { ...hit, aliasForms: hit.aliasForms + 1 };
    state.byOrdinal.set(byIdentity, widened);
    state.byValue.set(value, byIdentity);
    return widened;
  }

  if (state.byOrdinal.size >= state.maxEntries) throw new VaultCapacityError(state.maxEntries);

  const ordinal = state.next;
  state.next += 1;
  // `identity !== value` means the FIRST occurrence was already a short form:
  // the entry restores to the canonical declared name, so it is not
  // byte-exact for this occurrence and must not report itself as such.
  const entry: VaultEntry = {
    tag: mintTag(cls, ordinal),
    cls,
    ordinal,
    value: identity,
    aliasForms: identity === value ? 1 : 2,
  };
  state.byOrdinal.set(ordinal, entry);
  state.byValue.set(value, ordinal);
  if (identity !== value) state.byValue.set(identity, ordinal);
  return entry;
}

/** Restoration lookup, BY ORDINAL. The class on the tag is checked by the
 * caller against `entry.cls` — see `detokenize`'s class-mismatch policy. */
export function lookupOrdinal(vault: Vault, ordinal: number): VaultEntry | undefined {
  return stateOf(vault).byOrdinal.get(ordinal);
}

/** Every entry, ordinal order. ⛔ CONTAINS VALUES. `detokenize` and
 * `assessTier` only. Never re-exported from `index.ts`, never logged. */
export function vaultEntries(vault: Vault): readonly VaultEntry[] {
  return [...stateOf(vault).byOrdinal.values()].sort((a, b) => a.ordinal - b.ordinal);
}

/** Tags only. A tag carries nothing about its value (see `tags.ts`), so this
 * is a shape a report or a log line may use.
 *
 * ⛔ NOT RE-EXPORTED FROM `index.ts` ANY MORE, and that is a fix rather than
 * tidying. It returns the vault's WHOLE KEY RING, and it sat on the public
 * surface next to `detokenize`, which trades tags for values:
 *
 *     detokenize(vaultTags(vault).join(" "), vault).text   // the whole vault
 *
 * A caller who wants tags for a report gets one per entry in
 * `TokenizeResult.findings`, which is only reachable by the caller who
 * supplied the source text in the first place. `detokenize` refuses a tag
 * list on its own as well — see `VaultDumpError` — because removing an export
 * cannot stop anyone from typing out seven class words and a counter.
 *
 * Kept here, module-internal, because `detokenize`'s own tests and this
 * package's guards need the list. */
export function vaultTags(vault: Vault): readonly string[] {
  return vaultEntries(vault).map((e) => e.tag);
}

/** SAFE: class names from the compiled-in vocabulary. */
export function vaultClasses(vault: Vault): readonly TagClass[] {
  return [...new Set(vaultEntries(vault).map((e) => e.cls))].sort();
}

/** Close the vault. `tokenize` seals before returning, so a payload that has
 * been assessed cannot have entries added behind the assessment's back.
 *
 * ⛔ ONE WAY. There is no `unsealVault`, and since the state is no longer an
 * own property of the object there is no longer a way to reach `sealed` and
 * set it back to `false` — which `Object.getOwnPropertySymbols(vault)[0]`
 * used to be. A seal that can be lifted by reflection is a comment, not a
 * seal. */
export function sealVault(vault: Vault): Vault {
  stateOf(vault).sealed = true;
  return vault;
}

export function isSealed(vault: Vault): boolean {
  return stateOf(vault).sealed;
}

/**
 * ⛔ DESTROY THE STORE. After this, the Vault instance is an object with no
 * state anywhere: `internValue`, `lookupOrdinal`, `vaultEntries`, `vaultTags`,
 * `vaultClasses` and `size` all throw, and the values are unreachable from
 * anything — including code inside this module.
 *
 * `withPseudonymisation` calls this in a `finally`, which is what makes "the
 * vault does not outlive the round trip" a property of the code rather than a
 * hope about garbage collection. Deleting beats waiting for the instance to
 * become unreachable, because whether it has become unreachable depends on
 * what the CALLER did with the references it was handed, and the whole point
 * of that function is that it hands out none.
 *
 * Idempotent. There is no undo, for the same reason there is no `unseal`.
 */
export function discardVault(vault: Vault): void {
  STORE.delete(vault);
  DISCARDED.add(vault);
}

/** Whether `discardVault` has been called on this vault. For tests and for a
 * caller inside this package that wants to assert the lifetime rather than
 * trust it. Says nothing about the contents — there are none left. */
export function isDiscarded(vault: Vault): boolean {
  return DISCARDED.has(vault);
}
