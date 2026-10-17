import { afterEach, expect, it } from 'vitest';
import { createEmptyGraph } from '../workflow/graph';
import { FIXTURE_PEER, startDraftFixture } from './fixture';
import { createPrivateClient } from './transport';

const fixtures: Awaited<ReturnType<typeof startDraftFixture>>[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); });
const path = '/bridge/workspaces/alpha/projects/general/drafts';
function gate() { let release!: () => void; let enter!: () => void; const ready = new Promise<void>(r => { enter = r; }); const wait = new Promise<void>(r => { release = r; }); return { ready, release, hook: async () => { enter(); await wait; } }; }
it.each(['method', 'path', 'body', 'audience', 'expiry'])('rejects %s-changed private invocation over actual HTTP before any store entry', async kind => {
  const g = gate(); const clock = { now: 1000 };
  const f = await startDraftFixture({ enabled: true, enableDraftPolicy: true, beforeForward: g.hook, clock }); fixtures.push(f);
  const browser = f.browser(path, { method: 'POST', body: { graph: createEmptyGraph() } }); await g.ready;
  const payload = structuredClone(f.privateInvocations[0]!);
  if (kind === 'method') payload.wire.method = 'PUT';
  if (kind === 'path') payload.wire.path = path.replace('/alpha/', '/beta/');
  if (kind === 'body') payload.wire.body = Buffer.from('{}').toString('base64');
  if (kind === 'audience') payload.audience = 'foreign';
  if (kind === 'expiry') clock.now += 2001;
  try {
    const attempted = await createPrivateClient(f.studioOrigin, FIXTURE_PEER).call('/private/studio-drafts/invoke', payload);
    expect([400, 403]).toContain(attempted.status); expect(f.service().counters.writeEntries).toBe(0);
  } finally { g.release(); }
  const original = await browser; expect(original.status).toBe(kind === 'expiry' ? 403 : 201);
  const replay = await createPrivateClient(f.studioOrigin, FIXTURE_PEER).call('/private/studio-drafts/invoke', f.privateInvocations[0]);
  expect(replay.status).toBe(403);
});
it('one of concurrent private HTTP invocations consumes authority, with one real draft write and no retry', async () => {
  const g = gate(); const f = await startDraftFixture({ enabled: true, enableDraftPolicy: true, beforeForward: g.hook }); fixtures.push(f);
  const browser = f.browser(path, { method: 'POST', body: { graph: createEmptyGraph('Single consumed draft') } }); await g.ready;
  const client = createPrivateClient(f.studioOrigin, FIXTURE_PEER);
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => client.call('/private/studio-drafts/invoke', f.privateInvocations[0])));
  expect(outcomes.filter(o => o.status === 201)).toHaveLength(1); expect(outcomes.filter(o => o.status === 403)).toHaveLength(7);
  expect(f.service().counters.writeEntries).toBe(1); g.release(); expect((await browser).status).toBe(403);
});
