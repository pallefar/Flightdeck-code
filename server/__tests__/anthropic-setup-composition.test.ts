import type Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { createServer, type ServerOptions } from '../index';
import { createModelConnections } from '../model-connections';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
import { AnthropicSetupClient } from '../../src/studio/anthropic-setup-client';
import { checkConnection } from '../../src/studio/connection';

const path = '/api/studio/model-connections/anthropic/setup';
const operator = { actor: 'Karsten Haldan', token: 'development-root-setup-operator-only' };
const headers = { authorization: `Bearer ${operator.token}`, host: '127.0.0.1:3111' };
function fixture() {
  const create = vi.fn(async () => ({
    content: [{ type: 'text', text: JSON.stringify({ status: 'needs_input', questions: [{ id: 'target', question: 'Workflow or application?' }] }) }],
    stop_reason: 'end_turn', model: 'fixture-claude', usage: { input_tokens: 1, output_tokens: 1 },
  }));
  const options = {
    operator, store: createMemoryGrantStore(), modelConnections: createModelConnections({ env: {} }),
    anthropicSessionSetup: { enabled: true, env: { STUDIO_ANTHROPIC_MODEL: 'fixture-claude' }, anthropicClient: { messages: { create } } as unknown as Anthropic },
  };
  return { create, options };
}

it('reports externally managed setup truthfully through the real HTTP client and refuses changes without a CAS retry', async () => {
  const { create, options } = fixture();
  const base = createModelConnections({
    env: { ANTHROPIC_API_KEY: 'NONSECRET_EXTERNAL_KEY_FIXTURE', STUDIO_ANTHROPIC_MODEL: 'fixture-external-model', STUDIO_MODEL_CONNECTION: 'anthropic' },
    anthropicClient: options.anthropicSessionSetup.anthropicClient,
  });
  const original = base.resolveSelected();
  const descriptors = base.descriptors;
  const app = createServer({ ...options, modelConnections: base });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const statuses: number[] = [];
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const response = await fetch(new URL(String(input), address), init);
    statuses.push(response.status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    return response;
  });
  const client = new AnthropicSetupClient(transport);
  const context = { signal: new AbortController().signal, isCurrent: () => true };
  try {
    const before = await client.load(operator.token, context);
    expect(before).toEqual({ available: false, persistence: 'external', model: 'fixture-external-model', status: 'configured', revision: expect.any(String) });
    for (const method of ['POST', 'DELETE'] as const) {
      await expect(method === 'POST'
        ? client.save(operator.token, 'NONSECRET_REPLACEMENT_KEY_FIXTURE', before.revision, context)
        : client.remove(operator.token, before.revision, context)).rejects.toMatchObject({ code: 'refused', message: 'Setup request refused.' });
      expect(await client.load(operator.token, context)).toEqual(before);
      expect(base.resolveSelected()).toBe(original);
      expect(base.descriptors).toBe(descriptors);
      const listed = (await app.inject({ url: '/api/studio/model-connections', headers })).json();
      expect(listed.selectedId).toBe('anthropic');
      expect(listed.connections).toEqual(descriptors);
    }
    expect(transport.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'GET', 'DELETE', 'GET']);
    expect(statuses).toEqual([200, 403, 200, 403, 200]);
    expect(create).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it('mounts opted-in authenticated setup at the real composition root and keeps its registry live', async () => {
  const { create, options } = fixture();
  const app = createServer(options as ServerOptions);
  try {
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
    const beforeResponse = await app.inject({ method: 'GET', url: path, headers });
    expect(beforeResponse.statusCode).toBe(200);
    expect(beforeResponse.headers['cache-control']).toBe('no-store');
    const before = beforeResponse.json();
    expect(before).toEqual({ available: true, persistence: 'server-memory', model: 'fixture-claude', status: 'unavailable', revision: expect.any(String) });
    const configured = await app.inject({ method: 'POST', url: path, headers, payload: { apiKey: 'nonsecret-development-key', expectedRevision: before.revision } });
    expect(configured.statusCode).toBe(200);
    expect((await app.inject({ url: path, headers })).json()).toEqual(configured.json());
    const listed = (await app.inject({ url: '/api/studio/model-connections', headers })).json();
    expect(listed.selectedId).toBeNull();
    expect(listed.connections).toHaveLength(4);
    expect(listed.connections.find((d: {id: string}) => d.id === 'anthropic')).toEqual({ id: 'anthropic', label: 'Anthropic API', model: 'fixture-claude', status: 'configured', verification: 'not-probed' });
    expect((await app.inject({ url: '/api/studio/health', headers })).json()).toEqual({ ok: true, selectedId: null, model: null, modelStatus: 'unselected', verification: 'not-probed', processBuild: 'registered-templates-v1' });
    expect(create).not.toHaveBeenCalled();
    const unselected = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Review incoming requests.' } });
    expect(unselected.statusCode).toBe(409);
    expect(unselected.json().status).toBe('model-connection-unselected');
    expect(create).not.toHaveBeenCalled();
    const selected = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Review incoming requests.', connectionId: 'anthropic' } });
    expect(selected.statusCode).toBe(200);
    expect(selected.json().status).toBe('needs_input');
    expect(create).toHaveBeenCalledTimes(1);
    const removed = await app.inject({ method: 'DELETE', url: path, headers, payload: { expectedRevision: configured.json().revision } });
    expect(removed.statusCode).toBe(200);
    expect((await app.inject({ url: path, headers })).json()).toEqual(removed.json());
    expect(removed.json().status).toBe('unavailable');
    const afterRemoval = (await app.inject({ url: '/api/studio/model-connections', headers })).json();
    expect(afterRemoval.selectedId).toBeNull();
    expect(afterRemoval.connections.find((d: {id: string}) => d.id === 'anthropic').status).toBe('unavailable');
    const refused = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Review incoming requests.', connectionId: 'anthropic' } });
    expect(refused.statusCode).toBe(409);
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([before, listed, afterRemoval, selected.json(), removed.json()])).not.toMatch(/nonsecret-development-key|bindingId|apiKey|baseURL/);
  } finally { await app.close(); }
});

