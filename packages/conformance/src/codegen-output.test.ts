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
import { verifySubApp } from "./verify";

const SPECS = [
  ["the documented floor — manifest, guard, routes, web module", minimalSpec],
  ["a sub-app with tables, two domains and a proposal route", wcClockSpec],
] as const;

describe.each(SPECS)("codegen output: %s", (_name, spec) => {
  it("passes the gate with no findings at all", () => {
    let files;
    try {
      // ⭐ THE HOST HALF, and the filter is the point rather than a nuisance.
      // Every rule this gate applies is a rule about the HOST repository —
      // FD-I005 literally reads "it would be written into the host repo and
      // never loaded". The standalone harness is never written to a host
      // checkout (`planWrites` defaults to the host target and drops it), so
      // gating it with host rules would be asking whether a file that never
      // arrives is loaded once it arrives. The harness has its own checks:
      // `codegen/__tests__/standalone.test.ts` for its shape and
      // `scripts/standalone-smoke.sh` for whether it actually runs.
      const generated = generateSubApp(spec, { registrySource: registryFixture });
      files = generated.files.filter((file) => file.kind !== "standalone");
      // Guard the premise: if the harness stopped being emitted this filter
      // would be a no-op and nobody would notice.
      expect(generated.files.length).toBeGreaterThan(files.length);
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

/** ⭐ AND THE SAME OUTPUT, COMPILED AND MOUNTED.
 *
 * ⚠ THIS TEST DOES NOT ASSERT ZERO FINDINGS, and saying why is the point
 * of it. At the time it was written the compiler stage refused BOTH specs
 * above — the ones the static gate passes clean — for defects that are
 * real and that live in `@codegen`, not here:
 *
 *   • `caps.readContracts().find(...)` with no `await`. `.find` on a
 *     Promise is `undefined`, so the 404 below it fires on every request,
 *     always, silently.
 *   • two implicit `any` parameters and one possibly-undefined index,
 *     which are errors under the strictness this repo already compiles at.
 *   • `headers: undefined` passed to `fetch`, which `exactOptionalPropertyTypes`
 *     rejects.
 *
 * Pinning that list here would put a red test in somebody else's package
 * and would go stale the moment they fix one. What IS asserted is that
 * the new stages RUN on real generated output and that everything they
 * say is actionable — a finding that named a file the candidate does not
 * contain, or carried a message nobody could act on, would be this
 * package's bug and would fail here. */
describe.each(SPECS)("verifying codegen output: %s", (_name, spec) => {
  it("compiles the real thing and reports only things a person can act on", async () => {
    const files = generateSubApp(spec, { registrySource: registryFixture })
      .files.filter((file) => file.kind !== "standalone")
      .map((file) => ({
      path: file.path,
      contents: file.contents,
    }));
    const paths = new Set(files.map((file) => file.path));

    const report = await verifySubApp({ files }, { repoRoot: process.cwd() });

    expect(report.stages.find((stage) => stage.name === "static")?.ok).toBe(true);
    expect(report.stages.find((stage) => stage.name === "typecheck")?.ran).toBe(true);

    for (const finding of report.findings) {
      expect(paths.has(finding.file) || finding.file === "(candidate)", `finding names ${finding.file}, which is not in the candidate`).toBe(true);
      expect(finding.message.length).toBeGreaterThan(40);
      expect(finding.message).not.toContain("undefined (TS");
    }
    // Whatever the verdict, the compiler's own words are kept.
    expect(report.stages.find((stage) => stage.name === "typecheck")?.output.length).toBeGreaterThan(0);
  }, 120_000);
});
