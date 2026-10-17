import { z } from 'zod';
import { graphSchema, configSchemas, jsonValue, type Graph } from '../../packages/workflow/graph';

// Browser-only public DTO contract. Never import the filesystem-backed server store here.
export const projectIdSchema = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const uuid = z.string().uuid();
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const actor = z.string().trim().min(1).max(200);
const nodeId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function safeWorkspaceValue(value: unknown, bytes: number, depth = 24): boolean {
  try {
    const pending = [{ value, depth: 0 }]; let count = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (item.depth > depth || ++count > 100_000) return false;
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
    return new TextEncoder().encode(JSON.stringify(value)).length <= bytes;
  } catch { return false; }
}
export const workspaceGraphSchema = z.unknown().refine(v => safeWorkspaceValue(v, 256_000)).pipe(graphSchema);
export const workspaceInputSchema = z.unknown().refine(v => safeWorkspaceValue(v, 100_000)).pipe(z.record(jsonValue).refine(v => Object.keys(v).length <= 100));
const gate = z.object({ id: nodeId, type: z.literal('approval'), config: configSchemas.approval }).strict();
const draftFields = {
  id: uuid, projectId: projectIdSchema, revision, status: z.literal('draft'), createdBy: actor, updatedBy: actor,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), approvalBindings: z.array(gate).max(100),
};
export const draftSchema = z.object({ ...draftFields, graph: workspaceGraphSchema }).strict().superRefine((d, ctx) => {
  const bindings = d.graph.nodes.filter(n => n.type === 'approval').map(n => ({ id: n.id, type: n.type, config: n.config }));
  if (canonicalJson(bindings) !== canonicalJson(d.approvalBindings) || d.updatedAt < d.createdAt) ctx.addIssue({ code: 'custom', message: 'Invalid draft' });
});
export const draftSummarySchema = z.object({ ...draftFields, name: z.string().min(1).max(120) }).strict().refine(d => d.updatedAt >= d.createdAt);
export type WorkspaceDraft = z.infer<typeof draftSchema>;
export type WorkspaceDraftSummary = z.infer<typeof draftSummarySchema>;
// Durable traces deliberately exclude per-node input/output snapshots.
const traceMetadataSchema = z.unknown().refine(v => safeWorkspaceValue(v, 1000), 'Unsafe trace metadata').pipe(z.object({ durationMs: z.number().finite().min(0).max(86_400_000), selectedPort: z.enum(['true', 'false']).optional(), errorCode: z.enum(['STEP_LIMIT', 'MULTIPLE_ACTIVE_INPUTS', 'MAPPING_SOURCE_UNAVAILABLE', 'INPUT_INVALID', 'CONFIG_REQUIRED', 'ADAPTER_UNCONFIGURED', 'ADAPTER_ERROR', 'ADAPTER_TIMEOUT', 'DATA_INVALID', 'DATA_LIMIT', 'EXECUTION_REFUSED', 'AUTHORIZATION_REQUIRED', 'AUTHORIZATION_REFUSED', 'AUTHORIZATION_FAILED', 'PAUSE_CONSUMED']).optional() }).strict());
export const workflowRunResultSchema = z.object({
  status: z.enum(['completed', 'paused', 'blocked']), output: z.unknown().refine(v => safeWorkspaceValue(v, 100_000)).pipe(jsonValue),
  trace: z.array(z.object({ nodeId, status: z.enum(['completed', 'skipped', 'paused', 'blocked']), message: z.string().max(200).optional(), humanName: actor.optional(), details: traceMetadataSchema.optional() }).strict()).max(101),
  pendingNodeId: nodeId.optional(), reason: z.string().max(200).optional(),
}).strict();
export const runSchema = z.object({
  id: uuid, draftId: uuid, projectId: projectIdSchema, draftRevision: revision, graphSnapshot: workspaceGraphSchema,
  graphDigest: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(['running', 'completed', 'paused', 'blocked', 'interrupted']),
  result: workflowRunResultSchema.nullable(), initiatedBy: actor, input: workspaceInputSchema,
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(), resumable: z.boolean(),
  pauseDisposition: z.enum(['not-paused', 'unavailable-no-resume', 'review-pending']), executionEpoch: uuid,
}).strict().superRefine((r, ctx) => {
  const unfinished = r.state === 'running' || r.state === 'interrupted';
  const ids = new Set(r.graphSnapshot.nodes.map(n => n.id));
  for (const entry of r.result?.trace ?? []) {
    const node = r.graphSnapshot.nodes.find(n => n.id === entry.nodeId);
    const type = r.graphSnapshot.customBlocks.find(b => b.id === node?.type)?.baseType ?? node?.type;
    if (entry.humanName !== undefined && (type !== 'approval' || entry.status !== 'completed')) ctx.addIssue({ code: 'custom', message: 'Invalid human review trace binding' });
    if (!entry.details) continue; // Version-one legacy traces may have no diagnostics.
    if (entry.status === 'skipped' ||
      (entry.details.selectedPort !== undefined && (type !== 'branch' || entry.status !== 'completed')) ||
      (entry.status === 'completed' && type === 'branch' && entry.details.selectedPort === undefined) ||
      (entry.details.errorCode !== undefined && entry.status !== 'blocked'))
      ctx.addIssue({ code: 'custom', message: 'Invalid trace metadata binding' });
  }
  if ((r.result !== null && r.result.status !== r.state) || unfinished !== (r.result === null) || unfinished !== (r.finishedAt === null) ||
    (r.state === 'paused') !== (r.pauseDisposition !== 'not-paused') || r.resumable !== (r.state === 'paused' && r.pauseDisposition === 'review-pending') || (r.finishedAt !== null && r.finishedAt < r.startedAt) ||
    r.result?.trace.some(t => !ids.has(t.nodeId)) || (r.state === 'paused' && !r.graphSnapshot.nodes.some(n => n.id === r.result?.pendingNodeId && n.type === 'approval')) ||
    (r.state !== 'paused' && r.result?.pendingNodeId !== undefined)) ctx.addIssue({ code: 'custom', message: 'Invalid run state' });
});
export type WorkspaceRun = z.infer<typeof runSchema>;
async function digest(graph: Graph) {
  const bytes = new TextEncoder().encode(canonicalJson(graph));
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
}
export class WorkspaceClientError extends Error {
  constructor(public readonly code: number | 'invalid' | 'unavailable' | 'readback', message: string) { super(message); }
}
const messages: Record<number, string> = {
  400: 'Workspace refused the graph or input. Check configuration and JSON bounds; never include secrets.',
  401: 'Operator credential refused. Connect operator credential in AI builder.',
  403: 'Workspace access refused. Check the operator connection.',
  404: 'Draft or run not found in this local project. Refresh saved drafts.',
  409: 'Revision, approval binding or execution conflict. Refresh and load the latest draft before editing. Saved approval ID/type/config cannot change. Each revision may run only once; never retry uncertain execution.',
  413: 'Workspace limit exceeded. Reduce graph/input size or ask the server operator to maintain storage.',
  503: 'Workspace unavailable. Check the server and storage; no save or execution is confirmed.',
};
export class WorkspaceClient {
  private readonly base: string;
  private readonly transport: typeof fetch;
  constructor(public readonly projectId: string, private readonly token: string, transport: typeof fetch = (...args) => fetch(...args)) {
    this.transport = (...args) => transport(...args);
    if (!projectIdSchema.safeParse(projectId).success || !token || /[\r\n]/.test(token)) throw new WorkspaceClientError('invalid', 'Use a valid local project slug and connect operator credential in AI builder.');
    this.base = `/api/studio/workspaces/${projectId}/workflows`;
  }
  private identity(id: string) { if (!uuid.safeParse(id).success) throw new WorkspaceClientError('invalid', 'Invalid workspace identity. Refresh saved drafts.'); return id; }
  private async request<T>(suffix: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try { response = await this.transport(this.base + suffix, { method, credentials: 'same-origin', cache: 'no-store', headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) }); }
    catch { throw new WorkspaceClientError('unavailable', 'Workspace connection unavailable. Check the server; writes may already have occurred. Refresh drafts/history before retrying.'); }
    if (!response.ok) throw new WorkspaceClientError(response.status, messages[response.status] ?? 'Workspace request refused. Check the server connection.');
    try {
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let total = 0; let text = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        if (Number(response.headers.get('content-length')) > 16_000_000) throw new Error();
        while (true) {
          if (signal?.aborted) throw new Error();
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > 16_000_000) throw new Error();
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } catch (e) { await reader.cancel().catch(() => {}); throw e; }
      finally { reader.releaseLock(); }
      const value: unknown = JSON.parse(text);
      if (!safeWorkspaceValue(value, 16_000_000, 32)) throw new Error();
      return schema.parse(value);
    } catch { throw new WorkspaceClientError('invalid', 'Invalid workspace response. Nothing confirmed; refresh drafts/history and check the server.'); }
  }
  async list(signal?: AbortSignal) {
    const { drafts } = await this.request('', z.object({ drafts: z.array(draftSummarySchema).max(128) }).strict(), 'GET', undefined, signal);
    if (drafts.some(d => d.projectId !== this.projectId) || new Set(drafts.map(d => d.id)).size !== drafts.length) throw new WorkspaceClientError('invalid', 'Invalid workspace draft scope.');
    return drafts;
  }
  private draft(draft: WorkspaceDraft, id?: string) {
    if (draft.projectId !== this.projectId || (id && draft.id !== id)) throw new WorkspaceClientError('invalid', 'Invalid workspace draft scope.'); return draft;
  }
  async create(graph: Graph, signal?: AbortSignal) {
    const parsed = workspaceGraphSchema.safeParse(graph);
    if (!parsed.success) throw new WorkspaceClientError('invalid', messages[400]!);
    return this.draft((await this.request('', z.object({ draft: draftSchema }).strict(), 'POST', { graph: parsed.data }, signal)).draft);
  }
  async get(id: string, signal?: AbortSignal) {
    return this.draft((await this.request(`/${this.identity(id)}`, z.object({ draft: draftSchema }).strict(), 'GET', undefined, signal)).draft, id);
  }
  async update(id: string, graph: Graph, expectedRevision: number, signal?: AbortSignal) {
    const parsed = workspaceGraphSchema.safeParse(graph);
    if (!parsed.success || !revision.safeParse(expectedRevision).success) throw new WorkspaceClientError('invalid', messages[400]!);
    return this.draft((await this.request(`/${this.identity(id)}`, z.object({ draft: draftSchema }).strict(), 'PUT', { graph: parsed.data, expectedRevision }, signal)).draft, id);
  }
  private async checkedRun(run: WorkspaceRun, draftId: string, id?: string) {
    if (run.projectId !== this.projectId || run.draftId !== draftId || (id && run.id !== id) || await digest(run.graphSnapshot) !== run.graphDigest) throw new WorkspaceClientError('invalid', 'Invalid workspace run scope or snapshot.');
    return run;
  }
  async run(id: string, savedRevision: number, input: unknown, signal?: AbortSignal) {
    const parsed = workspaceInputSchema.safeParse(input);
    if (!parsed.success || !revision.safeParse(savedRevision).success) throw new WorkspaceClientError('invalid', messages[400]!);
    const result = await this.request(`/${this.identity(id)}/runs`, z.object({ run: runSchema }).strict(), 'POST', { revision: savedRevision, input: parsed.data }, signal);
    if (result.run.draftRevision !== savedRevision || canonicalJson(result.run.input) !== canonicalJson(parsed.data)) throw new WorkspaceClientError('invalid', 'Invalid execution revision or input. Inspect history; do not retry.');
    return this.checkedRun(result.run, id);
  }
  async listRuns(id: string, signal?: AbortSignal) {
    const { runs } = await this.request(`/${this.identity(id)}/runs`, z.object({ runs: z.array(runSchema).max(256) }).strict(), 'GET', undefined, signal);
    if (new Set(runs.map(r => r.id)).size !== runs.length || new Set(runs.map(r => r.draftRevision)).size !== runs.length) throw new WorkspaceClientError('invalid', 'Invalid duplicate workspace history.');
    return Promise.all(runs.map(r => this.checkedRun(r, id)));
  }
  async getRun(id: string, runId: string, signal?: AbortSignal) {
    const result = await this.request(`/${this.identity(id)}/runs/${this.identity(runId)}`, z.object({ run: runSchema }).strict(), 'GET', undefined, signal);
    return this.checkedRun(result.run, id, runId);
  }
}
