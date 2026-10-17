import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileSubappWorkspaceStore } from '../subapp-workspace-store';
import { snapshotFixture } from '../../packages/subapp-workspace/testing';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'subapp-workspace-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('private durable sub-app workspace', () => {
  it('constructs without IO and acknowledges exact durable private source after reconstruction', async () => {
    const parent = join(root, 'private'); const file = join(parent, 'drafts.json');
    const store = createFileSubappWorkspaceStore(file);
    await expect(access(parent)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.list('project-one')).toEqual([]);
    await expect(access(parent)).rejects.toMatchObject({ code: 'ENOENT' });
    const snapshot = snapshotFixture(); snapshot.files[0]!.contents = '\r\nconst token = "key"; // PRIVATE_SOURCE\n\t';
    const draft = await store.create('project-one', snapshot, 'alice');
    expect(draft).toMatchObject({ projectId: 'project-one', revision: 1, status: 'draft', createdBy: 'alice', updatedBy: 'alice', snapshot });
    expect(draft.contentHash).toBe(createHash('sha256').update(JSON.stringify(draft.snapshot)).digest('hex'));
    expect((await lstat(parent)).mode & 0o777).toBe(0o700);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8')).drafts).toEqual([draft]);
    const reconstructed = createFileSubappWorkspaceStore(file);
    expect(await reconstructed.get('project-one', draft.id)).toEqual(draft);
    expect(await reconstructed.get('other-project', draft.id)).toBeUndefined();
    const summaries = await reconstructed.list('project-one');
    expect(summaries).toEqual([{ id: draft.id, projectId: draft.projectId, revision: 1, status: 'draft', contentHash: draft.contentHash, createdBy: 'alice', updatedBy: 'alice', createdAt: draft.createdAt, updatedAt: draft.updatedAt, label: 'Demo', subappId: 'demo', fileCount: 1 }]);
    expect(JSON.stringify(summaries)).not.toContain('PRIVATE_SOURCE');
  });

  it('CAS-updates only working source, retaining baseline, other records and exact project partition', async () => {
    const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
    const [draft, other] = await Promise.all([store.create('project-one', snapshotFixture(), 'alice'), createFileSubappWorkspaceStore(file).create('other-project', snapshotFixture(), 'bob')]);
    const edited = structuredClone(draft.snapshot); edited.files[0]!.contents = 'manual edit\r\n';
    const results = await Promise.allSettled([store.update('project-one', draft.id, edited, 1, 'carol'), createFileSubappWorkspaceStore(file).update('project-one', draft.id, edited, 1, 'dave')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').map(r => r.status === 'rejected' && r.reason.statusCode)).toEqual([409]);
    const saved = await createFileSubappWorkspaceStore(file).get('project-one', draft.id);
    expect(saved).toMatchObject({ revision: 2, createdBy: 'alice', createdAt: draft.createdAt, snapshot: edited });
    expect(saved!.contentHash).not.toBe(draft.contentHash);
    expect(await store.get('other-project', other.id)).toEqual(other);
    await expect(store.update('other-project', draft.id, edited, 2, 'bob')).rejects.toMatchObject({ statusCode: 404 });
    for (const mutate of [
      (s: typeof edited) => { s.baseline.files[0]!.contents = 'forged verified source'; },
      (s: typeof edited) => { s.baseline.rulesRun = ['forged-check']; },
      (s: typeof edited) => { s.baseline.manifest.capabilities = ['deploy']; },
    ]) {
      const forged = structuredClone(edited); mutate(forged);
      await expect(store.update('project-one', draft.id, forged, 2, 'alice')).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(await store.get('project-one', draft.id)).toEqual(saved);
  });

  it('reports a finite store-byte limit without rewriting or discarding existing records', async () => {
    const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
    const draft = await store.create('project-one', snapshotFixture(), 'alice');
    const snapshot = snapshotFixture();
    snapshot.baseline.files = Array.from({ length: 4 }, (_, i) => ({ ...snapshot.files[0]!, path: `server/subapps/demo/f${i}.ts`, contents: 'x'.repeat(190_000) }));
    snapshot.files = snapshot.baseline.files.map(f => ({ ...f }));
    const records = Array.from({ length: 21 }, () => ({ ...draft, id: randomUUID(), snapshot, contentHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') }));
    await writeFile(file, JSON.stringify({ version: 1, drafts: records }));
    const before = await readFile(file);
    expect(before.length).toBeLessThan(32_000_000);
    await expect(store.create('project-one', snapshot, 'alice')).rejects.toMatchObject({ statusCode: 413 });
    expect((await readFile(file)).equals(before)).toBe(true);
    expect(await store.list('project-one')).toHaveLength(21);
  }, 20_000);

  it.each(['symlink', 'hardlink', 'directory', 'public-file', 'public-parent', 'ancestor-symlink', 'corrupt', 'hash', 'duplicate', 'utf8'] as const)('refuses unsafe %s state without repair', async mode => {
    const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
    const draft = await store.create('project-one', snapshotFixture(), 'alice');
    if (mode === 'symlink') { await rename(file, join(root, 'original')); await symlink(join(root, 'original'), file); }
    if (mode === 'hardlink') await link(file, join(root, 'alias'));
    if (mode === 'directory') { await unlink(file); await mkdir(file, { mode: 0o700 }); }
    if (mode === 'public-file') await chmod(file, 0o644);
    if (mode === 'public-parent') await chmod(root, 0o755);
    if (mode === 'ancestor-symlink') {
      await symlink(root, join(root, 'alias'));
      await expect(createFileSubappWorkspaceStore(join(root, 'alias', 'drafts.json')).list('project-one')).rejects.toMatchObject({ statusCode: 503 });
      return;
    }
    if (mode === 'corrupt') await writeFile(file, '{PRIVATE_SENTINEL');
    if (mode === 'hash') await writeFile(file, JSON.stringify({ version: 1, drafts: [{ ...draft, contentHash: '0'.repeat(64) }] }));
    if (mode === 'duplicate') await writeFile(file, JSON.stringify({ version: 1, drafts: [draft, draft] }));
    if (mode === 'utf8') await writeFile(file, Buffer.from([0xff, 0xfe]));
    const before = await lstat(file); const bytes = before.isFile() || before.isSymbolicLink() ? await readFile(file) : null;
    await expect(store.list('project-one')).rejects.toMatchObject({ statusCode: 503, message: 'sub-app workspace operation refused' });
    await expect(store.create('project-one', snapshotFixture(), 'alice')).rejects.toMatchObject({ statusCode: 503 });
    expect((await lstat(file)).mode).toBe(before.mode);
    if (bytes) expect(await readFile(file)).toEqual(bytes);
  });

  it('rejects native invalid writes before creating directories and preserves source from caller mutation', async () => {
    const parent = join(root, 'missing'); const file = join(parent, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    await expect(store.create('project-one', cyclic, 'alice')).rejects.toMatchObject({ statusCode: 400 });
    await expect(store.create('project-one', snapshotFixture(), ' alice ')).rejects.toMatchObject({ statusCode: 400 });
    await expect(store.create('INVALID', snapshotFixture(), 'alice')).rejects.toMatchObject({ statusCode: 400 });
    await expect(access(parent)).rejects.toMatchObject({ code: 'ENOENT' });
    const input = snapshotFixture(); const expected = structuredClone(input); const pending = store.create('project-one', input, 'alice'); input.files[0]!.contents = 'mutated after admission';
    const draft = await pending; expect(draft.snapshot).toEqual(expected);
  });

  it('lists every admitted metadata string without a stricter hidden summary byte ceiling', async () => {
    const store = createFileSubappWorkspaceStore(join(root, 'drafts.json')); const snapshot = snapshotFixture();
    snapshot.baseline.manifest.label = '\u0001'.repeat(2_000); snapshot.baseline.manifest.id = '\u0002'.repeat(2_000);
    const draft = await store.create('project-one', snapshot, 'alice');
    expect((await store.list('project-one'))[0]).toMatchObject({ id: draft.id, label: snapshot.baseline.manifest.label, subappId: snapshot.baseline.manifest.id });
  });

  it('refuses the document-count ceiling without overwriting any existing project', async () => {
    const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
    const draft = await store.create('project-one', snapshotFixture(), 'alice');
    const records = Array.from({ length: 64 }, () => ({ ...draft, id: randomUUID() }));
    await writeFile(file, JSON.stringify({ version: 1, drafts: records })); const before = await readFile(file);
    await expect(store.create('another-project', snapshotFixture(), 'alice')).rejects.toMatchObject({ statusCode: 413 });
    expect((await readFile(file)).equals(before)).toBe(true); expect(await store.list('project-one')).toHaveLength(64);
  });
});
