import { expect, it, vi } from 'vitest';
import { createServer } from '../index';
import { createModelConnections, type ModelConnectionId, type ModelConnectionRegistry } from '../model-connections';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
import { EXAMPLE_DRAFT_JSON } from '../../packages/spec/src/prompt';
const operator = {actor: 'Karsten Haldan', token: 'a-sufficiently-long-operator-token'};
const headers = {authorization: `Bearer ${operator.token}`};
const body = {prompt: 'Review incoming requests for legal.', projectId: 'alpha'};
const skill = {id: 'review', version: '1', content: 'review queue shows human_review for legal. human gate: human_review. country de.'};
const draft = {
  workflow: {name: 'Review', slug: 'review-flow', country: 'DE', intakeFields: [{name: 'request', type: 'string', required: true}], steps: ['intake_received', 'human_review', 'complete'], statutorySteps: ['human_review']},
  pages: [{slug: 'review-queue', title: 'Review queue', purpose: 'review queue shows human_review for legal.', sourceSkillIds: ['review'], stepIds: ['human_review'], icon: 'document', navSection: 'Contract pipeline', visibleToRoles: ['legal'], evidence: [{skillId: 'review', quote: 'review queue shows human_review for legal.'}]}],
};
const graph = {version: 1, id: 'reviewFlow', name: 'Review', nodes: [
  {id: 'intake_received', type: 'manual', label: 'intake', position: {x: 40, y: 120}, config: {}},
  {id: 'human_review', type: 'approval', label: 'review', position: {x: 320, y: 120}, config: {reason: 'human review required'}},
  {id: 'complete', type: 'output', label: 'complete', position: {x: 600, y: 120}, config: {}},
], edges: [{id: 'edge1', source: 'intake_received', target: 'human_review'}, {id: 'edge2', source: 'human_review', target: 'complete'}], customBlocks: []};
const completion = (system: string) => system.includes('STUDIO_DETERMINATION_V1') ? {target: 'workflow', reason: 'A process.'} : system.includes('strict JSON Graph object') ? graph : draft;
function fixtureRegistry(model = 'fixture-model', endpoint = 'http://127.0.0.1:1234/v1', policy = 'approved-fixture-task-v1') {
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(init!.body as string);
    return new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(completion(request.messages[0].content))}}]}), {status: 200});
  });
  // Trusted future-bridge fixture only; not an actual approved host integration.
  const bridge = vi.fn(async (request: {system: string}) => ({text: JSON.stringify(completion(request.system))}));
  const registry = createModelConnections({env: {STUDIO_LOCAL_BASE_URL: endpoint, STUDIO_LOCAL_MODEL: model}, localFetch: transport, flightdeckLlm: bridge, flightdeckModel: model, flightdeckBindingId: policy});
  return {registry, transport, bridge};
}
function serve(registry: ModelConnectionRegistry) {return createServer({operator, modelConnections: registry, store: createMemoryGrantStore(), projectSkillSource: async () => [skill]});}
async function pendingHash(registry: ModelConnectionRegistry, connectionId: ModelConnectionId) {
  const app = serve(registry);
  try {
    const response = await app.inject({method: 'POST', url: '/api/studio/create', headers, payload: {...body, connectionId}});
    expect(response.json().status).toBe('model-request-refused');
    return response.json().review.hash as string;
  } finally {await app.close();}
}
it.each(['id', 'model', 'endpoint', 'policy'] as const)('invalidates HTTP skill send review after changing only resolved %s', async change => {
  const first = fixtureRegistry();
  const initialId = change === 'policy' ? 'flightdeck' : 'local';
  const hash = await pendingHash(first.registry, initialId);
  const next = fixtureRegistry(change === 'model' ? 'another-model' : 'fixture-model', change === 'endpoint' ? 'http://127.0.0.1:4321/v1' : 'http://127.0.0.1:1234/v1', change === 'policy' ? 'approved-fixture-task-v2' : 'approved-fixture-task-v1');
  const nextId = change === 'id' || change === 'policy' ? 'flightdeck' : 'local';
  const app = serve(next.registry);
  try {
    const response = await app.inject({method: 'POST', url: '/api/studio/create', headers, payload: {...body, connectionId: nextId, reviewedSkillHash: hash}});
    expect(response.json().status).toBe('model-request-refused');
    expect(response.json().review.hash).not.toBe(hash);
    expect(nextId === 'local' ? next.transport.mock.calls.length : next.bridge.mock.calls.length).toBe(1);
    const calls = nextId === 'local' ? JSON.stringify(next.transport.mock.calls) : JSON.stringify(next.bridge.mock.calls);
    expect(calls).not.toContain(skill.content);
    expect(response.body).not.toContain(next.registry.resolve(nextId).bindingId);
    expect(response.body).not.toContain('http://127.0.0.1');
  } finally {await app.close();}
});
it('holds one resolved client through reviewed classifier, workflow and graph calls', async () => {
  const fixture = fixtureRegistry();
  const resolve = vi.fn(fixture.registry.resolve);
  const app = serve({...fixture.registry, resolve});
  try {
    const pending = await app.inject({method: 'POST', url: '/api/studio/create', headers, payload: {...body, connectionId: 'local'}});
    const hash = pending.json().review.hash;
    expect(fixture.transport).toHaveBeenCalledTimes(1);
    resolve.mockClear(); fixture.transport.mockClear();
    const response = await app.inject({method: 'POST', url: '/api/studio/create', headers, payload: {...body, connectionId: 'local', reviewedSkillHash: hash}});
    expect(response.json()).toMatchObject({status: 'workflow-proposed', graph});
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('local');
    expect(fixture.transport).toHaveBeenCalledTimes(3);
    expect(fixture.bridge).not.toHaveBeenCalled();
    for (const [url, init] of fixture.transport.mock.calls) {
      expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
      expect(JSON.parse(init!.body as string).model).toBe('fixture-model');
    }
  } finally {await app.close();}
});
it('holds one resolved connection through classifier and successful subapp builder', async () => {
  const prompt = 'Show contract folders needing review, visible to legal and admin.';
  const subapp = JSON.parse(EXAMPLE_DRAFT_JSON);
  subapp.spec.visibleToRoles = {roles: ['legal', 'admin'], evidence: 'visible to legal and admin'};
  subapp.spec.capabilities = [{capability: 'read:contracts', evidence: 'contract folders needing review'}];
  subapp.understanding = prompt;
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const system = JSON.parse(init!.body as string).messages[0].content as string;
    const output = system.includes('STUDIO_DETERMINATION_V1') ? {target: 'subapp', reason: 'A persistent dashboard.'} : subapp;
    return new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {content: JSON.stringify(output)}}]}), {status: 200});
  });
  const registry = createModelConnections({env: {STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1', STUDIO_LOCAL_MODEL: 'fixture-model'}, localFetch: transport});
  const resolve = vi.fn(registry.resolve);
  const app = serve({...registry, resolve});
  try {
    const response = await app.inject({method: 'POST', url: '/api/studio/create', headers, payload: {prompt, connectionId: 'local'}});
    expect(response.json()).toMatchObject({status: 'subapp-result', outcome: {status: 'proposed'}});
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
  } finally {await app.close();}
});
