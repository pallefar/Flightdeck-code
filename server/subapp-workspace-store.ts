import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, sep } from 'node:path';
import { z } from 'zod';
import {
  actorSchema, boundedSubappSchema, documentSchema, draftIdSchema, MAX_SUBAPP_DOCUMENTS,
  MAX_SUBAPP_STORE_BYTES, projectIdSchema, revisionSchema, snapshotSchema, summarySchema,
  type SubappDocument, type SubappSnapshot, type SubappSummary,
} from '../packages/subapp-workspace/schema';
import { syncDirectory, workflowFileLock } from './workflow-approval-lock';
import { WorkspaceError } from './workflow-workspace-store';

export class SubappWorkspaceError extends Error {
  constructor(public readonly statusCode: 400 | 404 | 409 | 413 | 503) { super('sub-app workspace operation refused'); }
}
export interface SubappWorkspaceStore {
  update(projectId: string, id: string, snapshot: unknown, expectedRevision: number, actor: string): Promise<SubappDocument>;
  create(projectId: string, snapshot: unknown, actor: string): Promise<SubappDocument>;
  list(projectId: string): Promise<SubappSummary[]>;
  get(projectId: string, id: string): Promise<SubappDocument | undefined>;
}
/** Ordered DTO JSON, not sorted-key JSON. This is integrity metadata, not authorization. */
export function subappContentHash(snapshot: SubappSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}
const fileSchema = boundedSubappSchema(z.object({
  version: z.literal(1), drafts: z.array(documentSchema).max(MAX_SUBAPP_DOCUMENTS),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.drafts.map(d => d.id)).size !== data.drafts.length || data.drafts.some(d => subappContentHash(d.snapshot) !== d.contentHash)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid sub-app records' });
  }
}), MAX_SUBAPP_STORE_BYTES);
type FileData = z.infer<typeof fileSchema>;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const fail = (): never => { throw new SubappWorkspaceError(503); };
function admitted<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new SubappWorkspaceError(400);
  return result.data;
}
function privateMetadata(info: Stats, directory = false): void {
  if ((directory ? !info.isDirectory() : !info.isFile()) || info.isSymbolicLink() ||
      info.uid !== process.getuid?.() || (info.mode & 0o7777) !== (directory ? 0o700 : 0o600) || (!directory && info.nlink !== 1)) fail();
}
function stable(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink;
}
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof SubappWorkspaceError) throw error;
    if (error instanceof WorkspaceError && error.statusCode === 409) throw new SubappWorkspaceError(409);
    return fail();
  }
}

/** Trusted startup path only. Constructor validates syntax without reading or writing.
 * Ancestors must remain trusted/immutable against same-user replacement during operations.
 */
