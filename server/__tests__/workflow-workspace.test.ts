import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileWorkflowWorkspaceStore } from '../workflow-workspace-store';
import { registerWorkflowWorkspaceRoutes } from '../workflow-workspace';
import { createEmptyGraph, type Graph } from '../../packages/workflow/graph';

const base = '/api/studio/workspaces/project-one/workflows';
const headers = { authorization: 'Bearer test-only' };
let dir: string;
let app: FastifyInstance;
let file: string;
function mount() {
  app = Fastify({ logger: false });
  registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: h => h === headers.authorization, store: createFileWorkflowWorkspaceStore(file) });
}
beforeEach(async () => {
  dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'workflow-workspace-'));
  file = join(dir, 'workspace.json');
  mount();
});
afterEach(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
async function save(graph: Graph = createEmptyGraph()) {
  const response = await app.inject({ method: 'POST', url: base, headers, payload: { graph } });
  expect(response.statusCode).toBe(201);
  return response.json().draft;
}
function linear(type = 'set', config: Record<string, any> = { fields: { answer: 42 } }): Graph {
  return { ...createEmptyGraph(), nodes: [
    { id: 'start', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'step', type, label: 'Step', position: { x: 100, y: 0 }, config },
    { id: 'out', type: 'output', label: 'Output', position: { x: 200, y: 0 }, config: {} },
  ], edges: [{ id: 'a', source: 'start', target: 'step' }, { id: 'b', source: 'step', target: 'out' }] };
}
describe('durable authenticated workspace', () => {
  it('serializes compare-and-swap and independent concurrent creates without lost data', async () => {
    const [a, b] = await Promise.all([save(), save()]);
    const edit = (id: string, expectedRevision: number) => app.inject({ method: 'PUT', url: `${base}/${id}`, headers, payload: { graph: createEmptyGraph('Edited'), expectedRevision } });
    const responses = await Promise.all([edit(a.id, 1), edit(a.id, 1)]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect((await edit(b.id, 1)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: base, headers })).json().drafts).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: `${base.replace('project-one', 'other')}/${a.id}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `${base.replace('project-one', 'other')}/${a.id}`, headers, payload: { graph: createEmptyGraph(), expectedRevision: 2 } })).statusCode).toBe(404);
  });
  it('binds approval identity, type and config while permitting incomplete editable drafts', async () => {
    const graph = linear('approval', { reviewer: 'Bob Reviewer', reason: 'Review' });
    const draft = await save(graph);
    for (const changed of [createEmptyGraph(), linear(), linear('approval', { reviewer: 'Alice Operator', reason: 'Review' })]) {
      const r = await app.inject({ method: 'PUT', url: `${base}/${draft.id}`, headers, payload: { graph: changed, expectedRevision: 1 } });
      expect(r.statusCode).toBe(409);
    }
    const disconnected = { ...graph, edges: [] };
    expect((await app.inject({ method: 'PUT', url: `${base}/${draft.id}`, headers, payload: { graph: disconnected, expectedRevision: 1 } })).statusCode).toBe(200);
  });
  it('authenticates all seven routes before parsing bodies, touching stores or acquiring adapters', async () => {
    await app.close(); app = Fastify();
    const touched = vi.fn(() => { throw new Error('must not touch'); });
    registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: () => false, store: new Proxy({} as ReturnType<typeof createFileWorkflowWorkspaceStore>, { get: touched }), adaptersFor: touched });
    const id = '11111111-1111-4111-8111-111111111111';
    const routes = [['GET', base], ['POST', base], ['GET', `${base}/${id}`], ['PUT', `${base}/${id}`], ['POST', `${base}/${id}/runs`], ['GET', `${base}/${id}/runs`], ['GET', `${base}/${id}/runs/${id}`]] as const;
    for (const [method, url] of routes) {
      const response = await app.inject({ method, url: url.replace('project-one', 'INVALID'), ...(method === 'POST' || method === 'PUT' ? { headers: { 'content-type': 'application/json' }, payload: '{invalid-json' } : {}) });
      expect(response.statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: base, headers: { 'content-type': 'application/json' }, payload: 'x'.repeat(400_000) })).statusCode).toBe(401);
    expect(touched).not.toHaveBeenCalled();
  });
  it('rejects malformed, oversized, secret and prototype-bearing graph/input without execution', async () => {
    const draft = await save(linear());
    for (const graph of [{ ...linear(), unexpected: true }, linear('llm', { instruction: 'Bearer abcdefghijklmno' }), { ...createEmptyGraph(), name: 'Bearer abcdefghijklmno' }, { ...linear(), nodes: Array(101).fill(linear().nodes[0]) }]) {
      expect((await app.inject({ method: 'POST', url: base, headers, payload: { graph } })).statusCode).toBe(400);
    }
    const bigGraph = linear(); bigGraph.nodes[1]!.config = { fields: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`field${i}`, 'x'.repeat(2000)])) };
    expect((await app.inject({ method: 'POST', url: base, headers, payload: { graph: bigGraph } })).statusCode).toBe(413);
    for (const input of [{ password: 'not-allowed' }, { value: 'Bearer abcdefghijklmno' }, JSON.parse('{"__proto__":{"x":1}}'), { value: Array(101).fill(1) }, Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field${i}`, 'x'.repeat(2000)]))]) {
      expect((await app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input } })).statusCode).toBeGreaterThanOrEqual(400);
    }
    expect((await app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input: {}, graph: linear() } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `${base}/${draft.id}/runs`, headers })).json().runs).toEqual([]);
  });
  it('sanitizes adapter failures and records blocked outcomes rather than provider/path details', async () => {
    await app.close(); app = Fastify();
    registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: h => h === headers.authorization, store: createFileWorkflowWorkspaceStore(file), adaptersFor: () => ({ llm: async () => { throw new Error('/private/provider/key Bearer sensitive-value'); } }) });
    const draft = await save(linear('llm', { instruction: 'Test fixture' }));
    const response = await app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input: {} } });
    expect(response.statusCode).toBe(201); expect(response.json().run.state).toBe('blocked');
    expect(response.body).not.toContain('/private'); expect(response.body).not.toContain('sensitive-value');
  });
  it('blocks unsafe trusted-adapter output before core normalization can strip prototype fields', async () => {
    await app.close(); app = Fastify();
    registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: () => true, store: createFileWorkflowWorkspaceStore(file), adaptersFor: () => ({ llm: async () => JSON.parse('{"__proto__":{"injected":true}}') }) });
    const draft = await save(linear('llm', { instruction: 'Explicit unsafe test fixture' }));
    const response = await app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input: {} } });
    expect(response.statusCode).toBe(201);
    expect(response.json().run.state).toBe('blocked');
    expect(response.json().run.result.output).toBeNull();
  });
  it('prevents concurrent/repeated execution and binds adapters to server actor/project only', async () => {
    await app.close(); app = Fastify();
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const llm = vi.fn(async () => { entered(); await barrier; return { fixture: 'trusted-test-adapter' }; });
    const adaptersFor = vi.fn(() => ({ llm }));
    registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: h => h === headers.authorization, store: createFileWorkflowWorkspaceStore(file), adaptersFor });
    const draft = await save(linear('llm', { instruction: 'Explicit test fixture' }));
    const url = `${base}/${draft.id}/runs`;
    for (const [target, revision] of [[url, 2], [url.replace('project-one', 'other'), 1]] as const) {
      expect((await app.inject({ method: 'POST', url: target, headers, payload: { revision, input: {} } })).statusCode).toBe(revision === 2 ? 409 : 404);
    }
    expect(adaptersFor).not.toHaveBeenCalled();
    const pending = app.inject({ method: 'POST', url, headers, payload: { revision: 1, input: {} } });
    // Fastify injection is thenable; explicitly start it before waiting for the adapter.
    const running = Promise.resolve(pending); await started;
    try {
      expect((await app.inject({ method: 'POST', url, headers, payload: { revision: 1, input: {} } })).statusCode).toBe(409);
      const history = (await app.inject({ method: 'GET', url, headers })).json().runs;
      expect(history[0]).toMatchObject({ state: 'running', result: null, finishedAt: null });
      expect((await app.inject({ method: 'PUT', url: `${base}/${draft.id}`, headers, payload: { graph: linear('set', { fields: { edited: true } }), expectedRevision: 1 } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url, headers, payload: { revision: 2, input: {} } })).statusCode).toBe(409);
    } finally { release(); }
    const response = await running;
    expect(response.statusCode).toBe(201); expect(response.json().run.draftRevision).toBe(1);
    expect(response.json().run.graphSnapshot).toEqual(draft.graph);
    expect(response.json().run.result.output).toEqual({ fixture: 'trusted-test-adapter' });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(adaptersFor).toHaveBeenCalledTimes(1);
    expect(adaptersFor).toHaveBeenCalledWith({ actor: 'Alice Operator', projectId: 'project-one' });
  });
  it('fails closed on disconnected/bypass graphs before acquiring adapters and has no approval endpoint', async () => {
    await app.close(); app = Fastify(); const adaptersFor = vi.fn(() => ({}));
    registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: h => h === headers.authorization, store: createFileWorkflowWorkspaceStore(file), adaptersFor });
    const graph = linear('approval', { reviewer: 'Bob Reviewer' });
    for (const invalid of [{ ...graph, edges: [] }, { ...graph, edges: [...graph.edges, { id: 'bypass', source: 'start', target: 'out' }] }]) {
      const draft = await save(invalid);
      const url = `${base}/${draft.id}/runs`;
      const r = await app.inject({ method: 'POST', url, headers, payload: { revision: 1, input: {} } });
      expect(r.statusCode).toBe(201); expect(r.json().run.state).toBe('blocked');
      expect((await app.inject({ method: 'POST', url: `${url}/${r.json().run.id}/resume`, headers, payload: { humanName: 'Alice Operator' } })).statusCode).toBe(404);
    }
    expect(adaptersFor).not.toHaveBeenCalled();
  });
  it('sanitizes corrupt-store errors and acquisition failures', async () => {
    const draft = await save(linear());
    const fs = await import('node:fs/promises');
    await fs.writeFile(file, '/private/sensitive/provider-path');
    const failed = await app.inject({ method: 'GET', url: `${base}/${draft.id}`, headers });
    expect(failed.statusCode).toBe(503); expect(failed.json()).toEqual({ error: 'workspace unavailable' });
    await fs.rm(file); await app.close(); app = Fastify();
    registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: () => true, store: createFileWorkflowWorkspaceStore(file), adaptersFor: () => { throw new Error('/private/sensitive/provider-path'); } });
    const fresh = await save(linear());
    const r = await app.inject({ method: 'POST', url: `${base}/${fresh.id}/runs`, headers, payload: { revision: 1, input: {} } });
    expect(r.statusCode).toBe(201); expect(r.json().run.state).toBe('blocked'); expect(r.body).not.toContain('/private');
  });
  it('executes the exact saved revision with real set output and durable history', async () => {
    const draft = await save(linear());
    const url = `${base}/${draft.id}/runs`;
    const stale = await app.inject({ method: 'POST', url, headers, payload: { revision: 2, input: {} } });
    expect(stale.statusCode).toBe(409);
    const response = await app.inject({ method: 'POST', url, headers, payload: { revision: 1, input: { original: true } } });
    expect(response.statusCode).toBe(201);
    const run = response.json().run;
    expect(run).toMatchObject({ draftId: draft.id, draftRevision: 1, state: 'completed', resumable: false, initiatedBy: 'Alice Operator', result: { status: 'completed', output: { original: true, answer: 42 }, trace: [{ nodeId: 'start', status: 'completed' }, { nodeId: 'step', status: 'completed' }, { nodeId: 'out', status: 'completed' }] } });
    expect(run.graphDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(run.graphSnapshot).toEqual(draft.graph);
    expect(run.startedAt).toBeTruthy(); expect(run.finishedAt).toBeTruthy();
    expect((await app.inject({ method: 'POST', url, headers, payload: { revision: 1, input: {} } })).statusCode).toBe(409);
    await app.close(); mount();
    expect((await app.inject({ method: 'GET', url: `${url}/${run.id}`, headers })).json().run).toEqual(run);
    expect((await app.inject({ method: 'GET', url, headers })).json().runs).toEqual([run]);
    expect((await app.inject({ method: 'GET', url: `${url.replace('project-one', 'other')}/${run.id}`, headers })).statusCode).toBe(404);
  });
  it('runs true and false branches using actual engine traces', async () => {
    const graph = linear('branch', { field: 'choice', operator: 'equals', value: true });
    graph.nodes.push({ id: 'other', type: 'output', label: 'False', position: { x: 200, y: 100 }, config: {} });
    graph.edges[1]!.sourcePort = 'true';
    graph.edges.push({ id: 'c', source: 'step', target: 'other', sourcePort: 'false' });
    for (const choice of [true, false]) {
      const draft = await save(graph);
      const r = await app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input: { choice } } });
      expect(r.statusCode).toBe(201);
      expect(r.json().run.result.output).toEqual({ choice });
      expect(r.json().run.result.trace).toContainEqual({ nodeId: choice ? 'other' : 'out', status: 'skipped' });
    }
  });
  it('records missing adapters and approval pauses without pretending to resume after restart', async () => {
    for (const graph of [linear('http', { url: 'https://example.com/', credentialRef: 'vaultRef' }), linear('llm', { instruction: 'Test instruction' }), linear('approval', { reviewer: 'Bob Reviewer' }), createEmptyGraph()]) {
      const draft = await save(graph);
      const response = await app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input: {} } });
      expect(response.statusCode).toBe(201);
      const run = response.json().run;
      expect(run.state).toBe(graph.nodes[1]?.type === 'approval' ? 'paused' : 'blocked');
      expect(run.resumable).toBe(false);
      if (run.state === 'paused') expect(run.pauseDisposition).toBe('unavailable-no-resume');
      await app.close(); mount();
      expect((await app.inject({ method: 'GET', url: `${base}/${draft.id}/runs/${run.id}`, headers })).json().run).toEqual(run);
    }
  });
  it('creates server-owned drafts and reloads through a reconstructed store', async () => {
    const draft = await save();
    expect(draft).toMatchObject({ projectId: 'project-one', revision: 1, status: 'draft', createdBy: 'Alice Operator', updatedBy: 'Alice Operator' });
    expect(draft.id).toMatch(/^[a-f0-9-]{36}$/);
    await app.close(); mount();
    const response = await app.inject({ method: 'GET', url: `${base}/${draft.id}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().draft).toEqual(draft);
    expect((await app.inject({ method: 'GET', url: base, headers })).json().drafts).toHaveLength(1);
  });
});