it('requires the exact trusted environment opt-in and permits an explicit disabled override', async () => {
  const source = `
    import { createServer } from './server/index.ts';
    import { createModelConnections } from './server/model-connections.ts';
    import { createMemoryGrantStore } from './packages/approvals/src/store.ts';
    const app = createServer({ operator: ${JSON.stringify(operator)}, modelConnections: createModelConnections({env:{}}), store: createMemoryGrantStore(), ...(process.env.FIXTURE_FORCE_OFF === '1' ? {anthropicSessionSetup:{enabled:false}} : {}) });
    try { console.log(JSON.stringify({ status: (await app.inject({url:${JSON.stringify(path)},headers:{authorization:${JSON.stringify(headers.authorization)},host:'127.0.0.1'}})).statusCode })); }
    finally { await app.close(); }
  `;
  for (const [flag, forceOff, expected] of [[undefined, false, 404], ['true', false, 404], ['0', false, 404], ['1', false, 200], ['1', true, 404]] as const) {
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: process.cwd(), env: { PATH: process.env.PATH ?? '', ...(process.env.TMPDIR === undefined ? {} : {TMPDIR: process.env.TMPDIR}), ...(flag === undefined ? {} : {STUDIO_ANTHROPIC_SESSION_SETUP: flag}), ...(forceOff ? {FIXTURE_FORCE_OFF:'1'} : {}) },
    });
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({status: expected});
  }
});

