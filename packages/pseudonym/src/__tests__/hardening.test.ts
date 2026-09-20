/**
 * THE HOLES A RED TEAM FOUND, EACH ONE AS A TEST THAT WOULD HAVE CAUGHT IT.
 *
 * Every case here is written against a PROPERTY, not against the adversary's
 * exact string: the attack sentence is one row of a table wherever a table
 * makes sense, and the assertions are about the verdict's SHAPE ("did not
 * reduce", "did not say no-personal-data") rather than about a magic number
 * that could be satisfied by special-casing.
 *
 * The one thing pinned literally is the KNOWN RESIDUAL at the bottom. A limit
 * that is written down as a passing test is a limit; a limit that is only in
 * a comment is a surprise waiting for the next reviewer.
 */
import { describe, expect, it } from "vitest";
import { PseudonymError, ResidualPiiError, VaultSealedError } from "../errors";
import { residualPiiFindings } from "../host-mirror";
import { textIndications } from "../indications";
import { TEXT_REPRESENTATIONS_DERIVED, residualPiiEveryRepresentation } from "../representations";
import {
  PERSON_REFERENT_SIGNALS,
  QUASI_IDENTIFIER_SIGNALS,
  SPECIAL_CATEGORY_SIGNALS,
  signalHits,
  signalStem,
} from "../signals";
import { assessTier } from "../tier";
import { tokenize } from "../tokenize";
import { Vault, internValue, isSealed } from "../vault";

// ═════════════════════════════════════════════════════════════════════════
// 1. THE VAULT'S DEFENCE 2 SAID SOMETHING THAT WAS NOT TRUE
// ═════════════════════════════════════════════════════════════════════════

