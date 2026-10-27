import { expect, it, vi } from 'vitest';
import { createServer } from '../index';
import { createModelConnections, type ModelConnectionRegistry } from '../model-connections';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
const operator = {actor: 'Karsten Haldan', token: 'a-sufficiently-long-operator-token'};
const headers = {authorization: `Bearer ${operator.token}`};
const routes = ['/api/studio/create', '/api/studio/build', '/api/studio/blocks/propose'];
it.each(routes)('authenticates before selection/resolution/source lookup at %s', async url => {
  const registry = createModelConnections({env: {}});
  const resolve = vi.fn(registry.resolve);
  const selected = vi.fn(() => registry.selectedId);
  const source = vi.fn(async () => []);
  const app = createServer({operator, modelConnections: {...registry, resolve, get selectedId() {return selected();}}, projectSkillSource: source, store: createMemoryGrantStore()});
  try {
    for (const payload of [{prompt: 'Review requests.', connectionId: 'local'}, {prompt: 'Review requests.'}, {connectionId: 'unknown', endpoint: 'private'}]) {
      expect((await app.inject({method: 'POST', url, payload})).statusCode).toBe(401);
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
    expect(source).not.toHaveBeenCalled();
  } finally {await app.close();}
});
it.each(routes)('rejects browser model/config/binding overrides and invalid IDs at %s', async url => {
  const registry = createModelConnections({env: {}});
  const resolve = vi.fn(registry.resolve);
  const app = createServer({operator, modelConnections: {...registry, resolve}, store: createMemoryGrantStore()});
  try {
    for (const fields of [{connectionId: 'unknown'}, {connectionId: null}, {connectionId: ''}, {model: 'fixture'}, {endpoint: 'https://private.test'}, {apiKey: 'fixture-secret'}, {modelBindingId: 'forged'}, {llmBindingId: 'forged'}]) {
      const response = await app.inject({method: 'POST', url, headers, payload: {prompt: 'Review requests.', ...fields}});
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toMatch(/private\.test|fixture-secret|forged/);
    }
    expect(resolve).not.toHaveBeenCalled();
  } finally {await app.close();}
});
it.each(routes)('does not fall back from unavailable explicit or server selection at %s', async url => {
  const transport = vi.fn<typeof fetch>();
  const registry = createModelConnections({env: {STUDIO_MODEL_CONNECTION: 'codex-chatgpt', STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1', STUDIO_LOCAL_MODEL: 'fixture-model'}, localFetch: transport});
  const app = createServer({operator, modelConnections: registry, store: createMemoryGrantStore()});
  try {
    for (const fields of [{}, {connectionId: 'codex-chatgpt'}, {connectionId: 'flightdeck'}, {connectionId: 'anthropic'}]) {
      const response = await app.inject({method: 'POST', url, headers, payload: {prompt: 'Review incoming requests.', ...fields}});
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({status: 'model-connection-unavailable', error: 'selected model connection unavailable'});
    }
    expect(transport).not.toHaveBeenCalled();
  } finally {await app.close();}
});
it.each(routes)('retains privacy gates before selected model transport at %s', async url => {
  const transport = vi.fn<typeof fetch>();
  const registry = createModelConnections({env: {STUDIO_MODEL_CONNECTION: 'local', STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1', STUDIO_LOCAL_MODEL: 'fixture-model'}, localFetch: transport});
  const app = createServer({operator, modelConnections: registry, store: createMemoryGrantStore()});
  try {
    const response = await app.inject({method: 'POST', url, headers, payload: {prompt: 'Track sick leave and union membership for the team.'}});
    expect(response.json().status).toBe('model-request-refused');
    expect(transport).not.toHaveBeenCalled();
  } finally {await app.close();}
});
it('uses an explicit server-selected connection without a browser ID and reports only not-probed configuration', async () => {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify({status: 'needs_input', questions: [{id: 'target', question: 'Workflow or application?'}]})}}]}), {status: 200}));
  const registry = createModelConnections({env: {STUDIO_MODEL_CONNECTION: 'local', STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1', STUDIO_LOCAL_MODEL: 'fixture-model'}, localFetch: transport});
  const app = createServer({operator, modelConnections: registry, store: createMemoryGrantStore()});
  try {
    const response = await app.inject({method: 'POST', url: '/api/studio/create', headers, payload: {prompt: 'Review requests.'}});
    expect(response.json().status).toBe('needs_input');
    expect(transport).toHaveBeenCalledTimes(1);
    const health = await app.inject({url: '/api/studio/health', headers});
    expect(health.json()).toEqual({ok: true, selectedId: 'local', model: 'fixture-model', modelStatus: 'configured', verification: 'not-probed', processBuild: 'registered-templates-v1'});
  } finally {await app.close();}
});
it.each(routes)('fails closed without explicit selection at %s, even with a configured local provider', async url => {
  const transport = vi.fn<typeof fetch>();
  const registry = createModelConnections({env: {STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1', STUDIO_LOCAL_MODEL: 'fixture-model'}, localFetch: transport});
  const resolve = vi.fn(registry.resolve);
  const app = createServer({operator, modelConnections: {...registry, resolve}, store: createMemoryGrantStore()});
  try {
    const response = await app.inject({method: 'POST', url, headers, payload: {prompt: 'Review incoming requests.'}});
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({status: 'model-connection-unselected', error: 'select a model connection'});
    expect(resolve).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  } finally {await app.close();}
});
it.each(routes)('resolves explicit local selection once and uses its transport at %s', async url => {
  const output = url.endsWith('/create') ? {status: 'needs_input', questions: [{id: 'target', question: 'Workflow or application?'}]} : url.endsWith('/propose') ? {id: 'reviewFields', label: 'review fields', baseType: 'set', defaults: {fields: {reviewNeeded: true}}, description: 'Mark requests for review.'} : {};
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(output)}}]}), {status: 200}));
  const registry = createModelConnections({env: {STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1', STUDIO_LOCAL_MODEL: 'fixture-model'}, localFetch: transport});
  const resolve = vi.fn(registry.resolve);
  const app = createServer({operator, modelConnections: {...registry, resolve}, store: createMemoryGrantStore()});
  try {
    const response = await app.inject({method: 'POST', url, headers, payload: {prompt: 'Review incoming requests.', connectionId: 'local'}});
    expect(response.statusCode).toBe(200);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('local');
    // The admitted HTTP contract forbids automatic repair/provider retries,
    // including an invalid build draft. Classifier/planner sequencing is tested separately.
    expect(transport).toHaveBeenCalledTimes(1);
    expect(response.json().status).toBe(url.endsWith('/create') ? 'needs_input' : url.endsWith('/propose') ? 'block-proposed' : 'invalid_draft');
  } finally {await app.close();}
});
it('keeps public health a liveness response and reports authenticated configuration without claiming verification', async () => {
  const registry = createModelConnections({env: {STUDIO_MODEL_CONNECTION: 'codex-chatgpt'}});
  const read = vi.fn(() => registry.descriptors);
  const selected = vi.fn(() => registry.selectedId);
  const app = createServer({operator, modelConnections: {...registry, get descriptors() {return read();}, get selectedId() {return selected();}}, store: createMemoryGrantStore()});
  try {
    expect((await app.inject({url: '/api/studio/health'})).json()).toEqual({ok: true});
    expect(read).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
    const health = await app.inject({url: '/api/studio/health', headers});
    expect(health.json()).toEqual({ok: true, selectedId: 'codex-chatgpt', model: null, modelStatus: 'unavailable', verification: 'not-probed', processBuild: 'registered-templates-v1'});
    expect(health.body).not.toMatch(/bindingId|baseUrl|apiKey|endpoint/);
  } finally {await app.close();}
});
it('refuses a trusted registry resolution missing destination binding before any model call', async () => {
  const llm = vi.fn(async () => ({text: '{}'}));
  const base = createModelConnections({env: {}});
  const registry: ModelConnectionRegistry = {...base, resolve: () => ({descriptor: {id: 'local', label: 'fixture', model: 'fixture-model', status: 'configured', verification: 'not-probed'}, bindingId: '', llm})};
  const app = createServer({operator, modelConnections: registry, store: createMemoryGrantStore()});
  try {
    for (const url of routes) {
      const response = await app.inject({method: 'POST', url, headers, payload: {prompt: 'Review requests.', connectionId: 'local'}});
      expect(response.statusCode).toBe(409);
      expect(response.json().status).toBe('model-connection-unavailable');
      expect(response.json()).not.toHaveProperty('review');
    }
    expect(llm).not.toHaveBeenCalled();
  } finally {await app.close();}
});
it('requires an explicit trusted review binding for the injected LLM seam', () => {
  expect(() => createServer({operator, llm: async () => ({text: '{}'}), store: createMemoryGrantStore()})).toThrow('Trusted LLM injection requires a model binding');
});
it('authenticates before reading the browser-safe model list', async () => {
  const registry = createModelConnections({env: {}});
  const read = vi.fn(() => registry.descriptors);
  const guarded = {...registry, get descriptors() {return read();}};
  const app = createServer({operator, modelConnections: guarded, store: createMemoryGrantStore()});
  try {
    expect((await app.inject({url: '/api/studio/model-connections'})).statusCode).toBe(401);
    expect(read).not.toHaveBeenCalled();
    const response = await app.inject({url: '/api/studio/model-connections', headers});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({connections: registry.descriptors, selectedId: null});
    expect(read).toHaveBeenCalledTimes(1);
    expect(response.body).not.toMatch(/bindingId|baseUrl|apiKey|endpoint/);
  } finally {await app.close();}
});
