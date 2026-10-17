import type { FastifyRequest } from 'fastify';
import { realpath, rm } from 'node:fs/promises';
import { createAuthority, targetFor, type HostState } from './authority';
import { createDraftRoot, openDraftService, type DraftHooks } from './draft-store';
import { createHostBff, createPrivateClient, createStudioRpc, type PrivateClient } from './transport';
import { createNativeContextAdapter } from './native';

/** NONSECRET deterministic fixtures. None of this validates real host sessions, DB membership or real grants. */
export const FIXTURE_PEER = 'NONSECRET_DEVELOPMENT_PEER_ONLY_000000000000';
export interface FixtureSession {
  actorId: string; displayName: string; active: boolean; pending: boolean; member: boolean;
  workspaceEnabled: boolean; projectEnabled: boolean; memberships: Set<string>; role: string;
  sessionVersion: string; authorityVersion: string; grant: boolean; policyRevision: string;
  resolvedWorkspace?: string; resolvedProject?: string;
}
export interface FixtureInvocation { authority: string; wire: { method: string; path: string; body: string }; audience: string }
export async function startDraftFixture(options: { enabled?: boolean; enableDraftPolicy?: boolean; omitCsrfChecker?: boolean; hooks?: DraftHooks; parent?: string; beforeForward?: () => Promise<void>; clock?: { now: number } } = {}) {
  const root = await createDraftRoot(options.parent ?? await realpath(process.env.TMPDIR!));
  let service = await openDraftService(root, options.hooks);
  const base = (actorId: string): FixtureSession => ({ actorId, displayName: 'Duplicate label', active: true, pending: false, member: true, workspaceEnabled: true, projectEnabled: true, memberships: new Set(['alpha', 'beta']), role: 'member', sessionVersion: `fixture-session-${actorId}`, authorityVersion: 'membership-1', grant: true, policyRevision: 'fixture-policy-1' });
  const sessions = { alice: base('alice'), bob: base('bob') };
  function session(req: FastifyRequest): FixtureSession | null {
    const cookie = req.headers.cookie;
    return cookie === 'draft_fixture_session=alice' ? sessions.alice : cookie === 'draft_fixture_session=bob' ? sessions.bob : null;
  }
  const counters = { nativeReads: 0, policyReads: 0, csrfReads: 0 };
  function snapshot(req: FastifyRequest): HostState | null {
    const s = session(req); if (!s) return null;
    const target = targetFor(req.method, req.raw.url ?? '');
    const workspaceId = s.resolvedWorkspace ?? target.workspaceId; const projectId = s.resolvedProject ?? target.projectId;
    return { actorId: s.actorId, displayName: s.displayName, workspaceId, projectId, sessionVersion: s.sessionVersion, authorityVersion: s.authorityVersion, active: s.active, pending: s.pending, member: s.member && s.memberships.has(workspaceId), workspaceEnabled: s.workspaceEnabled, projectEnabled: s.projectEnabled };
  }
  const native = createNativeContextAdapter({ authRequired: true, workspacesEnabled: true,
    view: req => { const s = snapshot(req); return { principal: s ? { username: s.actorId, displayName: s.displayName, pending: s.pending } : null, workspace: s ? { id: s.workspaceId, enabled: s.workspaceEnabled } : null, project: s ? { id: s.projectId, enabled: s.projectEnabled } : null }; },
    epochs: async req => { const s = snapshot(req); return s ? { sessionVersion: s.sessionVersion, authorityVersion: s.authorityVersion } : null; },
    context: {
      reauthorizeRequest: async req => { const s = snapshot(req); return s && s.active && !s.pending && s.member && s.workspaceEnabled && s.projectEnabled ? { actor: s.actorId, effectiveRole: 'member' } : null; },
      projectDirectory: async req => { const s = snapshot(req); if (!s?.member) throw new Error('synthetic fixture denied'); const availability = { openable: true, blockedReason: null, nextStep: 'fixture-only' }; return { workspace: { id: s.workspaceId, label: 'Synthetic workspace' }, selectedProjectId: s.projectId, projects: [{ id: s.projectId, label: 'Synthetic project', enabled: s.projectEnabled, isDefault: s.projectId === 'general', application: availability, contractDesk: availability }] }; },
    },
  });
  const adapter = { current: async (req: FastifyRequest) => { counters.nativeReads++; return native.current(req); } };
  const authority = createAuthority({ ...(options.clock ? { now: () => options.clock!.now } : {}), ...(options.enabled === undefined ? {} : { enabled: options.enabled }), adapter,
    ...(options.enableDraftPolicy ? { policy: { permit: async (req: FastifyRequest) => { counters.policyReads++; const s = session(req); return s?.grant ? { revision: s.policyRevision } : null; } } } : {}),
  });
  let studio: PrivateClient | undefined; let hostOrigin: string | undefined;
  const host = createHostBff({ authority, dedicatedPeerKey: FIXTURE_PEER, canonicalOrigin: () => hostOrigin, studio: () => studio,
    ...(!options.omitCsrfChecker ? { checkCsrf: async (req: FastifyRequest) => { counters.csrfReads++; const s = session(req); return !!s && req.headers['x-studio-csrf'] === `NONSECRET-CSRF-${s.actorId}-${s.sessionVersion}`; } } : {}),
  });
  const privateHeaders: string[][] = [];
  // Trusted fixture-only memory capture, never returned through browser routes or logged/evidenced.
  const privateInvocations: FixtureInvocation[] = [];
  const startedHost = await host.listen({ host: '127.0.0.1', port: 0 }); hostOrigin = startedHost;
  const rpc = createStudioRpc({ dedicatedPeerKey: FIXTURE_PEER, host: createPrivateClient(startedHost, FIXTURE_PEER), service: () => service, observeHeaders: names => privateHeaders.push(names) });
  let studioOrigin: string;
  try {
    studioOrigin = await rpc.listen({ host: '127.0.0.1', port: 0 }); const client = createPrivateClient(studioOrigin, FIXTURE_PEER);
    studio = { call: async (path, payload) => {
      if (options.beforeForward) { privateInvocations.push(structuredClone(payload) as FixtureInvocation); await options.beforeForward(); }
      return client.call(path, payload);
    } };
  }
  catch (error) { await host.close(); await rm(root, { recursive: true, force: true }); throw error; }
  return {
    root, hostOrigin: startedHost, studioOrigin, authority, adapter, sessions, counters, privateHeaders, privateInvocations, service: () => service,
    async reconstruct() { service = await openDraftService(root, options.hooks); },
    async browser(path: string, input: { method?: string; body?: unknown; actor?: 'alice' | 'bob' | 'anonymous'; headers?: Record<string, string | null>; rawBody?: string } = {}) {
      const actor = input.actor ?? 'alice'; const s = actor === 'anonymous' ? undefined : sessions[actor]; const method = input.method ?? 'GET';
      const headers: Record<string, string> = { ...(s ? { cookie: `draft_fixture_session=${actor}` } : {}), ...(method !== 'GET' ? { origin: startedHost, 'content-type': 'application/json', ...(s ? { 'x-studio-csrf': `NONSECRET-CSRF-${s.actorId}-${s.sessionVersion}` } : {}) } : {}) };
      for (const [name, value] of Object.entries(input.headers ?? {})) { if (value === null) delete headers[name]; else headers[name] = value; }
      const response = await fetch(startedHost + path, { method, headers, redirect: 'manual', ...(input.body !== undefined || input.rawBody !== undefined ? { body: input.rawBody ?? JSON.stringify(input.body) } : {}) });
      // Fixture convenience only; production transport uses strict DTOs, not this diagnostic object.
      const json = await response.json() as { error?: string; workspaceId?: string; projectId?: string; draft?: import('../../server/workflow-workspace-store').WorkflowDraft; drafts?: import('../../server/workflow-workspace-store').WorkflowDraft[] };
      return { status: response.status, headers: Object.fromEntries(response.headers), json };
    },
    async close() { authority.close(); await Promise.all([rpc.close(), host.close()]); await rm(root, { recursive: true, force: true }); },
  };
}