it('serves the actual bounded browser client over HTTP without a provider call or restart persistence', async () => {
  const { create, options } = fixture();
  const app = createServer(options);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const transport = vi.fn<typeof fetch>((input, init) => fetch(new URL(String(input), address), init));
  const client = new AnthropicSetupClient(transport);
  const context = { signal: new AbortController().signal, isCurrent: () => true };
  let initialRevision = '';
  try {
    await expect(client.load('wrong-development-operator', context)).rejects.toMatchObject({ code: 'auth' });
    const before = await client.load(operator.token, context);
    initialRevision = before.revision;
    expect(before.status).toBe('unavailable');
    const configured = await client.save(operator.token, 'nonsecret-development-key', before.revision, context);
    expect(configured.status).toBe('configured');
    expect(configured.revision).not.toBe(before.revision);
    expect(await client.load(operator.token, context)).toEqual(configured);
    await expect(client.save(operator.token, 'another-nonsecret-development-key', before.revision, context)).rejects.toMatchObject({ code: 'conflict' });
    expect(await client.load(operator.token, context)).toEqual(configured);
    const checked = await checkConnection('alpha', operator.token, transport);
    expect(checked.selectedId).toBeNull();
    expect(checked.modelStatus).toBe('unselected');
    expect(checked.connections.find(d => d.id === 'anthropic')).toMatchObject({ status: 'configured', verification: 'not-probed' });
    const crossOrigin = await fetch(address + path, { headers: { authorization: headers.authorization, origin: 'http://localhost:3112', 'x-forwarded-host': new URL(address).host } });
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get('cache-control')).toBe('no-store');
    expect(await crossOrigin.json()).toEqual({ error: 'private same-origin setup required' });
    const removed = await client.remove(operator.token, configured.revision, context);
    expect(removed.status).toBe('unavailable');
    expect(await client.load(operator.token, context)).toEqual(removed);
    const reconfigured = await client.save(operator.token, 'nonsecret-development-key', removed.revision, context);
    expect(reconfigured.status).toBe('configured');
    expect(await client.load(operator.token, context)).toEqual(reconfigured);
    expect(create).not.toHaveBeenCalled();
    expect(transport.mock.calls.filter(([input]) => String(input) === path).every(([, init]) => init?.credentials === 'omit' && init.redirect === 'error' && init.cache === 'no-store')).toBe(true);
  } finally { await app.close(); }
  const recreated = createServer(options);
  try {
    const response = await recreated.inject({ url: path, headers });
    expect(response.json().status).toBe('unavailable');
    expect(response.json().revision).not.toBe(initialRevision);
    expect(create).not.toHaveBeenCalled();
  } finally { await recreated.close(); }
});

it('requires a fresh exact-context skill-send review after rotating the session key', async () => {
  const { create, options } = fixture();
  create.mockImplementation(async () => ({ content: [{ type: 'text', text: JSON.stringify({ target: 'workflow', reason: 'A process.' }) }], stop_reason: 'end_turn', model: 'fixture-claude', usage: { input_tokens: 1, output_tokens: 1 } }));
  const skill = { id: 'review', version: '1', content: 'review queue shows human_review for legal. human gate: human_review. country de.' };
  const app = createServer({ ...options, projectSkillSource: async () => [skill] });
  try {
    const before = (await app.inject({ url: path, headers })).json();
    const configured = (await app.inject({ method: 'POST', url: path, headers, payload: { apiKey: 'nonsecret-development-key', expectedRevision: before.revision } })).json();
    const body = { prompt: 'Review incoming requests for legal.', projectId: 'alpha', connectionId: 'anthropic' };
    const pending = (await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: body })).json();
    expect(pending.status).toBe('model-request-refused');
    expect(pending.review.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(create).toHaveBeenCalledTimes(1);
    const rotated = await app.inject({ method: 'POST', url: path, headers, payload: { apiKey: 'nonsecret-development-key', expectedRevision: configured.revision } });
    expect(rotated.statusCode).toBe(200);
    expect((await app.inject({ url: path, headers })).json()).toEqual(rotated.json());
    create.mockClear();
    const stale = (await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { ...body, reviewedSkillHash: pending.review.hash } })).json();
    expect(stale.status).toBe('model-request-refused');
    expect(stale.review.hash).not.toBe(pending.review.hash);
    expect(create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(create.mock.calls)).not.toContain(skill.content);
    expect(JSON.stringify([pending, stale])).not.toMatch(/studio-anthropic-session-v1|nonsecret-development-key|bindingId/);
  } finally { await app.close(); }
});

