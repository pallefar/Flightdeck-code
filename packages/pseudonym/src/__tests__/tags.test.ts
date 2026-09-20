/**
 * THE TAG SYNTAX, and the collision case that makes it safe to read back.
 */
import { describe, expect, it } from "vitest";
import { detokenize } from "../detokenize";
import { TagCollisionError } from "../errors";
import { PII_PATTERNS, residualPiiFindings } from "../host-mirror";
import {
  MAX_VAULT_ENTRIES,
  TAG_CANDIDATE_RE,
  TAG_CLASSES,
  TAG_MINT_RE,
  classifyTagCandidate,
  findTagCandidates,
  mintTag,
} from "../tags";
import { tokenize } from "../tokenize";

describe("a tag carries nothing about the value it replaces", () => {
  it("is the same bytes whatever it stands for", () => {
    const short = tokenize("Li arbeitet hier.", { names: ["Li"] });
    const long = tokenize("Maximiliane von Habsburg-Lothringen arbeitet hier.", {
      names: ["Maximiliane von Habsburg-Lothringen"],
    });
    expect(short.text).toBe("<person:1> arbeitet hier.");
    expect(long.text).toBe("<person:1> arbeitet hier.");
  });

  it("is ordered by first appearance, not derived from the value", () => {
    // A value-derived id would be a STABLE pseudonym across documents, which
    // is a worse privacy property, not a better one. Two vaults built from
    // the same person give different ordinals when the order differs.
    const a = tokenize("b@x.de then a@x.de");
    const b = tokenize("a@x.de then b@x.de");
    expect(a.text).toBe("<email:1> then <email:2>");
    expect(b.text).toBe("<email:1> then <email:2>");
    // Same tag, different underlying value — the tag is positional.
    expect(detokenize("<email:1>", a.vault).text).toBe("b@x.de");
    expect(detokenize("<email:1>", b.vault).text).toBe("a@x.de");
  });
});

describe("the ceiling is derived, not picked", () => {
  it("keeps every ordinal below the host's `digits` class", () => {
    // MAX_VAULT_ENTRIES = 9999 means at most four digits. The host's `digits`
    // pattern needs SEVEN characters. So no tag can ever trip the scanner
    // that `tokenize` has to pass. This is the derivation, checked.
    expect(String(MAX_VAULT_ENTRIES).length).toBe(4);
    const digits = PII_PATTERNS.find((p) => p.name === "digits");
    expect(digits).toBeDefined();
    for (const cls of TAG_CLASSES) {
      const tag = mintTag(cls, MAX_VAULT_ENTRIES);
      expect(residualPiiFindings(tag)).toEqual([]);
    }
    // And the boundary is real: a 7-digit ordinal WOULD trip it.
    expect(residualPiiFindings("<person:1234567>")).toContain("digits");
  });

  it("refuses an ordinal outside the range rather than minting a wider tag", () => {
    expect(() => mintTag("person", 0)).toThrow(RangeError);
    expect(() => mintTag("person", MAX_VAULT_ENTRIES + 1)).toThrow(RangeError);
  });

  it("mints only lowercase ASCII class words, which is what keeps IBAN off them", () => {
    // The host's iban pattern needs two UPPERCASE letters at a word boundary.
    // Lowercase class words are structurally below it.
    for (const cls of TAG_CLASSES) {
      expect(cls).toBe(cls.toLowerCase());
      expect(residualPiiFindings(mintTag(cls, 1))).toEqual([]);
    }
  });
});

