import type { FastifyInstance, FastifyRequest, FastifyReply, RouteShorthandOptions } from 'fastify';
import { admissionRefused, type RequestAdmission, type AdmissionPermit } from './request-admission';
import { z } from 'zod';
import { createWorkflowRunner, type ExecutionAdapters, type RunResult } from '../packages/workflow/engine';
import { canonicalWorkflowValue } from '../packages/workflow/checkpoint';
import { resolveNode } from '../packages/workflow/graph';
import { isNamedHuman } from '../packages/guardrails/src/approval-pure';
import { projectIdSchema, WorkspaceError, type WorkflowWorkspaceStore, type WorkflowRun } from './workflow-workspace-store';
import { WorkflowApprovalStore, approvalContext, type ApprovalRecord } from './workflow-approval-store';
export interface WorkflowApprovalSummary {
    id: string;
    revision: number;
    runId: string;
    projectId: string;
    draftId: string;
    draftRevision: number;
    nodeId: string;
    state: 'pending' | 'interrupted' | 'consumed' | 'rejected' | 'expired';
    contextDigest: string;
    createdAt: string;
    expiresAt: string;
    decisionBy?: string;
    decidedAt?: string;
}
export type WorkflowApprovalReview = WorkflowApprovalSummary & {
    context: ReturnType<typeof approvalContext>;
};
export interface WorkflowApprovalDecision {
    approvalId: string;
    revision: number;
    decision: 'approve' | 'reject';
    contextDigest: string;
}
export interface WorkflowReviewerIdentity {
    name: string;
    active: boolean;
}
export interface WorkflowApprovalScope {
    projectId: string;
    action: 'list' | 'review' | 'decide';
    nodeId?: string;
    reviewer?: string;
    runId?: string;
}
/** These callbacks belong to a trusted server identity provider/policy, never a request body or model. */
export interface WorkflowApprovalDependencies {
    store: WorkflowApprovalStore;
    resolveIdentity: (request: FastifyRequest) => Promise<WorkflowReviewerIdentity | null>;
    authorize: (identity: WorkflowReviewerIdentity, scope: WorkflowApprovalScope) => Promise<boolean>;
    ttlMs?: number;
}
export function approvalTtl(deps: WorkflowApprovalDependencies) { const ttl = deps.ttlMs ?? 900000; if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400000)
    throw new Error('invalid approval TTL'); return ttl; }