it.each(['POST', 'DELETE'] as const)('retains real-root capacity until the original SDK settles after %s and refuses its stale result', async method => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { options } = fixture();
  const create = vi.fn(async () => {
    await gate;
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'needs_input', questions: [{ id: 'late', question: 'STALE SDK RESULT' }] }) }], stop_reason: 'end_turn', model: 'fixture-claude', usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const app = createServer({ ...options, requestAdmission: { global: 1 }, anthropicSessionSetup: { ...options.anthropicSessionSetup, anthropicClient: { messages: { create } } as unknown as Anthropic } });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const auth = { authorization: headers.authorization, 'content-type': 'application/json' };
  const body = JSON.stringify({ prompt: 'Review incoming requests.', connectionId: 'anthropic' });
  let pending: Promise<Response> | undefined;
  try {
    const before = await (await fetch(address + path, { headers: auth })).json();
    const configured = await (await fetch(address + path, { method: 'POST', headers: auth, body: JSON.stringify({ apiKey: 'nonsecret-development-key', expectedRevision: before.revision }) })).json();
    let settled = false;
    pending = fetch(address + '/api/studio/create', { method: 'POST', headers: auth, body }).then(response => { settled = true; return response; });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const changed = await fetch(address + path, { method, headers: auth, body: JSON.stringify({ expectedRevision: configured.revision, ...(method === 'POST' ? { apiKey: 'nonsecret-development-replacement' } : {}) }) });
    expect(changed.status).toBe(200);
    const readback = await (await fetch(address + path, { headers: auth })).json();
    expect(readback).toEqual(await changed.json());
    expect(readback.status).toBe(method === 'POST' ? 'configured' : 'unavailable');
    expect(settled).toBe(false);
    const refused = await fetch(address + '/api/studio/create', { method: 'POST', headers: auth, body });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'request capacity unavailable' });
    expect(create).toHaveBeenCalledTimes(1);
    release();
    const stale = await (await pending).json();
    expect(stale.status).toBe('invalid_determination');
    expect(JSON.stringify(stale)).not.toContain('STALE SDK RESULT');
    if (method === 'POST') {
      const fresh = await fetch(address + '/api/studio/create', { method: 'POST', headers: auth, body });
      expect((await fresh.json()).status).toBe('needs_input');
      expect(create).toHaveBeenCalledTimes(2);
    } else {
      expect((await fetch(address + '/api/studio/create', { method: 'POST', headers: auth, body })).status).toBe(409);
      expect(create).toHaveBeenCalledTimes(1);
    }
  } finally { release(); await pending; await app.close(); }
});

it('keeps real-root shutdown pending until an ignored-abort SDK promise actually settles', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let signal: AbortSignal | undefined;
  const { options } = fixture();
  const create = vi.fn(async (_body: unknown, requestOptions?: {signal?: AbortSignal}) => {
    signal = requestOptions?.signal;
    await gate;
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'needs_input', questions: [{ id: 'late', question: 'STALE SHUTDOWN RESULT' }] }) }], stop_reason: 'end_turn', model: 'fixture-claude', usage: { input_tokens: 1, output_tokens: 1 } };
  });
  const app = createServer({ ...options, requestAdmission: { global: 1, drainMs: 2000 }, anthropicSessionSetup: { ...options.anthropicSessionSetup, anthropicClient: { messages: { create } } as unknown as Anthropic } });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const auth = { authorization: headers.authorization, 'content-type': 'application/json' };
  let pending: Promise<Response> | undefined, closing: Promise<void> | undefined;
  try {
    const before = await (await fetch(address + path, { headers: auth })).json();
    expect((await fetch(address + path, { method: 'POST', headers: auth, body: JSON.stringify({ apiKey: 'nonsecret-development-key', expectedRevision: before.revision }) })).status).toBe(200);
    pending = fetch(address + '/api/studio/create', { method: 'POST', headers: auth, body: JSON.stringify({ prompt: 'Review incoming requests.', connectionId: 'anthropic' }) });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    let closed = false;
    closing = app.close().then(() => { closed = true; });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(closed).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    release();
    const stale = await (await pending).json();
    expect(stale.status).toBe('invalid_determination');
    expect(JSON.stringify(stale)).not.toContain('STALE SHUTDOWN RESULT');
    await closing;
    expect(closed).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  } finally { release(); await pending; await (closing ?? app.close()); }
});
