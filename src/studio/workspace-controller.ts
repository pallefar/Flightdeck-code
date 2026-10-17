import type { Graph } from '../../packages/workflow/graph';
import { WorkspaceClient, WorkspaceClientError, canonicalJson, type WorkspaceDraft, type WorkspaceDraftSummary, type WorkspaceRun } from './workspace-client';

export interface WorkspaceState {
  phase: 'idle' | 'loading' | 'saving' | 'running' | 'error';
  projectId: string; connected: boolean; graph: Graph | undefined; dirty: boolean;
  draft: WorkspaceDraft | null; drafts: WorkspaceDraftSummary[] | null; runs: WorkspaceRun[] | null;
  detail: WorkspaceRun | null; error: string | null; message: string | null;
}
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export class WorkspaceController {
  private state: WorkspaceState = { phase: 'idle', projectId: '', connected: false, graph: undefined, dirty: false, draft: null, drafts: null, runs: null, detail: null, error: null, message: null };
  private token = ''; private client: WorkspaceClient | null = null;
  private generation = 0; private abort: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly transport: typeof fetch = fetch) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<WorkspaceState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  cancel = () => { ++this.generation; this.abort?.abort(); this.abort = null; this.patch({ phase: 'idle', message: null }); };
  matchesScope(projectId: string, token: string) { return this.state.projectId === projectId && this.token === token; }
  setScope(projectId: string, token: string) {
    if (projectId === this.state.projectId && token === this.token) return;
    this.cancel(); this.token = token; this.client = null;
    try { this.client = new WorkspaceClient(projectId, token, this.transport); } catch { /* missing scope disables actions, no request */ }
    this.patch({ projectId, connected: !!this.client, draft: null, drafts: null, runs: null, detail: null, dirty: !!this.state.graph, error: null, message: null });
  }
  setGraph(graph: Graph | undefined) {
    const snapshot = graph === undefined ? undefined : copy(graph);
    this.patch({ graph: snapshot, dirty: !!snapshot && (!this.state.draft || !same(snapshot, this.state.draft.graph)) });
  }
  /** Call only for an explicit template/new-document replacement, not ordinary editor changes or loading. */
  newDocument(graph?: Graph) {
    this.cancel(); this.patch({ draft: null, runs: null, detail: null, message: 'New document: Save as new draft; the previous saved draft is unchanged.' }); this.setGraph(graph);
  }
  private get busy() { return ['loading', 'saving', 'running'].includes(this.state.phase); }
  private fail(error: unknown) {
    this.patch({ phase: 'error', message: null, error: error instanceof WorkspaceClientError ? error.message : 'Workspace operation unconfirmed. Refresh drafts/history before retrying; server writes may already have occurred.' });
  }
  private begin(phase: 'loading' | 'saving' | 'running') {
    if (this.busy) return null;
    if (!this.client) { this.fail(new WorkspaceClientError('invalid', 'Connect operator credential in AI builder and choose a valid local project ID.')); return null; }
    const generation = ++this.generation; const abort = new AbortController(); this.abort = abort;
    this.patch({ phase, error: null, message: null });
    return { client: this.client, signal: abort.signal, current: () => generation === this.generation && !abort.signal.aborted };
  }
  async refresh() {
    const op = this.begin('loading'); if (!op) return;
    try { const drafts = await op.client.list(op.signal); if (op.current()) this.patch({ drafts, phase: 'idle' }); }
    catch (e) { if (op.current()) this.fail(e); }
  }
  async save(mode: 'new' | 'revision') {
    if (this.busy) return;
    if (!this.state.graph || (mode === 'revision' && !this.state.draft)) { this.fail(new WorkspaceClientError('invalid', 'Choose a graph and saved draft before saving a revision.')); return; }
    const graph = copy(this.state.graph); const prior = this.state.draft;
    const op = this.begin('saving'); if (!op) return;
    try {
      const written = mode === 'new' ? await op.client.create(graph, op.signal) : await op.client.update(prior!.id, graph, prior!.revision, op.signal);
      if (!op.current()) return;
      const read = await op.client.get(written.id, op.signal);
      if (!op.current()) return;
      if (read.revision !== (mode === 'new' ? 1 : prior!.revision + 1) || !same(read.graph, graph) || !same(read, written)) throw new WorkspaceClientError('readback', 'Save readback does not match. Concurrent changes may exist. Refresh and load the latest draft; no save confirmed.');
      // Keep graph edits made during the request; only the captured snapshot was saved.
      this.patch({ draft: read, dirty: !same(this.state.graph, read.graph), runs: mode === 'new' ? [] : this.state.runs, detail: mode === 'new' ? null : this.state.detail, phase: 'idle', message: `Saved revision ${read.revision} (read back).` });
    } catch (e) { if (op.current()) this.fail(e); }
  }
  async load(id: string, confirmDiscard: () => boolean | Promise<boolean> = () => false): Promise<Graph | undefined> {
    if (this.busy) return;
    const generation = this.generation;
    const before = this.state.graph;
    if (this.state.dirty && !await confirmDiscard()) return;
    if (generation !== this.generation || !same(before, this.state.graph)) return;
    const op = this.begin('loading'); if (!op) return;
    try {
      const draft = await op.client.get(id, op.signal);
      const runs = await op.client.listRuns(id, op.signal);
      if (!op.current()) return;
      if (!same(before, this.state.graph)) throw new WorkspaceClientError('readback', 'Graph changed while loading. Review edits and explicitly load again.');
      this.patch({ draft, graph: copy(draft.graph), dirty: false, runs, detail: null, phase: 'idle', message: `Loaded revision ${draft.revision}.` });
      return copy(draft.graph);
    } catch (e) { if (op.current()) this.fail(e); }
  }
  get runDisabledReason(): string | null {
    if (!this.state.connected) return 'Connect operator credential in AI builder and choose a valid local project ID.';
    if (!this.state.graph || !this.state.draft) return 'Save a draft before server execution.';
    if (this.state.dirty) return 'Save changes as a new revision before server execution.';
    if (this.busy) return 'Workspace operation in progress.';
    if (this.state.runs === null) return 'Refresh run history before execution.';
    if (this.state.runs.some(r => r.state === 'running' || r.state === 'interrupted')) return 'A running or interrupted execution blocks further runs. Inspect history; no retry/resume is available.';
    if (this.state.runs.some(r => r.draftRevision === this.state.draft?.revision)) return 'This saved revision already ran. Explicitly Save New Revision before another run; no automatic retry.';
    return null;
  }
  async history() {
    if (!this.state.draft) return;
    const id = this.state.draft.id; const op = this.begin('loading'); if (!op) return;
    try { const runs = await op.client.listRuns(id, op.signal); if (op.current()) this.patch({ runs, phase: 'idle' }); }
    catch (e) { if (op.current()) { this.patch({ runs: null }); this.fail(e); } }
  }
  async inspect(runId: string) {
    if (!this.state.draft) return;
    const id = this.state.draft.id; const op = this.begin('loading'); if (!op) return;
    try { const detail = await op.client.getRun(id, runId, op.signal); if (op.current()) this.patch({ detail, phase: 'idle' }); }
    catch (e) { if (op.current()) this.fail(e); }
  }
  async run(input: unknown) {
    const reason = this.runDisabledReason;
    if (reason) { if (!this.busy) this.fail(new WorkspaceClientError('invalid', reason)); return; }
    const draft = this.state.draft!; const op = this.begin('running'); if (!op) return;
    try {
      // Recheck durable CAS and history immediately before issuing an execution request.
      const latest = await op.client.get(draft.id, op.signal);
      const previousRuns = await op.client.listRuns(draft.id, op.signal);
      if (!op.current()) return;
      if (!same(latest, draft) || this.state.dirty) throw new WorkspaceClientError('readback', 'Saved revision changed. Refresh and load the latest draft before execution.');
      if (previousRuns.some(r => r.draftRevision === draft.revision || r.state === 'running' || r.state === 'interrupted')) { this.patch({ runs: previousRuns }); throw new WorkspaceClientError(409, 'Revision already executed or execution interrupted. Inspect history; explicitly save a new revision, never retry uncertain work.'); }
      const written = await op.client.run(draft.id, draft.revision, input, op.signal);
      if (!op.current()) return;
      const read = await op.client.getRun(draft.id, written.id, op.signal);
      if (!op.current()) return;
      if (!same(read, written) || !same(read.graphSnapshot, draft.graph)) throw new WorkspaceClientError('readback', 'Execution readback does not match. Inspect history; do not run again.');
      const runs = await op.client.listRuns(draft.id, op.signal);
      if (!op.current()) return;
      if (!runs.some(r => same(r, read))) throw new WorkspaceClientError('readback', 'Execution history does not match. Inspect history; do not run again.');
      this.patch({ runs, detail: read, phase: 'idle', message: `Execution recorded: ${read.state} (read back).` });
    } catch (e) { if (op.current()) { this.patch({ runs: null }); this.fail(e); } }
  }
}
