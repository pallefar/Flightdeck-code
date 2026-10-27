import { createHash, randomBytes } from 'node:crypto';

export class BridgeError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503) { super('bridge refused'); }
}
export const AUDIENCE = 'studio-drafts/v1';
export const MAX_BODY_BYTES = 270_000;
export type DraftAction = 'draft.list' | 'draft.read' | 'draft.create' | 'draft.update';
export interface HostState {
  actorId: string; displayName: string; workspaceId: string; projectId: string;
  /** Opaque nonsecret revisions supplied by trusted host code, NEVER browser tokens. */
  sessionVersion: string; authorityVersion: string;
  active: boolean; pending: boolean; member: boolean; workspaceEnabled: boolean; projectEnabled: boolean;
}
export interface WireRequest { method: string; path: string; body: Buffer }
export interface Target { workspaceId: string; projectId: string; draftId?: string; action: DraftAction }
export interface Binding extends Target {
  actorId: string; sessionVersion: string; authorityVersion: string; policyRevision: string;
  method: string; path: string; bodyDigest: string; audience: string; expiresAt: number;
}
export interface DraftPolicy<Request> {
  /** Independent deny-default host-owned Studio action policy; directory/role/owner/app consent is not a grant. */
  permit(request: Request, binding: Readonly<Target & { actorId: string }>): Promise<{ revision: string } | null>;
}
export interface AuthorityOptions<Request> {
  enabled?: boolean;
  adapter: { current(request: Request): Promise<HostState | null> };
  policy?: DraftPolicy<Request>;
  now?: () => number; ttlMs?: number; maxInvocations?: number;
}
const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';
const route = new RegExp(`^/bridge/workspaces/(${slug})/projects/(${slug})/drafts(?:/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?$`);
export function targetFor(method: string, path: string): Target {
  const match = route.exec(path);
  if (!match || !match[1] || !match[2] || match[1].length > 64 || match[2].length > 64) throw new BridgeError(404);
  const draftId = match[3];
  const action = method === 'GET' ? draftId ? 'draft.read' : 'draft.list' : method === 'POST' && !draftId ? 'draft.create' : method === 'PUT' && draftId ? 'draft.update' : null;
  if (!action) throw new BridgeError(404);
  return { workspaceId: match[1], projectId: match[2], ...(draftId ? { draftId } : {}), action };
}
export function bodyDigest(body: Buffer): string { return createHash('sha256').update(body).digest('hex'); }
function wireBinding(wire: WireRequest) {
  const target = targetFor(wire.method, wire.path);
  if (wire.body.length > MAX_BODY_BYTES) throw new BridgeError(413);
  if ((wire.method === 'GET') !== (wire.body.length === 0)) throw new BridgeError(400);
  return { ...target, method: wire.method, path: wire.path, bodyDigest: bodyDigest(wire.body) };
}
function validState(s: HostState | null, t: Target): s is HostState {
  return !!s && s.active === true && s.pending === false && s.member === true && s.workspaceEnabled === true && s.projectEnabled === true
    && s.workspaceId === t.workspaceId && s.projectId === t.projectId
    && typeof s.actorId === 'string' && s.actorId.length > 0 && s.actorId.length <= 200 && s.actorId === s.actorId.trim().toLowerCase() && !/[\x00-\x1f\x7f]/.test(s.actorId)
    && [s.sessionVersion, s.authorityVersion].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200);
}
const sameState = (a: Pick<HostState, 'actorId' | 'sessionVersion' | 'authorityVersion'>, b: Pick<HostState, 'actorId' | 'sessionVersion' | 'authorityVersion'>) => a.actorId === b.actorId && a.sessionVersion === b.sessionVersion && a.authorityVersion === b.authorityVersion;
const opaque = () => randomBytes(32).toString('hex');

