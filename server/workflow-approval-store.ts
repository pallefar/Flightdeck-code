import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, parse, resolve, sep } from 'node:path';
import { z } from 'zod';
import { canonicalWorkflowValue, workflowCheckpointSchema, type WorkflowCheckpoint } from '../packages/workflow/checkpoint';
import { resolveNode } from '../packages/workflow/graph';
import { runSchema, safeWorkspaceValue, WorkspaceError, type WorkflowRun } from './workflow-workspace-store';
const MAX_BYTES = 4000000;
import { syncDirectory, workflowFileLock } from './workflow-approval-lock';
async function privateDirectory(path: string) {
    const root = parse(path).root;
    let current = root;
    for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
        current = join(current, part);
        try {
            await mkdir(current, { mode: 0o700 });
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
                throw e;
        }
        const st = await lstat(current);
        if (!st.isDirectory() || st.isSymbolicLink())
            throw new WorkspaceError(503);
    }
    const st = await lstat(path);
    if ((st.mode & 0o077) !== 0 || st.uid !== process.getuid?.())
        throw new WorkspaceError(503);
}
async function boundedRead(path: string, limit: number): Promise<Buffer> {
    const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await h.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > limit || (before.mode & 0o077) !== 0 || before.uid !== process.getuid?.())
            throw new WorkspaceError(503);
        const chunks: Buffer[] = [];
        let total = 0;
        while (true) {
            const b = Buffer.alloc(Math.min(65536, limit + 1 - total));
            const { bytesRead } = await h.read(b);
            if (!bytesRead)
                break;
            total += bytesRead;
            if (total > limit)
                throw new WorkspaceError(503);
            chunks.push(b.subarray(0, bytesRead));
        }
        const after = await h.stat();
        if (total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
            throw new WorkspaceError(503);
        return Buffer.concat(chunks, total);
    }
    finally {
        await h.close();
    }
}
export function approvalContext(run: WorkflowRun, c: WorkflowCheckpoint, createdAt: string, expiresAt: string) {
    const node = run.graphSnapshot.nodes.find(n => n.id === c.pending.nodeId);
    if (!node)
        throw new WorkspaceError(503);
    const resolved = resolveNode(run.graphSnapshot, node);
    if (resolved.type !== 'approval')
        throw new WorkspaceError(503);
    return { runId: run.id, projectId: run.projectId, draftId: run.draftId, draftRevision: run.draftRevision, graphDigest: run.graphDigest,
        orderedGraphDigest: createHash('sha256').update(c.graphBinding).digest('hex'), initiator: run.initiatedBy, nodeId: node.id,
        gate: resolved.config, pendingData: c.pending.data, graphSnapshot: run.graphSnapshot,
        resourceReferences: run.graphSnapshot.nodes.filter(n => resolveNode(run.graphSnapshot, n).type === 'resource').map(n => ({ nodeId: n.id, ...resolveNode(run.graphSnapshot, n).config })), createdAt, expiresAt };
}
const digest = (value: unknown) => createHash('sha256').update(canonicalWorkflowValue(value)).digest('hex');
const recordSchema = z.object({ version: z.literal(1), id: z.string().uuid(), revision: z.number().int().positive(), run: runSchema,
    checkpoint: workflowCheckpointSchema, context: z.unknown(), contextDigest: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
    state: z.enum(['pending', 'approved', 'rejected', 'consumed', 'expired']), decisionBy: z.string().max(200).optional(), decidedAt: z.string().datetime().optional() }).strict();
