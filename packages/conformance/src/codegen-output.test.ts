/** The gate, run against what Studio's generator actually emits.
 *
 * ⭐ WHY THIS TEST IS THE MOST VALUABLE ONE HERE. Every other test in this
 * package judges a fixture written in this package — which proves the
 * rules fire, and proves nothing about whether they fire on real output.
 * These two run the whole gate over `@codegen`'s emitted files, built from
 * its own spec fixtures, and demand ZERO findings. Two packages that
 * derived the same rules from the same contract independently (the gate
 * deliberately shares no code with the generator) agreeing byte for byte
 * on a whole sub-app is the strongest evidence available that neither one
 * has quietly drifted.
 *
 * ⚠ IF THIS GOES RED, READ THE MESSAGE. It distinguishes two very
 * different failures: the generator refusing to generate (a codegen bug —
 * the gate never ran) from the gate refusing what the generator produced
 * (a real disagreement, in which case `docs/FLIGHTDECK-SUBAPP-CONTRACT.md`
 * decides which side is wrong). It is the one test in this package that
 * depends on a sibling package at all. */
import { describe, expect, it } from "vitest";
import { generateSubApp } from "../../codegen/src/generate";
import { minimalSpec, registryFixture, wcClockSpec } from "../../codegen/src/fixtures/specs";
import { runConformanceGate } from "./gate";
import { formatReport } from "./report";

const SPECS = [
  ["the documented floor — manifest, guard, routes, web module", minimalSpec],
  ["a sub-app with tables, two domains and a proposal route", wcClockSpec],
] as const;

describe.each(SPECS)("codegen output: %s", (_name, spec) => {
  it("passes the gate with no findings at all", () => {
    let files;
    try {
      files = generateSubApp(spec, { registrySource: registryFixture }).files;
    } catch (error) {
      throw new Error(
        `@codegen could not generate this spec, so the gate never ran — this is a codegen failure, not a conformance one: ${(error as Error).message}`,
      );
    }

    const report = runConformanceGate({ files: files.map((file) => ({ path: file.path, contents: file.contents })) });
    expect(report.findings, `the gate refuses real generated output:\n${formatReport(report)}`).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
