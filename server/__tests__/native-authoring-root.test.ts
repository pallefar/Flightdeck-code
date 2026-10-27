import { expect, it, vi } from 'vitest';
import { createServer } from '../index';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
import { createModelConnections } from '../model-connections';
import Anthropic from '@anthropic-ai/sdk';
import { createWorkflowTemplate } from '../../src/workflow/WorkflowEditor';
import { parseStudioResult } from '../../src/studio/result';
import { generateSubApp } from '../../packages/codegen/src/pure';

const operator = { actor: 'Karsten Haldan', token: 'isolated-native-root-fixture-only' };
const headers = { authorization: `Bearer ${operator.token}` };
const fixtureModel = 'native-fixture-model';
function completion(content: unknown[], native = false, sequence = 1) {
  return new Response(JSON.stringify({ id: `msg_root_${sequence}`, type: 'message', role: 'assistant', model: fixtureModel,
    content, stop_reason: native ? 'tool_use' : 'end_turn', stop_sequence: null, container: null, stop_details: null,
    usage: { input_tokens: 5, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  }), { headers: { 'content-type': 'application/json' } });
}
function registryWith(send: typeof fetch) {
  const client = new Anthropic({ apiKey: 'synthetic-root-test', authToken: null, webhookKey: null,
    logLevel: 'off', baseURL: 'https://api.anthropic.com', maxRetries: 0, fetch: send });
  return createModelConnections({ env: { STUDIO_ANTHROPIC_MODEL: fixtureModel, FLIGHTDECK_EFFORT: 'low' }, anthropicClient: client });
}

it('creates a real native local workflow through the actual root and browser DTO with no project skills', async () => {
  const graph = createWorkflowTemplate('branch');
  const requests: any[] = [];
  const registry = registryWith(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (!body.tools) return completion([{ type: 'text', text: JSON.stringify({ target: 'workflow', reason: 'A conditional graph.' }) }], false, requests.length);
    return completion([{ type: 'tool_use', id: `call_${requests.length}`, name: requests.length === 2 ? 'read_block_catalog' : 'propose_workflow_draft', input: requests.length === 2 ? {} : { graph } }], true, requests.length);
  });
  const source = vi.fn(async () => []);
  const app = createServer({ operator, modelConnections: registry, projectSkillSource: source, store: createMemoryGrantStore(), nativeAuthoringEnabled: true });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a conditional routing workflow with manual input and output.', projectId: 'native-fixture', authoringEngine: 'native-v1', connectionId: 'anthropic' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'workflow-graph-proposed', graph, projectId: 'native-fixture', skillSourceState: 'empty' });
    expect(parseStudioResult(response.json()).status).toBe('workflow-graph-proposed');
    expect(requests).toHaveLength(3);
    expect(requests[1].tools.map((tool: { name: string }) => tool.name)).toEqual(['read_block_catalog', 'read_block_schema', 'propose_workflow_draft']);
    expect(requests[2].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_2' });
    expect(registry.selectedId).toBeUndefined();
  } finally { await app.close(); }
});


it('routes native subapps through the actual installed SDK, pure generator and strict browser result', async () => {
  const spec = { profile: 'mini-app', id: 'review-form', label: 'Review form', icon: '📋', navSection: 'Contract pipeline', summary: 'Prepare a review proposal.', capabilities: ['write:inbox-proposal'], visibleToRoles: ['legal'], domains: [{ name: 'reviews', title: 'Reviews', routes: [{ method: 'POST', path: '/propose', summary: 'Prepare a proposal', operation: { kind: 'propose', proposalKind: 'review', ticketField: 'ticket', fields: [{ name: 'ticket', type: 'string', optional: false }], auditEvent: 'review-form.proposed' } }] }] };
  const answers = { 'consent:write:inbox-proposal': 'yes', visibleToRoles: 'legal', navSection: 'Contract pipeline', icon: '📋' };
  const requests: any[] = [];
  const registry = registryWith(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (!body.tools) return completion([{ type: 'text', text: JSON.stringify({ target: 'subapp', reason: 'A proposal form.' }) }], false, requests.length);
    return completion([{ type: 'tool_use', id: `call_${requests.length}`, name: requests.length === 2 ? 'read_subapp_contract' : 'propose_subapp_spec', input: requests.length === 2 ? {} : { spec, understanding: 'A review proposal form.' } }], true, requests.length);
  });
  const source = vi.fn(async () => { throw new Error('must remain lazy'); });
  const app = createServer({ operator, modelConnections: registry, projectSkillSource: source, store: createMemoryGrantStore(), nativeAuthoringEnabled: true });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a proposal form.', projectId: 'native-fixture', answers, authoringEngine: 'native-v1', connectionId: 'anthropic' } });
    expect(response.statusCode).toBe(200);
    const result = parseStudioResult(response.json());
    expect(result, response.body).toMatchObject({ status: 'subapp-result', outcome: { status: 'proposed', conformance: { ok: true }, artifacts: { decision: 'allow' } } });
    if (result.status !== 'subapp-result' || result.outcome.status !== 'proposed') throw new Error('Expected generated sub-app');
    expect(result.outcome.generated.files).toEqual(generateSubApp(spec).files);
    expect(result.outcome.generated.registryPatch).not.toHaveProperty('apply');
    expect(source).not.toHaveBeenCalled();
    expect(requests).toHaveLength(3);
    expect(requests[1].tools.map((tool: { name: string }) => tool.name)).toEqual(['read_subapp_contract', 'propose_subapp_spec']);
    expect(registry.selectedId).toBeUndefined();
  } finally { await app.close(); }
});

