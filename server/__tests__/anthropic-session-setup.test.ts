import Anthropic from '@anthropic-ai/sdk';
import Fastify from 'fastify';
import { request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { createModelConnections } from '../model-connections';
import { createAnthropicSessionSetup } from '../anthropic-session-setup';
import { admittedModel, RequestAdmission } from '../request-admission';

const path = '/api/studio/model-connections/anthropic/setup';
const authorization = 'Bearer development-session-setup-fixture';
const headers = { authorization, host: '127.0.0.1:3111' };
const authenticate = (header: string | undefined) => header === authorization;
const request = { system: 'fixture-system', user: 'fixture-user', purpose: 'draft' as const, attempt: 1 };
function message() { return { content: [{ type: 'text', text: '{"fixture":true}' }], stop_reason: 'end_turn', model: 'fixture-claude', usage: { input_tokens: 1, output_tokens: 1 } }; }
function sdkFixture() {
  const create = vi.fn(async (_body: unknown) => message());
  return { create, client: { messages: { create } } as unknown as Anthropic };
}

it('provisions through CAS without a probe, selection change, or changes to other providers', async () => {
  const fixture = sdkFixture();
  const baseRegistry = createModelConnections({ env: { STUDIO_MODEL_CONNECTION: 'local', STUDIO_LOCAL_MODEL: 'fixture-local', STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:11434/v1' } });
  const env = { STUDIO_ANTHROPIC_MODEL: 'fixture-claude', FLIGHTDECK_EFFORT: 'low', ANTHROPIC_AUTH_TOKEN: 'must-not-be-inherited', ANTHROPIC_BASE_URL: 'https://must-not-be-used.invalid' };
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry, authenticate, env, anthropicClient: fixture.client });
  env.STUDIO_ANTHROPIC_MODEL = 'mutated-after-construction';
  const app = Fastify(); setup.register(app);
  try {
    const before = (await app.inject({ method: 'GET', url: path, headers })).json();
    const response = await app.inject({ method: 'POST', url: path, headers, payload: { apiKey: 'development-only-secret', expectedRevision: before.revision } });
    expect(response.statusCode).toBe(200);
    const after = response.json();
    expect(after).toEqual({ ...before, status: 'configured', revision: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(after.revision).not.toBe(before.revision);
    expect((await app.inject({ method: 'GET', url: path, headers })).json()).toEqual(after);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(setup.registry.selectedId).toBe('local');
    expect(setup.registry.resolveSelected()).toBe(baseRegistry.resolve('local'));
    expect(setup.registry.descriptors.filter(d => d.id !== 'anthropic')).toEqual(baseRegistry.descriptors.filter(d => d.id !== 'anthropic'));
    const exact = setup.registry.resolve('anthropic');
    expect(setup.registry.resolve('anthropic')).toBe(exact);
    expect(exact.descriptor).toMatchObject({ id: 'anthropic', model: 'fixture-claude', status: 'configured', verification: 'not-probed' });
    expect(setup.registry.descriptors.find(d => d.id === 'anthropic')).toBe(exact.descriptor);
    expect(await exact.llm(request)).toEqual({ text: '{"fixture":true}', truncated: false });
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.create.mock.calls[0]?.[0]).toMatchObject({ model: 'fixture-claude', output_config: { effort: 'low' } });
    const stale = await app.inject({ method: 'POST', url: path, headers, payload: { apiKey: 'other-development-secret', expectedRevision: before.revision } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'setup revision conflict' });
    expect((await app.inject({ method: 'GET', url: path, headers })).json()).toEqual(after);
    expect(response.body + stale.body + JSON.stringify(setup.registry.descriptors)).not.toMatch(/development-only-secret|must-not-be-inherited|must-not-be-used/);
  } finally { setup.close(); await app.close(); }
});

it('removes the session key with CAS and leaves no selection or silent fallback', async () => {
  const fixture = sdkFixture();
  const baseRegistry = createModelConnections({ env: { STUDIO_MODEL_CONNECTION: 'anthropic' } });
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry, authenticate, env: {}, anthropicClient: fixture.client });
  const app = Fastify(); setup.register(app);
  try {
    const before = (await app.inject({ method: 'GET', url: path, headers })).json();
    const configured = (await app.inject({ method: 'POST', url: path, headers, payload: { apiKey: 'development-secret', expectedRevision: before.revision } })).json();
    expect(setup.registry.resolveSelected().descriptor.status).toBe('configured');
    const stale = await app.inject({ method: 'DELETE', url: path, headers, payload: { expectedRevision: before.revision } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'setup revision conflict' });
    const response = await app.inject({ method: 'DELETE', url: path, headers, payload: { expectedRevision: configured.revision } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...before, revision: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(response.json().revision).not.toBe(configured.revision);
    expect((await app.inject({ method: 'GET', url: path, headers })).json()).toEqual(response.json());
    expect(setup.registry.selectedId).toBe('anthropic');
    expect(() => setup.registry.resolveSelected()).toThrow('Model connection unavailable');
    expect(setup.registry.descriptors.find(d => d.id === 'anthropic')?.status).toBe('unavailable');
    expect(fixture.create).not.toHaveBeenCalled();
  } finally { setup.close(); await app.close(); }
});

it('requires canonical loopback Host and exact same-origin independently of forwarded headers', async () => {
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate, env: {} });
  const app = Fastify({ trustProxy: true }); setup.register(app);
  try {
    for (const host of ['localhost', '127.0.0.1:3111', '[::1]:3111']) {
      for (const origin of [undefined, `http://${host}`]) {
        const result = await app.inject({ method: 'GET', url: path, headers: { authorization, host, ...(origin === undefined ? {} : { origin }), 'x-forwarded-host': 'untrusted.example', 'x-forwarded-proto': 'https' } });
        expect(result.statusCode).toBe(200);
        expect(result.headers['access-control-allow-origin']).toBeUndefined();
      }
    }
    const refused = [
      { ...headers, origin: 'null' }, { ...headers, origin: 'https://127.0.0.1:3111' },
      { ...headers, origin: 'http://127.0.0.1:3112' }, { ...headers, origin: 'http://localhost:3111' },
      { ...headers, origin: 'http://127.0.0.1:3111/path' }, { ...headers, origin: 'http://a@127.0.0.1:3111' },
      ...['untrusted.example', '127.0.0.1.evil', 'localhost.', 'LOCALHOST', '127.1', '[0:0:0:0:0:0:0:1]', 'localhost:0', 'localhost:65536', 'localhost:080', 'localhost@evil'].map(host => ({ authorization, host, 'x-forwarded-host': '127.0.0.1:3111', 'x-forwarded-proto': 'http' })),
    ];
    for (const requestHeaders of refused) for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const result = await app.inject({ method, url: path, headers: { ...requestHeaders, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { payload: '{"private-sentinel":' }) });
      expect(result.statusCode).toBe(403);
      expect(result.json()).toEqual({ error: 'private same-origin setup required' });
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
      expect(result.body).not.toContain('private-sentinel');
    }
    const unauthorized = await app.inject({ method: 'POST', url: path, headers: { host: 'evil.example', origin: 'null', 'content-type': 'application/json' }, payload: '{' });
    expect(unauthorized.statusCode).toBe(401);
  } finally { setup.close(); await app.close(); }
});

