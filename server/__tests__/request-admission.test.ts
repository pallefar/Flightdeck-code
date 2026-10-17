import { expect, it, vi } from 'vitest';
import { createServer } from '../index';
import { RequestAdmission } from '../request-admission';
import { createModelConnections } from '../model-connections';
import { request as httpRequest } from 'node:http';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
const operator = { actor: 'Alice Operator', token: 'admission-fixture-token-at-least-24-chars' };
const headers = { authorization: `Bearer ${operator.token}` };
it('enforces independent global/actor/project caps and immediately removes idle scope entries', async () => {
  const a = new RequestAdmission({ global: 3, actor: 2, project: 1 });
  const one = a.acquire('Alice Operator', 'alpha')!;
  expect(a.acquire('Bob Reviewer', 'alpha')).toBeUndefined();
  const two = a.acquire('Alice Operator', 'beta')!;
  expect(a.acquire('Alice Operator', 'novel')).toBeUndefined();
  expect(a.acquire(' alice operator ', 'novel')).toBeUndefined();
  const three = a.acquire('Bob Reviewer', 'gamma')!;
  expect(a.acquire('Carol Reviewer', 'novel')).toBeUndefined();
  await one.release(); await two.release(); await three.release();
  expect(a.snapshot()).toEqual({ active: 0, actors: 0, projects: 0, accepting: true });
  for (let i = 0; i < 1000; i++) await a.acquire(`fixture-${i}`, `project-${i}`)!.release();
  expect(a.snapshot().projects).toBe(0);
  for (const config of [{ global: 0 }, { actor: 101 }, { project: NaN }, { global: 1.5 }, { queue: 1 }, { actor: undefined }]) expect(() => new RequestAdmission(config as any)).toThrow('invalid request admission options');
});

