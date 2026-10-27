import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { registerSubappWorkspaceRoutes } from '../../../server/subapp-workspace';
import { createFileSubappWorkspaceStore } from '../../../server/subapp-workspace-store';
import { createStore } from '../../workbench/store';
import { SubappWorkspaceController } from '../subapp-workspace-controller';
import { currentRound } from '../../workbench/selectors';
import { captureSubappSnapshot } from '../subapp-snapshot';
import { generatedStore, draftId, at } from './subapp-workspace.fixture';
import type { SubappSnapshot } from '../../../packages/subapp-workspace/schema';

function record(snapshot: SubappSnapshot, revision = 1) {
  return { id: draftId, projectId: 'demo', revision, status: 'draft', snapshot,
    contentHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), createdBy: 'fixture', updatedBy: 'fixture', createdAt: at, updatedAt: at };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
it('round-trips exact manual bytes and baseline evidence through real authenticated loopback routes and a reconstructed private store', async () => {
  const scratch = await realpath(join(homedir(), '.hermes/cache/scratch'));
  const root = await mkdtemp(join(scratch, 'subapp-client-roundtrip-')); const file = join(root, 'drafts.json');
  const server = Fastify({ logger: false });
  registerSubappWorkspaceRoutes(server, { actor: 'synthetic-http-fixture', authenticate: value => value === 'Bearer development-sentinel', store: createFileSubappWorkspaceStore(file) });
  try {
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const fetcher: typeof fetch = (url, init) => fetch(address + String(url), init);
    const store = generatedStore(); const source = store.effectiveFiles()[0]!;
    const manual = source.contents + '\r\n// exact persisted α\n'; store.editFile(source.path, manual); store.saveFile(source.path);
    const controller = new SubappWorkspaceController(store, fetcher); controller.setScope('demo', 'development-sentinel');
    expect(await controller.save('new')).toBe(true);
    const first = controller.getState().saved!;
    store.editFile(source.path, manual + '// second revision\n'); store.saveFile(source.path);
    expect(await controller.save('revision')).toBe(true);
    const second = controller.getState().saved!; expect(second.revision).toBe(2);
    expect(await createFileSubappWorkspaceStore(file).get('demo', first.id)).toEqual(second);
    const reopened = createStore(); const other = new SubappWorkspaceController(reopened, fetcher); other.setScope('demo', 'development-sentinel');
    expect(await other.open(first.id)).toBe(true);
    expect(reopened.effectiveFiles()).toEqual(second.snapshot.files);
    expect(currentRound(reopened.getState())!.candidate).toEqual(first.snapshot.baseline);
    expect(reopened.getState().drafts.get(source.path)!.saved).toBe(manual + '// second revision\n');
    controller.disconnect(); other.disconnect();
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
it('does no automatic I/O and confirms only exact GET readback of a captured source snapshot', async () => {
  const store = generatedStore(); let saved = record(captureSubappSnapshot(store.getState())); const methods: string[] = [];
  const controller = new SubappWorkspaceController(store, async (_url, init) => {
    const method = init!.method!; methods.push(method);
    if (method !== 'GET') { const body = JSON.parse(init!.body as string); saved = record(body.snapshot, method === 'PUT' ? body.expectedRevision + 1 : 1); }
    return json({ draft: saved }, method === 'POST' ? 201 : 200);
  });
  controller.setScope('demo', 'development-sentinel'); expect(methods).toEqual([]);
  const round = currentRound(store.getState());
  await controller.save('new');
  expect(methods).toEqual(['POST', 'GET']); expect(controller.getState().saved).toEqual(saved);
  expect(controller.getState().message).toMatch(/readback/);
  const file = store.effectiveFiles()[0]!; store.editFile(file.path, file.contents + '\n// manual'); store.saveFile(file.path);
  expect(currentRound(store.getState())).toBe(round); expect(controller.getState().saved!.id).toBe(draftId);
  await controller.save('revision');
  expect(methods).toEqual(['POST', 'GET', 'PUT', 'GET']); expect(controller.getState().saved!.revision).toBe(2);
});
it('refreshes only on request and reopens saved overlays after explicit replacement confirmation', async () => {
  const store = generatedStore(); const file = store.effectiveFiles()[0]!;
  store.editFile(file.path, file.contents + '\n// durable manual'); store.saveFile(file.path);
  const saved = record(captureSubappSnapshot(store.getState()));
  const methods: string[] = [];
  const controller = new SubappWorkspaceController(store, async (url) => {
    methods.push(String(url));
    const { snapshot: _snapshot, ...meta } = saved;
    return json(String(url).endsWith(draftId) ? { draft: saved } : { drafts: [{ ...meta, label: saved.snapshot.baseline.manifest.label, subappId: saved.snapshot.baseline.manifest.id, fileCount: saved.snapshot.files.length }] });
  });
  controller.setScope('demo', 'development-sentinel');
  await controller.refresh(); expect(controller.getState().drafts).toHaveLength(1);
  store.editFile(file.path, 'unsaved buffer must survive decline'); const before = store.getState();
  expect(await controller.open(draftId, () => false)).toBe(false); expect(store.getState()).toBe(before);
  expect(await controller.open(draftId, () => true)).toBe(true);
  expect(store.effectiveFiles()).toEqual(saved.snapshot.files);
  expect(currentRound(store.getState())!.candidate).toEqual(saved.snapshot.baseline);
  expect(controller.getState().saved!.id).toBe(draftId);
});
it('rechecks epoch and editor context after an asynchronous confirmation before any replacement', async () => {
  const store = generatedStore(); const saved = record(captureSubappSnapshot(store.getState()));
  const controller = new SubappWorkspaceController(store, async () => json({ draft: saved })); controller.setScope('demo', 'development-sentinel');
  let approve!: (yes: boolean) => void; let reached!: () => void;
  const asked = new Promise<void>(resolve => { reached = resolve; });
  const pending = controller.open(draftId, () => { reached(); return new Promise<boolean>(resolve => { approve = resolve; }); });
  await asked; const file = store.effectiveFiles()[0]!; store.editFile(file.path, 'newly typed after confirmation opened');
  const before = store.getState(); approve(true);
  expect(await pending).toBe(false); expect(store.getState()).toBe(before);
  expect(controller.getState().saved).toBeNull();
});
it('aborts a pending confirmation on hide and never performs a late load callback', async () => {
  const store = generatedStore(); const saved = record(captureSubappSnapshot(store.getState())); const before = store.getState(); let callbacks = 0;
  const controller = new SubappWorkspaceController(store, async () => json({ draft: saved })); controller.setScope('demo', 'development-sentinel');
  let asked!: () => void; const reached = new Promise<void>(resolve => { asked = resolve; });
  const pending = controller.open(draftId, () => { asked(); return new Promise<boolean>(() => {}); }, () => { callbacks++; });
  await reached; controller.setActive(false);
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('hung'), 80))]);
  expect(result).toBe(false); expect(store.getState()).toBe(before); expect(callbacks).toBe(0);
});
it('keeps uncertain write state across hide, scope changes and refresh without implicit retries', async () => {
  const store = generatedStore(); const saved = record(captureSubappSnapshot(store.getState())); let requests = 0; let resolveWrite!: (response: Response) => void;
  let entered!: () => void; const dispatched = new Promise<void>(resolve => { entered = resolve; });
  const controller = new SubappWorkspaceController(store, async (_url, init) => {
    requests++;
    if (init!.method === 'POST') return new Promise<Response>(resolve => { resolveWrite = resolve; entered(); });
    return json({ drafts: [] });
  }); controller.setScope('demo', 'development-sentinel');
  const pending = controller.save('new');
  expect(await controller.save('new')).toBe(false); await dispatched; expect(requests).toBe(1);
  controller.setActive(false); resolveWrite(json({ draft: saved }, 201));
  expect(await pending).toBe(false); expect(requests).toBe(1);
  controller.setActive(true); expect(controller.getState().uncertain).toBe(true);
  controller.setScope('other', 'other-sentinel'); expect(controller.getState().uncertain).toBe(false);
  controller.setScope('demo', 'development-sentinel'); expect(controller.getState().uncertain).toBe(true);
  await controller.refresh(); expect(controller.getState().uncertain).toBe(true);
  expect(await controller.save('new')).toBe(false); expect(requests).toBe(2);
});
it('does not acknowledge a mismatched readback or lose manual buffers on revision conflict', async () => {
  const store = generatedStore(); let saved = record(captureSubappSnapshot(store.getState())); let conflict = false; let mismatch = false;
  const controller = new SubappWorkspaceController(store, async (_url, init) => {
    if (conflict && init!.method === 'PUT') return json({}, 409);
    if (init!.method !== 'GET') saved = record(JSON.parse(init!.body as string).snapshot, init!.method === 'POST' ? 1 : saved.revision + 1);
    return json({ draft: mismatch && init!.method === 'GET' ? { ...saved, revision: saved.revision + 1 } : saved }, init!.method === 'POST' ? 201 : 200);
  }); controller.setScope('demo', 'development-sentinel'); await controller.save('new');
  const file = store.effectiveFiles()[0]!; store.editFile(file.path, file.contents + '\n// manual'); store.saveFile(file.path); const before = store.getState();
  conflict = true; expect(await controller.save('revision')).toBe(false);
  expect(store.getState()).toBe(before); expect(controller.getState().error).toMatch(/conflict/); expect(controller.getState().uncertain).toBe(false);
  conflict = false; mismatch = true; expect(await controller.save('revision')).toBe(false);
  expect(controller.getState().saved!.revision).toBe(1); expect(controller.getState().uncertain).toBe(true); expect(controller.getState().message).toBeNull();
});
it.each([401, 404, 409])('keeps a committed mutation uncertain when exact readback fails with %s', async status => {
  const store = generatedStore(); const saved = record(captureSubappSnapshot(store.getState()));
  const controller = new SubappWorkspaceController(store, async (_url, init) => init!.method === 'POST' ? json({ draft: saved }, 201) : json({}, status));
  controller.setScope('demo', 'development-sentinel');
  expect(await controller.save('new')).toBe(false); expect(controller.getState().uncertain).toBe(true);
  expect(controller.getState().saved).toBeNull(); expect(controller.getState().message).toBeNull();
});
it('captures detached saved source before the first await and retains edits made during persistence', async () => {
  const store = generatedStore(); const captured = captureSubappSnapshot(store.getState()); let posted: SubappSnapshot | undefined;
  const controller = new SubappWorkspaceController(store, async (_url, init) => {
    if (init!.method === 'POST') posted = JSON.parse(init!.body as string).snapshot;
    return json({ draft: record(posted!) }, init!.method === 'POST' ? 201 : 200);
  }); controller.setScope('demo', 'development-sentinel');
  const pending = controller.save('new'); const file = store.effectiveFiles()[0]!; store.editFile(file.path, 'saved while network pending'); store.saveFile(file.path);
  expect(await pending).toBe(true); expect(posted).toEqual(captured); expect(store.effectiveFiles()[0]!.contents).toBe('saved while network pending');
});
it('reconciles the exact round on reconnect even when store changes happened while unsubscribed', async () => {
  const store = generatedStore(); const baseline = currentRound(store.getState())!.candidate; const saved = record(captureSubappSnapshot(store.getState()));
  const controller = new SubappWorkspaceController(store, async (_url, init) => json({ draft: saved }, init!.method === 'POST' ? 201 : 200)); controller.setScope('demo', 'development-sentinel');
  await controller.save('new'); controller.disconnect();
  store.reset(); store.settle(store.prompt('same counter IDs but a different actual round')!, baseline);
  controller.connect(); expect(controller.getState().saved).toBeNull();
});
it('binds saved identity to the exact latest round, not saved overlays or ordinary navigation', async () => {
  const store = generatedStore(); const baseline = currentRound(store.getState())!.candidate; const saved = record(captureSubappSnapshot(store.getState()));
  const controller = new SubappWorkspaceController(store, async (_url, init) => json({ draft: saved }, init!.method === 'POST' ? 201 : 200)); controller.setScope('demo', 'development-sentinel');
  await controller.save('new'); store.setView('gate'); store.selectFile(baseline.files.at(-1)!.path);
  expect(controller.getState().saved!.id).toBe(draftId);
  store.settle(store.prompt('actual new round')!, baseline); expect(controller.getState().saved).toBeNull();
});
