import Anthropic from '@anthropic-ai/sdk';
import Fastify from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createDraftBroker } from '../../packages/authoring-harness/src/broker';
import type { Binding, BrokerOptions } from '../../packages/authoring-harness/src/broker';
import { createModelConnections } from '../model-connections';
import type { ResolvedModelConnection } from '../model-connections';
import { createAnthropicSessionSetup } from '../anthropic-session-setup';
import { RequestAdmission } from '../request-admission';

// Actual installed SDK; every completion uses fake fetch, never provider sockets.
const model = 'native-fixture-model';
const turn = { messages: [{ role: 'user' as const, content: 'SYNTHETIC PRIVATE USER' }] };
const limits = {
  maxModelCalls: 4, maxToolCalls: 12, maxConcurrent: 2, maxDurationMs: 10000,
  maxInputBytes: 128000, maxOutputBytes: 128000, maxTotalOutputBytes: 512000,
  maxTokensPerCall: 512, maxTotalOutputTokens: 2048, maxEvents: 64,
};
function nativeMessage() {
  return {
    id: 'msg_native_fixture', type: 'message', role: 'assistant', model,
    content: [{ type: 'text', text: 'SYNTHETIC PRIVATE ANSWER' }],
    stop_reason: 'end_turn', stop_sequence: null, container: null, stop_details: null,
    usage: { input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
function sdk(send: typeof fetch) {
  return new Anthropic({
    apiKey: 'synthetic-native-key', authToken: null, webhookKey: null,
    baseURL: 'https://api.anthropic.com', maxRetries: 0, timeout: 30000, logLevel: 'off', fetch: send,
  });
}
function connection(client: Anthropic) {
  return createModelConnections({ env: { STUDIO_ANTHROPIC_MODEL: model, FLIGHTDECK_EFFORT: 'low' }, anthropicClient: client }).resolve('anthropic');
}
function brokerFor(exact: ResolvedModelConnection, authorize?: BrokerOptions['authorize'], override: Partial<Binding> = {}) {
  const binding: Binding = {
    actorId: 'fixture-author', workspaceId: 'fixture-workspace', projectId: 'fixture-project',
    modelId: exact.descriptor.model!, modelBindingId: exact.bindingId, contextEpoch: 'context-1', policyEpoch: 'policy-1', ...override,
  };
  return createDraftBroker({ binding, limits, protectedGraph: null, authorize: authorize ?? (async () => ({ allowed: true, binding })) });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const setupPath = '/api/studio/model-connections/anthropic/setup';
const setupHeaders = { authorization: 'Bearer synthetic-native-setup', host: '127.0.0.1:3111' };

async function isolated(source: string, env: Record<string, string>) {
  return promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: process.cwd(), env: { PATH: process.env.PATH ?? '', ...(process.env.TMPDIR === undefined ? {} : { TMPDIR: process.env.TMPDIR }), ...env },
  });
}

it.each(['', 'X-Fixture: synthetic-header\nx-api-key: synthetic-override'])('refuses base construction with ambient SDK custom headers without a send: %#', async customHeaders => {
  const result = await isolated(`
    import { createModelConnections } from './server/model-connections.ts';
    let sends = 0; globalThis.fetch = async () => { sends++; throw new Error('must not send'); };
    const registry = createModelConnections({ env: { ANTHROPIC_API_KEY: 'synthetic-base-key' } });
    console.log(JSON.stringify({ descriptor: registry.descriptors.find(d => d.id === 'anthropic'), sends }));
  `, { ANTHROPIC_CUSTOM_HEADERS: customHeaders });
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({ descriptor: {
    id: 'anthropic', label: 'Anthropic API', model: null, status: 'unavailable', verification: 'not-probed', reason: 'Invalid model connection configuration',
  }, sends: 0 });
  expect(result.stdout).not.toMatch(/synthetic-header|synthetic-override|synthetic-base-key/);
});

it('pins base SDK diagnostics, explicit auth and original transport despite ambient defaults in an isolated process', async () => {
  const result = await isolated(`
    import Anthropic from '@anthropic-ai/sdk';
    import { createModelConnections } from './server/model-connections.ts';
    import { createDraftBroker } from './packages/authoring-harness/src/broker.ts';
    const log = console.log.bind(console); let diagnostics = 0;
    for (const name of ['debug', 'info', 'log', 'warn', 'error']) console[name] = () => { diagnostics++; };
    let sends = 0; let observed; let transport;
    const build = Anthropic.prototype.buildRequest;
    Anthropic.prototype.buildRequest = function(...args) {
      observed = { logLevel: this.logLevel, apiKeyMatches: this.apiKey === 'synthetic-base-key', authToken: this.authToken,
        webhookKey: this.webhookKey, baseURL: this.baseURL, maxRetries: this.maxRetries, timeout: this.timeout, credentials: this.credentials };
      return build.apply(this, args);
    };
    globalThis.fetch = async (url, init) => { sends++; transport = { url: String(url), redirect: init.redirect };
      const message = ${JSON.stringify(nativeMessage())};
      if (!JSON.parse(init.body).tools) message.content = [{ type: 'text', text: '{"fixture":true}' }];
      return new Response(JSON.stringify(message), { headers: { 'content-type': 'application/json' } }); };
    const registry = createModelConnections({ env: { ANTHROPIC_API_KEY: 'synthetic-base-key', STUDIO_ANTHROPIC_MODEL: '${model}' } });
    const exact = registry.resolve('anthropic'); const noProbe = sends === 0;
    const binding = { actorId: 'a', workspaceId: 'w', projectId: 'p', contextEpoch: 'c', policyEpoch: 'v', modelId: '${model}', modelBindingId: exact.bindingId };
    const broker = createDraftBroker({ binding, limits: ${JSON.stringify(limits)}, protectedGraph: null, authorize: async () => ({ allowed: true, binding }) });
    try {
      const jsonCompatible = JSON.stringify(await exact.llm({ system: 'Synthetic', user: 'Synthetic', purpose: 'draft', attempt: 1 })) === JSON.stringify({ text: '{"fixture":true}', truncated: false });
      await exact.nativeAuthoring.createPort(broker, 'Synthetic').complete({ messages: [{ role: 'user', content: 'Synthetic' }] });
      const native = exact.nativeAuthoring?.kind;
      log(JSON.stringify({ noProbe, native, diagnostics, observed, transport, sends, jsonCompatible, selected: registry.selectedId ?? null }));
    } finally { await broker.close(); }
  `, { ANTHROPIC_LOG: 'debug', ANTHROPIC_WEBHOOK_SIGNING_KEY: 'synthetic-ambient-webhook', ANTHROPIC_AUTH_TOKEN: 'synthetic-ambient-auth', ANTHROPIC_BASE_URL: 'https://not-used.invalid' });
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    noProbe: true, native: 'anthropic-messages-v1', diagnostics: 0, sends: 2, jsonCompatible: true, selected: null,
    observed: { logLevel: 'off', apiKeyMatches: true, authToken: null, webhookKey: null,
      baseURL: 'https://api.anthropic.com', maxRetries: 0, timeout: 30000, credentials: null },
    transport: { url: 'https://api.anthropic.com/v1/messages', redirect: 'error' },
  });
});

