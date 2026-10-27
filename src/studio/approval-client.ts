import { z } from 'zod';
import { configSchemas, jsonValue, resolveNode } from '../../packages/workflow/graph';
import { canonicalJson, projectIdSchema, runSchema, safeWorkspaceValue, workspaceGraphSchema, WorkspaceClient } from './workspace-client';

const uuid = z.string().uuid(), revision = z.number().int().positive().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const nodeId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/), actor = z.string().trim().min(1).max(200), timestamp = z.string().datetime();
const summaryFields = { id: uuid, revision, runId: uuid, projectId: projectIdSchema, draftId: uuid, draftRevision: revision, nodeId,
 state: z.enum(['pending', 'interrupted', 'consumed', 'rejected', 'expired']), contextDigest: hash, createdAt: timestamp, expiresAt: timestamp, decisionBy: actor.optional(), decidedAt: timestamp.optional() };
export const approvalSummarySchema = z.object(summaryFields).strict().refine(a => a.expiresAt > a.createdAt && (a.decisionBy === undefined) === (a.decidedAt === undefined));
const contextSchema = z.object({ runId: uuid, projectId: projectIdSchema, draftId: uuid, draftRevision: revision, graphDigest: hash, orderedGraphDigest: hash,
 initiator: actor, nodeId, gate: configSchemas.approval, pendingData: z.unknown().refine(v => safeWorkspaceValue(v, 100_000)).pipe(jsonValue), graphSnapshot: workspaceGraphSchema,
 resourceReferences: z.array(z.object({ nodeId, ...configSchemas.resource.shape }).strict()).max(100), createdAt: timestamp, expiresAt: timestamp }).strict();
