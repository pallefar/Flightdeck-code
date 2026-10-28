import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync, realpathSync } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { z } from 'zod';
import { configSchemas, graphSchema, jsonValue, type Graph, type Json } from '../packages/workflow/graph.js';
import type { RunResult } from '../packages/workflow/engine.js';
import { workflowFileLock } from './workflow-approval-lock.js';
import { canonicalWorkflowValue } from '../packages/workflow/checkpoint.js';

export const MAX_GRAPH_BYTES = 256_000;
export const MAX_INPUT_BYTES = 100_000;
export const MAX_FILE_BYTES = 16_000_000;
export const MAX_DRAFTS = 128;
export const MAX_RUNS = 256;
const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const actorSchema = z.string().trim().min(1).max(200);
const nodeIdSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);

/** Inspect iteratively BEFORE recursive schemas: depth, finite JSON, secret/prototype fields, UTF-8 byte bounds. */
export function safeWorkspaceValue(value: unknown, maxBytes: number, maxDepth = 24): boolean {
  try {
    const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
    let entries = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (item.depth > maxDepth || ++entries > 100_000) return false;
      const v = item.value;
      if (typeof v === 'string') { if (!jsonValue.safeParse(v).success) return false; }
      else if (v !== null && typeof v === 'object') {
        if (Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype) && Object.getPrototypeOf(v) !== null) return false;
        if (Object.getOwnPropertySymbols(v).length) return false;
        const descriptors = Object.getOwnPropertyDescriptors(v);
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (Array.isArray(v) && key === 'length') continue;
          if (!('value' in descriptor) || !descriptor.enumerable) return false;
          const child: unknown = descriptor.value;
          if (['__proto__', 'constructor', 'prototype'].includes(key) || /secret|password|token|api.?key|authorization|credential(?!Ref$)/i.test(key)) return false;
          pending.push({ value: child, depth: item.depth + 1 });
        }
      } else if (!(v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) return false;
    }
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes;
  } catch { return false; }
}
export const workspaceGraphSchema = z.unknown().refine(v => safeWorkspaceValue(v, MAX_GRAPH_BYTES), 'Unsafe or oversized graph').pipe(graphSchema);
export const workspaceInputSchema = z.unknown().refine(v => safeWorkspaceValue(v, MAX_INPUT_BYTES), 'Unsafe or oversized input').pipe(z.record(jsonValue).refine(v => Object.keys(v).length <= 100));
const outputSchema = z.unknown().refine(v => safeWorkspaceValue(v, MAX_INPUT_BYTES), 'Unsafe or oversized output').pipe(jsonValue);
export const projectIdSchema = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function graphDigest(graph: Graph): string { return createHash('sha256').update(canonicalJson(graph)).digest('hex'); }
const gateSchema = z.object({ id: nodeIdSchema, type: z.literal('approval'), config: configSchemas.approval }).strict();
const bindings = (graph: Graph) => graph.nodes.filter(n => n.type === 'approval').map(n => gateSchema.parse({ id: n.id, type: n.type, config: n.config }));
export const draftSchema = z.object({
  id: z.string().uuid(), projectId: projectIdSchema, revision: revisionSchema, graph: workspaceGraphSchema,
  status: z.literal('draft'), createdBy: actorSchema, updatedBy: actorSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), approvalBindings: z.array(gateSchema).max(100),
}).strict().superRefine((draft, ctx) => {
  if (canonicalJson(bindings(draft.graph)) !== canonicalJson(draft.approvalBindings) || draft.updatedAt < draft.createdAt) ctx.addIssue({ code: 'custom', message: 'Invalid draft bindings or timestamps' });
});
export type WorkflowDraft = z.infer<typeof draftSchema>;
// Durable traces deliberately exclude per-node input/output snapshots.
const traceMetadataSchema = z.unknown().refine(v => safeWorkspaceValue(v, 1000), 'Unsafe trace metadata').pipe(z.object({ durationMs: z.number().finite().min(0).max(86_400_000), selectedPort: z.enum(['true', 'false']).optional(), errorCode: z.enum(['STEP_LIMIT', 'MULTIPLE_ACTIVE_INPUTS', 'MAPPING_SOURCE_UNAVAILABLE', 'INPUT_INVALID', 'CONFIG_REQUIRED', 'ADAPTER_UNCONFIGURED', 'ADAPTER_ERROR', 'ADAPTER_TIMEOUT', 'DATA_INVALID', 'DATA_LIMIT', 'EXECUTION_REFUSED', 'AUTHORIZATION_REQUIRED', 'AUTHORIZATION_REFUSED', 'AUTHORIZATION_FAILED', 'PAUSE_CONSUMED']).optional() }).strict());
export const workflowRunResultSchema = z.object({
  status: z.enum(['completed', 'paused', 'blocked']), output: outputSchema,
  trace: z.array(z.object({ nodeId: nodeIdSchema, status: z.enum(['completed', 'skipped', 'paused', 'blocked']), message: z.string().max(200).optional(), humanName: actorSchema.optional(), details: traceMetadataSchema.optional() }).strict()).max(101),
  pendingNodeId: nodeIdSchema.optional(), reason: z.string().max(200).optional(),
}).strict();
export const runSchema = z.object({
  id: z.string().uuid(), draftId: z.string().uuid(), projectId: projectIdSchema,
  draftRevision: revisionSchema, graphSnapshot: workspaceGraphSchema, graphDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['running', 'completed', 'paused', 'blocked', 'interrupted']), result: workflowRunResultSchema.nullable(),
  initiatedBy: actorSchema, input: workspaceInputSchema,
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  resumable: z.boolean(), pauseDisposition: z.enum(['not-paused', 'unavailable-no-resume', 'review-pending']), executionEpoch: z.string().uuid(),
}).strict().superRefine((run, ctx) => {
  const unfinished = run.state === 'running' || run.state === 'interrupted';
  const nodeIds = new Set(run.graphSnapshot.nodes.map(n => n.id));
  for (const entry of run.result?.trace ?? []) {
    if (!entry.details) continue; // Version-one legacy traces may have no diagnostics.
    const node = run.graphSnapshot.nodes.find(n => n.id === entry.nodeId);
    const type = run.graphSnapshot.customBlocks.find(b => b.id === node?.type)?.baseType ?? node?.type;
    if (entry.status === 'skipped' ||
      (entry.details.selectedPort !== undefined && (type !== 'branch' || entry.status !== 'completed')) ||
      (entry.status === 'completed' && type === 'branch' && entry.details.selectedPort === undefined) ||
      (entry.details.errorCode !== undefined && entry.status !== 'blocked'))
      ctx.addIssue({ code: 'custom', message: 'Invalid trace metadata binding' });
  }
  if (graphDigest(run.graphSnapshot) !== run.graphDigest || (run.result !== null && run.result.status !== run.state) || unfinished !== (run.result === null) || unfinished !== (run.finishedAt === null) || (run.state === 'paused') !== (run.pauseDisposition !== 'not-paused') || run.resumable !== (run.pauseDisposition === 'review-pending') || (run.finishedAt !== null && run.finishedAt < run.startedAt) || run.result?.trace.some(t => !nodeIds.has(t.nodeId)) || (run.state === 'paused' && !run.graphSnapshot.nodes.some(n => n.id === run.result?.pendingNodeId && n.type === 'approval')) || (run.state !== 'paused' && run.result?.pendingNodeId !== undefined)) ctx.addIssue({ code: 'custom', message: 'Invalid run state' });
});
export type WorkflowRun = z.infer<typeof runSchema>;
const executionEpoch = randomUUID();
const fileSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]), drafts: z.array(draftSchema).max(MAX_DRAFTS), runs: z.array(runSchema).max(MAX_RUNS) }).strict().superRefine((data, ctx) => {
  if (data.version === 1 && data.runs.some(r => r.resumable || r.pauseDisposition === 'review-pending')) ctx.addIssue({ code: 'custom', message: 'Durable approval state requires version two' });
  const ids = new Set<string>(); const revisions = new Set<string>();
  for (const draft of data.drafts) { if (ids.has(draft.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate record' }); ids.add(draft.id); }
  for (const run of data.runs) {
    const draft = data.drafts.find(d => d.id === run.draftId && d.projectId === run.projectId);
    const key = `${run.draftId}:${run.draftRevision}`;
    if (ids.has(run.id) || revisions.has(key) || !draft || run.draftRevision > draft.revision || (run.draftRevision === draft.revision && graphDigest(draft.graph) !== run.graphDigest)) ctx.addIssue({ code: 'custom', message: 'Invalid run relationship' });
    ids.add(run.id); revisions.add(key);
  }
});
type FileData = z.infer<typeof fileSchema>;
export class WorkspaceError extends Error {
  constructor(public readonly statusCode: 404 | 409 | 413 | 503) { super('workspace operation refused'); }
}
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  queues.set(path, next);
  void next.finally(() => { if (queues.get(path) === next) queues.delete(path); }).catch(() => {});
  return next;
}
export interface WorkflowWorkspaceStore {
  reserveRun(projectId: string, draftId: string, revision: number, input: Record<string, Json>, actor: string): Promise<WorkflowRun>;
  finishRun(projectId: string, draftId: string, runId: string, result: RunResult, resumable?: boolean): Promise<WorkflowRun>;
  beginResume?(projectId: string, draftId: string, runId: string, expected: WorkflowRun): Promise<WorkflowRun>;
  listRuns(projectId: string, draftId: string): Promise<WorkflowRun[]>;
  getRun(projectId: string, draftId: string, runId: string): Promise<WorkflowRun | undefined>;
  update(projectId: string, draftId: string, graph: Graph, expectedRevision: number, actor: string): Promise<WorkflowDraft>;
  list(projectId: string): Promise<WorkflowDraft[]>;
  get(projectId: string, draftId: string): Promise<WorkflowDraft | undefined>;
  create(projectId: string, graph: Graph, actor: string): Promise<WorkflowDraft>;
}
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
/** Server configuration only: never accept browser paths. Writers share a fail-closed cross-process lock. */
export function createFileWorkflowWorkspaceStore(filePath: string, authority: {
  beforeCommit?: () => Promise<void>;
  /** Host-owned, already durably initialized anchor; never a browser path.
   * All observed entries below it require barriers, even when mkdir was not ours. */
  namespaceRoot?: Readonly<{path:string;dev:number;ino:number}>;
} = {}): WorkflowWorkspaceStore {
  if (!filePath || filePath.includes('\0') || filePath.split(/[\\/]/).includes('..')) throw new WorkspaceError(503);
  const path = resolve(filePath);
  const anchor=authority.namespaceRoot?Object.freeze({...authority.namespaceRoot}):undefined;
  if (anchor && (resolve(anchor.path)!==anchor.path || !path.startsWith(anchor.path+sep))) throw new WorkspaceError(503);
  const sameDirectory=(a:{dev:number;ino:number},b:{dev:number;ino:number})=>a.dev===b.dev&&a.ino===b.ino;
  async function syncParent(parent:string,expected:{dev:number;ino:number}):Promise<void> {
    const h=await open(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try {
      const opened=await h.stat();
      if (!opened.isDirectory() || !sameDirectory(opened,expected)) throw new WorkspaceError(503);
      await h.sync();
      const after=await lstat(parent);
      if (!after.isDirectory() || after.isSymbolicLink() || !sameDirectory(after,opened)) throw new WorkspaceError(503);
    } finally { await h.close(); }
  }
  async function ancestors(create = false): Promise<void> {
    const root = parse(path).root; let current = root;
    let previous:{dev:number;ino:number}|undefined;
    for (const component of dirname(path).slice(root.length).split(sep).filter(Boolean)) {
      const parent=current;current = join(current, component);
      let info, created=false;
      try { info = await lstat(current); }
      catch (error) {
        if (!isMissing(error)) throw error;
        if (!create) return;
        if (anchor && !current.startsWith(anchor.path+sep)) throw new WorkspaceError(503);
        try { await mkdir(current, { mode: 0o700 }); } catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
        created=true;
        info = await lstat(current);
      }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new WorkspaceError(503);
      if (anchor && current===anchor.path && !sameDirectory(info,anchor)) throw new WorkspaceError(503);
      // Existing may mean another creator has not synced yet. Never infer
      // durability from existence or from which process won mkdir/EEXIST.
      if (create && (created || anchor && (parent===anchor.path || parent.startsWith(anchor.path+sep)))) {
        await syncParent(parent,previous ?? await lstat(parent));
      }
      previous=info;
    }
  }
  async function target(): Promise<boolean> {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new WorkspaceError(503);
      if (info.size > MAX_FILE_BYTES) throw new WorkspaceError(413);
      return true;
    } catch (error) { if (isMissing(error)) return false; throw error; }
  }
  function validate(value: unknown): FileData {
    if (!safeWorkspaceValue(value, MAX_FILE_BYTES, 32)) throw new WorkspaceError(503);
    return fileSchema.parse(value);
  }
  async function read(): Promise<FileData> {
    await ancestors();
    if (!await target()) return { version: 1, drafts: [], runs: [] };
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.nlink !== 1) throw new WorkspaceError(503);
      if (before.size > MAX_FILE_BYTES) throw new WorkspaceError(413);
      const chunks: Buffer[] = []; let total = 0;
      while (true) {
        const buffer = Buffer.alloc(Math.min(65_536, MAX_FILE_BYTES + 1 - total));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead === 0) break;
        total += bytesRead; if (total > MAX_FILE_BYTES) throw new WorkspaceError(413);
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat();
      if (before.size !== total || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new WorkspaceError(503);
      return validate(JSON.parse(Buffer.concat(chunks, total).toString('utf8')));
    } finally { await handle.close(); }
  }
  async function write(data: FileData): Promise<void> {
    const parsed = validate({ ...data, version: data.runs.some(r => r.resumable) ? 2 : data.version }); const bytes = Buffer.from(JSON.stringify(parsed));
    if (bytes.length > MAX_FILE_BYTES) throw new WorkspaceError(413);
    await ancestors(true); await target();
    const temporary = join(dirname(path), `.workspace-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
      await ancestors(); await target();
      // The owning native request reauthorizes under the real file lock after
      // all temporary-file awaits, immediately before publication. This is not
      // an atomic transaction with the host's identity database.
      await authority.beforeCommit?.();
      // No additional await between the native effect decision and dispatch.
      // Detect trusted callback replacement of the anchor/path without allowing
      // a fresh authority epoch to be bypassed by another async filesystem phase.
      if (anchor) {
        const actual=lstatSync(anchor.path);
        if (!actual.isDirectory() || actual.isSymbolicLink() || !sameDirectory(actual,anchor)
          || realpathSync(dirname(path))!==dirname(path)) throw new WorkspaceError(503);
      }
      await rename(temporary, path);
      const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
      // No persistence acknowledgement without actual bounded readback of the exact new records.
      if (canonicalJson(await read()) !== canonicalJson(parsed)) throw new WorkspaceError(503);
    } finally { if (handle) await handle.close(); await unlink(temporary).catch(() => {}); }
  }
  function requireDraft(data: FileData, projectId: string, draftId: string): WorkflowDraft {
    const draft = data.drafts.find(d => d.projectId === projectId && d.id === draftId);
    if (!draft) throw new WorkspaceError(404); return draft;
  }
  async function mutation<T>(work: () => Promise<T>): Promise<T> {
    return serialized(path, async () => { await ancestors(true); return workflowFileLock(path + '.lock', work); });
  }
  const visible = (run: WorkflowRun): WorkflowRun => run.state === 'running' && run.executionEpoch !== executionEpoch ? { ...run, state: 'interrupted' } : run;
  return {
    async reserveRun(projectId, draftId, revision, input, actor) {
      return mutation(async () => {
        const data = await read(); const draft = requireDraft(data, projectId, draftId);
        if (draft.revision !== revision || data.runs.some(r => r.draftId === draftId && (r.draftRevision === revision || r.resumable || r.state === 'running' || r.state === 'interrupted'))) throw new WorkspaceError(409);
        if (data.runs.length >= MAX_RUNS) throw new WorkspaceError(413);
        const run = runSchema.parse({ id: randomUUID(), draftId, projectId, draftRevision: revision, graphSnapshot: draft.graph, graphDigest: graphDigest(draft.graph), state: 'running', result: null, initiatedBy: actor, input, startedAt: new Date().toISOString(), finishedAt: null, resumable: false, pauseDisposition: 'not-paused', executionEpoch });
        data.runs.push(run); await write(data); return run;
      });
    },
    async beginResume(projectId, draftId, runId, expected) {
      return mutation(async () => {
        const data = await read(); const run = data.runs.find(r => r.projectId === projectId && r.draftId === draftId && r.id === runId);
        if (!run || run.state !== 'paused' || !run.resumable || canonicalWorkflowValue(run) !== canonicalWorkflowValue(expected)) throw new WorkspaceError(409);
        const next = runSchema.parse({ ...run, state: 'running', result: null, finishedAt: null, resumable: false, pauseDisposition: 'not-paused', executionEpoch });
        data.runs[data.runs.indexOf(run)] = next; await write(data); return next;
      });
    },
    async finishRun(projectId, draftId, runId, result, resumable = false) {
      return mutation(async () => {
        const data = await read(); const run = data.runs.find(r => r.projectId === projectId && r.draftId === draftId && r.id === runId);
        if (!run) throw new WorkspaceError(404);
        if (run.state !== 'running' || run.executionEpoch !== executionEpoch) throw new WorkspaceError(409);
        const next = runSchema.parse({ ...run, state: result.status, result, finishedAt: new Date().toISOString(), resumable: result.status === 'paused' && resumable, pauseDisposition: result.status === 'paused' ? (resumable ? 'review-pending' : 'unavailable-no-resume') : 'not-paused' });
        data.runs[data.runs.indexOf(run)] = next; await write(data); return next;
      });
    },
    async listRuns(projectId, draftId) {
      const data = await read(); requireDraft(data, projectId, draftId);
      return data.runs.filter(r => r.projectId === projectId && r.draftId === draftId).map(visible);
    },
    async getRun(projectId, draftId, runId) {
      const run = (await read()).runs.find(r => r.projectId === projectId && r.draftId === draftId && r.id === runId);
      return run ? visible(run) : undefined;
    },
    async update(projectId, draftId, graph, expectedRevision, actor) {
      return mutation(async () => {
        const data = await read(); const draft = requireDraft(data, projectId, draftId);
        if (draft.revision !== expectedRevision) throw new WorkspaceError(409);
        const parsedGraph = workspaceGraphSchema.parse(graph);
        for (const gate of draft.approvalBindings) {
          const replacement = parsedGraph.nodes.find(n => n.id === gate.id);
          if (!replacement || replacement.type !== gate.type || canonicalJson(replacement.config) !== canonicalJson(gate.config)) throw new WorkspaceError(409);
        }
        const next = draftSchema.parse({ ...draft, graph: parsedGraph, approvalBindings: bindings(parsedGraph), revision: draft.revision + 1, updatedBy: actor, updatedAt: new Date().toISOString() });
        data.drafts[data.drafts.indexOf(draft)] = next; await write(data); return next;
      });
    },
    async list(projectId) { projectIdSchema.parse(projectId); return (await read()).drafts.filter(d => d.projectId === projectId); },
    async get(projectId, draftId) { projectIdSchema.parse(projectId); z.string().uuid().parse(draftId); return (await read()).drafts.find(d => d.projectId === projectId && d.id === draftId); },
    async create(projectId, graph, actor) {
      return mutation(async () => {
        const data = await read(); const now = new Date().toISOString();
        if (data.drafts.length >= MAX_DRAFTS) throw new WorkspaceError(413);
        const parsedGraph = workspaceGraphSchema.parse(graph);
        const draft = draftSchema.parse({ id: randomUUID(), projectId, revision: 1, graph: parsedGraph, approvalBindings: bindings(parsedGraph), status: 'draft', createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now });
        data.drafts.push(draft); await write(data); return draft;
      });
    },
  };
}
