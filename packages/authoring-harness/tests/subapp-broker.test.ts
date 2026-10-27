import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createSubappDraftBroker } from '../src/subapp-broker';
import { miniAppSpecSchema } from '../../codegen/src/spec-contract';
import { allow, binding, brokerOptions } from './fixtures';
import { createDraftBroker } from '../src/broker';
import { createAnthropicToolPort } from '../src/anthropic-port';
import { runAuthoringLoop } from '../src/orchestrate';
import { nativeRequiredSchema } from '../src/native-schema';
import { z } from 'zod';

export const subappSpec = {
  profile: 'mini-app', id: 'intake-helper', label: 'Intake helper', icon: 'I', navSection: 'Contract pipeline', summary: 'Prepare proposals for independent review.',
  capabilities: ['read:contracts', 'write:inbox-proposal'], visibleToRoles: ['hr_preparer'],
  domains: [{ name: 'intake', title: 'Intake', routes: [
    { method: 'GET', path: '/contracts', summary: 'List authorized contracts', operation: { kind: 'list-contracts' } },
    { method: 'GET', path: '/proposals', summary: 'List this app’s proposals', operation: { kind: 'list-proposals' } },
    { method: 'POST', path: '/prepare', summary: 'Prepare a review proposal', operation: { kind: 'propose', proposalKind: 'intake-review', ticketField: 'ticket', fields: [
      { name: 'ticket', type: 'string', optional: false },
      { name: 'priority', type: 'enum', optional: false, values: ['normal', 'urgent'] },
      { name: 'ready', type: 'boolean', optional: true },
    ], auditEvent: 'intake-helper.proposed' } },
  ] }],
};
describe('bounded sub-app schemas and fixed callbacks', () => {
  it.each(['profile', 'tables', 'settings', 'source', 'files', 'path', 'credential', 'capability', 'audience', 'unknown-field', 'unknown-operation', 'post-read', 'get-propose', 'enum-values', 'field-count', 'domain-count', 'long-understanding', 'missing-summary', 'sensitive-field'] as const)('refuses %s without entering policy or consuming a tool call', async variant => {
    let checks = 0;
    const broker = createSubappDraftBroker({ ...subappOptions(), authorize: async () => { checks++; return allow(); } });
    const spec: any = structuredClone(subappSpec);
    const input: any = { spec, understanding: 'Synthetic proposal.' };
    if (variant === 'profile') spec.profile = 'table-backed';
    if (variant === 'tables') spec.tables = [];
    if (variant === 'settings') spec.settingsPanel = { tier: 'super-admin', label: 'Settings' };
    if (variant === 'source') spec.source = 'arbitrary source';
    if (variant === 'files') input.files = [];
    if (variant === 'path') spec.domains[0].routes[0].path = '/../../private';
    if (variant === 'credential') input.credentials = { key: 'synthetic-not-a-credential' };
    if (variant === 'capability') spec.capabilities = ['approve:contracts'];
    if (variant === 'audience') spec.visibleToRoles = ['super_admin'];
    if (variant === 'unknown-field') spec.domains[0].routes[2].operation.fields[0].source = 'shell';
    if (variant === 'unknown-operation') spec.domains[0].routes[0].operation = { kind: 'insert-row', table: 'contracts', fields: [], auditEvent: 'intake-helper.proposed' };
    if (variant === 'post-read') spec.domains[0].routes[0].method = 'POST';
    if (variant === 'get-propose') spec.domains[0].routes[2].method = 'GET';
    if (variant === 'enum-values') spec.domains[0].routes[2].operation.fields[1].values = [];
    if (variant === 'field-count') spec.domains[0].routes[2].operation.fields = Array.from({ length: 21 }, (_, index) => ({ name: `field${index}`, type: 'string', optional: false }));
    if (variant === 'domain-count') spec.domains = Array.from({ length: 7 }, () => spec.domains[0]);
    if (variant === 'long-understanding') input.understanding = 'x'.repeat(4001);
    if (variant === 'missing-summary') delete spec.summary;
    if (variant === 'sensitive-field') spec.domains[0].routes[2].operation.fields[0].name = 'apiKey';
    await expect(broker.invoke('propose_subapp_spec', input)).rejects.toMatchObject({ code: 'invalid' });
    expect(checks).toBe(0);
    expect(broker.snapshot().toolCalls).toBe(0);
    await broker.close();
  });

  it('does not widen the workflow registry or admit workflow/privileged names', async () => {
    const workflow = createDraftBroker(brokerOptions());
    expect(workflow.tools.map(tool => tool.name)).toEqual(['read_block_catalog', 'read_block_schema', 'propose_workflow_draft']);
    await workflow.close();
    const broker = createSubappDraftBroker(subappOptions());
    for (const name of ['propose_workflow_draft', 'read_block_catalog', 'approve', 'deploy', 'shell', 'read_file']) await expect(broker.invoke(name, {})).rejects.toMatchObject({ code: 'denied' });
    expect(broker.snapshot().toolCalls).toBe(0);
    await broker.close();
  });

  it('pins the input, fixed handler and truthful policy operation before an authorization await', async () => {
    let resume!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    const start = new Promise<void>(resolve => { entered = resolve; });
    const checks: string[] = [];
    const broker = createSubappDraftBroker({ ...subappOptions(), authorize: async request => { checks.push(request.action); if (request.stage === 'before') { entered(); await blocked; } return allow(); } });
    const input = { spec: structuredClone(subappSpec), understanding: 'Original understanding' };
    const pending = broker.invoke('propose_subapp_spec', input);
    await start;
    input.spec.label = 'Changed after dispatch'; input.understanding = 'Changed';
    expect(() => { (broker as any).invoke = () => 'not permitted'; }).toThrow();
    resume();
    expect(await pending).toMatchObject({ spec: { label: 'Intake helper' }, understanding: 'Original understanding' });
    expect(checks).toEqual(['propose_subapp_spec', 'propose_subapp_spec', 'propose_subapp_spec']);
    await broker.close();
  });

  it('declares bounded required-only closed native shapes without optional-object powerset expansion', async () => {
    const broker = createSubappDraftBroker(subappOptions());
    let nodes = 0;
    const visit = (schema: any) => {
      nodes++;
      if (schema.type === 'object') {
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(Object.keys(schema.properties));
        Object.values(schema.properties).forEach(visit);
      }
      if (schema.type === 'array') { expect(schema.maxItems).toBeGreaterThanOrEqual(0); expect(schema.maxItems).toBeLessThanOrEqual(20); visit(schema.items); }
      if (schema.type === 'string') expect(schema.maxLength).toBeGreaterThan(0);
      if (schema.anyOf) schema.anyOf.forEach(visit);
    };
    broker.tools.forEach(tool => { expect(tool.strict).toBe(true); expect(Object.isFrozen(tool.input_schema)).toBe(true); visit(tool.input_schema); });
    expect(nodes).toBeLessThan(100);
    expect(Buffer.byteLength(JSON.stringify(broker.tools))).toBeLessThan(16000);
    await broker.close();
  });

  it.each([
    z.object({ optional: z.string().max(2).optional() }).strict(),
    z.object({ text: z.string() }).strict(),
    z.object({ list: z.array(z.boolean()) }).strict(),
    z.object({ open: z.string().max(2) }),
    z.record(z.string()), z.number(), z.unknown(),
  ])('refuses an unsupported/unbounded schema projection rather than silently weakening it', schema => {
    expect(() => nativeRequiredSchema(schema)).toThrow('authoring invalid');
  });
});

