/**
 * THE CORE PROPERTIES: same value same tag, different values different tags,
 * and a round trip that restores exactly.
 */
import { describe, expect, it } from "vitest";
import { detokenize } from "../detokenize";
import { ResidualPiiError } from "../errors";
import { tokenize } from "../tokenize";
import { TAG_MINT_RE } from "../tags";

const tagsIn = (text: string): string[] => [...text.matchAll(new RegExp(TAG_MINT_RE.source, "g"))].map((m) => m[0]);

describe("the round trip", () => {
  it("restores the source exactly, byte for byte", () => {
    const source =
      "Jane Doe <jane.doe@acme.de> hat am 01.03.2024 einen Vertrag über 4.500,00 EUR " +
      "unterschrieben. Rückfragen an 0621-1234567 oder jane.doe@acme.de.";
    const { text, vault } = tokenize(source, { names: ["Jane Doe"] });

    expect(text).not.toContain("jane.doe@acme.de");
    expect(text).not.toContain("Jane");
    expect(text).not.toContain("Doe");

    const { text: restored, report } = detokenize(text, vault);
    expect(restored).toBe(source);
    expect(report.exact).toBe(true);
    expect(report.dropped).toEqual([]);
    expect(report.rejected).toEqual([]);
  });

  it("gives the SAME value the SAME tag — the whole reason for a vault", () => {
    // Two mentions of one address, two of one person: the model must be able
    // to see that they are the same two entities.
    const source = "jane.doe@acme.de schrieb an max@acme.de, und jane.doe@acme.de antwortete.";
    const { text, findings } = tokenize(source);

    const jane = findings.find((f) => f.occurrences === 2);
    expect(jane, "the repeated address should have one tag with two occurrences").toBeDefined();
    expect(findings).toHaveLength(2);
    expect(tagsIn(text)).toEqual(["<email:1>", "<email:2>", "<email:1>"]);
  });

  it("gives DIFFERENT values DIFFERENT tags, and never reuses an ordinal", () => {
    const { text, vault } = tokenize("a@x.de b@x.de c@x.de");
    expect(tagsIn(text)).toEqual(["<email:1>", "<email:2>", "<email:3>"]);
    expect(new Set(tagsIn(text)).size).toBe(3);
    expect(vault.size).toBe(3);
  });

  it("lets the model reason about identity: <person:1> reports to <person:2>", () => {
    const source = "Anna Berger berichtet an Carl Schmidt. Carl Schmidt genehmigt.";
    const { text, vault } = tokenize(source, { names: ["Anna Berger", "Carl Schmidt"] });
    expect(text).toBe("<person:1> berichtet an <person:2>. <person:2> genehmigt.");

    const answer = "<person:2> muss die Freigabe für <person:1> erteilen.";
    const { text: restored } = detokenize(answer, vault);
    expect(restored).toBe("Carl Schmidt muss die Freigabe für Anna Berger erteilen.");
  });

  it("carries a declared name that no pattern would ever match", () => {
    // The `RedactOptions.names` contract: a German surname in prose is not a
    // pattern, and the host says so outright — it "does NOT claim to detect
    // an undeclared personal name in free German prose; no regex does".
    const { text } = tokenize("Frau Musterfrau leitet das Projekt.", { names: ["Musterfrau"] });
    expect(text).toBe("Frau <person:1> leitet das Projekt.");
  });

  it("unifies the surface forms of one declared name, and REPORTS that it did", () => {
    const source = "Jane Doe wurde eingestellt. Doe beginnt im Mai.";
    const { text, vault, findings } = tokenize(source, { names: ["Jane Doe"] });
    expect(text).toBe("<person:1> wurde eingestellt. <person:1> beginnt im Mai.");

    const alias = findings.find((f) => f.tag === "<person:1>");
    expect(alias?.aliasForms).toBe(2);

    // Restoration is faithful prose, NOT byte-exact — and `exact` says so
    // rather than letting the caller assume otherwise.
    const { text: restored, report } = detokenize(text, vault);
    expect(restored).toBe("Jane Doe wurde eingestellt. Jane Doe beginnt im Mai.");
    expect(report.exact).toBe(false);
    expect(report.canonicalised).toEqual(["<person:1>"]);
  });

  it('nameAliasing: "distinct" buys byte-exactness back, at the cost of identity', () => {
    const source = "Jane Doe wurde eingestellt. Doe beginnt im Mai.";
    const { text, vault } = tokenize(source, { names: ["Jane Doe"], nameAliasing: "distinct" });
    expect(text).toBe("<person:1> wurde eingestellt. <person:2> beginnt im Mai.");

    const { text: restored, report } = detokenize(text, vault);
    expect(restored).toBe(source);
    expect(report.exact).toBe(true);
  });

  it("does not guess which person a shared surname belongs to", () => {
    // "Doe" is declared by two different people. Attributing it to whichever
    // was declared first would silently put one person's sentence on the
    // other's record.
    const source = "Jane Doe und John Doe. Doe hat unterschrieben.";
    const { text, vault } = tokenize(source, { names: ["Jane Doe", "John Doe"] });
    const tags = tagsIn(text);
    expect(tags[0]).toBe("<person:1>"); // Jane Doe
    expect(tags[1]).toBe("<person:2>"); // John Doe
    expect(tags[2]).toBe("<person:3>"); // bare "Doe" — its own identity
    expect(new Set(tags).size).toBe(3);

    // And the ambiguous one restores to exactly what was written.
    expect(detokenize(text, vault).text).toBe(source);
  });

  it("keeps a declared name inside an email intact as ONE email entry", () => {
    // The pass-order decision, as a test: names-before-patterns would shred
    // the address into three name replacements and make it unrestorable.
    const source = "Jane Doe <jane.doe@acme.de>";
    const { text, vault } = tokenize(source, { names: ["Jane Doe"] });
    expect(text).toBe("<person:2> <<email:1>>");
    expect(detokenize(text, vault).text).toBe(source);
  });
});

