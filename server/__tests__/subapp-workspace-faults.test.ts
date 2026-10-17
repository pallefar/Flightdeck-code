import { constants } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';

const faults = vi.hoisted(() => ({
  fileSync: false, directorySync: false, renames: 0, syncedDirectories: [] as string[],
  completedDirectories: [] as string[],
  partialWrite: false, closeFailure: false, unlinkAttempts: [] as string[],
  beforeDirectorySync: undefined as ((path: string) => Promise<void>) | undefined,
  afterRename: undefined as ((path: string) => Promise<void>) | undefined,
  afterRead: undefined as ((path: string) => Promise<void>) | undefined,
}));
// Real native IO with explicit boundary faults; no fabricated store responses.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual,
    unlink: async (...args: Parameters<typeof actual.unlink>) => { faults.unlinkAttempts.push(String(args[0])); return actual.unlink(...args); },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      await actual.rename(...args); faults.renames++; await faults.afterRename?.(String(args[1]));
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args); const sync = handle.sync.bind(handle); const read = handle.read.bind(handle);
      const writeFile = handle.writeFile.bind(handle); const close = handle.close.bind(handle);
      const temporary = String(args[0]).includes('/.subapp-workspace-');
      handle.writeFile = (async (...writeArgs: Parameters<typeof writeFile>) => {
        if (temporary && faults.partialWrite) {
          if (!Buffer.isBuffer(writeArgs[0])) throw new Error('DEVELOPMENT_FIXTURE_EXPECTED_BUFFER');
          await writeFile(writeArgs[0].subarray(0, 31));
          throw Object.assign(new Error('DEVELOPMENT_PARTIAL_WRITE'), { code: 'ENOSPC' });
        }
        return writeFile(...writeArgs);
      }) as typeof handle.writeFile;
      handle.close = async () => {
        await close();
        if (temporary && faults.closeFailure) { faults.closeFailure = false; throw Object.assign(new Error('DEVELOPMENT_CLOSE_EIO'), { code: 'EIO' }); }
      };
      handle.sync = async () => {
        const directory = typeof args[1] === 'number' && (args[1] & constants.O_DIRECTORY) !== 0;
        if (directory) faults.syncedDirectories.push(String(args[0]));
        if (directory) await faults.beforeDirectorySync?.(String(args[0]));
        if (directory ? faults.directorySync : faults.fileSync) throw new Error('DEVELOPMENT_SYNC_FAULT');
        await sync();
        if (directory) faults.completedDirectories.push(String(args[0]));
      };
      handle.read = (async (...readArgs: Parameters<typeof read>) => {
        const result = await read(...readArgs); const hook = faults.afterRead;
        if (hook) { faults.afterRead = undefined; await hook(String(args[0])); }
        return result;
      }) as typeof handle.read;
      return handle;
    },
  };
});
import { createFileSubappWorkspaceStore } from '../subapp-workspace-store';
import { snapshotFixture } from '../../packages/subapp-workspace/testing';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'subapp-fault-test-'));
  Object.assign(faults, { fileSync: false, directorySync: false, renames: 0, syncedDirectories: [], completedDirectories: [], partialWrite: false, closeFailure: false, unlinkAttempts: [], beforeDirectorySync: undefined, afterRename: undefined, afterRead: undefined });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('syncs the containing directory for each newly created private ancestor before acknowledging durability', async () => {
  const parent = join(root, 'new-private'); const nested = join(parent, 'nested'); const file = join(nested, 'drafts.json');
  const store = createFileSubappWorkspaceStore(file);
  const draft = await store.create('project-one', snapshotFixture(), 'alice');
  expect(faults.syncedDirectories).toContain(root);
  expect(faults.syncedDirectories).toContain(parent);
  expect(faults.syncedDirectories).toContain(nested);
  expect(await store.get('project-one', draft.id)).toEqual(draft);
});

it('completes its own containing-directory barrier when a concurrent creator is paused before fsync', async () => {
  const file = join(root, 'new-private', 'drafts.json');
  let entered!: () => void; let release!: () => void; let first = true;
  const paused = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  faults.beforeDirectorySync = async path => { if (path === root && first) { first = false; entered(); await barrier; } };
  const creator = createFileSubappWorkspaceStore(file).create('project-one', snapshotFixture(), 'alice');
  try {
    await paused;
    const other = await createFileSubappWorkspaceStore(file).create('project-one', snapshotFixture(), 'bob');
    expect(other.revision).toBe(1);
    expect(faults.completedDirectories).toContain(root);
    expect(await createFileSubappWorkspaceStore(file).get('project-one', other.id)).toEqual(other);
  } finally { release(); await creator; }
});

it('does not acknowledge a failed exact readback and never repairs or retries a committed mutation', async () => {
  const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  faults.afterRename = async path => { await writeFile(path, '{DEVELOPMENT_READBACK_FAULT'); };
  await expect(store.create('project-one', snapshotFixture(), 'alice')).rejects.toMatchObject({ statusCode: 503 });
  expect(faults.renames).toBe(1);
  expect(await readFile(file, 'utf8')).toBe('{DEVELOPMENT_READBACK_FAULT');
  expect(await readdir(root)).toEqual(['drafts.json']);
});

