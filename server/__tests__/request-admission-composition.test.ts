import { expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from '../index';
import { createFileWorkflowWorkspaceStore } from '../workflow-workspace-store';
import { WorkflowApprovalStore } from '../workflow-approval-store';
import { ResourceStore } from '../../packages/resources/store';
import { ResourceRegistry } from '../../packages/resources/registry';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
import { createEmptyGraph, type Graph } from '../../packages/workflow/graph';
const operator = { actor: 'Alice Operator', token: 'admission-root-fixture-token-at-least-24-chars' };
const headers = { authorization: `Bearer ${operator.token}` };
const reviewer = { authorization: 'Bearer independent-reviewer-fixture' };
function barrier() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
const graph = (middle: Graph['nodes'][number]): Graph => ({ ...createEmptyGraph(), nodes: [
  { id: 'start', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} }, middle,
  { id: 'out', type: 'output', label: 'Out', position: { x: 2, y: 0 }, config: {} },
], edges: [{ id: 'a', source: 'start', target: middle.id }, { id: 'b', source: middle.id, target: 'out' }] });
it('uses trusted reviewer identity for actor limits and validated project scope independent of global room', async () => {
  const dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'admission-reviewer-'));
  const modelGate = barrier(), reviewGate = barrier(); let modelEntered = 0, reviewEntered = 0;
  const workspace = createFileWorkflowWorkspaceStore(join(dir, 'workspace.json'));
  const approvals = new WorkflowApprovalStore(join(dir, 'approvals'));
  const app = createServer({ operator, store: createMemoryGrantStore(), llmBindingId: 'reviewer-fixture', llm: async () => { modelEntered++; await modelGate.promise; return { text: 'invalid' }; }, requestAdmission: { global: 4, actor: 1, project: 1 }, workflowWorkspaceStore: workspace, workflowApprovals: { store: approvals, resolveIdentity: async req => req.headers.authorization === reviewer.authorization ? { name: 'Bob Reviewer', active: true } : null, authorize: async (_identity, scope) => { if (scope.action === 'decide' && scope.nodeId) { reviewEntered++; await reviewGate.promise; } return true; } } });
  const records: Array<{ project: string; approval: any }> = [];
  let model: PromiseLike<unknown> | undefined, deciding: PromiseLike<unknown> | undefined;
  const decide = (project: string, a: any) => app.inject({ method: 'POST', url: `/api/studio/workspaces/${project}/approvals/${a.id}/decisions`, headers: reviewer, payload: { approvalId: a.id, revision: a.revision, decision: 'approve', contextDigest: a.contextDigest } });
  try {
    for (const project of ['alpha', 'beta']) {
      const base = `/api/studio/workspaces/${project}/workflows`;
      const draft = (await app.inject({ method: 'POST', url: base, headers, payload: { graph: graph({ id: 'gate', type: 'approval', label: 'Review', position: { x: 1, y: 0 }, config: { reviewer: 'finance-queue', reason: 'Review exact output' } }) } })).json().draft;
      expect((await app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input: {} } })).statusCode).toBe(201);
      const queue = `/api/studio/workspaces/${project}/approvals`;
      const id = (await app.inject({ url: queue, headers: reviewer })).json().approvals[0].id;
      records.push({ project, approval: (await app.inject({ url: `${queue}/${id}/review`, headers: reviewer })).json().approval });
    }
    model = app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.', projectId: 'alpha' } });
    await vi.waitFor(() => expect(modelEntered).toBe(1));
    expect((await decide('alpha', records[0]!.approval)).statusCode).toBe(429); // project, different trusted actor
    deciding = decide('beta', records[1]!.approval); // Bob is not the operator's actor bucket
    await vi.waitFor(() => expect(reviewEntered).toBe(1));
    modelGate.release(); await model;
    expect((await decide('alpha', records[0]!.approval)).statusCode).toBe(429); // Bob actor, different project
    expect((await approvals.read(records[0]!.approval.id)).state).toBe('pending');
    reviewGate.release(); const result = await deciding as any; expect(result.statusCode).toBe(200);
    expect(result.json().run.initiatedBy).toBe(operator.actor); expect(result.json().approval.decisionBy).toBe('Bob Reviewer');
  } finally { modelGate.release(); reviewGate.release(); await model; await deciding; await app.close(); await rm(dir, { recursive: true, force: true }); }
});
it('retains saved-run admission after engine timeout while the soft-aborted adapter is still running', async () => {
  const dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'admission-engine-'));
  const gate = barrier(); let signal: AbortSignal | undefined, calls = 0;
  const resources = new ResourceStore(join(dir, 'resources'));
  const registry = new ResourceRegistry([{ id: 'measure', kind: 'rest', projects: ['alpha'], endpoint: 'http://127.0.0.1:12345/fixture', method: 'GET', input: { type: 'object', properties: {}, required: [], additionalProperties: false }, output: { type: 'object', properties: {}, required: [], additionalProperties: false } }], { developmentOrigins: ['http://127.0.0.1:12345'] });
  const proposed = await resources.propose('alpha', { name: 'DEVELOPMENT ignoring-abort adapter fixture', functions: ['measure'] }, operator.actor);
  const active = await registry.activate(resources, 'alpha', proposed.id, 1, 'Bob Reviewer');
  // A deliberately broken trusted adapter fixture. No network/provider/effect is invoked.
  vi.spyOn(registry, 'execute').mockImplementation(async (_record, _function, _parameters, _actor, supplied) => { calls++; signal = supplied; await gate.promise; return { output: {}, durationMs: 0, resourceId: _record.id, revision: _record.revision, functionId: _function }; });
  const workspace = createFileWorkflowWorkspaceStore(join(dir, 'workspace.json'));
  const reserve = vi.spyOn(workspace, 'reserveRun');
  const app = createServer({ operator, store: createMemoryGrantStore(), workflowWorkspaceStore: workspace, requestAdmission: { global: 1 }, workflowResources: { store: resources, registry, authorize: async () => true } });
  const base = '/api/studio/workspaces/alpha/workflows';
  try {
    const g = graph({ id: 'read', type: 'resource', label: 'Read', position: { x: 1, y: 0 }, config: { resourceId: proposed.id, revision: active.revision, functionId: 'measure' } });
    const first = (await app.inject({ method: 'POST', url: base, headers, payload: { graph: g } })).json().draft;
    const second = (await app.inject({ method: 'POST', url: base, headers, payload: { graph: g } })).json().draft;
    const timed = await app.inject({ method: 'POST', url: `${base}/${first.id}/runs`, headers, payload: { revision: 1, input: {} } });
    expect(timed.statusCode).toBe(201); expect(timed.json().run.result.reason).toBe('Adapter timed out; side effects may already have occurred');
    expect(signal?.aborted).toBe(true); expect(calls).toBe(1);
    expect((await app.inject({ method: 'POST', url: `${base}/${second.id}/runs`, headers, payload: { revision: 1, input: {} } })).statusCode).toBe(429);
    expect(reserve).toHaveBeenCalledTimes(1); expect(await workspace.listRuns('alpha', second.id)).toEqual([]);
    gate.release(); await new Promise(resolve => setTimeout(resolve, 20));
    const response = await app.inject({ method: 'POST', url: `${base}/${second.id}/runs`, headers, payload: { revision: 1, input: {} } }); expect(response.statusCode).toBe(201);
    expect(calls).toBe(2);
  } finally { gate.release(); await app.close(); await rm(dir, { recursive: true, force: true }); }
}, 10000); // Exercises the unchanged real 5-second workflow-engine deadline.
it('refuses saved runs, resource invocations and approval decisions before reservations or adapters at the real root', async () => {
  const dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'admission-root-'));
  const gate = barrier(); let entered = 0, hits = 0;
  const remote = Fastify(); remote.get('/measure', async () => { hits++; return { measured: true }; });
  const origin = await remote.listen({ host: '127.0.0.1', port: 0 });
  const resources = new ResourceStore(join(dir, 'resources'));
  const registry = new ResourceRegistry([{ id: 'measure', kind: 'rest', projects: ['alpha'], endpoint: origin + '/measure', method: 'GET', input: { type: 'object', properties: {}, required: [], additionalProperties: false }, output: { type: 'object', properties: { measured: { type: 'boolean' } }, required: ['measured'], additionalProperties: false } }], { developmentOrigins: [origin] });
  const r = await resources.propose('alpha', { name: 'DEVELOPMENT fixture', functions: ['measure'] }, operator.actor);
  const active = await registry.activate(resources, 'alpha', r.id, 1, 'Bob Reviewer');
  const workspace = createFileWorkflowWorkspaceStore(join(dir, 'workspace.json'));
  const approvals = new WorkflowApprovalStore(join(dir, 'approvals'));
  const reserve = vi.spyOn(workspace, 'reserveRun'); const execute = vi.spyOn(registry, 'execute'); const claim = vi.spyOn(approvals, 'claim');
  const app = createServer({ operator, store: createMemoryGrantStore(), llmBindingId: 'root-fixture', llm: async () => { entered++; await gate.promise; return { text: 'invalid determination' }; }, requestAdmission: { global: 1 }, workflowWorkspaceStore: workspace, workflowResources: { store: resources, registry, authorize: async () => true }, workflowApprovals: { store: approvals, resolveIdentity: async req => req.headers.authorization === reviewer.authorization ? { name: 'Bob Reviewer', active: true } : null, authorize: async () => true } });
  const base = '/api/studio/workspaces/alpha/workflows';
  let pending: PromiseLike<unknown> | undefined;
  try {
    const pausedDraft = (await app.inject({ method: 'POST', url: base, headers, payload: { graph: graph({ id: 'gate', type: 'approval', label: 'Review', position: { x: 1, y: 0 }, config: { reviewer: 'finance-queue', reason: 'Review exact output' } }) } })).json().draft;
    const paused = await app.inject({ method: 'POST', url: `${base}/${pausedDraft.id}/runs`, headers, payload: { revision: 1, input: {} } }); expect(paused.statusCode).toBe(201);
    const reviewBase = '/api/studio/workspaces/alpha/approvals';
    const aid = (await app.inject({ url: reviewBase, headers: reviewer })).json().approvals[0].id;
    const approval = (await app.inject({ url: `${reviewBase}/${aid}/review`, headers: reviewer })).json().approval;
    const resourceGraph = graph({ id: 'read', type: 'resource', label: 'Read', position: { x: 1, y: 0 }, config: { resourceId: r.id, revision: active.revision, functionId: 'measure' } });
    const draft = (await app.inject({ method: 'POST', url: base, headers, payload: { graph: resourceGraph } })).json().draft;
    reserve.mockClear();
    pending = app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.', projectId: 'novel-project' } });
    await vi.waitFor(() => expect(entered).toBe(1));
    const runRequest = { method: 'POST' as const, url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input: {} } };
    expect((await app.inject(runRequest)).statusCode).toBe(429);
    expect(reserve).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: `/api/studio/workspaces/alpha/resources/${r.id}/execute`, headers, payload: { revision: active.revision, functionId: 'measure', parameters: {} } })).statusCode).toBe(429);
    expect(execute).not.toHaveBeenCalled(); expect(hits).toBe(0);
    expect((await app.inject({ method: 'POST', url: `${reviewBase}/${aid}/decisions`, headers: reviewer, payload: { approvalId: aid, revision: approval.revision, decision: 'approve', contextDigest: approval.contextDigest } })).statusCode).toBe(429);
    expect(claim).not.toHaveBeenCalled(); expect((await approvals.read(aid)).state).toBe('pending');
    expect((await app.inject({ ...runRequest, headers: {} })).statusCode).toBe(401);
    gate.release(); await pending;
    const completed = await app.inject(runRequest); expect(completed.statusCode).toBe(201); expect(completed.json().run.result.status).toBe('completed');
    expect(hits).toBe(1); expect(reserve).toHaveBeenCalledTimes(1);
    expect((await app.inject(runRequest)).statusCode).toBe(409); expect(hits).toBe(1);
  } finally { gate.release(); await pending; await app.close(); await remote.close(); await rm(dir, { recursive: true, force: true }); }
});
