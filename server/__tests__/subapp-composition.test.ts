import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createServer } from '../index';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
import { generateSubApp } from '../../packages/codegen/src/pure';
import { minimalSpec } from '../../packages/codegen/src/fixtures/specs';
import { snapshotSchema } from '../../packages/subapp-workspace/schema';
import { createFileSubappWorkspaceStore } from '../subapp-workspace-store';

const operator = { actor: 'Karsten Haldan', token: 'isolated-subapp-root-fixture-only' };
const headers = { authorization: `Bearer ${operator.token}` };
const url = '/api/studio/workspaces/authoring-fixture/subapps';

it('uses the configured private state root without an injected store and authenticates before parsing', async () => {
  const directory = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'studio-subapp-default-'));
  vi.stubEnv('STUDIO_STATE_DIR', directory);
  vi.stubEnv('STUDIO_SUBAPP_WORKSPACE_FILE', undefined);
  const app = createServer({ operator, store: createMemoryGrantStore() });
  try {
    const refused = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: '{private malformed payload' });
    expect(refused.statusCode).toBe(401);
    expect(refused.body).not.toContain('private malformed');
    await expect(stat(join(directory, 'subapp-workspace.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const created = await app.inject({ method: 'POST', url, headers, payload: { snapshot: generatedSnapshot() } });
    expect(created.statusCode).toBe(201);
    expect((await stat(join(directory, 'subapp-workspace.json'))).mode & 0o777).toBe(0o600);
    const draft = created.json().draft;
    expect((await app.inject({ url: `${url}/${draft.id}`, headers })).json().draft).toEqual(draft);
  } finally { await app.close(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
});

function generatedSnapshot() {
  const generated = generateSubApp(minimalSpec);
  const plan = generated.plan; const metadata = plan.manifestData;
  const files = generated.files.filter(file => file.kind !== 'standalone');
  return snapshotSchema.parse({ baseline: {
    manifest: { id: plan.id, label: plan.label, version: plan.version, summary: plan.summary ?? null,
      icon: metadata.icon, navSection: metadata.navSection, routePrefix: plan.routePrefix, webModuleId: plan.webModuleId,
      capabilities: metadata.capabilities, visibleToRoles: metadata.visibleToRoles, envVar: plan.envVar, tablePrefix: plan.tablePrefix },
    files, findings: [], rulesRun: [], notes: ['Unverified saved draft source; host installation not performed.'],
  }, files });
}

it('mounts generated sub-app source persistence, edit CAS and exact reopen after server reconstruction', async () => {
  const base = await realpath(process.env.TMPDIR!);
  const directory = await mkdtemp(join(base, 'studio-subapp-root-'));
  const file = join(directory, 'subapps.json');
  const options = { operator, store: createMemoryGrantStore(), subappWorkspaceStore: createFileSubappWorkspaceStore(file) };
  const app = createServer(options);
  try {
    const source = generatedSnapshot();
    const unauthorized = await app.inject({ method: 'POST', url, payload: { snapshot: source } });
    expect(unauthorized.statusCode).toBe(401);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    const created = await app.inject({ method: 'POST', url, headers, payload: { snapshot: source } });
    expect(created.statusCode).toBe(201);
    const draft = created.json().draft;
    const readback = await app.inject({ url: `${url}/${draft.id}`, headers });
    expect(readback.json().draft).toEqual(draft);
    const edited = structuredClone(source);
    edited.files[0]!.contents += '\r\n// local saved source annotation\n';
    const updated = await app.inject({ method: 'PUT', url: `${url}/${draft.id}`, headers, payload: { snapshot: edited, expectedRevision: draft.revision } });
    expect(updated.statusCode).toBe(200);
    const next = updated.json().draft;
    expect(next.revision).toBe(2);
    expect(next.snapshot.baseline).toEqual(draft.snapshot.baseline);
    expect(next.snapshot.files).toEqual(edited.files);
    const stale = await app.inject({ method: 'PUT', url: `${url}/${draft.id}`, headers, payload: { snapshot: source, expectedRevision: draft.revision } });
    expect(stale.statusCode).toBe(409);
    await app.close();
    const restarted = createServer({ ...options, subappWorkspaceStore: createFileSubappWorkspaceStore(file) });
    try {
      const restored = await restarted.inject({ url: `${url}/${draft.id}`, headers });
      expect(restored.json().draft).toEqual(next);
      expect(restored.headers['cache-control']).toBe('no-store');
      expect((await restarted.inject({ url: `/api/studio/workspaces/other-project/subapps/${draft.id}`, headers })).statusCode).toBe(404);
      expect((await restarted.inject({ method: 'POST', url: `${url}/${draft.id}/runs`, headers, payload: {} })).statusCode).toBe(404);
      expect((await restarted.inject({ url, headers })).json().drafts).toMatchObject([{ id: draft.id, revision: 2, status: 'draft' }]);
    } finally { await restarted.close(); }
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
