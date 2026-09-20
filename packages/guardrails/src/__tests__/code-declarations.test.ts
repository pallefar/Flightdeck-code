/**
 * ⭐ A CONTROL THAT REFUSES EVERYTHING IS NOT A CONTROL.
 *
 * `gateGeneratedArtifacts` refused every mini-app this repo can produce, for
 * three findings that were all artefacts of reading TypeScript as data:
 *
 *   `name: string;` in `interface FieldDescriptor`   → class "name", tier 3
 *   `name: string;` in `interface WorkflowDescriptor`
 *   `"$1 $2"`, a regex replacement                    → class "amount" ×2
 *
 * The emitters put that interface in every generated web module and use
 * `$1 $2` to humanise a camelCase key, so the refusal was unconditional.
 *
 * Neither was fixed by renaming the emitter's fields — "a space is a
 * spelling, not a defence" is this package's own rule about that move — and
 * neither weakened the shared pattern: `divergence.test.ts` requires
 * `PII_PATTERNS` to match the host's entry for entry, and the first attempt
 * at the amount fix changed it and was told no. Both narrowings live where
 * the STYLE is known.
 *
 * Every case below exists in pairs: the false positive that must stop, and
 * the true positive beside it that must not.
 */
import { describe, expect, it } from "vitest";

import { classifyCode, classifyMarkdown, classifyProseAndCode } from "../markdown";

const classes = (findings: readonly { class: string; tier: number }[]): string[] =>
  findings.map((f) => `${f.class}/${f.tier}`).sort();

describe("a type annotation is not a value", () => {
  it("⭐ `name: string` in an interface is a declaration, not a field holding a name", () => {
    expect(classifyCode("interface FieldDescriptor {\n  name: string;\n  label: string;\n}", "<c>")).toEqual([]);
  });

  it("⭐ and through classifyProseAndCode — which is how the gate actually scans", () => {
    // The fix had to be made TWICE. Suppressing it in the code branch left
    // the finding in place, because `labelsOf` reads `  name: string;` as a
    // markdown `Label: value` line and a .ts file is scanned both ways.
    expect(classifyProseAndCode("interface FieldDescriptor {\n  name: string;\n}", "<p>")).toEqual([]);
    expect(classifyProseAndCode("interface W {\n  name: string | null;\n  source: string | null;\n}", "<p>")).toEqual(
      [],
    );
  });

  it("⛔ but a tier-4 declaration still stops for a human", () => {
    // A generated app that declares a salary field is worth looking at even
    // though the declaration itself holds nothing. Only the tier-3
    // field-name hits are suppressed — the same line the metakey rule draws.
    expect(classes(classifyProseAndCode("interface P {\n  salaryEur: number;\n}", "<p>"))).toEqual(["salary/4"]);
  });

  it("⛔ and a REAL value is untouched, whichever side it is on", () => {
    expect(classes(classifyProseAndCode('const row = {\n  iban: "DE02120300000000202051",\n};', "<p>"))).toContain(
      "iban/4",
    );
    expect(classes(classifyProseAndCode("const row = {\n  salaryEur: 92000,\n};", "<p>"))).toContain("salary/4");
  });

  it("⛔ a MARKDOWN document is not source, and `Name: string` stays a finding there", () => {
    // The suppression is guarded on the text also being read as code. A
    // real document with a "Name:" label has a value beside it.
    expect(classes(classifyMarkdown("Name: string", "<md>"))).toEqual(["name/3"]);
    expect(classes(classifyMarkdown("Salary: string", "<md>"))).toEqual(["salary/4"]);
  });

  it("only PRIMITIVE type expressions count — a quoted value is never a type", () => {
    // ⚠ THIS CASE USED A TIER-4 FIELD AND THEREFORE CHECKED NOTHING.
    //
    // It asserted on `iban: "DE02…"`, and the suppression only ever applies
    // to TIER 3 — so widening `TYPE_ONLY` to admit quoted literals left it
    // green. Mutation testing found it; reading it did not. `surname` is
    // tier 3 and is not a schema metakey, so it is the shape that actually
    // exercises the branch: admit quoted literals and this goes quiet.
    expect(classes(classifyProseAndCode('const row = {\n  surname: "Sørensen",\n};', "<p>"))).toContain("surname/3");
    expect(classes(classifyProseAndCode('interface X {\n  surname: "Sørensen";\n}', "<p>"))).toContain("surname/3");
    // And the tier-4 pair beside it, which was all this case used to test.
    expect(classes(classifyProseAndCode('interface X {\n  iban: "DE02120300000000202051";\n}', "<p>"))).toContain(
      "iban/4",
    );
    // The declaration form of the SAME tier-3 field is still suppressed —
    // otherwise this case would pass by disabling the fix.
    expect(classes(classifyProseAndCode("interface X {\n  surname: string;\n}", "<p>"))).toEqual([]);
  });
});

describe("a capture reference is not an amount", () => {
  it("⭐ `$1 $2` in a replacement string is not two dollar amounts", () => {
    const source = 'const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");';
    expect(classifyCode(source, "<c>")).toEqual([]);
  });

  it("⛔ and every real amount shape still fires", () => {
    // Only `$` followed by exactly one digit with no separator is masked.
    for (const amount of ["$10", "$1.50", "$1,000", "$92000", "€1", "EUR 1", "USD 1"]) {
      const found = classifyCode(`const total = "${amount}";`, "<c>");
      expect(classes(found), amount).toContain("amount/3");
    }
  });

  it("⛔ and the masking does not move any offset it reports", () => {
    // The replacement is the same LENGTH on purpose: a finding's `offset`
    // has to keep pointing where it did.
    const source = 'const a = "$1"; const iban = "DE02120300000000202051";';
    const found = classifyCode(source, "<c>").find((f) => f.class === "iban" && f.via === "value-pattern");
    expect(found).toBeDefined();
    expect(source.slice(found?.offset ?? 0, (found?.offset ?? 0) + 22)).toBe("DE02120300000000202051");
  });

  it("⛔ a markdown document keeps single-dollar amounts — only code is masked", () => {
    expect(classes(classifyMarkdown("The fee was $5 per person.", "<md>"))).toContain("amount/3");
  });
});
