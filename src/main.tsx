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
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { Workbench } from "./workbench/Workbench";
import { createStudioClient } from "./api/studioClient";
import { createStore } from "./workbench/store";
import { DEFAULT_THEME, THEME_STORAGE_KEY, isStudioTheme, type StudioTheme } from "./workbench/theme";
import { drive } from "./drive";
import { checkFiles } from "./wiring";
import wcClockSpec from "../fixtures/wc-clock.spec.json";

const store = createStore();

/** The Studio server, same origin (the Vite proxy in development). It holds
 * the operator token in memory for this tab only — see `api/studioClient.ts`.
 * Nothing sends a build through it yet: prompts still run the wc-clock demo
 * below, and the indicator's tooltip says so. */
const client = createStudioClient();

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

  const connectionState = useSyncExternalStore(client.subscribe, client.getConnection, client.getConnection);
  const connection = useMemo(
    () => ({ state: connectionState, connect: client.connect, disconnect: client.disconnect }),
    [connectionState],
  );

  const started = useRef(false);
  const onPrompt = useCallback((text: string, turnId: string) => {
    void drive(store, turnId, text, wcClockSpec);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const turnId = store.prompt("Track the statutory consultation window for a contract folder.");
    if (turnId !== null) void drive(store, turnId, "Track the statutory consultation window for a contract folder.", wcClockSpec);
  }, []);

  return (
    <Workbench
      store={store}
      onPrompt={onPrompt}
      onStop={(turnId) => store.abort(turnId)}
      theme={theme}
      onThemeChange={onThemeChange}
      checkFiles={checkFiles}
      connection={connection}
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
