import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createEmptyGraph, type Graph } from '../../packages/workflow/graph';
import { createFileWorkflowWorkspaceStore } from '../workflow-workspace-store';
import { registerWorkflowWorkspaceRoutes } from '../workflow-workspace';
import { WorkflowApprovalStore } from '../workflow-approval-store';
import type { WorkflowApprovalDependencies } from '../workflow-approval';
const base = '/api/studio/workspaces/project-one/workflows';
const queue = '/api/studio/workspaces/project-one/approvals';
const operator = { authorization: 'Bearer fixture-operator' };
const reviewer = { authorization: 'Bearer fixture-reviewer' };
let dir: string, app: FastifyInstance, upstream: number, downstream: number;
const graph = (): Graph => ({ ...createEmptyGraph(), nodes: [
        { id: 'start', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
        { id: 'up', type: 'http', label: 'Up', position: { x: 1, y: 0 }, config: { url: 'https://example.org', method: 'GET', credentialRef: 'fixture' } },
        { id: 'gate', type: 'approval', label: 'Review', position: { x: 2, y: 0 }, config: { reviewer: 'finance-queue', reason: 'Verify exact data' } },
        { id: 'down', type: 'set', label: 'Down', position: { x: 3, y: 0 }, config: { fields: { reviewed: true } } },
        { id: 'out', type: 'output', label: 'Out', position: { x: 4, y: 0 }, config: {} },
    ], edges: ['start', 'up', 'gate', 'down'].map((source, i) => ({ id: `edge${i}`, source, target: ['up', 'gate', 'down', 'out'][i]! })) });
function mount(overrides: Partial<WorkflowApprovalDependencies> = {}) {
    app = Fastify();
    registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: h => h === operator.authorization,
        store: createFileWorkflowWorkspaceStore(join(dir, 'workspace.json')),
        adaptersFor: () => ({ http: async () => { upstream++; return { original: 42 }; } }),
        approvals: { store: new WorkflowApprovalStore(join(dir, 'approvals')), ttlMs: 60000,
            resolveIdentity: async (req) => req.headers.authorization === reviewer.authorization ? { name: 'Bob Reviewer', active: true } : req.headers.authorization === operator.authorization ? { name: 'Alice Operator', active: true } : null,
            authorize: async (_identity, context) => context.projectId === 'project-one' && (!context.nodeId || context.reviewer === 'finance-queue'), ...overrides,
        } });
}
beforeEach(async () => { dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'approval-')); upstream = 0; downstream = 0; mount(); });
afterEach(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
async function pause(g = graph()) {
    const saved = await app.inject({ method: 'POST', url: base, headers: operator, payload: { graph: g } });
    expect(saved.statusCode).toBe(201);
    const draft = saved.json().draft;
    const response = await app.inject({ method: 'POST', url: `${base}/${draft.id}/runs`, headers: operator, payload: { revision: 1, input: { seed: 7 } } });
    expect(response.statusCode).toBe(201);
    return response.json().run;
}
async function review() { const list = await app.inject({ method: 'GET', url: queue, headers: reviewer }); expect(list.statusCode).toBe(200); const id = list.json().approvals[0].id; const response = await app.inject({ method: 'GET', url: `${queue}/${id}/review`, headers: reviewer }); expect(response.statusCode).toBe(200); return response.json().approval; }
function decision(a: any, extra = {}) { return app.inject({ method: 'POST', url: `${queue}/${a.id}/decisions`, headers: reviewer, payload: { approvalId: a.id, revision: a.revision, decision: 'approve', contextDigest: a.contextDigest, ...extra } }); }
it('mounts opt-in approval dependencies at the real server composition root', async () => {
    const { createServer } = await import('../index');
    await app.close();
    app = createServer({ operator: { actor: 'Alice Operator', token: 'fixture-operator-token-with-at-least-24-chars' }, workflowWorkspaceStore: createFileWorkflowWorkspaceStore(join(dir, 'workspace.json')), workflowApprovals: { store: new WorkflowApprovalStore(join(dir, 'approvals')), resolveIdentity: async (req) => req.headers.authorization === reviewer.authorization ? { name: 'Bob Reviewer', active: true } : null, authorize: async () => true } });
    const response = await app.inject({ method: 'GET', url: queue, headers: reviewer });
    expect(response.statusCode).toBe(200);
    expect(response.json().approvals).toEqual([]);
});
it('refuses a copied authenticated checkpoint under another approval identity', async () => {
    await pause();
    const a = await review();
    const { copyFile } = await import('node:fs/promises');
    const { randomUUID } = await import('node:crypto');
    const copied = randomUUID();
    await copyFile(join(dir, 'approvals', a.id + '.json'), join(dir, 'approvals', copied + '.json'));
    const response = await app.inject({ method: 'GET', url: `${queue}/${copied}/review`, headers: reviewer });
    expect(response.statusCode).toBe(503);
    expect(upstream).toBe(1);
});
it('does not advertise resumability when the trusted runtime is removed', async () => {
    const run = await pause();
    await app.close();
    app = Fastify();
    registerWorkflowWorkspaceRoutes(app, { actor: 'Alice Operator', authenticate: h => h === operator.authorization, store: createFileWorkflowWorkspaceStore(join(dir, 'workspace.json')) });
    const r = await app.inject({ method: 'GET', url: `${base}/${run.draftId}/runs/${run.id}`, headers: operator });
    expect(r.json().run.resumable).toBe(false);
    expect((await app.inject({ method: 'POST', url: `${queue}/11111111-1111-4111-8111-111111111111/decisions`, headers: operator, payload: {} })).statusCode).toBe(503);
});
it('rejects unknown body authority, stale hashes/revisions and self review without spending adapters', async () => {
    await pause();
    const a = await review();
    for (const extra of [{ actor: 'Bob Reviewer' }, { humanName: 'Bob Reviewer' }, { reviewer: 'Bob Reviewer' }, { checkpoint: {} }, { proof: {} }, { graph: graph() }, { approvalId: '11111111-1111-4111-8111-111111111111' }])
        expect((await decision(a, extra)).statusCode).toBe(400);
    expect((await decision(a, { revision: 2 })).statusCode).toBe(409);
    expect((await decision(a, { contextDigest: '0'.repeat(64) })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `${queue}/${a.id}/review`, headers: operator })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${queue}/${a.id}/decisions`, headers: operator, payload: { approvalId: a.id, revision: 1, decision: 'approve', contextDigest: a.contextDigest } })).statusCode).toBe(403);
    expect((await decision(a)).statusCode).toBe(200);
    expect(upstream).toBe(1);
});
it('rejects wrong project/queue and inactive or model principals before parsing or preview', async () => {
    await pause();
    const a = await review();
    expect((await app.inject({ method: 'GET', url: `${queue.replace('project-one', 'foreign')}/${a.id}/review`, headers: reviewer })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `${queue}/${a.id}/review?checkpoint=true`, headers: reviewer })).statusCode).toBe(404);
    for (const principal of [{ name: 'agent', active: true }, { name: 'Bob Reviewer', active: false }, { name: ' alice operator ', active: true }]) {
        await app.close();
        mount({ resolveIdentity: async () => principal });
        expect((await app.inject({ method: 'POST', url: `${queue}/${a.id}/decisions`, headers: { ...reviewer, 'content-type': 'application/json' }, payload: '{' })).statusCode).toBe(principal.active && principal.name !== 'agent' ? 400 : 403);
        if (principal.name.includes('alice'))
            expect((await app.inject({ method: 'GET', url: `${queue}/${a.id}/review`, headers: reviewer })).statusCode).toBe(403);
    }
    await app.close();
    mount({ authorize: async (_p, s) => !s.nodeId });
    expect((await app.inject({ method: 'GET', url: `${queue}/${a.id}/review`, headers: reviewer })).statusCode).toBe(403);
    expect(upstream).toBe(1);
});
it('records rejected and expired outcomes without downstream execution', async () => {
    const run = await pause();
    const a = await review();
    const rejected = await decision(a, { decision: 'reject' });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().run).toMatchObject({ state: 'blocked', resumable: false, result: { reason: 'Approval rejected' } });
    expect((await decision(a)).statusCode).toBe(409);
    await app.close();
    mount({ ttlMs: 1 });
    const second = await pause();
    const expired = await reviewByRun(second.id);
    await new Promise(r => setTimeout(r, 5));
    const response = await decision(expired);
    expect(response.statusCode).toBe(409);
    expect(response.json().run.result.reason).toBe('Approval expired');
    expect(upstream).toBe(2);
});
async function reviewByRun(runId: string) { const list = (await app.inject({ method: 'GET', url: queue, headers: reviewer })).json().approvals; const a = list.find((r: any) => r.runId === runId); return (await app.inject({ method: 'GET', url: `${queue}/${a.id}/review`, headers: reviewer })).json().approval; }
it('requires a fresh independent hash for each sequential gate', async () => {
    const g = graph();
    g.nodes.splice(4, 0, { id: 'gateTwo', type: 'approval', label: 'Second review', position: { x: 5, y: 0 }, config: { reviewer: 'finance-queue' } });
    g.edges = g.edges.filter(e => e.source !== 'down');
    g.edges.push({ id: 'e4', source: 'down', target: 'gateTwo' }, { id: 'e5', source: 'gateTwo', target: 'out' });
    const run = await pause(g);
    const a = await review();
    const r = await decision(a);
    expect(r.statusCode).toBe(200);
    expect(r.json().run.result.pendingNodeId).toBe('gateTwo');
    const second = await reviewByRun(run.id); // select pending, not consumed first
    const list = (await app.inject({ method: 'GET', url: queue, headers: reviewer })).json().approvals;
    const pending = list.find((r: any) => r.state === 'pending');
    const b = (await app.inject({ method: 'GET', url: `${queue}/${pending.id}/review`, headers: reviewer })).json().approval;
    expect(b.id).not.toBe(a.id);
    expect(b.contextDigest).not.toBe(a.contextDigest);
    expect((await decision(b, { contextDigest: a.contextDigest })).statusCode).toBe(409);
    expect((await decision(b)).json().run.state).toBe('completed');
    expect(upstream).toBe(1);
});
it('denies concurrent duplicate decisions and preserves payload-free public traces', async () => {
    await pause();
    const a = await review();
    const results = await Promise.all([decision(a), decision(a)]);
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const run = results.find(r => r.statusCode === 200)!.json().run;
    expect(run.result.trace.find((t: any) => t.nodeId === 'gate').humanName).toBe('Bob Reviewer');
    expect(run.result.trace.every((t: any) => !t.details || (!('input' in t.details) && !('output' in t.details)))).toBe(true);
    expect(JSON.stringify(run)).not.toContain('checkpoint');
    expect(upstream).toBe(1);
});
it('refuses checkpoint data tampering even when the graph and approval hash are unchanged', async () => {
    await pause();
    const a = await review();
    const fs = await import('node:fs/promises');
    const path = join(dir, 'approvals', a.id + '.json');
    const e = JSON.parse(await fs.readFile(path, 'utf8'));
    const r = JSON.parse(e.payload);
    r.checkpoint.values.find((v: any) => v[0] === 'up')[1] = { original: 900 };
    e.payload = JSON.stringify(r);
    await fs.writeFile(path, JSON.stringify(e));
    expect((await decision(a)).statusCode).toBe(503);
    expect(upstream).toBe(1);
});
it('detects exact run changes during asynchronous exact-gate authorization', async () => {
    const run = await pause();
    const a = await review();
    await app.close();
    mount({ authorize: async (_identity, s) => { if (s.nodeId && s.action === 'decide') {
            const fs = await import('node:fs/promises');
            const path = join(dir, 'workspace.json');
            const data = JSON.parse(await fs.readFile(path, 'utf8'));
            data.runs[0].initiatedBy = 'Changed Initiator';
            await fs.writeFile(path, JSON.stringify(data));
        } return true; } });
    expect((await decision(a)).statusCode).toBe(409);
    expect(upstream).toBe(1);
});
it('reports an approved-but-unclaimed crash as interrupted and never retries execution', async () => {
    await pause();
    const a = await review();
    const store = new WorkflowApprovalStore(join(dir, 'approvals'));
    const r = await store.read(a.id);
    await store.write({ ...r, revision: 2, state: 'approved', decisionBy: 'Bob Reviewer', decidedAt: new Date().toISOString() });
    await app.close();
    mount();
    const current = (await app.inject({ method: 'GET', url: `${queue}/${a.id}/review`, headers: reviewer })).json().approval;
    expect(current.state).toBe('interrupted');
    const live = (await app.inject({ method: 'GET', url: `${base}/${r.run.draftId}/runs/${r.run.id}`, headers: operator })).json().run;
    expect(live.resumable).toBe(false);
    expect((await decision({ ...a, revision: 2 })).statusCode).toBe(409);
    expect(upstream).toBe(1);
});
it('blocks new revision execution while a durable original approval remains pending', async () => {
    const run = await pause();
    const changed = graph();
    changed.name = 'Next revision';
    const edit = await app.inject({ method: 'PUT', url: `${base}/${run.draftId}`, headers: operator, payload: { graph: changed, expectedRevision: 1 } });
    expect(edit.statusCode).toBe(200);
    const r = await app.inject({ method: 'POST', url: `${base}/${run.draftId}/runs`, headers: operator, payload: { revision: 2, input: {} } });
    expect(r.statusCode).toBe(409);
    expect(upstream).toBe(1);
});
it('writes version two durable state while preserving legacy version one reads', async () => {
    await pause();
    const fs = await import('node:fs/promises');
    const data = JSON.parse(await fs.readFile(join(dir, 'workspace.json'), 'utf8'));
    expect(data.version).toBe(2);
});
it('keys permanent claims by original run, gate and reviewed digest rather than journal filename', async () => {
    await pause();
    const a = await review();
    const store = new WorkflowApprovalStore(join(dir, 'approvals'));
    const r = await store.read(a.id);
    const { randomUUID } = await import('node:crypto');
    const duplicate = { ...r, id: randomUUID() };
    await store.write(duplicate);
    await store.claim(a.id);
    await expect(store.claim(duplicate.id)).rejects.toMatchObject({ statusCode: 409 });
});
it('does not regenerate a lost private integrity key over existing authenticated journals', async () => {
    await pause();
    const fs = await import('node:fs/promises');
    const key = join(dir, 'approvals', '.integrity-key');
    await fs.unlink(key);
    expect((await app.inject({ method: 'GET', url: queue, headers: reviewer })).statusCode).toBe(503);
    await expect(fs.stat(key)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(upstream).toBe(1);
});
it('returns not found for unknown identities and unavailable for malformed private envelopes', async () => {
    const unknown='11111111-1111-4111-8111-111111111111';
    expect((await app.inject({method:'GET',url:`${queue}/${unknown}/review`,headers:reviewer})).statusCode).toBe(404);
    await pause();const a=await review();const fs=await import('node:fs/promises');await fs.writeFile(join(dir,'approvals',a.id+'.json'),JSON.stringify({payload:{invalid:true},mac:'0'.repeat(64)}));
    expect((await app.inject({method:'GET',url:`${queue}/${a.id}/review`,headers:reviewer})).statusCode).toBe(503);expect(upstream).toBe(1);
});
it('CAS binds nested object order as well as the legacy sorted graph digest', async () => {
    const g=graph();g.nodes.find(n=>n.id==='down')!.config={fields:{payload:{first:1,second:2}}};const run=await pause(g);
    const fs=await import('node:fs/promises');const path=join(dir,'workspace.json');const data=JSON.parse(await fs.readFile(path,'utf8'));data.runs[0].graphSnapshot.nodes.find((n:any)=>n.id==='down').config.fields.payload={second:2,first:1};await fs.writeFile(path,JSON.stringify(data));
    const store=createFileWorkflowWorkspaceStore(path);await expect(store.beginResume!('project-one',run.draftId,run.id,run)).rejects.toMatchObject({statusCode:409});expect(upstream).toBe(1);
});
it('durably restores exact original state after reconstruction without upstream replay', async () => {
    const run = await pause();
    expect(run.state).toBe('paused');
    expect(run.resumable).toBe(true);
    expect(upstream).toBe(1);
    await app.close();
    mount();
    const a = await review();
    expect(a.context.pendingData).toEqual({ original: 42 });
    expect(a.context.runId).toBe(run.id);
    const response = await decision(a);
    expect(response.statusCode).toBe(200);
    expect(response.json().run.result.output).toEqual({ original: 42, reviewed: true });
    expect(upstream).toBe(1);
    await app.close();
    mount();
    const read = await app.inject({ method: 'GET', url: `${base}/${run.draftId}/runs/${run.id}`, headers: operator });
    expect(read.json().run.state).toBe('completed');
    expect(read.json().run.result.output).toEqual({ original: 42, reviewed: true });
    expect((await decision(a)).statusCode).toBe(409);
});