/** Host-process-only request registry. It is NOT a serialized login token or a durable/cross-process authority service. */
export function createAuthority<Request>(options: AuthorityOptions<Request>) {
  const now = options.now ?? Date.now; const ttl = options.ttlMs ?? 2000; const max = options.maxInvocations ?? 64;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 5000 || !Number.isInteger(max) || max < 1 || max > 1024) throw new BridgeError(503);
  type Entry = { request: Request; binding: Readonly<Binding>; alive: () => boolean; consumed: boolean; revoked: boolean; lease?: string };
  type Prepared = { request: Request; state: HostState; method: string; path: string; policyRevision: string; expiresAt: number };
  // Opaque in-process tickets: neither a serialized caller assertion nor a reusable session grant.
  const preparedRequests = new WeakMap<object, Prepared>();
  const entries = new Map<string, Entry>(); const leases = new Map<string, Entry>(); let closed = false;
  function available() { if (closed || options.enabled !== true || !options.policy) throw new BridgeError(503); }
  function finish(handle: string) { const e = entries.get(handle); if (e) e.revoked = true; if (e?.lease) leases.delete(e.lease); entries.delete(handle); }
  function prune() { for (const [h, e] of entries) if (now() >= e.binding.expiresAt || !e.alive()) finish(h); }
  function bound(e: Entry, wire: WireRequest, audience: string) {
    available();
    const b = e.binding;
    if (e.revoked || !e.alive() || now() >= b.expiresAt || audience !== b.audience || wire.method !== b.method || wire.path !== b.path || bodyDigest(wire.body) !== b.bodyDigest) throw new BridgeError(403);
    const incoming = wireBinding(wire);
    if (incoming.action !== b.action) throw new BridgeError(403);
  }
  async function current(request: Request, target: Target): Promise<HostState> {
    const state = await options.adapter.current(request);
    if (!validState(state, target)) throw new BridgeError(state === null ? 401 : 403);
    // Copy before any subsequent await: trusted mutable adapters cannot mutate the prior snapshot.
    return { ...state };
  }
  async function fresh(e: Entry) {
    const b = e.binding;
    if (e.revoked || !e.alive() || now() >= b.expiresAt) throw new BridgeError(403);
    const first = await current(e.request, b);
    if (!sameState(first, b)) throw new BridgeError(403);
    const policy = await options.policy!.permit(e.request, b);
    if (!policy || policy.revision !== b.policyRevision) throw new BridgeError(403);
    const last = await current(e.request, b);
    if (!sameState(first, last) || e.revoked || closed || !e.alive() || now() >= b.expiresAt) throw new BridgeError(403);
  }
  return {
    async preflight(request: Request, method: string, path: string) {
      available(); const target = targetFor(method, path); const initial = await current(request, target);
      const policy = await options.policy!.permit(request, Object.freeze({ ...target, actorId: initial.actorId }));
      const policyRevision = policy?.revision;
      if (typeof policyRevision !== 'string' || !policyRevision || policyRevision.length > 200) throw new BridgeError(403);
      const last = await current(request, target); available(); if (!sameState(initial, last)) throw new BridgeError(403);
      const ticket = Object.freeze({});
      preparedRequests.set(ticket, { request, state: initial, method, path, policyRevision, expiresAt: now() + ttl });
      return ticket;
    },
    async issue(request: Request, wire: WireRequest, alive: () => boolean = () => true, prepared?: object) {
      available(); const wb = wireBinding(wire); prune();
      const context = prepared === undefined ? undefined : preparedRequests.get(prepared);
      if (prepared !== undefined) {
        preparedRequests.delete(prepared); // Single-use claim before the first await, including failed issuance.
        if (!context || context.request !== request || context.method !== wire.method || context.path !== wire.path || now() >= context.expiresAt) throw new BridgeError(403);
      }
      const initial = await current(request, wb);
      if (context && !sameState(initial, context.state)) throw new BridgeError(403);
      const policy = await options.policy!.permit(request, Object.freeze({ ...wb, actorId: initial.actorId }));
      const policyRevision = policy?.revision;
      if (typeof policyRevision !== 'string' || !policyRevision || policyRevision.length > 200 || context && policyRevision !== context.policyRevision) throw new BridgeError(403);
      const last = await current(request, wb);
      available(); if (!sameState(initial, last) || !alive() || context && now() >= context.expiresAt) throw new BridgeError(403);
      prune(); if (entries.size >= max) throw new BridgeError(503);
      const binding: Readonly<Binding> = Object.freeze({ ...wb, actorId: initial.actorId, sessionVersion: initial.sessionVersion, authorityVersion: initial.authorityVersion, policyRevision, audience: AUDIENCE, expiresAt: now() + ttl });
      const handle = opaque(); entries.set(handle, { request, binding, alive, consumed: false, revoked: false });
      return { handle, binding };
    },
    async consume(handle: string, wire: WireRequest, audience: string) {
      available(); prune(); const e = entries.get(handle);
      if (!e || e.consumed) throw new BridgeError(403);
      bound(e, wire, audience);
      // Synchronous claim before first await: concurrent RPC attempts cannot both enter.
      e.consumed = true; e.lease = opaque(); leases.set(e.lease, e);
      try { await fresh(e); return { lease: e.lease, binding: e.binding }; }
      catch (error) { finish(handle); throw error; }
    },
    async check(lease: string, wire: WireRequest, audience: string) {
      available(); prune(); const e = leases.get(lease); if (!e) throw new BridgeError(403);
      bound(e, wire, audience); await fresh(e); bound(e, wire, audience); return e.binding;
    },
    async confirm(handle: string, wire: WireRequest) {
      available(); const e = entries.get(handle); if (!e || !e.consumed) throw new BridgeError(403);
      bound(e, wire, AUDIENCE); await fresh(e); bound(e, wire, AUDIENCE);
    },
    finish,
    close() { closed = true; for (const h of entries.keys()) finish(h); leases.clear(); },
  };
}
export type HostAuthority<Request> = ReturnType<typeof createAuthority<Request>>;
