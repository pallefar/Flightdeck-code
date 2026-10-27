import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { realpath, rm } from 'node:fs/promises';
import { createEmptyGraph } from '../workflow/graph';
import { graphDigest, type WorkflowDraft } from '../../server/workflow-workspace-store';
import { createAuthority, targetFor } from './authority';
import { createDraftRoot, openDraftService } from './draft-store';
import { createHostBff, createPrivateClient, createStudioRpc } from './transport';
import { FIXTURE_PEER } from './fixture';

const path = '/bridge/workspaces/alpha/projects/general/drafts';
type Body = { workspaceId: string; projectId: string; draft?: WorkflowDraft; drafts?: WorkflowDraft[]; error?: string };
type Alter = (body: Body, status: number) => number;
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function relayFixture() {
  const root = await createDraftRoot(await realpath(process.env.TMPDIR!));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const service = await openDraftService(root);
  let hostOrigin: string | undefined, studio: ReturnType<typeof createPrivateClient> | undefined;
  let actorId = 'alice';
  const authority = createAuthority({ enabled: true, adapter: { current: async (req: FastifyRequest) => ({ ...targetFor(req.method, req.raw.url ?? ''), actorId, displayName: 'Synthetic label', sessionVersion: 'synthetic-session', authorityVersion: 'synthetic-context', active: true, pending: false, member: true, workspaceEnabled: true, projectEnabled: true }) }, policy: { permit: async () => ({ revision: 'synthetic-policy' }) } });
  const host = createHostBff({ authority, dedicatedPeerKey: FIXTURE_PEER, canonicalOrigin: () => hostOrigin, studio: () => studio, checkCsrf: async () => true });
  cleanup.push(() => host.close());
  hostOrigin = await host.listen({ host: '127.0.0.1', port: 0 });
  const rpc = createStudioRpc({ dedicatedPeerKey: FIXTURE_PEER, host: createPrivateClient(hostOrigin, FIXTURE_PEER), service: () => service });
  cleanup.push(() => rpc.close());
  const rpcOrigin = await rpc.listen({ host: '127.0.0.1', port: 0 });
  const client = createPrivateClient(rpcOrigin, FIXTURE_PEER);
  let alter: Alter = (_body, status) => status;
  const relay = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await client.call('/private/studio-drafts/invoke', JSON.parse(Buffer.concat(chunks).toString()));
      const body = structuredClone(response.json) as Body;
      const status = alter(body, response.status);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body));
    } catch { res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"error":"owned relay unavailable"}'); }
  });
  cleanup.push(async () => { relay.closeAllConnections(); if (relay.listening) await new Promise<void>((resolve, reject) => relay.close(error => error ? reject(error) : resolve())); });
  await new Promise<void>(resolve => relay.listen(0, '127.0.0.1', resolve));
  studio = createPrivateClient(`http://127.0.0.1:${(relay.address() as AddressInfo).port}`, FIXTURE_PEER);
  cleanup.push(async () => authority.close());
  return {
    service, actor: (value: string) => { actorId = value; }, alter: (next?: Alter) => { alter = next ?? ((_body, status) => status); },
    async browser(route: string, method = 'GET', body?: unknown) {
      const response = await fetch(hostOrigin! + route, { method, redirect: 'error', ...(body === undefined ? {} : { headers: { origin: hostOrigin!, 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
      return { status: response.status, json: await response.json() as Body };
    },
  };
}

it('rejects a real authenticated-peer reply with the wrong inner project while preserving exact durable state', async () => {
  const f = await relayFixture();
  const created = await f.browser(path, 'POST', { graph: createEmptyGraph('Owned real-store control') });
  expect(created.status).toBe(201);
  const exact = `${path}/${created.json.draft!.id}`;
  f.alter((body, status) => { if (body.draft) body.draft.projectId = 'other'; return status; });
  const rejected = await f.browser(exact);
  expect(rejected.status).toBe(503);
  expect(rejected.json).toEqual({ error: 'bridge unavailable' });
  f.alter();
  expect((await f.browser(exact)).json.draft).toEqual(created.json.draft);
});

it.each(['wrong-id', 'missing-data', 'extra-list', 'wrong-status'])('rejects %s for an exact-read peer response', async mode => {
  const f = await relayFixture();
  const created = await f.browser(path, 'POST', { graph: createEmptyGraph('Exact read control') });
  const exact = `${path}/${created.json.draft!.id}`;
  f.alter((body, status) => {
    if (mode === 'wrong-id' && body.draft) body.draft.id = '00000000-0000-4000-8000-000000000001';
    if (mode === 'missing-data') delete body.draft;
    if (mode === 'extra-list' && body.draft) body.drafts = [body.draft];
    return mode === 'wrong-status' ? 201 : status;
  });
  expect((await f.browser(exact)).status).toBe(503);
  f.alter();
  expect((await f.browser(exact)).json.draft).toEqual(created.json.draft);
  expect(f.service.counters.writeEntries).toBe(1);
});

it.each(['wrong-project', 'missing-list', 'extra-draft', 'duplicate-record'])('rejects %s in an authenticated list reply', async mode => {
  const f = await relayFixture();
  expect((await f.browser(path)).json.drafts).toEqual([]);
  const created = await f.browser(path, 'POST', { graph: createEmptyGraph('List binding control') });
  f.alter((body, status) => {
    if (mode === 'wrong-project' && body.drafts?.[0]) body.drafts[0].projectId = 'other';
    if (mode === 'missing-list') delete body.drafts;
    if (mode === 'extra-draft' && body.drafts?.[0]) body.draft = body.drafts[0];
    if (mode === 'duplicate-record' && body.drafts?.[0]) body.drafts.push(structuredClone(body.drafts[0]));
    return status;
  });
  const rejected = await f.browser(path);
  expect(rejected.status).toBe(503);
  expect(rejected.json).toEqual({ error: 'bridge unavailable' });
  f.alter();
  expect((await f.browser(path)).json.drafts).toEqual([created.json.draft]);
});

it.each([
  ['POST', 'creator'], ['POST', 'updater'], ['POST', 'revision'], ['POST', 'graph'],
  ['PUT', 'updater'], ['PUT', 'revision'], ['PUT', 'graph'],
] as const)('rejects %s write confirmation with substituted %s without retrying or claiming rollback', async (method, field) => {
  const f = await relayFixture();
  const previous = method === 'PUT' ? await f.browser(path, 'POST', { graph: createEmptyGraph('Previous revision') }) : undefined;
  const graph = createEmptyGraph('Exact requested graph');
  const route = previous ? `${path}/${previous.json.draft!.id}` : path;
  f.alter((body, status) => {
    if (body.draft) {
      if (field === 'creator') body.draft.createdBy = 'mallory';
      if (field === 'updater') body.draft.updatedBy = 'mallory';
      if (field === 'revision') body.draft.revision += 7;
      if (field === 'graph') body.draft.graph.name = 'Substituted peer graph';
    }
    return status;
  });
  const rejected = await f.browser(route, method, { graph, ...(method === 'PUT' ? { expectedRevision: 1 } : {}) });
  expect(rejected.status).toBe(503);
  expect(rejected.json).toEqual({ error: 'bridge unavailable' });
  f.alter();
  const records = (await f.browser(path)).json.drafts!;
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ graph, createdBy: 'alice', updatedBy: 'alice', revision: method === 'PUT' ? 2 : 1 });
  expect(f.service.counters.writeEntries).toBe(method === 'PUT' ? 2 : 1);
});

it('preserves nested object-key order instead of accepting a sorted-digest-equivalent write reply', async () => {
  const f = await relayFixture(); const graph = createEmptyGraph('Ordered nested values');
  graph.nodes.push({ id: 'values', type: 'set', label: 'Set fields', position: { x: 0, y: 0 }, config: { fields: { payload: { b: 2, a: 1 } } } });
  let digestEquivalent = false;
  f.alter((body, status) => {
    const fields = body.draft?.graph.nodes[0]?.config.fields;
    if (fields && typeof fields === 'object' && !Array.isArray(fields) && body.draft) {
      fields.payload = { a: 1, b: 2 };
      digestEquivalent = graphDigest(body.draft.graph) === graphDigest(graph);
    }
    return status;
  });
  expect((await f.browser(path, 'POST', { graph })).status).toBe(503);
  expect(digestEquivalent).toBe(true);
  f.alter();
  expect(JSON.stringify((await f.browser(path)).json.drafts![0]!.graph)).toBe(JSON.stringify(graph));
  expect(f.service.counters.writeEntries).toBe(1);
});

it('does not confuse the historical creator with the currently authorized writer or reader', async () => {
  const f = await relayFixture();
  const created = await f.browser(path, 'POST', { graph: createEmptyGraph('Alice creation') });
  const exact = `${path}/${created.json.draft!.id}`;
  f.actor('bob');
  expect((await f.browser(exact)).json.draft?.createdBy).toBe('alice');
  const updated = await f.browser(exact, 'PUT', { graph: createEmptyGraph('Bob authorized update'), expectedRevision: 1 });
  expect(updated.status).toBe(200);
  expect(updated.json.draft).toMatchObject({ createdBy: 'alice', updatedBy: 'bob', revision: 2 });
  expect((await f.browser(path)).json.drafts).toEqual([updated.json.draft]);
});
