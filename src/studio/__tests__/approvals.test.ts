import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createEmptyGraph, type Graph } from '../../../packages/workflow/graph';
import { createFileWorkflowWorkspaceStore } from '../../../server/workflow-workspace-store';
import { registerWorkflowWorkspaceRoutes } from '../../../server/workflow-workspace';
import { WorkflowApprovalStore } from '../../../server/workflow-approval-store';
import { WorkspaceClient, runSchema } from '../workspace-client';
import { ApprovalClient, sha256, validateApprovalReview } from '../approval-client';
import { ApprovalController } from '../approval-controller';
import { WorkspaceRunDetail } from '../WorkflowWorkspace';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
let app: FastifyInstance, dir: string;
const operator = 'development-initiator-sentinel', reviewer = 'development-reviewer-sentinel';
export function approvalGraph(): Graph { return { ...createEmptyGraph(), nodes: [
 { id: 'start', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
 { id: 'gate', type: 'approval', label: 'Review', position: { x: 1, y: 0 }, config: { reviewer: 'development-queue', reason: 'Check exact pending data' } },
 { id: 'set', type: 'set', label: 'Set', position: { x: 2, y: 0 }, config: { fields: { checked: true } } },
 { id: 'out', type: 'output', label: 'Output', position: { x: 3, y: 0 }, config: {} },
 ], edges: ['start', 'gate', 'set'].map((source, i) => ({ id: `e${i}`, source, target: ['gate', 'set', 'out'][i]! })) }; }
const transport: typeof fetch = async (url, init) => {
 const r = await app.inject({ method: (init?.method ?? 'GET') as 'GET' | 'POST', url: String(url), headers: Object.fromEntries(new Headers(init?.headers)), ...(init?.body ? { payload: String(init.body) } : {}) });
 return new Response(r.body, { status: r.statusCode, headers: r.headers as Record<string, string> });
};
beforeEach(async () => {
 dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'browser-approval-')); app = Fastify();
 registerWorkflowWorkspaceRoutes(app, { actor: 'Development Initiator', authenticate: h => h === `Bearer ${operator}` || h === `Bearer ${reviewer}`, store: createFileWorkflowWorkspaceStore(join(dir, 'workspace.json')), approvals: {
  store: new WorkflowApprovalStore(join(dir, 'approvals')), resolveIdentity: async req => req.headers.authorization === `Bearer ${operator}` ? { name: 'Development Initiator', active: true } : req.headers.authorization === `Bearer ${reviewer}` ? { name: 'Development Independent Reviewer', active: true } : null,
  authorize: async (_p, scope) => scope.projectId === 'development' && (!scope.nodeId || scope.reviewer === 'development-queue'),
 } });
});
afterEach(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
async function pause(graph = approvalGraph()) { const client = new WorkspaceClient('development', operator, transport); const draft = await client.create(graph); return client.run(draft.id, draft.revision, { original: 42 }); }
it('accepts real durable review-pending run and rejects contradictory availability', async () => {
 const run = await pause();
 expect(run).toMatchObject({ state: 'paused', resumable: true, pauseDisposition: 'review-pending' });
 expect(runSchema.safeParse({ ...run, resumable: false }).success).toBe(false);
 expect(runSchema.safeParse({ ...run, pauseDisposition: 'unavailable-no-resume' }).success).toBe(false);
});
it('verifies exact real ordered review context before decision and refuses self review', async () => {
 const run = await pause(); const client = new ApprovalClient('development', reviewer, transport);
 const listed = await client.list(); expect(listed).toHaveLength(1);
 const review = await client.review(listed[0]!.id);
 expect(review.context).toMatchObject({ runId: run.id, pendingData: { original: 42 }, initiator: 'Development Initiator' });
 await expect(new ApprovalClient('development', operator, transport).review(review.id)).rejects.toMatchObject({ code: 403 });
 const receipt = await client.decide(review, 'approve');
 expect(receipt).toMatchObject({ approval: { state: 'consumed' }, run: { id: run.id, state: 'completed' } });
 expect(await client.workspace.getRun(run.draftId, run.id)).toEqual(receipt.run);
 expect((await client.review(review.id)).decisionBy).toBe('Development Independent Reviewer');
});
it('requires explicit fresh digest acknowledgement, performs one decision and exact approval/run/history readbacks', async () => {
 const run = await pause(), calls: string[] = [];
 const c = new ApprovalController(async (url, init) => { calls.push(`${init?.method ?? 'GET'} ${url}`); return transport(url, init); });
 c.setScope('development', reviewer); expect(calls).toEqual([]);
 await c.refresh(); const id = c.getState().approvals![0]!.id;
 await c.select(id); await c.decide('approve'); expect(calls.some(x => x.startsWith('POST'))).toBe(false);
 c.acknowledge(true); await Promise.all([c.decide('approve'), c.decide('approve')]);
 expect(calls.filter(x => x.startsWith('POST'))).toHaveLength(1);
 expect(calls.slice(-3)).toEqual([`GET /api/studio/workspaces/development/approvals/${id}/review`, `GET /api/studio/workspaces/development/workflows/${run.draftId}/runs/${run.id}`, `GET /api/studio/workspaces/development/workflows/${run.draftId}/runs`]);
 expect(c.getState()).toMatchObject({ acknowledged: false, detail: { id: run.id, state: 'completed' }, review: { state: 'consumed' } });
 expect(c.getState().message).toContain('read back');
});
it('initiator history points review-pending to Approvals without an approval action and retains unavailable legacy status', async () => {
 const run = await pause();
 const html = renderToStaticMarkup(createElement(WorkspaceRunDetail, { run }));
 expect(html).toContain('Independent review pending'); expect(html).toContain('Approvals'); expect(html).not.toContain('Approve and resume');
 expect(html).not.toContain('resumable: false');
 const old = { ...run, resumable: false, pauseDisposition: 'unavailable-no-resume' as const };
 expect(runSchema.safeParse(old).success).toBe(true);
 expect(renderToStaticMarkup(createElement(WorkspaceRunDetail, { run: old }))).toContain('Resume unavailable');
 const client = new ApprovalClient('development', reviewer, transport); const a = await client.review((await client.list())[0]!.id);
 const receipt = await client.decide(a, 'approve');
 expect(renderToStaticMarkup(createElement(WorkspaceRunDetail, { run: receipt.run }))).toContain('Human reviewer: Development Independent Reviewer');
});


it('does not accept a consumed decision receipt without actual recorded human evidence', async () => {
 await pause(); const client = new ApprovalClient('development', reviewer, transport); const a = await client.review((await client.list())[0]!.id);
 const bad = new ApprovalClient('development', reviewer, async (url, init) => {
  const r = await transport(url, init);
  if (init?.method !== 'POST') return r;
  const body = await r.json(); delete body.approval.decisionBy; delete body.approval.decidedAt;
  return Response.json(body);
 });
 await expect(bad.decide(a, 'approve')).rejects.toMatchObject({ code: 'invalid' });
});
it('rejects claimed human names on non-approval or unfinished trace entries', async () => {
 const run = await pause();
 const copied = structuredClone(run); copied.result!.trace[0]!.humanName = 'Development Independent Reviewer';
 expect(runSchema.safeParse(copied).success).toBe(false);
 const paused = structuredClone(run); paused.result!.trace[1]!.humanName = 'Development Independent Reviewer';
 expect(runSchema.safeParse(paused).success).toBe(false);
});
it('refuses sorted-digest-equivalent object-key reorder in exact run readback', async () => {
 const graph = approvalGraph(); graph.nodes.find(n => n.id === 'set')!.config = { fields: { pair: { b: 2, a: 1 } } };
 await pause(graph); let decided = false;
 const c = new ApprovalController(async (url, init) => {
  const r = await transport(url, init); if (init?.method === 'POST') decided = true;
  if (!decided || init?.method === 'POST' || !String(url).includes('/runs')) return r;
  const body = await r.json();
  for (const run of body.runs ?? [body.run]) run.graphSnapshot.nodes.find((n: any) => n.id === 'set').config.fields.pair = { a: 1, b: 2 };
  return Response.json(body);
 });
 c.setScope('development', reviewer); await c.refresh(); await c.select(c.getState().approvals![0]!.id); c.acknowledge(true); await c.decide('approve');
 expect(c.getState().message).toBeNull(); expect(c.getState().error).toContain('readback mismatch'); expect(c.getState().acknowledged).toBe(false);
});
it('refuses modified, sorted-key, foreign, unsafe, oversized and wrongly bound contexts before any POST', async () => {
 await pause(); const client = new ApprovalClient('development', reviewer, transport); const a = await client.review((await client.list())[0]!.id);
 for (const mutate of [
  (v: typeof a) => { v.context.pendingData = { changed: true }; },
  (v: typeof a) => { v.contextDigest = '0'.repeat(64); },
  (v: typeof a) => { v.context.runId = '11111111-1111-4111-8111-111111111111'; },
  (v: typeof a) => { v.context.gate = { reviewer: 'foreign' }; },
  (v: typeof a) => { v.context.resourceReferences = [{ nodeId: 'out', functionId: 'other' }]; },
  (v: typeof a) => { v.context.pendingData = { data: 'x'.repeat(100_001) }; },
 ]) {
  const copied = structuredClone(a); mutate(copied);
  // Even a self-consistent digest cannot replace scope, gate or references.
  if (copied.context.runId !== a.context.runId || copied.context.gate.reviewer !== a.context.gate.reviewer || copied.context.resourceReferences.length) copied.contextDigest = await sha256(JSON.stringify(copied.context));
  await expect(validateApprovalReview(copied, 'development', a.id)).rejects.toMatchObject({ code: 'invalid' });
 }
 const sorted = structuredClone(a); sorted.contextDigest = await sha256((await import('../workspace-client')).canonicalJson(sorted.context));
 await expect(validateApprovalReview(sorted, 'development', a.id)).rejects.toMatchObject({ code: 'invalid' });
 const getter = structuredClone(a); let accesses = 0;
 Object.defineProperty(getter.context, 'pendingData', { enumerable: true, get() { accesses++; return {}; } });
 await expect(validateApprovalReview(getter, 'development', a.id)).rejects.toMatchObject({ code: 'invalid' }); expect(accesses).toBe(0);
 const deep = structuredClone(a); let nested: any = {}; deep.context.pendingData = nested; for (let i = 0; i < 30; i++) nested = nested.next = {};
 await expect(validateApprovalReview(deep, 'development', a.id)).rejects.toMatchObject({ code: 'invalid' });
});
it('fails closed when native Web Crypto is unavailable', async () => {
 await pause(); const client = new ApprovalClient('development', reviewer, transport); const id = (await client.list())[0]!.id;
 vi.stubGlobal('crypto', {});
 try { await expect(client.review(id)).rejects.toMatchObject({ code: 'unavailable' }); } finally { vi.unstubAllGlobals(); }
});
it('caps streamed responses before parsing and rejects metadata containing private review fields', async () => {
 const client = new ApprovalClient('development', reviewer, async () => new Response('x'.repeat(4_000_001), { headers: { 'content-type': 'application/json' } }));
 await expect(client.list()).rejects.toMatchObject({ code: 'invalid' });
 await pause(); const real = new ApprovalClient('development', reviewer, transport); const list = await real.list();
 const bad = new ApprovalClient('development', reviewer, async () => Response.json({ approvals: [{ ...list[0], context: {} }] }));
 await expect(bad.list()).rejects.toThrow();
});
it('keeps unconfigured runtime blocked and distinguishes it from an authenticated empty inbox', async () => {
 await app.close(); app = Fastify(); registerWorkflowWorkspaceRoutes(app, { actor: 'Development Initiator', authenticate: h => h === `Bearer ${operator}`, store: createFileWorkflowWorkspaceStore(join(dir, 'workspace.json')) });
 const c = new ApprovalController(transport); c.setScope('development', operator); await c.refresh();
 expect(c.getState()).toMatchObject({ approvals: null, review: null, acknowledged: false, phase: 'error' });
 expect(c.getState().error).toContain('Independent review runtime not configured');
 await expect(new ApprovalClient('development', reviewer, transport).list()).rejects.toMatchObject({ code: 401 });
});
it('requires fresh acknowledgement at sequential gates and rejects the same original run by exact readback', async () => {
 const graph = approvalGraph(); graph.nodes.splice(3, 0, { id: 'gate2', type: 'approval', label: 'Second', position: { x: 4, y: 0 }, config: { reviewer: 'development-queue', reason: 'Second context' } });
 graph.edges[2]!.target = 'gate2'; graph.edges.push({ id: 'e3', source: 'gate2', target: 'out' });
 const run = await pause(graph); const c = new ApprovalController(transport); c.setScope('development', reviewer); await c.refresh(); await c.select(c.getState().approvals![0]!.id); const first = c.getState().review!;
 c.acknowledge(true); await c.decide('approve'); expect(c.getState().detail).toMatchObject({ id: run.id, state: 'paused', resumable: true }); expect(c.getState().message).toContain('subsequent gate');
 expect(c.canDecide).toBe(false); await c.refresh(); const next = c.getState().approvals!.find(a => a.state === 'pending')!; expect(next.id).not.toBe(first.id); expect(next.contextDigest).not.toBe(first.contextDigest);
 await c.select(next.id); expect(c.getState().acknowledged).toBe(false); expect(c.getState().review!.context.pendingData).toMatchObject({ checked: true });
 c.acknowledge(true); await c.decide('reject'); expect(c.getState().detail).toMatchObject({ id: run.id, state: 'blocked', resumable: false, result: { reason: 'Approval rejected' } }); expect(c.getState().message).toContain('Rejection');
});
it('refresh, selection, expiry and scope changes discard digest acknowledgement', async () => {
 await pause(); const c = new ApprovalController(transport); c.setScope('development', reviewer); await c.refresh(); const id = c.getState().approvals![0]!.id;
 await c.select(id); c.acknowledge(true); await c.refresh(); expect(c.getState()).toMatchObject({ review: null, acknowledged: false });
 await c.select(id); c.acknowledge(true); await c.select(id); expect(c.getState().acknowledged).toBe(false);
 c.acknowledge(true); const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(c.getState().review!.expiresAt));
 try { c.expire(); expect(c.canDecide).toBe(false); expect(c.getState().acknowledged).toBe(false); } finally { now.mockRestore(); }
 c.setScope('other', reviewer); expect(c.getState()).toMatchObject({ approvals: null, review: null, detail: null, history: null, acknowledged: false }); expect(c.canInspect).toBe(false);
});
it('suppresses stale selection and chained readbacks after credentials change even if transport ignores abort', async () => {
 await pause(); const calls: string[] = []; let release!: () => void; let started!: () => void;
 const gate = new Promise<void>(r => { release = r; }), waiting = new Promise<void>(r => { started = r; });
 const c = new ApprovalController(async (url, init) => { calls.push(String(url)); const r = await transport(url, init); if (String(url).endsWith('/review')) { started(); await gate; } return r; });
 c.setScope('development', reviewer); await c.refresh(); const id = c.getState().approvals![0]!.id;
 const pending = c.select(id); await waiting; c.setScope('development', operator); release(); await pending;
 expect(c.getState()).toMatchObject({ approvals: null, review: null, acknowledged: false, message: null, error: null }); expect(calls).toHaveLength(2);
});
it('lost decision response stays uncertain, never retries and permits only explicit actual history inspection', async () => {
 const run = await pause(); let posts = 0;
 const c = new ApprovalController(async (url, init) => { const r = await transport(url, init); if (init?.method === 'POST') { posts++; throw new Error('lost response after server write'); } return r; });
 c.setScope('development', reviewer); await c.refresh(); await c.select(c.getState().approvals![0]!.id); c.acknowledge(true); await c.decide('approve');
 expect(c.getState().error).toContain('claimed decision may already execute'); expect(c.getState().message).toBeNull(); await c.decide('approve'); expect(posts).toBe(1);
 await c.inspectHistory(); expect(c.getState().detail).toMatchObject({ id: run.id, state: 'completed' }); expect(c.getState().message).toContain('Status is not evidence'); expect(c.getState().acknowledged).toBe(false);
});
it('stale revision 409 clears confirmation and does not infer success from status or retry', async () => {
 await pause(); const client = new ApprovalClient('development', reviewer, transport); const c = new ApprovalController(transport); c.setScope('development', reviewer); await c.refresh(); await c.select(c.getState().approvals![0]!.id);
 await client.decide(c.getState().review!, 'approve'); c.acknowledge(true); await c.decide('approve');
 expect(c.getState().error).toContain('Approval conflict'); expect(c.getState()).toMatchObject({ review: null, acknowledged: false, message: null });
});
it('StrictMode cleanup of an idle inbox does not invent a cancelled request', () => {
 const c = new ApprovalController(transport); c.setScope('development', reviewer); c.cancel();
 expect(c.getState().message).toBeNull(); expect(c.getState().review).toBeNull();
});
it('workspace transport is called without a client-instance receiver', async () => {
 const nativeLike: typeof fetch = function(this: unknown, url, init) { if (this !== undefined) throw new TypeError('Illegal invocation'); return transport(url, init); };
 const client = new WorkspaceClient('development', operator, nativeLike);
 expect(await client.list()).toEqual([]);
});