describe("the proof, which is not an assumption", () => {
  it("refuses loudly when the tokenizer misses a pattern the host still scans for", () => {
    // `patterns: []` is a tokenizer with a hole in it. Step 4 always proves
    // against the host's FULL PII_PATTERNS, so the hole is caught rather than
    // shipped. This is the gate being exercised, not mocked.
    expect(() => tokenize("schreib an jane.doe@acme.de", { patterns: [] })).toThrow(ResidualPiiError);
    try {
      tokenize("schreib an jane.doe@acme.de", { patterns: [] });
      expect.unreachable("should have refused");
    } catch (error) {
      expect(error).toBeInstanceOf(ResidualPiiError);
      const findings = (error as ResidualPiiError).findings;
      expect(findings).toEqual(["email"]);
      // CLASS NAMES ONLY — the refusal must not reproduce the thing it caught.
      expect((error as Error).message).not.toContain("jane.doe");
      expect((error as Error).message).not.toContain("acme");
    }
  });

  it("names every class that survived, not just the first", () => {
    const partial = [{ name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, placeholder: "<email>" }];
    try {
      tokenize("a@b.de am 01.02.2024 über 500 EUR", { patterns: partial });
      expect.unreachable("should have refused");
    } catch (error) {
      // Three, not one: "01.02.2024" is BOTH a date and a long digit run
      // under the host's patterns, and a refusal that named only the first
      // class would under-report what was about to be sent.
      expect((error as ResidualPiiError).findings).toEqual(["amount", "date", "digits"]);
    }
  });

  it("states the gap it inherits: an UNDECLARED name in German prose is not detected", () => {
    // The host is explicit that this gap exists and that no regex closes it:
    // `redact()` "does NOT claim to detect an undeclared personal name in
    // free German prose". This package inherits the gap exactly, and the
    // proof cannot see it either, because the proof is the same scanner.
    // Written down as a test so it is a KNOWN limit rather than a surprise.
    const { text } = tokenize("Musterfrau leitet das Projekt.");
    expect(text).toBe("Musterfrau leitet das Projekt.");

    // Declaring it is the caller's one obligation, and then it is removed
    // AND proved gone.
    expect(tokenize("Musterfrau leitet das Projekt.", { names: ["Musterfrau"] }).text).toBe(
      "<person:1> leitet das Projekt.",
    );
  });
});