it('authenticates before native body parsing and emits only fixed private intake errors', async () => {
  const logs: string[] = [];
  const fixture = sdkFixture();
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate, env: {}, anthropicClient: fixture.client });
  const app = Fastify({ logger: { level: 'trace', stream: { write: (chunk: string) => { logs.push(chunk); } } } }); setup.register(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const before = (await app.inject({ method: 'GET', url: path, headers })).json();
    const sensitive = 'private-intake-sentinel';
    const cases = [
      { body: `{"apiKey":"${sensitive}",`, contentType: 'application/json', status: 400, error: 'malformed setup request' },
      { body: JSON.stringify({ apiKey: sensitive + 'x'.repeat(65536), expectedRevision: before.revision }), contentType: 'application/json', status: 413, error: 'setup request too large' },
      { body: sensitive, contentType: 'text/plain', status: 415, error: 'setup JSON required' },
      { body: sensitive, contentType: 'application/secret-sentinel', status: 415, error: 'setup JSON required' },
      { body: '', contentType: 'application/json', status: 400, error: 'malformed setup request' },
    ];
    for (const method of ['POST', 'DELETE'] as const) for (const entry of cases) {
      for (const allowed of [false, true]) {
        const response = await fetch(address + path, { method, headers: { 'content-type': entry.contentType, ...(allowed ? { authorization } : {}) }, body: entry.body });
        expect(response.status).toBe(allowed ? entry.status : 401);
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ error: allowed ? entry.error : 'operator token required' });
        expect(text).not.toContain(sensitive);
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
    }
    for (const apiKey of ['', ' '.repeat(3), 'x'.repeat(8193), 'line\nbreak', 'line\rbreak', 'nul\u0000', 'tab\t', 'del\u007f', 'c1\u0085', 'line\u2028break', 7, null]) {
      const response = await app.inject({ method: 'POST', url: path, headers, payload: { apiKey, expectedRevision: before.revision } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'malformed setup request' });
    }
    for (const method of ['POST', 'DELETE'] as const) {
      const valid = method === 'POST' ? { apiKey: sensitive, expectedRevision: before.revision } : { expectedRevision: before.revision };
      for (const payload of [null, [], 1, { ...valid, model: sensitive }, { ...valid, baseURL: sensitive }, { ...valid, expectedRevision: '' }, { ...valid, expectedRevision: 'x'.repeat(1000) }, { ...valid, expectedRevision: 1 }]) {
        const response = await app.inject({ method, url: path, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'malformed setup request' });
      }
    }
    expect((await app.inject({ method: 'GET', url: path, headers })).json()).toEqual(before);
    expect(fixture.create).not.toHaveBeenCalled();
    expect(logs.join('')).not.toMatch(/private-intake-sentinel|secret-sentinel/);
  } finally { setup.close(); await app.close(); }
});

