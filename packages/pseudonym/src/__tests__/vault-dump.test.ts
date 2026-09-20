/** Can a caller dump the vault using ONLY the package's public exports?
 *
 * ⚠ THIS FILE REPLACES A PROBE THAT PROVED NOTHING. The regression agent left
 * `zz-probe2.test.ts` behind: 91 lines, 13 console.log calls, ZERO expect()
 * calls. It printed
 *
 *   PLAINTEXT DUMPED: ["anna@acme.de","DE02120300000000202051", ...]
 *
 * and reported 7 tests passing, because a test with no assertions always
 * passes. A green suite containing a demonstration of a plaintext leak is
 * worse than a red one, so the demonstration is now an assertion.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE ASSERTED BEFORE, AND WHY IT HAD TO BE REWRITTEN
 * ─────────────────────────────────────────────────────────────────────────
 * It used to call `tokenize`, `vaultClasses` and `detokenize` from `../index`
 * and assert the loop over minted tags came back empty. Those three exports
 * no longer exist: the package's surface is `withPseudonymisation`, the vault
 * is a local of that call, and there is no expression a consumer can write
 * whose value is a `Vault`. A test that imports functions the package does
 * not export cannot run at all, so the attack is transcribed rather than
 * dropped — and, per the rule that a replacement must attack the NEW surface
 * AT LEAST AS HARD, it is strictly wider than what it replaces:
 *
 *   1. THE SURFACE IS CHECKED BY IDENTITY, not by name. Re-exporting
 *      `tokenize` as `prepare` would defeat a name check; it does not defeat
 *      a comparison against the module's own function object.
 *   2. THE `send` CALLBACK — the only place a caller gets control between
 *      tokenization and restoration — is searched, recursively, for a vault,
 *      for a value, and for anything callable.
 *   3. THE ONE-TAG-PER-CALL LOOP, which is what defeated the previous fix, is
 *      written out against the new surface and run.
 *   4. THE LIFETIME IS ASSERTED, not assumed: a vault reference smuggled out
 *      of the frame (which no public API permits, so the test cheats to get
 *      one) is a dead object afterwards — including when `send` threw.
 *
 * The previous fix was a check on THE SHAPE OF ONE CALL — refuse an input
 * that restores two or more entries at once — and (3) is exactly the loop
 * that walks around it one tag at a time. This file is green now because the
 * dump has no object to address, not because the dump is being spotted.
 */
import { describe, expect, it, vi } from "vitest";

/** Wrap `discardVault` so the test can hold the vault instances the package
 * refuses to hand out, and then attack them. Everything else is the real
 * module — the factory delegates — so identity checks below are meaningful. */
const { discarded } = vi.hoisted(() => ({ discarded: [] as unknown[] }));
vi.mock("../vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vault")>();
  return {
    ...actual,
    discardVault: (vault: InstanceType<typeof actual.Vault>): void => {
      discarded.push(vault);
      actual.discardVault(vault);
    },
  };
});

import { PseudonymError } from "../errors";
import * as surface from "../index";
import { detokenize } from "../detokenize";
import { assessTier } from "../tier";
import { tokenize } from "../tokenize";
import { Vault, internValue, lookupOrdinal, vaultClasses, vaultEntries, vaultTags } from "../vault";
import { withPseudonymisation } from "../with-pseudonymisation";

const SOURCE = "Anna Müller (anna@acme.de) und Bob Smith, IBAN DE02120300000000202051.";
const NAMES = ["Anna Müller", "Bob Smith"] as const;
const SECRETS = ["anna@acme.de", "DE02120300000000202051", "Anna Müller", "Bob Smith"] as const;

/** Every class word a tag can be built from — the attacker does not need the
 * vault's class list, and never did. */
const CLASS_WORDS = ["person", "email", "iban", "number", "date", "amount", "literal"] as const;

/** Collect every string reachable from a value, and every object that is a
 * Vault or a function. This is the "what did `send` actually get" probe. */
function harvest(value: unknown, strings: string[], suspects: string[], path = "payload"): void {
  if (typeof value === "string") {
    strings.push(value);
    return;
  }
  if (typeof value === "function") {
    suspects.push(`${path} is callable`);
    return;
  }
  if (value instanceof Vault) {
    suspects.push(`${path} is a Vault`);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const key of Object.getOwnPropertyNames(value)) {
    harvest((value as Record<string, unknown>)[key], strings, suspects, `${path}.${key}`);
  }
  for (const key of Object.getOwnPropertySymbols(value)) {
    suspects.push(`${path} carries the own symbol ${String(key)}`);
  }
}

