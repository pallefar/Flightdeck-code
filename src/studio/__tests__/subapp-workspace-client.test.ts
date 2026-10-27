import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SubappWorkspaceClient } from '../subapp-workspace-client';
import { captureSubappSnapshot } from '../subapp-snapshot';
import { generatedStore, draftId, at } from './subapp-workspace.fixture';

function documentFor(snapshot = captureSubappSnapshot(generatedStore().getState()), revision = 1) {
  return { id: draftId, projectId: 'demo', revision, status: 'draft' as const, snapshot,
    contentHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    createdBy: 'development-fixture', updatedBy: 'development-fixture', createdAt: at, updatedAt: at };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
it('validates real emitted source and exact browser digest through create and exact GET', async () => {
  const snapshot = captureSubappSnapshot(generatedStore().getState());
  const requests: [string, RequestInit][] = [];
  const client = new SubappWorkspaceClient('demo', 'development-sentinel', async (url, init) => {
    requests.push([String(url), init!]); return json({ draft: documentFor(snapshot) }, init!.method === 'POST' ? 201 : 200);
  });
  const created = await client.create(snapshot);
  expect(await client.get(created.id)).toEqual(documentFor(snapshot));
  expect(requests.map(r => r[0])).toEqual(['/api/studio/workspaces/demo/subapps', `/api/studio/workspaces/demo/subapps/${draftId}`]);
  expect(requests[0]![1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin', redirect: 'error', method: 'POST', headers: { Authorization: 'Bearer development-sentinel', 'content-type': 'application/json' } });
  expect(JSON.parse(requests[0]![1].body as string)).toEqual({ snapshot });
  expect(requests[0]![1].body).not.toContain('development-sentinel');
});
it.each(['scope', 'identity', 'digest', 'extra-field', 'reordered-snapshot', 'deep'] as const)('refuses malformed %s DTOs before admitting saved metadata', async mode => {
  const draft = documentFor(); let value: unknown = { draft };
  if (mode === 'scope') draft.projectId = 'other';
  if (mode === 'identity') draft.id = 'd557d10b-00ee-4fbd-b500-b30cc11e7006';
  if (mode === 'digest') draft.contentHash = '0'.repeat(64);
  if (mode === 'extra-field') value = { draft, unexpected: true };
  if (mode === 'reordered-snapshot') draft.snapshot = { files: draft.snapshot.files, baseline: draft.snapshot.baseline };
  if (mode === 'deep') { let deep: unknown = 'x'; for (let i = 0; i < 100; i++) deep = { next: deep }; value = { draft, deep }; }
  const client = new SubappWorkspaceClient('demo', 'development-sentinel', async () => json(value));
  await expect(client.get(draftId)).rejects.toThrow(/Invalid/);
});
it.each(['mime', 'utf8', 'length', 'status'] as const)('refuses invalid %s transport without leaking server bodies', async mode => {
  const response = mode === 'utf8' ? new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }) : new Response('PRIVATE_SERVER_BODY', { status: mode === 'status' ? 409 : 200, headers: { 'content-type': mode === 'mime' ? 'text/html' : 'application/json', ...(mode === 'length' ? { 'content-length': '2016001' } : {}) } });
  const client = new SubappWorkspaceClient('demo', 'development-sentinel', async () => response);
  await expect(client.get(draftId)).rejects.toThrow();
});
it('rejects bad identities, revisions, getters and pre-aborted calls before any request', async () => {
  let requests = 0; let getterReads = 0;
  const client = new SubappWorkspaceClient('demo', 'development-sentinel', async () => { requests++; return json({}); });
  await expect(client.get('../bad')).rejects.toThrow(/Invalid/);
  await expect(client.update(draftId, documentFor().snapshot, 0)).rejects.toThrow(/Invalid/);
  const getter = { get baseline() { getterReads++; return documentFor().snapshot.baseline; }, files: [] };
  await expect(client.create(getter as never)).rejects.toThrow(/Invalid/);
  const abort = new AbortController(); abort.abort();
  await expect(client.get(draftId, abort.signal)).rejects.toThrow(/cancelled/);
  expect(requests).toBe(0); expect(getterReads).toBe(0);
});
it('checks cancellation again after ignored-abort transport resolution and never acquires a stale reader', async () => {
  let resolve!: (response: Response) => void; let readers = 0;
  const client = new SubappWorkspaceClient('demo', 'development-sentinel', async () => new Promise<Response>(yes => { resolve = yes; }));
  const abort = new AbortController(); const pending = client.get(draftId, abort.signal); abort.abort();
  const response = json({ draft: documentFor() }); const body = response.body!; const original = body.getReader.bind(body);
  Object.defineProperty(body, 'getReader', { value: () => { readers++; return original(); } });
  resolve(response); await expect(pending).rejects.toThrow(/cancelled/); expect(readers).toBe(0);
});
it('sanitizes synchronous transport failures instead of exposing low-level exception text', async () => {
  const client = new SubappWorkspaceClient('demo', 'development-sentinel', () => { throw new Error('PRIVATE_TRANSPORT_EXCEPTION'); });
  await expect(client.get(draftId)).rejects.toThrow(/connection unavailable/);
});
it('stream-caps bytes before buffering and never awaits a malicious hung cancellation', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array(2_016_001)); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  const client = new SubappWorkspaceClient('demo', 'development-sentinel', async () => new Response(stream, { headers: { 'content-type': 'application/json' } }));
  const outcome = await Promise.race([client.get(draftId).then(() => 'accepted', () => 'refused'), new Promise(resolve => setTimeout(() => resolve('hung'), 80))]);
  expect(outcome).toBe('refused'); expect(cancelled).toBe(true);
});
it('aborts a pending read promptly and prevents late ignored-abort fetches from starting a body read', async () => {
  let cancelCalls = 0;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelCalls++; return new Promise(() => {}); } });
  const abort = new AbortController();
  const client = new SubappWorkspaceClient('demo', 'development-sentinel', async () => new Response(stream, { headers: { 'content-type': 'application/json' } }));
  const pending = client.get(draftId, abort.signal); await new Promise(resolve => setTimeout(resolve, 0)); abort.abort();
  const outcome = await Promise.race([pending.then(() => 'accepted', () => 'aborted'), new Promise(resolve => setTimeout(() => resolve('hung'), 80))]);
  expect(outcome).toBe('aborted'); expect(cancelCalls).toBe(1);
});
