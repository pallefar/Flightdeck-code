import { describe, expect, it } from 'vitest';
import { createAuthority, BridgeError, type HostState } from './authority';

const state = (): HostState => ({ actorId: 'alice', displayName: 'Shared label', workspaceId: 'alpha', projectId: 'general', sessionVersion: 'session-1', authorityVersion: 'membership-1', active: true, pending: false, member: true, workspaceEnabled: true, projectEnabled: true });
const request = {};
const wire = { method: 'POST', path: '/bridge/workspaces/alpha/projects/general/drafts', body: Buffer.from('{"graph":{}}') };
function fixture() {
  let current: HostState | null = state(); let grant = true; let revision = 'draft-policy-1'; let now = 1000;
  const authority = createAuthority({ enabled: true, adapter: { current: async (_request: object) => current }, policy: { permit: async () => grant ? { revision } : null }, now: () => now, ttlMs: 50 });
  return { authority, setState: (s: HostState | null) => { current = s; }, deny: () => { grant = false; }, revise: () => { revision = 'draft-policy-2'; }, expire: () => { now += 51; } };
}
describe('host-only draft authority', () => {
  it('is disabled by default and refuses absent independent trusted action policy', async () => {
    let reads = 0;
    const adapter = { current: async (_request: object) => { reads++; return state(); } };
    await expect(createAuthority({ adapter }).issue(request, wire)).rejects.toMatchObject({ status: 503 });
    expect(reads).toBe(0);
    await expect(createAuthority({ enabled: true, adapter }).issue(request, wire)).rejects.toBeInstanceOf(BridgeError);
    expect(reads).toBe(0);
  });
  it('rejects issuance after the session bound by preflight changes during upload', async () => {
    const f = fixture();
    const prepared = await f.authority.preflight(request, wire.method, wire.path);
    f.setState({ ...state(), sessionVersion: 'rotated-during-upload' });
    const refused = await f.authority.issue(request, wire, () => true, prepared).then(() => false, (error: unknown) => error instanceof BridgeError && error.status === 403);
    expect(refused).toBe(true);
  });
  it.each(['actor', 'authority', 'policy', 'request', 'method', 'path', 'expiry', 'forged', 'other-authority', 'replay'])('refuses a preflight ticket with changed %s context', async kind => {
    const f = fixture(); let prepared: object = await f.authority.preflight(request, wire.method, wire.path);
    let actualRequest = request, actualWire = wire;
    if (kind === 'actor') f.setState({ ...state(), actorId: 'bob' });
    if (kind === 'authority') f.setState({ ...state(), authorityVersion: 'changed' });
    if (kind === 'policy') f.revise();
    if (kind === 'request') actualRequest = {};
    if (kind === 'method') actualWire = { ...wire, method: 'PUT', path: wire.path + '/00000000-0000-4000-8000-000000000001' };
    if (kind === 'path') actualWire = { ...wire, path: wire.path.replace('/alpha/', '/beta/') };
    if (kind === 'expiry') f.expire();
    if (kind === 'forged') prepared = {};
    if (kind === 'other-authority') prepared = await fixture().authority.preflight(request, wire.method, wire.path);
    if (kind === 'replay') { const issued = await f.authority.issue(request, wire, () => true, prepared); f.authority.finish(issued.handle); }
    const refused = await f.authority.issue(actualRequest, actualWire, () => true, prepared).then(() => false, (error: unknown) => error instanceof BridgeError && error.status === 403);
    expect(refused).toBe(true);
  });
  it('consumes a preflight ticket once under concurrency without making display labels an authority binding', async () => {
    const f = fixture(); const prepared = await f.authority.preflight(request, wire.method, wire.path);
    f.setState({ ...state(), displayName: 'New display label only' });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => f.authority.issue(request, wire, () => true, prepared)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'fulfilled') f.authority.finish(result.value.handle);
  });
  it('binds immutable exact request authority and atomically consumes only once, including concurrent consumption', async () => {
    const { authority } = fixture(); const issued = await authority.issue(request, wire);
    expect(issued.binding).toMatchObject({ actorId: 'alice', workspaceId: 'alpha', projectId: 'general', action: 'draft.create', method: 'POST', policyRevision: 'draft-policy-1' });
    expect(issued.handle).toMatch(/^[a-f0-9]{64}$/);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => authority.consume(issued.handle, wire, 'studio-drafts/v1')));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const result = results.find(r => r.status === 'fulfilled'); if (!result || result.status !== 'fulfilled') throw new Error('one lease required');
    expect(await authority.check(result.value.lease, wire, 'studio-drafts/v1')).toEqual(issued.binding);
    authority.finish(issued.handle);
    await expect(authority.check(result.value.lease, wire, 'studio-drafts/v1')).rejects.toMatchObject({ status: 403 });
  });
  it.each(['anonymous', 'expired', 'revoked', 'pending', 'nonmember', 'global-only-super-admin', 'workspace-disabled', 'project-disabled', 'scope-mismatch', 'noncanonical-actor'])('refuses %s before issuing authority', async reason => {
    const f = fixture(); const s = state();
    if (reason === 'anonymous') f.setState(null);
    else { if (['expired', 'revoked'].includes(reason)) s.active = false; if (reason === 'pending') s.pending = true; if (['nonmember', 'global-only-super-admin'].includes(reason)) s.member = false; if (reason === 'workspace-disabled') s.workspaceEnabled = false; if (reason === 'project-disabled') s.projectEnabled = false; if (reason === 'scope-mismatch') s.workspaceId = 'beta'; if (reason === 'noncanonical-actor') s.actorId = 'Alice'; f.setState(s); }
    await expect(f.authority.issue(request, wire)).rejects.toBeInstanceOf(BridgeError);
  });
  it.each(['audience', 'method', 'path', 'body', 'expiry', 'policy', 'membership', 'session'])('rejects changed %s binding and stale rechecks', async kind => {
    const f = fixture(); const issued = await f.authority.issue(request, wire); let audience = 'studio-drafts/v1'; let changed = { ...wire };
    if (kind === 'audience') audience = 'other'; if (kind === 'method') changed.method = 'PUT'; if (kind === 'path') changed.path += '/00000000-0000-4000-8000-000000000000'; if (kind === 'body') changed.body = Buffer.from('{}');
    if (kind === 'expiry') f.expire(); if (kind === 'policy') f.revise(); if (kind === 'membership') f.setState({ ...state(), member: false }); if (kind === 'session') f.setState({ ...state(), sessionVersion: 'rotated' });
    await expect(f.authority.consume(issued.handle, changed, audience)).rejects.toBeInstanceOf(BridgeError);
  });
  it('requires exact explicit tuple and independently granted draft actions, never directory/roles/consent', async () => {
    const f = fixture(); f.deny(); await expect(f.authority.issue(request, wire)).rejects.toMatchObject({ status: 403 });
    for (const path of ['/bridge/drafts', '/bridge/workspaces/alpha/projects/general/drafts?actor=admin', '/bridge/workspaces/alpha/projects/general/drafts/runs', 'https://evil.test/', '/bridge/workspaces/alpha/projects/%67eneral/drafts']) await expect(f.authority.issue(request, { ...wire, path })).rejects.toBeInstanceOf(BridgeError);
  });
  it('bounds TTL and retained invocations, prunes dead requests, and never reopens after close', async () => {
    const base = { enabled: true, adapter: { current: async (_r: object) => state() }, policy: { permit: async () => ({ revision: 'p1' }) } };
    for (const ttlMs of [0, 5001, 1.5]) expect(() => createAuthority({ ...base, ttlMs })).toThrow(BridgeError);
    for (const maxInvocations of [0, 1025, 1.5]) expect(() => createAuthority({ ...base, maxInvocations })).toThrow(BridgeError);
    let alive = true;
    const authority = createAuthority({ ...base, maxInvocations: 1 });
    const issued = await authority.issue(request, wire, () => alive);
    await expect(authority.issue(request, wire)).rejects.toMatchObject({ status: 503 });
    alive = false; await expect(authority.consume(issued.handle, wire, 'studio-drafts/v1')).rejects.toMatchObject({ status: 403 });
    await expect(authority.issue(request, wire)).resolves.toHaveProperty('handle');
    authority.close(); await expect(authority.issue(request, wire)).rejects.toMatchObject({ status: 503 });
  });
  it.each(['finish', 'close'])('invalidates an in-flight consumption across await when %s occurs', async kind => {
    let block = false; let entered!: () => void; let release!: () => void;
    const ready = new Promise<void>(r => { entered = r; }); const gate = new Promise<void>(r => { release = r; });
    const authority = createAuthority({ enabled: true, adapter: { current: async (_r: object) => state() }, policy: { permit: async () => { if (block) { entered(); await gate; } return { revision: 'p1' }; } } });
    const issued = await authority.issue(request, wire); block = true;
    const pending = authority.consume(issued.handle, wire, 'studio-drafts/v1'); await ready;
    if (kind === 'finish') authority.finish(issued.handle); else authority.close();
    release(); await expect(pending).rejects.toBeInstanceOf(BridgeError);
  });
  it('does not turn display renames into a new identity and keeps distinct canonical actors distinct', async () => {
    const f = fixture(); const issued = await f.authority.issue(request, wire); f.setState({ ...state(), displayName: 'Renamed' });
    const consumed = await f.authority.consume(issued.handle, wire, 'studio-drafts/v1'); expect(consumed.binding.actorId).toBe('alice');
    f.setState({ ...state(), actorId: 'bob' }); await expect(f.authority.check(consumed.lease, wire, 'studio-drafts/v1')).rejects.toMatchObject({ status: 403 });
  });
});