describe("source text that is genuinely tag-shaped", () => {
  it("is carried losslessly instead of being mistaken for a tag on the way back", () => {
    const source = "Die Vorlage nutzt <person:1> als Platzhalter, und <email:2> für die Adresse.";
    const { text, vault, findings } = tokenize(source);
    // Neutralised BEFORE anything else ran, so nothing downstream can confuse
    // them with a tag this package minted.
    expect(text).toBe("Die Vorlage nutzt <literal:1> als Platzhalter, und <literal:2> für die Adresse.");
    expect(findings.every((f) => f.via === "tag-collision")).toBe(true);
    expect(detokenize(text, vault).text).toBe(source);
  });

  it("catches the host's OWN lossy placeholders, which a real payload is full of", () => {
    // `redact()` emits `<email>`; a document that has been through it and then
    // comes here is the likeliest collision there is.
    const source = "Nach redact(): <email> schrieb an <email>, Betrag <amount>.";
    const { text, vault } = tokenize(source);
    expect(text).not.toContain("<email>");
    // Both `<email>` spans are the same string, so they share one literal tag.
    expect(text).toBe("Nach redact(): <literal:1> schrieb an <literal:1>, Betrag <literal:2>.");
    expect(detokenize(text, vault).text).toBe(source);
  });

  it("catches mangled-looking source too, because detection uses the read-back regex", () => {
    const source = "Beispiel: &lt;person:3&gt; und < PERSON : 4 >.";
    const { text, vault } = tokenize(source);
    expect(findTagCandidates(text).every((c) => c.verdict.kind === "canonical")).toBe(true);
    expect(text).toBe("Beispiel: <literal:1> und <literal:2>.");
    expect(detokenize(text, vault).text).toBe(source);
  });

  it("leaves ordinary markup alone — the class vocabulary is closed", () => {
    const source = "<b>fett</b> und <div class=\"x\"/> und <br>";
    const { text } = tokenize(source);
    expect(text).toBe(source);
  });

  it('can refuse instead, for callers who want nothing tag-shaped on the wire', () => {
    expect(() => tokenize("nutzt <person:1>", { onSourceTagShapedText: "refuse" })).toThrow(TagCollisionError);
    try {
      tokenize("nutzt <person:1> und <email:2>", { onSourceTagShapedText: "refuse" });
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as TagCollisionError).count).toBe(2);
      // A count, not the text.
      expect((error as Error).message).not.toContain("nutzt");
    }
  });
});

describe("the mint shape and the read-back shape", () => {
  it("everything we mint is read back as canonical", () => {
    for (const cls of TAG_CLASSES) {
      for (const n of [1, 9, 10, 999, MAX_VAULT_ENTRIES]) {
        const tag = mintTag(cls, n);
        const found = findTagCandidates(tag);
        expect(found).toHaveLength(1);
        expect(found[0]?.verdict).toEqual({ kind: "canonical", cls, ordinal: n });
      }
    }
  });

  it("the read-back shape is strictly wider than the mint shape", () => {
    // Every mint match is a candidate match. That containment is what makes
    // the collision sweep sufficient.
    const sample = "<person:1> <email:22> <literal:9999>";
    const minted = [...sample.matchAll(new RegExp(TAG_MINT_RE.source, TAG_MINT_RE.flags))].map((m) => m[0]);
    const candidates = findTagCandidates(sample).map((c) => c.raw);
    expect(candidates).toEqual(minted);
    expect(TAG_CANDIDATE_RE.flags).toContain("i");
  });

  it("classifies the mangles it will recover and the ones it will not", () => {
    expect(classifyTagCandidate("<PERSON:1>", "PERSON", "1")).toEqual({
      kind: "mangled",
      cls: "person",
      ordinal: 1,
      mangles: ["case"],
    });
    expect(classifyTagCandidate("&lt;person:1&gt;", "person", "1")).toEqual({
      kind: "mangled",
      cls: "person",
      ordinal: 1,
      mangles: ["html-entity"],
    });
    expect(classifyTagCandidate("<person>", "person", undefined)).toEqual({ kind: "degraded", cls: "person" });
    // ⛔ `007` is NOT read as 7. That would be a guess about what the model
    // meant, and a wrong guess restores the wrong person's name.
    expect(classifyTagCandidate("<person:007>", "person", "007")).toEqual({ kind: "malformed", cls: "person" });
    expect(classifyTagCandidate("<person:0>", "person", "0")).toEqual({ kind: "malformed", cls: "person" });
    expect(classifyTagCandidate("<person:x>", "person", "x")).toEqual({ kind: "malformed", cls: "person" });
  });
});