it('compares exact serialized readback bytes rather than only a parsed-equivalent file', async () => {
  const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  faults.afterRename = async path => { await writeFile(path, Buffer.concat([await readFile(path), Buffer.from(' ')])); };
  await expect(store.create('project-one', snapshotFixture(), 'alice')).rejects.toMatchObject({ statusCode: 503 });
  expect(faults.renames).toBe(1);
  // The actual commit remains inspectable; refusal does not authorize replay or repair.
  expect(await store.list('project-one')).toHaveLength(1);
});

it('never interprets a missing post-commit readback as a successful empty store', async () => {
  const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  faults.afterRename = async path => { await unlink(path); };
  await expect(store.create('project-one', snapshotFixture(), 'alice')).rejects.toMatchObject({ statusCode: 503 });
  expect(faults.renames).toBe(1); expect(await readdir(root)).toEqual([]);
});

it('preserves the prior records on a pre-rename file fsync failure and removes only its own temp/lock', async () => {
  const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  const draft = await store.create('project-one', snapshotFixture(), 'alice'); const before = await readFile(file);
  faults.fileSync = true;
  await expect(store.update('project-one', draft.id, snapshotFixture(), 1, 'alice')).rejects.toMatchObject({ statusCode: 503 });
  expect((await readFile(file)).equals(before)).toBe(true); expect(await readdir(root)).toEqual(['drafts.json']);
  expect(faults.renames).toBe(1);
});

it('reports uncertain durability when directory fsync fails after a real commit without replaying it', async () => {
  const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  const draft = await store.create('project-one', snapshotFixture(), 'alice');
  // Ancestor barriers now also run before mutation: fail at the intended post-rename boundary.
  faults.afterRename = async () => { faults.directorySync = true; };
  await expect(store.update('project-one', draft.id, snapshotFixture(), 1, 'bob')).rejects.toMatchObject({ statusCode: 503 });
  faults.directorySync = false;
  expect(await store.get('project-one', draft.id)).toMatchObject({ revision: 2, updatedBy: 'bob' });
  expect(faults.renames).toBe(2); expect(await readdir(root)).toEqual(['drafts.json']);
});

it('explicitly retries a previously failed ancestor barrier instead of treating the remaining directory as durable', async () => {
  const file = join(root, 'new-private', 'nested', 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  faults.beforeDirectorySync = async path => { if (path === root) throw Object.assign(new Error('DEVELOPMENT_ANCESTOR_EIO'), { code: 'EIO' }); };
  await expect(store.create('project-one', snapshotFixture(), 'alice')).rejects.toMatchObject({ statusCode: 503 });
  expect((await lstat(join(root, 'new-private'))).isDirectory()).toBe(true);
  expect(faults.renames).toBe(0);
  faults.beforeDirectorySync = undefined; faults.completedDirectories = [];
  const draft = await store.create('project-one', snapshotFixture(), 'alice');
  expect(faults.completedDirectories).toContain(root); expect(draft.revision).toBe(1);
  expect(await store.get('project-one', draft.id)).toEqual(draft);
});

it('refuses an existing private ancestor barrier failure before changing prior committed bytes', async () => {
  const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  const draft = await store.create('project-one', snapshotFixture(), 'alice'); const before = await readFile(file);
  faults.directorySync = true;
  await expect(store.update('project-one', draft.id, snapshotFixture(), 1, 'bob')).rejects.toMatchObject({ statusCode: 503 });
  faults.directorySync = false;
  expect((await readFile(file)).equals(before)).toBe(true); expect(faults.renames).toBe(1);
  expect(await store.get('project-one', draft.id)).toMatchObject({ revision: 1, updatedBy: 'alice' });
});

it('still unlinks its owned partial temporary file when cleanup close reports EIO', async () => {
  const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  const draft = await store.create('project-one', snapshotFixture(), 'alice');
  const before = await readFile(file); faults.unlinkAttempts = []; faults.partialWrite = true; faults.closeFailure = true;
  await expect(store.update('project-one', draft.id, snapshotFixture(), 1, 'alice')).rejects.toMatchObject({ statusCode: 503 });
  expect((await readFile(file)).equals(before)).toBe(true);
  expect(faults.unlinkAttempts).toHaveLength(1);
  expect(await readdir(root)).toEqual(['drafts.json']);
});

it('detects real file metadata drift across a bounded read', async () => {
  const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
  await store.create('project-one', snapshotFixture(), 'alice'); const before = await readFile(file);
  faults.afterRead = async path => { await writeFile(path, Buffer.concat([before, Buffer.from(' ')])); };
  await expect(store.list('project-one')).rejects.toMatchObject({ statusCode: 503 });
  expect((await lstat(file)).size).toBe(before.length + 1);
});
