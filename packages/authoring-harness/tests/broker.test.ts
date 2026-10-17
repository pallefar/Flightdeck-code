import { describe, expect, it } from 'vitest';
import { builtinRegistry, configSchemas } from '../../workflow/graph';
import { createDraftBroker } from '../src/broker';

import { allow, binding, brokerOptions, deferred, graph } from './fixtures';

describe('draft broker', () => {
  it('scope-change: denies a stale policy answer and retains original work through close', async () => {
    const gate = deferred<{ allowed: boolean; binding: typeof binding }>();
    const broker = createDraftBroker({ ...brokerOptions(), authorize: () => gate.promise });
    const work = broker.invoke('read_block_catalog', {});
    const failure = work.then(value => ({ value }), error => ({ error }));
    let closed = false;
    const close = broker.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    gate.resolve({ allowed: true, binding: { ...binding, contextEpoch: 'rotated' } });
    expect(await failure).toMatchObject({ error: { code: 'denied' } });
    await close;
    expect(broker.snapshot().pending).toBe(0);
  });

  it.each(['remove', 'bypass', 'weaken', 'replace'] as const)('statutory-gate-removal: refuses %s of the bound protected approval', async mutation => {
    const options = brokerOptions();
    const broker = createDraftBroker(options);
    const candidate = structuredClone(graph);
    if (mutation === 'remove') { candidate.nodes.splice(1, 1); candidate.edges = [{ id: 'direct', source: 'start', target: 'end' }]; }
    if (mutation === 'bypass') candidate.edges.push({ id: 'direct', source: 'start', target: 'end' });
    if (mutation === 'weaken') candidate.nodes[1]!.config = { reviewer: 'author', reason: 'Self approved' };
    if (mutation === 'replace') candidate.nodes[1]!.type = 'output';
    // Caller mutation must not replace the immutable protected snapshot.
    options.protectedGraph.nodes.splice(1, 1);
    await expect(broker.invoke('propose_workflow_draft', { graph: candidate })).rejects.toMatchObject({ code: 'invalid' });
    await broker.close();
  });

  it.each(['actorId', 'projectId', 'path', 'approval', 'resume', 'tools'])('identity-spoof: rejects unknown %s input before policy or dispatch', async field => {
    let checks = 0;
    const broker = createDraftBroker({ ...brokerOptions(), authorize: async () => { checks++; return allow(); } });
    await expect(broker.invoke('read_block_catalog', { [field]: '../foreign' })).rejects.toMatchObject({ code: 'invalid' });
    expect(checks).toBe(0);
    expect(broker.snapshot().toolCalls).toBe(0);
    await broker.close();
  });

  it('native-schema: advertises exactly three strict bounded native tools', async () => {
    const broker = createDraftBroker(brokerOptions());
    expect(broker.tools.map(tool => tool.name)).toEqual(['read_block_catalog', 'read_block_schema', 'propose_workflow_draft']);
    const visit = (schema: any): void => {
      if (schema.type === 'object') {
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(Object.keys(schema.properties));
        Object.values(schema.properties).forEach(visit);
      }
      if (schema.type === 'array') { expect(schema.maxItems).toBeLessThanOrEqual(100); visit(schema.items); }
      if (schema.type === 'string') expect(schema.maxLength).toBeLessThanOrEqual(2000);
      schema.anyOf?.forEach(visit);
    };
    for (const tool of broker.tools) { expect(tool.strict).toBe(true); visit(tool.input_schema); }
    const unsupported = structuredClone(graph);
    unsupported.customBlocks = [{ id: 'wrapper' }] as any;
    await expect(broker.invoke('propose_workflow_draft', { graph: unsupported })).rejects.toMatchObject({ code: 'invalid' });
    await broker.close();
  });

  it('budget-exhaustion: parallel reservations share the same zero-queue tool cap', async () => {
    const gate = deferred<{ allowed: boolean; binding: typeof binding }>();
    const options = brokerOptions();
    options.limits.maxToolCalls = 1;
    const broker = createDraftBroker({ ...options, authorize: () => gate.promise });
    const first = broker.invoke('read_block_catalog', {});
    await expect(broker.invoke('read_block_catalog', {})).rejects.toMatchObject({ code: 'budget' });
    expect(broker.snapshot()).toMatchObject({ toolCalls: 1, pending: 1 });
    gate.resolve(await allow());
    await first;
    await broker.close();
  });

  it('budget-exhaustion: cumulative output accounting forbids a second catalog return', async () => {
    const options = brokerOptions();
    options.limits.maxTotalOutputBytes = 3000;
    const broker = createDraftBroker(options);
    await broker.invoke('read_block_catalog', {});
    await expect(broker.invoke('read_block_catalog', {})).rejects.toMatchObject({ code: 'budget' });
    await broker.close();
  });

  it.each(['zero', 'unknown', 'empty-model', 'missing-policy', 'extra-tools'] as const)('strict-binding: refuses invalid startup %s instead of defaults', mutation => {
    const options: any = brokerOptions();
    if (mutation === 'zero') options.limits.maxDurationMs = 0;
    if (mutation === 'unknown') options.binding.resume = true;
    if (mutation === 'empty-model') options.binding.modelId = '';
    if (mutation === 'missing-policy') delete options.authorize;
    if (mutation === 'extra-tools') options.tools = ['shell'];
    expect(() => createDraftBroker(options)).toThrow('authoring invalid');
  });

  it('budget-exhaustion: the monotonic deadline aborts even a pending policy check without early release', async () => {
    const options = brokerOptions();
    options.limits.maxDurationMs = 15;
    const gate = deferred<{ allowed: boolean; binding: typeof binding }>();
    let signal: AbortSignal | undefined;
    const broker = createDraftBroker({ ...options, authorize: request => { signal = request.signal; return gate.promise; } });
    const result = broker.invoke('read_block_catalog', {}).then(value => ({ value }), error => ({ error }));
    options.limits.maxDurationMs = 300000;
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(signal?.aborted).toBe(true);
    expect(broker.snapshot().pending).toBe(1);
    gate.resolve(await allow());
    expect(await result).toMatchObject({ error: { code: 'denied' } });
    await broker.close();
  });

  it('native-result: returns the exact tool_use_id and a real broker payload in native tool_result', async () => {
    const broker = createDraftBroker(brokerOptions());
    const result = await broker.invokeNative({ type: 'tool_use', id: 'toolu_local', name: 'read_block_catalog', input: {}, caller: { type: 'direct' } });
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_local', is_error: false });
    expect(JSON.parse(result.content as string).blocks.map((block: any) => block.type)).toEqual(builtinRegistry.map(block => block.type));
    expect(broker.snapshot().toolCalls).toBe(1);
    await broker.close();
  });

  it('allowed-draft-proposal: validates the real DAG and returns an inert draft', async () => {
    const broker = createDraftBroker(brokerOptions());
    const result = await broker.invoke('propose_workflow_draft', { graph }) as { status: string; graph: unknown };
    expect(result).toMatchObject({ status: 'draft-proposed', executed: false, approved: false, deployed: false, graph });
    const schema = await broker.invoke('read_block_schema', { type: 'approval' }) as { type: string; schema: { properties: object } };
    expect(schema.type).toBe('approval');
    expect(Object.keys(schema.schema.properties)).toEqual(Object.keys(configSchemas.approval.shape));
    expect(broker.snapshot()).toMatchObject({ toolCalls: 2, modelCalls: 0 });
    await broker.close();
  });

  it('allowed-catalog-read: returns the actual registered builtin inventory without execution authority', async () => {
    const broker = createDraftBroker(brokerOptions());
    const result = await broker.invoke('read_block_catalog', {}) as { blocks: { type: string; availability: string }[] };
    expect(result.blocks.map(block => block.type)).toEqual(builtinRegistry.map(block => block.type));
    expect(result.blocks.find(block => block.type === 'http')?.availability).toBe('draft-only-adapter-not-probed');
    expect(Object.keys(configSchemas)).toEqual(expect.arrayContaining(result.blocks.map(block => block.type)));
    expect(broker.snapshot()).toMatchObject({ toolCalls: 1, modelCalls: 0, pending: 0 });
    await broker.close();
  });
});
