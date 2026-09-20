/**
 * THE FOUR REGRESSIONS A RE-ATTACK FOUND IN THE PREVIOUS ROUND OF FIXES.
 *
 * Every one of them came from a change that had no counter-test, so every
 * section here is a PAIR: the bug, and the innocent case the fix for it must
 * not take down with it. A fix that only has the first half is how each of
 * these got written in the first place.
 */
import { describe, expect, it } from "vitest";
import { ResidualPiiError, VaultDumpError } from "../errors";
import * as surface from "../index";
import { TEXT_REPRESENTATIONS_DERIVED, residualPiiEveryRepresentation } from "../representations";
import { QUASI_IDENTIFIER_SIGNALS, SPECIAL_CATEGORY_SIGNALS, signalHits, signalStem } from "../signals";
import { assessTier } from "../tier";
import { tokenize } from "../tokenize";
import { detokenize } from "../detokenize";
import { Vault, vaultClasses, vaultTags } from "../vault";

// ═════════════════════════════════════════════════════════════════════════
// 1. THE PUBLIC SURFACE WAS A VAULT READER
// ═════════════════════════════════════════════════════════════════════════

describe("the package surface cannot be assembled into a vault dump", () => {
  const build = () =>
    tokenize("Anna Berger schrieb an carl.schmidt@acme.de am 01.03.2024. Carl Schmidt antwortete.", {
      names: ["Anna Berger", "Carl Schmidt"],
    });

  it("does not export the vault's tag list at all", () => {
    // `detokenize(vaultTags(vault).join(" "), vault).text` was two lines of
    // package surface that produced every plaintext value. The export is the
    // half of the fix that removes the OBVIOUS spelling of it.
    expect(Object.keys(surface)).not.toContain("vaultTags");
    expect("vaultTags" in surface).toBe(false);

    // ⚠ `vaultClasses` USED TO BE ASSERTED PRESENT HERE, on the grounds that a
    // class name is a compiled-in constant and buys nothing. It bought the
    // loop bound: `for (const cls of vaultClasses(vault)) for (i = 1…)` is the
    // dump, one tag per call, and no shape check on `detokenize` can see it.
    // It is off the surface with `Vault`, `tokenize` and `detokenize`, and the
    // assertion is inverted rather than deleted — see `vault-dump.test.ts`,
    // which checks the whole surface BY IDENTITY so a rename cannot restore
    // the capability quietly.
    for (const gone of ["vaultClasses", "Vault", "tokenize", "detokenize", "assessTier"]) {
      expect(Object.keys(surface), gone).not.toContain(gone);
    }
    // Still true of the module-internal function, which is what the package's
    // own code and tests use.
    expect(vaultClasses(build().vault)).toEqual(["email", "number", "person"]);
  });

  it("refuses to restore a tag list, which is what a dump looks like", () => {
    // The module-internal `vaultTags` still exists — `detokenize` must refuse
    // even when the attacker has the list by some other route, because a tag
    // is a word from a seven-word vocabulary plus a counter and can be
    // written out by hand.
    const { vault } = build();
    const keyring = vaultTags(vault).join(" ");
    expect(() => detokenize(keyring, vault)).toThrow(VaultDumpError);
    expect(() => detokenize(vaultTags(vault).join(", "), vault)).toThrow(VaultDumpError);
    expect(() => detokenize(vaultTags(vault).join("\n"), vault)).toThrow(VaultDumpError);
  });

  it("puts no value and no tag into the refusal", () => {
    const { vault } = build();
    let caught: unknown = null;
    try {
      detokenize(vaultTags(vault).join(" "), vault);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VaultDumpError);
    const message = (caught as Error).message;
    for (const secret of ["Anna", "Berger", "carl.schmidt", "acme", "01.03.2024", "<person:", "<email:"]) {
      expect(message, secret).not.toContain(secret);
    }
    expect((caught as VaultDumpError).count).toBe(4);
  });

  // ── COUNTER-TESTS: the innocent cases the guard must not take down ──────

  it("still restores an ordinary model reply, which is the entire point", () => {
    const { vault } = build();
    // `<number:2>`, not `<date:2>`: the host's array puts `digits` before
    // `date`, so a German date is claimed by the long-digit-run class first.
    const answer = "<person:3> hat <person:4> am <number:2> unter <email:1> erreicht.";
    const { text, report } = detokenize(answer, vault);
    expect(text).toBe("Anna Berger hat Carl Schmidt am 01.03.2024 unter carl.schmidt@acme.de erreicht.");
    expect(report.rejected).toEqual([]);
  });

  it("still restores a single tag on its own — a terse answer is an answer", () => {
    const { vault } = build();
    expect(detokenize("<person:3>", vault).text).toBe("Anna Berger");
    // Repeats of ONE entry are one distinct entry, not a list.
    expect(detokenize("<person:3> <person:3>", vault).text).toBe("Anna Berger Anna Berger");
  });

  it("still round-trips a payload that is almost entirely tags", () => {
    // `Jane Doe <jane.doe@acme.de>` tokenizes to `<person:2> <<email:1>>`.
    // The carrier is two angle brackets and a space — NOT a key ring joined
    // with a separator — and refusing it would break the package's own
    // byte-exact restoration guarantee.
    const source = "Jane Doe <jane.doe@acme.de>";
    const { text, vault } = tokenize(source, { names: ["Jane Doe"] });
    expect(text).toBe("<person:2> <<email:1>>");
    expect(detokenize(text, vault).text).toBe(source);
  });

  it("restores a bare list for a caller who says that is what they meant", () => {
    const { vault } = build();
    const out = detokenize(vaultTags(vault).join(" "), vault, { onTagOnlyOutput: "restore" });
    expect(out.text).toContain("Anna Berger");
    expect(out.report.dropped).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. THE STEM WINDOW REACHED WORDS NOBODY LISTED
// ═════════════════════════════════════════════════════════════════════════

/** Each row is a sentence in which the listed word does NOT occur — only a
 * word the trimmed stem plus an open five-letter window could reach. */
const OVER_MATCHES: readonly { text: string; list: readonly string[]; was: string }[] = [
  // The two that hit the Art. 9 floor, which `assessTier` will not reduce.
  { text: "Sie schwangen die Fahne auf dem Werksgelaende.", list: SPECIAL_CATEGORY_SIGNALS, was: "schwanger" },
  { text: "Das behindert den Ablauf der Freigabe erheblich.", list: SPECIAL_CATEGORY_SIGNALS, was: "behinderung" },
  { text: "Der Psychologe haelt morgen einen Vortrag.", list: SPECIAL_CATEGORY_SIGNALS, was: "psychisch" },
  // Lower-severity siblings on the quasi-identifier list.
  { text: "Im Abteil sassen vier Reisende.", list: QUASI_IDENTIFIER_SIGNALS, was: "abteilung" },
  { text: "We plant trees every spring.", list: QUASI_IDENTIFIER_SIGNALS, was: "plant" },
  { text: "The head office moved to a new building.", list: QUASI_IDENTIFIER_SIGNALS, was: "head of" },
];

describe("a signal matches a form of its entry, not a word that starts like one", () => {
  for (const { text, list, was } of OVER_MATCHES) {
    it(`does not read "${text}" as the entry "${was}"`, () => {
      expect(signalHits(text, list)).not.toContain(was);
    });
  }

  it("does not pin an ordinary sentence at tier 4 through the Art. 9 floor", () => {
    // This is what made the two health-list over-matches expensive: the Art. 9
    // floor is the one floor `assessTier` will not reduce, so a false positive
    // there fixes a whole document at 4 forever.
    for (const source of ["Sie schwangen die Fahne.", "Das behindert den Ablauf."]) {
      const { text, vault } = tokenize(source);
      const verdict = assessTier(text, vault);
      expect(verdict.reasons.map((r) => r.code), source).not.toContain("special-category-signal");
      expect(verdict.payloadTier, source).toBe(2);
    }
  });

  it("reduces the entry to nothing at all — the stem IS the entry now", () => {
    for (const entry of ["schwanger", "behinderung", "abteilung", "psychisch", "head of"]) {
      expect(signalStem(entry)).toBe(entry);
    }
    // And the short-entry contract from the previous round still holds.
    expect(signalStem("werk")).toBe("werk");
    expect(signalStem("verdi")).toBe("verdi");
  });

  // ── COUNTER-TESTS: German inflection must still reach the floor ─────────

  const STILL_INFLECTED: readonly { form: string; list: readonly string[]; entry: string }[] = [
    { form: "Krankmeldungen", list: SPECIAL_CATEGORY_SIGNALS, entry: "krankmeldung" },
    { form: "Betriebsrätin", list: QUASI_IDENTIFIER_SIGNALS, entry: "betriebsrat" },
    { form: "Betriebsrats", list: QUASI_IDENTIFIER_SIGNALS, entry: "betriebsrat" },
    {
      form: "Schwerbehindertenvertreterin",
      list: QUASI_IDENTIFIER_SIGNALS,
      entry: "schwerbehindertenvertreter",
    },
    { form: "Werksleiterin", list: QUASI_IDENTIFIER_SIGNALS, entry: "werksleiter" },
    { form: "Abteilungen", list: QUASI_IDENTIFIER_SIGNALS, entry: "abteilung" },
    { form: "Behinderungen", list: SPECIAL_CATEGORY_SIGNALS, entry: "behinderung" },
    { form: "schwangere", list: SPECIAL_CATEGORY_SIGNALS, entry: "schwanger" },
    { form: "psychische", list: SPECIAL_CATEGORY_SIGNALS, entry: "psychisch" },
    { form: "Gewerkschaften", list: SPECIAL_CATEGORY_SIGNALS, entry: "gewerkschaft" },
  ];

  for (const { form, list, entry } of STILL_INFLECTED) {
    it(`still matches the inflected form "${form}" against "${entry}"`, () => {
      expect(signalHits(`Die ${form} liegt vor.`, list)).toContain(entry);
    });
  }

  it("still reaches the Art. 9 floor through an inflected sick note", () => {
    const verdict = assessTier("<person:1>: die Krankmeldungen der schwangeren Kollegin liegen vor.", new Vault());
    expect(verdict.payloadTier).toBe(4);
    expect(verdict.reasons.map((r) => r.code)).toContain("special-category-signal");
  });

  it("still reads the noun `plant` when a determiner puts it in noun position", () => {
    // Narrowing the entry to noun position must not delete it: a site still
    // narrows the population it draws an employee from.
    expect(signalHits("Two hundred people work at the plant.", QUASI_IDENTIFIER_SIGNALS)).toContain("plant");
    expect(signalHits("The plants in Bremen were consulted.", QUASI_IDENTIFIER_SIGNALS)).toContain("plant");
    expect(signalHits("The head of HR signed it.", QUASI_IDENTIFIER_SIGNALS)).toContain("head of");
  });

  it("still keeps short entries from becoming noise", () => {
    expect(signalHits("Er verdient gut mit Werkzeug.", QUASI_IDENTIFIER_SIGNALS)).toEqual([]);
    expect(signalHits("Bewerkstelligung der Verdienstbescheinigung.", SPECIAL_CATEGORY_SIGNALS)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. A DERIVED READING TURNED PROSE INTO A THROWN ERROR
// ═════════════════════════════════════════════════════════════════════════

describe("a bare `at` needs corroboration before it is read as `@`", () => {
  const PROSE: readonly string[] = [
    "I looked at github.com and found nothing.",
    "We met at acme.de yesterday.",
    "The redirect lands at example.com after login.",
    "Die Doku steht at docs.acme.de bereit.",
  ];

  for (const source of PROSE) {
    it(`does not take a caller down over "${source}"`, () => {
      // The regression: the reading "I@github.com" tripped the host's `email`
      // pattern and step 4b-ii escalated it to a thrown ResidualPiiError. A
      // false positive that WARNS costs a tier; one that THROWS costs the
      // request.
      expect(() => tokenize(source)).not.toThrow();
      expect(tokenize(source).text).toBe(source);
      expect(residualPiiEveryRepresentation(source).findings, source).toEqual([]);
    });
  }

  it("still reduces a tier for prose that merely contains a domain", () => {
    const { text, vault } = tokenize("I looked at github.com and found nothing.");
    const verdict = assessTier(text, vault);
    expect(verdict.payloadTier).toBe(2);
    expect(verdict.reasons.map((r) => r.code)).toContain("no-personal-data-in-payload");
  });

  // ── COUNTER-TESTS: every obfuscation that used to be caught still is ────

  const OBFUSCATED: readonly { how: string; text: string }[] = [
    { how: "bracketed", text: "Kontakt: anna.mueller (at) acme (dot) de" },
    { how: "spelled-out dot", text: "Kontakt: anna.mueller at acme dot de" },
    { how: "address-shaped local part", text: "Kontakt: anna.mueller at acme.de" },
    { how: "digit in the local part", text: "anna2024 at acme.de" },
    { how: "German mail cue", text: "Erreichbar unter sales at acme.de" },
    { how: "English mail cue", text: "Please write to sales at acme.de" },
    { how: "E-Mail label", text: "E-Mail: sales at acme.de" },
  ];

  for (const { how, text } of OBFUSCATED) {
    it(`still refuses an address obfuscated ${how}`, () => {
      let caught: unknown = null;
      try {
        tokenize(text);
      } catch (error) {
        caught = error;
      }
      expect(caught, how).toBeInstanceOf(ResidualPiiError);
      expect((caught as ResidualPiiError).findings, how).toContain("email");
      expect((caught as Error).message, how).not.toContain("acme");
    });

    it(`still refuses to reduce a tier for an address obfuscated ${how}`, () => {
      const verdict = assessTier(text, new Vault());
      expect(verdict.payloadTier, how).toBe(4);
      expect(verdict.reduced, how).toBe(false);
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// 4. INVISIBLE CHARACTERS AND WHITESPACE INSIDE AN ADDRESS
// ═════════════════════════════════════════════════════════════════════════

/** One address, broken by one character that no reading used to remove. */
const BROKEN_ADDRESSES: readonly { how: string; text: string }[] = [
  { how: "zero-width space", text: "Kontakt: anna​@acme.de" },
  { how: "zero-width non-joiner", text: "Kontakt: anna‌@acme.de" },
  { how: "soft hyphen", text: "Kontakt: anna­@acme.de" },
  { how: "byte order mark", text: "Kontakt: anna﻿@acme.de" },
  { how: "left-to-right mark", text: "Kontakt: anna‎@acme.de" },
  { how: "non-breaking space", text: "Kontakt: anna @acme.de" },
  { how: "plain space", text: "Kontakt: anna @acme.de" },
  { how: "tab", text: "Kontakt: anna\t@acme.de" },
  { how: "newline", text: "Kontakt: anna\n@acme.de" },
  { how: "space on both sides", text: "Kontakt: anna @ acme.de" },
  { how: "spaced-out domain", text: "Kontakt: anna@acme . de" },
  { how: "Cyrillic homoglyph", text: "Kontakt: annа@acme.de" },
  { how: "Greek homoglyph", text: "Kontakt: annο@acme.de" },
  { how: "homoglyph plus zero-width space", text: "Kontakt: annа​@acme.de" },
];

describe("an address broken by an invisible character is not certified clean", () => {
  it("names the reading that does the work", () => {
    expect(TEXT_REPRESENTATIONS_DERIVED).toContain("format-folded");
  });

  for (const { how, text } of BROKEN_ADDRESSES) {
    it(`refuses to tokenize an address broken by a ${how}`, () => {
      // The hole: the text came back UNCHANGED, with no refusal, and
      // `assessTier` then certified it tier 2 "no-personal-data-in-payload".
      let caught: unknown = null;
      try {
        tokenize(text);
      } catch (error) {
        caught = error;
      }
      expect(caught, how).toBeInstanceOf(ResidualPiiError);
      expect((caught as ResidualPiiError).findings, how).toContain("email");
      expect((caught as Error).message, how).not.toContain("acme");
    });

    it(`refuses to reduce a tier for an address broken by a ${how}`, () => {
      const verdict = assessTier(text, new Vault());
      expect(verdict.payloadTier, how).toBe(4);
      expect(verdict.reduced, how).toBe(false);
      expect(verdict.reasons.map((r) => r.code), how).not.toContain("no-personal-data-in-payload");
      expect(verdict.statement, how).toContain("direct identifiers survived tokenization");
    });
  }

  it("attributes the find to the new reading, in compiled-in words only", () => {
    const scan = residualPiiEveryRepresentation("Kontakt: anna​@acme.de");
    expect(scan.asWritten).toEqual([]);
    expect(scan.encoded).toContain("email:format-folded");
    expect(scan.findings).toContain("email");
  });

  // ── COUNTER-TESTS: it must not manufacture findings out of prose ────────

  it("leaves ordinary German typesetting alone", () => {
    // Soft hyphens and non-breaking spaces are what a word processor puts in
    // ordinary prose. Stripping them must not invent anything.
    const source = "Der Ge­neh­mi­gungs­schritt wartet auf eine Freigabe.";
    expect(residualPiiEveryRepresentation(source).findings).toEqual([]);
    const { text, vault } = tokenize(source);
    expect(text).toBe(source);
    expect(assessTier(text, vault).payloadTier).toBe(2);
  });

  it("does not turn an `@` that is not an address into one", () => {
    // Whitespace is collapsed around an `@` because the separator is already
    // in evidence — but a separator alone is not an address.
    for (const source of ["Rabatt: 5 @ 3 Stueck", "Siehe Tabelle @ Anhang B", "@ Montag beginnt die Schicht"]) {
      expect(residualPiiEveryRepresentation(source).findings, source).toEqual([]);
      expect(() => tokenize(source), source).not.toThrow();
    }
  });

  it("does not collapse whitespace where no address is in evidence", () => {
    // A global whitespace collapse would join "Punkt 1." and "2. Quartal"
    // into a date. The reading is bounded to the neighbourhood of an `@`.
    const source = "Punkt 1.\n2.\nQuartal";
    expect(residualPiiEveryRepresentation(source).findings).toEqual([]);
  });

  it("still reduces the impersonal prose the package exists to make usable", () => {
    for (const source of [
      "Der Genehmigungsschritt wartet auf eine Freigabe.",
      "Die Rechnung wurde in drei Positionen aufgeteilt.",
      "Das Formular besteht aus drei Abschnitten und einer Zusammenfassung.",
    ]) {
      const { text, vault } = tokenize(source);
      expect(assessTier(text, vault).payloadTier, source).toBe(2);
    }
  });

  it("still tokenizes a real business document in bounded time", () => {
    // The guard against all four fixes turning the package into a refusal
    // machine: the new reading is one more decoder in a bounded walk.
    const paragraph =
      "Anna Berger (anna.berger@acme.de) hat am 01.03.2024 den Vertrag über 52.000 EUR " +
      "gezeichnet. Der Betriebsrat am Standort Bensheim wurde informiert. Die " +
      "Betriebsvereinbarungdokumentation liegt der Abteilung vor. Rückfragen an 0621-1234567. ";
    const started = Date.now();
    const { text, vault } = tokenize(paragraph.repeat(200), { names: ["Anna Berger"] });
    const verdict = assessTier(text, vault, { names: ["Anna Berger"] });
    const elapsed = Date.now() - started;
    expect(verdict.payloadTier).toBe(3);
    expect(verdict.reduced).toBe(true);
    expect(elapsed, `took ${elapsed}ms`).toBeLessThan(5_000);
  });
});