it.each(['POST', 'DELETE', 'close'] as const)('invalidates old sends/results on %s but retains original promise accounting through settlement', async mutation => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const client = { messages: { create: async () => { calls++; if (calls === 1) await gate; return message(); } } } as unknown as Anthropic;
  const admission = new RequestAdmission({ global: 1 });
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: { STUDIO_MODEL_CONNECTION: 'anthropic' } }), authenticate, env: {}, anthropicClient: client });
  const app = Fastify(); setup.register(app);
  app.post('/fixture-model', async (_request, reply) => {
    const permit = admission.acquire('Development Operator');
    if (!permit) return reply.code(429).send({ error: 'fixture capacity' });
    try { return await admittedModel(setup.registry.resolveSelected().llm, permit)(request); }
    catch { return reply.code(409).send({ error: 'fixture model unavailable' }); }
    finally { await permit.release(); }
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  let pending: Promise<Response> | undefined;
  try {
    const before = await (await fetch(address + path, { headers: { authorization } })).json();
    const configured = await (await fetch(address + path, { method: 'POST', headers: { authorization, 'content-type': 'application/json', origin: address }, body: JSON.stringify({ apiKey: 'development-epoch-secret', expectedRevision: before.revision }) })).json();
    const old = setup.registry.resolveSelected();
    let settled = false;
    pending = fetch(address + '/fixture-model', { method: 'POST' }).then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(calls).toBe(1));
    if (mutation === 'close') setup.close();
    else {
      const changed = await fetch(address + path, { method: mutation, headers: { authorization, 'content-type': 'application/json', origin: address }, body: JSON.stringify({ expectedRevision: configured.revision, ...(mutation === 'POST' ? { apiKey: 'development-epoch-secret' } : {}) }) });
      expect(changed.status).toBe(200);
    }
    await expect(old.llm(request)).rejects.toThrow(/^Model connection request failed$/);
    expect(calls).toBe(1);
    expect(settled).toBe(false);
    expect(admission.snapshot().active).toBe(1);
    expect((await fetch(address + '/fixture-model', { method: 'POST' })).status).toBe(429);
    if (mutation === 'POST') {
      expect(setup.registry.resolveSelected()).not.toBe(old);
      expect(setup.registry.resolveSelected().bindingId).not.toBe(old.bindingId);
      expect(setup.registry.resolveSelected().bindingId).not.toContain('development-epoch-secret');
    } else expect(() => setup.registry.resolveSelected()).toThrow('Model connection unavailable');
    release();
    const staleResult = await pending;
    expect(staleResult.status).toBe(409);
    expect(await staleResult.json()).toEqual({ error: 'fixture model unavailable' });
    expect(admission.snapshot().active).toBe(0);
    expect(calls).toBe(1);
    if (mutation === 'POST') {
      expect(await setup.registry.resolveSelected().llm(request)).toEqual({ text: '{"fixture":true}', truncated: false });
      expect(calls).toBe(2);
    }
    if (mutation === 'close') {
      const response = await fetch(address + path, { headers: { authorization } });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'setup unavailable' });
    }
  } finally { release(); await pending; setup.close(); await app.close(); await admission.close(); }
});

