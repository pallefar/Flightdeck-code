// Browser-only checks. Do not import Node stores/fixtures into this module.
import { createRoot } from 'react-dom/client';
import { createEmptyGraph, type Graph } from '../../../packages/workflow/graph';
import { StudioApp } from '../StudioApp';
import { WorkflowApprovals } from '../WorkflowApprovals';
import { ApprovalController } from '../approval-controller';
import { WorkspaceClient } from '../workspace-client';
const token = 'development-only-nonsecret-operator-sentinel';
const pause = (ms = 20) => new Promise<void>(resolve => setTimeout(resolve, ms));
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function until(test: () => boolean, description: string) { for (let i = 0; i < 300; i++) { if (test()) return; await pause(); } throw new Error(`Timeout: ${description}`); }
function graph(second = false): Graph { return { ...createEmptyGraph(), nodes: [
 { id: 'start', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
 { id: 'gate', type: 'approval', label: 'Review', position: { x: 1, y: 0 }, config: { reviewer: 'development-queue', reason: 'Check exact pending data' } },
 { id: 'set', type: 'set', label: 'Set', position: { x: 2, y: 0 }, config: { fields: { checked: true, pair: { b: 2, a: 1 } } } },
 ...(second ? [{ id: 'gate2', type: 'approval', label: 'Second review', position: { x: 3, y: 0 }, config: { reviewer: 'development-queue', reason: 'Fresh second review' } }] : []),
 { id: 'out', type: 'output', label: 'Out', position: { x: 4, y: 0 }, config: {} },
 ], edges: (second ? ['start', 'gate', 'set', 'gate2'] : ['start', 'gate', 'set']).map((source, i, all) => ({ id: `e${i}`, source, target: all[i + 1] ?? 'out' })) }; }
export async function runApprovalBrowserChecks() {
 const checks: string[] = [], calls: { method: string; url: string }[] = [];
 const host = document.getElementById('fixture')!; let root = createRoot(host);
 const button = (name: string) => { const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name); if (!found) throw new Error(`Missing button: ${name}`); return found; };
 root.render(<StudioApp />); await until(() => !!host.querySelector('.wf-editor'), 'real Studio mount');
 const editor = host.querySelector('.wf-editor'), workspace = host.querySelector('.wf-workspace'), resources = host.querySelector('.resource-library');
 const name = host.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')!;
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Retained development graph'); name.dispatchEvent(new Event('input', { bubbles: true })); await pause();
 for (const label of ['Approvals', 'Resources', 'AI builder', 'Workflow builder']) { button(label).click(); await pause(); assert(host.querySelector('.wf-editor') === editor && host.querySelector('.wf-workspace') === workspace && host.querySelector('.resource-library') === resources, 'navigation remounted retained areas'); }
 assert(name.value === 'Retained development graph', 'typed editor draft lost across four areas');
 button('Approvals').click(); await pause(); assert((host.querySelector('[aria-label="Refresh approvals"]') as HTMLButtonElement).disabled, 'unauthenticated refresh enabled');
 assert(!host.textContent?.includes('No approvals in this checked project'), 'default fake empty queue'); checks.push('Real Studio four-area retained DOM/draft and default auth-disabled approvals');
 root.unmount(); host.replaceChildren(); root = createRoot(host);
 let independent = false;
 const fetcher: typeof fetch = (...args) => {
  const [url, init] = args; const headers = new Headers(init?.headers); headers.set('x-development-reviewer', independent ? 'independent-test-sentinel' : 'self-test-sentinel'); calls.push({ url: String(url), method: init?.method ?? 'GET' });
  return fetch(url, { ...init, headers });
 };
 const workspaceClient = new WorkspaceClient('development', token, (...args) => fetcher(...args));
 const draft = await workspaceClient.create(graph()); const run = await workspaceClient.run(draft.id, 1, { original: 42 });
 assert(run.resumable && run.pauseDisposition === 'review-pending', 'new public durable DTO rejected');
 assert((await new WorkspaceClient('development', token).getRun(draft.id, run.id)).id === run.id, 'default native Fetch receiver failed');
 const controller = new ApprovalController(fetcher);
 root.render(<WorkflowApprovals controller={controller} projectId="development" token={token} />);
 await until(() => controller.getState().connected, 'approval scope'); const before = calls.length; await pause(100); assert(calls.length === before, 'automatic mount requests');
 button('Refresh approvals').click(); await until(() => controller.getState().approvals !== null, 'queue list'); const id = controller.getState().approvals!.find(a => a.runId === run.id)!.id;
 button(`Review ${id}`).click(); await until(() => controller.getState().phase === 'error', 'self review refusal');
 assert(controller.getState().error?.includes('initiator cannot review'), 'self-review not refused'); assert(!host.querySelector('[aria-label="Confirm exact context digest"]'), 'self-review leaked context/actions'); checks.push('Real composition root self-review 403 with no private context or approval action');
 independent = true; button(`Review ${id}`).click(); await until(() => controller.getState().review !== null, 'independent exact review');
 const beforeDecision = calls.filter(c => c.method === 'POST' && c.url.includes('/decisions')).length;
 assert(button('Approve and resume').disabled && button('Reject').disabled, 'decision enabled before human acknowledgement');
 assert(host.textContent?.includes('Check exact pending data') && host.textContent.includes('original') && host.textContent.includes('Complete immutable graph snapshot'), 'load-bearing context hidden');
 (host.querySelector('[aria-label="Confirm exact context digest"]') as HTMLInputElement).click(); await pause(); button('Approve and resume').click(); button('Approve and resume').click();
 await until(() => controller.getState().detail?.state === 'completed' || controller.getState().phase === 'error', 'approve exact readback');
 assert(!controller.getState().error, controller.getState().error ?? 'decision failed');
 assert(calls.filter(c => c.method === 'POST' && c.url.includes('/decisions')).length === beforeDecision + 1, 'duplicate decision sent');
 assert(controller.getState().detail!.id === run.id && host.textContent?.includes('Human reviewer: Development Independent Reviewer'), 'original run/reviewer readback absent'); assert(!controller.getState().acknowledged, 'ack not discarded after response'); checks.push('Exact native Web Crypto review, explicit acknowledgement, one POST, approval/run/history readbacks');
 const secondDraft = await workspaceClient.create(graph(true)), secondRun = await workspaceClient.run(secondDraft.id, 1, { original: 7 });
 button('Refresh approvals').click(); await until(() => controller.getState().phase === 'idle' && !!controller.getState().approvals?.some(a => a.runId === secondRun.id), 'second queue refresh');
 const firstGate = controller.getState().approvals!.find(a => a.runId === secondRun.id && a.state === 'pending')!;
 button(`Review ${firstGate.id}`).click(); await until(() => controller.getState().review?.id === firstGate.id, 'second original review');
 (host.querySelector('[aria-label="Confirm exact context digest"]') as HTMLInputElement).click(); await pause(); button('Approve and resume').click(); await until(() => controller.getState().detail?.id === secondRun.id, 'new pause readback');
 assert(controller.getState().detail?.state === 'paused' && controller.getState().message?.includes('subsequent gate') && !controller.getState().acknowledged, 'new gate falsely reported completed');
 button('Refresh approvals').click(); await until(() => controller.getState().phase === 'idle' && !!controller.getState().approvals?.some(a => a.nodeId === 'gate2'), 'next gate queue');
 const next = controller.getState().approvals!.find(a => a.runId === secondRun.id && a.nodeId === 'gate2')!; assert(next.id !== firstGate.id && next.contextDigest !== firstGate.contextDigest, 'gate binding reused');
 button(`Review ${next.id}`).click(); await until(() => controller.getState().review?.id === next.id, 'next gate context'); assert(button('Reject').disabled, 'second gate reused acknowledgement');
 (host.querySelector('[aria-label="Confirm exact context digest"]') as HTMLInputElement).click(); await pause(); button('Reject').click(); await until(() => controller.getState().detail?.state === 'blocked' || controller.getState().phase === 'error', 'reject readbacks');
 assert(!controller.getState().error && controller.getState().detail?.id === secondRun.id && controller.getState().message?.includes('Rejection'), 'rejection unconfirmed'); checks.push('Sequential new gate fresh ID/digest/ack and rejection original-run readback');
 button(`Review ${firstGate.id}`).click(); await until(() => controller.getState().review?.id === firstGate.id, 'scope masking setup');
 root.render(<WorkflowApprovals controller={controller} projectId="different-project" token="changed-nonsecret-test-scope" />); await pause(); assert(!host.querySelector('[aria-label="Exact approval context"]') && !host.querySelector('[aria-label="Persisted run detail"]'), 'previous private payload leaked on scope change'); checks.push('Scope-change masking and acknowledgement reset');
 root.unmount(); host.replaceChildren(); root = createRoot(host);
 const disabledFetcher: typeof fetch = (url, init) => fetch(String(url).replace('/api/', '/disabled-api/'), init);
 const disabledController = new ApprovalController(disabledFetcher);
 root.render(<WorkflowApprovals controller={disabledController} projectId="development" token={token} />); await until(() => disabledController.getState().connected, 'disabled scope');
 button('Refresh approvals').click(); await until(() => disabledController.getState().phase === 'error', 'default unconfigured 503');
 assert(disabledController.getState().error?.includes('Independent review runtime not configured'), 'unconfigured runtime not distinguished'); assert(!host.textContent?.includes('No approvals in this checked project') && !host.textContent?.includes('Approve and resume'), 'unconfigured fake queue/action'); checks.push('New default composition root authenticated 503 remains blocked (no fake empty queue)');
 return { developmentOnly: true, checks, requests: calls.length, decisions: calls.filter(c => c.url.includes('/decisions')).length, originalRunIds: [run.id, secondRun.id] };
}