const reviewSchema = z.object({ ...summaryFields, context: contextSchema }).strict();
export type ApprovalSummary = z.infer<typeof approvalSummarySchema>;
export type ApprovalReview = z.infer<typeof reviewSchema>;
export class ApprovalClientError extends Error {
 constructor(public readonly code: number | 'invalid' | 'unavailable' | 'readback', message: string) { super(message); }
}
const messages: Record<number, string> = {
 401: 'Independent reviewer sign-in required through the deployment’s authenticated identity provider.',
 403: 'Independent review refused. The initiator cannot review their own run; project and exact gate/queue permission are required.',
 409: 'Approval conflict or uncertain execution. Inspect the actual original run history; never retry a decision automatically.',
 503: 'Independent review runtime not configured or unavailable. No decision or execution is confirmed.',
};
export async function sha256(text: string) {
 if (!globalThis.crypto?.subtle) throw new ApprovalClientError('unavailable', 'Native Web Crypto unavailable; digest confirmation is blocked.');
 return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
/** JSON.stringify equals canonicalWorkflowValue for preflight-validated native JSON; never sort this binding. */
export async function validateApprovalReview(value: unknown, projectId: string, id: string): Promise<ApprovalReview> {
 if (!safeWorkspaceValue(value, 4_000_000, 24)) throw new ApprovalClientError('invalid', 'Unsafe review context. Refresh; decision blocked.');
 const parsed = reviewSchema.safeParse(value);
 if (!parsed.success || !approvalSummarySchema.safeParse(Object.fromEntries(Object.entries(parsed.data ?? {}).filter(([k]) => k !== 'context'))).success) throw new ApprovalClientError('invalid', 'Invalid review response. Decision blocked.');
 // Validate with schemas, but retain the exact wire object order for hashes and subsequent comparison.
 const a = value as ApprovalReview, c = a.context;
 const node = c.graphSnapshot.nodes.find(n => n.id === c.nodeId);
 const resolved = node && resolveNode(c.graphSnapshot, node);
 const refs = c.graphSnapshot.nodes.filter(n => resolveNode(c.graphSnapshot, n).type === 'resource').map(n => ({ nodeId: n.id, ...resolveNode(c.graphSnapshot, n).config }));
 if (a.id !== id || a.projectId !== projectId || ['runId', 'projectId', 'draftId', 'draftRevision', 'nodeId', 'createdAt', 'expiresAt'].some(k => (a as unknown as Record<string, unknown>)[k] !== (c as unknown as Record<string, unknown>)[k]) ||
  resolved?.type !== 'approval' || JSON.stringify(resolved.config) !== JSON.stringify(c.gate) || JSON.stringify(refs) !== JSON.stringify(c.resourceReferences) ||
  await sha256(JSON.stringify(c)) !== a.contextDigest || await sha256(JSON.stringify(c.graphSnapshot)) !== c.orderedGraphDigest || await sha256(canonicalJson(c.graphSnapshot)) !== c.graphDigest)
  throw new ApprovalClientError('invalid', 'Review identity, gate, resources or context digest mismatch. Decision blocked.');
 return a;
}
export class ApprovalClient {
 readonly workspace: WorkspaceClient;
 private readonly transport: typeof fetch;
 private readonly base: string;
 constructor(readonly projectId: string, private readonly token: string, transport: typeof fetch = (...args) => fetch(...args)) {
  if (!projectIdSchema.safeParse(projectId).success || !token || /[\r\n]/.test(token)) throw new ApprovalClientError('invalid', 'Choose a valid project and connect the existing operator/session credential in AI builder.');
  // Wrappers avoid native Fetch's receiver requirements for both clients.
  this.transport = (...args) => transport(...args); this.workspace = new WorkspaceClient(projectId, token, (...args) => transport(...args));
  this.base = `/api/studio/workspaces/${projectId}/approvals`;
 }
 private identity(id: string) { if (!uuid.safeParse(id).success) throw new ApprovalClientError('invalid', 'Invalid approval identity.'); return id; }
 private async request(suffix: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await this.transport(this.base + suffix, { method, credentials: 'same-origin', cache: 'no-store', headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) }); }
  catch { throw new ApprovalClientError('unavailable', 'Review connection lost. A claimed decision may already execute; inspect the actual original run history, never retry automatically.'); }
  // Error bodies are not evidence of success (expiry may return a persisted receipt with 409).
  if (!response.ok) throw new ApprovalClientError(response.status, messages[response.status] ?? 'Review request refused. Refresh and inspect actual history; no decision confirmed.');
  try {
   if (!response.headers.get('content-type')?.includes('application/json') || Number(response.headers.get('content-length')) > 4_000_000) throw new Error();
   const reader = response.body?.getReader(); if (!reader) throw new Error();
   let bytes = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
   try { while (true) { if (signal?.aborted) throw new Error(); const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 4_000_000) throw new Error(); text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); }
   catch (e) { await reader.cancel().catch(() => {}); throw e; } finally { reader.releaseLock(); }
   const value: unknown = JSON.parse(text); if (!safeWorkspaceValue(value, 4_000_000, 32)) throw new Error(); return value;
  } catch { throw new ApprovalClientError('invalid', 'Invalid bounded review response. Nothing confirmed; inspect actual history before any further action.'); }
 }
 async list(signal?: AbortSignal) {
  const result = z.object({ approvals: z.array(approvalSummarySchema).max(1024) }).strict().parse(await this.request('', 'GET', undefined, signal));
  if (result.approvals.some(a => a.projectId !== this.projectId) || new Set(result.approvals.map(a => a.id)).size !== result.approvals.length) throw new ApprovalClientError('invalid', 'Invalid approval list scope.');
  return result.approvals;
 }
 async review(id: string, signal?: AbortSignal) {
  const result = z.object({ approval: z.unknown() }).strict().parse(await this.request(`/${this.identity(id)}/review`, 'GET', undefined, signal));
  return validateApprovalReview(result.approval, this.projectId, id);
 }
 async decide(review: ApprovalReview, decision: 'approve' | 'reject', signal?: AbortSignal) {
  const a = await validateApprovalReview(review, this.projectId, review.id);
  if (a.state !== 'pending' || Date.parse(a.expiresAt) <= Date.now() || !['approve', 'reject'].includes(decision) || signal?.aborted) throw new ApprovalClientError('invalid', 'Fresh pending review required. Refresh and confirm its exact digest.');
  const result = z.object({ approval: approvalSummarySchema, run: runSchema }).strict().parse(await this.request(`/${this.identity(a.id)}/decisions`, 'POST', { approvalId: a.id, revision: a.revision, decision, contextDigest: a.contextDigest }, signal));
  if (!result.approval.decisionBy || !result.approval.decidedAt || result.approval.createdAt !== a.createdAt || result.approval.expiresAt !== a.expiresAt || Date.parse(result.approval.decidedAt) < Date.parse(a.createdAt) || result.approval.decisionBy.trim().toLowerCase() === a.context.initiator.trim().toLowerCase() || (decision === 'approve' && !result.run.result?.trace.some(t => t.nodeId === a.nodeId && t.status === 'completed' && t.humanName === result.approval.decisionBy)) || (decision === 'reject' && result.run.state !== 'blocked') || result.approval.id !== a.id || result.approval.projectId !== this.projectId || result.approval.runId !== a.runId || result.approval.draftId !== a.draftId || result.approval.draftRevision !== a.draftRevision || result.approval.nodeId !== a.nodeId || result.approval.contextDigest !== a.contextDigest || result.approval.revision !== a.revision + 1 || result.approval.state !== (decision === 'reject' ? 'rejected' : 'consumed') ||
   result.run.id !== a.runId || result.run.projectId !== a.projectId || result.run.draftId !== a.draftId || result.run.draftRevision !== a.draftRevision || result.run.graphDigest !== a.context.graphDigest || JSON.stringify(result.run.graphSnapshot) !== JSON.stringify(a.context.graphSnapshot) || result.run.initiatedBy !== a.context.initiator)
   throw new ApprovalClientError('invalid', 'Decision response identity mismatch. Inspect original history; never retry automatically.');
  return result;
 }
}