export const subappOptions = () => ({ ...brokerOptions(), protectedGraph: null });

describe('separate generator-native sub-app draft broker', () => {
  it('uses the same registered Run through the actual installed SDK and ends locally on its sub-app receipt', async () => {
    const checks: string[] = [];
    const broker = createSubappDraftBroker({ ...subappOptions(), authorize: async request => { checks.push(`${request.action}:${request.stage}`); return allow(); } });
    const requests: any[] = [];
    const client = new Anthropic({ apiKey: 'synthetic-fixture-not-a-credential', authToken: null, logLevel: 'off', fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const proposal = requests.length === 2;
      return new Response(JSON.stringify({
        id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: binding.modelId,
        content: [{ type: 'thinking', thinking: 'PRIVATE SYNTHETIC', signature: 'fixture-signature' }, { type: 'tool_use', id: `call_${requests.length}`, name: proposal ? 'propose_subapp_spec' : 'read_subapp_contract', input: proposal ? { spec: subappSpec, understanding: 'A proposal-only helper.' } : {} }],
        stop_reason: 'tool_use', stop_sequence: null, container: null, stop_details: null, usage: { input_tokens: 11, output_tokens: 3 },
      }), { headers: { 'content-type': 'application/json' } });
    } });
    const port = createAnthropicToolPort({ broker, client, system: 'Synthetic', effort: 'high' });
    const result = await runAuthoringLoop({ broker, port, messages: [{ role: 'user', content: 'Synthetic intake helper' }], terminalToolNames: ['propose_subapp_spec'] });
    expect(result).toMatchObject({ terminalToolName: 'propose_subapp_spec', turns: 2, receipt: { status: 'subapp-spec-proposed', spec: subappSpec, understanding: 'A proposal-only helper.', executed: false, approved: false, deployed: false } });
    expect(requests).toHaveLength(2);
    expect(requests[0].tools.map((tool: any) => tool.name)).toEqual(['read_subapp_contract', 'propose_subapp_spec']);
    expect(requests[1].messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_1', is_error: false });
    expect(broker.snapshot()).toMatchObject({ modelCalls: 2, toolCalls: 2, inputTokens: 22, outputTokens: 6, pending: 0 });
    expect(checks).toEqual(['model_send:before', 'model_send:after', 'model_send:return', 'read_subapp_contract:before', 'read_subapp_contract:after', 'read_subapp_contract:return', 'model_send:before', 'model_send:after', 'model_send:return', 'propose_subapp_spec:before', 'propose_subapp_spec:after', 'propose_subapp_spec:return']);
  });
  it('returns the actual bounded schema/vocabulary and an inert generator-compatible JSON receipt', async () => {
    const broker = createSubappDraftBroker(subappOptions());
    expect(broker.tools.map(tool => tool.name)).toEqual(['read_subapp_contract', 'propose_subapp_spec']);
    expect(Object.isFrozen(broker)).toBe(true);
    const contract: any = await broker.invoke('read_subapp_contract', {});
    expect(contract).toMatchObject({ profile: 'mini-app', validation: 'bounded-subset-and-miniAppSpecSchema-authoritative', authority: 'declarative-only-no-host-grants' });
    expect(contract.inputSchema).toEqual(broker.tools[1]!.input_schema);
    expect(contract.vocabulary).toMatchObject({ capabilities: ['read:contracts', 'write:inbox-proposal'], visibleToRoles: ['hr_preparer', 'hr_reviewer', 'wc_liaison', 'legal', 'admin'] });
    const receipt: any = await broker.invoke('propose_subapp_spec', { spec: subappSpec, understanding: 'A draft proposal UI, not approval or execution.' });
    expect(receipt).toEqual({ status: 'subapp-spec-proposed', spec: subappSpec, understanding: 'A draft proposal UI, not approval or execution.', executed: false, approved: false, deployed: false });
    expect(miniAppSpecSchema.safeParse(receipt.spec).success).toBe(true);
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);
    expect(receipt.registryPatch).toBeUndefined();
    expect(broker.snapshot()).toMatchObject({ toolCalls: 2, pending: 0 });
    expect(broker.events().map(event => event.operation)).toEqual(['read_subapp_contract', 'read_subapp_contract', 'propose_subapp_spec', 'propose_subapp_spec']);
    await broker.close();
  });
});
