import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Graph } from '../../packages/workflow/graph';
import { workspaceGraphSchema, workspaceInputSchema, type WorkspaceRun } from './workspace-client';
import { WorkspaceController } from './workspace-controller';

export interface WorkflowWorkspaceProps {
  graph?: Graph;
  projectId: string;
  token: string;
  onLoadGraph: (graph: Graph) => void;
  /** Change only for explicit new/template/external graph replacements; not edits or workspace loads. */
  documentKey?: string | number;
  /** Optional test/embedding seam; credentials still supplied through props in memory. */
  controller?: WorkspaceController;
}
export function WorkspaceRunDetail({ run }: { run: WorkspaceRun }) {
  return <article className="wf-workspace-detail" aria-label="Persisted run detail">
    <h4>Run · {run.state}</h4><p><code>{run.id}</code> · saved revision {run.draftRevision}</p>
    <p>Started {run.startedAt} · {run.finishedAt ? `Finished ${run.finishedAt}` : 'Not finished'}</p>
    {run.state === 'paused' && (run.resumable && run.pauseDisposition === 'review-pending' ? <p>Independent review pending. Open the Approvals area for a separately authenticated reviewer; the initiator cannot approve here. Server availability is projected, not reviewer authority.</p> : <p>Resume unavailable · resumable: false. No available independent review/resume runtime for this run.</p>)}
    {(run.state === 'running' || run.state === 'interrupted') && <p>Further runs are blocked. Inspect server history; never retry uncertain side effects.</p>}
    {run.result ? <><p>{run.result.reason ?? `Engine outcome: ${run.result.status}`}</p><h4>Output</h4><pre>{JSON.stringify(run.result.output, null, 2)}</pre><h4>Trace</h4><p>Diagnostic payloads unavailable for saved runs: server capture is disabled. Per-node inputs/outputs require an explicit local opt-in inspector run; saved input and final output below are separate public records.</p><ul>{run.result.trace.map((entry, index) => <li key={`${entry.nodeId}-${index}`}><strong>{run.graphSnapshot.nodes.find(n => n.id === entry.nodeId)?.label ?? entry.nodeId}</strong> · {entry.status}{entry.details ? <><p>Measured duration: {entry.details.durationMs.toFixed(3)} ms</p>{entry.details.selectedPort !== undefined && <p>Selected branch: {entry.details.selectedPort}</p>}{entry.details.errorCode && <p>Error category: <code>{entry.details.errorCode}</code></p>}</> : <p>{entry.status === 'skipped' ? 'Not attempted · no timing or diagnostic payload.' : 'Timing unavailable · legacy record has no measured diagnostics.'}</p>}{entry.humanName && <p>Human reviewer: {entry.humanName}</p>}{entry.message && <p>{entry.message}</p>}</li>)}</ul><details><summary>Raw metadata trace</summary><pre>{JSON.stringify(run.result.trace, null, 2)}</pre></details>{run.result.pendingNodeId && <p>Pending approval: <code>{run.result.pendingNodeId}</code></p>}</> : <p>No terminal result recorded.</p>}
    <details><summary>Saved input &amp; snapshot</summary><pre>{JSON.stringify({ input: run.input, graphSnapshot: run.graphSnapshot, graphDigest: run.graphDigest }, null, 2)}</pre></details>
  </article>;
}
export function WorkflowWorkspace({ graph, projectId, token, onLoadGraph, documentKey, controller: supplied }: WorkflowWorkspaceProps) {
  const [controller] = useState(() => {
    const next = supplied ?? new WorkspaceController();
    if (!supplied) { next.setScope(projectId, token); next.setGraph(graph); }
    return next;
  });
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const lastDocument = useRef(documentKey);
  const scopeRef = useRef({ projectId, token, documentKey });
  scopeRef.current = { projectId, token, documentKey };
  const sameScope = controller.matchesScope(projectId, token);
  const sameDocument = lastDocument.current === documentKey;
  // Mask old identities immediately during render, before scope-reset effects can run.
  const state = sameScope && sameDocument ? snapshot : { ...snapshot, phase: 'idle' as const, draft: null, drafts: null, runs: null, detail: null, dirty: !!graph, error: null, message: null };
  const [filter, setFilter] = useState('');
  const [inputText, setInputText] = useState('{}');
  const [pendingLoad, setPendingLoad] = useState<string | null>(null);
  useEffect(() => { controller.setScope(projectId, token); setPendingLoad(null); setInputText('{}'); }, [controller, projectId, token]);
  useEffect(() => {
    if (lastDocument.current !== documentKey) { lastDocument.current = documentKey; controller.newDocument(graph); setPendingLoad(null); }
    else controller.setGraph(graph);
  }, [controller, graph, documentKey]);
  useEffect(() => () => controller.cancel(), [controller]);
  // Do not automatically save, execute, or send model/connector requests. Reads are explicit too.
  const busy = ['loading', 'saving', 'running'].includes(state.phase);
  const connected = state.connected && sameScope && sameDocument && !!token;
  const validGraph = !!graph && workspaceGraphSchema.safeParse(graph).success;
  let input: unknown; let inputError: string | null = null;
  try { input = JSON.parse(inputText); if (!workspaceInputSchema.safeParse(input).success) inputError = 'Input must be a bounded JSON object without secrets (100 fields, 100 KB, depth 24).'; }
  catch { inputError = 'Enter valid JSON object input.'; }
  const runReason = controller.runDisabledReason;
  const drafts = state.drafts?.filter(d => `${d.name} ${d.id}`.toLowerCase().includes(filter.toLowerCase()));
  async function load(id: string, discard = false) {
    if (state.dirty && !discard) { setPendingLoad(id); return; }
    setPendingLoad(null);
    const scope = scopeRef.current;
    const loaded = await controller.load(id, () => discard);
    const current = scopeRef.current;
    if (loaded && scope.projectId === current.projectId && scope.token === current.token && scope.documentKey === current.documentKey) onLoadGraph(loaded);
  }
  return <section className="wf-workspace" aria-label="Workflow workspace">
    <style>{WORKSPACE_CSS}</style>
    <header><h3>Saved workflow workspace</h3><span className="wf-workspace-state" role="status">{busy ? state.phase === 'saving' ? 'Saving…' : state.phase === 'running' ? 'Running saved revision…' : 'Loading…' : state.dirty ? 'Unsaved changes' : state.draft ? 'Saved snapshot' : 'Unsaved'}</span></header>
    <p className="wf-workspace-scope">Local project partition: <code>{projectId || 'not selected'}</code> · single operator. This is not authenticated host project authority or deployment.</p>
    {!connected && <p role="status">Connect operator credential in AI builder and choose a valid local project ID. Workspace has not been checked.</p>}
    {state.draft && <p>Current draft: <code>{state.draft.id}</code> · revision {state.draft.revision} · {state.draft.graph.name}</p>}
    <div className="wf-workspace-actions">
      <button type="button" aria-label="Save as new draft" disabled={!connected || !validGraph || busy} onClick={() => { void controller.save('new'); }}>Save as new draft</button>
      <button type="button" aria-label="Save new revision" disabled={!connected || !validGraph || !state.draft || busy} onClick={() => { void controller.save('revision'); }}>Save New Revision{state.draft ? ` · from r${state.draft.revision}` : ''}</button>
      <button type="button" aria-label="Use graph as new draft" disabled={!graph || !state.draft || busy} onClick={() => { controller.newDocument(graph); }}>Use graph as new draft</button>
    </div>
    <p className="wf-workspace-help">Save as new draft creates a separate server identity; Save New Revision updates only the selected draft using its expected revision. Configure reviewer and reason before first saving approval: saved approval ID/type/config bindings are immutable. Incomplete drafts can save but may be blocked at execution.</p>
    {!validGraph && graph && <p role="alert">Graph configuration is invalid or exceeds workspace bounds; fix it before saving.</p>}
    <div className="wf-workspace-grid">
      <section aria-label="Saved workflow drafts"><div className="wf-workspace-actions"><h4>Saved drafts</h4><button type="button" aria-label="Refresh saved drafts" disabled={!connected || busy} onClick={() => { void controller.refresh(); }}>Refresh drafts</button></div>
        <label>Filter saved drafts<input aria-label="Filter saved drafts" maxLength={200} value={filter} onChange={e => setFilter(e.target.value)} /></label>
        {drafts === undefined ? <p>Saved drafts not checked. Refresh to load durable records.</p> : drafts.length === 0 ? <p>{state.drafts?.length ? 'No matching saved drafts.' : 'No saved drafts in this checked local project.'}</p> : <ul className="wf-workspace-records">{drafts.map(d => <li key={d.id}><div><strong>{d.name}</strong><small>r{d.revision} · {d.updatedAt}</small><code>{d.id}</code></div><button type="button" aria-label={`Load draft ${d.id}`} disabled={!connected || busy} onClick={() => { void load(d.id); }}>Load</button></li>)}</ul>}
        {pendingLoad && <div className="wf-workspace-discard" role="alert"><p>Loading this draft discards current unsaved graph edits. Continue?</p><button type="button" aria-label="Discard edits and load draft" disabled={busy} onClick={() => { void load(pendingLoad, true); }}>Discard edits &amp; load</button><button type="button" aria-label="Cancel loading draft" onClick={() => setPendingLoad(null)}>Cancel</button></div>}
      </section>
      <section aria-label="Saved revision execution"><h4>Server execution · saved revision only</h4>
        <label>Run input (JSON object)<textarea aria-label="Server run input" maxLength={100_000} value={inputText} onChange={e => setInputText(e.target.value)} spellCheck={false} /></label>
        {inputError && <p role="alert">{inputError}</p>}
        <button type="button" aria-label="Run saved revision" disabled={!connected || busy || !!runReason || !!inputError} onClick={() => { void controller.run(input); }}>Run saved revision{state.draft ? ` ${state.draft.revision}` : ''}</button>
        {runReason && <p>{runReason}</p>}
        <p className="wf-workspace-help">One run per saved revision. No auto-save or retry; explicitly Save New Revision for another execution. Unsaved graph edits are never sent for execution. Missing HTTP/model adapters block. A durable review-pending pause requires an independent reviewer in Approvals; legacy or unconfigured pauses remain resume unavailable. Pending runs block newer revisions too. Never paste secrets into graph or input.</p>
        <div className="wf-workspace-actions"><h4>Persisted run history</h4><button type="button" aria-label="Refresh run history" disabled={!connected || !state.draft || busy} onClick={() => { void controller.history(); }}>Refresh history</button></div>
        {state.runs === null ? <p>Run history not checked.</p> : state.runs.length === 0 ? <p>No recorded runs for this checked draft.</p> : <ul className="wf-workspace-records">{state.runs.map(r => <li key={r.id}><div><strong>r{r.draftRevision} · {r.state}</strong><small>{r.startedAt}{r.state === 'paused' ? r.resumable && r.pauseDisposition === 'review-pending' ? ' · independent review pending · Approvals' : ' · resume unavailable' : ''}</small><code>{r.id}</code></div><button type="button" aria-label={`Inspect run ${r.id}`} disabled={!connected || busy} onClick={() => { void controller.inspect(r.id); }}>Details</button></li>)}</ul>}
      </section>
    </div>
    <div aria-live="polite">{state.error && <p role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}</div>
    {state.detail && <WorkspaceRunDetail run={state.detail} />}
  </section>;
}
const WORKSPACE_CSS = `
.wf-workspace{font:13px/1.5 Arial,Helvetica,sans-serif;background:var(--surface,#fff);color:var(--ink,#253d4b);border:1px solid var(--line,#d5dfe5);border-radius:10px;padding:14px;margin:12px 0}
.wf-workspace *{box-sizing:border-box}.wf-workspace header,.wf-workspace-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.wf-workspace header{justify-content:space-between}.wf-workspace h3,.wf-workspace h4{margin:0 0 8px;font-size:14px}.wf-workspace p{margin:8px 0;color:var(--muted,#586e7c)}.wf-workspace-state{color:var(--te,#e98300)}.wf-workspace-scope,.wf-workspace-help{font-size:12px}.wf-workspace-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;margin-top:12px}.wf-workspace-grid>section{min-width:0;border-top:1px solid var(--line,#d5dfe5);padding-top:12px}.wf-workspace label{display:flex;flex-direction:column;gap:4px;margin:8px 0}.wf-workspace input,.wf-workspace textarea{width:100%;font:inherit;color:var(--ink,#253d4b);background:var(--bg,#f3f6f7);padding:6px 8px;border:1px solid var(--line,#d5dfe5);border-radius:5px}.wf-workspace textarea{min-height:80px;resize:vertical;font-family:monospace}.wf-workspace button{font:inherit;background:var(--surface,#fff);color:var(--ink,#253d4b);border:1px solid var(--line,#d5dfe5);border-radius:5px;padding:5px 9px;cursor:pointer}.wf-workspace button:hover{background:var(--surface2,#f8fafb)}.wf-workspace button:disabled{opacity:.45;cursor:not-allowed}.wf-workspace button:focus-visible,.wf-workspace input:focus-visible,.wf-workspace textarea:focus-visible{outline:2px solid var(--te,#e98300);outline-offset:2px}.wf-workspace-records{list-style:none;margin:8px 0;padding:0;max-height:240px;overflow:auto}.wf-workspace-records li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line,#d5dfe5)}.wf-workspace-records li>div{min-width:0}.wf-workspace small{display:block;color:var(--muted,#586e7c)}.wf-workspace code{overflow-wrap:anywhere;font-size:11px}.wf-workspace pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;background:var(--bg,#f3f6f7);padding:10px;border-radius:5px}.wf-workspace [role=alert]{color:var(--red,#aa3122)}.wf-workspace-discard{border:1px solid var(--amber,#806620);padding:8px}.wf-workspace-detail{border-top:1px solid var(--line,#d5dfe5);padding-top:12px;margin-top:12px}.wf-workspace summary{cursor:pointer}@media(max-width:800px){.wf-workspace-grid{grid-template-columns:1fr}}
`;