it('keeps capacity through soft abort until tracked work actually settles and closes with a bounded drain', async () => {
  const gate = barrier();
  const a = new RequestAdmission({ global: 1, deadlineMs: 20, drainMs: 20 });
  const permit = a.acquire('Alice Operator', 'alpha')!;
  const work = permit.track(async signal => { await gate.promise; expect(signal.aborted).toBe(true); });
  await vi.waitFor(() => expect(permit.signal.aborted).toBe(true));
  const releasing = permit.release();
  expect(a.acquire('Bob Reviewer', 'beta')).toBeUndefined();
  expect(a.snapshot().active).toBe(1);
  await expect(a.close()).rejects.toThrow('request admission drain incomplete');
  expect(a.snapshot().accepting).toBe(false);
  gate.release(); await work; await releasing;
  expect(a.snapshot().active).toBe(0);
  expect(a.acquire('Bob Reviewer', 'beta')).toBeUndefined();
});
it('shares admission across model endpoints and suppresses provider retries after errors', async () => {
  const gate = barrier(); let entered = 0;
  const llm = vi.fn(async () => { entered++; await gate.promise; throw new Error('private provider detail'); });
  const app = createServer({ operator, llm, llmBindingId: 'admission-fixture', requestAdmission: { global: 1 }, store: createMemoryGrantStore() });
  const pending = app.inject({ method: 'POST', url: '/api/studio/build', headers, payload: { prompt: 'Show contract folders needing review, visible to legal and admin.' } });
  try {
    await vi.waitFor(() => expect(entered).toBe(1));
    for (const url of ['/api/studio/create', '/api/studio/blocks/propose']) expect((await app.inject({ method: 'POST', url, headers, payload: { prompt: 'Create a review queue.' } })).statusCode).toBe(429);
    gate.release(); await pending;
    expect(llm).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: 'POST', url: '/api/studio/blocks/propose', headers, payload: { prompt: 'Create a review queue.' } })).statusCode).toBe(200);
    expect(llm).toHaveBeenCalledTimes(2);
  } finally { gate.release(); await pending; await app.close(); }
});
it('retains one permit from classifier through planner and rejects before registry resolution', async () => {
  const classifier = barrier(), planner = barrier(); let entered = 0;
  const registry = createModelConnections({ env: { STUDIO_MODEL_CONNECTION: 'flightdeck' }, flightdeckModel: 'fixture-model', flightdeckBindingId: 'fixture-policy', flightdeckLlm: async () => { entered++; if (entered === 1) { await classifier.promise; return { text: JSON.stringify({ target: 'subapp', reason: 'A persistent dashboard.' }) }; } await planner.promise; return { text: '{}' }; } });
  const resolve = vi.fn(registry.resolve);
  const app = createServer({ operator, modelConnections: { ...registry, resolve }, requestAdmission: { global: 1 }, store: createMemoryGrantStore() });
  const pending = app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Show contract folders needing review, visible to legal and admin.', projectId: 'alpha' } });
  try {
    await vi.waitFor(() => expect(entered).toBe(1));
    expect((await app.inject({ method: 'POST', url: '/api/studio/build', headers, payload: { prompt: 'Create a review queue.', projectId: 'beta' } })).statusCode).toBe(429);
    expect(resolve).toHaveBeenCalledTimes(1);
    classifier.release(); await vi.waitFor(() => expect(entered).toBe(2));
    expect((await app.inject({ method: 'POST', url: '/api/studio/blocks/propose', headers, payload: { prompt: 'Create a review queue.' } })).statusCode).toBe(429);
    planner.release(); await pending; expect(entered).toBe(2); expect(resolve).toHaveBeenCalledTimes(1);
  } finally { classifier.release(); planner.release(); await pending; await app.close(); }
});
it('holds a soft-aborted provider at the real root until settlement without retry', async () => {
  const gate = barrier(); let signal: AbortSignal | undefined, entered = 0;
  const app = createServer({ operator, store: createMemoryGrantStore(), llmBindingId: 'abort-fixture', llm: async request => { entered++; signal = (request as typeof request & { signal: AbortSignal }).signal; await gate.promise; throw new Error('private failure'); }, requestAdmission: { global: 1, deadlineMs: 20 } });
  const pending = app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.', projectId: 'alpha' } });
  try {
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect((await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.', projectId: 'beta' } })).statusCode).toBe(429);
    expect(entered).toBe(1); gate.release(); await pending; expect(entered).toBe(1);
    expect((await app.inject({ method: 'POST', url: '/api/studio/blocks/propose', headers, payload: { prompt: 'Create a review queue.' } })).statusCode).toBe(200);
    expect(entered).toBe(2);
  } finally { gate.release(); await pending; await app.close(); }
});
it('propagates real browser socket disconnect without freeing a still-running provider', async () => {
  const gate = barrier(); let signal: AbortSignal | undefined, entered = 0;
  const app = createServer({ operator, store: createMemoryGrantStore(), llmBindingId: 'disconnect-fixture', llm: async request => { entered++; signal = (request as typeof request & { signal: AbortSignal }).signal; await gate.promise; return { text: 'invalid' }; }, requestAdmission: { global: 1 } });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = httpRequest(address + '/api/studio/create', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' } });
  client.on('error', () => {}); client.end(JSON.stringify({ prompt: 'Create a review queue.', projectId: 'alpha' }));
  try {
    await vi.waitFor(() => expect(entered).toBe(1)); client.destroy();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect((await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.', projectId: 'beta' } })).statusCode).toBe(429);
    expect(entered).toBe(1);
  } finally { client.destroy(); gate.release(); await app.close(); }
});
it('authenticates model intake before oversized or malformed bodies even at capacity', async () => {
  const app = createServer({ operator, store: createMemoryGrantStore() });
  try {
    for (const url of ['/api/studio/build', '/api/studio/create', '/api/studio/blocks/propose']) {
      expect((await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: '{' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ prompt: 'x'.repeat(1_000_100) }) })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify({ prompt: 'x'.repeat(1_000_100) }) })).statusCode).toBe(413);
    }
  } finally { await app.close(); }
});
it('bounds real composition-root close and never frees hung work or admits replacements', async () => {
  const gate = barrier(); let signal: AbortSignal | undefined, entered = 0;
  const app = createServer({ operator, store: createMemoryGrantStore(), llmBindingId: 'close-fixture', llm: async request => { entered++; signal = (request as typeof request & { signal: AbortSignal }).signal; await gate.promise; return { text: 'invalid' }; }, requestAdmission: { global: 1, drainMs: 20 } });
  const pending = app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.' } });
  try {
    await vi.waitFor(() => expect(entered).toBe(1));
    await expect(app.close()).rejects.toThrow('request admission drain incomplete');
    expect(signal?.aborted).toBe(true); expect(entered).toBe(1);
    await expect(app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.' } })).rejects.toThrow();
  } finally { gate.release(); await pending; }
});
function barrier() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
it('admits only two of twelve authenticated novel-project requests before provider acquisition', async () => {
  const gate = barrier(); let entered = 0, refused = 0;
  const llm = vi.fn(async () => { entered++; await gate.promise; return { text: 'invalid fixture determination' }; });
  const app = createServer({ operator, llm, llmBindingId: 'admission-fixture', store: createMemoryGrantStore() });
  const pending = Array.from({ length: 12 }, (_, i) => app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.', projectId: `project-${i}` } }).then((r: { statusCode: number; headers: Record<string, unknown>; json(): unknown }) => { if (r.statusCode === 429) { refused++; expect(r.headers['retry-after']).toBe('1'); expect(r.json()).toEqual({ error: 'request capacity unavailable' }); } return r; }));
  try {
    await vi.waitFor(() => expect(entered).toBeGreaterThanOrEqual(2));
    await new Promise(r => setTimeout(r, 30));
    expect(entered).toBe(2);
    await vi.waitFor(() => expect(refused).toBe(10));
    expect((await app.inject({ method: 'POST', url: '/api/studio/create', payload: { prompt: 'Create a review queue.' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a review queue.', actor: 'Bob Reviewer' } })).statusCode).toBe(400);
  } finally { gate.release(); await Promise.all(pending); await app.close(); }
});
