/** The run pane says what ran — unseen#72.
 *
 * The scripted session behind the mounted workbench used to end the `tsc`
 * and `mount` steps "succeeded" after printing a line about work it never
 * did: no typecheck runs in the browser and no registry patch is applied
 * there. A green "OK" beside "typecheck against the host surface" is a claim
 * a person reads as a fact. These cases run the real driver against the
 * real generator, gate and store, and pin that a step only reports
 * "succeeded" for work that actually happened. */
import { describe, expect, it } from "vitest";
import { wcClockSpec as tableBackedWcClockSpec } from "@codegen/fixtures/specs";
import wcClockSpec from "../../fixtures/wc-clock.spec.json";
import { drive } from "../drive";
import { logText, type Step } from "../workbench/run";
import { createStore } from "../workbench/store";

const TEXT = "Track the statutory consultation window for a contract folder.";

async function driven(spec: unknown): Promise<readonly Step[]> {
  const store = createStore();
  const turnId = store.prompt(TEXT);
  if (turnId === null) throw new Error("the store refused the prompt");
  await drive(store, turnId, TEXT, spec, { tickMs: 0 });
  const run = store.getState().runs.find((r) => r.turnId === turnId);
  if (run === undefined) throw new Error("no run for the turn");
  return run.steps;
}

function step(steps: readonly Step[], id: string): Step {
  const found = steps.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no step ${id}`);
  return found;
}

describe("⛔ the run pane reports no step as succeeded whose work did not run", () => {
  it("tsc and mount do not run in the browser, so they are skipped, with the reason where the work does run", async () => {
    const steps = await driven(wcClockSpec);
    for (const id of ["tsc", "mount"]) {
      const s = step(steps, id);
      expect(s.status, `${id} reported ${s.status}`).toBe("skipped");
      expect(s.error).toBe("runs in scripts/promote.sh, not in the browser");
    }
    // Nothing claims the typecheck passed or the patch applied.
    expect(logText(step(steps, "mount"))).not.toContain("applies cleanly");
    expect(logText(step(steps, "tsc"))).not.toMatch(/tsc --noEmit/);
  });

  it("the steps that really run still report their real outcome", async () => {
    const steps = await driven(wcClockSpec);
    expect(step(steps, "plan").status).toBe("succeeded");
    expect(step(steps, "emit").status).toBe("succeeded");
    // The gate really runs `runConformanceGate`; wc-clock is clean.
    expect(step(steps, "gate").status).toBe("succeeded");
    expect(logText(step(steps, "gate"))).toMatch(/^\d+ rules over \d+ files/);
  });

  it("the plan step's profile line comes from the spec's plan, not a constant", async () => {
    const mini = logText(step(await driven(wcClockSpec), "plan"));
    expect(mini).toContain('profile: "mini-app"');
    expect(mini).toContain("no schema.ts, no DDL, no migration");

    // A table-backed spec must not be told it is database-free.
    expect(tableBackedWcClockSpec.profile).toBe("table-backed");
    const plan = logText(step(await driven(tableBackedWcClockSpec), "plan"));
    expect(plan).toContain('profile: "table-backed"');
    expect(plan).not.toContain("database-free");
    expect(plan).not.toContain("no schema.ts");
  });
});

describe("a typed request becomes a spec without a model (starter catalogue, ruling 8)", () => {
  it("a plain-language request picks a starter and names the app", async () => {
    const { requestToSpec } = await import("../drive");
    const picked = requestToSpec('Build an app called "Supplier Visits" to log visits and track status');
    expect(picked.source).toBe("starter");
    expect((picked.spec as { id: string }).id).toBe("supplier-visits");
  });

  it("a pasted JSON spec is used as-is (spec-first)", async () => {
    const { requestToSpec } = await import("../drive");
    const picked = requestToSpec(JSON.stringify(wcClockSpec));
    expect(picked.source).toBe("spec");
    expect(picked.spec).toEqual(wcClockSpec);
  });

  it("the emit step names the app's own manifest, not wc-clock's", async () => {
    const { requestToSpec } = await import("../drive");
    const store = createStore();
    const text = 'an app called "Vendor Board" to list contract folders';
    const turnId = store.prompt(text);
    if (turnId === null) throw new Error("refused");
    await drive(store, turnId, text, requestToSpec(text).spec, { tickMs: 0 });
    const run = store.getState().runs.find((r) => r.turnId === turnId);
    const emit = run?.steps.find((s) => s.id === "emit");
    expect(JSON.stringify(emit)).toContain("server/subapps/vendor-board/manifest.ts");
    expect(JSON.stringify(emit)).not.toContain("wc-clock");
  });
});
