/**
 * ⭐ THE ANTI-DIVERGENCE GATE FOR THE PROVENANCE VOCABULARY — the reason
 * `../coverage.ts` is allowed to transcribe `packages/pseudonym`'s class names
 * instead of importing them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A TRANSCRIPTION AT ALL
 * ─────────────────────────────────────────────────────────────────────────
 * `../types.ts` gives the reason and it governs this file too: THIS PACKAGE
 * MUST NOT DEPEND ON THE PSEUDONYMISER'S RUNTIME. If it imported
 * `PII_CLASSES_NOT_CHECKED` it would be one import away from importing
 * `assessTier`, and then a caller could hand `buildEnvelope` raw text and get
 * an envelope back — the job this package exists to refuse. `build.ts` has no
 * runtime edge to that package today and this test is how it keeps none.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BOTH DIRECTIONS, AND THEY FAIL DIFFERENTLY
 * ─────────────────────────────────────────────────────────────────────────
 *   PSEUDONYM HAS, ENVELOPE DOES NOT   a report the pseudonymiser really
 *                                      produced is REFUSED. Annoying, safe,
 *                                      and loud — the caller gets a compiled-in
 *                                      code rather than a silent pass-through.
 *
 *   ENVELOPE HAS, PSEUDONYM DOES NOT   ⚠ THE DANGEROUS ONE. The envelope is
 *                                      admitting a string that no
 *                                      pseudonymiser ever emits, which means
 *                                      the only thing that can have authored
 *                                      it is a caller. That is the hole this
 *                                      whole round closed, growing back one
 *                                      entry at a time.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SOURCE TEXT, NOT AN IMPORT — and an absent file is a FAILURE
 * ─────────────────────────────────────────────────────────────────────────
 * Read off disk with the same deliberately dumb parser `guardrails` uses for
 * the host, for the same reason: importing the module would create the
 * runtime edge this file exists to prevent, and another agent is restructuring
 * that package, so its module graph must not be able to break this suite.
 * A missing file fails here; it does not skip. "A warning is read by a human
 * who is watching; an exit code is read by the machine that merges."
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readStringArray } from "../../../guardrails/src/host-source";
import {
  COVERAGE_CLASS_VOCABULARY,
  COVERAGE_DETECTOR_VOCABULARY,
  COVERAGE_REPRESENTATION_VOCABULARY,
  MAX_PROVENANCE_CHARS,
  PSEUDONYM_DETECTORS_CHECKED,
  PSEUDONYM_REPRESENTATIONS,
  PSEUDONYM_UNCHECKED_CLASSES,
} from "../coverage";
import { MAX_TEXT_CHARS } from "../allowlists";
import { SCANNED_CLASSES } from "../host-scan";

const PSEUDONYM = path.join(fileURLToPath(new URL("../../../pseudonym/src/", import.meta.url)));
const TIER = path.join(PSEUDONYM, "tier.ts");
const REPRESENTATIONS = path.join(PSEUDONYM, "representations.ts");

function read(file: string): string {
  expect(fs.existsSync(file), `${file} is not on disk — this comparison did not run, which is not a pass`).toBe(true);
  return fs.readFileSync(file, "utf8");
}

/** Both directions, named, with the dangerous one named as dangerous. */
function diff(label: string, envelope: readonly string[], pseudonym: readonly string[]): string | null {
  const missing = pseudonym.filter((x) => !envelope.includes(x));
  const extra = envelope.filter((x) => !pseudonym.includes(x));
  if (missing.length === 0 && extra.length === 0) return null;
  const lines = [`${label} has DIVERGED from packages/pseudonym:`];
  if (missing.length > 0) {
    lines.push(`  PSEUDONYM HAS, ENVELOPE DOES NOT (a real report will be REFUSED): ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    lines.push(
      `  ENVELOPE HAS, PSEUDONYM DOES NOT (⚠ the envelope admits a string nothing upstream produces — only a caller can have authored it): ${extra.join(", ")}`,
    );
  }
  lines.push(`  Source: ${TIER} / ${REPRESENTATIONS}`);
  lines.push(`  Copy:   packages/envelope/src/coverage.ts`);
  return lines.join("\n");
}

describe("the coverage vocabularies are the pseudonymiser's, transcribed", () => {
  it("the unchecked CLASS names match, in both directions", () => {
    const src = read(TIER);
    const classes = readStringArray(src, "PII_CLASSES_NOT_CHECKED");
    expect(classes.length).toBeGreaterThan(5);
    // The one class `assessTier` appends inline rather than from the const.
    expect(src, "assessTier no longer appends declared-name-none-supplied").toContain("declared-name-none-supplied");
    expect(diff("COVERAGE_CLASS_VOCABULARY", PSEUDONYM_UNCHECKED_CLASSES, [...classes, "declared-name-none-supplied"]))
      .toBeNull();
  });

  it("the DETECTOR names match, in both directions", () => {
    const detectors = readStringArray(read(TIER), "DETECTORS_CHECKED");
    expect(detectors.length).toBeGreaterThan(3);
    expect(diff("PSEUDONYM_DETECTORS_CHECKED", PSEUDONYM_DETECTORS_CHECKED, detectors)).toBeNull();
  });

  it("the REPRESENTATION names match, in both directions", () => {
    const names = readStringArray(read(REPRESENTATIONS), "TEXT_REPRESENTATIONS_DERIVED");
    expect(names.length).toBeGreaterThan(5);
    expect(diff("COVERAGE_REPRESENTATION_VOCABULARY", PSEUDONYM_REPRESENTATIONS, names)).toBeNull();
  });

  it("the host's own scanned classes are DERIVED, not transcribed a third time", () => {
    // `checked` legitimately contains the five host pattern names and
    // `declaredName`. Those come from the patterns that actually run, so a
    // class added to the host's list is admitted without a second edit here.
    for (const klass of SCANNED_CLASSES) expect(COVERAGE_DETECTOR_VOCABULARY).toContain(klass);
    expect(COVERAGE_DETECTOR_VOCABULARY).toContain("declaredName");
  });
});

describe("the vocabularies are what makes the advertised bound a bound", () => {
  it("the worst-case provenance is smaller than the text it describes", () => {
    // `coverage.ts` asserts this at import and throws. Asserted here too, with
    // the numbers visible, because the failure mode it prevents — metadata
    // growing into a channel of its own — is the one this round closed.
    expect(MAX_PROVENANCE_CHARS).toBeLessThan(MAX_TEXT_CHARS);
  });

  it("every vocabulary is non-empty and free of duplicates", () => {
    for (const [label, list] of [
      ["COVERAGE_CLASS_VOCABULARY", COVERAGE_CLASS_VOCABULARY],
      ["COVERAGE_DETECTOR_VOCABULARY", COVERAGE_DETECTOR_VOCABULARY],
      ["COVERAGE_REPRESENTATION_VOCABULARY", COVERAGE_REPRESENTATION_VOCABULARY],
    ] as const) {
      expect(list.length, `${label} is empty — a membership check against nothing admits nothing`).toBeGreaterThan(0);
      expect(new Set(list).size, `${label} has a duplicate`).toBe(list.length);
    }
  });

  it("⛔ no runtime edge from this package to packages/pseudonym", () => {
    // The property the transcription exists to preserve, asserted rather than
    // promised: a value import here is what would let `buildEnvelope`
    // pseudonymise text itself and then vouch for its own output.
    // ⚠ COUNTED, NOT JUST ITERATED. A regex that matches nothing iterates
    // nothing and passes — the vacuous-green shape this repo has shipped
    // before. The total is asserted so a parser that stops working fails.
    let specifiers = 0;
    for (const file of ["build.ts", "coverage.ts", "types.ts", "allowlists.ts", "host-scan.ts", "index.ts"]) {
      const src = fs.readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
      const found = [
        ...src.matchAll(/^import\s+(?!type\b)[\s\S]*?from\s+"([^"]+)";/gm),
        ...src.matchAll(/^export\s+(?!type\b)[\s\S]*?from\s+"([^"]+)";/gm),
      ].map((m) => m[1] ?? "");
      specifiers += found.length;
      for (const specifier of found) {
        expect(specifier, `${file} reaches ${specifier} at RUNTIME`).not.toContain("pseudonym");
      }
    }
    expect(specifiers, "the import scanner matched nothing — it is no longer reading these files").toBeGreaterThan(8);
  });
});