export function registerWorkflowApprovalRoutes(app: FastifyInstance, deps: {
    admission?: RequestAdmission;
    approvals?: WorkflowApprovalDependencies;
    store: WorkflowWorkspaceStore;
    authenticate: (header: string | undefined) => boolean;
    adaptersFor: (run: WorkflowRun, permit?: AdmissionPermit) => ExecutionAdapters;
    sanitize: (result: RunResult) => RunResult;
}) {
    const base = '/api/studio/workspaces/:projectId/approvals';
    const identities = new WeakMap<FastifyRequest, WorkflowReviewerIdentity>();
    const fail = (reply: FastifyReply, status: number) => reply.code(status).send({ error: status === 401 ? 'authentication required' : status === 403 ? 'review authority refused' : status === 404 ? 'not found' : status === 409 ? 'approval conflict' : status === 400 ? 'malformed request' : 'approval runtime unavailable' });
    const options: RouteShorthandOptions = { bodyLimit: 4096, onRequest: async (req, reply) => {
            const runtime = deps.approvals;
            if (!runtime) {
                if (!deps.authenticate(req.headers.authorization))
                    return fail(reply, 401);
                return fail(reply, 503);
            }
            let principal: WorkflowReviewerIdentity | null = null;
            try {
                principal = await runtime.resolveIdentity(req);
            }
            catch {
                return fail(reply, 403);
            }
            if (!principal)
                return fail(reply, 401);
            if (!principal.active || !isNamedHuman(principal.name))
                return fail(reply, 403);
            const p = projectIdSchema.safeParse((req.params as {
                projectId: string;
            }).projectId);
            if (!p.success)
                return fail(reply, 400);
            const action = req.method === 'POST' ? 'decide' : req.url.split('?')[0]?.endsWith('/review') ? 'review' : 'list';
            try {
                if (!await runtime.authorize(principal, { projectId: p.data, action }))
                    return fail(reply, 403);
            }
            catch {
                return fail(reply, 403);
            }
            identities.set(req, { ...principal });
        }, errorHandler: (error, _req, reply) => fail(reply, error.statusCode === 413 ? 413 : 400) };
    function parse(req: FastifyRequest) {
        if (Object.keys(req.query as object).length)
            throw new WorkspaceError(404);
        return z.object({ projectId: projectIdSchema, approvalId: z.string().uuid().optional() }).strict().parse(req.params);
    }
    async function authorized(req: FastifyRequest, r: ApprovalRecord, action: 'review' | 'decide') {
        const runtime = deps.approvals!, p = identities.get(req)!;
        if (r.run.projectId !== (req.params as {
            projectId: string;
        }).projectId)
            throw new WorkspaceError(404);
        const node = r.run.graphSnapshot.nodes.find(n => n.id === r.checkpoint.pending.nodeId)!;
        const reviewer = resolveNode(r.run.graphSnapshot, node).config.reviewer as string;
        if (p.name.trim().toLowerCase() === r.run.initiatedBy.trim().toLowerCase())
            return false;
        const allowed = await runtime.authorize(p, { projectId: r.run.projectId, nodeId: node.id, reviewer, runId: r.run.id, action });
        const now = await runtime.resolveIdentity(req);
        return allowed && !!now && now.active && isNamedHuman(now.name) && now.name === p.name;
    }
    async function dto(r: ApprovalRecord, includeContext = false) {
        const claimed = await deps.approvals!.store.claimed(r.id);
        const state = r.state === 'consumed' || r.state === 'rejected' || r.state === 'expired' ? r.state : claimed || r.state === 'approved' ? 'interrupted' : Date.parse(r.expiresAt) <= Date.now() ? 'expired' : r.state;
        return { id: r.id, revision: r.revision, runId: r.run.id, projectId: r.run.projectId, draftId: r.run.draftId, draftRevision: r.run.draftRevision, nodeId: r.checkpoint.pending.nodeId, state, contextDigest: r.contextDigest, createdAt: r.createdAt, expiresAt: r.expiresAt, ...(r.decisionBy ? { decisionBy: r.decisionBy, decidedAt: r.decidedAt } : {}), ...(includeContext ? { context: r.context } : {}) };
    }
    const failure = (error: unknown, reply: FastifyReply) => fail(reply, error instanceof WorkspaceError ? error.statusCode : error instanceof z.ZodError ? 400 : 503);
    app.get(base, options, async (req, reply) => { try {
        const { projectId } = parse(req);
        const records = (await deps.approvals!.store.list()).filter(r => r.run.projectId === projectId);
        return { approvals: await Promise.all(records.map(r => dto(r))) };
    }
    catch (e) {
        return failure(e, reply);
    } });
    app.get(`${base}/:approvalId/review`, options, async (req, reply) => {
        try {
            const { approvalId } = parse(req);
            const r = await deps.approvals!.store.read(approvalId!);
            if (!await authorized(req, r, 'review'))
                return fail(reply, 403);
            const current = await deps.approvals!.store.read(r.id);
            if (canonicalWorkflowValue(current) !== canonicalWorkflowValue(r))
                return fail(reply, 409);
            return { approval: await dto(r, true) };
        }
        catch (e) {
            return failure(e, reply);
        }
    });
    app.post(`${base}/:approvalId/decisions`, options, async (req, reply) => {
        let permit: AdmissionPermit | undefined;
        try {
            const { approvalId } = parse(req);
            const body = z.object({ approvalId: z.string().uuid(), revision: z.number().int().positive(), decision: z.enum(['approve', 'reject']), contextDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
            if (body.approvalId !== approvalId)
                return fail(reply, 400);
            permit = deps.admission?.acquire(identities.get(req)!.name.trim().toLowerCase(), (req.params as { projectId: string }).projectId, req);
            if (deps.admission && !permit) return admissionRefused(reply);
            const runtime = deps.approvals!;
            return await runtime.store.locked(approvalId!, async () => {
                const r = await runtime.store.read(approvalId!);
                if (r.revision !== body.revision || r.contextDigest !== body.contextDigest || r.state !== 'pending' || await runtime.store.claimed(r.id))
                    return fail(reply, 409);
                if (!await authorized(req, r, 'decide'))
                    return fail(reply, 403);
                const after = await runtime.store.read(r.id);
                if (canonicalWorkflowValue(after) !== canonicalWorkflowValue(r))
                    return fail(reply, 409);
                const live = await deps.store.getRun(r.run.projectId, r.run.draftId, r.run.id);
                if (!live || canonicalWorkflowValue(live) !== canonicalWorkflowValue(r.run))
                    return fail(reply, 409);
                const expired = Date.parse(r.expiresAt) <= Date.now();
                const next: ApprovalRecord = { ...r, revision: r.revision + 1, state: expired ? 'expired' : body.decision === 'reject' ? 'rejected' : 'approved', decisionBy: identities.get(req)!.name, decidedAt: new Date().toISOString() };
                // Decision write, permanent reservation, run CAS, restored execution: never reverse this order.
                await runtime.store.write(next);
                await runtime.store.claim(r.id);
                if (!deps.store.beginResume)
                    throw new WorkspaceError(503);
                await deps.store.beginResume(r.run.projectId, r.run.draftId, r.run.id, r.run);
                if (expired || body.decision === 'reject') {
                    const trace: RunResult['trace'] = r.run.result!.trace.filter(t => t.nodeId !== r.checkpoint.pending.nodeId).map(t => ({ nodeId: t.nodeId, status: t.status, ...(t.message === undefined ? {} : { message: t.message }), ...(t.humanName === undefined ? {} : { humanName: t.humanName }) }));
                    const run = await deps.store.finishRun(r.run.projectId, r.run.draftId, r.run.id, { status: 'blocked', output: null, trace, reason: expired ? 'Approval expired' : 'Approval rejected' });
                    return reply.code(expired ? 409 : 200).send({ approval: await dto(next), run });
                }
                const proof = {};
                const runner = createWorkflowRunner(r.run.graphSnapshot, { ...deps.adaptersFor(r.run, permit), authorizeHuman: async (auth, context) => auth.proof === proof && auth.humanName === next.decisionBy && context.nodeId === r.checkpoint.pending.nodeId && context.initiator === r.run.initiatedBy }, { initiator: r.run.initiatedBy, maxDataBytes: 100000, captureData: false });
                const paused = runner.restore(r.checkpoint);
                const result = await runner.resume(paused, { humanName: next.decisionBy!, proof });
                const run = await deps.store.finishRun(r.run.projectId, r.run.draftId, r.run.id, deps.sanitize(result), result.status === 'paused');
                if (result.status === 'paused')
                    await runtime.store.create(run, runner.checkpoint(result), approvalTtl(runtime));
                const done: ApprovalRecord = { ...next, state: 'consumed' };
                await runtime.store.write(done);
                return { approval: await dto(done), run };
            });
        }
        catch (e) {
            return failure(e, reply);
        }
        finally { void permit?.release(); }
    });
}