it('refuses to replace or delete an externally managed Anthropic connection', async () => {
  const fixture = sdkFixture();
  const baseRegistry = createModelConnections({ env: { ANTHROPIC_API_KEY: 'external-development-secret', STUDIO_ANTHROPIC_MODEL: 'external-fixture-model', STUDIO_MODEL_CONNECTION: 'anthropic' }, anthropicClient: fixture.client });
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry, authenticate, env: { STUDIO_ANTHROPIC_MODEL: 'not-an-override' }, anthropicClient: fixture.client });
  const app = Fastify(); setup.register(app);
  try {
    const before = (await app.inject({ method: 'GET', url: path, headers })).json();
    expect(before).toMatchObject({ available: false, persistence: 'external', model: 'external-fixture-model', status: 'configured' });
    const original = baseRegistry.resolveSelected();
    for (const method of ['POST', 'DELETE'] as const) for (const expectedRevision of [before.revision, '11111111-1111-4111-8111-111111111111']) {
      const result = await app.inject({ method, url: path, headers, payload: { expectedRevision, ...(method === 'POST' ? { apiKey: 'replacement-development-secret' } : {}) } });
      expect(result.statusCode).toBe(403);
      expect(result.json()).toEqual({ error: 'Anthropic connection is externally managed' });
      expect(setup.registry.resolveSelected()).toBe(original);
      expect((await app.inject({ method: 'GET', url: path, headers })).json()).toEqual(before);
    }
    expect(fixture.create).not.toHaveBeenCalled();
  } finally { setup.close(); await app.close(); }
});

it('pins the real installed SDK policy and preserves the supplied key without global env writes', async () => {
  const build = vi.spyOn(Anthropic.prototype, 'buildRequest');
  const transport = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify(message()), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', transport);
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate, env: { FLIGHTDECK_MODEL: 'fallback-fixture-model', ANTHROPIC_AUTH_TOKEN: 'must-not-be-used', ANTHROPIC_BASE_URL: 'https://not-used.invalid', ANTHROPIC_LOG: 'debug' } });
  const app = Fastify(); setup.register(app);
  try {
    const before = (await app.inject({ method: 'GET', url: path, headers })).json();
    const apiKey = ' development-exact-key ';
    const configured = await app.inject({ method: 'POST', url: path, headers, payload: { apiKey, expectedRevision: before.revision } });
    expect(configured.statusCode).toBe(200);
    expect(transport).not.toHaveBeenCalled();
    expect(await setup.registry.resolve('anthropic').llm(request)).toEqual({ text: '{"fixture":true}', truncated: false });
    expect(transport).toHaveBeenCalledTimes(1);
    const client = build.mock.contexts[0] as Anthropic | undefined;
    expect(client).toBeInstanceOf(Anthropic);
    expect(client?.apiKey).toBe(apiKey);
    expect(client?.authToken).toBeNull();
    expect(client?.baseURL).toBe('https://api.anthropic.com');
    expect(client?.maxRetries).toBe(0);
    expect(client?.timeout).toBe(30000);
    expect(client?.logLevel).toBe('off');
    expect(client?.webhookKey).toBeNull();
    expect(String(transport.mock.calls[0]?.[0])).toBe('https://api.anthropic.com/v1/messages');
    expect(transport.mock.calls[0]?.[1]?.redirect).toBe('error');
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body)).model).toBe('fallback-fixture-model');
  } finally { setup.close(); await app.close(); build.mockRestore(); vi.unstubAllGlobals(); }
});

