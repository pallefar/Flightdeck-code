import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFileSubappWorkspaceStore } from '../subapp-workspace-store';

async function race(file: string, action: 'create' | 'update', id?: string) {
  const children = Array.from({ length: 2 }, () => fork(fileURLToPath(new URL('../../packages/subapp-workspace/process-fixture.ts', import.meta.url)), [file, action, ...(id ? [id] : [])], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }));
  try {
    const ready: Promise<void>[] = [];
    const results = children.map(child => {
      let readyResolve!: () => void; let readyReject!: (error: Error) => void;
      ready.push(new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; }));
      // A fixture failure rejects both stages; mark ready observed immediately.
      void ready.at(-1)!.catch(() => {});
      return new Promise<{ status: number; id?: string; revision?: number }>((resolve, reject) => {
        let result: { status: number; id?: string; revision?: number } | undefined; let stderr = '';
        child.stderr?.on('data', chunk => { stderr += String(chunk).slice(0, 4_000); });
        child.on('message', (message: { ready?: boolean; result?: typeof result }) => {
          if (message.ready) readyResolve(); if (message.result) result = message.result;
        });
        child.once('error', error => { readyReject(error); reject(error); });
        child.once('exit', code => {
          if (code === 0 && result) resolve(result);
          else { const error = new Error(`process fixture failed: ${code}: ${stderr}`); readyReject(error); reject(error); }
        });
      });
    });
    // Observe result rejection while waiting for both startup barriers.
    for (const result of results) void result.catch(() => {});
    await Promise.all(ready); for (const child of children) child.send({ go: true });
    return await Promise.all(results);
  } finally { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); }
}

it('coordinates two independent OS writers with no lost records and exactly one CAS winner', async () => {
  const root = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'subapp-process-test-'));
  try {
    const file = join(root, 'drafts.json'); const store = createFileSubappWorkspaceStore(file);
    const created = await race(file, 'create');
    expect(created.map(r => r.status)).toEqual([200, 200]);
    const initial = await store.list('project-one'); expect(initial).toHaveLength(2);
    const id = initial[0]!.id; const untouched = await store.get('project-one', initial[1]!.id);
    const updated = await race(file, 'update', id);
    expect(updated.map(r => r.status).sort()).toEqual([200, 409]);
    const reconstructed = createFileSubappWorkspaceStore(file);
    expect(await reconstructed.get('project-one', id)).toMatchObject({ revision: 2 });
    expect(await reconstructed.get('project-one', initial[1]!.id)).toEqual(untouched);
    expect(JSON.parse(await readFile(file, 'utf8')).drafts).toHaveLength(2);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15_000);
