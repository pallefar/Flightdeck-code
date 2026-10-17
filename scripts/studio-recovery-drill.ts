import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ResourceStore } from '../packages/resources/store';
import { createWorkflowRunner } from '../packages/workflow/engine';
import { createEmptyGraph, type Graph } from '../packages/workflow/graph';
import { WorkflowApprovalStore } from '../server/workflow-approval-store';
import { createFileWorkflowWorkspaceStore } from '../server/workflow-workspace-store';
import { createOfflineSnapshot } from '../server/workflow-backup';
import { decryptOfflineBackup, encryptOfflineBackup } from '../server/workflow-backup-envelope';

const refused = (): never => { throw new Error('synthetic recovery drill refused'); };
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const zero = { loadSecrets: 0, operatorFromEnv: 0, createServer: 0, listen: 0 };

// Existing scratch parent only, no traversal normalization, creation, chmod or discovery.
async function scratchParent(path: string) {
  if (typeof path !== 'string' || !path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path)) refused();
  const parts = path.slice(1).split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) refused();
  for (let i = 0; i <= parts.length; i++) {
    const info = await lstat(i ? '/' + parts.slice(0, i).join('/') : '/');
    if (!info.isDirectory() || info.isSymbolicLink()) refused();
    if (i === parts.length && ((info.mode & 0o7777) !== 0o700 || info.uid !== process.getuid?.())) refused();
  }
}
type Witness = { path: string; kind: 'file' | 'directory'; mode: number; uid: number; gid: number; data?: string };
async function inventory(root: string): Promise<Witness[]> {
  const entries: Witness[] = [];
  async function visit(path: string, relative: string) {
    const info = await lstat(path), directory = info.isDirectory();
    assert.equal(info.isSymbolicLink(), false); assert.equal(info.uid, process.getuid?.());
    assert.equal(info.mode & 0o7777, directory ? 0o700 : 0o600);
    assert.ok(directory || (info.isFile() && info.nlink === 1 && info.size <= 16_000_000));
    const entry: Witness = { path: relative, kind: directory ? 'directory' : 'file', mode: info.mode & 0o7777, uid: info.uid, gid: info.gid };
    if (!directory) entry.data = (await readFile(path, { flag: constants.O_RDONLY | constants.O_NOFOLLOW })).toString('base64');
    entries.push(entry); assert.ok(entries.length <= 2048);
    if (directory) for (const name of (await readdir(path)).sort()) await visit(join(path, name), relative ? relative + '/' + name : name);
  }
  await visit(root, ''); return entries;
}

/** Actual bootstrap + actual native quarantine guard; all downstream dependencies are deny-only fixtures. */
function quarantineAttempt(root: string, scratch: string) {
  const preload = `import {registerHooks} from 'node:module';import {writeSync} from 'node:fs';
    const counts=${JSON.stringify(zero)};
    process.on('exit',()=>writeSync(3,JSON.stringify(counts)));
    registerHooks({load(url,context,next){
      if(url.endsWith('/deploy/studio-docker/secrets.mjs'))return {format:'module',shortCircuit:true,source:
        'export async function loadSecrets(){globalThis.drillCounts.loadSecrets++;throw new Error("fixture downstream denied")}'};
      if(url.endsWith('/server/index.ts'))return {format:'module',shortCircuit:true,source:
        'export function operatorFromEnv(){globalThis.drillCounts.operatorFromEnv++;throw new Error("fixture downstream denied")};export function createServer(){globalThis.drillCounts.createServer++;return {async listen(){globalThis.drillCounts.listen++;throw new Error("fixture downstream denied")}}}'};
      return next(url,context);
    }});globalThis.drillCounts=counts;`;
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), fileURLToPath(new URL('../deploy/studio-docker/bootstrap.mjs', import.meta.url))], {
    encoding: 'utf8', cwd: root, timeout: 10_000, maxBuffer: 65_536, stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    // No inherited credentials, operator/model configuration or network destination.
    env: { STUDIO_STATE_DIR: root, TMPDIR: scratch, TSX_DISABLE_CACHE: '1' },
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.equal(result.signal, null);
  assert.equal(result.stdout, ''); assert.equal(result.stderr, 'studio: startup refused (check private configuration)\n');
  const evidence = result.output[3]; assert.equal(typeof evidence, 'string');
  assert.deepEqual(JSON.parse(String(evidence)), zero);
}
async function rejected(operation: Promise<unknown>) {
  const result = await operation.then(() => false, (error: unknown) => {
    assert.ok(error instanceof Error); assert.equal(error.message, 'encrypted offline backup refused'); return true;
  });
  assert.equal(result, true);
}