describe("a declared name spelled inside one of our own class words", () => {
  it('tokenizes "Son" correctly and REPORTS the downstream interaction', () => {
    // "son" is a substring of "person". The payload is spotless — but the
    // host's residual scanner matches a full declared name with NO word
    // boundary, so a DOWNSTREAM scan run with the same names would report
    // `declaredName` on this package's own `<person:1>`. Refusing here would
    // reject a real surname over our vocabulary; saying nothing would hand the
    // caller a payload that fails later for a reason they cannot diagnose.
    const { text, vault, tagClassNameCollisions } = tokenize("Son hat unterschrieben.", { names: ["Son"] });
    expect(text).toBe("<person:1> hat unterschrieben.");
    expect(tagClassNameCollisions).toEqual(["person"]);
    expect(detokenize(text, vault).text).toBe("Son hat unterschrieben.");
  });

  it("does not corrupt a tag an earlier pass minted", () => {
    // THE BUG THIS GUARDS, and it is a real one: the collision sweep mints
    // `<literal:1>`, and the declared name "Li" — a common surname — matches
    // INSIDE the word "literal" because the host's recipe matches a full
    // declared name with no word boundary. A naive second pass rewrites
    // `<literal:1>` into `<<person:2>teral:1>` and the source can never be
    // restored. `mapOutsideTags` is why it does not.
    const { text, vault, tagClassNameCollisions } = tokenize("Vorlage <person:1> und Li.", { names: ["Li"] });
    expect(text).toBe("Vorlage <literal:1> und <person:2>.");
    expect(tagClassNameCollisions).toEqual(["literal"]);
    expect(detokenize(text, vault).text).toBe("Vorlage <person:1> und Li.");
  });

  it("reports nothing for an ordinary name", () => {
    expect(tokenize("Anna Berger", { names: ["Anna Berger"] }).tagClassNameCollisions).toEqual([]);
  });
});

describe("end to end, the way a caller uses it", () => {
  it("tokenize -> assess -> model -> detokenize", async () => {
    const { assessTier } = await import("../tier");
    const source =
      "Anna Berger (anna.berger@acme.de) und Carl Schmidt haben den Vertrag " +
      "am 01.03.2024 gezeichnet. Berger berichtet an Schmidt.";
    const names = ["Anna Berger", "Carl Schmidt"];

    const { text, vault, findings } = tokenize(source, { names });

    // Nothing personal on the wire.
    for (const leak of ["Anna", "Berger", "Carl", "Schmidt", "anna.berger@acme.de", "01.03.2024"]) {
      expect(text, `"${leak}" must not be in the payload`).not.toContain(leak);
    }
    // The model can still see that Berger and Schmidt are two people, each
    // mentioned twice.
    expect(findings.filter((f) => f.cls === "person").map((f) => f.occurrences)).toEqual([2, 2]);

    const verdict = assessTier(text, vault, { names });
    expect(verdict.payloadTier).toBe(3);
    expect(verdict.vaultTier).toBe(4);

    // Ordinals are by FIRST APPEARANCE across all classes, so the email is 1
    // and the date is 2 — both appear before either name is replaced.
    expect(text).toBe(
      "<person:3> (<email:1>) und <person:4> haben den Vertrag am <number:2> gezeichnet. " +
        "<person:3> berichtet an <person:4>.",
    );

    // The model rewrites the prose, answers in English, keeps the tags, and
    // mangles two of them on the way — HTML-escaped and upper-cased.
    const answer = "Summary: &lt;person:4&gt; approved the contract signed by <PERSON:3> on <number:2>.";
    const { text: final, report } = detokenize(answer, vault);
    expect(final).toBe("Summary: Carl Schmidt approved the contract signed by Anna Berger on 01.03.2024.");
    expect(report.rejected).toEqual([]);
    expect(report.dropped).toEqual(["<email:1>"]);
    expect(JSON.stringify(report)).not.toContain("Anna");
  });
});