it('refuses a provision whose authenticated socket body finishes after close', async () => {
  const authenticated = vi.fn(authenticate);
  const fixture = sdkFixture();
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate: authenticated, env: {}, anthropicClient: fixture.client });
  const app = Fastify(); setup.register(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const before = (await app.inject({ method: 'GET', url: path, headers })).json();
  authenticated.mockClear();
  const payload = JSON.stringify({ apiKey: 'late-private-development-secret', expectedRevision: before.revision });
  const socket = httpRequest(address + path, { method: 'POST', headers: { authorization, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } });
  const result = new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    socket.on('error', reject);
    socket.on('response', response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
  });
  try {
    socket.write(payload.slice(0, 20));
    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledTimes(1));
    setup.close();
    socket.end(payload.slice(20));
    expect(await result).toEqual({ status: 503, body: JSON.stringify({ error: 'setup unavailable' }) });
    expect(setup.registry.descriptors.find(d => d.id === 'anthropic')?.status).toBe('unavailable');
    expect(() => setup.registry.resolve('anthropic')).toThrow('Model connection unavailable');
    expect(fixture.create).not.toHaveBeenCalled();
  } finally { socket.destroy(); setup.close(); await app.close(); }
});

it.each([
  { STUDIO_ANTHROPIC_MODEL: '' }, { STUDIO_ANTHROPIC_MODEL: 'private bad model' },
  { FLIGHTDECK_MODEL: 'bad\nmodel' }, { FLIGHTDECK_EFFORT: 'private-invalid-effort' },
])('rejects invalid trusted configuration without echoing it: %#', env => {
  expect(() => createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate, env })).toThrow(/^Invalid Anthropic session setup configuration$/);
});

it('refuses ambient SDK header overrides in an isolated process without changing process.env', async () => {
  const source = `
    import Fastify from 'fastify';
    import { createAnthropicSessionSetup } from './server/anthropic-session-setup.ts';
    import { createModelConnections } from './server/model-connections.ts';
    const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), env: {}, authenticate: h => h === 'Bearer development-child-fixture' });
    const app = Fastify(); setup.register(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const headers = { authorization: 'Bearer development-child-fixture', 'content-type': 'application/json' };
      const before = await (await fetch(address + ${JSON.stringify(path)}, { headers })).json();
      const response = await fetch(address + ${JSON.stringify(path)}, { method: 'POST', headers, body: JSON.stringify({ apiKey: 'development-child-key', expectedRevision: before.revision }) });
      console.log(JSON.stringify({ status: response.status, body: await response.json(), unchanged: JSON.stringify(await (await fetch(address + ${JSON.stringify(path)}, { headers })).json()) === JSON.stringify(before) }));
    } finally { setup.close(); await app.close(); }
  `;
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { cwd: process.cwd(), env: { PATH: process.env.PATH ?? '', ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }), ANTHROPIC_CUSTOM_HEADERS: 'X-Fixture-Secret: development-only-header' } });
  expect(JSON.parse(result.stdout)).toEqual({ status: 403, body: { error: 'setup configuration unavailable' }, unchanged: true });
  expect(result.stderr).toBe('');
});

it('allows exactly one same-revision HTTP mutation to win, including concurrent removal', async () => {
  const fixture = sdkFixture();
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate, env: {}, anthropicClient: fixture.client });
  const app = Fastify(); setup.register(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    let current = await (await fetch(address + path, { headers: { authorization } })).json();
    for (const method of ['POST', 'DELETE'] as const) {
      const results = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
        const response = await fetch(address + path, { method, headers: { authorization, 'content-type': 'application/json', origin: address }, body: JSON.stringify({ expectedRevision: current.revision, ...(method === 'POST' ? { apiKey: `development-concurrent-${i}` } : {}) }) });
        return { status: response.status, body: await response.json() };
      }));
      expect(results.filter(r => r.status === 200)).toHaveLength(1);
      expect(results.filter(r => r.status === 409)).toHaveLength(11);
      for (const rejected of results.filter(r => r.status !== 200)) expect(rejected.body).toEqual({ error: 'setup revision conflict' });
      const accepted = results.find(r => r.status === 200)!;
      const readback = await (await fetch(address + path, { headers: { authorization } })).json();
      expect(readback).toEqual(accepted.body);
      expect(readback.revision).not.toBe(current.revision);
      expect(readback.status).toBe(method === 'POST' ? 'configured' : 'unavailable');
      current = readback;
    }
    expect(fixture.create).not.toHaveBeenCalled();
    expect(setup.registry.selectedId).toBeUndefined();
    expect(() => setup.registry.resolveSelected()).toThrow('No model connection selected');
  } finally { setup.close(); await app.close(); }
});