export function createFileSubappWorkspaceStore(path: string): SubappWorkspaceStore {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path.includes('\\') ||
      path.endsWith('/') || path.split('/').slice(1).some(p => !p || p === '.' || p === '..')) fail();
  const parent = dirname(path);
  async function ancestors(create = false): Promise<boolean> {
    const root = parse(path).root; let current = root;
    for (const component of parent.slice(root.length).split(sep).filter(Boolean)) {
      current = join(current, component);
      let info: Stats;
      try { info = await lstat(current); }
      catch (error) {
        if (!missing(error)) throw error;
        if (!create) return false;
        try { await mkdir(current, { mode: 0o700 }); }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }
        info = await lstat(current);
        privateMetadata(info, true);
      }
      if (!info.isDirectory() || info.isSymbolicLink()) fail();
      if (current === parent) privateMetadata(info, true);
      // Seeing a directory (including EEXIST) does not prove its creator completed
      // the containing-directory barrier. Every ancestor this module creates is
      // owner-private; each writer must finish that barrier independently, also
      // after another process's interruption or an earlier fsync failure. The
      // pre-existing nonprivate ancestors remain trusted startup infrastructure.
      if (create && info.uid === process.getuid?.() && (info.mode & 0o7777) === 0o700)
        await syncDirectory(dirname(current));
    }
    if (parent === root) fail();
    return true;
  }
  async function target(): Promise<Stats | undefined> {
    try {
      const info = await lstat(path); privateMetadata(info);
      if (info.size > MAX_SUBAPP_STORE_BYTES) throw new SubappWorkspaceError(413);
      return info;
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }
  function validate(value: unknown): FileData {
    const result = fileSchema.safeParse(value); if (!result.success) return fail(); return result.data;
  }
  async function read(expectedBytes?: Buffer): Promise<FileData> {
    if (!await ancestors()) { if (expectedBytes) fail(); return { version: 1, drafts: [] }; }
    const initial = await target(); if (!initial) { if (expectedBytes) fail(); return { version: 1, drafts: [] }; }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat(); privateMetadata(before);
      if (!stable(initial, before)) fail();
      const chunks: Buffer[] = []; let total = 0;
      while (true) {
        const buffer = Buffer.alloc(Math.min(65_536, MAX_SUBAPP_STORE_BYTES + 1 - total));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        total += bytesRead; if (total > MAX_SUBAPP_STORE_BYTES) throw new SubappWorkspaceError(413);
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat(); const current = await target();
      if (!current || total !== before.size || !stable(before, after) || !stable(after, current)) fail();
      const bytes = Buffer.concat(chunks, total);
      if (expectedBytes && !bytes.equals(expectedBytes)) fail();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return validate(JSON.parse(text));
    } finally { await handle.close(); }
  }
  async function write(data: FileData): Promise<void> {
    // Internal data is already admitted; classify capacity separately from corrupt on-disk state.
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_SUBAPP_STORE_BYTES) throw new SubappWorkspaceError(413);
    const parsed = validate(data); const bytes = Buffer.from(JSON.stringify(parsed), 'utf8');
    if (bytes.length > MAX_SUBAPP_STORE_BYTES) throw new SubappWorkspaceError(413);
    await ancestors(true); await target();
    const temporary = join(parent, `.subapp-workspace-${randomUUID()}.tmp`);
    let handle; let created = false;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true;
      privateMetadata(await handle.stat());
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
      await ancestors(); await target(); await rename(temporary, path); await syncDirectory(parent);
      // Never acknowledge a mutation until the exact committed private bytes have been read back.
      await read(bytes);
    } finally {
      try { if (handle) await handle.close(); }
      finally {
        if (created) { try { await unlink(temporary); } catch (error) { if (!missing(error)) throw error; } }
      }
    }
  }
  async function mutation<T>(work: () => Promise<T>): Promise<T> {
    return guarded(async () => { await ancestors(true); return workflowFileLock(path + '.lock', work); });
  }
  return {
    async update(projectId, id, snapshot, expectedRevision, actor) {
      const project = admitted(projectIdSchema, projectId); const draftId = admitted(draftIdSchema, id);
      const source = admitted(snapshotSchema, snapshot); const revision = admitted(revisionSchema, expectedRevision); const author = admitted(actorSchema, actor);
      return mutation(async () => {
        const data = await read(); const index = data.drafts.findIndex(d => d.projectId === project && d.id === draftId);
        const current = data.drafts[index]; if (!current) throw new SubappWorkspaceError(404);
        if (current.revision !== revision || revision === Number.MAX_SAFE_INTEGER || JSON.stringify(current.snapshot.baseline) !== JSON.stringify(source.baseline)) throw new SubappWorkspaceError(409);
        const next = documentSchema.parse({ ...current, snapshot: source, revision: revision + 1, updatedBy: author,
          updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString(), contentHash: subappContentHash(source) });
        data.drafts[index] = next; await write(data); return next;
      });
    },
    async create(projectId, snapshot, actor) {
      const project = admitted(projectIdSchema, projectId); const source = admitted(snapshotSchema, snapshot); const author = admitted(actorSchema, actor);
      return mutation(async () => {
        const data = await read(); if (data.drafts.length >= MAX_SUBAPP_DOCUMENTS) throw new SubappWorkspaceError(413);
        const now = new Date().toISOString();
        const draft = documentSchema.parse({ id: randomUUID(), projectId: project, revision: 1, status: 'draft', snapshot: source,
          contentHash: subappContentHash(source), createdBy: author, updatedBy: author, createdAt: now, updatedAt: now });
        data.drafts.push(draft); await write(data); return draft;
      });
    },
    async get(projectId, id) {
      const project = admitted(projectIdSchema, projectId); const draftId = admitted(draftIdSchema, id);
      return guarded(async () => (await read()).drafts.find(d => d.projectId === project && d.id === draftId));
    },
    async list(projectId) {
      const project = admitted(projectIdSchema, projectId);
      return guarded(async () => (await read()).drafts.filter(d => d.projectId === project).map(({ snapshot, ...metadata }) => summarySchema.parse({
        ...metadata, label: snapshot.baseline.manifest.label, subappId: snapshot.baseline.manifest.id, fileCount: snapshot.files.length,
      })));
    },
  };
}
