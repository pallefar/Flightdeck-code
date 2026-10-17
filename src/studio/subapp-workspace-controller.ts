import type { WorkbenchStore } from '../workbench/store';
import type { Round } from '../workbench/types';
import { captureSubappSnapshot, restoreSubappSnapshot, SubappSnapshotError } from './subapp-snapshot';
import { checkSubappContext, waitForSubappContext, subappSnapshotHash, SubappWorkspaceClient, SubappWorkspaceClientError, type SubappDocument, type SubappSummary } from './subapp-workspace-client';

export interface SubappWorkspaceState {
  connected: boolean;
  phase: 'idle' | 'saving' | 'loading';
  drafts: SubappSummary[] | null;
  saved: SubappDocument | null;
  uncertain: boolean;
  error: string | null;
  message: string | null;
}
const initial = (): SubappWorkspaceState => ({ connected: false, phase: 'idle', drafts: null, saved: null, uncertain: false, error: null, message: null });
export class SubappWorkspaceController {
  private state = initial();
  private listeners = new Set<() => void>();
  private project = ''; private token = ''; private client: SubappWorkspaceClient | null = null;
  private epoch = 0; private abort: AbortController | null = null; private writeStarted = false;
  private round: Round | undefined;
  private unsubscribe: (() => void) | null = null;
  private active = true;
  private restoring = false;
  private uncertainty = new Map<string, Set<string>>();
  private readonly transport: typeof fetch;
  constructor(readonly store: WorkbenchStore, transport: typeof fetch = (...args) => globalThis.fetch(...args)) {
    this.transport = (...args) => transport(...args);
    this.round = store.getState().rounds.at(-1);
  }
  getState = (): SubappWorkspaceState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  matchesScope(projectId: string, token: string) { return this.project === projectId && this.token === token; }
  private patch(update: Partial<SubappWorkspaceState>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
  private observeRound = () => {
    if (this.restoring) return;
    const round = this.store.getState().rounds.at(-1);
    if (round === this.round) return;
    this.round = round; this.cancel(); this.patch({ saved: null, message: null, error: null });
  };
  connect() {
    if (this.unsubscribe) return;
    this.observeRound();
    this.unsubscribe = this.store.subscribe(this.observeRound);
  }
  disconnect() { this.cancel(); this.unsubscribe?.(); this.unsubscribe = null; }
  private markUncertain() {
    const tokens = this.uncertainty.get(this.project) ?? new Set<string>(); tokens.add(this.token); this.uncertainty.set(this.project, tokens);
    this.patch({ uncertain: true, message: null });
  }
  cancel() {
    ++this.epoch; this.abort?.abort(); this.abort = null;
    if (this.writeStarted) this.markUncertain();
    this.writeStarted = false;
    if (this.state.phase !== 'idle') this.patch({ phase: 'idle' });
  }
  setActive(active: boolean) { if (this.active === active) return; this.active = active; if (!active) this.cancel(); }
  setScope(projectId: string, token: string) {
    this.connect();
    if (this.matchesScope(projectId, token)) return;
    this.cancel(); this.project = projectId; this.token = token; this.client = null;
    try { this.client = new SubappWorkspaceClient(projectId, token, this.transport); } catch { /* Invalid scope hides prior records too. */ }
    this.state = { ...initial(), connected: !!this.client, uncertain: this.uncertainty.get(projectId)?.has(token) ?? false };
    for (const listener of this.listeners) listener();
  }
  private begin(phase: 'saving' | 'loading') {
    if (!this.active || !this.client || this.state.phase !== 'idle') return null;
    const epoch = ++this.epoch; const abort = new AbortController(); this.abort = abort;
    const client = this.client;
    const current = () => this.epoch === epoch && !abort.signal.aborted && this.active && this.client === client;
    this.patch({ phase, error: null, message: null });
    return { epoch, signal: abort.signal, client, current, check: () => checkSubappContext(abort.signal, current) };
  }
  private finish(operation: { epoch: number }) { if (operation.epoch === this.epoch) { this.abort = null; this.writeStarted = false; this.patch({ phase: 'idle' }); } }
  refresh = async (): Promise<boolean> => {
    const operation = this.begin('loading'); if (!operation) return false;
    try {
      const drafts = await operation.client.list(operation.signal, operation.current); operation.check();
      this.patch({ drafts, message: 'Saved draft list refreshed. Opening a draft is a separate explicit action.' }); return true;
    } catch (error) {
      if (operation.current()) this.patch({ error: error instanceof SubappWorkspaceClientError ? error.message : 'Saved drafts unavailable.' });
      return false;
    } finally { this.finish(operation); }
  };
  open = async (id: string, confirmReplacement: (message: string) => boolean | Promise<boolean> = message => globalThis.confirm(message), onLoaded?: () => void): Promise<boolean> => {
    if (this.store.getState().busy) { this.patch({ error: 'Wait for the current generation before opening saved source.' }); return false; }
    const before = this.store.getState();
    const operation = this.begin('loading'); if (!operation) return false;
    try {
      const saved = await operation.client.get(id, operation.signal, operation.current); operation.check();
      if (this.store.getState() !== before) throw new SubappSnapshotError('Editor changed while opening saved source. Review and open again; nothing replaced.');
      if (before.rounds.length || before.drafts.size || before.turns.length) {
        const accepted = await waitForSubappContext(Promise.resolve(confirmReplacement('Replace the current in-session sub-app source, buffers and round history with this saved draft? Unsaved work will be lost. No checks or code will run.')), operation.signal, operation.current);
        operation.check();
        if (this.store.getState() !== before) throw new SubappSnapshotError('Editor changed during replacement confirmation. Nothing replaced; review and open again.');
        if (!accepted) return false;
      }
      operation.check();
      this.restoring = true;
      try { this.round = restoreSubappSnapshot(this.store, saved.snapshot); }
      finally { this.restoring = false; }
      operation.check();
      this.uncertainty.get(this.project)?.delete(this.token);
      this.patch({ saved, uncertain: false, message: 'Saved source opened. Original checks describe the generated baseline, not revalidation of manual source.' });
      onLoaded?.();
      return true;
    } catch (error) {
      if (operation.current()) this.patch({ error: error instanceof SubappWorkspaceClientError || error instanceof SubappSnapshotError ? error.message : 'Saved source could not be opened. Current editor was not replaced.' });
      return false;
    } finally { this.finish(operation); }
  };
  save = async (mode: 'new' | 'revision' = 'new'): Promise<boolean> => {
    if (this.state.uncertain || this.state.phase !== 'idle' || !this.active) return false;
    let snapshot;
    try { snapshot = captureSubappSnapshot(this.store.getState()); }
    catch (error) { this.patch({ error: error instanceof Error ? error.message : 'Source capture refused.' }); return false; }
    const saved = mode === 'revision' ? this.state.saved : null;
    if (mode === 'revision' && !saved) return false;
    const operation = this.begin('saving'); if (!operation) return false;
    let mutationAcknowledged = false;
    try {
      const hash = await waitForSubappContext(subappSnapshotHash(snapshot), operation.signal, operation.current); operation.check();
      this.writeStarted = true;
      const written = saved
        ? await operation.client.update(saved.id, snapshot, saved.revision, operation.signal, operation.current)
        : await operation.client.create(snapshot, operation.signal, operation.current);
      mutationAcknowledged = true;
      operation.check();
      const readback = await operation.client.get(written.id, operation.signal, operation.current);
      operation.check();
      if (readback.id !== written.id || readback.revision !== written.revision || readback.contentHash !== hash ||
          JSON.stringify(readback.snapshot) !== JSON.stringify(snapshot) || JSON.stringify(readback) !== JSON.stringify(written))
        throw new SubappWorkspaceClientError('readback', 'Exact saved source readback did not match. No save confirmed.');
      this.writeStarted = false;
      this.patch({ saved: readback, uncertain: false, message: `Durable draft revision ${readback.revision} confirmed by exact source readback.` });
      return true;
    } catch (error) {
      if (operation.current()) {
        const refused = !mutationAcknowledged && error instanceof SubappWorkspaceClientError && typeof error.code === 'number' && [400, 401, 403, 404, 409, 413].includes(error.code);
        if (this.writeStarted && !refused) this.markUncertain();
        this.writeStarted = false;
        this.patch({ error: error instanceof SubappWorkspaceClientError ? error.message : 'Sub-app save unavailable. No save confirmed; inspect saved drafts before retrying.' });
      }
      return false;
    } finally { this.finish(operation); }
  };
}
