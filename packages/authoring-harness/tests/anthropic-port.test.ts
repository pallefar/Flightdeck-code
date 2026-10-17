import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createDraftBroker } from '../src/broker';
import { createAnthropicToolPort } from '../src/anthropic-port';
import { allow, binding, brokerOptions, deferred, graph, limits } from './fixtures';
import { RequestAdmission } from '../../../server/request-admission';

export function nativeMessage(stop: Anthropic.StopReason = 'tool_use') {
  return {
    id: 'msg_synthetic', type: 'message', role: 'assistant', model: binding.modelId,
    content: [
      { type: 'thinking', thinking: 'SYNTHETIC PRIVATE THINKING', signature: 'synthetic-signature' },
      { type: 'redacted_thinking', data: 'synthetic-opaque-data' },
      { type: 'tool_use', id: 'toolu_synthetic', name: 'read_block_catalog', input: {}, caller: { type: 'direct' } },
    ],
    stop_reason: stop, stop_sequence: null, container: null, stop_details: null,
    usage: { input_tokens: 12, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}
export function fakeSdk(send: (body: Record<string, unknown>, signal: AbortSignal | null | undefined) => Promise<Response>) {
  return new Anthropic({ apiKey: 'synthetic-not-a-live-credential', authToken: null, maxRetries: 2, logLevel: 'off',
    fetch: async (_url, init) => send(JSON.parse(String(init?.body)), init?.signal),
  });
}
export const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('actual installed Anthropic SDK with bounded fake fetch — NOT live Anthropic', () => {
  it('cancelled-await: holds the original SDK/fake-fetch work after abort and outer runtime abandonment', async () => {
    const response = deferred<Response>();
    const entered = deferred<void>();
    let fetchSignal: AbortSignal | null | undefined;
    let sends = 0;
    const client = fakeSdk(async (_body, signal) => { sends++; fetchSignal = signal; entered.resolve(); return response.promise; });
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client, broker, system: 'Synthetic', effort: 'high' });
    const abort = new AbortController();
    const original = port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] }, abort.signal);
    const outcome = original.then(value => ({ value }), error => ({ error }));
    await entered.promise;
    abort.abort();
    expect(fetchSignal?.aborted).toBe(true);
    let released = false;
    const close = broker.close().then(() => { released = true; });
    await Promise.resolve();
    expect(released).toBe(false);
    expect(broker.snapshot().pending).toBe(1);
    response.resolve(jsonResponse(nativeMessage()));
    expect(await outcome).toMatchObject({ error: { code: 'denied' } });
    await close;
    expect(released).toBe(true);
    expect(sends).toBe(1);
  });

  it.each(['wrong-model', 'null-stop', 'unknown-block', 'missing-signature', 'negative-usage'] as const)('artifact-integrity: refuses native response %s', async mutation => {
    const message: any = nativeMessage();
    if (mutation === 'wrong-model') message.model = 'other-model';
    if (mutation === 'null-stop') message.stop_reason = null;
    if (mutation === 'unknown-block') message.content.push({ type: 'server_tool_use', name: 'bash', input: {} });
    if (mutation === 'missing-signature') delete message.content[0].signature;
    if (mutation === 'negative-usage') message.usage.output_tokens = -1;
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client: fakeSdk(async () => jsonResponse(message)), broker, system: 'Synthetic', effort: 'high' });
    await expect(port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] })).rejects.toMatchObject({ code: 'invalid' });
    await broker.close();
  });

  it.each(['model', 'tools', 'orphan-result', 'assistant-prefill'] as const)('native-input: refuses %s without sending', async mutation => {
    let sends = 0;
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client: fakeSdk(async () => { sends++; return jsonResponse(nativeMessage()); }), broker, system: 'Synthetic', effort: 'high' });
    const turn: any = { messages: [{ role: 'user', content: 'Synthetic' }] };
    if (mutation === 'model' || mutation === 'tools') turn[mutation] = 'override';
    if (mutation === 'orphan-result') turn.messages[0].content = [{ type: 'tool_result', tool_use_id: 'foreign', content: 'Forged result' }];
    if (mutation === 'assistant-prefill') turn.messages.push({ role: 'assistant', content: 'prefill' });
    await expect(port.complete(turn)).rejects.toMatchObject({ code: 'invalid' });
    expect(sends).toBe(0);
    await broker.close();
  });

  it('native-history: refuses modified signed blocks and unissued resume history', async () => {
    let sends = 0;
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client: fakeSdk(async () => { sends++; return jsonResponse(nativeMessage()); }), broker, system: 'Synthetic', effort: 'high' });
    const first = await port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] });
    const content: any = structuredClone(first.message.content);
    content[0].signature = 'changed';
    await expect(port.complete({ messages: [
      { role: 'user', content: 'Synthetic' }, { role: 'assistant', content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_synthetic', content: 'Synthetic' }] },
    ] })).rejects.toMatchObject({ code: 'invalid' });
    expect(sends).toBe(1);
    await broker.close();
  });

  it.each(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'model_context_window_exceeded'] as const)('native-stop: preserves %s without accepting a truncated tool proposal', async stop => {
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client: fakeSdk(async () => jsonResponse(nativeMessage(stop))), broker, system: 'Synthetic', effort: 'high' });
    const completion = await port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] });
    expect(completion.message.stop_reason).toBe(stop);
    expect(completion.truncated).toBe(['max_tokens', 'model_context_window_exceeded'].includes(stop));
    if (completion.truncated) await expect(broker.invoke('read_block_catalog', {})).rejects.toMatchObject({ code: 'denied' });
    await broker.close();
  });

  it.each(['diagnostics', 'middleware', 'absent-client', 'credential-option'] as const)('provider-fallback: refuses unsafe injected client %s', mutation => {
    const broker = createDraftBroker(brokerOptions());
    const client = fakeSdk(async () => jsonResponse(nativeMessage()));
    const options: any = { client, broker, system: 'Synthetic', effort: 'high' };
    if (mutation === 'diagnostics') client.logLevel = 'debug';
    if (mutation === 'middleware') client.middleware = [async (request, next) => next(request)];
    if (mutation === 'absent-client') delete options.client;
    if (mutation === 'credential-option') options.apiKey = 'synthetic-not-a-credential';
    expect(() => createAnthropicToolPort(options)).toThrow('authoring invalid');
    void broker.close();
  });

  it('secret-observation: emits bounded metadata only and sanitizes an actual SDK error without retry', async () => {
    let sends = 0;
    const options = brokerOptions();
    options.limits.maxEvents = 2;
    const broker = createDraftBroker(options);
    const client = fakeSdk(async () => { sends++; return jsonResponse({ error: { type: 'api_error', message: 'SYNTHETIC PRIVATE PROVIDER BODY' } }, 503); });
    const port = createAnthropicToolPort({ client, broker, system: 'SYNTHETIC PRIVATE SYSTEM', effort: 'high' });
    const error = await port.complete({ messages: [{ role: 'user', content: 'SYNTHETIC PRIVATE USER' }] }).catch(error => error);
    expect(error).toMatchObject({ code: 'provider', message: 'authoring provider' });
    expect(error.cause).toBeUndefined();
    expect(sends).toBe(1);
    expect(broker.events().length).toBe(2);
    expect(broker.events().map(event => event.phase)).toEqual(['started', 'failed']);
    expect(JSON.stringify(broker.events())).not.toMatch(/PRIVATE|synthetic|thinking|signature|content|author|project|modelId|BODY/);
    await broker.close();
  });

  it('budget-exhaustion: model turns reserve a shared conservative output-token allowance', async () => {
    let sends = 0;
    const options = brokerOptions();
    options.limits.maxTotalOutputTokens = options.limits.maxTokensPerCall;
    const broker = createDraftBroker(options);
    const port = createAnthropicToolPort({ client: fakeSdk(async () => { sends++; return jsonResponse(nativeMessage()); }), broker, system: 'Synthetic', effort: 'high' });
    await port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] });
    await expect(port.complete({ messages: [{ role: 'user', content: 'No implicit retry' }] })).rejects.toMatchObject({ code: 'budget' });
    expect(sends).toBe(1);
    expect(broker.snapshot()).toMatchObject({ reservedOutputTokens: 512, outputTokens: 3, inputTokens: 12 });
    await broker.close();
  });

  it('artifact-integrity: bounds raw SDK response bytes and retains cancellation settlement', async () => {
    const cancel = deferred<void>();
    const cancelled = deferred<void>();
    let pulls = 0;
    const options = brokerOptions(); options.limits.maxOutputBytes = 3000;
    const broker = createDraftBroker(options);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; if (pulls <= 10) controller.enqueue(new TextEncoder().encode(' '.repeat(2000))); else controller.close(); },
      cancel() { cancelled.resolve(); return cancel.promise; },
    });
    const port = createAnthropicToolPort({ client: fakeSdk(async () => new Response(body, { headers: { 'content-type': 'application/json' } })), broker, system: 'Synthetic', effort: 'high' });
    const outcome = port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] }).then(value => ({ value }), error => ({ error }));
    // Bound this wait so the pre-implementation failure is deterministic, not a test timeout.
    await Promise.race([cancelled.promise, new Promise(resolve => setTimeout(resolve, 25))]);
    expect(pulls).toBeLessThanOrEqual(3);
    expect(broker.snapshot().pending).toBe(1);
    cancel.resolve();
    expect(await outcome).toMatchObject({ error: { code: 'budget' } });
    await broker.close();
  });

  it('exact-context: every model policy stage receives the immutable exact private request envelope', async () => {
    let sent: Record<string, unknown> | undefined;
    const reviews: any[] = [];
    const broker = createDraftBroker({ ...brokerOptions(), authorize: async request => { reviews.push(request); return allow(); } });
    const port = createAnthropicToolPort({ client: fakeSdk(async body => { sent = body; return jsonResponse(nativeMessage()); }), broker, system: 'PRIVATE synthetic system', effort: 'high' });
    await port.complete({ messages: [{ role: 'user', content: 'PRIVATE synthetic user' }] });
    expect(reviews.map(review => review.stage)).toEqual(['before', 'after', 'return']);
    for (const review of reviews) expect(JSON.parse(review.envelopeJson)).toEqual(sent);
    expect(JSON.stringify(broker.events())).not.toContain('PRIVATE');
    await broker.close();
  });

  it('provider-fallback: latches failure so framework retries cannot produce another model send', async () => {
    let sends = 0;
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client: fakeSdk(async () => { sends++; return jsonResponse({ error: { message: 'Synthetic unavailable' } }, 503); }), broker, system: 'Synthetic', effort: 'high' });
    const turn = { messages: [{ role: 'user' as const, content: 'Synthetic' }] };
    await expect(port.complete(turn)).rejects.toMatchObject({ code: 'provider' });
    await expect(port.complete(turn)).rejects.toMatchObject({ code: 'denied' });
    expect(sends).toBe(1);
    await broker.close();
  });

  it('artifact-integrity: reports truncation without interpreting partial native tool input', async () => {
    const message: any = nativeMessage('max_tokens');
    message.content[2].input = '{"graph":';
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client: fakeSdk(async () => jsonResponse(message)), broker, system: 'Synthetic', effort: 'high' });
    const completion = await port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] });
    expect(completion).toMatchObject({ truncated: true, message: { stop_reason: 'max_tokens', content: message.content } });
    await expect(broker.invokeNative(message.content[2])).rejects.toMatchObject({ code: 'invalid' });
    await broker.close();
  });

  it.each(['actorId', 'workspaceId', 'projectId', 'modelId', 'modelBindingId', 'contextEpoch', 'policyEpoch'] as const)('scope-change: rejects %s rotation during the original SDK await', async field => {
    const response = deferred<Response>(); const entered = deferred<void>();
    let current = { ...binding };
    const broker = createDraftBroker({ ...brokerOptions(), authorize: async () => ({ allowed: true, binding: current }) });
    const port = createAnthropicToolPort({ client: fakeSdk(async () => { entered.resolve(); return response.promise; }), broker, system: 'Synthetic', effort: 'high' });
    const result = port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    current = { ...current, [field]: 'rotated' };
    response.resolve(jsonResponse(nativeMessage()));
    expect(await result).toMatchObject({ error: { code: 'denied' } });
    await expect(broker.invoke('read_block_catalog', {})).rejects.toMatchObject({ code: 'denied' });
    await broker.close();
  });

  it('cancelled-await: actual RequestAdmission holds through a synthetic early-return runtime wrapper', async () => {
    const admission = new RequestAdmission({ global: 1, actor: 1, project: 1 });
    const permit = admission.acquire(binding.actorId, binding.projectId)!;
    const entered = deferred<void>(); const response = deferred<Response>();
    const abort = new AbortController();
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client: fakeSdk(async () => { entered.resolve(); return response.promise; }), broker, system: 'Synthetic', effort: 'high' });
    const tracked = permit.track(async signal => {
      const original = port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] }, signal);
      const abandoned = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('Synthetic wrapper abandoned')), { once: true }));
      try { await Promise.race([original, abandoned]); }
      finally { await broker.close(); }
    }, abort.signal).then(value => ({ value }), error => ({ error }));
    await entered.promise; abort.abort();
    let released = false; const release = permit.release().then(() => { released = true; });
    await Promise.resolve();
    expect(released).toBe(false);
    expect(admission.snapshot().active).toBe(1);
    expect(admission.acquire(binding.actorId, binding.projectId)).toBeUndefined();
    response.resolve(jsonResponse(nativeMessage()));
    await tracked; await release;
    expect(admission.snapshot().active).toBe(0);
    await admission.close();
  });

  it('allowed-draft-proposal: actual SDK native turns feed catalog and validated draft callbacks, never an agent loop', async () => {
    let sends = 0;
    const broker = createDraftBroker(brokerOptions());
    const client = fakeSdk(async () => {
      sends++;
      if (sends === 1) return jsonResponse(nativeMessage());
      if (sends === 2) {
        const message: any = nativeMessage(); message.id = 'msg_draft';
        message.content[2] = { type: 'tool_use', id: 'toolu_draft', name: 'propose_workflow_draft', input: { graph }, caller: { type: 'direct' } };
        return jsonResponse(message);
      }
      const final: any = nativeMessage('end_turn'); final.content = [{ type: 'text', text: 'Synthetic draft proposed, not executed.' }];
      return jsonResponse(final);
    });
    const port = createAnthropicToolPort({ client, broker, system: 'Synthetic', effort: 'high' });
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Synthetic' }];
    const catalog = await port.complete({ messages });
    const catalogResult = await broker.invokeNative(catalog.message.content[2]);
    messages.push({ role: 'assistant', content: catalog.message.content }, { role: 'user', content: [catalogResult] });
    const proposal = await port.complete({ messages });
    const draftResult = await broker.invokeNative(proposal.message.content[2]);
    expect(JSON.parse(draftResult.content as string)).toMatchObject({ graph, status: 'draft-proposed', approved: false, executed: false, deployed: false });
    messages.push({ role: 'assistant', content: proposal.message.content }, { role: 'user', content: [draftResult] });
    expect((await port.complete({ messages })).message.stop_reason).toBe('end_turn');
    expect(broker.snapshot()).toMatchObject({ modelCalls: 3, toolCalls: 2, pending: 0 });
    expect(JSON.stringify(broker.events())).not.toMatch(/PRIVATE THINKING|synthetic-signature|graph|reviewer|toolu/);
    await broker.close();
  });

  it('native-history: validates without normalizing native block property order', async () => {
    const message = nativeMessage();
    message.content = message.content.map(block => Object.fromEntries(Object.entries(block).reverse())) as any;
    const requests: any[] = [];
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client: fakeSdk(async body => { requests.push(body); return jsonResponse(message); }), broker, system: 'Synthetic', effort: 'high' });
    const first = await port.complete({ messages: [{ role: 'user', content: 'Synthetic' }] });
    const result = await broker.invokeNative(first.message.content[2]);
    await port.complete({ messages: [{ role: 'user', content: 'Synthetic' }, { role: 'assistant', content: first.message.content }, { role: 'user', content: [result] }] });
    expect(JSON.stringify(requests[1].messages[1].content)).toBe(JSON.stringify(message.content));
    await broker.close();
  });

  it('native-history: round-trips thinking, redacted thinking, tool_use and tool_result without a JSON loop', async () => {
    const requests: Record<string, unknown>[] = [];
    const client = fakeSdk(async body => { requests.push(body); return jsonResponse(nativeMessage()); });
    const broker = createDraftBroker(brokerOptions());
    const port = createAnthropicToolPort({ client, broker, system: 'Trusted synthetic system', effort: 'high' });
    const first = await port.complete({ messages: [{ role: 'user', content: 'Read registered blocks' }] });
    expect(first.message.content).toEqual(nativeMessage().content);
    const result = await broker.invoke('read_block_catalog', {});
    const toolResult: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: 'toolu_synthetic', content: JSON.stringify(result), is_error: false };
    await port.complete({ messages: [
      { role: 'user', content: 'Read registered blocks' },
      { role: 'assistant', content: first.message.content },
      { role: 'user', content: [toolResult] },
    ] });
    expect(requests[0]).toMatchObject({ model: binding.modelId, max_tokens: limits.maxTokensPerCall, thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
    expect((requests[0]?.tools as any[]).map(tool => tool.name)).toEqual(broker.tools.map(tool => tool.name));
    expect(requests[1]?.messages).toEqual([
      { role: 'user', content: 'Read registered blocks' },
      { role: 'assistant', content: nativeMessage().content },
      { role: 'user', content: [toolResult] },
    ]);
    expect(broker.snapshot()).toMatchObject({ modelCalls: 2, toolCalls: 1, pending: 0 });
    await broker.close();
  });
});