describe("the vault store is not reachable by reflection", () => {
  const build = () => tokenize("jane.doe@acme.de, DE89 3704 0044 0532 0130 00, Jane Doe", { names: ["Jane Doe"] });

  it("has NO own properties at all — not names, not symbols", () => {
    // The defect: `Object.getOwnPropertySymbols` ignores enumerability, so a
    // non-enumerable symbol-keyed store was one line of ordinary reflection
    // away. `Reflect.ownKeys` is the union of both lists and it must be empty.
    const { vault } = build();
    expect(Object.getOwnPropertySymbols(vault)).toEqual([]);
    expect(Object.getOwnPropertyNames(vault)).toEqual([]);
    expect(Reflect.ownKeys(vault)).toEqual([]);
  });

  it("hands back no plaintext value through any own key", () => {
    const { vault } = build();
    const reachable = Reflect.ownKeys(vault).map((k) => JSON.stringify((vault as never)[k as never] ?? null));
    const blob = reachable.join("|");
    for (const secret of ["jane.doe@acme.de", "DE89", "Jane", "Doe"]) {
      expect(blob, `"${secret}" must not be reachable`).not.toContain(secret);
    }
  });

  it("cannot be re-opened once sealed — there is no `sealed` flag to reach", () => {
    const { vault } = build();
    expect(isSealed(vault)).toBe(true);
    // The old attack: read the store symbol, set `sealed = false`, add
    // entries behind an assessment's back. There is now no key to read.
    for (const key of Reflect.ownKeys(vault)) {
      const state = (vault as never)[key as never] as Record<string, unknown> | undefined;
      if (state !== undefined && typeof state === "object") state["sealed"] = false;
    }
    expect(isSealed(vault)).toBe(true);
    expect(() => internValue(vault, "person", "Someone Else")).toThrow(VaultSealedError);
  });

  it("refuses an object that is not a Vault this module built, rather than acting empty", () => {
    // An empty-looking vault would detokenize to nothing and assess as "no
    // personal data", which is the failure mode worth refusing.
    const lookalike = Object.create(Vault.prototype) as Vault;
    expect(() => lookalike.size).toThrow(PseudonymError);
    expect(() => assessTier("<person:1> ist hier.", lookalike)).toThrow(PseudonymError);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. ONE ADDRESS, EVERY SPELLING
// ═════════════════════════════════════════════════════════════════════════

/** The same address, written eight ways. Each row is an ENCODING, not a
 * string this code special-cases: the decoder that handles it handles every
 * value in that encoding. */
const ENCODINGS: readonly { how: string; text: string }[] = [
  { how: "as written", text: "Kontakt: anna.mueller@acme.de" },
  { how: "percent-encoded", text: "Kontakt: anna.mueller%40acme.de" },
  { how: "double percent-encoded", text: "Kontakt: anna.mueller%2540acme.de" },
  { how: "numeric HTML entity", text: "Kontakt: anna.mueller&#64;acme.de" },
  { how: "hex HTML entity", text: "Kontakt: anna.mueller&#x40;acme.de" },
  { how: "named HTML entity", text: "Kontakt: anna.mueller&commat;acme.de" },
  { how: "unicode escape", text: "Kontakt: anna.mueller\\u0040acme.de" },
  { how: "bracketed obfuscation", text: "Kontakt: anna.mueller (at) acme (dot) de" },
  { how: "spelled-out obfuscation", text: "Kontakt: anna.mueller at acme dot de" },
  { how: "base64", text: "Kontakt: YW5uYS5tdWVsbGVyQGFjbWUuZGU=" },
];

describe("the residual proof covers every representation, not one", () => {
  for (const { how, text } of ENCODINGS) {
    it(`never lets an address written ${how} reach the payload unnoticed`, () => {
      // Exactly two acceptable outcomes, and the old behaviour for every row
      // but the first was NEITHER of them: the text came back UNCHANGED with
      // no refusal, and `assessTier` then certified it clean.
      //   - the address is REPLACED by a tag (what happens as written), or
      //   - tokenize REFUSES, naming the class (what happens for a spelling
      //     it cannot safely rewrite).
      let out: string | null = null;
      let refused: unknown = null;
      try {
        out = tokenize(text).text;
      } catch (error) {
        refused = error;
      }

      if (out !== null) {
        expect(out, how).toContain("<email:");
        expect(out, how).not.toContain("acme.de");
        // And the payload it produced is clean in every representation too.
        expect(residualPiiEveryRepresentation(out).findings, how).toEqual([]);
        return;
      }
      expect(refused, `"${how}" neither tokenized nor refused`).toBeInstanceOf(ResidualPiiError);
      expect((refused as ResidualPiiError).findings, how).toContain("email");
      // CLASS NAMES ONLY — a refusal must not reproduce what it caught.
      expect((refused as Error).message, how).not.toContain("acme");
    });

    it(`does not reduce a tier for an address written ${how}`, () => {
      const verdict = assessTier(text, new Vault());
      expect(verdict.payloadTier, how).toBe(4);
      expect(verdict.reduced, how).toBe(false);
      expect(verdict.reasons.map((r) => r.code)).not.toContain("no-personal-data-in-payload");
      expect(verdict.statement).toContain("direct identifiers survived tokenization");
    });
  }

  it("refuses rather than silently passing every RE-ENCODED spelling", () => {
    // The as-written row is the one tokenize can rewrite; every other row is
    // a spelling it must refuse rather than ship.
    for (const { how, text } of ENCODINGS.slice(1)) {
      expect(() => tokenize(text), how).toThrow(ResidualPiiError);
    }
  });

  it("names the ENCODING as well as the class, in compiled-in words only", () => {
    const verdict = assessTier("Kontakt: anna%40acme.de", new Vault());
    const encoded = verdict.reasons.find((r) => r.code === "residual-direct-identifier-encoded");
    expect(encoded).toBeDefined();
    expect(encoded?.evidence.some((e) => e.startsWith("email:"))).toBe(true);
    // Every half of every evidence entry is a constant from this package.
    for (const entry of encoded?.evidence ?? []) {
      const [cls, representation] = entry.split(":");
      expect(["email", "iban", "digits", "amount", "date", "declaredName"]).toContain(cls);
      expect(TEXT_REPRESENTATIONS_DERIVED).toContain(representation);
    }
    expect(JSON.stringify(verdict)).not.toContain("anna");
  });

  it("is ADDITIVE — it can only ever add to what the host's own scanner found", () => {
    // The property that makes routing through it safe: no caller can be made
    // worse off, and no refusal can be turned into an allowance.
    const samples = [
      ...ENCODINGS.map((e) => e.text),
      "nothing personal here at all",
      "Rechnung 4711 über 52.000 EUR vom 01.03.2024",
      "DE89 3704 0044 0532 0130 00",
      "",
    ];
    for (const sample of samples) {
      const host = residualPiiFindings(sample, { names: ["Anna Müller"] });
      const every = residualPiiEveryRepresentation(sample, { names: ["Anna Müller"] });
      expect(every.asWritten, sample).toEqual(host);
      for (const finding of host) expect(every.findings, sample).toContain(finding);
    }
  });

  it("does not manufacture findings out of ordinary long German words", () => {
    // base64 decoding is the noisiest of the decoders; `unterschriebenhaben`
    // is base64-shaped and must not become an email address.
    const clean = "Die Betriebsvereinbarungdokumentation wurde unterschriebenhaben koennen.";
    expect(residualPiiEveryRepresentation(clean).findings).toEqual([]);
    expect(() => tokenize(clean)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. THE CORE BUG: EVIDENCE COMPUTED AND THEN THROWN AWAY
// ═════════════════════════════════════════════════════════════════════════

describe("personhood is read from the TEXT, not only from the vault", () => {
  it("floors on quasi-identifiers even when the vault is empty", () => {
    // `if (quasi.length > 0 && aboutAPerson)` — the second half was the bug.
    // `aboutAPerson` came only from the vault, so an empty vault discarded
    // hits the scanner had already found.
    const text = "Anna Müller ist Werksleiter am Standort Bremen und die einzige Prokuristin.";
    expect(signalHits(text, QUASI_IDENTIFIER_SIGNALS).length).toBeGreaterThan(0);

    const verdict = assessTier(text, new Vault());
    expect(verdict.reasons.map((r) => r.code)).toContain("quasi-identifier-signal");
    expect(verdict.reasons.map((r) => r.code)).not.toContain("no-personal-data-in-payload");
    expect(verdict.reduced).toBe(false);
    expect(verdict.statement).not.toContain("may be treated as tier 2");
  });

  it("does not let an omitted names[] become a clean verdict", () => {
    // The adversary's summary: the tool was safest when the caller was most
    // careful and most dangerous when they forgot. Each row is a text whose
    // person the tokenizer never touched.
    const undeclared: readonly string[] = [
      "Anna Müller ist Werksleiter am Standort Bremen und die einzige Prokuristin.",
      "Anna Müller hat sich krankgemeldet.",
      "Anna Müller hat den Vertrag unterschrieben.",
      "Frau Musterfrau leitet das Projekt.",
      "Reisepass C01X00T47 wurde vorgelegt.",
      "Personalnummer A4711X22 ist zugeordnet.",
    ];
    for (const source of undeclared) {
      const { text, vault } = tokenize(source);
      const verdict = assessTier(text, vault);
      expect(verdict.reasons.map((r) => r.code), source).not.toContain("no-personal-data-in-payload");
      expect(verdict.reduced, source).toBe(false);
      expect(verdict.statement, source).not.toContain("may be treated as tier 2");
    }
  });

  it("says WHY it refused, in words a log line may carry", () => {
    const verdict = assessTier("Reisepass C01X00T47 wurde vorgelegt.", new Vault());
    const reason = verdict.reasons.find((r) => r.code === "unverified-name-shaped-content");
    expect(reason?.evidence).toContain("identifier-shaped-token");
    expect(verdict.statement).toContain("NO names were declared");
    expect(JSON.stringify(verdict)).not.toContain("C01X00T47");
  });

  it("is gentler when names WERE declared, because then the class was checked", () => {
    // Declaring is the caller's one obligation, and meeting it must buy
    // something. With names declared the residue is risk (floor 3); with none
    // it is an unchecked class (no reduction at all).
    const source = "Anna Müller und Bernd Schuster haben Projekt Nordstern beendet.";
    const declared = tokenize(source, { names: ["Anna Müller", "Bernd Schuster"] });
    const withNames = assessTier(declared.text, declared.vault, { names: ["Anna Müller", "Bernd Schuster"] });
    const { text, vault } = tokenize(source);
    const without = assessTier(text, vault);

    expect(withNames.payloadTier).toBeLessThan(without.payloadTier);
    expect(withNames.reduced).toBe(true);
    expect(without.reduced).toBe(false);
  });

  it("still reaches 2 for text that indicates nobody — the reduction is real", () => {
    for (const source of [
      "Der Genehmigungsschritt wartet auf eine Freigabe.",
      "Der Prozess hat sechs Schritte.",
      "Das Formular besteht aus drei Abschnitten.",
    ]) {
      const { text, vault } = tokenize(source);
      const verdict = assessTier(text, vault);
      expect(verdict.payloadTier, source).toBe(2);
      expect(verdict.reduced, source).toBe(true);
    }
  });
});

describe("the verdict carries what was checked and what could not be", () => {
  it("never reports an empty `unchecked`, at any tier", () => {
    for (const source of ["Der Prozess hat sechs Schritte.", "Anna Berger ist krank.", "anna@acme.de"]) {
      const verdict = assessTier(source, new Vault());
      expect(verdict.coverage.unchecked.length, source).toBeGreaterThan(0);
      expect(verdict.coverage.checked, source).toContain("email");
      expect(verdict.coverage.representations, source).toContain("as-written");
      expect(verdict.statement, source).toContain("a miss is not a clean bill of health");
    }
  });

  it("moves the declared-name class into `unchecked` when the caller supplied none", () => {
    const withNone = assessTier("Der Prozess hat sechs Schritte.", new Vault());
    const withSome = assessTier("Der Prozess hat sechs Schritte.", new Vault(), { names: ["Anna Berger"] });
    expect(withNone.coverage.unchecked).toContain("declared-name-none-supplied");
    expect(withNone.coverage.checked).not.toContain("declaredName");
    expect(withSome.coverage.checked).toContain("declaredName");
    expect(withSome.coverage.unchecked).not.toContain("declared-name-none-supplied");
  });

  it("puts no span of the scanned text into the verdict", () => {
    const source = "Anna Müller, anna@acme.de, Standort Bensheim, Reisepass C01X00T47, krankgemeldet.";
    const verdict = assessTier(source, new Vault());
    const blob = JSON.stringify(verdict);
    for (const span of ["Anna", "Müller", "acme", "Bensheim", "C01X00T47"]) {
      expect(blob, span).not.toContain(span);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4. GERMAN INFLECTION AGAINST THE SIGNAL LISTS
// ═════════════════════════════════════════════════════════════════════════

describe("a signal survives inflection", () => {
  const INFLECTED: readonly { base: string; inflected: readonly string[]; list: readonly string[] }[] = [
    { base: "krankmeldung", inflected: ["Krankmeldung", "Krankmeldungen"], list: SPECIAL_CATEGORY_SIGNALS },
    { base: "betriebsrat", inflected: ["Betriebsrat", "Betriebsrätin", "Betriebsrats"], list: QUASI_IDENTIFIER_SIGNALS },
    {
      base: "schwerbehindertenvertretung",
      inflected: ["Schwerbehindertenvertretung"],
      list: QUASI_IDENTIFIER_SIGNALS,
    },
    { base: "gewerkschaft", inflected: ["Gewerkschaft", "Gewerkschaften"], list: SPECIAL_CATEGORY_SIGNALS },
    { base: "werksleiter", inflected: ["Werksleiter", "Werksleiterin"], list: QUASI_IDENTIFIER_SIGNALS },
    { base: "prokurist", inflected: ["Prokurist", "Prokuristin"], list: QUASI_IDENTIFIER_SIGNALS },
    { base: "behinderung", inflected: ["Behinderung", "Behinderungen"], list: SPECIAL_CATEGORY_SIGNALS },
    { base: "abteilung", inflected: ["Abteilung", "Abteilungen"], list: QUASI_IDENTIFIER_SIGNALS },
  ];

  for (const { base, inflected, list } of INFLECTED) {
    for (const form of inflected) {
      it(`matches "${form}" against the entry "${base}"`, () => {
        expect(signalHits(`Die ${form} liegt vor.`, list)).toContain(base);
      });
    }
  }

  it("reaches the -erin derivation, which is a different stem from -ung", () => {
    // `Schwerbehindertenvertreterin` cannot be produced from
    // `…vertretung` by trimming a tail, so the person form is its own entry.
    expect(signalHits("Die Schwerbehindertenvertreterin wurde informiert.", QUASI_IDENTIFIER_SIGNALS)).toContain(
      "schwerbehindertenvertreter",
    );
  });

  it("does NOT fire on a word that merely starts with or contains a stem", () => {
    // The trailing `\b` is what keeps a bounded ending from becoming a prefix
    // match. Without it every one of these would hit.
    const noise = "Werkzeug und Bewerkstelligung, er verdient Standard-Lohn, die Verdienstbescheinigung.";
    expect(signalHits(noise, QUASI_IDENTIFIER_SIGNALS)).toEqual([]);
    expect(signalHits(noise, SPECIAL_CATEGORY_SIGNALS)).toEqual([]);
  });

  it("folds the ENTRY as well as the text, so an unfolded entry is not dead", () => {
    // `sexuelle orientierung` folds to `sexulle orientier`; before the entry
    // was folded too, it could never match its own folded text.
    expect(signalHits("Die sexuelle Orientierung ist irrelevant.", SPECIAL_CATEGORY_SIGNALS)).toContain(
      "sexuelle orientierung",
    );
  });

  it("keeps short entries as whole words, so they cannot become noise", () => {
    expect(signalStem("werk")).toBe("werk");
    expect(signalStem("verdi")).toBe("verdi");
    expect(signalHits("Er verdient gut mit Werkzeug.", QUASI_IDENTIFIER_SIGNALS)).toEqual([]);
    expect(signalHits("Er verdient gut.", SPECIAL_CATEGORY_SIGNALS)).toEqual([]);
  });

  it("an Art. 9 floor is not lost to a plural", () => {
    const verdict = assessTier("<person:1>: die Krankmeldungen liegen vor.", new Vault());
    expect(verdict.payloadTier).toBe(4);
    expect(verdict.reasons.map((r) => r.code)).toContain("special-category-signal");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5. A DECLARED NAME IN A TRANSLITERATED SURFACE FORM
// ═════════════════════════════════════════════════════════════════════════

describe("a declared name is matched in every transliteration of itself", () => {
  const SOURCE = "Anna Mueller und Anna Müller und Anna Muller sind dieselbe Person.";

  for (const declared of ["Anna Müller", "Anna Mueller"]) {
    it(`unifies every spelling onto one tag when the caller declares "${declared}"`, () => {
      const { text, findings } = tokenize(SOURCE, { names: [declared] });
      // The old output kept a readable surname: "<person:1> Mueller und …".
      for (const fragment of ["Mueller", "Müller", "Muller", "Anna"]) {
        expect(text, fragment).not.toContain(fragment);
      }
      expect(findings.filter((f) => f.cls === "person")).toHaveLength(1);
      expect(text).toBe("<person:1> und <person:1> und <person:1> sind dieselbe Person.");
    });
  }

  it("catches a transliterated surname in the residual scan even when nothing replaced it", () => {
    // The proof has to see the fold too, or a pass-through would ship.
    const scan = residualPiiEveryRepresentation("Rückfragen an Mueller.", { names: ["Müller"] });
    expect(scan.findings).toContain("declaredName");
    expect(scan.encoded.some((e) => e.endsWith(":transliteration-folded"))).toBe(true);
  });

  it("leaves a name with no transliteration exactly as it was", () => {
    // Additive: the variants can only widen what is matched.
    expect(tokenize("Jane Doe kam.", { names: ["Jane Doe"] }).text).toBe("<person:1> kam.");
    expect(tokenize("Son hat unterschrieben.", { names: ["Son"] }).text).toBe("<person:1> hat unterschrieben.");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 6. THE SHAPE HEURISTICS, AND THE DIRECTION THEY ARE WRONG IN
// ═════════════════════════════════════════════════════════════════════════

describe("the text-shape indications", () => {
  it("reads a capitalised bigram as name-shaped", () => {
    expect(textIndications("Anna Müller hat unterschrieben.")).toContain("name-shaped-span");
    expect(textIndications("Frau Musterfrau leitet das Projekt.")).toContain("titled-name-span");
  });

  it("does not read ordinary German capitalisation as a name", () => {
    // Every German noun is capitalised, so without a function-word stoplist
    // this signal would fire on every sentence and be worth nothing.
    for (const prose of [
      "Der Genehmigungsschritt wartet auf eine Freigabe.",
      "Das Formular besteht aus drei Abschnitten.",
      "Die Zusammenfassung nennt niemanden.",
    ]) {
      expect(textIndications(prose), prose).toEqual([]);
    }
  });

  it("does not read a role or site word as a name, because those have their own floor", () => {
    const text = "Der Betriebsrat am Standort Bensheim hat entschieden.";
    const signals = signalHits(text, QUASI_IDENTIFIER_SIGNALS);
    expect(signals).toContain("standort");
    expect(textIndications(text, signals)).not.toContain("name-shaped-span");
  });

  it("returns compiled-in constants only", () => {
    for (const indication of textIndications("Anna Müller, Reisepass C01X00T47, Mitarbeiterin.")) {
      expect(indication).not.toContain("Anna");
      expect(indication).not.toContain("C01X00T47");
    }
    expect(signalHits("Die Mitarbeiterin hat Urlaub.", PERSON_REFERENT_SIGNALS)).toContain("mitarbeiter");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 7. THE LIMITS THAT ARE STILL LIMITS
// ═════════════════════════════════════════════════════════════════════════

describe("what is still NOT closed, written down so it is not a surprise", () => {
  it("a single-token undeclared first name in otherwise impersonal prose still reaches 2", () => {
    // There is no shape that separates "Anna" from "Antrag" in German — both
    // are one capitalised token, and a first-name lexicon would be a list of
    // the names someone thought of rather than a decision procedure. The
    // cover for this case is, and remains, `names[]`.
    //
    // What the verdict DOES do is say so: `coverage.unchecked` carries
    // `undeclared-personal-name` and `declared-name-none-supplied`, and the
    // statement refuses to call the result clean.
    const verdict = assessTier("Anna hat unterschrieben.", new Vault());
    expect(verdict.payloadTier).toBe(2);
    expect(verdict.coverage.unchecked).toContain("undeclared-personal-name");
    expect(verdict.coverage.unchecked).toContain("declared-name-none-supplied");
    expect(verdict.statement).toContain("a miss is not a clean bill of health");

    // Declaring it closes it, and that is the documented contract.
    const declared = tokenize("Anna hat unterschrieben.", { names: ["Anna"] });
    expect(declared.text).toBe("<person:1> hat unterschrieben.");
    expect(assessTier(declared.text, declared.vault, { names: ["Anna"] }).payloadTier).toBe(3);
  });

  it("an encoding nobody derived is not covered, and the verdict names that gap", () => {
    const verdict = assessTier("Der Prozess hat sechs Schritte.", new Vault());
    expect(verdict.coverage.unchecked).toContain("an-encoding-outside-TEXT_REPRESENTATIONS_DERIVED");
    expect(TEXT_REPRESENTATIONS_DERIVED.length).toBeGreaterThan(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 8. THE GUARD AGAINST THE FIX ITSELF
// ═════════════════════════════════════════════════════════════════════════

describe("it does not become a refusal machine", () => {
  // Widening a scanner is exactly the change that invites the opposite
  // failure: a gate that fires on everything gets rubber-stamped or switched
  // off, which is worse than the hole it replaced. And DECODING is exactly
  // the change that invites a decode bomb, so bounded time is asserted here
  // rather than hoped for.

  it("tokenizes an ordinary German business document without refusing", () => {
    const paragraph =
      "Anna Berger (anna.berger@acme.de) hat am 01.03.2024 den Vertrag über 52.000 EUR " +
      "gezeichnet. Der Betriebsrat am Standort Bensheim wurde informiert. Die " +
      "Betriebsvereinbarungdokumentation liegt der Abteilung vor. Rückfragen an 0621-1234567. ";
    const document = paragraph.repeat(200);

    const started = Date.now();
    const { text, vault } = tokenize(document, { names: ["Anna Berger"] });
    const verdict = assessTier(text, vault, { names: ["Anna Berger"] });
    const elapsed = Date.now() - started;

    expect(verdict.payloadTier).toBe(3);
    expect(verdict.reduced).toBe(true);
    expect(elapsed, `took ${elapsed}ms`).toBeLessThan(5_000);
  });

  it("does not refuse a document made of long German compounds", () => {
    // Every one of these is base64-SHAPED. Costing one decode attempt each is
    // fine; refusing the document because there are a lot of them is not.
    expect(() => tokenize("Betriebsvereinbarungdokumentation ".repeat(500))).not.toThrow();
  });

  it("refuses a decode bomb in bounded time rather than working on it forever", () => {
    const bomb = Array.from({ length: 40_000 }, (_, i) => `QWJjZGVmZ2hpamtsbW5vcHFy${i}`).join(" ");
    const started = Date.now();
    expect(() => tokenize(bomb)).toThrow(PseudonymError);
    const elapsed = Date.now() - started;
    expect(elapsed, `took ${elapsed}ms`).toBeLessThan(10_000);
  });

  it("keeps the impersonal-prose reduction that makes the package worth using", () => {
    // If everything came back 4, `assessTier` would be a constant and the
    // package's whole claim ("the reduction is EARNED per payload") would be
    // empty. These must still earn one.
    for (const source of [
      "Der Genehmigungsschritt wartet auf eine Freigabe.",
      "Die Rechnung wurde in drei Positionen aufgeteilt.",
      "Das Formular besteht aus drei Abschnitten und einer Zusammenfassung.",
    ]) {
      const { text, vault } = tokenize(source);
      expect(assessTier(text, vault).payloadTier, source).toBe(2);
    }
  });
});
