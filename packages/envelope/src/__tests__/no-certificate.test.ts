/**
 * ⭐ THE RULE THAT GOVERNS THE WHOLE PACKAGE, ASSERTED RATHER THAN PROMISED.
 *
 *     A CONTROL MAY REFUSE. IT MAY NEVER CERTIFY.
 *
 * Every failure in this project came from a control saying "no personal data"
 * when it had only failed to find any — `classify()` returning tier 1 for a
 * double-stringified salary, `assessTier` returning
 * "no-personal-data-in-payload" for a paragraph that named a person's job,
 * site and sole-officer status. Neither was wrong about what it had done.
 * Both were wrong about what it meant.
 *
 * A header comment promising not to do that again is worth nothing. These
 * cases are the mechanism:
 *
 *   - no output of this package has a field that asserts cleanliness;
 *   - `assurance.notChecked` is non-empty on EVERY result, envelope and
 *     refusal alike;
 *   - the statement says what ran, what matched and what nothing looked at,
 *     and contains the words "not a certificate";
 *   - and the compiled-in lists are themselves checked against the sibling
 *     package's denylists, so the allowlist cannot quietly become a route.
 */

import { describe, expect, it } from "vitest";
import { buildEnvelope } from "../build";
import {
  FACT_KEY_ALLOWLIST,
  STUDIO_AI_TASKS,
  STUDIO_FIELD_NAMES,
  STUDIO_VOCABULARIES,
} from "../allowlists";
import { ENVELOPE_CLASSES_NOT_CHECKED } from "../types";
import { residualPiiFindings } from "../host-scan";
import { classify } from "../../../guardrails/src/classify";
import { nameHits } from "../../../guardrails/src/names";
import type { CoverageReportLike } from "../types";

const REPORT: CoverageReportLike = {
  payloadTier: 3,
  vaultTier: 4,
  reduced: true,
  coverage: { checked: ["name-shaped-span"], unchecked: ["undeclared-personal-name"], representations: ["as-written"] },
  statement: "payload may be treated as tier three (from four)",
};

/** One of each outcome this package can produce. */
const RESULTS = {
  ready: buildEnvelope({
    task: "intake.fieldmap",
    facts: { field: { kind: "fieldName", value: "startDate" }, fieldCount: { kind: "count", value: 3 } },
  }),
  needsHuman: buildEnvelope({
    task: "studio.workflow.summarise",
    text: [{ key: "workflow", text: "<person:1> opens the ticket.", assessment: REPORT }],
  }),
  refusal: buildEnvelope({ task: "draft", facts: { salary: { kind: "count", value: 1 } } }),
  refusalWithNames: buildEnvelope({ task: "draft", facts: {} }, { names: ["Erika Musterfrau"] }),
};

/** Words that would each be a claim this package cannot support. */
const FORBIDDEN_FIELD_WORDS = ["clean", "safe", "verified", "piifree", "nopii", "sanitized", "sanitised", "certified"];

function allKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
    return into;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      into.push(key);
      allKeys(child, into);
    }
  }
  return into;
}

