import { afterEach, expect, it } from 'vitest';
import { request } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import { createEmptyGraph } from '../workflow/graph';
import { startDraftFixture } from './fixture';

const path = '/bridge/workspaces/alpha/projects/general/drafts';
const fixtures: Awaited<ReturnType<typeof startDraftFixture>>[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); });
async function checkedBeforeBody(predicate: () => boolean) {
  const end = Date.now() + 1500;
  while (!predicate()) { if (Date.now() >= end) throw new Error('Pre-body checker not observed'); await pause(2); }
}
async function changedDuringUpload(method: 'POST' | 'PUT', kind: 'session' | 'authority' | 'policy') {
  const f = await startDraftFixture({ enabled: true, enableDraftPolicy: true }); fixtures.push(f);
  const original = method === 'PUT' ? await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph('Original persisted revision') } }) : undefined;
  const route = original ? `${path}/${original.json.draft!.id}` : path;
  const graph = createEmptyGraph('Bounded synthetic upload');
  const body = { graph, ...(method === 'PUT' ? { expectedRevision: 1 } : {}) };
  const bytes = Buffer.from(JSON.stringify(body));
  const csrf = `NONSECRET-CSRF-alice-${f.sessions.alice.sessionVersion}`;
  const before = { csrf: f.counters.csrfReads, rpc: f.privateHeaders.length, writes: f.service().counters.writeEntries };
  let req!: ReturnType<typeof request>;
  const response = new Promise<{ status: number; error?: string }>((resolve, reject) => {
    req = request(f.hostOrigin + route, { method, headers: { cookie: 'draft_fixture_session=alice', origin: f.hostOrigin, 'content-type': 'application/json', 'content-length': String(bytes.length), 'x-studio-csrf': csrf } }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => { try { const parsed = JSON.parse(Buffer.concat(chunks).toString()) as { error?: string }; resolve({ status: res.statusCode ?? 0, ...(parsed.error ? { error: parsed.error } : {}) }); } catch (error) { reject(error); } });
    });
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('Owned upload timed out')));
  });
  try {
    req.write(bytes.subarray(0, 1));
    await checkedBeforeBody(() => f.counters.csrfReads > before.csrf);
    if (kind === 'session') f.sessions.alice.sessionVersion = 'rotated-after-prebody-check';
    if (kind === 'authority') f.sessions.alice.authorityVersion = 'changed-after-prebody-check';
    if (kind === 'policy') f.sessions.alice.policyRevision = 'changed-after-prebody-check';
    req.end(bytes.subarray(1));
    const result = await response;
    expect(result).toEqual({ status: 403, error: 'bridge forbidden' });
    expect(f.counters.csrfReads).toBeGreaterThanOrEqual(before.csrf + 2);
    expect(f.privateHeaders).toHaveLength(before.rpc);
    expect(f.service().counters.writeEntries).toBe(before.writes);
    expect((await f.browser(path)).json.drafts).toEqual(original ? [original.json.draft] : []);
    if (kind === 'session') expect((await f.browser(route, { method, body, headers: { 'x-studio-csrf': csrf } })).status).toBe(403);
    // A fresh request under the new trusted context remains usable; no automatic retry occurred.
    const accepted = await f.browser(route, { method, body });
    expect(accepted.status).toBe(method === 'POST' ? 201 : 200);
    expect(accepted.json.draft?.revision).toBe(method === 'POST' ? 1 : 2);
    expect((await f.browser(`${path}/${accepted.json.draft!.id}`)).json.draft).toEqual(accepted.json.draft);
  } finally { req.destroy(); await response.catch(() => undefined); }
}

it('refuses stale session CSRF after a real partial HTTP upload without entering RPC or persistence', async () => { await changedDuringUpload('POST', 'session'); });
it.each([['POST', 'authority'], ['POST', 'policy'], ['PUT', 'session'], ['PUT', 'authority'], ['PUT', 'policy']] as const)('refuses %s uploaded across a changed %s context before any new RPC/write', changedDuringUpload);
