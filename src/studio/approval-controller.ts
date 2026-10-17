import { ApprovalClient, ApprovalClientError, type ApprovalReview, type ApprovalSummary } from './approval-client';
import { canonicalJson, type WorkspaceRun } from './workspace-client';
export interface ApprovalState {
 phase: 'idle' | 'loading' | 'deciding' | 'error'; projectId: string; connected: boolean;
 approvals: ApprovalSummary[] | null; review: ApprovalReview | null; acknowledged: boolean;
 detail: WorkspaceRun | null; history: WorkspaceRun[] | null; message: string | null; error: string | null;
}
export class ApprovalController {
 private state: ApprovalState = { phase: 'idle', projectId: '', connected: false, approvals: null, review: null, acknowledged: false, detail: null, history: null, message: null, error: null };
 private token = ''; private client: ApprovalClient | null = null;
 private target: { draftId: string; runId: string } | null = null;
 private generation = 0; private abort: AbortController | null = null;
 private listeners = new Set<() => void>();
 constructor(private readonly transport: typeof fetch = (...args) => fetch(...args)) {}
 getState = () => this.state;
 subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
 private patch(update: Partial<ApprovalState>) { this.state = { ...this.state, ...update }; for (const listener of this.listeners) listener(); }
 matchesScope(projectId: string, token: string) { return this.state.projectId === projectId && this.token === token; }
 cancel = () => { const wasBusy = this.busy; ++this.generation; this.abort?.abort(); this.abort = null; this.patch({ phase: 'idle', acknowledged: false, review: null, message: wasBusy ? 'Request cancelled. Cancellation cannot stop already claimed server effects; inspect actual history.' : null }); };
 setScope(projectId: string, token: string) {
  if (this.matchesScope(projectId, token)) return;
  this.cancel(); this.token = token; this.client = null; this.target = null;
  try { this.client = new ApprovalClient(projectId, token, (...args) => this.transport(...args)); } catch { /* no requests */ }
  this.patch({ projectId, connected: !!this.client, approvals: null, review: null, acknowledged: false, detail: null, history: null, message: null, error: null });
 }
 get canInspect() { return !!this.target; }
 private get busy() { return this.state.phase === 'loading' || this.state.phase === 'deciding'; }
 get canDecide() { return !this.busy && this.state.acknowledged && this.state.review?.state === 'pending' && Date.parse(this.state.review.expiresAt) > Date.now(); }
 acknowledge(value: boolean) {
  this.patch({ acknowledged: value && !this.busy && this.state.review?.state === 'pending' && Date.parse(this.state.review.expiresAt) > Date.now() });
 }
 expire() { if (this.state.review && Date.parse(this.state.review.expiresAt) <= Date.now()) this.patch({ acknowledged: false }); }
 private fail(error: unknown) {
  this.patch({ phase: 'error', acknowledged: false, review: null, detail: null, history: null, message: null, error: error instanceof ApprovalClientError ? error.message : 'Review operation unconfirmed. Inspect the actual original run history; never retry a decision automatically.' });
 }
 private begin(phase: 'loading' | 'deciding') {
  if (this.busy || !this.client) return null;
  const generation = ++this.generation, abort = new AbortController(); this.abort = abort;
  this.patch({ phase, acknowledged: false, error: null, message: null });
  return { client: this.client, signal: abort.signal, current: () => generation === this.generation && !abort.signal.aborted };
 }
 async refresh() {
  const op = this.begin('loading'); if (!op) return;
  this.patch({ review: null, approvals: null, detail: null, history: null });
  try { const approvals = await op.client.list(op.signal); if (op.current()) this.patch({ approvals, phase: 'idle' }); }
  catch (e) { if (op.current()) this.fail(e); }
 }
 async select(id: string) {
  const op = this.begin('loading'); if (!op) return;
  this.patch({ review: null, detail: null, history: null }); this.target = null;
  const listed = this.state.approvals?.find(a => a.id === id);
  if (listed) this.target = { draftId: listed.draftId, runId: listed.runId };
  try { const review = await op.client.review(id, op.signal); if (!op.current()) return;
   this.target = { draftId: review.draftId, runId: review.runId }; this.patch({ review, phase: 'idle' });
  } catch (e) { if (op.current()) this.fail(e); }
 }
 async inspectHistory() {
  const target = this.target; if (!target) return;
  const op = this.begin('loading'); if (!op) return;
  this.patch({ review: null, detail: null, history: null });
  try { const detail = await op.client.workspace.getRun(target.draftId, target.runId, op.signal); if (!op.current()) return;
   const history = await op.client.workspace.listRuns(target.draftId, op.signal); if (!op.current()) return;
   if (!history.some(r => r.id === detail.id && canonicalJson(r) === canonicalJson(detail))) throw new ApprovalClientError('readback', 'Original history changed during readback. Refresh; no outcome confirmed.');
   this.patch({ detail, history, phase: 'idle', message: 'Actual original run history read back. Status is not evidence of a particular decision; inspect recorded receipts/trace.' });
  } catch (e) { if (op.current()) this.fail(e); }
 }
 async decide(decision: 'approve' | 'reject') {
  if (!this.canDecide || !this.state.review) return;
  const reviewed = this.state.review;
  const op = this.begin('deciding'); if (!op) return;
  try {
   const receipt = await op.client.decide(reviewed, decision, op.signal); if (!op.current()) return;
   const read = await op.client.review(reviewed.id, op.signal); if (!op.current()) return;
   const detail = await op.client.workspace.getRun(reviewed.draftId, reviewed.runId, op.signal); if (!op.current()) return;
   const history = await op.client.workspace.listRuns(reviewed.draftId, op.signal); if (!op.current()) return;
   const { context: _context, ...summary } = read;
   if (JSON.stringify(read.context) !== JSON.stringify(reviewed.context) || canonicalJson(summary) !== canonicalJson(receipt.approval) || canonicalJson(detail) !== canonicalJson(receipt.run) || JSON.stringify(detail.graphSnapshot) !== JSON.stringify(reviewed.context.graphSnapshot) || !history.some(r => r.id === reviewed.runId && canonicalJson(r) === canonicalJson(detail) && JSON.stringify(r.graphSnapshot) === JSON.stringify(reviewed.context.graphSnapshot)))
    throw new ApprovalClientError('readback', 'Decision readback mismatch. Effects may already have occurred. Inspect actual original history; never retry automatically.');
   this.patch({ phase: 'idle', review: read, detail, history, acknowledged: false, approvals: this.state.approvals?.map(a => a.id === summary.id ? summary : a) ?? null,
    message: `${decision === 'reject' ? 'Rejection' : 'Approval/resume'} receipt and original run/history read back. Run is ${detail.state}.${detail.state === 'paused' ? ' A subsequent gate requires Refresh, a fresh review and new digest confirmation.' : ''}` });
  } catch (e) { if (op.current()) this.fail(e); }
 }
}
