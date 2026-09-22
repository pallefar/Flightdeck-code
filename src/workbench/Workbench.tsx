/** The workbench shell — the only component that reads the store.
 *
 * ── WHY EXACTLY ONE COMPONENT SUBSCRIBES ────────────────────────────
 * Every pane under this one takes plain props and returns markup. That is
 * what makes them testable without a store, a provider or a DOM: render
 * `GatePane` with a candidate and assert on the output. The reference
 * implementation lets each component subscribe to its own atoms, which is
 * a good shape when panes are independent — but here the diff pane is a
 * function of two rounds, the preview of a round AND the enable layers,
 * and the tree of a round AND the change set AND the findings. Those
 * derivations have to agree with each other, and the cheapest way to
 * guarantee that is for one component to derive them once and hand them
 * down.
 *
 * `useSyncExternalStore` is the whole subscription. The store returns a
 * frozen snapshot whose identity changes only on a real change, which is
 * the contract that hook wants — see `store.ts` for why the no-op case is
 * load-bearing rather than an optimisation. */
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { TabIndicator } from "../motion/TabIndicator";
import { usePanelSwap } from "../motion/useMotion";
import { ChatPane } from "./components/ChatPane";
import { DiffPane } from "./components/DiffPane";
import { FileTreePane } from "./components/FileTreePane";
import { GatePane } from "./components/GatePane";
import { PreviewPane } from "./components/PreviewPane";
import { RunPane } from "./components/RunPane";
import { ThemeToggle } from "./components/ThemeToggle";
import { buildPreview } from "./preview/state";
import {
  activeRun,
  beingWritten,
  changeByPath,
  changeSet,
  currentCandidate,
  currentRound,
  draftFor,
  draftStates,
  edits,
  fileAt,
  findingsByPath,
  gateSummary,
  generatedFileAt,
  progress,
  treeNodes,
  visibleRun,
} from "./selectors";
import type { WorkbenchStore } from "./store";
import { DEFAULT_THEME, WORKBENCH_CSS, type StudioTheme } from "./theme";
import type { WorkbenchView } from "./types";

export interface WorkbenchProps {
  readonly store: WorkbenchStore;
  /** Called when a person submits a prompt. The workbench does not own the
   * model: it opens the round, hands the caller the turn id, and lets the
   * caller stream into it and settle it. That keeps every transport
   * decision — fetch, SSE, a test double — outside the UI. */
  readonly onPrompt: (text: string, turnId: string) => void;
  /** Called when a person presses stop, with the turn to cancel. The
   * driver owns the transport, so it owns the cancel: abort the fetch,
   * kill the child process, then call `store.abort(turnId)`.
   *
   * ⭐ When it is NOT supplied the workbench aborts the round itself. That
   * is not a no-op — `stream` and `settle` refuse a turn that is no longer
   * streaming, so a driver that cannot be cancelled finds its output
   * dropped rather than landing in a round the person already stopped. A
   * stop button that leaves the round running would be the one lie this
   * pane cannot afford. */
  readonly onStop?: (turnId: string) => void;
  /** Light or dark. Defaults to light, as Atlas does. */
  readonly theme?: StudioTheme;
  /** Called with the theme a person picked. Remembering it is the driver's
   * job, like every other persistence decision. When it is NOT supplied no
   * toggle is drawn — a switch that does nothing would be worse than none. */
  readonly onThemeChange?: ((theme: StudioTheme) => void) | undefined;
}

