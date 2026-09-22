/** Flightdeck Studio — the workbench.
 *
 * A chat pane, a file tree of the generated sub-app, a diff of what the
 * round changed, and a preview that is honest about being a preview of
 * something that cannot run in a browser.
 *
 * ── HOW TO WIRE IT ──────────────────────────────────────────────────
 *   const store = createStore();
 *   <Workbench
 *     store={store}
 *     onPrompt={(text, turnId) => drive(turnId, text)}
 *     onStop={(turnId) => { controller.abort(); store.abort(turnId); }}
 *   />
 *
 * A driver answers a prompt by reporting the work as it does it:
 *
 *   store.plan(turnId, [                    // declare the pipeline
 *     { id: "plan",  label: "plan against the contract" },
 *     { id: "emit",  label: "emit source", writes: [manifestPath] },
 *     { id: "gate",  label: "conformance gate" },
 *     { id: "tsc",   label: "typecheck against the host surface" },
 *     { id: "mount", label: "mount probe" },
 *   ]);
 *   store.startStep("tsc");
 *   store.output("tsc", chunk);             // raw stdout, as it arrives
 *   store.output("tsc", chunk, "err");      // raw stderr, kept apart
 *   store.endStep("tsc", "failed", { error: "tsc exited 2", exitCode: 2 });
 *   store.stream(turnId, prose);            // the chat's side of it
 *   store.settle(turnId, candidate);        // or refuse / fail / abort
 *
 * Steps are the driver's own ids, so output from an async process can name
 * the step it came from without holding a handle the store gave it. A
 * driver that reports no steps still works; the run pane says as much
 * rather than drawing a progress bar it cannot justify.
 *
 * ── THE PERSON'S SIDE ───────────────────────────────────────────────
 * `store.editFile` / `saveFile` / `revertFile` / `restoreGenerated` /
 * `resolveConflict` / `toggleLock` / `requestAbort`. A saved edit becomes
 * part of what every pane reads — `store.effectiveFiles()` is what would
 * actually ship. `editing.ts` documents the conflict policy, which is the
 * one thing in this package a driver must not work around.
 *
 * The workbench never talks to a model, a server or a generator. It is
 * handed a `Candidate` — files, findings, and the rules the gate ran — and
 * it draws it. Everything below is pure except the components. */

// The shell and its panes. Every pane takes plain props, so each one can
// be rendered and asserted on without a store.
export { Workbench, type WorkbenchProps } from "./Workbench";
export { ChatPane } from "./components/ChatPane";
export { DiffPane } from "./components/DiffPane";
export { FileTreePane } from "./components/FileTreePane";
export { GatePane } from "./components/GatePane";
export { PreviewPane } from "./components/PreviewPane";
export { PreviewFrame } from "./components/PreviewFrame";
export { GeneratedPageMirror } from "./components/GeneratedPageMirror";
export { RunPane } from "./components/RunPane";
export { EditorPane, type EditorPaneProps } from "./components/EditorPane";
export { ThemeToggle } from "./components/ThemeToggle";

// State.
export { WorkbenchStore, createStore, defaultSelection, type StoreOptions, type WorkbenchState, type SeverityFilter } from "./store";
export * from "./selectors";

// The domain types the workbench is handed.
export {
  ALL_ENABLED,
  CANDIDATE_SCOPE,
  isEnabled,
  refusingLayer,
  type Candidate,
  type CandidateManifest,
  type EnableLayers,
  type Finding,
  type GeneratedFile,
  type GeneratedFileKind,
  type Round,
  type Severity,
  type Turn,
  type TurnStatus,
  type WorkbenchView,
} from "./types";

// What the builder is doing, and the person's hands on it. A driver
// declares steps with `store.plan`, moves them with `startStep`/`endStep`
// and pipes real process output through `store.output`; the person edits,
// saves, locks and stops through the rest.
export {
  MAX_LINE_CHARS,
  MAX_LOG_LINES,
  TERMINAL,
  createRun,
  createStep,
  endStep,
  failedSteps,
  logText,
  pathsBeingWritten,
  pushOutput,
  runProgress,
  runStatus,
  startStep,
  stepDuration,
  type LogLine,
  type LogStream,
  type Run,
  type RunProgress,
  type RunStatus,
  type Step,
  type StepSpec,
  type StepStatus,
} from "./run";
export {
  EDITABLE_MAX_BYTES,
  applyDrafts,
  draftState,
  editability,
  editSummary,
  effectiveText,
  isDirty,
  looksBinary,
  reconcileDrafts,
  type Conflict,
  type ConflictKind,
  type Draft,
  type DraftState,
  type Editability,
  type EditSummary,
} from "./editing";

// Pure machinery, exported because it is useful and testable on its own.
export { diffFileSets, diffLines, segmentPair, toHunks, type ChangeSet, type FileChange, type Hunk, type LineDiff, type LineOp } from "./diff";
export { TIERS, TIER_ORDER, buildTree, classifyTier, type Tier, type TreeNode } from "./tree";

// The preview.
export { buildPreview, isReady, BLOCKING_RULES, type PreviewState, type PreviewBlock } from "./preview/state";
export { readWebModule, RUNTIME_MARKERS, type WebModule, type PanelDescriptor } from "./preview/descriptor";
export { MockCapabilityHost, bodySchema, scanScopes, type HostSnapshot } from "./preview/adapter";
export { buildLedger, type LedgerRow, type Fidelity } from "./preview/fidelity";
export {
  TOKENS,
  WORKBENCH_CSS,
  HOST_FRAME_CSS,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isStudioTheme,
  tokenVar,
  type StudioTheme,
} from "./theme";