it.each(['valid', 'drop', 'bypass', 'rewrite'] as const)('holds reviewed project gate requirements in the real native broker: %s', async change => {
  const skill = { id: 'review', version: '1', content: 'review queue shows human_review for legal. human gate: human_review. country de.' };
  const planned = {
    workflow: { name: 'Review', slug: 'review-flow', country: 'DE', intakeFields: [{ name: 'request', type: 'string', required: true }], steps: ['intake_received', 'human_review', 'complete'], statutorySteps: ['human_review'] },
    pages: [{ slug: 'review-queue', title: 'Review queue', purpose: 'review queue shows human_review for legal.', sourceSkillIds: ['review'], stepIds: ['human_review'], icon: '📋', navSection: 'Contract pipeline', visibleToRoles: ['legal'], evidence: [{ skillId: 'review', quote: 'review queue shows human_review for legal.' }] }],
  };
  const requests: any[] = [];
  const registry = registryWith(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (!body.tools) return completion([{ type: 'text', text: JSON.stringify(JSON.stringify(body.system).includes('STUDIO_DETERMINATION_V1') ? { target: 'workflow', reason: 'A review process.' } : planned) }], false, requests.length);
    const graph = JSON.parse(body.messages[0].content).protectedGraph;
    if (change === 'drop') { graph.nodes = graph.nodes.filter((node: { id: string }) => node.id !== 'human_review'); graph.edges = [{ id: 'dropped', source: 'intake_received', target: 'complete' }]; }
    if (change === 'bypass') graph.edges.push({ id: 'bypass', source: 'intake_received', target: 'complete' });
    if (change === 'rewrite') graph.nodes[1].config = { reviewer: 'independent', reason: 'Altered gate conditions' };
    return completion([{ type: 'tool_use', id: `call_${requests.length}`, name: 'propose_workflow_draft', input: { graph } }], true, requests.length);
  });
  const app = createServer({ operator, modelConnections: registry, projectSkillSource: async () => [skill], store: createMemoryGrantStore(), nativeAuthoringEnabled: true });
  const payload = { prompt: 'Review incoming requests for legal.', projectId: 'native-fixture', authoringEngine: 'native-v1', connectionId: 'anthropic' };
  try {
    const pending = (await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload })).json();
    expect(pending).toHaveProperty('status', 'model-request-refused');
    expect(pending.review.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests)).not.toContain(skill.content);
    const response = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { ...payload, reviewedSkillHash: pending.review.hash } });
    expect(requests).toHaveLength(4);
    if (change === 'valid') {
      expect(parseStudioResult(response.json())).toMatchObject({ status: 'workflow-proposed', workflow: planned.workflow, graph: { nodes: [{ id: 'intake_received' }, { id: 'human_review', type: 'approval', config: { reviewer: 'independent' } }, { id: 'complete' }] } });
    } else {
      expect(response.json()).toHaveProperty('status', 'invalid_determination');
      expect(response.json()).not.toHaveProperty('graph');
      expect(response.body).not.toContain('Altered gate conditions');
    }
    expect(registry.selectedId).toBeUndefined();
  } finally { await app.close(); }
});

it('enforces six total sends including JSON determination and never falls back after native exhaustion', async () => {
  const requests: any[] = [];
  const registry = registryWith(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return body.tools
      ? completion([{ type: 'tool_use', id: `call_${requests.length}`, name: 'read_block_catalog', input: {} }], true, requests.length)
      : completion([{ type: 'text', text: JSON.stringify({ target: 'workflow', reason: 'A graph.' }) }], false, requests.length);
  });
  const app = createServer({ operator, modelConnections: registry, projectSkillSource: async () => [], store: createMemoryGrantStore(), nativeAuthoringEnabled: true });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Prepare a local workflow.', projectId: 'native-fixture', authoringEngine: 'native-v1', connectionId: 'anthropic' } });
    expect(response.json()).toMatchObject({ status: 'invalid_determination', issues: ['studio planning unavailable'] });
    expect(requests).toHaveLength(6);
    expect(requests.filter(request => !request.tools)).toHaveLength(1);
    expect(response.json()).not.toHaveProperty('graph');
  } finally { await app.close(); }
});

