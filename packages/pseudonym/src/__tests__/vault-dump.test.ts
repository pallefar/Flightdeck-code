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
 * The leak: `vaultClasses()` names every class in the vault and `detokenize()`
 * restores a tag to its plaintext. Neither is dangerous alone. Together, a
 * caller mints the tags itself and feeds them back, and the vault reads out —
 * without ever touching the WeakMap that was added to make the store
 * unreachable. Sealing the store did not seal the surface.
 *
 * index.ts states directly above these exports that "the obvious way to use
 * this package is also the safe one". Until this file is green, that sentence
 * is false. */
import { describe, expect, it } from "vitest";
import { detokenize, tokenize, vaultClasses } from "../index";

const SECRETS = ["anna@acme.de", "DE02120300000000202051", "Anna Müller", "Bob Smith"] as const;

/** The attack, written as a caller would write it: public exports only. */
function dumpWithPublicApiOnly(text: string, names: readonly string[]): string[] {
  const { vault } = tokenize(text, { names: [...names] });
  const out: string[] = [];
  for (const cls of vaultClasses(vault)) {
    for (let i = 1; i <= vault.size; i++) {
      const probe = `<${cls}:${i}>`;
      let restored: string;
      try {
        restored = detokenize(probe, vault).text;
      } catch {
        continue;
      }
      if (restored !== probe) out.push(restored);
    }
  }
  return out;
}

describe("the vault cannot be read out through the public API", () => {
  it("does not hand back plaintext when a caller mints its own tags", () => {
    const dumped = dumpWithPublicApiOnly(
      "Anna Müller (anna@acme.de) und Bob Smith, IBAN DE02120300000000202051.",
      ["Anna Müller", "Bob Smith"],
    );
    // Every secret must be absent. Naming them individually so a failure says
    // WHICH class leaked rather than only that the count was wrong.
    for (const secret of SECRETS) {
      expect(dumped.join(" | "), `vault leaked ${secret.slice(0, 4)}… through vaultClasses + detokenize`)
        .not.toContain(secret);
    }
    expect(dumped, "no plaintext may be reachable from public exports alone").toEqual([]);
  });

  it("detokenize restores a tag the MODEL returned, which is its only job", () => {
    // The counter-test: closing the dump must not break the legitimate path,
    // or the fix is a regression wearing a safety badge.
    const { text, vault } = tokenize("Contact anna@acme.de about it.", {});
    const reply = `I emailed ${text.match(/<email:\d+>/)?.[0] ?? "<email:1>"} yesterday.`;
    const restored = detokenize(reply, vault);
    expect(restored.text).toContain("anna@acme.de");
  });
});