describe("the vault cannot be read out through the public API", () => {
  it("does not put a vault-reading capability on the surface, under ANY name", () => {
    // BY IDENTITY. A name check ("is there an export called `detokenize`?") is
    // defeated by a rename; comparing against the module's own function
    // objects is not. These are the five things that, given a Vault, read it.
    const forbidden: readonly (readonly [string, unknown])[] = [
      ["tokenize", tokenize],
      ["detokenize", detokenize],
      ["assessTier", assessTier],
      ["Vault", Vault],
      ["vaultClasses", vaultClasses],
      ["vaultTags", vaultTags],
      ["vaultEntries", vaultEntries],
      ["lookupOrdinal", lookupOrdinal],
      ["internValue", internValue],
    ];
    const exported = Object.values(surface);
    for (const [name, value] of forbidden) {
      expect(exported, `${name} is reachable from the package surface`).not.toContain(value);
      expect(Object.keys(surface), name).not.toContain(name);
    }
    // And the one thing that IS on the surface, so this test cannot pass by
    // the package having been emptied.
    expect(Object.keys(surface)).toContain("withPseudonymisation");
  });

  it("gives `send` the payload and nothing else — no vault, no value, nothing callable", async () => {
    const strings: string[] = [];
    const suspects: string[] = [];
    await withPseudonymisation(SOURCE, { names: [...NAMES] }, (payload) => {
      harvest(payload, strings, suspects);
      return "ok";
    });
    expect(suspects, "send was handed something it could dig with").toEqual([]);
    for (const secret of SECRETS) {
      expect(strings.join(" | "), `the payload handed \`send\` the value ${secret.slice(0, 4)}…`)
        .not.toContain(secret);
    }
    // The tokenized text really was in there, so the harvest is not empty for
    // the wrong reason.
    expect(strings.some((s) => /<person:\d+>/.test(s))).toBe(true);
  });

  it("leaves the one-tag-per-call loop nothing to loop against", async () => {
    // ⭐ THE ATTACK THAT DEFEATED THE PREVIOUS FIX, on the new surface.
    //
    // `detokenize`'s VaultDumpError inspects the shape of ONE call, so asking
    // for one tag per call walked around it. Here the loop cannot even be
    // aimed: `withPseudonymisation` is the only door, and every trip through
    // it builds a vault out of the ATTACKER'S OWN text and destroys it again.
    // A victim's round trip happens first, so there is a vault with real
    // values in it for the loop to miss.
    const captured: string[] = [];
    const ignore: string[] = [];
    await withPseudonymisation(SOURCE, { names: [...NAMES] }, (payload) => {
      harvest(payload, captured, ignore);
      return `Reply about ${payload.text}`;
    });

    const dumped: string[] = [];
    for (const cls of CLASS_WORDS) {
      for (let i = 1; i <= 8; i++) {
        const probe = `<${cls}:${i}>`;
        try {
          // The attacker's own text, because it is the only text they can get
          // a vault built from. `maxPayloadTier: 4` because an attacker would
          // obviously not leave the tier gate in their way.
          const { text } = await withPseudonymisation(
            "Nothing of mine is in this sentence.",
            { maxPayloadTier: 4 },
            () => probe,
          );
          if (text !== probe) dumped.push(text);
        } catch {
          continue;
        }
      }
    }

    const everythingTheAttackerHolds = [...dumped, ...captured].join(" | ");
    for (const secret of SECRETS) {
      expect(everythingTheAttackerHolds, `the loop reached ${secret.slice(0, 4)}…`).not.toContain(secret);
    }
    expect(dumped, "no plaintext may be reachable from the public surface alone").toEqual([]);
  });

  it("hands back a dead vault even to a caller who smuggled the reference out", async () => {
    // No public API gives a caller a Vault, so the test cheats via the mock
    // above to get the instances — precisely to prove that cheating does not
    // pay. Both exits are covered: the ordinary one and the one where `send`
    // throws, which is the path a `finally` exists for.
    discarded.length = 0;
    await withPseudonymisation(SOURCE, { names: [...NAMES] }, () => "done");
    await expect(
      withPseudonymisation(SOURCE, { names: [...NAMES] }, () => {
        throw new Error("the model call failed");
      }),
    ).rejects.toThrow("the model call failed");

    expect(discarded).toHaveLength(2);
    for (const vault of discarded as Vault[]) {
      expect(vault).toBeInstanceOf(Vault);
      // Everything that could read it now refuses, including the one-tag
      // probe that is the whole point of holding the reference.
      expect(() => detokenize("<person:1>", vault)).toThrow(PseudonymError);
      expect(() => vaultEntries(vault)).toThrow(PseudonymError);
      expect(() => vaultTags(vault)).toThrow(PseudonymError);
      expect(() => vaultClasses(vault)).toThrow(PseudonymError);
      expect(() => lookupOrdinal(vault, 1)).toThrow(PseudonymError);
      expect(() => vault.size).toThrow(PseudonymError);
      // …and printing it still works, because a debug path that throws is a
      // debug path that gets wrapped in an ignored `try`.
      expect(String(vault)).toBe("[Vault discarded]");
    }
  });

  it("still restores a tag the MODEL returned, which is its only job", async () => {
    // The counter-test: closing the dump must not break the legitimate path,
    // or the fix is a regression wearing a safety badge.
    const { text, report } = await withPseudonymisation(
      "Contact anna@acme.de about it.",
      { maxPayloadTier: 4 },
      ({ text: payload }) => `I emailed ${payload.match(/<email:\d+>/)?.[0] ?? "<email:1>"} yesterday.`,
    );
    expect(text).toContain("anna@acme.de");
    expect(report.restored.map((r) => r.tag)).toEqual(["<email:1>"]);
    // The report names tags and never values — it is the part that may be logged.
    expect(JSON.stringify(report)).not.toContain("anna@acme.de");
  });
});