export type ApprovalRecord = z.infer<typeof recordSchema>;
export class WorkflowApprovalStore {
    readonly directory: string;
    constructor(directory: string) { if (!directory || directory.split(/[\\/]/).includes('..') || directory.includes('\0'))
        throw new WorkspaceError(503); this.directory = resolve(directory); }
    async initialize() {
        await privateDirectory(this.directory);
        await workflowFileLock(join(this.directory, '.key-lock'), async () => {
            const path = join(this.directory, '.integrity-key');
            try {
                const key = await boundedRead(path, 32);
                if (key.length !== 32)
                    throw new WorkspaceError(503);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
                const { readdir } = await import('node:fs/promises');
                if ((await readdir(this.directory)).some(n => n.endsWith('.json') || n.startsWith('.claim-')))
                    throw new WorkspaceError(503);
                const h = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
                try {
                    await h.writeFile(randomBytes(32));
                    await h.sync();
                }
                finally {
                    await h.close();
                }
                await syncDirectory(this.directory);
            }
        });
    }
    private path(id: string) { z.string().uuid().parse(id); return join(this.directory, id + '.json'); }
    private async key() { return boundedRead(join(this.directory, '.integrity-key'), 32); }
    private validate(value: unknown): ApprovalRecord {
        const r = recordSchema.parse(value);
        if (r.run.state !== 'paused' || r.run.result?.pendingNodeId !== r.checkpoint.pending.nodeId || r.run.initiatedBy !== r.checkpoint.options.initiator || r.checkpoint.graphBinding !== canonicalWorkflowValue(r.run.graphSnapshot) || digest(approvalContext(r.run, r.checkpoint, r.createdAt, r.expiresAt)) !== r.contextDigest || digest(r.context) !== r.contextDigest)
            throw new WorkspaceError(503);
        return r;
    }
    async read(id: string): Promise<ApprovalRecord> {
        await privateDirectory(this.directory);
        const bytes = await boundedRead(this.path(id), MAX_BYTES).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WorkspaceError(404);
            throw error;
        });
        try {
            const envelope = z.object({ payload: z.string().max(MAX_BYTES), mac: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(bytes.toString('utf8')));
            const expected = createHmac('sha256', await this.key()).update(envelope.payload).digest();
            if (!timingSafeEqual(expected, Buffer.from(envelope.mac, 'hex'))) throw new WorkspaceError(503);
            const record = this.validate(JSON.parse(envelope.payload));
            if (record.id !== id) throw new WorkspaceError(503);
            return record;
        } catch (error) {
            if (error instanceof WorkspaceError) throw error;
            throw new WorkspaceError(503); // private corruption is not a malformed client request
        }
    }
    async write(record: ApprovalRecord) {
        const payload = JSON.stringify(this.validate(record));
        const bytes = Buffer.from(JSON.stringify({ payload, mac: createHmac('sha256', await this.key()).update(payload).digest('hex') }));
        if (bytes.length > MAX_BYTES)
            throw new WorkspaceError(413);
        const temp = join(this.directory, '.' + randomUUID() + '.tmp');
        const h = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
            await h.writeFile(bytes);
            await h.sync();
        }
        finally {
            await h.close();
        }
        try {
            await rename(temp, this.path(record.id));
            await syncDirectory(this.directory);
            if (canonicalWorkflowValue(await this.read(record.id)) !== canonicalWorkflowValue(record))
                throw new WorkspaceError(503);
        }
        finally {
            await unlink(temp).catch(() => { });
        }
    }
    async create(run: WorkflowRun, checkpoint: WorkflowCheckpoint, ttlMs: number): Promise<ApprovalRecord> {
        await this.initialize();
        const c = workflowCheckpointSchema.parse(checkpoint);
        if (!safeWorkspaceValue(c.pending.data, 100000))
            throw new WorkspaceError(503);
        const createdAt = new Date().toISOString(), expiresAt = new Date(Date.now() + ttlMs).toISOString();
        const context = approvalContext(run, c, createdAt, expiresAt);
        const r: ApprovalRecord = { version: 1, id: randomUUID(), revision: 1, run, checkpoint: c, context, contextDigest: digest(context), createdAt, expiresAt, state: 'pending' };
        await this.write(r);
        return r;
    }
    async list(): Promise<ApprovalRecord[]> {
        await this.initialize();
        const { readdir } = await import('node:fs/promises');
        const names = (await readdir(this.directory)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
        if (names.length > 1000)
            throw new WorkspaceError(413);
        return Promise.all(names.map(n => this.read(n.slice(0, -5))));
    }
    async locked<T>(id: string, fn: () => Promise<T>): Promise<T> { await privateDirectory(this.directory); return workflowFileLock(this.path(id) + '.lock', fn); }
    private async claimPath(id: string) { const r = await this.read(id); return join(this.directory, '.claim-' + digest([r.run.id, r.checkpoint.pending.nodeId, r.contextDigest])); }
    async claimed(id: string) { try {
        const s = await lstat(await this.claimPath(id));
        if (!s.isDirectory() || s.isSymbolicLink())
            throw new WorkspaceError(503);
        return true;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return false;
        throw e;
    } }
    /** Permanent, fsynced run/gate/digest one-time claim, before ANY restored adapter execution. */
    async claim(id: string) { try {
        await mkdir(await this.claimPath(id), { mode: 0o700 });
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST')
            throw new WorkspaceError(409);
        throw e;
    } await syncDirectory(this.directory); }
}
