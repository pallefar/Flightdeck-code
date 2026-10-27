import { afterEach, expect, it } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, realpath, mkdir, writeFile, rm, readFile, chmod, symlink, link, open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ResourceStore } from '../../packages/resources/store';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createEmptyGraph } from '../../packages/workflow/graph';
import { createFileWorkflowWorkspaceStore } from '../workflow-workspace-store';
import { WorkflowApprovalStore } from '../workflow-approval-store';
import { registerWorkflowWorkspaceRoutes } from '../workflow-workspace';
import { createOfflineSnapshot, verifyOfflineSnapshot, verifyOfflineSnapshotAgainstFence } from '../workflow-backup';
let cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.map(p => rm(p, { recursive: true, force: true }))); cleanup = []; });
async function fixture() {
  const dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'workflow-backup-')); cleanup.push(dir);
  const root = join(dir, 'state'); await mkdir(root, { mode: 0o700 });
  await mkdir(join(root, 'resources'), { mode: 0o700 });
  const resourceStore = new ResourceStore(join(root, 'resources'));
  await resourceStore.propose('project', { name: 'Synthetic measurements', functions: ['measure'] }, 'Alice');
  await writeFile(join(root, 'grants.json'), '{}', { mode: 0o600 });
  const store = createFileWorkflowWorkspaceStore(join(root, 'workspace.json'));
  const approvals = new WorkflowApprovalStore(join(root, 'approvals'));
  const app = Fastify();
  registerWorkflowWorkspaceRoutes(app, { actor: 'Alice', authenticate: () => true, store,
    approvals: { store: approvals, resolveIdentity: async () => ({ name: 'Bob', active: true }), authorize: async () => true } });
  const graph = { ...createEmptyGraph(), nodes: [
    { id: 'start', type: 'manual' as const, label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'gate', type: 'approval' as const, label: 'Gate', position: { x: 1, y: 0 }, config: { reviewer: 'queue', reason: 'Review' } },
    { id: 'out', type: 'output' as const, label: 'Out', position: { x: 2, y: 0 }, config: {} },
  ], edges: [{ id: 'a', source: 'start', target: 'gate' }, { id: 'b', source: 'gate', target: 'out' }] };
  const draft = await store.create('project', graph, 'Alice');
  const run = await app.inject({ method: 'POST', url: `/api/studio/workspaces/project/workflows/${draft.id}/runs`, payload: { revision: 1, input: {} } });
  expect(run.statusCode).toBe(201); await app.close();
  const record = (await approvals.list())[0]!;
  const options = { serverId: randomUUID(), epoch: randomUUID(), generation: 1, quiescence: 'all-writers-stopped' as const };
  const archive = join(dir, 'archive.json'), catalog = join(dir, 'catalog.json');
  return { dir, root, store, approvals, record, options, archive, catalog };
}
it('verifies a bounded offline archive of real paused workspace and signed approval state without restoring', async () => {
  const f = await fixture();
  const snapshot = await createOfflineSnapshot(f.root, f.options);
  await writeFile(f.archive, snapshot.bytes, { mode: 0o600 });
  await writeFile(f.catalog, JSON.stringify(snapshot.reference), { mode: 0o600 });
  const report = await verifyOfflineSnapshot(f.archive, f.catalog);
  expect(report).toMatchObject({ integrity: 'verified', restore: 'blocked', generation: 1 });
  expect(report.files).toBe(6);
});
async function consumed(f: Awaited<ReturnType<typeof fixture>>) {
  await f.approvals.claim(f.record.id);
  await f.store.beginResume!('project', f.record.run.draftId, f.record.run.id, f.record.run);
  await f.store.finishRun('project', f.record.run.draftId, f.record.run.id, { status: 'completed', output: {}, trace: [] });
  await f.approvals.write({ ...f.record, state: 'consumed', revision: 2, decisionBy: 'Bob', decidedAt: new Date().toISOString() });
}
it('refuses a valid-MAC old pending journal mixed into consumed workspace state', async () => {
  const f = await fixture(); const path = join(f.root, 'approvals', f.record.id + '.json');
  const old = await readFile(path); await consumed(f); await writeFile(path, old);
  await expect(createOfflineSnapshot(f.root, { ...f.options, generation: 2 })).rejects.toThrow();
});
it('refuses a missing journal for a review-pending real run', async () => {
  const f = await fixture(); await rm(join(f.root, 'approvals', f.record.id + '.json'));
  expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false);
});
it('refuses absent keys and permanent consumed claims rather than regenerating them', async () => {
  const f = await fixture(); await consumed(f);
  const snapshot = await createOfflineSnapshot(f.root, { ...f.options, generation: 2 });
  const entries = JSON.parse(snapshot.bytes.toString()).entries as { path: string }[];
  const claim = entries.find(e => e.path.startsWith('approvals/.claim-'))!.path;
  await rm(join(f.root, claim), { recursive: true });
  expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false);
  await mkdir(join(f.root, claim), { mode: 0o700 });
  await rm(join(f.root, 'approvals', '.integrity-key'));
  expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false);
});
it('rejects stale generation in another process after consumption and external catalog advance', async () => {
  const f = await fixture(); const old = await createOfflineSnapshot(f.root, f.options);
  await writeFile(f.archive, old.bytes, { mode: 0o600 }); await consumed(f);
  const current = await createOfflineSnapshot(f.root, { ...f.options, generation: 2 });
  await writeFile(f.catalog, JSON.stringify(current.reference), { mode: 0o600 });
  const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { verifyOfflineSnapshot } from './server/workflow-backup.ts';
    try { await verifyOfflineSnapshot(process.env.BACKUP_ARCHIVE, process.env.BACKUP_CATALOG); process.stdout.write('accepted'); }
    catch { process.stdout.write('refused'); }
  `], { cwd: process.cwd(), env: { ...process.env, BACKUP_ARCHIVE: f.archive, BACKUP_CATALOG: f.catalog } });
  expect(child.stdout).toBe('refused');
  expect(await f.approvals.claimed(f.record.id)).toBe(true);
  await expect(f.approvals.claim(f.record.id)).rejects.toThrow();
  await writeFile(f.archive, current.bytes);
  expect(await verifyOfflineSnapshot(f.archive, f.catalog)).toMatchObject({ generation: 2, restore: 'blocked' });
});
it('rejects corrupt archive bytes and permissive archive/catalog modes', async () => {
  const f = await fixture(); const snapshot = await createOfflineSnapshot(f.root, f.options);
  await writeFile(f.archive, snapshot.bytes, { mode: 0o600 }); await writeFile(f.catalog, JSON.stringify(snapshot.reference), { mode: 0o600 });
  await writeFile(f.archive, Buffer.concat([snapshot.bytes, Buffer.from(' ')]));
  await expect(verifyOfflineSnapshot(f.archive, f.catalog)).rejects.toThrow(); await writeFile(f.archive, snapshot.bytes);
  await chmod(f.archive, 0o644); await expect(verifyOfflineSnapshot(f.archive, f.catalog)).rejects.toThrow(); await chmod(f.archive, 0o600);
  await chmod(f.catalog, 0o644); await expect(verifyOfflineSnapshot(f.archive, f.catalog)).rejects.toThrow();
});
it('rejects source symlinks, hardlinks, traversal, stale locks and oversized regular files', async () => {
  const f = await fixture(); const grants = join(f.root, 'grants.json');
  await symlink(grants, join(f.root, 'alias')); expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false); await rm(join(f.root, 'alias'));
  await link(grants, join(f.dir, 'hardlink')); expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false); await rm(join(f.dir, 'hardlink'));
  expect(await createOfflineSnapshot(f.root + '/../state', f.options).then(() => true, () => false)).toBe(false);
  await mkdir(join(f.root, 'workspace.json.lock'), { mode: 0o700 }); expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false); await rm(join(f.root, 'workspace.json.lock'), { recursive: true });
  const h = await open(grants, 'r+'); await h.truncate(16_000_001); await h.close();
  expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false);
});
it('does not invoke accessors or accept inherited authority/prototype keys', async () => {
  const f = await fixture(); let accessed = 0;
  const options = { ...f.options }; Object.defineProperty(options, 'generation', { get() { accessed++; return 1; } });
  expect(await createOfflineSnapshot(f.root, options).then(() => true, () => false)).toBe(false); expect(accessed).toBe(0);
  expect(await createOfflineSnapshot(f.root, Object.create(f.options)).then(() => true, () => false)).toBe(false);
  await writeFile(join(f.root, 'grants.json'), '{"__proto__":{}}');
  expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false);
});
it('rereads a file-backed external fence after an independent process advances it during verification', async () => {
  const f = await fixture(); const old = await createOfflineSnapshot(f.root, f.options);
  await writeFile(f.archive, old.bytes, { mode: 0o600 }); await writeFile(f.catalog, JSON.stringify(old.reference), { mode: 0o600 });
  const current = await createOfflineSnapshot(f.root, { ...f.options, generation: 2 });
  const next = join(f.dir, 'next.json'); await writeFile(next, JSON.stringify(current.reference), { mode: 0o600 });
  let reads = 0;
  const accepted = await verifyOfflineSnapshotAgainstFence(f.archive, async () => {
    const bytes = await readFile(f.catalog);
    if (++reads === 1) await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import { copyFile } from 'node:fs/promises';
      await copyFile(process.env.NEXT_CATALOG, process.env.CATALOG);
    `], { env: { ...process.env, NEXT_CATALOG: next, CATALOG: f.catalog } });
    return bytes;
  }).then(() => true, () => false);
  expect(accepted).toBe(false); expect(reads).toBe(2);
  expect(JSON.parse(await readFile(f.catalog, 'utf8')).generation).toBe(2);
});
it('does not bless a previous archive by copying only current generation and identity fields', async () => {
  const f = await fixture(); const old = await createOfflineSnapshot(f.root, f.options); await consumed(f);
  const current = await createOfflineSnapshot(f.root, { ...f.options, generation: 2 });
  const clone = JSON.parse(old.bytes.toString()); clone.generation = 2; clone.snapshotId = current.reference.snapshotId;
  await writeFile(f.archive, JSON.stringify(clone), { mode: 0o600 }); await writeFile(f.catalog, JSON.stringify(current.reference), { mode: 0o600 });
  await expect(verifyOfflineSnapshot(f.archive, f.catalog)).rejects.toThrow();
});
it('the read-only CLI reports blocked restore without disclosing archived key bytes', async () => {
  const f = await fixture(); const snapshot = await createOfflineSnapshot(f.root, f.options);
  await writeFile(f.archive, snapshot.bytes, { mode: 0o600 }); await writeFile(f.catalog, JSON.stringify(snapshot.reference), { mode: 0o600 });
  const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/workflow-backup-verify.ts', 'verify', f.archive, f.catalog], { cwd: process.cwd() });
  expect(JSON.parse(child.stdout)).toMatchObject({ integrity: 'verified', restore: 'blocked' });
  expect(child.stderr).toBe('');
  expect(child.stdout.includes((await readFile(join(f.root, 'approvals', '.integrity-key'))).toString('base64'))).toBe(false);
});
it('enforces internal manifest hashes, modes, paths and entry bounds even against an explicitly trusted synthetic reference', async () => {
  const f = await fixture(); const snapshot = await createOfflineSnapshot(f.root, f.options);
  for (const mutation of ['hash', 'mode', 'traversal', 'duplicate', 'count', 'version']) {
    const archive = JSON.parse(snapshot.bytes.toString());
    const file = archive.entries.find((e: { path: string }) => e.path === 'grants.json');
    if (mutation === 'hash') file.sha256 = '0'.repeat(64);
    if (mutation === 'mode') file.mode = 0o644;
    if (mutation === 'traversal') file.path = '../grants.json';
    if (mutation === 'duplicate') archive.entries.push(file);
    if (mutation === 'count') archive.entries = Array.from({ length: 2049 }, () => file);
    if (mutation === 'version') archive.version = 2;
    const bytes = Buffer.from(JSON.stringify(archive));
    const reference = { ...snapshot.reference, sha256: createHash('sha256').update(bytes).digest('hex') };
    await writeFile(f.archive, bytes, { mode: 0o600 }); await writeFile(f.catalog, JSON.stringify(reference), { mode: 0o600 });
    await expect(verifyOfflineSnapshot(f.archive, f.catalog)).rejects.toThrow('offline backup refused');
  }
});
it('refuses ancestor symlinks and source permission changes without altering source bytes', async () => {
  const f = await fixture(); const original = await readFile(join(f.root, 'workspace.json'));
  const alias = join(f.dir, 'alias'); await symlink(f.root, alias);
  expect(await createOfflineSnapshot(alias, f.options).then(() => true, () => false)).toBe(false);
  await chmod(join(f.root, 'grants.json'), 0o644);
  expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false);
  expect((await readFile(join(f.root, 'workspace.json'))).equals(original)).toBe(true);
});
it('refuses an orphan permanent claim after a consumed journal is removed', async () => {
  const f = await fixture(); await consumed(f); await rm(join(f.root, 'approvals', f.record.id + '.json'));
  expect(await createOfflineSnapshot(f.root, f.options).then(() => true, () => false)).toBe(false);
});