async function exercise(directory: string) {
  const root = join(directory, 'synthetic-state'); await mkdir(root, { mode: 0o700 });
  const resourceRoot = join(root, 'resources'); await mkdir(resourceRoot, { mode: 0o700 });
  await new ResourceStore(resourceRoot).propose('synthetic-recovery', { name: 'Synthetic offline measurement', functions: ['measure'] }, 'Fixture Initiator');
  await writeFile(join(root, 'grants.json'), '{"synthetic":true,"grants":[]}', { mode: 0o600, flag: 'wx' });
  const graph: Graph = { ...createEmptyGraph(), nodes: [
    { id: 'start', type: 'manual', label: 'Synthetic start', position: { x: 0, y: 0 }, config: {} },
    { id: 'gate', type: 'approval', label: 'Synthetic gate', position: { x: 1, y: 0 }, config: { reviewer: 'Synthetic independent queue', reason: 'Isolated fixture only' } },
    { id: 'out', type: 'output', label: 'Synthetic output', position: { x: 2, y: 0 }, config: {} },
  ], edges: [{ id: 'a', source: 'start', target: 'gate' }, { id: 'b', source: 'gate', target: 'out' }] };
  let adapterCalls = 0, resumeCalls = 0;
  const noAdapter = async (): Promise<never> => { adapterCalls++; return refused(); };
  const runner = createWorkflowRunner(graph, { http: noAdapter, llm: noAdapter, resource: noAdapter, authorizeHuman: noAdapter }, { initiator: 'Fixture Initiator' });
  runner.resume = async () => { resumeCalls++; return refused(); };
  const store = createFileWorkflowWorkspaceStore(join(root, 'workspace.json'));
  const draft = await store.create('synthetic-recovery', graph, 'Fixture Initiator');
  const reserved = await store.reserveRun(draft.projectId, draft.id, 1, { synthetic: 'retained exact ordered input' }, 'Fixture Initiator');
  const paused = await runner.run(reserved.input); assert.equal(paused.status, 'paused');
  const run = await store.finishRun(draft.projectId, draft.id, reserved.id, paused, true);
  const approvals = new WorkflowApprovalStore(join(root, 'approvals'));
  const record = await approvals.create(run, runner.checkpoint(paused), 60_000);
  // Model the real claim-before-resume crash boundary. No human decision, restore, beginResume or effect follows.
  await approvals.claim(record.id); assert.equal(await approvals.claimed(record.id), true);
  const before = await inventory(root);
  const claims = before.filter(e => e.path.startsWith('approvals/.claim-'));
  assert.equal(claims.length, 1); assert.equal(claims[0]!.kind, 'directory');
  const options = { serverId: randomUUID(), epoch: randomUUID(), generation: 1, quiescence: 'all-writers-stopped' as const };
  const snapshot = await createOfflineSnapshot(root, options);
  const catalog = join(directory, 'synthetic-reference-not-monotonic.json');
  await writeFile(catalog, JSON.stringify(snapshot.reference), { mode: 0o600, flag: 'wx' });
  const fence = async () => readFile(catalog, { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
  const key = randomBytes(32);
  let plaintext: Buffer | undefined;
  try {
    const encrypted = await encryptOfflineBackup(snapshot.bytes, key, directory, fence);
    const encryptedPath = join(directory, 'synthetic-envelope.bin');
    await writeFile(encryptedPath, encrypted, { mode: 0o600, flag: 'wx' });
    const encryptedInfo = await lstat(encryptedPath);
    assert.ok(encryptedInfo.isFile() && !encryptedInfo.isSymbolicLink() && encryptedInfo.nlink === 1);
    assert.equal(encryptedInfo.uid, process.getuid?.()); assert.equal(encryptedInfo.mode & 0o7777, 0o600);
    const diskEnvelope = await readFile(encryptedPath, { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
    assert.ok(diskEnvelope.equals(encrypted));
    const opened = await decryptOfflineBackup(diskEnvelope, key, directory, fence); plaintext = opened.bytes;
    assert.equal(opened.report.restore, 'blocked'); assert.ok(plaintext.equals(snapshot.bytes));
    type ArchiveEntry = { path: string; kind: string; mode: number; data?: string };
    const archived = (JSON.parse(plaintext.toString()) as { entries: ArchiveEntry[] }).entries;
    assert.equal(archived.length, before.length - 1);
    for (const entry of archived) {
      const actual = before.find(e => e.path === entry.path); assert.ok(actual);
      assert.equal(entry.kind, actual.kind); assert.equal(entry.mode, actual.mode); assert.equal(entry.data, actual.data);
    }
    await rejected(decryptOfflineBackup(encrypted, randomBytes(32), directory, fence));
    const tampered = Buffer.from(encrypted); tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    await rejected(decryptOfflineBackup(tampered, key, directory, fence));
    const next = await createOfflineSnapshot(root, { ...options, generation: 2 });
    await writeFile(catalog, JSON.stringify(next.reference));
    await rejected(decryptOfflineBackup(encrypted, key, directory, fence));
    assert.deepEqual(await inventory(root), before);
    // No archive extraction: mark only this freshly generated fixture; never unlock it.
    await writeFile(join(root, '.restore-blocked'), 'synthetic verification quarantine; not restore approval\n', { mode: 0o600, flag: 'wx' });
    const marked = await inventory(root);
    for (let attempt = 0; attempt < 2; attempt++) {
      quarantineAttempt(root, directory); assert.deepEqual(await inventory(root), marked);
    }
    assert.equal(adapterCalls, 0); assert.equal(resumeCalls, 0);
    return {
      version: 1 as const, scope: 'synthetic-isolated-verification-only' as const, integrity: opened.report.integrity, restore: 'blocked' as const,
      extraction: 'not-implemented' as const, runtimeStarted: false, sourceUnchanged: true, archiveBytesPreserved: true, archiveModesPreserved: true, encryptedFileRoundTrip: true,
      files: opened.report.files, entries: opened.report.entries, permanentClaims: claims.length, adapterCalls, resumeCalls,
      tamperRefused: true, wrongKeyRefused: true, staleFenceRefused: true,
      quarantine: { attempts: 2, bootstrapRefused: true, downstream: { ...zero } },
      inventorySha256: sha256(JSON.stringify(marked)), encryptedSha256: sha256(encrypted),
    };
  } finally { key.fill(0); plaintext?.fill(0); snapshot.bytes.fill(0); }
}

/** Creates/removes only one new random fixture subtree. Never accepts a backup, state root or key. */
export async function runSyntheticRecoveryDrill(scratchDirectory: string) {
  try {
    await scratchParent(scratchDirectory);
    const directory = await mkdtemp(join(scratchDirectory, 'studio-recovery-drill-'));
    let report: Awaited<ReturnType<typeof exercise>>;
    try { report = await exercise(directory); }
    finally {
      // Delete the entire owned synthetic fixture, not a marker to unlock a runnable target.
      await rm(directory, { recursive: true, force: false });
      const absent = await lstat(directory).then(() => false, (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
      assert.equal(absent, true);
    }
    return { ...report, cleanup: 'verified' as const };
  } catch { return refused(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), scratch = args[1];
    if (args.length !== 2 || args[0] !== 'synthetic' || typeof scratch !== 'string') throw new Error('synthetic recovery drill refused');
    process.stdout.write(JSON.stringify(await runSyntheticRecoveryDrill(scratch)) + '\n');
  } catch {
    process.stderr.write('synthetic recovery drill refused\n'); process.exitCode = 1;
  }
}
