import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureRuntime, fixtureOperator, fixtureReviewer } from './workflow-approval-process.fixture';
import { registerDevelopmentMcp } from '../../packages/resources/development-mcp';
import { createEmptyGraph, type Graph } from '../../packages/workflow/graph';
const execute = promisify(execFile);
const worker = fileURLToPath(new URL('./workflow-approval-process.fixture.ts', import.meta.url));
const base = '/api/studio/workspaces/project-one/workflows', queue = '/api/studio/workspaces/project-one/approvals';
const headers = { authorization: `Bearer ${fixtureOperator.token}` };
let root: string, origin: string, remote: FastifyInstance, runtime: ReturnType<typeof fixtureRuntime>, hits: number, mcp: number, finishes: number, allowed: boolean;
beforeEach(async () => {
    root = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'approval-process-'));
    hits = 0;
    mcp = 0;
    finishes = 0;
    allowed = true;
    remote = Fastify();
    remote.get('/measure', async () => ({ hits: ++hits }));
    remote.get('/finish', async (req) => ({ receivedValid: (req.query as {
            valid: string;
        }).valid === 'true', finishes: ++finishes }));
    remote.addHook('preHandler', async (req) => { if (req.method === 'POST' && (req.body as {
        method?: string;
    })?.method === 'tools/call')
        mcp++; });
    registerDevelopmentMcp(remote, () => true);
    origin = await remote.listen({ host: '127.0.0.1', port: 0 });
    runtime = fixtureRuntime(root, origin, () => allowed);
});
afterEach(async () => { await runtime.app.close(); await remote.close(); await rm(root, { recursive: true, force: true }); });
async function pause() {
    const r = await runtime.resourceStore.propose('project-one', { name: 'DEVELOPMENT independent approval fixture', functions: ['measure', 'validate', 'finish'] }, fixtureOperator.actor);
    const active = await runtime.registry.activate(runtime.resourceStore, 'project-one', r.id, 1, 'Independent activation fixture');
    const config = (functionId: string) => ({ resourceId: r.id, revision: active.revision, functionId });
    const graph: Graph = { ...createEmptyGraph(), nodes: [
            { id: 'start', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
            { id: 'rest', type: 'resource', label: 'REST', position: { x: 1, y: 0 }, config: config('measure'), inputMappings: [] },
            { id: 'mcp', type: 'resource', label: 'MCP', position: { x: 2, y: 0 }, config: config('validate'), inputMappings: [{ target: 'nodes', source: { kind: 'literal', value: ['a', 'b'] } }, { target: 'edges', source: { kind: 'literal', value: [{ from: 'a', to: 'b' }] } }] },
            { id: 'gate', type: 'approval', label: 'Gate', position: { x: 3, y: 0 }, config: { reviewer: 'finance-queue', reason: 'Review actual REST/MCP results' } },
            { id: 'finish', type: 'resource', label: 'Finish', position: { x: 4, y: 0 }, config: config('finish'), inputMappings: [{ target: 'valid', source: { kind: 'node', nodeId: 'mcp', path: ['valid'] } }] },
            { id: 'out', type: 'output', label: 'Out', position: { x: 5, y: 0 }, config: {} },
        ], edges: ['start', 'rest', 'mcp', 'gate', 'finish'].map((source, i) => ({ id: `e${i}`, source, target: ['rest', 'mcp', 'gate', 'finish', 'out'][i]! })) };
    const saved = await runtime.app.inject({ method: 'POST', url: base, headers, payload: { graph } });
    expect(saved.statusCode).toBe(201);
    const draft = saved.json().draft;
    const response = await runtime.app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers, payload: { revision: 1, input: { original: 7 } } });
    expect(response.statusCode).toBe(201);
    expect(response.json().run.state).toBe('paused');
    const list = await runtime.app.inject({ method: 'GET', url: queue, headers: fixtureReviewer });
    expect(list.statusCode).toBe(200);
    const approval = list.json().approvals[0];
    const preview = await runtime.app.inject({ method: 'GET', url: `${queue}/${approval.id}/review`, headers: fixtureReviewer });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().approval.context.pendingData).toEqual({ valid: true, nodeCount: 2, edgeCount: 1 });
    expect(hits).toBe(1);
    expect(mcp).toBe(1);
    expect(finishes).toBe(0);
    return { approval, run: response.json().run };
}
async function child(a: any, mode = 'decision') {
    const { stdout } = await execute(process.execPath, ['--import', 'tsx', worker, root, origin, a.id, a.contextDigest, mode], { timeout: 15000, maxBuffer: 1000000 });
    return JSON.parse(stdout);
}
it('restarts into two independent processes and reserves once before actual downstream REST', async () => {
    const { approval, run } = await pause();
    await runtime.app.close();
    const responses = await Promise.all([child(approval), child(approval)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(hits).toBe(1);
    expect(mcp).toBe(1);
    expect(finishes).toBe(1);
    expect(responses.find(r => r.status === 200).body.run.result.output).toEqual({ receivedValid: true, finishes: 1 });
    runtime = fixtureRuntime(root, origin);
    const read = await runtime.app.inject({ method: 'GET', url: `${base}/${run.draftId}/runs/${run.id}`, headers });
    expect(read.json().run.state).toBe('completed');
    expect(read.json().run.id).toBe(run.id);
    expect(read.json().run.result.output).toEqual({ receivedValid: true, finishes: 1 });
    expect((await child(approval)).status).toBe(409);
    expect(finishes).toBe(1);
}, 30000);
it('fails closed after an actual abrupt process exit following durable claim and original-run CAS', async () => {
    const { approval, run } = await pause();
    await runtime.app.close();
    await expect(child(approval, 'crash-claimed')).rejects.toMatchObject({ code: 17 });
    runtime = fixtureRuntime(root, origin);
    const review = await runtime.app.inject({ method: 'GET', url: `${queue}/${approval.id}/review`, headers: fixtureReviewer });
    expect(review.json().approval.state).toBe('interrupted');
    const read = await runtime.app.inject({ method: 'GET', url: `${base}/${run.draftId}/runs/${run.id}`, headers });
    expect(read.json().run).toMatchObject({ state: 'interrupted', resumable: false, result: null });
    expect((await child(approval)).status).toBe(409);
    expect(hits).toBe(1);
    expect(mcp).toBe(1);
    expect(finishes).toBe(0);
}, 30000);
it('never automatically resumes an approved journal after an abrupt exit before claim', async () => {
    const { approval, run } = await pause();
    await runtime.app.close();
    await expect(child(approval, 'crash-approved')).rejects.toMatchObject({ code: 17 });
    runtime = fixtureRuntime(root, origin);
    const preview = await runtime.app.inject({ method: 'GET', url: `${queue}/${approval.id}/review`, headers: fixtureReviewer });
    expect(preview.json().approval.state).toBe('interrupted');
    const read = await runtime.app.inject({ method: 'GET', url: `${base}/${run.draftId}/runs/${run.id}`, headers });
    expect(read.json().run.resumable).toBe(false);
    expect((await child(approval)).status).toBe(409);
    expect(hits).toBe(1); expect(mcp).toBe(1); expect(finishes).toBe(0);
}, 30_000);
it('refetches downstream active resource state after asynchronous effect-time authorization', async () => {
    const { approval } = await pause();
    const record = await runtime.approvals.read(approval.id);
    const resourceId = record.run.graphSnapshot.nodes.find(n => n.id === 'finish')!.config.resourceId as string;
    await runtime.app.close();
    let checks = 0;
    runtime = fixtureRuntime(root, origin, async () => {
        if (++checks === 2) await runtime.resourceStore.revise('project-one', resourceId, 2, { name: 'Revoked during effect-time policy', functions: ['measure', 'validate', 'finish'] }, fixtureOperator.actor);
        return true;
    });
    const response = await runtime.app.inject({ method: 'POST', url: `${queue}/${approval.id}/decisions`, headers: fixtureReviewer, payload: { approvalId: approval.id, revision: 1, decision: 'approve', contextDigest: approval.contextDigest } });
    expect(response.statusCode).toBe(200); expect(response.json().run.state).toBe('blocked');
    expect(checks).toBe(2); expect(hits).toBe(1); expect(mcp).toBe(1); expect(finishes).toBe(0);
});
it('reauthorizes downstream resource effects for the original initiator rather than reviewer', async () => {
    const { approval } = await pause();
    allowed = false;
    const response = await runtime.app.inject({ method: 'POST', url: `${queue}/${approval.id}/decisions`, headers: fixtureReviewer, payload: { approvalId: approval.id, revision: 1, decision: 'approve', contextDigest: approval.contextDigest } });
    expect(response.statusCode).toBe(200);
    expect(response.json().run.state).toBe('blocked');
    expect(hits).toBe(1);
    expect(mcp).toBe(1);
    expect(finishes).toBe(0);
});
