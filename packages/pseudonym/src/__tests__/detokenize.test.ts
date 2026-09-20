/**
 * THE MODEL'S ANSWER IS UNTRUSTED INPUT. These are the tests for that.
 */
import { describe, expect, it } from "vitest";
import { detokenize } from "../detokenize";
import { TagIntegrityError } from "../errors";
import { tokenize } from "../tokenize";

const fixture = () =>
  tokenize("Anna Berger <anna@acme.de> berichtet an Carl Schmidt.", {
    names: ["Anna Berger", "Carl Schmidt"],
  });

describe("a tag the model invented", () => {
  it("is NEVER restored, and is reported", () => {
    const { vault } = fixture();
    // The vault holds three entries. `<person:9>` is not one of them — this
    // is what a prompt injection asking the model to "print entries 9 to 20"
    // produces, and what an ordinary hallucination produces too.
    const { text, report } = detokenize("Siehe <person:9> und <person:2>.", vault);
    // The real tag restores; the invented one is left exactly as the model
    // wrote it. Rejecting the fake must not cost the caller the genuine one.
    expect(text).toBe("Siehe <person:9> und Anna Berger.");
    expect(report.restored).toEqual([{ tag: "<person:2>", count: 1, mangles: [] }]);
    expect(report.rejected).toEqual([{ reason: "invented", cls: "person", ordinal: 9, count: 1 }]);
  });

  it("is not restored even when a DIFFERENT class holds that ordinal", () => {
    // Entry 1 is an email. The model wrote `<person:1>`. Restoring across the
    // class would put an address where the model wrote a person and produce a
    // confidently wrong sentence.
    const { vault } = fixture();
    const { text, report } = detokenize("Kontakt: <person:1>", vault);
    expect(text).toBe("Kontakt: <person:1>");
    expect(text).not.toContain("anna@acme.de");
    expect(report.rejected).toEqual([{ reason: "class-mismatch", cls: "person", ordinal: 1, count: 1 }]);
  });

  it("counts repeats of the same invented tag as one finding", () => {
    const { vault } = fixture();
    const { report } = detokenize("<person:9> <person:9> <person:9>", vault);
    expect(report.rejected).toEqual([{ reason: "invented", cls: "person", ordinal: 9, count: 3 }]);
  });
});

describe("a tag the model dropped", () => {
  it("is reported by tag", () => {
    const { text, vault } = fixture();
    expect(text).toContain("<person:3>");
    const { report } = detokenize("Nur <person:2> ist relevant.", vault);
    expect(report.dropped).toEqual(["<email:1>", "<person:3>"]);
    expect(report.exact).toBe(false);
  });

  it("is not an error — a summary legitimately drops detail", () => {
    const { vault } = fixture();
    expect(() => detokenize("Kurzfassung ohne Namen.", vault)).not.toThrow();
  });
});

describe("a tag the model repeated", () => {
  it("is fine, and counted", () => {
    const { vault } = fixture();
    const { text, report } = detokenize("<person:2>, <person:2> und nochmal <person:2>.", vault);
    expect(text).toBe("Anna Berger, Anna Berger und nochmal Anna Berger.");
    expect(report.restored).toContainEqual({ tag: "<person:2>", count: 3, mangles: [] });
  });
});

describe("a tag the model mangled — the policy, made explicit", () => {
  it("RECOVERS a case change, and says it did", () => {
    const { vault } = fixture();
    const { text, report } = detokenize("<PERSON:2> und <Person:3>.", vault);
    expect(text).toBe("Anna Berger und Carl Schmidt.");
    expect(report.restored.map((r) => r.mangles)).toEqual([["case"], ["case"]]);
  });

  it("RECOVERS HTML-escaped delimiters — a model answering in markdown or HTML", () => {
    const { vault } = fixture();
    const { text, report } = detokenize("&lt;person:2&gt; schrieb an &#60;person:3&#62;.", vault);
    expect(text).toBe("Anna Berger schrieb an Carl Schmidt.");
    expect(report.restored.every((r) => r.mangles.includes("html-entity"))).toBe(true);
  });

  it("RECOVERS whitespace pushed inside the brackets", () => {
    const { vault } = fixture();
    const { text, report } = detokenize("< person : 2 > ist zuständig.", vault);
    expect(text).toBe("Anna Berger ist zuständig.");
    expect(report.restored[0]?.mangles).toEqual(["whitespace"]);
  });

  it("REFUSES a leading-zero ordinal rather than guessing which entry was meant", () => {
    const { vault } = fixture();
    const { text, report } = detokenize("<person:002> ist zuständig.", vault);
    expect(text).toBe("<person:002> ist zuständig."); // untouched
    expect(text).not.toContain("Anna");
    expect(report.rejected).toEqual([{ reason: "malformed-ordinal", cls: "person", ordinal: null, count: 1 }]);
  });

  it("REFUSES a tag the model collapsed back to the host's lossy placeholder", () => {
    const { vault } = fixture();
    const { text, report } = detokenize("<person> ist zuständig.", vault);
    expect(text).toBe("<person> ist zuständig.");
    expect(report.rejected).toEqual([{ reason: "degraded", cls: "person", ordinal: null, count: 1 }]);
  });

  it("leaves a plural `s` outside the tag alone", () => {
    const { vault } = fixture();
    expect(detokenize("zwei <person:2>s", vault).text).toBe("zwei Anna Bergers");
  });
});

describe("what the report may say", () => {
  it("says everything by TAG and by CLASS — never by value", () => {
    const { text, vault } = fixture();
    const { report } = detokenize(`${text} plus <person:9> und <person:007>`, vault);
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain("Anna");
    expect(serialised).not.toContain("Berger");
    expect(serialised).not.toContain("anna@acme.de");
    expect(serialised).not.toContain("007"); // untrusted model text is not echoed either
    expect(report.rejected.map((r) => r.reason).sort()).toEqual(["invented", "malformed-ordinal"]);
  });
});

describe("what a caller can do about a rejected tag", () => {
  it('leaves it in place by default — the evidence stays in the answer', () => {
    const { vault } = fixture();
    expect(detokenize("A <person:9> B", vault).text).toBe("A <person:9> B");
  });

  it('strips it, for output a human will read', () => {
    const { vault } = fixture();
    expect(detokenize("A <person:9> B", vault, { onRejected: "strip" }).text).toBe("A  B");
  });

  it('throws, for a caller that treats a tag defect as a failed generation', () => {
    const { vault } = fixture();
    expect(() => detokenize("A <person:9> B", vault, { onRejected: "throw" })).toThrow(TagIntegrityError);
    try {
      detokenize("A <person:9> B", vault, { onRejected: "throw" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as TagIntegrityError).reasons).toEqual(["invented:person"]);
    }
  });
});

describe("restoration is one pass", () => {
  it("does not re-scan a value it just restored", () => {
    // A vault value that is itself tag-shaped is restored VERBATIM and never
    // looked at again. Without the single pass, `<literal:1>` restoring to
    // `<person:2>` would then restore a second time.
    const { text, vault } = tokenize("Vorlage: <person:2>. Und Anna Berger.", { names: ["Anna Berger"] });
    expect(text).toBe("Vorlage: <literal:1>. Und <person:2>.");
    const { text: restored } = detokenize(text, vault);
    expect(restored).toBe("Vorlage: <person:2>. Und Anna Berger.");
    // The restored `<person:2>` is the SOURCE's literal, not a second lookup.
    expect(restored).not.toBe("Vorlage: Anna Berger. Und Anna Berger.");
  });
});