it('suppresses thrown SDK details at the actual facade and HTTP seam without retry', async () => {
  const client = { messages: { create: vi.fn(async () => { throw new Error('private-sdk-development-secret-and-context'); }) } } as unknown as Anthropic;
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate, env: {}, anthropicClient: client });
  const app = Fastify(); setup.register(app);
  app.post('/fixture-failure', async (_request, reply) => {
    try { return await setup.registry.resolve('anthropic').llm(request); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : 'fixture error' }); }
  });
  try {
    const before = (await app.inject({ method: 'GET', url: path, headers })).json();
    expect((await app.inject({ method: 'POST', url: path, headers, payload: { apiKey: 'development-private-key', expectedRevision: before.revision } })).statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: '/fixture-failure' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Model connection request failed' });
    expect(response.body).not.toMatch(/private-sdk|context|development-private-key|cause|stack/);
    expect(client.messages.create).toHaveBeenCalledTimes(1);
  } finally { setup.close(); await app.close(); }
});

it('accepts bounded nonempty keys without probing and treats auth predicate failures as unauthenticated', async () => {
  const fixture = sdkFixture();
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate: header => { if (header === 'Bearer throwing-fixture') throw new Error('private-auth-context'); return authenticate(header); }, env: {}, anthropicClient: fixture.client });
  const app = Fastify(); setup.register(app);
  try {
    const denied = await app.inject({ method: 'POST', url: path, headers: { ...headers, authorization: 'Bearer throwing-fixture', 'content-type': 'application/json' }, payload: '{"private-payload":' });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toEqual({ error: 'operator token required' });
    let current = (await app.inject({ method: 'GET', url: path, headers })).json();
    for (const apiKey of ['k', 'k'.repeat(8192), ' leading-and-trailing ']) {
      const response = await app.inject({ method: 'POST', url: path, headers, payload: { apiKey, expectedRevision: current.revision } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ...current, status: 'configured', revision: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      current = response.json();
    }
    expect(fixture.create).not.toHaveBeenCalled();
  } finally { setup.close(); await app.close(); }
});

it('rechecks closed state before metadata after asynchronous request hooks', async () => {
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry: createModelConnections({ env: {} }), authenticate, env: {} });
  const app = Fastify();
  app.addHook('preHandler', async () => { setup.close(); });
  setup.register(app);
  try {
    const response = await app.inject({ method: 'GET', url: path, headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'setup unavailable' });
  } finally { setup.close(); await app.close(); }
});

it('serves only authenticated nonsecret server-memory metadata over actual loopback HTTP', async () => {
  const baseRegistry = createModelConnections({ env: {} });
  const setup = createAnthropicSessionSetup({ enabled: true, baseRegistry, authenticate, env: { STUDIO_ANTHROPIC_MODEL: 'fixture-claude' } });
  const app = Fastify(); setup.register(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const denied = await fetch(address + path);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: 'operator token required' });
    const response = await fetch(address + path, { headers: { authorization } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const dto = await response.json();
    expect(dto).toEqual({ available: true, persistence: 'server-memory', model: 'fixture-claude', status: 'unavailable', revision: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect((await (await fetch(address + path, { headers: { authorization } })).json()).revision).toBe(dto.revision);
    expect(setup.registry.descriptors.map(d => d.id)).toEqual(['codex-chatgpt', 'flightdeck', 'local', 'anthropic']);
    expect(setup.registry.selectedId).toBeUndefined();
    expect(() => setup.registry.resolveSelected()).toThrow('No model connection selected');
  } finally { setup.close(); await app.close(); }
});

it('keeps setup absent and the exact base registry unchanged unless explicitly enabled', async () => {
  const baseRegistry = createModelConnections({ env: {} });
  for (const enabled of [undefined, false]) {
    const setup = createAnthropicSessionSetup({ baseRegistry, authenticate, ...(enabled === undefined ? {} : { enabled }) });
    const app = Fastify();
    setup.register(app);
    try {
      expect(setup.registry).toBe(baseRegistry);
      for (const method of ['GET', 'POST', 'DELETE'] as const) {
        const response = await app.inject({ method, url: path, headers });
        expect(response.statusCode).toBe(404);
      }
      setup.close();
      expect(setup.registry).toBe(baseRegistry);
    } finally { await app.close(); }
  }
});
