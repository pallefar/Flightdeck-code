import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createFileSubappWorkspaceStore, type SubappWorkspaceStore } from '../subapp-workspace-store';
import { registerSubappWorkspaceRoutes } from '../subapp-workspace';
import { documentSchema, summarySchema } from '../../packages/subapp-workspace/schema';
import { snapshotFixture } from '../../packages/subapp-workspace/testing';
import { generateSubApp } from '../../packages/codegen/src/generate';
import { minimalSpec, registryFixture } from '../../packages/codegen/src/fixtures/specs';
import { runConformanceGate } from '../../packages/conformance/src/gate';

const base = '/api/studio/workspaces/project-one/subapps';
const headers = { authorization: 'Bearer DEVELOPMENT_ONLY_FIXTURE' };
let root: string; let file: string; let app: FastifyInstance;
function mount(store = createFileSubappWorkspaceStore(file)) {
  app = Fastify({ logger: false });
  registerSubappWorkspaceRoutes(app, { actor: 'alice', authenticate: h => h === headers.authorization, store });
}
beforeEach(async () => { root = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'subapp-http-test-')); file = join(root, 'private', 'drafts.json'); mount(); });
afterEach(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });

describe('standalone sub-app authoring HTTP', () => {
  it('creates, exactly reads, summarizes and CAS-edits drafts over a real loopback HTTP socket after reconstruction', async () => {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(origin + base, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: snapshotFixture() }) });
    expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toBe('no-store');
    const draft = documentSchema.parse((await response.json() as { draft: unknown }).draft);
    expect((await (await fetch(`${origin}${base}/${draft.id}`, { headers })).json() as { draft: unknown }).draft).toEqual(draft);
    const edited = structuredClone(draft.snapshot); edited.files[0]!.contents += '\n// private author token/key annotation\r\n';
    const saved = await fetch(`${origin}${base}/${draft.id}`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: edited, expectedRevision: 1 }) });
    expect(saved.status).toBe(200); const next = documentSchema.parse((await saved.json() as { draft: unknown }).draft);
    expect(next.snapshot).toEqual(edited); expect(next.revision).toBe(2); expect(next.snapshot.baseline).toEqual(draft.snapshot.baseline);
    await app.close(); mount();
    const readback = await app.inject({ url: `${base}/${draft.id}`, headers });
    expect(readback.json().draft).toEqual(next);
    const list = await app.inject({ url: base, headers }); expect(list.statusCode).toBe(200);
    expect(summarySchema.parse(list.json().drafts[0])).toMatchObject({ id: draft.id, revision: 2, label: 'Demo' });
    expect(list.body).not.toContain('private author');
    expect((await app.inject({ url: `${base.replace('project-one', 'other')}/${draft.id}`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `${base}/${draft.id}`, headers, payload: { snapshot: edited, expectedRevision: 1 } })).statusCode).toBe(409);
    // Paths are inert source labels: no generated artifact tree is ever materialized.
    await expect(access(join(root, 'server'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(file, 'utf8')).drafts).toEqual([next]);
  });

  it('persists unmodified actual generator/scaffold output and manual incomplete source without claiming fresh checks', async () => {
    const generated = generateSubApp(minimalSpec, { registrySource: registryFixture }); const { plan } = generated;
    const gate = runConformanceGate({ files: generated.files.filter(f => f.kind !== 'standalone') });
    const snapshot = { baseline: {
      manifest: { id: plan.id, label: plan.label, version: plan.version, summary: plan.summary ?? null, icon: plan.manifestData.icon, navSection: plan.manifestData.navSection, routePrefix: plan.routePrefix, webModuleId: plan.webModuleId, capabilities: plan.manifestData.capabilities, visibleToRoles: plan.manifestData.visibleToRoles, envVar: plan.envVar, tablePrefix: plan.tablePrefix },
      files: generated.files, findings: gate.findings, rulesRun: gate.rules, notes: generated.warnings,
    }, files: generated.files.map(f => ({ ...f })) };
    const result = await app.inject({ method: 'POST', url: base, headers, payload: { snapshot } });
    expect(result.statusCode).toBe(201); const draft = documentSchema.parse(result.json().draft);
    expect(draft.snapshot).toEqual(snapshot);
    expect(draft.snapshot.files.some(f => f.kind === 'standalone')).toBe(true);
    const edited = structuredClone(draft.snapshot);
    edited.files[0]!.contents = 'this is intentionally incomplete source, not executable TypeScript\r\n';
    const update = await app.inject({ method: 'PUT', url: `${base}/${draft.id}`, headers, payload: { snapshot: edited, expectedRevision: 1 } });
    expect(update.statusCode).toBe(200);
    expect(update.json().draft.snapshot.baseline).toEqual(draft.snapshot.baseline);
    expect(update.json().draft.snapshot.files).toEqual(edited.files);
    await app.close(); mount();
    expect((await app.inject({ url: `${base}/${draft.id}`, headers })).json().draft).toEqual(update.json().draft);
    for (const artifactRoot of ['server', 'web', 'tests', 'standalone']) await expect(access(join(root, artifactRoot))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('authenticates every route before malformed JSON, body limits, params, queries or private store access', async () => {
    await app.close(); app = Fastify();
    const touched = vi.fn(() => { throw new Error('PRIVATE_STORE_SENTINEL'); });
    registerSubappWorkspaceRoutes(app, { actor: 'alice', authenticate: () => false, store: new Proxy({} as SubappWorkspaceStore, { get: touched }) });
    const id = '11111111-1111-4111-8111-111111111111';
    for (const [method, target] of [['GET', base], ['POST', base], ['GET', `${base}/${id}`], ['PUT', `${base}/${id}`]] as const) {
      const url = target.replace('project-one', 'INVALID') + '?unknown=PRIVATE_SENTINEL';
      const response = await app.inject({ method, url, ...(method === 'POST' || method === 'PUT' ? { headers: { 'content-type': 'application/json' }, payload: '{PRIVATE_SENTINEL' } : {}) });
      expect(response.statusCode).toBe(401); expect(response.json()).toEqual({ error: 'authentication required' });
      expect(response.headers['cache-control']).toBe('no-store');
    }
    const oversized = await app.inject({ method: 'POST', url: base, headers: { 'content-type': 'application/json' }, payload: 'x'.repeat(2_002_000) });
    expect(oversized.statusCode).toBe(401); expect(touched).not.toHaveBeenCalled();
    await expect(access(join(root, 'private'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('strictly validates every query/identity/body with fixed bounded errors and no private store lookups', async () => {
    await app.close(); const touched = vi.fn(() => { throw new Error('PRIVATE_STORE_SENTINEL'); });
    mount(new Proxy({} as SubappWorkspaceStore, { get: touched }));
    const id = '11111111-1111-4111-8111-111111111111';
    for (const [method, target] of [['GET', base], ['POST', base], ['GET', `${base}/${id}`], ['PUT', `${base}/${id}`]] as const) {
      for (const url of [target + '?unknown=PRIVATE_SENTINEL', target.replace('project-one', 'INVALID')]) {
        const response = await app.inject({ method, url, headers, ...(method === 'POST' ? { payload: { snapshot: snapshotFixture() } } : method === 'PUT' ? { payload: { snapshot: snapshotFixture(), expectedRevision: 1 } } : {}) });
        expect(response.statusCode).toBe(400); expect(response.json()).toEqual({ error: 'malformed request' });
        expect(response.headers['cache-control']).toBe('no-store');
      }
    }
    for (const payload of [{ snapshot: snapshotFixture(), actor: 'attacker' }, { snapshot: snapshotFixture(), contentHash: '0'.repeat(64) }, { snapshot: { ...snapshotFixture(), authorization: 'PRIVATE_SENTINEL' } }, { snapshot: snapshotFixture(), expectedRevision: 1 }, {}, null]) {
      const response = await app.inject({ method: 'POST', url: base, headers, payload: payload === null ? 'null' : payload });
      expect(response.statusCode).toBe(400); expect(response.body).not.toContain('PRIVATE_SENTINEL');
    }
    for (const expectedRevision of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, null]) {
      expect((await app.inject({ method: 'PUT', url: `${base}/${id}`, headers, payload: { snapshot: snapshotFixture(), expectedRevision } })).statusCode).toBe(400);
    }
    for (const payload of ['{PRIVATE_SENTINEL', '{"__proto__":{"value":"PRIVATE_SENTINEL"}}']) {
      const response = await app.inject({ method: 'POST', url: base, headers: { ...headers, 'content-type': 'application/json' }, payload });
      expect(response.statusCode).toBe(400); expect(response.body).toBe('{"error":"malformed request"}');
    }
    const oversized = await app.inject({ method: 'PUT', url: `${base}/${id}`, headers: { ...headers, 'content-type': 'application/json' }, payload: 'x'.repeat(2_002_000) });
    expect(oversized.statusCode).toBe(413); expect(oversized.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'GET', url: `${base}/not-a-uuid`, headers })).statusCode).toBe(400);
    expect(touched).not.toHaveBeenCalled();
  });

  it('bounds/sanitizes private failures and exposes no execution, apply, approval or activation endpoint', async () => {
    await app.close();
    const touched = vi.fn(async () => { throw new Error('/private/path PRIVATE_SOURCE_SENTINEL'); });
    mount({ create: touched, get: touched, update: touched, list: touched });
    for (const response of [await app.inject({ url: base, headers }), await app.inject({ method: 'POST', url: base, headers, payload: { snapshot: snapshotFixture() } })]) {
      expect(response.statusCode).toBe(503); expect(response.json()).toEqual({ error: 'workspace unavailable' }); expect(response.headers['cache-control']).toBe('no-store');
    }
    for (const action of ['runs', 'apply', 'approve', 'activate', 'deploy']) {
      expect((await app.inject({ method: 'POST', url: `${base}/11111111-1111-4111-8111-111111111111/${action}`, headers, payload: {} })).statusCode).toBe(404);
    }
    expect(touched).toHaveBeenCalledTimes(2);
  });
});
