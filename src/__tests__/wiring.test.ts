/** The workbench's wiring to the REAL gate — owner ruling 2026-09-22 (9).
 *
 * `download.test.ts` and `components.test.tsx` pin the enable rule against
 * fake gates. What decides the verdict in the shipped app is the adapter in
 * `src/wiring.ts` that turns `runConformanceGate` into a `FileGate`, and until
 * it moved out of `main.tsx` no test ran it: changing it to
 * `return { ok: true, … }` left the whole suite green, so "enabled only when
 * the conformance gate passes on the edited files" rested on one manual
 * headless-browser check. These cases run the real generator and the real
 * gate through the real store, and fail on exactly that change. */
import { describe, expect, it } from "vitest";
import { runConformanceGate } from "@conformance/gate";
import wcClockSpec from "../../fixtures/wc-clock.spec.json";
import { candidateFrom, checkFiles } from "../wiring";
import { downloadReadiness, runFileGate } from "../workbench/download";
import { currentCandidate, edits } from "../workbench/selectors";
import { createStore } from "../workbench/store";

const MANIFEST = "server/subapps/wc-clock/manifest.ts";

function settled() {
  const store = createStore();
  store.settle(store.prompt("build it") ?? "", candidateFrom(wcClockSpec));
  return store;
}

function manifestText(store: ReturnType<typeof settled>): string {
  const file = currentCandidate(store.getState())?.files.find((f) => f.path === MANIFEST);
  if (file === undefined) throw new Error(`the candidate has no ${MANIFEST}`);
  return file.contents;
}

/** Save an edit to the manifest, the way a person does in the editor. */
function saveManifest(store: ReturnType<typeof settled>, edit: (text: string) => string): void {
  const before = manifestText(store);
  const after = edit(before);
  if (after === before) throw new Error("the manifest edit did not apply");
  store.editFile(MANIFEST, after);
  store.saveFile(MANIFEST);
}

/** Exactly what `Workbench.tsx` computes for the button. */
function readinessOf(store: ReturnType<typeof settled>) {
  const state = store.getState();
  const current = currentCandidate(state);
  return downloadReadiness({
    candidate: current,
    edits: edits(state),
    verdict: current === null ? null : runFileGate(checkFiles, current.files),
  });
}

describe("⭐ the shipped gate adapter decides the Download button", () => {
  it("the untouched candidate passes the real gate, and the button is ready", () => {
    const store = settled();
    const current = currentCandidate(store.getState());
    expect(current).not.toBeNull();
    expect(checkFiles(current?.files ?? []).ok).toBe(true);
    expect(readinessOf(store).ready).toBe(true);
  });

  it("⛔ a saved manifest edit the host would refuse at boot fails it — navSection outside the host's five", () => {
    const store = settled();
    saveManifest(store, (text) => text.replace(`navSection: "Contract pipeline"`, `navSection: "Mini apps"`));

    const verdict = checkFiles(currentCandidate(store.getState())?.files ?? []);
    expect(verdict.ok).toBe(false);
    expect(verdict.findings.some((f) => f.rule === "FD-M003" && f.file === MANIFEST && f.severity === "error")).toBe(true);

    const readiness = readinessOf(store);
    expect(readiness.ready).toBe(false);
    if (readiness.ready) return;
    expect(readiness.reason).toContain("conformance gate fails on the edited files");
    expect(readiness.reason).toMatch(new RegExp(`FD-M003 ${MANIFEST.replace(/[./]/g, "\\$&")}:\\d+ — `));
  });

  it("⛔ and so does a saved edit that adds OS-04 contributions (FD-M008)", () => {
    const store = settled();
    saveManifest(store, (text) =>
      text.replace(/\n};\s*$/, `\n  contributions: { stateFlags: () => ({ esign: { enabled: true } }) },\n};\n`),
    );
    const readiness = readinessOf(store);
    expect(readiness.ready).toBe(false);
    if (readiness.ready) return;
    expect(readiness.reason).toContain("FD-M008");
  });

  it("reports the gate's RULES as rulesRun, not its checks", () => {
    const files = currentCandidate(settled().getState())?.files ?? [];
    const report = runConformanceGate({ files: files.map((f) => ({ path: f.path, contents: f.contents })) });
    const verdict = checkFiles(files);
    expect(verdict.rulesRun).toEqual(report.rules);
    expect(verdict.rulesRun).not.toEqual(report.checks);
    expect(verdict.findings).toEqual(report.findings);
  });

  it("the candidate the workbench is handed carries rules, not checks, too", () => {
    const candidate = candidateFrom(wcClockSpec);
    expect(candidate.rulesRun).toContain("FD-M003");
    expect(candidate.rulesRun).not.toContain("manifest");
  });
});
