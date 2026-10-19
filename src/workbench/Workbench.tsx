/** One authoritative store subscription; panes remain plain-prop renderers.
 * View navigation retains mounted editors/previews rather than reparenting
 * or losing their local state. The shell alone owns transport callbacks. */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArchitectureTour } from "./components/ArchitectureTour";
import { ChatPane } from "./components/ChatPane";
import { DiffPane } from "./components/DiffPane";
import { FileTreePane } from "./components/FileTreePane";
import { GatePane } from "./components/GatePane";
import { PreviewPane } from "./components/PreviewPane";
import { RunPane } from "./components/RunPane";
import { RemovedSourceConflicts } from "./components/RemovedSourceConflicts";
import { buildPreview } from "./preview/state";
import { activeRun, beingWritten, changeByPath, changeSet, currentCandidate, currentRound, draftFor, draftStates, edits, fileAt, findingsByPath, gateSummary, generatedFileAt, treeNodes, visibleRun } from "./selectors";
import { runProgress } from "./run";
import type { WorkbenchStore } from "./store";
import { WORKBENCH_CSS } from "./theme";
import type { WorkbenchView } from "./types";
import { buildWalkthrough } from "./walkthrough";
import { TourPlayback } from "./tour-playback";
import { usePresentationClock } from "./usePresentationClock";
import { useVoice } from "../voice";

export interface WorkbenchProps {
  readonly store: WorkbenchStore;
  /** The existing guarded driver owns transport, model and settlement. */
  readonly onPrompt: (text: string, turnId: string) => void;
  /** Without a cancellable driver, abort the store and drop late results. */
  readonly onStop?: (turnId: string) => void;
  /** Default false. Keep the chat DOM/draft, hide its column and tab stops
   * when the Studio shell owns the unified conversation. */
  readonly hideChat?: boolean;
  /** Accepted latest candidate only; a same-round view/edit change never replays. */
  readonly buildReveal?: boolean;
  /** Retained hidden parent panes pause timers and narration. Default true. */
  readonly active?: boolean;
  /** Optional explicitly enabled host voice. Never receives source or prompt text. */
  readonly onNarrate?: (text: string) => void;
  readonly onStopNarration?: () => void;
}

