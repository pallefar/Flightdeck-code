import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import type { TLSSocket } from 'node:tls';
import { z } from 'zod';
import { DEFAULT_MODEL } from '../packages/providers/src/models';
import type { PlannerRequestLike } from '../packages/providers/src/planner-bridge';
import { validateModelName } from '../packages/providers/src/openai-compatible';
import { isEffort } from '../packages/providers/src/types';
import { createModelConnections, rebindNativeAuthoring } from './model-connections';
import type { ModelConnectionRegistry, ResolvedModelConnection } from './model-connections';

export interface AnthropicSessionSetupOptions {
  readonly baseRegistry: ModelConnectionRegistry;
  readonly authenticate: (header: string | undefined) => boolean;
  readonly enabled?: boolean;
  /** Trusted startup snapshot; only model/effort fields are consumed. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Trusted deterministic test seam only. Never construct from browser policy/destinations. */
  readonly anthropicClient?: Anthropic;
}
export interface AnthropicSessionSetup {
  readonly registry: ModelConnectionRegistry;
  register(app: FastifyInstance): void;
  close(): void;
}
export type AnthropicSessionSetupDto = Readonly<{
  model: string;
  status: 'configured' | 'unavailable';
  revision: string;
}> & (
  | { readonly available: true; readonly persistence: 'server-memory' }
  | { readonly available: false; readonly persistence: 'external' }
);
const expectedRevision = z.string().length(36).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const postBody = z.object({ apiKey: z.string().min(1).max(8192).refine(key => key.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(key)), expectedRevision }).strict();
const deleteBody = z.object({ expectedRevision }).strict();
/** Host is a same-origin constraint, never authentication. Ignore proxy headers. */
function privateOrigin(request: FastifyRequest): boolean {
  const host = request.raw.headers.host;
  if (typeof host !== 'string') return false;
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/.exec(host);
  if (!match || (match[2] !== undefined && Number(match[2]) > 65535)) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true; // Authenticated CLI request, not cookie authority.
  if (typeof origin !== 'string' || origin === 'null') return false;
  try {
    const protocol = (request.raw.socket as TLSSocket).encrypted === true ? 'https' : 'http';
    const parsed = new URL(origin);
    return parsed.origin === origin && origin === new URL(`${protocol}://${host}`).origin;
  } catch { return false; }
}
/** Disabled by default: construction cannot widen the base registry. */
export function createAnthropicSessionSetup(options: AnthropicSessionSetupOptions): AnthropicSessionSetup {
  if (options.enabled !== true) return Object.freeze({ registry: options.baseRegistry, register: (_app: FastifyInstance) => {}, close: () => {} });
  const source = options.env ?? process.env;
  const base = options.baseRegistry;
  const baseAnthropic = base.descriptors.find(d => d.id === 'anthropic');
  const externallyManaged = baseAnthropic?.status === 'configured';
  const model = (externallyManaged ? baseAnthropic.model : undefined) ?? source.STUDIO_ANTHROPIC_MODEL ?? source.FLIGHTDECK_MODEL ?? DEFAULT_MODEL;
  const effort = source.FLIGHTDECK_EFFORT ?? 'high';
  try { validateModelName(model); if (!isEffort(effort)) throw new Error(); }
  catch { throw new Error('Invalid Anthropic session setup configuration'); }
  let revision = randomUUID();
  let closed = false;
  let overridden = false;
  type Session = { connection: ResolvedModelConnection | undefined; readonly resolved: ResolvedModelConnection };
  let session: Session | undefined;
  const unavailable = Object.freeze({ ...baseAnthropic, id: 'anthropic' as const, label: baseAnthropic?.label ?? 'Anthropic API', model: null, status: 'unavailable' as const, verification: 'not-probed' as const, reason: 'Connection is not configured' });
  function invalidate(): void { if (session) session.connection = undefined; session = undefined; }
  function bind(connection: ResolvedModelConnection): Session {
    const bindingId = `studio-anthropic-session-v1:${randomUUID()}:${connection.bindingId}`;
    const assertCurrent = () => {
      if (closed || session !== state || state.connection !== connection) throw new Error('Model connection request failed');
    };
    const nativeAuthoring = connection.nativeAuthoring && rebindNativeAuthoring(connection.nativeAuthoring, bindingId, assertCurrent);
    const state: Session = { connection, resolved: Object.freeze({
      descriptor: connection.descriptor,
      // Credential changes require fresh exact-context review; never derive this epoch from a key.
      bindingId,
      ...(nativeAuthoring ? { nativeAuthoring } : {}),
      llm: async (request: PlannerRequestLike) => {
        const exact = state.connection;
        if (!exact || closed || session !== state) throw new Error('Model connection request failed');
        try {
          // No abort race: admission retains this original operation until the adapter settles.
          const result = await exact.llm(request);
          if (closed || session !== state || state.connection !== exact) throw new Error();
          return result;
        } catch { throw new Error('Model connection request failed'); }
      },
    }) };
    return state;
  }
  function resolve(id: string): ResolvedModelConnection {
    if (id !== 'anthropic' || !overridden) return base.resolve(id);
    if (!session || closed) throw new Error('Model connection unavailable');
    return session.resolved;
  }
  const registry: ModelConnectionRegistry = Object.freeze({
    get descriptors() { return Object.freeze(base.descriptors.map(d => d.id === 'anthropic' && overridden ? session?.resolved.descriptor ?? unavailable : d)); },
    get selectedId() { return base.selectedId; },
    resolve,
    resolveSelected() { if (!base.selectedId) throw new Error('No model connection selected'); return resolve(base.selectedId); },
  });
  const metadata = (): AnthropicSessionSetupDto => ({
    ...(externallyManaged ? { available: false, persistence: 'external' } as const : { available: true, persistence: 'server-memory' } as const),
    model, status: registry.descriptors.find(d => d.id === 'anthropic')?.status ?? 'unavailable', revision,
  });
  return Object.freeze({
    registry,
    register(app: FastifyInstance) {
      const routeOptions: RouteShorthandOptions = {
        logLevel: 'silent',
        bodyLimit: 65536,
        errorHandler: (error, _request, reply) => {
          // Never forward parser/provider messages, input, schema details, causes or stack.
          const status = error.statusCode;
          if (status === 413) return reply.code(413).send({ error: 'setup request too large' });
          if (status === 415) return reply.code(415).send({ error: 'setup JSON required' });
          if (status === 400) return reply.code(400).send({ error: 'malformed setup request' });
          return reply.code(500).send({ error: 'setup unavailable' });
        },
        onRequest: async (request, reply) => {
          reply.header('Cache-Control', 'no-store');
          let authenticated = false;
          try { authenticated = options.authenticate(request.headers.authorization) === true; } catch {}
          if (!authenticated) return reply.code(401).send({ error: 'operator token required' });
          if (!privateOrigin(request)) return reply.code(403).send({ error: 'private same-origin setup required' });
          if (closed) return reply.code(503).send({ error: 'setup unavailable' });
          if (request.method !== 'GET' && request.method !== 'HEAD' && !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(request.headers['content-type'] ?? '')) return reply.code(415).send({ error: 'setup JSON required' });
        },
      };
      app.get('/api/studio/model-connections/anthropic/setup', routeOptions, async (_request, reply) => {
        if (closed) return reply.code(503).send({ error: 'setup unavailable' });
        return metadata();
      });
      app.post('/api/studio/model-connections/anthropic/setup', routeOptions, async (request, reply) => {
        const parsed = postBody.safeParse(request.body);
        request.body = undefined;
        if (!parsed.success) return reply.code(400).send({ error: 'malformed setup request' });
        if (closed) return reply.code(503).send({ error: 'setup unavailable' });
        const body = parsed.data;
        if (externallyManaged) return reply.code(403).send({ error: 'Anthropic connection is externally managed' });
        if (body.expectedRevision !== revision) return reply.code(409).send({ error: 'setup revision conflict' });
        // This installed SDK otherwise merges ambient custom headers, outside the sanitized snapshot.
        if (!options.anthropicClient && process.env.ANTHROPIC_CUSTOM_HEADERS !== undefined) return reply.code(403).send({ error: 'setup configuration unavailable' });
        // Pin SDK diagnostics as well as transport. The provider/planner remains the existing registry implementation.
        const client = options.anthropicClient ?? new Anthropic({
          apiKey: body.apiKey, authToken: null, webhookKey: null,
          baseURL: 'https://api.anthropic.com', maxRetries: 0, timeout: 30000, logLevel: 'off',
          fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
        });
        const next = bind(createModelConnections({ env: { STUDIO_ANTHROPIC_MODEL: model, FLIGHTDECK_EFFORT: effort, ANTHROPIC_API_KEY: body.apiKey }, anthropicClient: client }).resolve('anthropic'));
        const nextRevision = randomUUID();
        invalidate();
        overridden = true;
        session = next;
        revision = nextRevision;
        return metadata();
      });
      app.delete('/api/studio/model-connections/anthropic/setup', routeOptions, async (request, reply) => {
        const parsed = deleteBody.safeParse(request.body);
        request.body = undefined;
        if (!parsed.success) return reply.code(400).send({ error: 'malformed setup request' });
        if (closed) return reply.code(503).send({ error: 'setup unavailable' });
        const body = parsed.data;
        if (externallyManaged) return reply.code(403).send({ error: 'Anthropic connection is externally managed' });
        if (body.expectedRevision !== revision) return reply.code(409).send({ error: 'setup revision conflict' });
        const nextRevision = randomUUID();
        invalidate();
        overridden = true;
        revision = nextRevision;
        return metadata();
      });
    },
    close: () => { closed = true; invalidate(); },
  });
}
