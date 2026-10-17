import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createDraftBroker, createAnthropicToolPort } from '../src/index';
import { allow, binding, brokerOptions, deferred, graph } from './fixtures';

// Real installed SDK, explicit noncredential auth and fake fetch only.
const response = (content: unknown[] = [{ type: 'text', text: 'Synthetic response' }], stop = 'end_turn') => new Response(JSON.stringify({
  id: 'msg_review', type: 'message', role: 'assistant', model: binding.modelId,
  content, stop_reason: stop,
  stop_sequence: null, container: null, stop_details: null,
  usage: { input_tokens: 1, output_tokens: 1 },
}), { headers: { 'content-type': 'application/json' } });
const turn = { messages: [{ role: 'user' as const, content: 'Reviewed synthetic context' }] };
const reserved = [
  ['body', JSON.stringify({ model: 'unreviewed-model', max_tokens: 8000, messages: [], tools: [] })],
  ['method', 'DELETE'], ['headers', { 'x-unreviewed': 'synthetic' }],
  ['signal', new AbortController().signal],
] as const;
function clientWith(send: typeof fetch, fetchOptions?: object) {
  return new Anthropic({ apiKey: 'offline-fixture-not-a-credential', authToken: null,
    logLevel: 'off', maxRetries: 2, fetch: send,
    ...(fetchOptions === undefined ? {} : { fetchOptions: fetchOptions as never }),
  });
}
const model = (client: Anthropic, broker: ReturnType<typeof createDraftBroker>) =>
  createAnthropicToolPort({ client, broker, system: 'Reviewed synthetic system', effort: 'high' });

