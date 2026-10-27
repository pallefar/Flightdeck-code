import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { canonicalWorkflowValue, workflowCheckpointSchema } from '../packages/workflow/checkpoint';
import { approvalContext } from './workflow-approval-store';
import { draftSchema, runSchema } from './workflow-workspace-store';

// Offline only. Neither API starts a runtime, extracts state, acquires store locks,
// publishes a trusted monotonic catalog, nor authorizes resumption.
const MAX_FILE = 16_000_000, MAX_TOTAL = 32_000_000, MAX_ARCHIVE = 48_000_000, MAX_ENTRIES = 2048;
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const fail = (): never => { throw new Error('offline backup refused'); };
const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/);
const optionsSchema = z.object({ serverId: uuid, epoch: uuid, generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), quiescence: z.literal('all-writers-stopped') }).strict();
export type OfflineSnapshotOptions = z.infer<typeof optionsSchema>;
const referenceSchema = z.object({ version: z.literal(1), serverId: uuid, epoch: uuid, generation: optionsSchema.shape.generation, snapshotId: uuid, sha256: digest }).strict();
const entrySchema = z.object({ path: z.string().min(1).max(512), kind: z.enum(['file', 'directory']), mode: z.number().int(), size: z.number().int().nonnegative().max(MAX_FILE), sha256: digest.optional(), data: z.string().max(Math.ceil(MAX_FILE / 3) * 4).optional() }).strict();
const archiveSchema = optionsSchema.extend({ version: z.literal(1), snapshotId: uuid, entries: z.array(entrySchema).max(MAX_ENTRIES) }).strict();
type Entry = z.infer<typeof entrySchema>;
function plain(value: unknown): void {
  const todo: { v: unknown; depth: number }[] = [{ v: value, depth: 0 }]; let count = 0;
  while (todo.length) {
    const { v, depth } = todo.pop()!;
    if (++count > 100_000 || depth > 32) fail();
    if (v === null || typeof v === 'string' || typeof v === 'boolean') continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) fail(); continue; }
    if (typeof v !== 'object' || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== Array.prototype)) return fail();
    for (const k of Reflect.ownKeys(v)) {
      if (typeof k !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(k)) fail();
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (!('value' in d)) fail();
      todo.push({ v: d.value, depth: depth + 1 });
    }
  }
}
function json(bytes: Buffer): unknown { try { const value: unknown = JSON.parse(bytes.toString('utf8')); plain(value); return value; } catch { return fail(); } }
function safePath(path: string) {
  if (!isAbsolute(path) || path.includes('\0') || path.includes('\\') || path.split('/').some(p => p === '..' || p === '.')) fail();
  return resolve(path);
}
async function ancestors(path: string) {
  let current = parse(path).root;
  for (const p of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, p); const s = await lstat(current);
    if (s.isSymbolicLink()) fail();
  }
}
async function bounded(path: string, limit: number): Promise<Buffer> {
  safePath(path); await ancestors(path);
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const s = await h.stat();
    if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o7777) !== 0o600 || s.uid !== process.getuid?.() || s.size > limit) fail();
    const chunks: Buffer[] = []; let total = 0;
    while (true) {
      const b = Buffer.alloc(Math.min(65536, limit + 1 - total)); const { bytesRead } = await h.read(b);
      if (!bytesRead) break;
      total += bytesRead; if (total > limit) fail(); chunks.push(b.subarray(0, bytesRead));
    }
    const after = await h.stat(), named = await lstat(path);
    if (total !== s.size || after.size !== s.size || after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs || named.ino !== s.ino || named.dev !== s.dev || named.isSymbolicLink()) fail();
    return Buffer.concat(chunks, total);
  } finally { await h.close(); }
}
function relativePath(p: string) {
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p) || p.split('/').length > 16 || p.split('/').some(n => n === '.' || n === '..' || n === 'lock' || n.endsWith('.lock') || n.endsWith('-lock') || n.endsWith('.tmp') || n.endsWith('.head'))) fail();
}
async function collect(root: string): Promise<Entry[]> {
  safePath(root); await ancestors(root);
  const entries: Entry[] = []; let total = 0;
  async function walk(path: string, relative: string) {
    if (relative) relativePath(relative);
    const s = await lstat(path);
    if (s.isSymbolicLink() || s.uid !== process.getuid?.()) fail();
    if (s.isDirectory()) {
      if ((s.mode & 0o7777) !== 0o700) fail();
      if (relative) entries.push({ path: relative, kind: 'directory', mode: 0o700, size: 0 });
      const names = (await readdir(path)).sort(); if (names.length + entries.length > MAX_ENTRIES) fail();
      for (const name of names) await walk(join(path, name), relative ? relative + '/' + name : name);
    } else {
      const b = await bounded(path, MAX_FILE); total += b.length; if (total > MAX_TOTAL) fail();
      entries.push({ path: relative, kind: 'file', mode: 0o600, size: b.length, sha256: hash(b), data: b.toString('base64') });
    }
    if (entries.length > MAX_ENTRIES) fail();
  }
  await walk(root, ''); return entries;
}
function validateEntries(entries: Entry[]) {
  const seen = new Map<string, Entry>(), files = new Map<string, Buffer>(); let total = 0;
  for (const e of entries) {
    relativePath(e.path); if (seen.has(e.path)) fail(); seen.set(e.path, e);
    if (e.kind === 'directory') { if (e.mode !== 0o700 || e.size !== 0 || e.data !== undefined || e.sha256 !== undefined) fail(); }
    else {
      if (e.mode !== 0o600 || e.data === undefined || e.sha256 === undefined) return fail();
      const b = Buffer.from(e.data, 'base64'); total += b.length;
      if (b.toString('base64') !== e.data || b.length !== e.size || hash(b) !== e.sha256 || total > MAX_TOTAL) fail();
      files.set(e.path, b);
    }
  }
  for (const p of seen.keys()) {
    const parts = p.split('/'); parts.pop();
    if (parts.length && seen.get(parts.join('/'))?.kind !== 'directory') fail();
    if (!(p === 'workspace.json' || p === 'grants.json' || p === 'approvals' || p.startsWith('approvals/') || p === 'resources' || p.startsWith('resources/'))) fail();
  }
  if (seen.get('approvals')?.kind !== 'directory' || seen.get('resources')?.kind !== 'directory') fail();
  const key = files.get('approvals/.integrity-key'); if (!key || key.length !== 32) return fail();
  const workspace = z.object({ version: z.union([z.literal(1), z.literal(2)]), drafts: z.array(draftSchema).max(128), runs: z.array(runSchema).max(256) }).strict().parse(json(files.get('workspace.json') ?? fail()));
  json(files.get('grants.json') ?? fail());
  const pendingRuns = new Set<string>(), journalClaims = new Set<string>();
  for (const [p, b] of files) if (p.startsWith('approvals/') && p.endsWith('.json')) {
    const envelope = z.object({ payload: z.string().max(4_000_000), mac: digest }).strict().parse(json(b));
    const expected = createHmac('sha256', key).update(envelope.payload).digest();
    if (!timingSafeEqual(expected, Buffer.from(envelope.mac, 'hex'))) fail();
    const r = z.object({ version: z.literal(1), id: uuid, revision: z.number().int().positive(), run: runSchema,
      checkpoint: workflowCheckpointSchema, context: z.unknown(), contextDigest: digest, createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
      state: z.enum(['pending', 'approved', 'rejected', 'consumed', 'expired']), decisionBy: z.string().max(200).optional(), decidedAt: z.string().datetime().optional() }).strict().parse(json(Buffer.from(envelope.payload)));
    const run = r.run, checkpoint = r.checkpoint;
    if (run.state !== 'paused' || run.result?.pendingNodeId !== checkpoint.pending.nodeId || run.initiatedBy !== checkpoint.options.initiator || checkpoint.graphBinding !== canonicalWorkflowValue(run.graphSnapshot) || hash(canonicalWorkflowValue(approvalContext(run, checkpoint, r.createdAt, r.expiresAt))) !== r.contextDigest || hash(canonicalWorkflowValue(r.context)) !== r.contextDigest) fail();
    if (r.state === 'pending') pendingRuns.add(run.id);
    const current = workspace.runs.find(w => w.id === run.id && w.draftId === run.draftId && JSON.stringify(w.graphSnapshot) === JSON.stringify(run.graphSnapshot));
    if (p !== `approvals/${r.id}.json` || !current) return fail();
    if (r.state === 'pending' && (current.state !== 'paused' || canonicalWorkflowValue(current) !== canonicalWorkflowValue(run))) fail();
    const claim = 'approvals/.claim-' + hash(canonicalWorkflowValue([run.id, checkpoint.pending.nodeId, r.contextDigest]));
    journalClaims.add(claim);
    if (r.state === 'consumed' && seen.get(claim)?.kind !== 'directory') fail();
  }
  for (const p of seen.keys()) if (p.startsWith('approvals/.claim-') && !journalClaims.has(p)) fail();
  for (const run of workspace.runs) if (run.pauseDisposition === 'review-pending' && !pendingRuns.has(run.id)) fail();
  return files.size;
}
export async function createOfflineSnapshot(root: string, options: OfflineSnapshotOptions) {
  try { return await createSnapshot(root, options); } catch { return fail(); }
}
async function createSnapshot(root: string, options: OfflineSnapshotOptions) {
  plain(options); const trusted = optionsSchema.parse(options);
  const entries = await collect(root); validateEntries(entries);
  // A stability check detects some races. It DOES NOT prove writer quiescence.
  if (JSON.stringify(entries) !== JSON.stringify(await collect(root))) fail();
  const snapshotId = randomUUID();
  const bytes = Buffer.from(JSON.stringify({ version: 1, ...trusted, snapshotId, entries }));
  if (bytes.length > MAX_ARCHIVE) fail();
  return { bytes, reference: { version: 1 as const, serverId: trusted.serverId, epoch: trusted.epoch, generation: trusted.generation, snapshotId, sha256: hash(bytes) } };
}
export async function verifyOfflineSnapshot(archivePath: string, trustedCatalogPath: string) {
  try {
    if (safePath(archivePath) === safePath(trustedCatalogPath)) fail();
    return await verifyOfflineSnapshotAgainstFence(archivePath, () => bounded(trustedCatalogPath, 4096));
  } catch { return fail(); }
}
/** Trusted server/operator adapter ONLY. Reads must be bounded and externally authoritative.
 * Never pass archive-supplied references or an in-memory rollbackable catalog as authority. */
export async function verifyOfflineSnapshotAgainstFence(archivePath: string, readTrustedFence: () => Promise<Buffer>) {
  try { return await verifyAgainstFence(archivePath, readTrustedFence); } catch { return fail(); }
}
async function verifyAgainstFence(archivePath: string, readTrustedFence: () => Promise<Buffer>) {
  const before = Buffer.from(await readTrustedFence());
  if (before.length > 4096) fail();
  const ref = referenceSchema.parse(json(before));
  const bytes = await bounded(archivePath, MAX_ARCHIVE);
  if (hash(bytes) !== ref.sha256) fail();
  const archive = archiveSchema.parse(json(bytes));
  if (archive.serverId !== ref.serverId || archive.epoch !== ref.epoch || archive.generation !== ref.generation || archive.snapshotId !== ref.snapshotId) fail();
  const files = validateEntries(archive.entries);
  if (!before.equals(await readTrustedFence())) fail();
  return { integrity: 'verified' as const, restore: 'blocked' as const, generation: archive.generation, files, entries: archive.entries.length };
}