it.each(['same-key-replace', 'delete', 'close'] as const)('binds native session freshness through %s until original SDK settlement', async mutation => {
  const entered = deferred<void>(); const gate = deferred<Response>();
  let sends = 0;
  const setup = createAnthropicSessionSetup({
    enabled: true, baseRegistry: createModelConnections({ env: {} }), env: { STUDIO_ANTHROPIC_MODEL: model },
    authenticate: header => header === setupHeaders.authorization,
    anthropicClient: sdk(async () => { sends++; entered.resolve(); return sends === 1 ? gate.promise : response(nativeMessage()); }),
  });
  const app = Fastify(); setup.register(app);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  async function setupRequest(method: 'GET' | 'POST' | 'DELETE', payload?: unknown) {
    const wire = await fetch(address + setupPath, { method, headers: { authorization: setupHeaders.authorization,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json', origin: address }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { statusCode: wire.status, data: await wire.json() };
  }
  const admission = new RequestAdmission({ global: 1 });
  let broker: ReturnType<typeof brokerFor> | undefined;
  let settled: Promise<unknown> | undefined;
  let released: Promise<void> | undefined;
  try {
    const before = (await setupRequest('GET')).data;
    const payload = { apiKey: 'synthetic-session-key', expectedRevision: before.revision };
    const provisioned = await setupRequest('POST', payload);
    expect(provisioned.statusCode).toBe(200);
    expect((await setupRequest('GET')).data).toEqual(provisioned.data);
    expect(JSON.stringify(provisioned.data)).not.toMatch(/synthetic-session-key|nativeAuthoring|client|bindingId/);
    const old = setup.registry.resolve('anthropic');
    expect(old.nativeAuthoring?.kind).toBe('anthropic-messages-v1');
    expect(setup.registry.selectedId).toBeUndefined();
    broker = brokerFor(old);
    const port = old.nativeAuthoring!.createPort(broker, 'Synthetic');
    expect(sends).toBe(0);
    const permit = admission.acquire('fixture-author', 'fixture-project')!;
    let completed = false;
    settled = permit.track(signal => port.complete(turn, signal)).then(
      value => { completed = true; return { value }; }, error => { completed = true; return { error }; },
    );
    await entered.promise;
    if (mutation === 'close') setup.close();
    else {
      const changed = await setupRequest(mutation === 'delete' ? 'DELETE' : 'POST',
        { ...(mutation === 'delete' ? {} : { apiKey: payload.apiKey }), expectedRevision: provisioned.data.revision });
      expect(changed.statusCode).toBe(200);
      expect((await setupRequest('GET')).data).toEqual(changed.data);
    }
    expect(() => old.nativeAuthoring!.assertCurrent()).toThrow(/^Model connection request failed$/);
    expect(() => old.nativeAuthoring!.createPort(broker!, 'Synthetic')).toThrow(/^Model connection request failed$/);
    await expect(port.complete(turn)).rejects.toThrow(/^Model connection request failed$/);
    released = permit.release();
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(admission.snapshot().active).toBe(1);
    expect(admission.acquire('other', 'other-project')).toBeUndefined();
    expect(broker.snapshot().pending).toBe(1);
    expect(sends).toBe(1);
    gate.resolve(response(nativeMessage()));
    expect(await settled).toMatchObject({ error: { message: 'Model connection request failed' } });
    await released;
    expect(admission.snapshot().active).toBe(0);
    if (mutation === 'same-key-replace') {
      const current = setup.registry.resolve('anthropic');
      expect(current.bindingId).not.toBe(old.bindingId);
      expect(current.nativeAuthoring!.assertCurrent()).toBeUndefined();
      const nextBroker = brokerFor(current);
      try { expect((await current.nativeAuthoring!.createPort(nextBroker, 'Synthetic').complete(turn)).truncated).toBe(false); }
      finally { await nextBroker.close(); }
      expect(sends).toBe(2);
    } else expect(() => setup.registry.resolve('anthropic')).toThrow('Model connection unavailable');
  } finally {
    gate.resolve(response(nativeMessage())); await settled; await released;
    setup.close(); await broker?.close(); await app.close(); await admission.close();
  }
});

it.each(['diagnostics', 'middleware', 'headers', 'query', 'destination', 'body', 'method', 'signal', 'fetch-headers'] as const)('omits native admission for an unsafe injected SDK %s without disabling the JSON descriptor', mutation => {
  let sends = 0;
  let client = sdk(async () => { sends++; return response(nativeMessage()); });
  if (mutation === 'diagnostics') client.logLevel = 'debug';
  if (mutation === 'middleware') client.middleware = [async (request, next) => next(request)];
  if (mutation === 'headers') client = client.withOptions({ defaultHeaders: { 'x-synthetic-private': 'private-header' } });
  if (mutation === 'query') client = client.withOptions({ defaultQuery: { private: 'private-query' } });
  if (mutation === 'destination') client.baseURL = 'https://not-used.invalid';
  if (['body', 'method', 'signal', 'fetch-headers'].includes(mutation)) {
    client.fetchOptions = { [mutation === 'fetch-headers' ? 'headers' : mutation]: undefined };
  }
  const exact = connection(client);
  expect(exact.descriptor.status).toBe('configured');
  expect(exact.nativeAuthoring).toBeUndefined();
  expect(sends).toBe(0);
  expect(JSON.stringify(exact.descriptor)).not.toMatch(/private-|not-used|synthetic-native-key|nativeAuthoring/);
});

it.each(['before', 'after'] as const)('revalidates the original SDK credential across the awaited %s policy barrier', async stage => {
  const entered = deferred<void>(); const gate = deferred<void>();
  let sends = 0;
  const client = sdk(async () => { sends++; return response(nativeMessage()); });
  const exact = connection(client);
  const broker = brokerFor(exact, async request => {
    exact.nativeAuthoring!.assertCurrent();
    if (request.stage === stage) { entered.resolve(); await gate.promise; }
    exact.nativeAuthoring!.assertCurrent();
    return { allowed: true, binding: request.binding };
  });
  let pending: Promise<unknown> | undefined;
  try {
    const port = exact.nativeAuthoring!.createPort(broker, 'Synthetic');
    pending = port.complete(turn).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    client.apiKey = 'synthetic-rebuilt-key';
    expect(() => exact.nativeAuthoring!.assertCurrent()).toThrow(/^Model connection request failed$/);
    gate.resolve();
    expect(await pending).toMatchObject({ error: { message: 'Model connection request failed' } });
    expect(sends).toBe(stage === 'before' ? 0 : 1);
  } finally { gate.resolve(); await pending; await broker.close(); }
});

it.each(['diagnostics', 'middleware', 'headers', 'body', 'method', 'signal', 'fetch-headers', 'auth-token', 'messages'] as const)('rejects mutation of admitted SDK %s before reusing a native port', async mutation => {
  let sends = 0;
  const client = sdk(async () => { sends++; return response(nativeMessage()); });
  const exact = connection(client);
  const broker = brokerFor(exact);
  try {
    const port = exact.nativeAuthoring!.createPort(broker, 'Synthetic');
    if (mutation === 'diagnostics') client.logLevel = 'debug';
    if (mutation === 'middleware') client.middleware = [async (request, next) => next(request)];
    if (mutation === 'headers') (client as unknown as { _options: { defaultHeaders: unknown } })._options.defaultHeaders = { 'x-synthetic': 'private-header' };
    if (mutation === 'auth-token') client.authToken = 'synthetic-rebuilt-auth';
    if (mutation === 'messages') client.messages.create = (() => { throw new Error('synthetic replaced method'); }) as typeof client.messages.create;
    if (['body', 'method', 'signal', 'fetch-headers'].includes(mutation)) client.fetchOptions = { [mutation === 'fetch-headers' ? 'headers' : mutation]: undefined };
    expect(() => exact.nativeAuthoring!.assertCurrent()).toThrow(/^Model connection request failed$/);
    expect(() => exact.nativeAuthoring!.createPort(broker, 'Synthetic')).toThrow(/^Model connection request failed$/);
    await expect(port.complete(turn)).rejects.toThrow(/^Model connection request failed$/);
    expect(sends).toBe(0);
  } finally { await broker.close(); }
});

it('does not revive a reviewed native capability after observed SDK credential drift is reverted', async () => {
  let sends = 0;
  const client = sdk(async () => { sends++; return response(nativeMessage()); });
  const originalKey = client.apiKey;
  const exact = connection(client);
  const broker = brokerFor(exact);
  try {
    const port = exact.nativeAuthoring!.createPort(broker, 'Synthetic');
    client.apiKey = 'synthetic-temporary-key';
    expect(() => exact.nativeAuthoring!.assertCurrent()).toThrow(/^Model connection request failed$/);
    client.apiKey = originalKey;
    expect(() => exact.nativeAuthoring!.assertCurrent()).toThrow(/^Model connection request failed$/);
    await expect(port.complete(turn)).rejects.toThrow(/^Model connection request failed$/);
    expect(sends).toBe(0);
  } finally { await broker.close(); }
});

it.each([{ modelId: 'other-model' }, { modelBindingId: 'other-binding' }])('refuses a broker outside the exact resolved native model binding: %j', async override => {
  let sends = 0;
  const exact = connection(sdk(async () => { sends++; return response(nativeMessage()); }));
  const broker = brokerFor(exact, undefined, override);
  try {
    expect(() => exact.nativeAuthoring!.createPort(broker, 'Synthetic')).toThrow(/^Model connection request failed$/);
    expect(sends).toBe(0);
  } finally { await broker.close(); }
});

it('exposes a server-only native port over the exact installed SDK/model/effort without constructing a send', async () => {
  const sends: { url: string; body: Record<string, unknown> }[] = [];
  const exact = connection(sdk(async (url, init) => {
    sends.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return response(nativeMessage());
  }));
  expect(exact.nativeAuthoring?.kind).toBe('anthropic-messages-v1');
  expect(exact.nativeAuthoring!.assertCurrent()).toBeUndefined();
  const broker = brokerFor(exact);
  try {
    const port = exact.nativeAuthoring!.createPort(broker, 'SYNTHETIC PRIVATE SYSTEM');
    expect(sends).toHaveLength(0);
    expect(Object.keys(exact.nativeAuthoring!)).toEqual(['kind', 'assertCurrent', 'createPort']);
    expect(Object.isFrozen(exact.nativeAuthoring)).toBe(true);
    expect(await port.complete(turn)).toEqual({ message: nativeMessage(), truncated: false });
    expect(sends).toHaveLength(1);
    expect(sends[0]).toEqual({ url: 'https://api.anthropic.com/v1/messages', body: {
      model, max_tokens: limits.maxTokensPerCall, thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
      system: 'SYNTHETIC PRIVATE SYSTEM', tools: broker.tools, messages: turn.messages, stream: false,
    } });
    expect(JSON.stringify(exact.descriptor)).not.toMatch(/nativeAuthoring|client|bindingId|synthetic-native-key|PRIVATE|anthropic\.com/);
    expect(JSON.stringify(broker.events())).not.toMatch(/PRIVATE|synthetic-native-key|content|signature/);
  } finally { await broker.close(); }
});
