/** The scripted session `main.tsx` mounts the workbench with, out of
 * `main.tsx` so a test can drive it through the real store —
 * `src/__tests__/drive.test.ts`. `main.tsx` renders on import, so nothing
 * inside it can be run by a test; `wiring.ts` moved out for the same reason. */
import { MINI_APP_FLOOR, planSubApp, type SubAppPlan } from "@codegen/pure";

import type { WorkbenchStore } from "./workbench/store";
import type { Candidate } from "./workbench/types";
import { candidateFrom } from "./wiring";

/** Where the two steps this driver does NOT run actually run. Neither a
 * typecheck against the host nor applying the registry patch can happen in
 * a browser: `scripts/promote.sh` does both (its `generate-and-mount` stack
 * and the host's own `scripts/gate.sh`). The steps stay in the plan so a
 * person sees the pipeline is longer than what ran here, and they end
 * `skipped` with this reason — never `succeeded`, which is a claim that the
 * work happened. */
export const NOT_RUN_IN_BROWSER = "runs in scripts/promote.sh, not in the browser";

/** The plan step's output, read off the generator's own plan. It used to be
 * a constant that called every spec "mini-app (database-free)" — including a
 * `table-backed` one, whose schema.ts runs DDL on every boot. */
export function profileLines(plan: SubAppPlan): string {
  if (plan.profile === "mini-app") {
    return `profile: "mini-app" — database-free\n${MINI_APP_FLOOR}\n`;
  }
  const tables = plan.tables.map((t) => t.full).join(", ");
  return (
    `profile: "${plan.profile}" — NOT the mini-app path\n` +
    `ships a schema.ts whose DDL runs on every boot in every workspace (${plan.tables.length} ` +
    `${plan.tables.length === 1 ? "table" : "tables"}: ${tables})\n`
  );
}

export interface DriveOptions {
  /** Pause between steps, so a person can watch the run pane fill. `0` in tests. */
  readonly tickMs?: number;
}

/** A scripted session, reporting the work the way a driver would. */
export async function drive(
  store: WorkbenchStore,
  turnId: string,
  text: string,
  spec: unknown,
  options: DriveOptions = {},
): Promise<void> {
  const tickMs = options.tickMs ?? 260;
  const tick = () => new Promise((r) => setTimeout(r, tickMs));

  store.plan(turnId, [
    { id: "plan", label: "plan against the contract" },
    { id: "emit", label: "emit source", writes: ["server/subapps/wc-clock/manifest.ts"] },
    { id: "gate", label: "conformance gate" },
    { id: "tsc", label: "typecheck against the host surface" },
    { id: "mount", label: "mount probe" },
  ]);

  store.stream(turnId, `Reading "${text}" as a mini-app spec.\n\n`);

  store.startStep("plan");
  await tick();
  let plan: SubAppPlan;
  try {
    plan = planSubApp(spec);
  } catch (error) {
    store.output("plan", String(error), "err");
    store.endStep("plan", "failed", { error: String(error), exitCode: 1 });
    store.fail(turnId, "the planner refused this spec");
    return;
  }
  store.output("plan", profileLines(plan));
  store.endStep("plan", "succeeded");

  store.startStep("emit");
  await tick();
  let candidate: Candidate;
  try {
    candidate = candidateFrom(spec);
  } catch (error) {
    store.output("emit", String(error), "err");
    store.endStep("emit", "failed", { error: String(error), exitCode: 1 });
    store.fail(turnId, "the generator refused this spec");
    return;
  }
  for (const file of candidate.files) store.output("emit", `wrote ${file.path}\n`);
  store.endStep("emit", "succeeded");

  store.startStep("gate");
  await tick();
  const errs = candidate.findings.filter((f) => f.severity === "error").length;
  const warns = candidate.findings.length - errs;
  store.output("gate", `${candidate.rulesRun.length} rules over ${candidate.files.length} files\n`);
  store.output(
    "gate",
    candidate.findings.length === 0 ? "no findings\n" : `${errs} error(s), ${warns} warning(s)\n`,
    errs === 0 ? "out" : "err",
  );
  store.endStep("gate", errs === 0 ? "succeeded" : "failed");

  // Not started: nothing ran. `skipped` is the store's "the pipeline
  // decided" state (run.ts), rendered grey with the reason under it.
  store.endStep("tsc", "skipped", { error: NOT_RUN_IN_BROWSER });
  store.endStep("mount", "skipped", { error: NOT_RUN_IN_BROWSER });

  store.stream(
    turnId,
    // Plain text: the chat draws no markdown (unseen#88), and the round
    // chip under this turn already carries the label.
    `Emitted ${candidate.files.length} files for ${candidate.manifest.label}.\n\n` +
      // Say what it found, not what is convenient. The first version of this
      // line read "found nothing" while the Gate tab carried a warning badge —
      // the chat contradicting the pane two inches to its right.
      `The gate ran ${candidate.rulesRun.length} rules and found ` +
      `${candidate.findings.length === 0 ? "nothing" : `${errs} error(s) and ${warns} warning(s)`}. ` +
      `Nothing is mounted: the registry edit is a patch a person applies.\n`,
  );
  store.settle(turnId, candidate);
}
