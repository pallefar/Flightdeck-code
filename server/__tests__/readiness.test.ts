import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { RequestAdmission } from '../request-admission';
import { registerReadinessRoute } from '../readiness';
import { createServer } from '../index';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
import type { ModelConnectionDescriptor, ModelConnectionRegistry } from '../model-connections';

const operator = { actor: 'Alice Operator', token: 'readiness-development-token-at-least-24-chars' };

it('reports process admission readiness without touching model descriptors or resolving a provider', async () => {
  let descriptorReads = 0, providerResolutions = 0;
  const registry: ModelConnectionRegistry = {
    selectedId: 'anthropic',
    get descriptors(): readonly ModelConnectionDescriptor[] { descriptorReads++; throw new Error('private configuration must stay unread'); },
    resolve() { providerResolutions++; throw new Error('no provider probe'); },
    resolveSelected() { providerResolutions++; throw new Error('no provider probe'); },
  };
  const app = createServer({ operator, store: createMemoryGrantStore(), modelConnections: registry });
  try {
    for (const headers of [{}, { authorization: `Bearer ${operator.token}` }]) {
      const response = await app.inject({ method: 'GET', url: '/api/studio/ready', headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ready: true, scope: 'request-admission' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain(operator.actor);
      expect(response.body).not.toContain(operator.token);
    }
    expect(descriptorReads).toBe(0);
    expect(providerResolutions).toBe(0);
    const liveness = await app.inject({ method: 'GET', url: '/api/studio/health' });
    expect(liveness.statusCode).toBe(200);
    expect(liveness.json()).toEqual({ ok: true });
    expect(descriptorReads).toBe(0);
    expect(providerResolutions).toBe(0);
  } finally { await app.close(); }
});

it('serves socket readiness and HEAD without exposing configuration', async () => {
  const app = createServer({ operator, store: createMemoryGrantStore(), modelConnections: {
    descriptors: [], selectedId: undefined,
    resolve() { throw new Error('no provider'); },
    resolveSelected() { throw new Error('no provider'); },
  } });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${origin}/api/studio/ready`, { signal: AbortSignal.timeout(2000) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ready: true, scope: 'request-admission' });
    const head = await fetch(`${origin}/api/studio/ready`, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('no-store');
    expect(await head.text()).toBe('');
  } finally { await app.close(); }
});

it('returns unavailable after admission stops and never regains readiness after a hung drain settles', async () => {
  const admission = new RequestAdmission({ global: 1, drainMs: 10 });
  const app = Fastify({ logger: false });
  registerReadinessRoute(app, admission);
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const permit = admission.acquire('Alice Operator', 'private-project')!;
  const work = permit.track(async () => { await gate; });
  let releasing: Promise<void> | undefined;
  try {
    expect((await app.inject({ method: 'GET', url: '/api/studio/ready' })).json()).toEqual({ ready: true, scope: 'request-admission' });
    admission.stop();
    expect(permit.signal.aborted).toBe(true);
    releasing = permit.release();
    const response = await app.inject({ method: 'GET', url: '/api/studio/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ready: false, scope: 'request-admission' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['retry-after']).toBe('1');
    expect(admission.snapshot().active).toBe(1);
    expect(admission.acquire('Bob Reviewer', 'another-project')).toBeUndefined();
    await expect(admission.close()).rejects.toThrow('request admission drain incomplete');
    expect((await app.inject({ method: 'GET', url: '/api/studio/ready' })).statusCode).toBe(503);
    finish(); await work; await releasing;
    expect(admission.snapshot().active).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/studio/ready' })).statusCode).toBe(503);
    expect(admission.acquire('Bob Reviewer', 'another-project')).toBeUndefined();
  } finally { finish(); await work; await (releasing ?? permit.release()); await app.close(); }
});
