/** Where the workbench meets the real engine: the generator's output turned
 * into a candidate, and the conformance gate turned into a `FileGate`.
 *
 * Out of `main.tsx` so a test can run them. `src/workbench/` is a renderer and
 * imports neither `@codegen` nor `@conformance` (`workbench/types.ts` says
 * why), so the seam lives here, beside the mount point, not inside it. Both
 * functions are pure by construction — `generateSubApp` and
 * `runConformanceGate` reach no server and no disk — which is what lets them
 * run in the browser. `src/__tests__/wiring.test.ts` drives them through the
 * real store. */
import { generateSubApp } from "@codegen/pure";
import { runConformanceGate } from "@conformance/gate";

import type { FileGate } from "./workbench/download";
import type { Candidate, GeneratedFile } from "./workbench/types";

/** The generator's own output, turned into what the panes read. */
export function candidateFrom(spec: unknown): Candidate {
  const generated = generateSubApp(spec);
  // The HOST half. The standalone harness is emitted too and is not part of
  // a candidate a person mounts — but the REGISTRY PATCH is: dropping it made
  // the gate raise FD-X001 ("nothing in this candidate edits
  // server/subapps/registry.ts"), which was my filter talking, not the
  // generator. `GeneratedFileKind` has "patch" precisely so the tree can show
  // the one edit a human still has to apply.
  const host = generated.files.filter((f) => f.kind !== "standalone");
  const report = runConformanceGate({
    files: host.map((f) => ({ path: f.path, contents: f.contents })),
  });
  const plan = generated.plan;
  return {
    manifest: {
      id: plan.id,
      label: plan.label,
      version: plan.version,
      summary: plan.summary ?? "",
      icon: plan.manifestData.icon,
      navSection: plan.manifestData.navSection,
      routePrefix: plan.routePrefix,
      webModuleId: plan.webModuleId,
      capabilities: [...plan.manifestData.capabilities],
      visibleToRoles: [...plan.manifestData.visibleToRoles],
      envVar: plan.envVar,
      tablePrefix: plan.tablePrefix,
    },
    files: host as GeneratedFile[],
    findings: report.findings,
    // ⚠ `rules`, NOT `checks`. A check is a pass over the file set ("7
    // checks"); a rule is what a finding cites ("FD-X001"). Wiring `checks`
    // in here meant `rulesClean` filtered rule-ids out of a list of
    // check-names, never intersected, and reported "7 of 7 rules ran and
    // found nothing" on a candidate with a warning — an arithmetic pass
    // guaranteed by the mismatch rather than by the candidate being clean.
    rulesRun: report.rules,
    notes: generated.warnings,
    spec,
  };
}

/** The conformance gate over whatever file set the workbench hands it — the
 * EDITED files, for "Download candidate" (owner ruling 2026-09-22 (9)). The
 * same pure gate `candidateFrom` runs over Studio's own output, run in the
 * browser; nothing here reaches a server. Its `ok` is the button's pass
 * condition, so it is the gate's own `ok`, never derived here. */
export const checkFiles: FileGate = (files) => {
  const report = runConformanceGate({ files: files.map((f) => ({ path: f.path, contents: f.contents })) });
  return { ok: report.ok, findings: report.findings, rulesRun: report.rules };
};