describe('independent review repairs — offline SDK fixtures, not production acceptance', () => {
  it.each(reserved)('R1: refuses preconfigured reserved fetchOptions.%s at binding', async (field, value) => {
    let sends = 0;
    const broker = createDraftBroker(brokerOptions());
    const client = clientWith(async () => { sends++; return response(); }, { [field]: value });
    try {
      expect(() => model(client, broker)).toThrow('authoring invalid');
      expect(sends).toBe(0);
      expect(broker.snapshot()).toMatchObject({ modelCalls: 0, pending: 0 });
    } finally { await broker.close(); }
  });

  it.each(reserved)('R1: rechecks reserved fetchOptions.%s on a subsequent send', async (field, value) => {
    let sends = 0;
    const broker = createDraftBroker(brokerOptions());
    const client = clientWith(async () => { sends++; return response(); });
    const port = model(client, broker);
    try {
      await port.complete(turn);
      client.fetchOptions = { [field]: value } as never;
      await expect(port.complete(turn)).rejects.toMatchObject({ code: 'invalid' });
      expect(sends).toBe(1);
      await expect(port.complete(turn)).rejects.toMatchObject({ code: 'denied' });
      expect(broker.snapshot().pending).toBe(0);
    } finally { await broker.close(); }
  });

  it.each(reserved)('R1: rechecks fetchOptions.%s after the original before-policy await', async (field, value) => {
    let sends = 0;
    const entered = deferred<void>(); const policy = deferred<Awaited<ReturnType<typeof allow>>>();
    const broker = createDraftBroker({ ...brokerOptions(), authorize: request => {
      if (request.stage === 'before') { entered.resolve(); return policy.promise; }
      return allow();
    } });
    const client = clientWith(async () => { sends++; return response(); });
    const port = model(client, broker);
    const outcome = port.complete(turn).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    client.fetchOptions = { [field]: value } as never;
    policy.resolve(await allow());
    try {
      expect(await outcome).toMatchObject({ error: { code: 'invalid' } });
      expect(sends).toBe(0);
      expect(broker.snapshot().pending).toBe(0);
    } finally { await broker.close(); }
  });

  it.each(['tool_use', 'max_tokens'] as const)('R2: rejects duplicate response tool-use IDs before issuance or callbacks (%s)', async stop => {
    let sends = 0; let callbacks = 0;
    const block = { type: 'tool_use', id: 'toolu_duplicate', name: 'read_block_catalog', input: {} };
    const broker = createDraftBroker(brokerOptions());
    const port = model(clientWith(async () => { sends++; return response([block, { type: 'text', text: 'Between duplicate IDs' }, block], stop); }), broker);
    try {
      const outcome = await port.complete(turn).then(async completion => {
        if (!completion.truncated) for (const item of completion.message.content) if (item.type === 'tool_use') {
          await broker.invokeNative(item); callbacks++;
        }
        return { value: completion };
      }, error => ({ error }));
      expect(outcome).toMatchObject({ error: { code: 'invalid' } });
      expect(callbacks).toBe(0);
      expect(sends).toBe(1);
      expect(broker.snapshot()).toMatchObject({ toolCalls: 0, pending: 0 });
      await expect(port.complete(turn)).rejects.toMatchObject({ code: 'denied' });
    } finally { await broker.close(); }
  });

  it('R3: resubmits an unchanged reason-first protected approval but still denies either value changing', async () => {
    const original = structuredClone(graph);
    original.nodes[1]!.config = { reason: 'Protected review', reviewer: 'independent' };
    const broker = createDraftBroker({ ...brokerOptions(), protectedGraph: original });
    try {
      await expect(broker.invoke('propose_workflow_draft', { graph: structuredClone(original) })).resolves.toMatchObject({
        status: 'draft-proposed', approved: false, executed: false, deployed: false,
        graph: { nodes: original.nodes },
      });
      for (const field of ['reviewer', 'reason'] as const) {
        const changed = structuredClone(original);
        changed.nodes[1]!.config = { reason: 'Protected review', reviewer: 'independent', [field]: 'changed' };
        await expect(broker.invoke('propose_workflow_draft', { graph: changed })).rejects.toMatchObject({ code: 'invalid' });
      }
      expect(Object.keys(original.nodes[1]!.config)).toEqual(['reason', 'reviewer']);
    } finally { await broker.close(); }
  });

  it('R4: accepts all seven exact binding values in reversed key order at every tool and model guard', async () => {
    const stages: string[] = []; let sends = 0;
    const reordered = Object.fromEntries(Object.entries(binding).reverse()) as typeof binding;
    const broker = createDraftBroker({ ...brokerOptions(), binding: reordered, authorize: async request => {
      stages.push(`${request.action}:${request.stage}`);
      return { allowed: true, binding: reordered };
    } });
    try {
      await expect(broker.invoke('read_block_catalog', {})).resolves.toHaveProperty('blocks');
      await expect(model(clientWith(async () => { sends++; return response(); }), broker).complete(turn)).resolves.toMatchObject({ truncated: false });
      expect(sends).toBe(1);
      expect(stages).toEqual(['read_block_catalog:before', 'read_block_catalog:after', 'read_block_catalog:return', 'model_send:before', 'model_send:after', 'model_send:return']);
    } finally { await broker.close(); }
  });

  const bindingMutations = [...Object.keys(binding), 'extra', 'missing', 'nonstring', 'malformed', 'oversize'];
  it.each(['before', 'after', 'return'].flatMap(stage => bindingMutations.map(mutation => [stage, mutation] as const)))('R4: strict binding still refuses %s-stage %s', async (stage, mutation) => {
    const current: Record<string, unknown> = Object.fromEntries(Object.entries(binding).reverse());
    if (Object.hasOwn(binding, mutation)) current[mutation] = 'rotated';
    if (mutation === 'extra') current.extra = 'foreign';
    if (mutation === 'missing') delete current.policyEpoch;
    if (mutation === 'nonstring') current.actorId = 7;
    if (mutation === 'malformed') current.actorId = 'invalid identity';
    if (mutation === 'oversize') current.actorId = 'x'.repeat(201);
    const broker = createDraftBroker({ ...brokerOptions(), authorize: async request => request.stage === stage
      ? { allowed: true, binding: current as typeof binding } : allow() });
    try {
      await expect(broker.invoke('read_block_catalog', {})).rejects.toMatchObject({ code: 'denied' });
      expect(broker.events().map(event => event.phase)).toEqual(['started', 'failed']);
    } finally { await broker.close(); }
  });
});
