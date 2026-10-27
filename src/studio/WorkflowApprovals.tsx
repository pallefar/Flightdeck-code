import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApprovalController } from './approval-controller';
import { WorkspaceRunDetail } from './WorkflowWorkspace';
export interface WorkflowApprovalsProps {
 projectId: string; token: string; fetcher?: typeof fetch; controller?: ApprovalController; active?: boolean; onCredentials?: () => void;
}
export function WorkflowApprovals({ projectId, token, fetcher = (...args) => fetch(...args), controller: supplied, active = true, onCredentials }: WorkflowApprovalsProps) {
 const [controller] = useState(() => { const c = supplied ?? new ApprovalController((...args) => fetcher(...args)); if (!supplied) c.setScope(projectId, token); return c; });
 const snapshot = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
 const sameScope = controller.matchesScope(projectId, token);
 // Never render previous-person private context while waiting for scope effects.
 const state = sameScope ? snapshot : { ...snapshot, connected: false, phase: 'idle' as const, approvals: null, review: null, acknowledged: false, detail: null, history: null, message: null, error: null };
 useEffect(() => { controller.setScope(projectId, token); }, [controller, projectId, token]);
 useEffect(() => { if (!active) controller.acknowledge(false); }, [controller, active]);
 useEffect(() => () => controller.cancel(), [controller]);
 const review = state.review, busy = state.phase === 'loading' || state.phase === 'deciding';
 const pending = review?.state === 'pending' && Date.parse(review.expiresAt) > Date.now();
 useEffect(() => {
  if (!review) return;
  const timer = setTimeout(() => controller.expire(), Math.min(86_400_000, Math.max(0, Date.parse(review.expiresAt) - Date.now())));
  return () => clearTimeout(timer);
 }, [controller, review]);
 const connected = sameScope && state.connected && !!token;
 return <section className="studio-card workflow-approvals" aria-label="Independent workflow approvals">
  <style>{`.workflow-approvals pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:460px;overflow:auto;background:var(--bg,#f3f6f7);padding:12px}.workflow-approvals code{overflow-wrap:anywhere}.workflow-approvals label{flex-direction:row;align-items:flex-start}.workflow-approvals ul{list-style:none;padding:0}.workflow-approvals li{border-bottom:1px solid var(--line,#d5dfe5);padding:10px 0}.workflow-approvals [role=alert]{color:var(--red,#aa3122)}`}</style>
  <h2>Approvals · independent human review</h2>
  <p>Project: <code>{projectId || 'not selected'}</code>. Independent reviewer sign-in through the deployment’s real authenticated identity provider is required, with project and exact pending gate/queue permissions. The original initiator cannot review their own run. An operator token or this UI does not grant reviewer authority.</p>
  <p>Default independent review runtime is not configured. No second identity is created here. Sign in through your deployment; never paste reviewer secrets into chat.</p>
  {!connected && <p role="status">Connect the existing in-memory operator/session credential and valid project in AI builder. Inbox not checked.</p>}
  {onCredentials && <button type="button" onClick={onCredentials}>Connection &amp; sign-in help</button>}
  <button type="button" aria-label="Refresh approvals" disabled={!connected || busy} onClick={() => { void controller.refresh(); }}>Refresh approvals</button>
  <button type="button" disabled={!connected || busy || !controller.canInspect || !sameScope} onClick={() => { void controller.inspectHistory(); }}>Inspect original run history</button>
  {busy && <><p role="status">{state.phase === 'deciding' ? 'Decision requested. Server may claim and execute downstream actions…' : 'Loading requested records…'}</p><button type="button" onClick={controller.cancel}>Cancel pending request</button></>}
  <p>No automatic refresh, decision, resume or retry. Cancellation does not stop already claimed server effects.</p>
  {state.approvals === null ? <p>Inbox not checked. Use Refresh to request authorized metadata.</p> : state.approvals.length === 0 ? <p>No approvals in this checked project.</p> : <ul aria-label="Approval inbox">{state.approvals.map(a => <li key={a.id}><strong>{a.state}</strong> · gate <code>{a.nodeId}</code> · original run <code>{a.runId}</code> · draft r{a.draftRevision}<p>Created {a.createdAt} · expires {a.expiresAt} · approval revision {a.revision}</p><button type="button" disabled={!connected || busy} onClick={() => { void controller.select(a.id); }}>Review {a.id}</button></li>)}</ul>}
  {state.error && <p role="alert">{state.error}</p>}{state.message && <p role="status">{state.message}</p>}
  {review && <article aria-label="Exact approval context"><h3>Exact review · {review.state}</h3>
   <p>Approval <code>{review.id}</code> · r{review.revision} · original run <code>{review.runId}</code> · draft <code>{review.draftId}</code> r{review.draftRevision} · gate <code>{review.nodeId}</code></p>
   <p>Initiator: {review.context.initiator}. Queue: {review.context.gate.reviewer ?? 'not configured'}. Gate reason: {review.context.gate.reason ?? 'not configured'}.</p>
   <p>Created {review.createdAt} · expires {review.expiresAt}. {review.decisionBy && `Recorded reviewer: ${review.decisionBy} at ${review.decidedAt}.`}</p>
   <h4>Pending data</h4><pre>{JSON.stringify(review.context.pendingData, null, 2)}</pre>
   <h4>Resource references · exact functions and revisions</h4><pre>{JSON.stringify(review.context.resourceReferences, null, 2)}</pre>
   <h4>Complete immutable graph snapshot</h4><pre>{JSON.stringify(review.context.graphSnapshot, null, 2)}</pre>
   <p>Sorted graph digest: <code>{review.context.graphDigest}</code><br />Ordered graph digest: <code>{review.context.orderedGraphDigest}</code></p>
   <h4>Exact bound context (object-key order preserved)</h4><pre>{JSON.stringify(review.context, null, 2)}</pre>
   <p>Verified SHA-256 context digest: <code>{review.contextDigest}</code>. Browser verification binds this display, not your identity or understanding. Stored inputs are bounded, not guaranteed anonymized.</p>
   {pending ? <><p>Approve and resume may immediately execute downstream configured actions under the original initiator’s permissions. Review all data, resource functions/revisions and graph actions before proceeding. Rejection blocks the original run.</p>
    <label><input type="checkbox" aria-label="Confirm exact context digest" checked={state.acknowledged} disabled={busy || !connected} onChange={e => controller.acknowledge(e.target.checked)} />I reviewed this exact context and confirm digest {review.contextDigest} for approval revision {review.revision}.</label>
    <button type="button" disabled={!connected || !state.acknowledged || busy || !controller.canDecide} onClick={() => { void controller.decide('approve'); }}>Approve and resume</button>
    <button type="button" disabled={!connected || !state.acknowledged || busy || !controller.canDecide} onClick={() => { void controller.decide('reject'); }}>Reject</button>
   </> : <p>Decision unavailable: this context is expired, interrupted, consumed or rejected. Refresh and inspect actual original history; never retry automatically.</p>}
  </article>}
  {state.detail && <WorkspaceRunDetail run={state.detail} />}
 </section>;
}
