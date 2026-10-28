import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, readdir, writeFile, chmod, lstat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { types } from 'node:util';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createEmptyGraph } from '../../packages/workflow/graph';
import { createWorkflowRunner } from '../../packages/workflow/engine';
import { createFileWorkflowWorkspaceStore } from '../workflow-workspace-store';
import { WorkflowApprovalStore } from '../workflow-approval-store';
import { createOfflineSnapshot } from '../workflow-backup';
import { encryptOfflineBackup, decryptOfflineBackup } from '../workflow-backup-envelope';
import { runSyntheticRecoveryDrill } from '../../scripts/studio-recovery-drill';
import { createOwnedFixture, fixtureCleanupReceipt } from '../../scripts/test-fixtures/owned-root';

const cleanup: Awaited<ReturnType<typeof createOwnedFixture>>[] = [];
afterEach(async () => {
  try { for (const owned of cleanup.splice(0)) await owned.clean(); }
  finally { fixtureCleanupReceipt(expect.getState().currentTestName); }
});
async function fixture() {
  const owned = await createOwnedFixture('envelope-test-'); cleanup.push(owned);
  const { dir } = owned;
  const root = join(dir, 'state'); await mkdir(root, { mode: 0o700 });
  await mkdir(join(root, 'resources'), { mode: 0o700 });
  await mkdir(join(root, 'approvals'), { mode: 0o700 });
  await writeFile(join(root, 'workspace.json'), JSON.stringify({ version: 2, drafts: [], runs: [] }), { mode: 0o600 });
  await writeFile(join(root, 'grants.json'), JSON.stringify({ synthetic: 'PRIVATE-FIXTURE-NOT-A-CREDENTIAL' }), { mode: 0o600 });
  await writeFile(join(root, 'approvals/.integrity-key'), randomBytes(32), { mode: 0o600 });
  const snapshot = await createOfflineSnapshot(root, { serverId: randomUUID(), epoch: randomUUID(), generation: 1, quiescence: 'all-writers-stopped' });
  const reference = Buffer.from(JSON.stringify(snapshot.reference));
  return { ...owned, root, snapshot, reference, key: randomBytes(32), fence: async () => reference };
}
it('authenticates an encrypted bounded archive and returns exact validated bytes with restore blocked', async () => {
  const f = await fixture(); const before = await readdir(f.dir);
  const encrypted = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, f.fence);
  expect(encrypted.equals(f.snapshot.bytes)).toBe(false);
  expect(encrypted.includes(Buffer.from('PRIVATE-FIXTURE-NOT-A-CREDENTIAL'))).toBe(false);
  const decrypted = await decryptOfflineBackup(encrypted, f.key, f.dir, f.fence);
  expect(decrypted.bytes.equals(f.snapshot.bytes)).toBe(true);
  expect(decrypted.report).toMatchObject({ integrity: 'verified', restore: 'blocked', generation: 1 });
  expect(await readdir(f.dir)).toEqual(before);
});
it('requires an explicit 32-byte Buffer key before any fence read, never a password or ambient discovery', async () => {
  const f = await fixture(), fence = vi.fn(f.fence);
  for (const key of [undefined, 'k'.repeat(32), new Uint8Array(32), Buffer.alloc(31), Buffer.alloc(33)]) {
    await expect(encryptOfflineBackup(f.snapshot.bytes, key as Buffer, f.dir, fence)).rejects.toThrow('encrypted offline backup refused');
    expect(fence).not.toHaveBeenCalled();
  }
});
it('snapshots caller buffers before awaits so mutated inputs cannot replace the validated archive or key', async () => {
  const f = await fixture(), archive = Buffer.from(f.snapshot.bytes), key = Buffer.from(f.key);
  const fence = async () => { f.snapshot.bytes.fill(0); f.key.fill(0); return f.reference; };
  const encrypted = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, fence);
  const decrypted = await decryptOfflineBackup(encrypted, key, f.dir, f.fence);
  expect(decrypted.bytes.equals(archive)).toBe(true);
});
it('refuses unsafe or nonprivate scratch roots before staging or invoking the fence', async () => {
  const f = await fixture(), fence = vi.fn(f.fence);
  const loose = join(f.dir, 'loose'); await mkdir(loose, { mode: 0o700 }); await chmod(loose, 0o755);
  const alias = join(f.dir, 'alias'); await symlink(f.dir, alias);
  for (const path of [loose, alias, join(alias, 'state'), f.dir + '/', f.dir + '/.', f.dir + '//state', f.dir + '/state/..', 'relative', f.dir + '/bad\npath', f.dir + '/bad\\path']) {
    const accepted = await encryptOfflineBackup(f.snapshot.bytes, f.key, path, fence).then(() => true, () => false);
    expect(accepted).toBe(false); expect(fence).not.toHaveBeenCalled();
  }
});
it('stages only an exclusive private regular archive and completely cleans it on success or fenced failure', async () => {
  const f = await fixture(), before = await readdir(f.dir); let reads = 0;
  const fence = async () => {
    reads++;
    const names = (await readdir(f.dir)).filter(n => n.startsWith('offline-envelope-'));
    expect(names).toHaveLength(1);
    const dir = join(f.dir, names[0]!); expect((await lstat(dir)).mode & 0o7777).toBe(0o700);
    expect((await lstat(dir)).uid).toBe(process.getuid!());
    expect(await readdir(dir)).toEqual(['archive.json']);
    const file = await lstat(join(dir, 'archive.json'));
    expect(file.isFile()).toBe(true); expect(file.isSymbolicLink()).toBe(false);
    expect(file.nlink).toBe(1); expect(file.mode & 0o7777).toBe(0o600); expect(file.uid).toBe(process.getuid!());
    return f.reference;
  };
  await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, fence); expect(reads).toBe(2);
  await expect(encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, async () => { await fence(); throw new Error('PRIVATE-FIXTURE-ERROR'); })).rejects.toThrow('encrypted offline backup refused');
  expect(await readdir(f.dir)).toEqual(before);
});
it('requires bounded immutable fence byte buffers rather than coercing strings or shared memory', async () => {
  const f = await fixture(), before = await readdir(f.dir);
  for (const value of [f.reference.toString(), Buffer.alloc(4097), Buffer.from(new SharedArrayBuffer(f.reference.length))]) {
    if (Buffer.isBuffer(value) && value.buffer instanceof SharedArrayBuffer) f.reference.copy(value);
    const accepted = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, async () => value as Buffer).then(() => true, () => false);
    expect(accepted).toBe(false);
  }
  expect(await readdir(f.dir)).toEqual(before);
});
async function expectRefused(operation: Promise<unknown>) {
  const error: unknown = await operation.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error('expected fixed refusal');
  expect(error.message).toBe('encrypted offline backup refused');
  expect(error.cause).toBeUndefined(); expect(Object.keys(error)).toEqual([]);
  expect(error.stack).not.toContain('PRIVATE-FIXTURE');
}
it.each(['key', 'archive', 'envelope', 'fence'] as const)('refuses cross-realm shared backing for %s bytes', async role => {
  const f = await fixture(), before = await readdir(f.dir);
  const valid = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, f.fence);
  const shared = (bytes: Buffer): Buffer => {
    const backing: unknown = runInNewContext(`new SharedArrayBuffer(${bytes.length})`);
    expect(types.isSharedArrayBuffer(backing)).toBe(true);
    expect(backing instanceof SharedArrayBuffer).toBe(false);
    const value = Buffer.from(backing as SharedArrayBuffer);
    bytes.copy(value);
    return value;
  };
  const fence = vi.fn(async () => role === 'fence' ? shared(f.reference) : f.reference);
  const operation = role === 'envelope'
    ? decryptOfflineBackup(shared(valid), f.key, f.dir, fence)
    : encryptOfflineBackup(role === 'archive' ? shared(f.snapshot.bytes) : f.snapshot.bytes,
      role === 'key' ? shared(f.key) : f.key, f.dir, fence);
  await expectRefused(operation);
  expect(fence).toHaveBeenCalledTimes(role === 'fence' ? 1 : 0);
  expect(await readdir(f.dir)).toEqual(before);
});
it('uses fresh random nonces and interoperates with native AES-256-GCM including exact metadata AAD', async () => {
  const f = await fixture();
  const first = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, f.fence);
  const second = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, f.fence);
  expect(first.subarray(16, 28).equals(second.subarray(16, 28))).toBe(false);
  const n = first.readUInt16BE(10), aad = first.subarray(0, 28 + n);
  expect(first.subarray(28, 28 + n).equals(f.reference)).toBe(true);
  const native = createDecipheriv('aes-256-gcm', f.key, first.subarray(16, 28), { authTagLength: 16 });
  native.setAAD(aad); native.setAuthTag(first.subarray(-16));
  expect(Buffer.concat([native.update(first.subarray(aad.length, -16)), native.final()]).equals(f.snapshot.bytes)).toBe(true);
});
it('rejects tampering in header, nonce, metadata, ciphertext or tag before consulting the fence', async () => {
  const f = await fixture(), fence = vi.fn(f.fence), before = await readdir(f.dir);
  const valid = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, f.fence);
  for (const offset of [0, 8, 9, 10, 12, 16, 28, 28 + valid.readUInt16BE(10), valid.length - 1]) {
    const bad = Buffer.from(valid); bad[offset] = bad[offset]! ^ 1;
    await expectRefused(decryptOfflineBackup(bad, f.key, f.dir, fence));
  }
  await expectRefused(decryptOfflineBackup(valid, randomBytes(32), f.dir, fence));
  expect(fence).not.toHaveBeenCalled(); expect(await readdir(f.dir)).toEqual(before);
});
it('rejects truncation and concatenation with a fixed nonsecret error', async () => {
  const f = await fixture(), valid = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, f.fence);
  for (const length of [0, 1, 27, 28, 28 + valid.readUInt16BE(10), valid.length - 16, valid.length - 1])
    await expectRefused(decryptOfflineBackup(valid.subarray(0, length), f.key, f.dir, f.fence));
  await expectRefused(decryptOfflineBackup(Buffer.concat([valid, valid]), f.key, f.dir, f.fence));
});
it('refuses a different external reference or any change between independent fence reads', async () => {
  const f = await fixture(), valid = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, f.fence), before = await readdir(f.dir);
  for (const field of ['serverId', 'epoch', 'generation', 'snapshotId', 'sha256'] as const) {
    const ref = { ...f.snapshot.reference, [field]: field === 'generation' ? 2 : field === 'sha256' ? '0'.repeat(64) : randomUUID() };
    await expectRefused(decryptOfflineBackup(valid, f.key, f.dir, async () => Buffer.from(JSON.stringify(ref))));
  }
  for (const operation of [encryptOfflineBackup, decryptOfflineBackup]) {
    let reads = 0;
    const moving = async () => ++reads === 1 ? f.reference : Buffer.from(f.reference.toString() + ' ');
    await expectRefused(operation(operation === encryptOfflineBackup ? f.snapshot.bytes : valid, f.key, f.dir, moving));
    expect(reads).toBe(2);
  }
  expect(await readdir(f.dir)).toEqual(before);
});
it('reuses archive validation even when malformed archives have matching synthetic references and valid GCM tags', async () => {
  const f = await fixture(), before = await readdir(f.dir);
  for (const mutation of ['mode', 'hash', 'traversal', 'duplicate', 'count', 'version', 'missing-key', 'missing-resources', 'oversize-file', 'prototype', 'deep']) {
    const archive = JSON.parse(f.snapshot.bytes.toString());
    const grants = archive.entries.find((e: { path: string }) => e.path === 'grants.json');
    if (mutation === 'mode') grants.mode = 0o644;
    if (mutation === 'hash') grants.sha256 = '0'.repeat(64);
    if (mutation === 'traversal') grants.path = '../grants.json';
    if (mutation === 'duplicate') archive.entries.push(grants);
    if (mutation === 'count') archive.entries = Array(2049).fill(grants);
    if (mutation === 'version') archive.version = 2;
    if (mutation === 'missing-key') archive.entries = archive.entries.filter((e: { path: string }) => e.path !== 'approvals/.integrity-key');
    if (mutation === 'missing-resources') archive.entries = archive.entries.filter((e: { path: string }) => e.path !== 'resources');
    if (mutation === 'oversize-file') grants.size = 16_000_001;
    if (mutation === 'prototype' || mutation === 'deep') {
      const bytes = Buffer.from(mutation === 'prototype' ? '{"__proto__":{}}' : '['.repeat(34) + '0' + ']'.repeat(34));
      grants.data = bytes.toString('base64'); grants.size = bytes.length; grants.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    const bytes = Buffer.from(JSON.stringify(archive));
    const reference = Buffer.from(JSON.stringify({ ...f.snapshot.reference, sha256: createHash('sha256').update(bytes).digest('hex') }));
    const fence = async () => reference;
    await expectRefused(encryptOfflineBackup(bytes, f.key, f.dir, fence));
    await expectRefused(decryptOfflineBackup(syntheticEnvelope(bytes, f.key, reference), f.key, f.dir, fence));
  }
  expect(await readdir(f.dir)).toEqual(before);
});
it('never logs private payloads, caller keys or native fence exceptions', async () => {
  const f = await fixture(), log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
  try {
    await expectRefused(encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, async () => { throw new Error('PRIVATE-FIXTURE ' + f.key.toString('hex')); }));
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  } finally { log.mockRestore(); warn.mockRestore(); error.mockRestore(); }
});
it('performs an isolated synthetic verification drill preserving real journals and permanent claims under repeated quarantine refusal', async () => {
  const f = await fixture(), before = await readdir(f.dir);
  const report = await runSyntheticRecoveryDrill(f.dir);
  expect(report).toMatchObject({
    version: 1, scope: 'synthetic-isolated-verification-only', integrity: 'verified', restore: 'blocked',
    extraction: 'not-implemented', runtimeStarted: false, sourceUnchanged: true, archiveBytesPreserved: true, archiveModesPreserved: true, encryptedFileRoundTrip: true,
    permanentClaims: 1, adapterCalls: 0, resumeCalls: 0, cleanup: 'verified',
    tamperRefused: true, wrongKeyRefused: true, staleFenceRefused: true,
    quarantine: { attempts: 2, bootstrapRefused: true, downstream: { loadSecrets: 0, operatorFromEnv: 0, createServer: 0, listen: 0 } },
  });
  expect(report.inventorySha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.files).toBeGreaterThanOrEqual(6); expect(report.entries).toBeGreaterThan(report.files);
  expect(await readdir(f.dir)).toEqual(before);
});
it('runs the synthetic-only CLI in a separate real process and refuses other commands without fixture writes', async () => {
  const f = await fixture(), before = await readdir(f.dir);
  const script = fileURLToPath(new URL('../../scripts/studio-recovery-drill.ts', import.meta.url));
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 15_000, maxBuffer: 65_536,
    env: f.env,
  });
  const child = run(['synthetic', f.dir]);
  expect(child.error).toBeUndefined(); expect(child.status).toBe(0); expect(child.stderr).toBe(''); expect(child.stdout).not.toBe('');
  expect(JSON.parse(child.stdout)).toMatchObject({ restore: 'blocked', runtimeStarted: false, cleanup: 'verified', permanentClaims: 1 });
  for (const args of [[], ['restore', f.dir], ['synthetic', f.dir, 'extra'], ['synthetic', f.dir + '/.']]) {
    const invalid = run(args); expect(invalid.status).toBe(1); expect(invalid.stdout).toBe('');
    expect(invalid.stderr).toBe('synthetic recovery drill refused\n');
  }
  expect(await readdir(f.dir)).toEqual(before);
});
it('accepts the exact archive and metadata ceilings without weakening inner archive validation', async () => {
  const f = await fixture();
  const bytes = Buffer.alloc(48_000_000, 32); f.snapshot.bytes.copy(bytes);
  const reference = Buffer.alloc(4096, 32);
  Buffer.from(JSON.stringify({ ...f.snapshot.reference, sha256: createHash('sha256').update(bytes).digest('hex') })).copy(reference);
  const fence = async () => reference;
  const encrypted = await encryptOfflineBackup(bytes, f.key, f.dir, fence);
  expect(encrypted.length).toBe(48_004_140);
  const opened = await decryptOfflineBackup(encrypted, f.key, f.dir, fence);
  expect(opened.bytes.equals(bytes)).toBe(true); expect(opened.report.restore).toBe('blocked');
  opened.bytes.fill(0); bytes.fill(0);
});
it('does not accept malformed reference schemas even under valid native encryption', async () => {
  const f = await fixture();
  for (const reference of [
    { ...f.snapshot.reference, version: 2 }, { ...f.snapshot.reference, generation: 0 },
    { ...f.snapshot.reference, unknown: true }, { ...f.snapshot.reference, sha256: 'G'.repeat(64) },
    { ...f.snapshot.reference, serverId: 'not-an-id' },
  ]) {
    const bytes = Buffer.from(JSON.stringify(reference)), fence = async () => bytes;
    await expectRefused(encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, fence));
    await expectRefused(decryptOfflineBackup(syntheticEnvelope(f.snapshot.bytes, f.key, bytes), f.key, f.dir, fence));
  }
});
it('leaves caller keys and archives unchanged and rejects shared-memory byte inputs', async () => {
  const f = await fixture(), key = Buffer.from(f.key), original = Buffer.from(f.snapshot.bytes), before = await readdir(f.dir);
  const encrypted = await encryptOfflineBackup(f.snapshot.bytes, f.key, f.dir, f.fence), cipherCopy = Buffer.from(encrypted);
  await decryptOfflineBackup(encrypted, f.key, f.dir, f.fence);
  await expectRefused(decryptOfflineBackup(encrypted, Buffer.alloc(31), f.dir, f.fence));
  await expectRefused(encryptOfflineBackup(Buffer.from(new SharedArrayBuffer(1)), f.key, f.dir, f.fence));
  await expectRefused(encryptOfflineBackup(f.snapshot.bytes, Buffer.from(new SharedArrayBuffer(32)), f.dir, f.fence));
  expect(f.key.equals(key)).toBe(true); expect(f.snapshot.bytes.equals(original)).toBe(true); expect(encrypted.equals(cipherCopy)).toBe(true);
  expect(await readdir(f.dir)).toEqual(before);
});
it('rejects corrupt HMACs and authentic but mismatched checkpoints inside correctly encrypted real approval archives', async () => {
  const f = await fixture();
  const graph = { ...createEmptyGraph(), nodes: [
    { id: 'start', type: 'manual' as const, label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'gate', type: 'approval' as const, label: 'Gate', position: { x: 1, y: 0 }, config: { reviewer: 'Fixture queue' } },
    { id: 'out', type: 'output' as const, label: 'Out', position: { x: 2, y: 0 }, config: {} },
  ], edges: [{ id: 'a', source: 'start', target: 'gate' }, { id: 'b', source: 'gate', target: 'out' }] };
  const store = createFileWorkflowWorkspaceStore(join(f.root, 'workspace.json'));
  const draft = await store.create('synthetic', graph, 'Fixture');
  const reserved = await store.reserveRun('synthetic', draft.id, 1, {}, 'Fixture');
  const runner = createWorkflowRunner(graph, {}, { initiator: 'Fixture' }), paused = await runner.run({});
  const run = await store.finishRun('synthetic', draft.id, reserved.id, paused, true);
  const approvals = new WorkflowApprovalStore(join(f.root, 'approvals'));
  const record = await approvals.create(run, runner.checkpoint(paused), 60_000); await approvals.claim(record.id);
  const snapshot = await createOfflineSnapshot(f.root, { serverId: randomUUID(), epoch: randomUUID(), generation: 1, quiescence: 'all-writers-stopped' });
  for (const mutation of ['mac', 'checkpoint']) {
    const archive = JSON.parse(snapshot.bytes.toString());
    const entry = archive.entries.find((e: { path: string }) => e.path === `approvals/${record.id}.json`);
    const journal = JSON.parse(Buffer.from(entry.data, 'base64').toString());
    if (mutation === 'mac') journal.mac = '0'.repeat(64);
    else {
      const payload = JSON.parse(journal.payload); payload.checkpoint.graphBinding += ' ';
      journal.payload = JSON.stringify(payload);
      const key = Buffer.from(archive.entries.find((e: { path: string }) => e.path === 'approvals/.integrity-key').data, 'base64');
      journal.mac = createHmac('sha256', key).update(journal.payload).digest('hex');
    }
    const journalBytes = Buffer.from(JSON.stringify(journal)); entry.data = journalBytes.toString('base64'); entry.size = journalBytes.length;
    entry.sha256 = createHash('sha256').update(journalBytes).digest('hex');
    const bytes = Buffer.from(JSON.stringify(archive)), reference = Buffer.from(JSON.stringify({ ...snapshot.reference, sha256: createHash('sha256').update(bytes).digest('hex') }));
    await expectRefused(encryptOfflineBackup(bytes, f.key, f.dir, async () => reference));
    await expectRefused(decryptOfflineBackup(syntheticEnvelope(bytes, f.key, reference), f.key, f.dir, async () => reference));
  }
});
function syntheticEnvelope(plaintext: Buffer, key: Buffer, reference: Buffer, mutate?: (header: Buffer) => void) {
  const header = Buffer.alloc(28); Buffer.from('FDSBENC\0').copy(header);
  header[8] = 1; header[9] = 1; header.writeUInt16BE(reference.length, 10); header.writeUInt32BE(plaintext.length, 12);
  randomBytes(12).copy(header, 16); mutate?.(header);
  const cipher = createCipheriv('aes-256-gcm', key, header.subarray(16), { authTagLength: 16 });
  cipher.setAAD(Buffer.concat([header, reference]));
  return Buffer.concat([header, reference, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}
it('rejects authenticated unsupported framing and trailing bytes rather than silently accepting extensions', async () => {
  const f = await fixture();
  for (const offset of [0, 8, 9]) {
    const malformed = syntheticEnvelope(f.snapshot.bytes, f.key, f.reference, h => { h[offset] = 2; });
    await expect(decryptOfflineBackup(malformed, f.key, f.dir, f.fence)).rejects.toThrow('encrypted offline backup refused');
  }
  const valid = syntheticEnvelope(f.snapshot.bytes, f.key, f.reference);
  const extended = Buffer.concat([valid.subarray(0, -16), Buffer.from('unparsed extension'), valid.subarray(-16)]);
  await expect(decryptOfflineBackup(extended, f.key, f.dir, f.fence)).rejects.toThrow('encrypted offline backup refused');
});
it('bounds byte buffers before allocating staging files or consulting the trusted fence', async () => {
  const f = await fixture(), fence = vi.fn(f.fence), before = await readdir(f.dir);
  await expect(encryptOfflineBackup(Buffer.alloc(48_000_001), f.key, f.dir, fence)).rejects.toThrow('encrypted offline backup refused');
  expect(fence).not.toHaveBeenCalled();
  const oversized = syntheticEnvelope(Buffer.alloc(48_000_001), f.key, f.reference);
  await expect(decryptOfflineBackup(oversized, f.key, f.dir, fence)).rejects.toThrow('encrypted offline backup refused');
  expect(fence).not.toHaveBeenCalled();
  const tooMuchMetadata = syntheticEnvelope(f.snapshot.bytes, f.key, Buffer.alloc(4097, 32));
  await expect(decryptOfflineBackup(tooMuchMetadata, f.key, f.dir, fence)).rejects.toThrow('encrypted offline backup refused');
  expect(fence).not.toHaveBeenCalled();
  expect(await readdir(f.dir)).toEqual(before);
});