export function Workbench({ store, onPrompt, onStop, theme = DEFAULT_THEME, onThemeChange }: WorkbenchProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  const round = currentRound(state);
  const candidate = currentCandidate(state);
  const summary = useMemo(() => gateSummary(candidate), [candidate]);
  const findings = useMemo(() => findingsByPath(candidate), [candidate]);
  const set = changeSet(state);

  // A stable getter, so the adapter reads the CURRENT layers on every
  // request rather than the ones captured when the preview was built —
  // contract §5.2, never cache a boolean.
  const layers = useCallback(() => store.getState().enable, [store]);
  const preview = useMemo(
    () => buildPreview({ candidate, layers }),
    [candidate, layers],
  );

  const handlePrompt = useCallback(
    (text: string) => {
      const turnId = store.prompt(text);
      if (turnId !== null) onPrompt(text, turnId);
    },
    [store, onPrompt],
  );

  const handleStop = useCallback(() => {
    const turnId = store.requestAbort();
    if (turnId === null) return;
    if (onStop === undefined) store.abort(turnId);
    else onStop(turnId);
  }, [store, onStop]);

  // Atlas's panel motion: a new view swaps in, another round re-enters.
  // Decoration only; with motion off it writes nothing (src/motion/).
  const bodyRef = useRef<HTMLDivElement>(null);
  usePanelSwap(bodyRef, state.view, state.selectedRoundId);

  const run = visibleRun(state);
  const running = activeRun(state);
  const steps = progress(state);
  const edited = edits(state);
  const latest = state.rounds[state.rounds.length - 1] ?? null;
  const historical = latest !== null && latest.id !== state.selectedRoundId;

  // `count` and `tone` are explicitly `| undefined` rather than optional:
  // under `exactOptionalPropertyTypes` an absent property and a present
  // `undefined` one are different types, and these are computed.
  const tabs: ReadonlyArray<{
    id: WorkbenchView;
    label: string;
    count: number | undefined;
    tone?: "error" | "warn";
  }> = [
    {
      id: "run",
      // The badge is the number a person needs first: how many steps
      // broke, or — when none did — how many there are.
      label: "Run",
      count: steps.failed > 0 ? steps.failed : steps.total || undefined,
      ...(steps.failed > 0 ? { tone: "error" as const } : {}),
    },
    { id: "files", label: "Files", count: candidate?.files.length },
    { id: "diff", label: "Diff", count: set === null ? undefined : set.changes.filter((c) => c.kind !== "unchanged").length },
    { id: "preview", label: "Preview", count: undefined },
    {
      id: "gate",
      label: "Gate",
      count: summary.errors + summary.warnings || undefined,
      ...(summary.errors > 0 ? { tone: "error" as const } : summary.warnings > 0 ? { tone: "warn" as const } : {}),
    },
  ];

  return (
    <div className="fd-wb" data-theme={theme}>
      <style>{WORKBENCH_CSS}</style>

      <ChatPane
        turns={state.turns}
        rounds={state.rounds}
        selectedRoundId={state.selectedRoundId}
        busy={state.busy}
        onSubmit={handlePrompt}
        onSelectRound={(id) => store.selectRound(id)}
        run={running}
        onStop={handleStop}
      />

      <main className="fd-main">
        <div className="fd-tabs">
          {/* The tablist holds only tabs; the counts and the theme switch
              beside it are not views and are not announced as if they were. */}
          <div className="fd-tabs__group" role="tablist" aria-label="Workbench views">
            {/* Atlas's sliding indicator. Hidden and aria-hidden at rest, so
                the tablist still holds only the five tabs. */}
            <TabIndicator activeKey={state.view} />
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className="fd-tab"
                aria-selected={state.view === tab.id}
                onClick={() => store.setView(tab.id)}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`fd-tab__count${tab.tone === "error" ? " fd-tab__count--error" : tab.tone === "warn" ? " fd-tab__count--warn" : ""}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <span className="fd-tabs__spacer" />
          {/* The aggregate the tree's dots answer one file at a time: is
              there anything of mine in this round, and is any of it stuck
              waiting for me? */}
          {edited.conflicted > 0 && (
            <span className="fd-tabs__edits fd-tabs__edits--conflict">
              {edited.conflicted} conflict{edited.conflicted === 1 ? "" : "s"}
            </span>
          )}
          {edited.dirty > 0 && <span className="fd-tabs__edits">{edited.dirty} unsaved</span>}
          {edited.saved > 0 && <span className="fd-tabs__edits">{edited.saved} edited</span>}
          {edited.locked > 0 && <span className="fd-tabs__edits">{edited.locked} locked</span>}
          {round !== null && (
            <span className="fd-tabs__id">
              round #{round.ordinal} · {round.candidate.manifest.id} · {round.candidate.manifest.envVar}
            </span>
          )}
          {onThemeChange !== undefined && <ThemeToggle theme={theme} onChange={onThemeChange} />}
        </div>

        <div className="fd-body" ref={bodyRef}>
          {/* Before the candidate check: the run pane is the only one that
              is useful while there is no candidate yet, which is exactly
              when a person most wants to know what is happening. */}
          {state.view === "run" ? (
            <RunPane run={run} busy={state.busy && running !== null && running === run} onStop={handleStop} />
          ) : candidate === null ? (
            <div className="fd-empty">
              <strong>No sub-app yet.</strong>
              <span>
                Describe what you want in the chat. Studio plans it against the sub-app contract, generates the
                source, and runs the conformance gate before anything reaches this pane.
              </span>
            </div>
          ) : state.view === "files" ? (
            <FileTreePane
              nodes={treeNodes(state)}
              selectedPath={state.selectedPath}
              changes={changeByPath(set)}
              findings={findings}
              collapsedDirs={state.collapsedDirs}
              focusedRule={state.focusedRule}
              file={fileAt(state, state.selectedPath)}
              onSelect={(path) => store.selectFile(path)}
              onToggle={(path) => store.toggleDir(path)}
              draftStates={draftStates(state)}
              locks={state.locks}
              editor={{
                generated: generatedFileAt(state, state.selectedPath),
                draft: draftFor(state, state.selectedPath),
                locked: state.selectedPath !== null && state.locks.has(state.selectedPath),
                beingWritten: beingWritten(state),
                historical,
                onEdit: (path, text) => store.editFile(path, text),
                onSave: (path) => store.saveFile(path),
                onRevert: (path) => store.revertFile(path),
                onRestore: (path) => store.restoreGenerated(path),
                onResolve: (path, choice) => store.resolveConflict(path, choice),
                onToggleLock: (path) => store.toggleLock(path),
              }}
            />
          ) : state.view === "diff" ? (
            <DiffPane set={set} selectedPath={state.selectedPath} onSelect={(path) => store.selectFile(path)} />
          ) : state.view === "preview" ? (
            <PreviewPane
              state={preview}
              enable={state.enable}
              onEnable={(patch) => store.setEnable(patch)}
              onRevealFile={(path) => store.revealFile(path)}
            />
          ) : (
            <GatePane
              candidate={candidate}
              summary={summary}
              filter={state.severityFilter}
              focusedRule={state.focusedRule}
              onFilter={(filter) => store.setSeverityFilter(filter)}
              onFocusRule={(rule) => store.focusRule(rule)}
              onReveal={(path) => store.revealFile(path)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
