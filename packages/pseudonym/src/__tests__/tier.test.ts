/**
 * THE VERDICT HAS TO BE ABLE TO BE "NO". These are the tests that it is.
 */
import { describe, expect, it } from "vitest";
import { assessTier } from "../tier";
import { tokenize } from "../tokenize";
import { Vault } from "../vault";

describe("the vault is tier 4, always", () => {
  it("says so even for a payload with nothing personal in it", () => {
    const { text, vault } = tokenize("Der Prozess hat sechs Schritte.");
    const verdict = assessTier(text, vault);
    expect(verdict.vaultTier).toBe(4);
    expect(verdict.statement).toContain("vault is tier 4");
  });

  it("says so for an empty vault — it is what the object IS, not what it holds", () => {
    expect(assessTier("nichts", new Vault()).vaultTier).toBe(4);
  });
});

describe("the reduction that IS available", () => {
  it("takes a contract text from 4 to 3 once direct identifiers are proved gone", () => {
    const source = "Anna Berger, anna@acme.de, Vertrag vom 01.03.2024 über 52.000 EUR.";
    const { text, vault } = tokenize(source, { names: ["Anna Berger"] });
    const verdict = assessTier(text, vault, { names: ["Anna Berger"] });

    expect(verdict.payloadTier).toBe(3);
    expect(verdict.sourceTier).toBe(4);
    expect(verdict.reduced).toBe(true);
    expect(verdict.reasons.map((r) => r.code)).toContain("pseudonymised-natural-person");
    expect(verdict.statement).toContain("payload may be treated as tier 3");
    expect(verdict.statement).toContain("Recital 26");
  });

  it("reaches 2 only when there is no personal data in the payload at all", () => {
    const { text, vault } = tokenize("Der Genehmigungsschritt wartet auf eine Freigabe.");
    const verdict = assessTier(text, vault);
    expect(verdict.payloadTier).toBe(2);
    expect(verdict.reasons.map((r) => r.code)).toContain("no-personal-data-in-payload");
  });

  it("NEVER claims tier 1, whatever the input", () => {
    // "May be published" is a decision about consequences, not a property a
    // scanner reads off a string.
    for (const sample of ["", "hallo", "1 + 1 = 2", "Der Prozess hat sechs Schritte."]) {
      const { text, vault } = tokenize(sample);
      const verdict = assessTier(text, vault, { sourceTier: 2 });
      expect(verdict.payloadTier).toBeGreaterThanOrEqual(2);
      expect(verdict.reasons.map((r) => r.code)).toContain("tier-1-not-claimable");
    }
  });
});

describe("the reductions it REFUSES", () => {
  it("refuses to go below 3 when quasi-identifiers still identify — the brief's own sample", () => {
    const source = "Der Betriebsrat am Standort Bensheim hat Anna Bergers befristeten Vertrag am 01.03.2024 abgelehnt.";
    const { text, vault } = tokenize(source, { names: ["Anna Berger"] });
    const verdict = assessTier(text, vault, { names: ["Anna Berger"] });

    expect(verdict.payloadTier).toBe(3);
    expect(verdict.statement).toContain("residual re-identification risk");
    expect(verdict.statement).toContain("not reducible below 3");

    const quasi = verdict.reasons.find((r) => r.code === "quasi-identifier-signal");
    expect(quasi?.floor).toBe(3);
    // Evidence is compiled-in words from signals.ts, never a span of the text.
    expect(quasi?.evidence).toContain("betriebsrat");
    expect(quasi?.evidence).toContain("standort");
    expect(JSON.stringify(verdict)).not.toContain("Bensheim");
    expect(JSON.stringify(verdict)).not.toContain("Anna");
  });

  it("refuses ANY reduction when Art. 9 special-category prose survives", () => {
    // Pseudonymising health data about a person does not stop it being
    // health data about an identifiable person.
    const source = "Anna Berger ist seit dem 01.03.2024 arbeitsunfähig; ein Attest liegt vor.";
    const { text, vault } = tokenize(source, { names: ["Anna Berger"] });
    const verdict = assessTier(text, vault, { names: ["Anna Berger"] });

    expect(verdict.payloadTier).toBe(4);
    expect(verdict.reduced).toBe(false);
    expect(verdict.statement).toContain("special-category content present");
    expect(verdict.statement).toContain("not reducible below 4");
  });

  it("refuses any reduction when direct identifiers survived", () => {
    // A payload that never went through `tokenize` — assessed on its own.
    const verdict = assessTier("Schreib an anna@acme.de", new Vault());
    expect(verdict.payloadTier).toBe(4);
    expect(verdict.reduced).toBe(false);
    expect(verdict.reasons.find((r) => r.code === "residual-direct-identifier")?.evidence).toEqual(["email"]);
    expect(verdict.statement).toContain("direct identifiers survived tokenization");
  });

  it("does not treat a MISS as evidence of safety", () => {
    // No listed signal, still floored at 3, because absence of a word from a
    // finite list is not evidence of a large population.
    const { text, vault } = tokenize("Anna Berger hat unterschrieben.", { names: ["Anna Berger"] });
    const verdict = assessTier(text, vault, { names: ["Anna Berger"] });
    expect(verdict.payloadTier).toBe(3);
    expect(verdict.reasons.map((r) => r.code)).not.toContain("quasi-identifier-signal");
  });
});

describe("higher tier wins, including over the caller", () => {
  it("returns 4 for Art. 9 prose even when the caller declared the source tier 3", () => {
    const { text, vault } = tokenize("Anna Berger ist schwerbehindert.", { names: ["Anna Berger"] });
    const verdict = assessTier(text, vault, { sourceTier: 3, names: ["Anna Berger"] });
    expect(verdict.payloadTier).toBe(4);
    expect(verdict.reduced).toBe(false);
  });

  it("counts a person referenced only by a tag in the TEXT, not only by the vault", () => {
    // A payload trimmed after tokenization, or assessed against the wrong
    // vault, must not read as anonymous because the vault looks empty.
    const verdict = assessTier("Zuständig ist <person:1>.", new Vault());
    expect(verdict.payloadTier).toBe(3);
    expect(verdict.reasons.map((r) => r.code)).toContain("pseudonymised-natural-person");
  });

  it("counts a person present only in the VAULT, not only in the text", () => {
    const { vault } = tokenize("Anna Berger", { names: ["Anna Berger"] });
    const verdict = assessTier("Die Zusammenfassung nennt niemanden.", vault);
    expect(verdict.payloadTier).toBe(3);
  });
});

describe("a signal is matched on whole words, folded for umlauts", () => {
  it("matches Geschäftsführer, Geschaeftsfuehrer and geschaftsfuhrer alike", () => {
    for (const spelling of ["Geschäftsführer", "Geschaeftsfuehrer", "geschaftsfuhrer"]) {
      const verdict = assessTier(`<person:1> ist ${spelling}.`, new Vault());
      expect(verdict.reasons.map((r) => r.code), spelling).toContain("quasi-identifier-signal");
    }
  });

  it("does not fire on a word that merely contains a signal", () => {
    const verdict = assessTier("<person:1> hat das bewerkstelligt.", new Vault());
    expect(verdict.reasons.map((r) => r.code)).not.toContain("quasi-identifier-signal");
  });
});
