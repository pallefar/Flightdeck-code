/** Flightdeck Studio — the workbench.
 *
 * A chat pane, a file tree of the generated sub-app, a diff of what the
 * round changed, and a preview that is honest about being a preview of
 * something that cannot run in a browser.
 *
 * ── HOW TO WIRE IT ──────────────────────────────────────────────────
 *   const store = createStore();
 *   <Workbench store={store} onPrompt={(text, turnId) => {
 *      // stream with store.stream(turnId, chunk)
 *      // finish with store.settle(turnId, candidate)
 *      // or store.refuse(turnId, why) / store.fail(turnId, why)
 *   }} />
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

// Pure machinery, exported because it is useful and testable on its own.
export { diffFileSets, diffLines, segmentPair, toHunks, type ChangeSet, type FileChange, type Hunk, type LineDiff, type LineOp } from "./diff";
export { TIERS, TIER_ORDER, buildTree, classifyTier, type Tier, type TreeNode } from "./tree";

// The preview.
export { buildPreview, isReady, BLOCKING_RULES, type PreviewState, type PreviewBlock } from "./preview/state";
export { readWebModule, RUNTIME_MARKERS, type WebModule, type PanelDescriptor } from "./preview/descriptor";
export { MockCapabilityHost, bodySchema, scanScopes, type HostSnapshot } from "./preview/adapter";
export { buildLedger, type LedgerRow, type Fidelity } from "./preview/fidelity";
export { TOKENS, WORKBENCH_CSS, HOST_FRAME_CSS } from "./theme";
