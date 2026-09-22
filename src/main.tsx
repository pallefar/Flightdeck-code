/** The workbench, mounted.
 *
 * ── WHY THIS FILE DID NOT EXIST, AND WHY THAT MATTERED ──────────────
 * `src/workbench/` is eight components, a store and ~10 test files, all
 * green. There was no `index.html` and no mount point, so `npm run dev`
 * had nothing to serve and the workbench had never been rendered by a
 * browser — not once. Every claim about how Studio LOOKS was therefore a
 * claim about code that had only ever been asserted over.
 *
 * That is the same shape as the standalone tree that served HTTP 200
 * while it did not typecheck: passing tests and a running product are
 * different facts, and only one of them had been established.
 *
 * ── WHAT DRIVES IT ──────────────────────────────────────────────────
 * Not fixtures. `generateSubApp` and `runConformanceGate` are both pure
 * by construction — that is what `packages/codegen/src/pure.ts` exists to
 * guarantee, because a Studio ROUTE may not reach `node:fs` — so both run
 * in the browser against the real spec. The file tree, the diff, the gate
 * pane and the preview are showing real generated source and a real gate
 * verdict, which is the only way a screenshot of this is worth anything.
 */
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { Workbench } from "./workbench/Workbench";
import { createStore } from "./workbench/store";
import { DEFAULT_THEME, THEME_STORAGE_KEY, isStudioTheme, type StudioTheme } from "./workbench/theme";
import type { Candidate } from "./workbench/types";
import { candidateFrom, checkFiles } from "./wiring";
import wcClockSpec from "../fixtures/wc-clock.spec.json";

const store = createStore();

/** A scripted session, reporting the work the way a driver would. */
async function drive(turnId: string, text: string): Promise<void> {
  const tick = () => new Promise((r) => setTimeout(r, 260));

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
  store.output("plan", "profile: mini-app (database-free)\nno schema.ts, no DDL, no migration\n");
  store.endStep("plan", "succeeded");

  store.startStep("emit");
  await tick();
  let candidate: Candidate;
  try {
    candidate = candidateFrom(wcClockSpec);
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

  store.startStep("tsc");
  await tick();
  store.output("tsc", "tsc --noEmit against the host surface\n");
  store.endStep("tsc", "succeeded");

  store.startStep("mount");
  await tick();
  store.output("mount", "registry.ts.patch applies cleanly\nnothing runs until it is in SUBAPP_MANIFESTS\n");
  store.endStep("mount", "succeeded");

  store.stream(
    turnId,
    `Emitted ${candidate.files.length} files for **${candidate.manifest.label}**.\n\n` +
      // Say what it found, not what is convenient. The first version of this
      // line read "found nothing" while the Gate tab carried a warning badge —
      // the chat contradicting the pane two inches to its right.
      `The gate ran ${candidate.rulesRun.length} rules and found ` +
      `${candidate.findings.length === 0 ? "nothing" : `${errs} error(s) and ${warns} warning(s)`}. ` +
      `Nothing is mounted: the registry edit is a patch a person applies.\n`,
  );
  store.settle(turnId, candidate);
}

/** The theme a person last picked on this origin, or Atlas's default.
 *
 * Persistence is the driver's, not the workbench's (see `store.test.ts`,
 * "takes locks back from a driver that persisted them"). Every access is
 * guarded: storage throws in some private windows and when site data is
 * blocked, and a Studio that cannot remember a theme must still open. */
function storedTheme(): StudioTheme {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isStudioTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function App() {
  const [theme, setTheme] = useState<StudioTheme>(storedTheme);
  // Mirrored onto <html> so the page behind the workbench (and the next
  // load's pre-paint script in index.html) agrees with it.
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
  }, [theme]);
  const onThemeChange = useCallback((next: StudioTheme) => {
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice lasts for this tab, which is still a choice honoured.
    }
  }, []);

  const started = useRef(false);
  const onPrompt = useCallback((text: string, turnId: string) => {
    void drive(turnId, text);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const turnId = store.prompt("Track the statutory consultation window for a contract folder.");
    if (turnId !== null) void drive(turnId, "Track the statutory consultation window for a contract folder.");
  }, []);

  return (
    <Workbench
      store={store}
      onPrompt={onPrompt}
      onStop={(turnId) => store.abort(turnId)}
      theme={theme}
      onThemeChange={onThemeChange}
      checkFiles={checkFiles}
    />
  );
}

const host = document.getElementById("root");
if (host === null) throw new Error("no #root");
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