export function Workbench({ store, onPrompt, onStop, hideChat = false, buildReveal = false, active = true, onNarrate, onStopNarration }: WorkbenchProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [sourceFocused, setSourceFocused] = useState(false);
  const focusSource = sourceFocused && state.view === "files";
  const id = useId();
  const visited = useRef(new Set<WorkbenchView>());
  visited.current.add(state.view);
  const round = currentRound(state);
  const candidate = currentCandidate(state);
  const root = useRef<HTMLDivElement>(null);
  // Focus hides the retained presentation, not the working document. Treat
  // its clock as inactive so a new receipt is deferred until focus exits.
  const clock = usePresentationClock(root, active && !focusSource);
  const sharedVoice = useVoice();
  const voice = useRef({ onNarrate, onStopNarration });
  voice.current = { onNarrate: onNarrate ?? (sharedVoice.enabled ? sharedVoice.speak : undefined), onStopNarration: onStopNarration ?? sharedVoice.stop };
  const plan = useMemo(() => candidate === null ? null : buildWalkthrough(candidate), [candidate]);
  const playback = useMemo(() => new TourPlayback({
    navigate: step => {
      const current = store.getState();
      if (current.selectedRoundId !== playback.getState().roundId || !activeRef.current) return false;
      // A user typing or manually choosing another pane has priority over
      // timed guided navigation. Never steal an editor's focus/selection.
      const target = document.activeElement;
      if (target instanceof HTMLElement && root.current?.contains(target) && target.matches("textarea, input, select, [contenteditable=true]")) { playback.pause(); return false; }
      if (step.view === "files" && step.paths[0] !== undefined) store.revealFile(step.paths[0]);
      else store.setView(step.view);
      return true;
    },
    narrate: text => {
      if (!activeRef.current || store.getState().selectedRoundId !== playback.getState().roundId || voice.current.onNarrate === undefined) return false;
      voice.current.onNarrate(text);
      return true;
    },
    stopNarration: () => voice.current.onStopNarration?.(),
  }), [store]);
  const activeRef = useRef(clock.active);
  activeRef.current = clock.active;
  const tour = useSyncExternalStore(playback.subscribe, playback.getState, playback.getState);
  const latestRoundId = state.rounds[state.rounds.length - 1]?.id ?? null;
  useEffect(() => { playback.sync({ roundId: round?.id ?? null, latestRoundId, plan, buildReveal, active: clock.active, motion: clock.motion }); }, [playback, round?.id, latestRoundId, plan, buildReveal, clock.active, clock.motion]);
  useEffect(() => () => playback.dispose(), [playback]);
  const summary = useMemo(() => gateSummary(candidate), [candidate]);
  const findings = useMemo(() => findingsByPath(candidate), [candidate]);
  const set = changeSet(state);
  const layers = useCallback(() => store.getState().enable, [store]);
  const preview = useMemo(() => buildPreview({ candidate, layers }), [candidate, layers]);
  const handlePrompt = useCallback((text: string) => {
    const turnId = store.prompt(text);
    if (turnId !== null) onPrompt(text, turnId);
  }, [store, onPrompt]);
  const handleStop = useCallback(() => {
    const turnId = store.requestAbort();
    if (turnId === null) return;
    if (onStop === undefined) store.abort(turnId);
    else onStop(turnId);
  }, [store, onStop]);
  const latest = state.rounds[state.rounds.length - 1] ?? null;
  const historical = latest !== null && latest.id !== state.selectedRoundId;
  // Removed conflicts are decisions outside the effective source inventory.
  // Never expose latest private copies in an earlier round or another context.
  const removedConflicts = historical || round === null ? [] : [...state.drafts.values()].filter(draft => draft.roundId === round.id && draft.conflict?.kind === "removed" && !round.candidate.files.some(file => file.path === draft.path));
  const keptRemoved = historical || round === null ? [] : [...state.drafts.values()].filter(draft => draft.roundId === round.id && draft.conflict === null && draft.saved !== null && !round.candidate.files.some(file => file.path === draft.path));
  const restoreSource = (path: string) => {
    const current = store.getState(), draft = state.drafts.get(path);
    if (draft === undefined || current.rounds.at(-1) !== round || current.selectedRoundId !== round?.id || current.drafts.get(path) !== draft || draft.roundId !== round?.id) return;
    store.restoreGenerated(path);
    if (current.selectedPath === path && fileAt(store.getState(), path) === null) store.selectFile(currentCandidate(store.getState())?.files[0]?.path ?? null);
  };
  // A refused/failed follow-up has no candidate round to select. Keep the
  // selected source artifact, but surface the latest actual attempt's
  // diagnostics. Explicit historical selection retains its own linkage.
  const run = historical ? visibleRun(state) : state.runs[state.runs.length - 1] ?? visibleRun(state);
  const running = activeRun(state);
  const steps = runProgress(run);
  const edited = edits(state);
  const tabs: ReadonlyArray<{ id: WorkbenchView; label: string; accessible: string; count: number | undefined; tone?: "error" | "warn" }> = [
    { id: "files", label: "Sources", accessible: "Files", count: candidate?.files.length },
    { id: "diff", label: "Changes", accessible: "Diff", count: set?.isFirstRound ? undefined : set?.changes.filter(c => c.kind !== "unchanged").length },
    { id: "preview", label: "Preview", accessible: "Preview", count: undefined },
    { id: "gate", label: "Checks", accessible: "Gate", count: summary.errors + summary.warnings || undefined, ...(summary.errors > 0 ? { tone: "error" as const } : summary.warnings > 0 ? { tone: "warn" as const } : {}) },
    ...((run !== null && run.steps.length > 0) || state.view === "run" ? [{ id: "run" as const, label: "Execution", accessible: "Run", count: steps.failed > 0 ? steps.failed : steps.total || undefined, ...(steps.failed > 0 ? { tone: "error" as const } : {}) }] : []),
  ];
  const guidedStep = active && tour.roundId === round?.id && tour.mode === "walkthrough" ? plan?.steps[tour.step] ?? null : null;
  const highlightedStep = guidedStep !== null && state.view === guidedStep.view && (guidedStep.view !== "files" || (state.selectedPath !== null && guidedStep.paths.includes(state.selectedPath))) ? guidedStep.kind : undefined;

  const panel = (view: WorkbenchView) => {
    if (view === "run") return <RunPane run={run} busy={state.busy && running !== null && running === run} onStop={handleStop} />;
    if (candidate === null) return <div className="fd-empty"><span className="fd-empty__mark" aria-hidden="true">〈 / 〉</span><strong>Your sub-app workspace</strong><span>Describe a sub-app in the conversation. Sources, changes, a scriptless preview and actual check results appear here when a candidate arrives.</span><span className="fd-ledger__note">No candidate · nothing deployed</span></div>;
    if (view === "files") return <FileTreePane focused={focusSource} onExitFocus={() => setSourceFocused(false)} receivedPaths={active && tour.roundId === round?.id && tour.mode === "assembly" ? new Set(plan?.groups[tour.revealedGroups]?.paths ?? []) : null} nodes={treeNodes(state)} files={candidate.files} selectedPath={state.selectedPath} changes={changeByPath(set)} findings={findings} collapsedDirs={state.collapsedDirs} focusedRule={state.focusedRule} file={fileAt(state, state.selectedPath)} onSelect={path => store.selectFile(path)} onToggle={path => store.toggleDir(path)} draftStates={draftStates(state)} locks={state.locks} editorFor={path => ({ generated: generatedFileAt(state, path), draft: historical ? null : draftFor(state, path), locked: state.locks.has(path), beingWritten: beingWritten(state), historical, onEdit: (sourcePath, text) => store.editFile(sourcePath, text), onSave: sourcePath => store.saveFile(sourcePath), onRevert: sourcePath => store.revertFile(sourcePath), onRestore: restoreSource, onResolve: (sourcePath, choice) => store.resolveConflict(sourcePath, choice), onToggleLock: sourcePath => store.toggleLock(sourcePath) })} />;
    if (view === "diff") return <DiffPane set={set} selectedPath={state.selectedPath} onSelect={path => store.selectFile(path)} />;
    if (view === "preview") return <PreviewPane state={preview} enable={state.enable} onEnable={patch => store.setEnable(patch)} onRevealFile={path => store.revealFile(path)} highlightedSectionId={active && tour.roundId === round?.id && tour.mode === "walkthrough" ? plan?.steps[tour.step]?.sectionId ?? null : null} />;
    return <GatePane sourceEdited={!historical && (edited.saved > 0 || edited.dirty > 0 || edited.conflicted > 0)} candidate={candidate} summary={summary} filter={state.severityFilter} focusedRule={state.focusedRule} onFilter={filter => store.setSeverityFilter(filter)} onFocusRule={rule => store.focusRule(rule)} onReveal={path => store.revealFile(path)} />;
  };

  return <div ref={root} className="fd-wb" data-external-chat={hideChat} data-source-focus={focusSource} data-tour-step={highlightedStep} onPointerDownCapture={event => { if (event.target instanceof HTMLElement && !event.target.closest(".fd-tour")) playback.pause(); }} onKeyDownCapture={event => { if (event.target instanceof HTMLElement && !event.target.closest(".fd-tour")) playback.pause(); }}>
    <style>{WORKBENCH_CSS}</style>
    <div className="fd-chat-slot" hidden={hideChat} inert={hideChat}><ChatPane turns={state.turns} rounds={state.rounds} selectedRoundId={state.selectedRoundId} busy={state.busy} onSubmit={handlePrompt} onSelectRound={roundId => store.selectRound(roundId)} run={running} onStop={handleStop} /></div>
    <section className="fd-main" aria-label="Sub-app workspace">
      <header className="fd-artifact">
        <span className="fd-artifact__mark" aria-hidden="true">〈/〉</span>
        <div className="fd-artifact__identity"><span className="fd-artifact__eyebrow">SUB-APP · CODE / INSPECT</span><h2 className="fd-artifact__name">{candidate?.manifest.label ?? "New sub-app"}</h2></div>
        <div className="fd-artifact__facts">{round !== null && <span className="mono">{candidate?.manifest.id} · v{candidate?.manifest.version} · round #{round.ordinal}</span>}<span className="fd-artifact__draft">{historical ? "Historical round · read only" : "Draft · not deployed"}</span></div>
      </header>
      <div className="fd-command-bar">
      <div className="fd-tabs" role="tablist" aria-label="Workbench views">
        {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`${id}-tab-${tab.id}`} className="fd-tab" aria-label={tab.accessible} aria-controls={`${id}-panel-${tab.id}`} aria-selected={state.view === tab.id} tabIndex={state.view === tab.id ? 0 : -1} onClick={() => store.setView(tab.id)} onKeyDown={event => {
          const current = tabs.findIndex(item => item.id === tab.id);
          const next = event.key === "ArrowRight" ? (current + 1) % tabs.length : event.key === "ArrowLeft" ? (current + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
          if (next === null) return;
          event.preventDefault();
          const target = tabs[next];
          if (target === undefined) return;
          store.setView(target.id);
          document.getElementById(`${id}-tab-${target.id}`)?.focus();
        }}>{tab.label}{tab.count !== undefined && tab.count > 0 && <span className={`fd-tab__count${tab.tone === "error" ? " fd-tab__count--error" : tab.tone === "warn" ? " fd-tab__count--warn" : ""}`} aria-hidden="true">{tab.count}</span>}</button>)}
      </div>
      {candidate !== null && <button type="button" className="fd-focus-source" aria-label="Focus source workspace" aria-pressed={focusSource} disabled={state.view !== "files"} title="Give source editing the full workspace; keep explorer and walkthrough mounted." onClick={() => { playback.pause(); setSourceFocused(focused => !focused); }}>{focusSource ? "Exit focus" : "Focus"}</button>}
      </div>
      <RemovedSourceConflicts drafts={removedConflicts} retained={keptRemoved} onResolve={(path, choice) => {
        const current = store.getState();
        const draft = removedConflicts.find(item => item.path === path);
        if (draft === undefined || current.rounds.at(-1) !== round || current.selectedRoundId !== round?.id || current.drafts.get(path) !== draft) return;
        store.resolveConflict(path, choice);
        if (choice === "mine") store.revealFile(path);
        else if (current.selectedPath === path) store.selectFile(currentCandidate(store.getState())?.files[0]?.path ?? null);
      }} onRestore={path => {
        if (keptRemoved.some(draft => draft.path === path)) restoreSource(path);
      }} />
      {plan !== null && <div className="fd-tour-slot" hidden={focusSource} inert={focusSource}><ArchitectureTour plan={plan} state={tour.roundId === round?.id ? tour : { ...tour, mode: "ready", playing: false, step: 0 }} playback={playback} motion={clock.motion} historical={historical} sourceEdited={!historical && (edited.saved + edited.dirty + edited.conflicted > 0)} onRevealFile={path => { if (store.getState().selectedRoundId === round?.id && candidate?.files.some(file => file.path === path)) store.revealFile(path); }} /></div>}
      <div className="fd-body">{tabs.map(tab => <div key={tab.id} id={`${id}-panel-${tab.id}`} role="tabpanel" data-view={tab.id} className="fd-view" aria-labelledby={`${id}-tab-${tab.id}`} hidden={state.view !== tab.id} inert={state.view !== tab.id} tabIndex={0}>{visited.current.has(tab.id) ? panel(tab.id) : null}</div>)}</div>
      <footer className="fd-workspace-status" aria-label="Workspace status"><span>{state.busy ? "Generation in progress" : plan === null ? "Waiting for a candidate" : `${plan.groups.length} received modules · ${plan.counts.artifacts} artifacts`}</span><span className="fd-status-edits">{edited.conflicted > 0 && <span className="fd-tabs__edits--conflict">{edited.conflicted} conflict{edited.conflicted === 1 ? "" : "s"}</span>}{edited.dirty > 0 && <span>{edited.dirty} unsaved</span>}{edited.saved > 0 && <span>{edited.saved} edited</span>}{edited.locked > 0 && <span>{edited.locked} locked</span>}</span>{plan !== null && <span className="fd-workspace-limit" title="The reader supports one emitted Page/PANELS module. Additional web modules and PageDoc are source-only; generated source is never executed.">Page/PANELS only · other pages source-only</span>}<span>Host install not verified</span></footer>
    </section>
  </div>;
}
