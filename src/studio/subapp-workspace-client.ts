import { z } from 'zod';
import {
  documentSchema, draftIdSchema, MAX_SUBAPP_DOCUMENTS, MAX_SUBAPP_SNAPSHOT_BYTES,
  projectIdSchema, revisionSchema, safeSubappValue, snapshotSchema, summarySchema,
  type SubappDocument, type SubappSnapshot,
} from '../../packages/subapp-workspace/schema';
export type { SubappDocument, SubappSnapshot, SubappSummary } from '../../packages/subapp-workspace/schema';

export class SubappWorkspaceClientError extends Error {
  constructor(public readonly code: number | 'invalid' | 'unavailable' | 'readback', message: string) { super(message); }
}
const invalid = () => new SubappWorkspaceClientError('invalid', 'Invalid saved sub-app response. No save confirmed; explicitly refresh saved drafts.');
export function checkSubappContext(signal?: AbortSignal, current: () => boolean = () => true): void {
  if (signal?.aborted || !current()) throw new DOMException('Sub-app request cancelled.', 'AbortError');
}
export async function subappSnapshotHash(snapshot: SubappSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
const messages: Record<number, string> = {
  400: 'Sub-app source was refused. Check the snapshot bounds and artifact inventory.',
  401: 'Connect a valid operator credential in AI builder.',
  403: 'Sub-app workspace access refused.',
  404: 'Saved draft not found in this local project. Refresh saved drafts.',
  409: 'Saved revision or generated baseline conflict. Your editor is unchanged. Refresh saved drafts; reopen only after reviewing replacement.',
  413: 'Sub-app workspace limit exceeded. Reduce source size or contact the server operator.',
  503: 'Sub-app workspace unavailable. No save confirmed; refresh saved drafts before retrying.',
};
const MAX_RESPONSE_BYTES = MAX_SUBAPP_SNAPSHOT_BYTES + 16_000;
export async function waitForSubappContext<T>(pending: Promise<T>, signal?: AbortSignal, current?: () => boolean): Promise<T> {
  checkSubappContext(signal, current);
  let cancel: (() => void) | undefined;
  try {
    const value = signal ? await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new DOMException('Sub-app request cancelled.', 'AbortError'));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    })]) : await pending;
    checkSubappContext(signal, current);
    return value;
  } finally { if (signal && cancel) signal.removeEventListener('abort', cancel); }
}
function cancelBody(response: Response) { try { void response.body?.cancel().catch(() => {}); } catch { /* Untrusted cancellation must not block. */ } }
async function readBounded(response: Response, signal?: AbortSignal, current?: () => boolean): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    checkSubappContext(signal, current);
    if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw invalid();
    reader = response.body?.getReader(); if (!reader) throw invalid();
    const decoder = new TextDecoder('utf-8', { fatal: true }); let total = 0; let text = '';
    while (true) {
      checkSubappContext(signal, current);
      const chunk = await waitForSubappContext(reader.read(), signal, current);
      if (chunk.done) break;
      total += chunk.value.byteLength; if (total > MAX_RESPONSE_BYTES) throw invalid();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode(); checkSubappContext(signal, current);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (reader) { try { void reader.cancel().catch(() => {}); } catch { /* no wait */ } } else cancelBody(response);
    throw error;
  } finally { try { reader?.releaseLock(); } catch { /* pending cancellation is intentionally not awaited */ } }
}
export class SubappWorkspaceClient {
  private readonly base: string;
  private readonly transport: typeof fetch;
  constructor(public readonly projectId: string, private readonly token: string, transport: typeof fetch = (...args) => globalThis.fetch(...args)) {
    if (!projectIdSchema.safeParse(projectId).success || !token || token.length > 8_192 || /[\u0000-\u0020\u007f]/.test(token))
      throw new SubappWorkspaceClientError('invalid', 'Choose a valid local project and connect an operator credential.');
    this.base = `/api/studio/workspaces/${projectId}/subapps`;
    // Native Fetch must not receive this client as its receiver.
    this.transport = async (...args) => transport(...args);
  }
  private identity(id: string): string {
    if (!draftIdSchema.safeParse(id).success) throw invalid();
    return id;
  }
  private async request<T>(suffix: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, method: string, body: unknown, signal?: AbortSignal, current?: () => boolean): Promise<T> {
    checkSubappContext(signal, current);
    const pending = this.transport(this.base + suffix, { method, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
    // Even a transport which ignores abort cannot start stale body parsing.
    void pending.then(response => { if (signal?.aborted || (current && !current())) cancelBody(response); }, () => {});
    let response: Response;
    try { response = await waitForSubappContext(pending, signal, current); }
    catch { checkSubappContext(signal, current); throw new SubappWorkspaceClientError('unavailable', 'Sub-app connection unavailable. A write may already have occurred; refresh saved drafts before retrying.'); }
    checkSubappContext(signal, current);
    if (response.status !== (method === 'POST' ? 201 : 200)) { cancelBody(response); throw new SubappWorkspaceClientError(response.status, messages[response.status] ?? 'Sub-app request refused; no save confirmed.'); }
    try {
      const value = await readBounded(response, signal, current);
      if (!safeSubappValue(value, MAX_RESPONSE_BYTES, 24) || !schema.safeParse(value).success) throw invalid();
      checkSubappContext(signal, current);
      // Preserve admitted wire snapshot key order: the digest binds exact JSON, not sorted/parsed keys.
      return value as T;
    } catch (error) { checkSubappContext(signal, current); if (error instanceof SubappWorkspaceClientError) throw error; throw invalid(); }
  }
  private async checked(draft: SubappDocument, id: string | undefined, signal?: AbortSignal, current?: () => boolean) {
    checkSubappContext(signal, current);
    if (draft.projectId !== this.projectId || (id !== undefined && draft.id !== id) || await subappSnapshotHash(draft.snapshot) !== draft.contentHash) throw invalid();
    checkSubappContext(signal, current);
    return draft;
  }
  async list(signal?: AbortSignal, current?: () => boolean) {
    const { drafts } = await this.request('', z.object({ drafts: z.array(summarySchema).max(MAX_SUBAPP_DOCUMENTS) }).strict(), 'GET', undefined, signal, current);
    if (drafts.some(d => d.projectId !== this.projectId) || new Set(drafts.map(d => d.id)).size !== drafts.length) throw invalid();
    return drafts;
  }
  async get(id: string, signal?: AbortSignal, current?: () => boolean) {
    const { draft } = await this.request(`/${this.identity(id)}`, z.object({ draft: documentSchema }).strict(), 'GET', undefined, signal, current);
    return this.checked(draft, id, signal, current);
  }
  async create(snapshot: SubappSnapshot, signal?: AbortSignal, current?: () => boolean) {
    const parsed = snapshotSchema.safeParse(snapshot); if (!parsed.success) throw invalid();
    const captured = parsed.data;
    const { draft } = await this.request('', z.object({ draft: documentSchema }).strict(), 'POST', { snapshot: captured }, signal, current);
    const checked = await this.checked(draft, undefined, signal, current);
    if (checked.revision !== 1 || JSON.stringify(checked.snapshot) !== JSON.stringify(captured)) throw invalid();
    return checked;
  }
  async update(id: string, snapshot: SubappSnapshot, expectedRevision: number, signal?: AbortSignal, current?: () => boolean) {
    const parsed = snapshotSchema.safeParse(snapshot);
    if (!parsed.success || !revisionSchema.safeParse(expectedRevision).success || expectedRevision === Number.MAX_SAFE_INTEGER) throw invalid();
    const captured = parsed.data;
    const { draft } = await this.request(`/${this.identity(id)}`, z.object({ draft: documentSchema }).strict(), 'PUT', { snapshot: captured, expectedRevision }, signal, current);
    const checked = await this.checked(draft, id, signal, current);
    if (checked.revision !== expectedRevision + 1 || JSON.stringify(checked.snapshot) !== JSON.stringify(captured)) throw invalid();
    return checked;
  }
}
