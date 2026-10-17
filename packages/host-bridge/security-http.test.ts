import { afterEach, expect, it } from 'vitest';
import { createEmptyGraph } from '../workflow/graph';
import { startDraftFixture, FIXTURE_PEER } from './fixture';
import { createPrivateClient } from './transport';

const path = '/bridge/workspaces/alpha/projects/general/drafts';
const fixtures: Awaited<ReturnType<typeof startDraftFixture>>[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); });
async function start(options: Parameters<typeof startDraftFixture>[0] = { enabled: true, enableDraftPolicy: true }) { const f = await startDraftFixture(options); fixtures.push(f); return f; }

it('keeps default-disabled and missing-policy HTTP gates ahead of data and every unsupported effect', async () => {
  for (const options of [{}, { enabled: true }]) {
    const f = await start(options); expect((await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph() } })).status).toBe(503);
    expect(f.privateHeaders).toHaveLength(0); expect(f.service().counters.writeEntries).toBe(0); expect(f.counters.nativeReads).toBe(0);
  }
});
it.each(['anonymous', 'expired', 'revoked', 'pending', 'nonmember', 'global-only-super-admin', 'workspace-disabled', 'project-disabled', 'policy-denied', 'resolver-workspace', 'resolver-project'])('rejects %s over real HTTP without data/effect entries', async scenario => {
  const f = await start(); const s = f.sessions.alice;
  if (scenario === 'expired' || scenario === 'revoked') s.active = false;
  if (scenario === 'pending') s.pending = true;
  if (scenario === 'nonmember' || scenario === 'global-only-super-admin') { s.member = false; s.role = 'super_admin'; }
  if (scenario === 'workspace-disabled') s.workspaceEnabled = false;
  if (scenario === 'project-disabled') s.projectEnabled = false;
  if (scenario === 'policy-denied') s.grant = false;
  if (scenario === 'resolver-workspace') s.resolvedWorkspace = 'te-ops';
  if (scenario === 'resolver-project') s.resolvedProject = 'other';
  const result = await f.browser(path, { method: 'POST', actor: scenario === 'anonymous' ? 'anonymous' : 'alice', body: { graph: createEmptyGraph() }, headers: { authorization: 'Bearer NONSECRET-browser-forgery', 'x-actor-id': 'super_admin', 'x-workspace-id': 'beta', 'x-project-id': 'general', 'x-studio-invocation': 'FORGED' } });
  expect([401, 403]).toContain(result.status); expect(f.privateHeaders).toHaveLength(0); expect(f.service().counters).toMatchObject({ readEntries: 0, writeEntries: 0, modelSends: 0, executions: 0, approvals: 0 });
});
it('pins mutation Origin including the TCP port and requires host-session-bound CSRF, not browser proof headers', async () => {
  const f = await start();
  for (const headers of [ { origin: null }, { origin: 'null' }, { origin: f.studioOrigin }, { origin: 'http://localhost:' + new URL(f.hostOrigin).port }, { origin: 'https://evil.test' }, { 'x-studio-csrf': null }, { 'x-studio-csrf': 'NONSECRET-CSRF-bob-fixture-session-bob' }, { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' } ]) {
    expect((await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph() }, headers })).status).toBe(403);
  }
  const missing = await start({ enabled: true, enableDraftPolicy: true, omitCsrfChecker: true });
  expect((await missing.browser(path, { method: 'POST', body: { graph: createEmptyGraph() } })).status).toBe(403);
  expect(f.service().counters.writeEntries).toBe(0); expect(missing.service().counters.writeEntries).toBe(0);
});
it('does not forward browser credential, actor, scope, forwarded or proof headers and rejects body identity injection', async () => {
  const f = await start();
  const result = await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph('Actual canonical actor') }, headers: { authorization: 'Bearer NONSECRET', 'x-actor-id': 'bob', 'x-workspace-id': 'beta', 'x-project-id': 'forged', 'x-studio-invocation': 'forged', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' } });
  expect(result.status).toBe(201); expect(result.json.draft?.createdBy).toBe('alice');
  for (const headers of f.privateHeaders) expect(headers.sort()).toEqual(['connection', 'content-length', 'content-type', 'host', 'x-studio-peer'].sort());
  expect((await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph(), actorId: 'bob', workspaceId: 'beta' } })).status).toBe(400);
  expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['access-control-allow-origin']).toBeUndefined();
  expect(JSON.stringify(result.json)).not.toMatch(/sessionVersion|authorityVersion|policyRevision|expiresAt|NONSECRET|lease|bodyDigest/);
});
it('isolates two workspace/general namespaces, canonical actors and labels across real HTTP CAS update and reconstruction', async () => {
  const f = await start(); const a = await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph('Alpha') } }); const draft = a.json.draft!;
  const beta = path.replace('/alpha/', '/beta/');
  expect((await f.browser(`${beta}/${draft.id}`)).status).toBe(404);
  expect((await f.browser(`${beta}/${draft.id}`, { method: 'PUT', body: { graph: createEmptyGraph('Cross-scope'), expectedRevision: 1 } })).status).toBe(404);
  const b = await f.browser(beta, { method: 'POST', actor: 'bob', body: { graph: createEmptyGraph('Beta') } }); expect(b.json.draft?.createdBy).toBe('bob');
  f.sessions.alice.displayName = 'Renamed label';
  const update = await f.browser(`${path}/${draft.id}`, { method: 'PUT', body: { graph: createEmptyGraph('Alpha stable identity'), expectedRevision: 1 } }); expect(update.json.draft).toMatchObject({ createdBy: 'alice', updatedBy: 'alice', revision: 2 });
  expect((await f.browser(`${path}/${draft.id}`, { method: 'PUT', body: { graph: createEmptyGraph(), expectedRevision: 1 } })).status).toBe(409);
  await f.reconstruct(); expect((await f.browser(`${path}/${draft.id}`)).json.draft).toEqual(update.json.draft); expect((await f.browser(`${beta}/${b.json.draft!.id}`)).json.draft).toEqual(b.json.draft);
});
it('closes all unknown methods, missing tuples, arbitrary upstream fields, effect/credential/review/resume/publication routes and oversized or malformed bodies', async () => {
  const f = await start();
  for (const bad of ['/bridge/drafts', '/bridge/workspaces/alpha/drafts', path + '?url=http://evil.test', path + '/runs', path + '/approve', '/bridge/model/send', '/bridge/credentials', '/bridge/resources/activate', '/bridge/install', '/bridge/publish']) expect((await f.browser(bad, { method: 'POST', body: {} })).status).toBe(404);
  expect((await f.browser(path, { method: 'DELETE' })).status).toBe(404);
  expect((await f.browser(path, { method: 'POST', rawBody: '{not-json' })).status).toBe(400);
  expect((await f.browser(path, { method: 'POST', rawBody: ' '.repeat(270_001) })).status).toBe(413);
  expect((await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph(), upstreamUrl: 'http://evil.test' } })).status).toBe(400);
  expect(f.service().counters).toMatchObject({ writeEntries: 0, modelSends: 0, credentials: 0, executions: 0, approvals: 0, activations: 0, installs: 0, publications: 0 });
});
it('private HTTP endpoints require dedicated peer authentication and cannot use browser credentials or fabricated authority', async () => {
  const f = await start();
  for (const origin of [f.hostOrigin, f.studioOrigin]) {
    const endpoint = origin === f.hostOrigin ? '/private/studio-authority/consume' : '/private/studio-drafts/invoke';
    const response = await fetch(origin + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'draft_fixture_session=alice', authorization: 'Bearer NONSECRET', 'x-actor-id': 'alice' }, body: '{bad-json' });
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'authentication required' });
  }
  const response = await createPrivateClient(f.studioOrigin, FIXTURE_PEER).call('/private/studio-drafts/invoke', { authority: '0'.repeat(64), wire: { method: 'GET', path, body: '' }, audience: 'studio-drafts/v1' });
  expect(response.status).toBe(403); expect(f.service().counters.readEntries).toBe(0);
});
function barrier() { let release!: () => void; let entered!: () => void; const ready = new Promise<void>(r => { entered = r; }); const wait = new Promise<void>(r => { release = r; }); return { ready, release, hook: async () => { entered(); await wait; } }; }
it.each(['session', 'membership', 'pending', 'workspace', 'project', 'policy', 'actor', 'revision'])('revocation of %s across an awaited pre-write barrier enters no write', async kind => {
  const gate = barrier(); const f = await start({ enabled: true, enableDraftPolicy: true, hooks: { beforeWrite: gate.hook } });
  const pending = f.browser(path, { method: 'POST', body: { graph: createEmptyGraph() } }); await gate.ready; const s = f.sessions.alice;
  if (kind === 'session') s.active = false; if (kind === 'membership') s.member = false; if (kind === 'pending') s.pending = true; if (kind === 'workspace') s.workspaceEnabled = false; if (kind === 'project') s.projectEnabled = false; if (kind === 'policy') s.grant = false; if (kind === 'actor') s.actorId = 'bob'; if (kind === 'revision') s.policyRevision = 'changed';
  gate.release(); const result = await pending; expect([401, 403]).toContain(result.status); expect(f.service().counters.writeEntries).toBe(0);
});
it('does not disclose private read output after revocation across an awaited post-read barrier', async () => {
  const hooks: { afterRead?: () => Promise<void> } = {}; const f = await start({ enabled: true, enableDraftPolicy: true, hooks });
  const created = await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph('Private fixture data') } });
  const gate = barrier(); hooks.afterRead = gate.hook; const pending = f.browser(`${path}/${created.json.draft!.id}`); await gate.ready; f.sessions.alice.member = false; gate.release();
  const result = await pending; // Native reauthorization returns null for revoked membership; no private reason is disclosed.
  expect(result.status).toBe(401); expect(result.json).toEqual({ error: 'authentication required' });
});
