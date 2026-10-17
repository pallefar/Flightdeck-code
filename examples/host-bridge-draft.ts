import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createEmptyGraph } from '../packages/workflow/graph';
import { startDraftFixture } from '../packages/host-bridge/fixture';

const args = process.argv.slice(2);
if (args.some(arg => !['--synthetic-drafts', '--write-evidence'].includes(arg))) throw new Error('Only --synthetic-drafts and --write-evidence are supported');
const path = '/bridge/workspaces/alpha/projects/general/drafts';
const disabled = await startDraftFixture();
let disabledStatus: number;
try {
  disabledStatus = (await disabled.browser(path, { method: 'POST', body: { graph: createEmptyGraph() } })).status;
  assert.equal(disabledStatus, 503); assert.equal(disabled.service().counters.writeEntries, 0); assert.equal(disabled.privateHeaders.length, 0);
} finally { await disabled.close(); }
const base = { schema: 'host-bridge-draft-demo/1', capturedAt: new Date().toISOString(), disabledStatus, hostMounted: false, studioRootMounted: false, liveHostSessionValidated: false, hostDbAccess: false, deployments: 0, launcherChanged: false };
let report: object = { ...base, mode: 'disabled' };
if (args.includes('--synthetic-drafts')) {
  // This explicit flag only enables new ephemeral NONSECRET synthetic fixture servers, never the host/Studio roots.
  const f = await startDraftFixture({ enabled: true, enableDraftPolicy: true });
  try {
    assert.notEqual(new URL(f.hostOrigin).port, new URL(f.studioOrigin).port);
    const created = await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph('Isolated synthetic HTTP draft') } });
    assert.equal(created.status, 201); assert.ok(created.json.draft); assert.equal(created.json.draft.createdBy, 'alice');
    const exact = `${path}/${created.json.draft.id}`;
    const read = await f.browser(exact); assert.equal(read.status, 200); assert.deepEqual(read.json.draft, created.json.draft);
    f.sessions.alice.displayName = 'New display label, same canonical actor';
    const updated = await f.browser(exact, { method: 'PUT', body: { graph: createEmptyGraph('Updated real file-backed draft'), expectedRevision: 1 } });
    assert.equal(updated.status, 200); assert.ok(updated.json.draft); assert.equal(updated.json.draft.revision, 2); assert.equal(updated.json.draft.updatedBy, 'alice');
    const updatedRead = await f.browser(exact); assert.equal(updatedRead.status, 200); assert.deepEqual(updatedRead.json.draft, updated.json.draft);
    const betaPath = path.replace('/alpha/', '/beta/');
    assert.equal((await f.browser(`${betaPath}/${created.json.draft.id}`)).status, 404);
    const beta = await f.browser(betaPath, { method: 'POST', actor: 'bob', body: { graph: createEmptyGraph('Other workspace general') } });
    assert.equal(beta.status, 201); assert.ok(beta.json.draft); assert.equal(beta.json.draft.createdBy, 'bob');
    const before = { ...f.service().counters };
    await f.reconstruct();
    const restored = await f.browser(exact); assert.equal(restored.status, 200); assert.deepEqual(restored.json.draft, updated.json.draft);
    const restoredBeta = await f.browser(`${betaPath}/${beta.json.draft.id}`, { actor: 'bob' }); assert.equal(restoredBeta.status, 200); assert.deepEqual(restoredBeta.json.draft, beta.json.draft);
    const allowedHeaders = new Set(['connection', 'content-length', 'content-type', 'host', 'x-studio-peer']);
    assert.ok(f.privateHeaders.length > 0 && f.privateHeaders.every(headers => headers.every(h => allowedHeaders.has(h))));
    const effects = { modelSends: before.modelSends + f.service().counters.modelSends, credentials: before.credentials + f.service().counters.credentials, executions: before.executions + f.service().counters.executions, approvals: before.approvals + f.service().counters.approvals, activations: before.activations + f.service().counters.activations, installs: before.installs + f.service().counters.installs, publications: before.publications + f.service().counters.publications };
    assert.ok(Object.values(effects).every(n => n === 0));
    report = { ...base, mode: 'isolated-synthetic-drafts', hostFixtureOrigin: f.hostOrigin, studioFixtureOrigin: f.studioOrigin, transport: 'two distinct ephemeral literal-loopback HTTP servers', authentication: 'deterministic nonsecret trusted fixtures; NOT real host DB/session validation', createStatus: created.status, readStatus: read.status, updateStatus: updated.status, namespaceIsolation: true, stableCanonicalActor: true, reconstructedExact: true, exactDrafts: [{ workspaceId: 'alpha', projectId: 'general', actorId: 'alice', id: updated.json.draft.id, revision: updated.json.draft.revision, snapshotSha256: createHash('sha256').update(JSON.stringify(updated.json.draft)).digest('hex') }, { workspaceId: 'beta', projectId: 'general', actorId: 'bob', id: beta.json.draft.id, revision: beta.json.draft.revision, snapshotSha256: createHash('sha256').update(JSON.stringify(beta.json.draft)).digest('hex') }], privateHeadersOnly: true, writeEntries: before.writeEntries, effects, cleanedUp: true };
  } finally { await f.close(); }
}
if (args.includes('--write-evidence')) {
  await mkdir('docs/evidence/host-bridge', { recursive: true });
  await writeFile('docs/evidence/host-bridge/draft-demo.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
