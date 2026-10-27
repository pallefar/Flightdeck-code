import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, rm, writeFile, readFile, symlink, mkdir, stat, readdir, open, chmod, link } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createEmptyGraph } from '../../packages/workflow/graph';
import { createFileWorkflowWorkspaceStore, MAX_FILE_BYTES } from '../workflow-workspace-store';
let dir: string;
let file: string;
beforeEach(async () => { dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'workflow-store-')); file = join(dir, 'private', 'workspace.json'); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
describe('bounded private file workflow store', () => {
  it('refuses symlink target files and path ancestors, including broken links', async () => {
    const outside = join(dir, 'outside.json'); await writeFile(outside, '{"sensitive":"outside"}');
    await mkdir(join(dir, 'private')); await symlink(outside, file);
    await expect(createFileWorkflowWorkspaceStore(file).list('project')).rejects.toThrow();
    await expect(createFileWorkflowWorkspaceStore(file).create('project', createEmptyGraph(), 'Alice')).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('{"sensitive":"outside"}');
    await rm(file); await symlink(join(dir, 'missing.json'), file);
    await expect(createFileWorkflowWorkspaceStore(file).list('project')).rejects.toThrow();
    await rm(join(dir, 'private'), { recursive: true }); await mkdir(join(dir, 'real')); await symlink(join(dir, 'real'), join(dir, 'private'));
    await expect(createFileWorkflowWorkspaceStore(file).create('project', createEmptyGraph(), 'Alice')).rejects.toThrow();
  });
  it('rejects traversal paths, non-regular files and oversized files before unbounded reads', async () => {
    expect(() => createFileWorkflowWorkspaceStore(join(dir, 'x') + '/../escape.json')).toThrow();
    await mkdir(file, { recursive: true });
    await expect(createFileWorkflowWorkspaceStore(file).list('project')).rejects.toThrow();
    await rm(file, { recursive: true }); const handle = await open(file, 'w'); await handle.truncate(MAX_FILE_BYTES + 1); await handle.close();
    await expect(createFileWorkflowWorkspaceStore(file).list('project')).rejects.toThrow();
  });
  it('writes 0700 new directories / 0600 files and leaves old data intact on invalid writes', async () => {
    const store = createFileWorkflowWorkspaceStore(file);
    const draft = await store.create('project', createEmptyGraph(), 'Alice');
    expect((await stat(join(dir, 'private'))).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const old = await readFile(file, 'utf8');
    await expect(store.update('project', draft.id, { ...createEmptyGraph(), name: 'Bearer sensitive-value' }, 1, 'Alice')).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(old);
    expect(await readdir(join(dir, 'private'))).toEqual(['workspace.json']);
  });
  it('preserves the old acknowledged file on real tempfile permission failure', async () => {
    const store = createFileWorkflowWorkspaceStore(file); const draft = await store.create('project', createEmptyGraph(), 'Alice');
    const old = await readFile(file, 'utf8'); await chmod(join(dir, 'private'), 0o500);
    try {
      await expect(store.update('project', draft.id, createEmptyGraph('Changed'), 1, 'Alice')).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe(old);
      expect(await readdir(join(dir, 'private'))).toEqual(['workspace.json']);
    } finally { await chmod(join(dir, 'private'), 0o700); }
  });
  it('rejects hard-linked targets rather than reading another file through an alias', async () => {
    const store = createFileWorkflowWorkspaceStore(file); await store.create('project', createEmptyGraph(), 'Alice');
    await link(file, join(dir, 'alias.json'));
    await expect(store.list('project')).rejects.toThrow();
  });
  it('rejects secret/prototype-bearing and invalid stored schemas instead of treating corruption as empty', async () => {
    await mkdir(join(dir, 'private'));
    for (const value of ['{}', '{"version":1,"drafts":[],"runs":[],"__proto__":{}}', '{"version":1,"drafts":[],"runs":[],"password":"sensitive"}']) {
      await writeFile(file, value);
      await expect(createFileWorkflowWorkspaceStore(file).list('project')).rejects.toThrow();
    }
  });
  it('serializes independent store instances for the same file', async () => {
    const stores = Array.from({ length: 8 }, () => createFileWorkflowWorkspaceStore(file));
    await Promise.all(stores.map((store, i) => store.create('project', createEmptyGraph(`Draft ${i}`), 'Alice')));
    expect(await stores[0]!.list('project')).toHaveLength(8);
  });
  it('refuses duplicated/orphaned record identities and oversized persisted output', async () => {
    const store = createFileWorkflowWorkspaceStore(file); const draft = await store.create('project', createEmptyGraph(), 'Alice');
    const run = await store.reserveRun('project', draft.id, 1, {}, 'Alice');
    await store.finishRun('project', draft.id, run.id, { status: 'completed', output: {}, trace: [] });
    const original = JSON.parse(await readFile(file, 'utf8'));
    for (const mutate of [
      (data: any) => data.drafts.push(data.drafts[0]),
      (data: any) => { data.runs[0].draftId = randomUUID(); },
      (data: any) => { data.runs[0].result.output = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`field${i}`, 'x'.repeat(2000)])); },
    ]) {
      const data = structuredClone(original); mutate(data); await writeFile(file, JSON.stringify(data));
      await expect(createFileWorkflowWorkspaceStore(file).list('project')).rejects.toThrow();
    }
  });
  it('reports persisted in-flight records from another process epoch as interrupted and never replays', async () => {
    const store = createFileWorkflowWorkspaceStore(file); const draft = await store.create('project', createEmptyGraph(), 'Alice');
    const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { createFileWorkflowWorkspaceStore } from './server/workflow-workspace-store.ts';
      const store = createFileWorkflowWorkspaceStore(process.env.WORKFLOW_TEST_FILE);
      const run = await store.reserveRun('project', process.env.WORKFLOW_TEST_DRAFT, 1, {}, 'Alice');
      process.stdout.write(JSON.stringify(run));
    `], { cwd: process.cwd(), env: { ...process.env, WORKFLOW_TEST_FILE: file, WORKFLOW_TEST_DRAFT: draft.id } });
    const run = JSON.parse(child.stdout);
    const reopened = createFileWorkflowWorkspaceStore(file);
    expect(await reopened.getRun('project', draft.id, run.id)).toMatchObject({ state: 'interrupted', result: null, resumable: false, finishedAt: null });
    await expect(reopened.reserveRun('project', draft.id, 1, {}, 'Alice')).rejects.toThrow();
    await expect(reopened.finishRun('project', draft.id, run.id, { status: 'completed', output: {}, trace: [] })).rejects.toThrow();
  });
});
