import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { request as httpRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { draftSchema, workspaceGraphSchema } from '../../server/workflow-workspace-store';
import { AUDIENCE, BridgeError, MAX_BODY_BYTES, type Binding, type HostAuthority, type WireRequest } from './authority';
import type { DraftService } from './draft-store';

const MAX_RPC = 1_000_000;
const opaque = z.string().regex(/^[a-f0-9]{64}$/);
const wireSchema = z.object({ method: z.string().max(8), path: z.string().max(300), body: z.string().max(360_000) }).strict();
const bindingSchema = z.object({ actorId: z.string().min(1).max(200), workspaceId: z.string().max(64), projectId: z.string().max(64), draftId: z.string().uuid().optional(), action: z.enum(['draft.list', 'draft.read', 'draft.create', 'draft.update']), sessionVersion: z.string().min(1).max(200), authorityVersion: z.string().min(1).max(200), policyRevision: z.string().min(1).max(200), method: z.string().max(8), path: z.string().max(300), bodyDigest: z.string().regex(/^[a-f0-9]{64}$/), audience: z.literal(AUDIENCE), expiresAt: z.number().int() }).strict().transform(({ draftId, ...rest }) => ({ ...rest, ...(draftId === undefined ? {} : { draftId }) }));
const resultSchema = z.object({ workspaceId: z.string().max(64), projectId: z.string().max(64), draft: draftSchema.optional(), drafts: z.array(draftSchema).max(128).optional() }).strict();
type PeerPath = '/private/studio-authority/consume' | '/private/studio-authority/check' | '/private/studio-drafts/invoke';
export function loopbackOrigin(value: string): string {
  let url: URL; try { url = new URL(value); } catch { throw new BridgeError(503); }
  if (url.origin !== value || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw new BridgeError(503);
  return value;
}
function peerKey(key: string) { if (!/^[a-zA-Z0-9_-]{32,200}$/.test(key)) throw new BridgeError(503); return Buffer.from(key); }
function failure(reply: FastifyReply, error: unknown) {
  const status = error instanceof BridgeError ? error.status : 503;
  return reply.header('cache-control', 'no-store').code(status).send({ error: status === 401 ? 'authentication required' : status === 403 ? 'bridge forbidden' : status === 404 ? 'not found' : status === 409 ? 'draft conflict' : status === 400 ? 'malformed request' : status === 413 ? 'request limit exceeded' : 'bridge unavailable' });
}
function appBase() {
  const app = Fastify({ logger: false, bodyLimit: MAX_RPC, requestTimeout: 5000, connectionTimeout: 5000, keepAliveTimeout: 1000, routerOptions: { maxParamLength: 400 }, exposeHeadRoutes: false });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: MAX_RPC }, (_request, body, done) => done(null, body));
  app.setErrorHandler((error, _req, reply) => { const parsed = z.object({ statusCode: z.number().optional() }).safeParse(error); const status = parsed.success ? parsed.data.statusCode : undefined; return failure(reply, new BridgeError(status === 413 ? 413 : status && status < 500 ? 400 : 503)); });
  app.setNotFoundHandler((_req, reply) => failure(reply, new BridgeError(404)));
  app.addHook('onSend', async (_req, reply, payload) => { reply.header('cache-control', 'no-store'); reply.header('x-content-type-options', 'nosniff'); return payload; });
  return app;
}
function wireOut(wire: WireRequest) { return { method: wire.method, path: wire.path, body: wire.body.toString('base64') }; }
function wireIn(value: unknown): WireRequest {
  const w = wireSchema.parse(value); const body = Buffer.from(w.body, 'base64');
  if (body.toString('base64') !== w.body || body.length > MAX_BODY_BYTES) throw new BridgeError(400);
  return { ...w, body };
}
function jsonBody(req: FastifyRequest): unknown {
  if (req.headers['content-type'] !== 'application/json' || !Buffer.isBuffer(req.body)) throw new BridgeError(400);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(req.body)); } catch { throw new BridgeError(400); }
}
function authenticatePeer(req: FastifyRequest, expected: Buffer) {
  const input = req.headers['x-studio-peer'];
  if (typeof input !== 'string' || Buffer.byteLength(input) !== expected.length || !timingSafeEqual(Buffer.from(input), expected)) throw new BridgeError(401);
}
/** Literal DEVELOPMENT loopback only. No URL supplied by a browser, ambient proxy, redirects or retries. */
export function createPrivateClient(origin: string, dedicatedPeerKey: string) {
  const url = new URL(loopbackOrigin(origin)); peerKey(dedicatedPeerKey);
  return Object.freeze({
    async call(path: PeerPath, body: unknown): Promise<{ status: number; json: unknown }> {
      if (!['/private/studio-authority/consume', '/private/studio-authority/check', '/private/studio-drafts/invoke'].includes(path)) throw new BridgeError(404);
      const bytes = Buffer.from(JSON.stringify(body)); if (bytes.length > MAX_RPC) throw new BridgeError(413);
      return new Promise((resolve, reject) => {
        const req = httpRequest({ hostname: '127.0.0.1', port: url.port, method: 'POST', path, agent: false, headers: { 'content-type': 'application/json', 'content-length': String(bytes.length), 'x-studio-peer': dedicatedPeerKey } });
        const timer = setTimeout(() => req.destroy(new BridgeError(503)), 4500); timer.unref();
        const fail = () => { clearTimeout(timer); reject(new BridgeError(503)); };
        req.on('error', fail);
        req.on('response', res => {
          const chunks: Buffer[] = []; let length = 0;
          res.on('error', fail); res.on('aborted', fail);
          res.on('data', (chunk: Buffer) => { length += chunk.length; if (length > MAX_RPC) { res.destroy(); req.destroy(); fail(); } else chunks.push(chunk); });
          res.on('end', () => { clearTimeout(timer); try {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) throw new BridgeError(503);
            if (res.headers['content-type'] !== 'application/json; charset=utf-8') throw new BridgeError(503);
            const json: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
            resolve({ status: res.statusCode ?? 503, json });
          } catch { reject(new BridgeError(503)); } });
        });
        req.end(bytes);
      });
    },
  });
}
export type PrivateClient = ReturnType<typeof createPrivateClient>;
function requireSuccess(response: { status: number; json: unknown }) {
  if (response.status !== 200) throw new BridgeError(response.status === 401 ? 401 : response.status === 403 ? 403 : 503);
  return response.json;
}
/** Independent server construction only: this is NOT mounted in the Studio or host composition roots. */
export function createHostBff(options: {
  authority: HostAuthority<FastifyRequest>; dedicatedPeerKey: string;
  canonicalOrigin: () => string | undefined; studio: () => PrivateClient | undefined;
  checkCsrf?: (request: FastifyRequest) => Promise<boolean>;
}) {
  const app = appBase(); const expected = peerKey(options.dedicatedPeerKey);
  const preflights = new WeakMap<FastifyRequest, Awaited<ReturnType<typeof options.authority.preflight>>>();
  async function browserContext(req: FastifyRequest) {
    const origin = options.canonicalOrigin(); if (!origin) throw new BridgeError(503); loopbackOrigin(origin);
    if (req.headers.origin !== undefined && req.headers.origin !== origin) throw new BridgeError(403);
    const fetchSite = req.headers['sec-fetch-site']; if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new BridgeError(403);
    if (req.method !== 'GET' && (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json' || !options.checkCsrf || !await options.checkCsrf(req))) throw new BridgeError(403);
  }
  for (const phase of ['consume', 'check'] as const) app.post(`/private/studio-authority/${phase}`, {
    onRequest: async (req, reply) => { try { authenticatePeer(req, expected); } catch (error) { return failure(reply, error); } },
  }, async (req, reply) => {
    try {
      const input = z.object({ authority: opaque, wire: wireSchema, audience: z.literal(AUDIENCE) }).strict().parse(jsonBody(req)); const wire = wireIn(input.wire);
      const result = phase === 'consume' ? await options.authority.consume(input.authority, wire, input.audience) : { binding: await options.authority.check(input.authority, wire, input.audience) };
      return reply.send(result);
    } catch (error) { return failure(reply, error instanceof z.ZodError ? new BridgeError(400) : error); }
  });
  app.all('/bridge/*', { bodyLimit: MAX_BODY_BYTES,
    onRequest: async (req, reply) => {
      try {
        const prepared = await options.authority.preflight(req, req.method, req.raw.url ?? '');
        await browserContext(req);
        preflights.set(req, prepared);
      } catch (error) { return failure(reply, error); }
    },
  }, async (req, reply) => {
    let handle: string | undefined;
    try {
      const peer = options.studio(); if (!peer) throw new BridgeError(503);
      const wire: WireRequest = { method: req.method, path: req.raw.url ?? '', body: Buffer.isBuffer(req.body) ? Buffer.from(req.body) : Buffer.alloc(0) };
      const prepared = preflights.get(req); preflights.delete(req);
      if (!prepared) throw new BridgeError(403);
      await browserContext(req); // A body upload is an await boundary for Origin/CSRF too.
      const issued = await options.authority.issue(req, wire, () => !req.raw.aborted && !reply.raw.destroyed && !reply.raw.writableEnded, prepared); handle = issued.handle;
      const response = await peer.call('/private/studio-drafts/invoke', { authority: handle, wire: wireOut(wire), audience: AUDIENCE });
      if (response.status !== 200 && response.status !== 201) throw new BridgeError([400, 401, 403, 404, 409, 413].includes(response.status) ? response.status as 400 | 401 | 403 | 404 | 409 | 413 : 503);
      if (response.status !== (issued.binding.action === 'draft.create' ? 201 : 200)) throw new BridgeError(503);
      const output = resultSchema.parse(response.json);
      if (output.workspaceId !== issued.binding.workspaceId || output.projectId !== issued.binding.projectId || output.draft && output.draft.projectId !== issued.binding.projectId) throw new BridgeError(503);
      if (issued.binding.action !== 'draft.list' && (!output.draft || output.drafts !== undefined || issued.binding.draftId !== undefined && output.draft.id !== issued.binding.draftId)) throw new BridgeError(503);
      if (issued.binding.action === 'draft.list' && (output.draft !== undefined || !output.drafts || output.drafts.some(draft => draft.projectId !== issued.binding.projectId) || new Set(output.drafts.map(draft => draft.id)).size !== output.drafts.length)) throw new BridgeError(503);
      if (issued.binding.action === 'draft.create' || issued.binding.action === 'draft.update') {
        const requested = z.object({ graph: workspaceGraphSchema, expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional() }).strict().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire.body)));
        if ((issued.binding.action === 'draft.update') !== (requested.expectedRevision !== undefined)) throw new BridgeError(503);
        const revision = requested.expectedRevision === undefined ? 1 : requested.expectedRevision + 1;
        const draft = output.draft;
        if (!draft || draft.updatedBy !== issued.binding.actorId || draft.revision !== revision || JSON.stringify(draft.graph) !== JSON.stringify(requested.graph) || issued.binding.action === 'draft.create' && draft.createdBy !== issued.binding.actorId) throw new BridgeError(503);
      }
      await options.authority.confirm(handle, wire);
      return reply.code(response.status).send(output);
    } catch (error) { return failure(reply, error); }
    finally { if (handle) options.authority.finish(handle); }
  });
  return app;
}
export function createStudioRpc(options: { dedicatedPeerKey: string; host: PrivateClient; service: () => DraftService; observeHeaders?: (names: string[]) => void }) {
  const app = appBase(); const expected = peerKey(options.dedicatedPeerKey);
  app.post('/private/studio-drafts/invoke', { onRequest: async (req, reply) => {
    options.observeHeaders?.(Object.keys(req.headers));
    try { authenticatePeer(req, expected); } catch (error) { return failure(reply, error); }
  } }, async (req, reply) => {
    try {
      const input = z.object({ authority: opaque, wire: wireSchema, audience: z.literal(AUDIENCE) }).strict().parse(jsonBody(req)); const wire = wireIn(input.wire);
      const consumed = z.object({ lease: opaque, binding: bindingSchema }).strict().parse(requireSuccess(await options.host.call('/private/studio-authority/consume', { ...input, wire: wireOut(wire) })));
      const check = async (): Promise<Readonly<Binding>> => z.object({ binding: bindingSchema }).strict().parse(requireSuccess(await options.host.call('/private/studio-authority/check', { authority: consumed.lease, wire: wireOut(wire), audience: AUDIENCE }))).binding;
      const result = await options.service().execute(wire, consumed.binding, check);
      if (Buffer.byteLength(JSON.stringify(result.body)) > MAX_RPC) throw new BridgeError(413);
      return reply.code(result.status).send(result.body);
    } catch (error) { return failure(reply, error instanceof z.ZodError ? new BridgeError(400) : error); }
  });
  return app;
}