describe("nothing here emits a clean certificate", () => {
  for (const [name, result] of Object.entries(RESULTS)) {
    it(`${name}: no field NAME claims the payload is clean`, () => {
      for (const key of allKeys(result)) {
        const folded = key.toLowerCase().replace(/[^a-z]/g, "");
        for (const word of FORBIDDEN_FIELD_WORDS) {
          expect(folded, `a field called "${key}" is a claim this package cannot support`).not.toContain(word);
        }
      }
    });

    it(`${name}: assurance.notChecked is NOT EMPTY`, () => {
      const assurance = "assurance" in result ? result.assurance : null;
      expect(assurance).not.toBeNull();
      expect(assurance?.notChecked.length ?? 0).toBeGreaterThan(0);
      // The load-bearing one: an allowlist says nothing whatever about an
      // undeclared personal name inside a bounded text fact.
      expect(assurance?.notChecked).toContain("undeclared-personal-name");
    });

    it(`${name}: the statement says what ran, and that it is not a certificate`, () => {
      const statement = "assurance" in result ? result.assurance.statement : "";
      expect(statement).toContain("Classes checked by the residual scan");
      expect(statement).toContain("NOT checked");
      expect(statement).toContain("NOT a certificate of absence");
      // ⚠ THE WORDING IS PART OF THE CONTROL. "None matched" is a fact about
      // the scan; "no personal data" is a claim about the payload, and this
      // package is not entitled to make it — not even inside a disclaimer,
      // where a grep or a summariser would find it stripped of its negation.
      for (const phrase of ["no personal data", "is clean", "contains no", "free of pii", "verified clean"]) {
        expect(statement.toLowerCase(), `the statement says "${phrase}"`).not.toContain(phrase);
      }
    });
  }

  it("⭐ an envelope's assurance never claims more when MORE was checked", () => {
    // Declaring names widens the scan by one class. It must widen `scanned`
    // and must NOT shrink `notChecked` below the compiled-in floor — "a
    // caller who declares nothing gets a more cautious answer, not a cleaner
    // one", and one who declares something does not get a cleaner one either.
    const withNames = RESULTS.refusalWithNames;
    const without = RESULTS.refusal;
    expect("assurance" in withNames && withNames.assurance.scanned).toContain("declaredName");
    expect("assurance" in without && without.assurance.scanned).not.toContain("declaredName");
    for (const klass of ENVELOPE_CLASSES_NOT_CHECKED) {
      expect("assurance" in withNames ? withNames.assurance.notChecked : []).toContain(klass);
    }
  });

  it("the `checked` half is DERIVED from the list that actually ran", () => {
    // Not typed out a second time: a class added to the host's patterns shows
    // up here automatically, and one removed disappears. A hand-kept list of
    // "what we check" is how a claim outlives the check.
    const assurance = "assurance" in RESULTS.ready ? RESULTS.ready.assurance : null;
    expect(assurance?.scanned).toEqual(["email", "iban", "digits", "amount", "date"]);
  });
});

describe("the compiled-in lists cannot quietly become a route", () => {
  it("no STUDIO-authored constant matches a host PII class", () => {
    const studioStrings = [
      ...STUDIO_AI_TASKS,
      ...STUDIO_FIELD_NAMES,
      ...Object.keys(STUDIO_VOCABULARIES),
      ...Object.values(STUDIO_VOCABULARIES).flat(),
      ...FACT_KEY_ALLOWLIST,
    ];
    for (const value of studioStrings) {
      expect(residualPiiFindings(value), `"${value}" matches a PII class`).toEqual([]);
    }
  });

  it("⭐ no STUDIO-authored FIELD NAME is a tier 3/4 field name to the sibling package", () => {
    // The allowlist and the denylist are two halves of one judgement, and this
    // is where they are made to agree. A Studio field name that `nameHits`
    // reads as personal would be an allowlisted route to exactly what
    // `packages/guardrails` refuses.
    for (const name of STUDIO_FIELD_NAMES) {
      const worst = Math.max(0, ...nameHits(name).map((h) => h.tier));
      expect(worst, `Studio field name "${name}" is tier ${worst} to nameHits()`).toBeLessThanOrEqual(2);
      expect(classify(null, { rootPath: name }).tier).toBeLessThanOrEqual(2);
    }
  });

  it("⚠ STATED, NOT HIDDEN: the HOST's field names include personal ones, by the host's decision", () => {
    // `lastName`, `firstName` and `requesterEmail` ARE tier 3/4 field names to
    // `nameHits`, and they are on the host's allowlist on purpose: a field
    // NAME is not a value. This case exists so nobody "fixes" the divergence
    // test by deleting them — and to make the asymmetry visible rather than
    // buried in a comment.
    expect(Math.max(...nameHits("lastName").map((h) => h.tier))).toBeGreaterThanOrEqual(3);
    // The value channel for that field remains closed: only the NAME is
    // expressible.
    expect(buildEnvelope({ task: "kb.question", facts: { field: { kind: "fieldName", value: "lastName" } } }).ok).toBe(
      true,
    );
    expect(buildEnvelope({ task: "kb.question", facts: { field: { kind: "fieldName", value: "Musterfrau" } } }).ok).toBe(
      false,
    );
  });
});
