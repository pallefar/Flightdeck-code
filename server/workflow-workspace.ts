import { admissionRefused, type RequestAdmission, type AdmissionPermit } from './request-admission';
import type { FastifyInstance, FastifyReply, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { registerWorkflowApprovalRoutes, approvalTtl, type WorkflowApprovalDependencies } from './workflow-approval';
import type { WorkflowCheckpoint } from '../packages/workflow/checkpoint';
import { createWorkflowRunner, type ExecutionAdapters, type RunResult } from '../packages/workflow/engine';
import { jsonValue, type Json } from '../packages/workflow/graph';
import { preservesWorkflowSteps } from '../packages/workflow/preservation';
import {
  projectIdSchema, workspaceGraphSchema, workspaceInputSchema, safeWorkspaceValue, MAX_INPUT_BYTES,
  WorkspaceError, type WorkflowWorkspaceStore, type WorkflowRun,
} from './workflow-workspace-store';

export interface WorkflowWorkspaceDependencies {
  admission?: RequestAdmission;
  approvals?: WorkflowApprovalDependencies;
  actor: string;
  authenticate: (authorization: string | undefined) => boolean;
  store: WorkflowWorkspaceStore;
  adaptersFor?: (context: { actor: string; projectId: string }) => ExecutionAdapters;
}
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const identity = z.object({ projectId: projectIdSchema, draftId: z.string().uuid(), runId: z.string().uuid().optional() }).strict();
const knownReasons = new Set([
  'HTTP adapter unconfigured', 'LLM adapter unconfigured', 'HTTP URL and credential reference required',
  'LLM instruction unconfigured', 'Human reviewer unconfigured', 'Condition field/value unconfigured',
  'Set fields requires object input', 'Step limit exceeded', 'Data size limit exceeded', 'Unsafe or oversized seed',
  'Execution requires one manual root, connected nodes and an output', 'Output nodes must be terminal',
  'Workflow path would bypass required human approval',
  'Multiple active inputs unsupported in v1; add an explicit merge adapter in a future version',
  'Adapter timed out; side effects may already have occurred',
]);
function sanitizedResult(result: RunResult): RunResult {
  const reason = (text: string) => knownReasons.has(text) ? text : 'Execution blocked';
  const trace = result.trace.map(({ nodeId, status, message, details, humanName }) => ({ nodeId, status, ...(humanName === undefined ? {} : { humanName }), ...(message === undefined ? {} : { message: reason(message) }), ...(details === undefined ? {} : { details: { durationMs: details.durationMs, ...(details.selectedPort === undefined ? {} : { selectedPort: details.selectedPort }), ...(details.errorCode === undefined ? {} : { errorCode: details.errorCode }) } }) }));
  if (!safeWorkspaceValue(result.output, MAX_INPUT_BYTES)) return { status: 'blocked', output: null, trace, reason: 'Unsafe or oversized output' };
  return { status: result.status, output: result.output, trace, ...(result.pendingNodeId === undefined ? {} : { pendingNodeId: result.pendingNodeId }), ...(result.reason === undefined ? {} : { reason: reason(result.reason) }) };
}
function failure(error: unknown, reply: FastifyReply) {
  const status = error instanceof WorkspaceError ? error.statusCode : 503;
  return reply.code(status).send({ error: status === 404 ? 'not found' : status === 409 ? 'revision, approval or execution conflict' : status === 413 ? 'workspace limit exceeded' : 'workspace unavailable' });
}
/** Explicit registration seam: local injected actor/authentication, not host project authorization. */
export function registerWorkflowWorkspaceRoutes(app: FastifyInstance, deps: WorkflowWorkspaceDependencies): void {
  if (!z.string().trim().min(1).max(200).safeParse(deps.actor).success) throw new Error('workspace actor required');
  if (deps.approvals) { approvalTtl(deps.approvals); if (!deps.store.beginResume) throw new Error('durable approval CAS store required'); }
  function checkedAdapters(actor: string, projectId: string, permit?: AdmissionPermit): ExecutionAdapters {
    const injected = deps.adaptersFor?.({ actor, projectId }) ?? {};
          const checked = (value: Json): Json => {
            if (!safeWorkspaceValue(value, MAX_INPUT_BYTES)) throw new Error('Unsafe or oversized adapter output');
            return jsonValue.parse(value);
          };
    return {
            ...(injected.resource ? { resource: async (request: Parameters<NonNullable<ExecutionAdapters['resource']>>[0]) => checked(await (permit ? permit.track(signal => injected.resource!({ ...request, signal }), request.signal) : injected.resource!(request))) } : {}),
            ...(injected.http ? { http: async (request: Parameters<NonNullable<ExecutionAdapters['http']>>[0]) => checked(await (permit ? permit.track(signal => injected.http!({ ...request, signal }), request.signal) : injected.http!(request))) } : {}),
            ...(injected.llm ? { llm: async (request: Parameters<NonNullable<ExecutionAdapters['llm']>>[0]) => checked(await (permit ? permit.track(signal => injected.llm!({ ...request, signal }), request.signal) : injected.llm!(request))) } : {}),
          };
  }
  registerWorkflowApprovalRoutes(app, { ...(deps.admission ? { admission: deps.admission } : {}), ...(deps.approvals ? { approvals: deps.approvals } : {}), store: deps.store, authenticate: deps.authenticate, adaptersFor: (run, permit) => checkedAdapters(run.initiatedBy, run.projectId, permit), sanitize: sanitizedResult });
  async function publicRun(run: WorkflowRun): Promise<WorkflowRun> {
    if (!run.resumable) return run;
    if (deps.approvals) {
      const matching = (await deps.approvals.store.list()).filter(r => r.run.id === run.id && r.checkpoint.pending.nodeId === run.result?.pendingNodeId && r.state === 'pending');
      if (matching.length === 1 && Date.parse(matching[0]!.expiresAt) > Date.now() && !await deps.approvals.store.claimed(matching[0]!.id)) return run;
    }
    return { ...run, resumable: false, pauseDisposition: 'unavailable-no-resume' };
  }
  const base = '/api/studio/workspaces/:projectId/workflows';
  const options: RouteShorthandOptions = {
    bodyLimit: 300_000,
    // Authentication must precede JSON parsing, framework body limits and every lookup.
    onRequest: async (request, reply) => {
      let authenticated = false;
      try { authenticated = deps.authenticate(request.headers.authorization); } catch { /* fail closed */ }
      if (!authenticated) return reply.code(401).send({ error: 'authentication required' });
    },
    errorHandler: (error, _request, reply) => {
      const status = error.statusCode === 413 ? 413 : error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? 400 : 503;
      return reply.code(status).send({ error: status === 413 ? 'request limit exceeded' : status === 400 ? 'malformed request' : 'workspace unavailable' });
    },
  };
  const malformed = (reply: FastifyReply) => reply.code(400).send({ error: 'malformed request' });
  app.get<{ Params: { projectId: string } }>(base, options, async (request, reply) => {
    if (!projectIdSchema.safeParse(request.params.projectId).success) return malformed(reply);
    try { return { drafts: (await deps.store.list(request.params.projectId)).map(({ graph, ...draft }) => ({ ...draft, name: graph.name })) }; }
    catch (error) { return failure(error, reply); }
  });
  app.post<{ Params: { projectId: string } }>(base, options, async (request, reply) => {
    const body = z.object({ graph: workspaceGraphSchema }).strict().safeParse(request.body);
    if (!projectIdSchema.safeParse(request.params.projectId).success || !body.success) return malformed(reply);
    try { return reply.code(201).send({ draft: await deps.store.create(request.params.projectId, body.data.graph, deps.actor) }); }
    catch (error) { return failure(error, reply); }
  });
  app.get<{ Params: { projectId: string; draftId: string } }>(`${base}/:draftId`, options, async (request, reply) => {
    if (!identity.safeParse(request.params).success) return malformed(reply);
    try {
      const draft = await deps.store.get(request.params.projectId, request.params.draftId);
      return draft ? { draft } : reply.code(404).send({ error: 'not found' });
    } catch (error) { return failure(error, reply); }
  });
  app.put<{ Params: { projectId: string; draftId: string } }>(`${base}/:draftId`, options, async (request, reply) => {
    const body = z.object({ graph: workspaceGraphSchema, expectedRevision: revision }).strict().safeParse(request.body);
    if (!identity.safeParse(request.params).success || !body.success) return malformed(reply);
    try { return { draft: await deps.store.update(request.params.projectId, request.params.draftId, body.data.graph, body.data.expectedRevision, deps.actor) }; }
    catch (error) { return failure(error, reply); }
  });
  app.post<{ Params: { projectId: string; draftId: string } }>(`${base}/:draftId/runs`, options, async (request, reply) => {
    const body = z.object({ revision, input: workspaceInputSchema }).strict().safeParse(request.body);
    if (!identity.safeParse(request.params).success || !body.success) return malformed(reply);
    const permit = deps.admission?.acquire(deps.actor, request.params.projectId, request);
    if (deps.admission && !permit) return admissionRefused(reply);
    try {
      const { projectId, draftId } = request.params;
      // Durable CAS reservation/readback happens BEFORE acquiring or spending adapters.
      const run = await deps.store.reserveRun(projectId, draftId, body.data.revision, body.data.input, deps.actor);
      let result: RunResult;
      let checkpoint: WorkflowCheckpoint | undefined;
      try {
        const graph = run.graphSnapshot;
        if (!preservesWorkflowSteps(graph, [], graph.nodes.filter(n => n.type === 'approval').map(n => n.id))) {
          result = { status: 'blocked', output: null, trace: [], reason: 'Execution requires a connected graph with unavoidable approval gates' };
        } else {
          const adapters = checkedAdapters(deps.actor, projectId, permit);
          // No authorizeHuman capability is exposed by this local slice.
          const runner = createWorkflowRunner(graph, adapters, { initiator: deps.actor, maxDataBytes: MAX_INPUT_BYTES, captureData: false });
          result = await runner.run(run.input);
          if (result.status === 'paused' && deps.approvals) checkpoint = runner.checkpoint(result);
        }
      } catch { result = { status: 'blocked', output: null, trace: [], reason: 'Execution blocked' }; }
      const finished = await deps.store.finishRun(projectId, draftId, run.id, sanitizedResult(result), !!checkpoint);
      if (checkpoint && deps.approvals) await deps.approvals.store.create(finished, checkpoint, approvalTtl(deps.approvals));
      return reply.code(201).send({ run: finished });
    } catch (error) { return failure(error, reply); }
    finally { void permit?.release(); }
  });
  app.get<{ Params: { projectId: string; draftId: string } }>(`${base}/:draftId/runs`, options, async (request, reply) => {
    if (!identity.safeParse(request.params).success) return malformed(reply);
    try { return { runs: await Promise.all((await deps.store.listRuns(request.params.projectId, request.params.draftId)).map(publicRun)) }; }
    catch (error) { return failure(error, reply); }
  });
  app.get<{ Params: { projectId: string; draftId: string; runId: string } }>(`${base}/:draftId/runs/:runId`, options, async (request, reply) => {
    if (!identity.safeParse(request.params).success) return malformed(reply);
    try {
      const run = await deps.store.getRun(request.params.projectId, request.params.draftId, request.params.runId);
      return run ? { run: await publicRun(run) } : reply.code(404).send({ error: 'not found' });
    } catch (error) { return failure(error, reply); }
  });
}
