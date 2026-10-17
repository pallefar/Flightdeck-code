import type { FastifyInstance, FastifyReply, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import {
  actorSchema, boundedSubappSchema, draftIdSchema, MAX_SUBAPP_SNAPSHOT_BYTES,
  projectIdSchema, revisionSchema, snapshotSchema,
} from '../packages/subapp-workspace/schema';
import { SubappWorkspaceError, type SubappWorkspaceStore } from './subapp-workspace-store';

export interface SubappWorkspaceDependencies {
  actor: string;
  authenticate: (authorization: string | undefined) => boolean;
  store: SubappWorkspaceStore;
}
// Fastify's router owns these shallow objects and gives them a custom null-based
// prototype. Only schema-known scalar strings are read; snapshots remain native-JSON-only.
const collectionIdentity = z.object({ projectId: projectIdSchema }).strict();
const documentIdentity = z.object({ projectId: projectIdSchema, draftId: draftIdSchema }).strict();
const createBody = boundedSubappSchema(z.object({ snapshot: snapshotSchema }).strict(), MAX_SUBAPP_SNAPSHOT_BYTES + 1_024);
const updateBody = boundedSubappSchema(z.object({ snapshot: snapshotSchema, expectedRevision: revisionSchema }).strict(), MAX_SUBAPP_SNAPSHOT_BYTES + 1_024);
const emptyQuery = boundedSubappSchema(z.object({}).strict(), 2);
const malformed = (reply: FastifyReply) => reply.code(400).send({ error: 'malformed request' });
function failure(error: unknown, reply: FastifyReply) {
  const status = error instanceof SubappWorkspaceError ? error.statusCode : 503;
  return reply.code(status).send({ error: status === 400 ? 'malformed request' : status === 404 ? 'not found' : status === 409 ? 'revision or baseline conflict' : status === 413 ? 'workspace limit exceeded' : 'workspace unavailable' });
}

/** Private draft-source authoring only. Injected project partitions are NOT host authorization.
 * No source evaluation, generated-file application, model, shell, run or deployment seam exists.
 */
export function registerSubappWorkspaceRoutes(app: FastifyInstance, deps: SubappWorkspaceDependencies): void {
  const checkedActor = actorSchema.safeParse(deps.actor);
  if (!checkedActor.success || typeof deps.authenticate !== 'function') throw new Error('sub-app workspace configuration required');
  const actor = checkedActor.data; const authenticate = deps.authenticate; const store = deps.store;
  const options: RouteShorthandOptions = {
    bodyLimit: MAX_SUBAPP_SNAPSHOT_BYTES + 1_024,
    logLevel: 'silent',
    onRequest: async (request, reply) => {
      reply.header('cache-control', 'no-store');
      let authenticated = false;
      try { authenticated = authenticate(request.headers.authorization) === true; } catch { /* deny */ }
      if (!authenticated) return reply.code(401).send({ error: 'authentication required' });
      // Fastify skips body parsing (and bodyLimit) for GET/HEAD, so inspect wire framing.
      if ((request.method === 'GET' || request.method === 'HEAD') &&
          (Number(request.headers['content-length']) > 0 || request.headers['transfer-encoding'] !== undefined)) return malformed(reply);
    },
    errorHandler: (error, _request, reply) => {
      reply.header('cache-control', 'no-store');
      const status = error.statusCode === 413 ? 413 : error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? 400 : 503;
      return reply.code(status).send({ error: status === 413 ? 'request limit exceeded' : status === 400 ? 'malformed request' : 'workspace unavailable' });
    },
  };
  const base = '/api/studio/workspaces/:projectId/subapps';
  app.get(base, options, async (request, reply) => {
    const params = collectionIdentity.safeParse(request.params);
    if (!params.success || !emptyQuery.safeParse(request.query).success || request.body !== undefined) return malformed(reply);
    try { return { drafts: await store.list(params.data.projectId) }; } catch (error) { return failure(error, reply); }
  });
  app.post(base, options, async (request, reply) => {
    const params = collectionIdentity.safeParse(request.params); const body = createBody.safeParse(request.body);
    if (!params.success || !body.success || !emptyQuery.safeParse(request.query).success) return malformed(reply);
    try { return reply.code(201).send({ draft: await store.create(params.data.projectId, body.data.snapshot, actor) }); }
    catch (error) { return failure(error, reply); }
  });
  app.get(`${base}/:draftId`, options, async (request, reply) => {
    const params = documentIdentity.safeParse(request.params);
    if (!params.success || !emptyQuery.safeParse(request.query).success || request.body !== undefined) return malformed(reply);
    try {
      const draft = await store.get(params.data.projectId, params.data.draftId);
      return draft ? { draft } : reply.code(404).send({ error: 'not found' });
    } catch (error) { return failure(error, reply); }
  });
  app.put(`${base}/:draftId`, options, async (request, reply) => {
    const params = documentIdentity.safeParse(request.params); const body = updateBody.safeParse(request.body);
    if (!params.success || !body.success || !emptyQuery.safeParse(request.query).success) return malformed(reply);
    try { return { draft: await store.update(params.data.projectId, params.data.draftId, body.data.snapshot, body.data.expectedRevision, actor) }; }
    catch (error) { return failure(error, reply); }
  });
}
