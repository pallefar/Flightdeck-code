import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createFileWorkflowWorkspaceStore } from '../../../server/workflow-workspace-store';
import { registerWorkflowWorkspaceRoutes } from '../../../server/workflow-workspace';
import { createEmptyGraph } from '../../../packages/workflow/graph';
import { WorkspaceClient } from '../workspace-client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowWorkspace, WorkspaceRunDetail } from '../WorkflowWorkspace';
import { WorkspaceController } from '../workspace-controller';
import { createWorkflowTemplate } from '../../workflow/WorkflowEditor';
let app: FastifyInstance;
let dir: string;
let file: string;
const fixtureToken = 'explicit-workspace-test-token';
function mount() {
  app = Fastify({ logger: false });
  registerWorkflowWorkspaceRoutes(app, { actor: 'Workspace Test Operator', authenticate: h => h === `Bearer ${fixtureToken}`, store: createFileWorkflowWorkspaceStore(file), adaptersFor: () => ({ llm: async () => { throw new Error('Local execution must not call a model'); } }) });
}
const transport: typeof fetch = async (url, init) => {
  const response = await app.inject({ method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PUT', url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), ...(init?.body ? { payload: String(init.body) } : {}) });
  return new Response(response.body, { status: response.statusCode, headers: response.headers as Record<string, string> });
};
beforeEach(async () => { dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'workspace-ui-')); file = join(dir, 'workspace.json'); mount(); });
afterEach(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
it('creates, validates, lists and reloads a real durable draft through browser client', async () => {
  const client = new WorkspaceClient('project-one', fixtureToken, transport);
  const draft = await client.create(createEmptyGraph());
  expect(draft).toMatchObject({ revision: 1, projectId: 'project-one', status: 'draft' });
  expect((await client.list())[0]).toMatchObject({ id: draft.id, name: 'Untitled workflow' });
  await app.close(); mount();
  expect(await client.get(draft.id)).toEqual(draft);
});
it('updates by CAS and executes saved real true/false branches with persisted history', async () => {
  const client = new WorkspaceClient('project-one', fixtureToken, transport);
  const draft = await client.create(createWorkflowTemplate('branch'));
  const first = await client.run(draft.id, 1, { approved: true });
  expect(first.state).toBe('completed');
  expect(await client.getRun(draft.id, first.id)).toEqual(first);
  expect(first.result?.output).toMatchObject({ approved: true });
  await expect(client.run(draft.id, 1, {})).rejects.toMatchObject({ code: 409 });
  const next = await client.update(draft.id, draft.graph, 1);
  expect(next.revision).toBe(2);
  await expect(client.update(draft.id, draft.graph, 1)).rejects.toMatchObject({ code: 409 });
  const second = await client.run(draft.id, 2, { approved: false });
  expect(second.result?.output).toMatchObject({ approved: false });
  expect(second.result?.trace).not.toEqual(first.result?.trace);
  await app.close(); mount();
  expect(await client.listRuns(draft.id)).toEqual([first, second]);
});
it('controller confirms writes by exact GET before saved status and runs only the matching saved revision', async () => {
  const calls: string[] = [];
  const controller = new WorkspaceController(async (url, init) => { calls.push(`${init?.method ?? 'GET'} ${url}`); return transport(url, init); });
  controller.setScope('project-one', fixtureToken);
  controller.setGraph(createWorkflowTemplate('branch'));
  await controller.run({ approved: true });
  expect(controller.getState().error).toContain('Save');
  expect(calls).toEqual([]);
  await controller.save('new');
  const saved = controller.getState().draft!;
  expect(controller.getState()).toMatchObject({ phase: 'idle', dirty: false, message: 'Saved revision 1 (read back).' });
  expect(calls.slice(0, 2)).toEqual([`POST /api/studio/workspaces/project-one/workflows`, `GET /api/studio/workspaces/project-one/workflows/${saved.id}`]);
  await controller.run({ approved: true });
  expect(controller.getState().detail?.result?.output).toMatchObject({ approved: true });
  expect(controller.getState().runs).toHaveLength(1);
  controller.setGraph({ ...saved.graph, name: 'Edited' });
  expect(controller.getState().dirty).toBe(true);
  const count = calls.length;
  await controller.run({});
  expect(calls).toHaveLength(count);
  expect(await controller.load(saved.id)).toBeUndefined();
  expect(controller.getState().dirty).toBe(true);
  expect(await controller.load(saved.id, () => true)).toEqual(saved.graph);
  expect(controller.getState().dirty).toBe(false);
  await controller.save('revision');
  await controller.run({ approved: false });
  expect(controller.getState().detail?.result?.output).toMatchObject({ approved: false });
  await app.close(); mount();
  const reopened = new WorkspaceController(transport); reopened.setScope('project-one', fixtureToken);
  await reopened.refresh();
  expect(reopened.getState().drafts).toHaveLength(1);
  await reopened.load(saved.id);
  expect(reopened.getState().runs).toHaveLength(2);
});
it('does not allow an invalid secondary save to unlock an in-flight create', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(r => { release = r; });
  const controller = new WorkspaceController(async (url, init) => { if (init?.method === 'POST') await barrier; return transport(url, init); });
  controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph());
  const pending = controller.save('new');
  await controller.save('revision');
  expect(controller.getState().phase).toBe('saving');
  release(); await pending;
});
it('sanitizes auth, non-JSON, malformed DTO and transport failures without raw server text', async () => {
  await expect(new WorkspaceClient('project-one', 'wrong', transport).list()).rejects.toMatchObject({ code: 401, message: expect.stringContaining('credential refused') });
  for (const response of [new Response('<script>/private/secret</script>', { headers: { 'content-type': 'text/html' } }), new Response('{broken', { headers: { 'content-type': 'application/json' } }), new Response(JSON.stringify({ drafts: [{ id: 'not-a-uuid' }] }), { headers: { 'content-type': 'application/json' } })]) {
    await expect(new WorkspaceClient('project-one', fixtureToken, async () => response).list()).rejects.toMatchObject({ code: 'invalid', message: expect.not.stringContaining('/private') });
  }
  await expect(new WorkspaceClient('project-one', fixtureToken, async () => { throw new Error('/private/provider key'); }).list()).rejects.toMatchObject({ code: 'unavailable', message: expect.not.stringContaining('/private') });
  for (const project of ['UPPER', 'a--b', 'a'.repeat(65), '../project']) expect(() => new WorkspaceClient(project, fixtureToken, transport)).toThrow();
});
it('readback failure never reports Saved and leaves the real created draft discoverable', async () => {
  let failed = false;
  const controller = new WorkspaceController(async (url, init) => {
    if (!failed && init?.method === 'GET' && /workflows\/[a-f0-9-]+$/.test(String(url))) { failed = true; return new Response('/private/path', { status: 503 }); }
    return transport(url, init);
  });
  controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph());
  await controller.save('new');
  expect(controller.getState()).toMatchObject({ phase: 'error', draft: null, message: null, dirty: true });
  expect(controller.getState().error).not.toContain('/private');
  await controller.refresh(); expect(controller.getState().drafts).toHaveLength(1);
});
it('scope switch aborts stale writes and cannot mark a new project saved', async () => {
  let release!: () => void; let started!: () => void; let signal: AbortSignal | null | undefined;
  const barrier = new Promise<void>(r => { release = r; }); const entered = new Promise<void>(r => { started = r; });
  const controller = new WorkspaceController(async (url, init) => {
    const response = await transport(url, init);
    if (init?.method === 'POST') { signal = init.signal; started(); await barrier; }
    return response;
  });
  controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph());
  const pending = controller.save('new'); await entered;
  controller.setScope('project-two', fixtureToken); release(); await pending;
  expect(signal?.aborted).toBe(true);
  expect(controller.getState()).toMatchObject({ projectId: 'project-two', draft: null, message: null, dirty: true });
  await controller.refresh(); expect(controller.getState().drafts).toEqual([]);
  expect(await new WorkspaceClient('project-one', fixtureToken, transport).list()).toHaveLength(1);
});
it('token switch suppresses stale list results and treats unavailable connection as unknown not empty', async () => {
  let release!: (r: Response) => void;
  const controller = new WorkspaceController(async () => new Promise<Response>(r => { release = r; }));
  controller.setScope('project-one', fixtureToken); const pending = controller.refresh();
  controller.setScope('project-one', 'changed-fixture-token');
  release(new Response('{"drafts":[]}', { headers: { 'content-type': 'application/json' } })); await pending;
  expect(controller.getState().drafts).toBeNull();
  const unavailable = new WorkspaceController(async () => new Response('not exposed', { status: 503 })); unavailable.setScope('project-one', fixtureToken);
  await unavailable.refresh(); expect(unavailable.getState()).toMatchObject({ drafts: null, phase: 'error', message: null });
});
it('CAS conflicts preserve dirty edits and explain immutable approvals without claiming saved', async () => {
  const controller = new WorkspaceController(transport); controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph()); await controller.save('new');
  const saved = controller.getState().draft!;
  await new WorkspaceClient('project-one', fixtureToken, transport).update(saved.id, createEmptyGraph('Concurrent'), 1);
  controller.setGraph(createEmptyGraph('My edit')); await controller.save('revision');
  expect(controller.getState()).toMatchObject({ phase: 'error', dirty: true, message: null, draft: { revision: 1 } });
  expect(controller.getState().error).toContain('approval');
});
it('key ordering does not make a saved graph dirty, but new document explicitly detaches identity', async () => {
  const controller = new WorkspaceController(transport); controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph()); await controller.save('new');
  const g = controller.getState().draft!.graph;
  controller.setGraph({ customBlocks: g.customBlocks, edges: g.edges, nodes: g.nodes, name: g.name, id: g.id, version: g.version });
  expect(controller.getState().dirty).toBe(false);
  controller.newDocument(g); expect(controller.getState()).toMatchObject({ draft: null, dirty: true, runs: null });
});
it('execution readback failure leaves unknown history and prevents automatic retry', async () => {
  let refuseReadback = true; let posts = 0;
  const controller = new WorkspaceController(async (url, init) => {
    if (init?.method === 'POST' && String(url).endsWith('/runs')) ++posts;
    if (refuseReadback && init?.method === 'GET' && /\/runs\/[a-f0-9-]+$/.test(String(url))) return new Response('not exposed', { status: 503 });
    return transport(url, init);
  });
  controller.setScope('project-one', fixtureToken); controller.setGraph(createWorkflowTemplate('branch')); await controller.save('new'); await controller.run({ approved: true });
  expect(controller.getState()).toMatchObject({ phase: 'error', detail: null, message: null, runs: null });
  await controller.run({}); expect(posts).toBe(1);
  refuseReadback = false; await controller.history();
  expect(controller.getState().runs?.[0]?.state).toBe('completed');
  await controller.run({}); expect(posts).toBe(1);
});
it('hides old-scope draft identity immediately when props change credential before effects', async () => {
  const controller = new WorkspaceController(transport); controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph('Private old scope')); await controller.save('new');
  const html = renderToStaticMarkup(createElement(WorkflowWorkspace, { controller, projectId: 'project-one', token: 'new-fixture-token', graph: createEmptyGraph(), onLoadGraph: () => {} }));
  expect(html).not.toContain('Private old scope');
  expect(html).toContain('Connect operator credential in AI builder');
  expect(html).toMatch(/aria-label="Save as new draft" disabled/);
});
it('cancels oversized response streams before buffering their remaining untrusted body', async () => {
  let cancelled = false; let count = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(c) { if (++count > 20) c.close(); else c.enqueue(new Uint8Array(1_000_000).fill(120)); }, cancel() { cancelled = true; } });
  const response = new Response(stream, { headers: { 'content-type': 'application/json' } });
  await expect(new WorkspaceClient('project-one', fixtureToken, async () => response).list()).rejects.toMatchObject({ code: 'invalid' });
  expect(cancelled).toBe(true);
  expect(count).toBeLessThan(20);
});
it('renders actual paused and blocked persisted engine outcomes without resume or fake connector results', async () => {
  const controller = new WorkspaceController(transport); controller.setScope('project-one', fixtureToken);
  const approval = createWorkflowTemplate('approval'); approval.nodes[1]!.config = { reviewer: 'Independent Test Reviewer', reason: 'Explicit test review' };
  controller.setGraph(approval); await controller.save('new'); await controller.run({});
  const paused = controller.getState().detail!;
  expect(paused).toMatchObject({ state: 'paused', resumable: false, pauseDisposition: 'unavailable-no-resume' });
  const html = renderToStaticMarkup(createElement(WorkspaceRunDetail, { run: paused }));
  expect(html).toContain('Resume unavailable'); expect(html).not.toContain('<button');
  const bound = controller.getState().draft!;
  approval.nodes[1]!.config = { reviewer: 'Changed reviewer', reason: 'Changed reason' };
  controller.setGraph(approval); await controller.save('revision');
  expect(controller.getState()).toMatchObject({ phase: 'error', message: null, draft: { revision: 1 } });
  expect(await new WorkspaceClient('project-one', fixtureToken, transport).get(bound.id)).toEqual(bound);
  controller.newDocument(createWorkflowTemplate('http')); await controller.save('new'); await controller.run({});
  expect(controller.getState().detail?.state).toBe('blocked');
  expect(controller.getState().detail?.result?.output).toBeNull();
});
it('renders real set output containing markup as escaped text only', async () => {
  const graph = createWorkflowTemplate('approval'); graph.nodes[1]!.type = 'set'; graph.nodes[1]!.config = { fields: { note: '<script>alert(1)</script>' } };
  const controller = new WorkspaceController(transport); controller.setScope('project-one', fixtureToken); controller.setGraph(graph); await controller.save('new'); await controller.run({});
  expect(controller.getState().detail?.result?.output).toEqual({ note: '<script>alert(1)</script>' });
  const html = renderToStaticMarkup(createElement(WorkspaceRunDetail, { run: controller.getState().detail! }));
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(html).not.toContain('<script>');
});
it('refuses tampered digest, response scope and oversized/deep input before accepting execution', async () => {
  const client = new WorkspaceClient('project-one', fixtureToken, transport); const draft = await client.create(createWorkflowTemplate('branch')); const run = await client.run(draft.id, 1, {});
  for (const bad of [{ ...run, graphDigest: '0'.repeat(64) }, { ...run, projectId: 'project-two' }, { ...run, result: null }, { ...run, resumable: true }]) {
    const fixture = new WorkspaceClient('project-one', fixtureToken, async () => new Response(JSON.stringify({ run: bad }), { headers: { 'content-type': 'application/json' } }));
    await expect(fixture.getRun(draft.id, run.id)).rejects.toMatchObject({ code: 'invalid' });
  }
  const spy = vi.fn<typeof fetch>(); const checked = new WorkspaceClient('project-one', fixtureToken, spy);
  let deep: unknown = {}; for (let i = 0; i < 26; i++) deep = { nested: deep };
  for (const input of [[], null, { password: 'no' }, deep, { text: 'x'.repeat(100_001) }]) await expect(checked.run(draft.id, 1, input)).rejects.toMatchObject({ code: 'invalid' });
  expect(spy).not.toHaveBeenCalled();
});
it('late discard confirmation and late graph-loading responses cannot replace a new scope or edits', async () => {
  const controller = new WorkspaceController(transport); controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph()); await controller.save('new');
  const id = controller.getState().draft!.id; controller.setGraph(createEmptyGraph('Dirty'));
  let confirm!: (v: boolean) => void;
  const pending = controller.load(id, () => new Promise<boolean>(r => { confirm = r; }));
  controller.setScope('project-two', fixtureToken); confirm(true);
  expect(await pending).toBeUndefined(); expect(controller.getState().graph?.name).toBe('Dirty');
});
it('running reservations block later revisions and expose no terminal or resumable result', async () => {
  const client = new WorkspaceClient('project-one', fixtureToken, transport); const draft = await client.create(createWorkflowTemplate('branch'));
  await createFileWorkflowWorkspaceStore(file).reserveRun('project-one', draft.id, 1, {}, 'Workspace Test Operator');
  const controller = new WorkspaceController(transport); controller.setScope('project-one', fixtureToken); await controller.load(draft.id);
  expect(controller.getState().runs?.[0]).toMatchObject({ state: 'running', result: null, resumable: false });
  await controller.save('revision'); expect(controller.getState().draft?.revision).toBe(2);
  expect(controller.runDisabledReason).toContain('running or interrupted');
  await controller.run({}); expect(controller.getState().detail).toBeNull();
  const html = renderToStaticMarkup(createElement(WorkspaceRunDetail, { run: controller.getState().runs![0]! }));
  expect(html).toContain('No terminal result recorded'); expect(html).not.toContain('Output</h4>');
});
it('edits during a save stay dirty against the captured, read-back snapshot', async () => {
  let entered!: () => void; let release!: () => void;
  const began = new Promise<void>(r => { entered = r; }); const barrier = new Promise<void>(r => { release = r; });
  const controller = new WorkspaceController(async (url, init) => { const response = await transport(url, init); if (init?.method === 'POST') { entered(); await barrier; } return response; });
  controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph('Before'));
  const pending = controller.save('new'); await began;
  controller.setGraph(createEmptyGraph('During')); release(); await pending;
  expect(controller.getState()).toMatchObject({ graph: { name: 'During' }, draft: { graph: { name: 'Before' } }, dirty: true });
});
it('concurrent revision appearing between save acknowledgement and exact GET is not accepted as this save', async () => {
  let changed = false;
  const controller = new WorkspaceController(async (url, init) => {
    const response = await transport(url, init);
    if (!changed && init?.method === 'POST') { changed = true; const id = (await response.clone().json()).draft.id as string; await new WorkspaceClient('project-one', fixtureToken, transport).update(id, createEmptyGraph('Concurrent'), 1); }
    return response;
  });
  controller.setScope('project-one', fixtureToken); controller.setGraph(createEmptyGraph()); await controller.save('new');
  expect(controller.getState()).toMatchObject({ phase: 'error', draft: null, message: null, dirty: true });
  expect(controller.getState().error).toContain('Concurrent changes');
});
it('a late run response cannot attach execution or history to a switched project', async () => {
  let entered!: () => void; let release!: () => void;
  const began = new Promise<void>(r => { entered = r; }); const barrier = new Promise<void>(r => { release = r; });
  const controller = new WorkspaceController(async (url, init) => { const response = await transport(url, init); if (init?.method === 'POST' && String(url).endsWith('/runs')) { entered(); await barrier; } return response; });
  controller.setScope('project-one', fixtureToken); controller.setGraph(createWorkflowTemplate('branch')); await controller.save('new');
  const pending = controller.run({ approved: true }); await began;
  controller.setScope('project-two', fixtureToken); release(); await pending;
  expect(controller.getState()).toMatchObject({ projectId: 'project-two', draft: null, detail: null, runs: null, message: null });
});