it('blocks sensitive caller context before any native or JSON provider send', async () => {
  const send = vi.fn<typeof fetch>();
  const source = vi.fn(async () => []);
  const app = createServer({ operator, modelConnections: registryWith(send), projectSkillSource: source, store: createMemoryGrantStore(), nativeAuthoringEnabled: true });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Prepare a local workflow.', answers: { note: 'Track sick leave and union membership.' }, projectId: 'native-fixture', authoringEngine: 'native-v1', connectionId: 'anthropic' } });
    expect(response.json()).toHaveProperty('status', 'model-request-refused');
    expect(send).not.toHaveBeenCalled();
    expect(source).not.toHaveBeenCalled();
    expect(response.body).not.toContain('sick leave');
  } finally { await app.close(); }
});

it('retains shared admission until an ignored-abort native SDK fetch really settles', async () => {
  let resume!: () => void; let entered!: () => void;
  const hold = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let sends = 0;
  const registry = registryWith(async (_url, init) => {
    sends++;
    if (!JSON.parse(String(init?.body)).tools) return completion([{ type: 'text', text: JSON.stringify({ target: 'workflow', reason: 'A graph.' }) }]);
    entered(); await hold;
    return completion([{ type: 'tool_use', id: 'late_call', name: 'propose_workflow_draft', input: { graph: createWorkflowTemplate('branch') } }], true);
  });
  const app = createServer({ operator, modelConnections: registry, projectSkillSource: async () => [], store: createMemoryGrantStore(), nativeAuthoringEnabled: true, requestAdmission: { global: 1, deadlineMs: 25 } });
  const payload = { prompt: 'Prepare a local workflow.', projectId: 'native-fixture', authoringEngine: 'native-v1', connectionId: 'anthropic' };
  try {
    const pending = Promise.resolve(app.inject({ method: 'POST', url: '/api/studio/create', headers, payload }));
    await started;
    await new Promise(resolve => setTimeout(resolve, 40));
    const rejected = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload });
    expect(rejected.statusCode).toBe(429);
    expect(sends).toBe(2);
    resume();
    expect((await pending).json()).toHaveProperty('status', 'invalid_determination');
    expect(sends).toBe(2);
  } finally { resume(); await app.close(); }
});

it('does not silently use the JSON planner for a native request on an unsupported connection', async () => {
  const transport = vi.fn<typeof fetch>();
  const registry = createModelConnections({ env: { STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:11434/v1', STUDIO_LOCAL_MODEL: 'fixture-model' }, localFetch: transport });
  const app = createServer({ operator, modelConnections: registry, store: createMemoryGrantStore(), nativeAuthoringEnabled: true });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a branch workflow.', projectId: 'native-fixture', authoringEngine: 'native-v1', connectionId: 'local' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().status).toBe('native-authoring-unavailable');
    expect(transport).not.toHaveBeenCalled();
  } finally { await app.close(); }
});


it('refuses explicit native authoring while disabled before any model resolution or request', async () => {
  const llm = vi.fn(async () => ({ text: '{"target":"workflow","reason":"A graph."}' }));
  const app = createServer({ operator, llm, llmBindingId: 'fixture-json-only', store: createMemoryGrantStore(), nativeAuthoringEnabled: false });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/studio/create', headers, payload: { prompt: 'Create a branch workflow.', projectId: 'native-fixture', authoringEngine: 'native-v1', connectionId: 'anthropic' } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ status: 'native-authoring-unavailable', error: 'Native authoring is not enabled for this connection. No fallback is attempted.' });
    expect(llm).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it('keeps authoring policy metadata authenticated, fixed and separate from a model probe', async () => {
  const llm = vi.fn(async () => ({ text: '{}' }));
  const app = createServer({ operator, llm, llmBindingId: 'fixture-json-only', store: createMemoryGrantStore(), nativeAuthoringEnabled: true });
  try {
    expect((await app.inject('/api/studio/authoring')).statusCode).toBe(401);
    const response = await app.inject({ url: '/api/studio/authoring', headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ engine: 'native-v1', enabled: true, connectionIds: ['anthropic'], maxModelCalls: 6, maxToolCalls: 16, draftOnly: true, executed: false, deployed: false });
    expect(llm).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
