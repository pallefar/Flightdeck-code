import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createDraftBroker } from '../src/broker';
import { createAnthropicToolPort } from '../src/anthropic-port';
import { runAuthoringLoop } from '../src/orchestrate';
import { AuthoringError } from '../src/internal';
import { binding, brokerOptions, deferred, graph } from './fixtures';

const user: Anthropic.MessageParam[] = [{ role: 'user', content: 'Synthetic draft request' }];
function message(name: string, id: string, input: unknown) {
  return {
    id: `msg_${id}`, type: 'message', role: 'assistant', model: binding.modelId,
    content: [
      { signature: 'synthetic-signature', thinking: 'PRIVATE SYNTHETIC THINKING', type: 'thinking' },
      { data: 'synthetic-redaction', type: 'redacted_thinking' },
      { type: 'tool_use', id, name, input, caller: { type: 'direct' } },
    ],
    stop_reason: 'tool_use', stop_sequence: null, container: null, stop_details: null,
    usage: { input_tokens: 12, output_tokens: 3 },
  };
}
function sdk(send: (body: any, signal?: AbortSignal | null) => Promise<Response>) {
  return new Anthropic({ apiKey: 'synthetic-fixture-not-a-credential', authToken: null, logLevel: 'off', maxRetries: 2,
    fetch: async (_url, init) => send(JSON.parse(String(init?.body)), init?.signal),
  });
}
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

describe('bounded native orchestration — actual installed SDK/fake fetch, no provider', () => {
  it('round-trips unchanged signed blocks and ordered tool results, then ends on the broker receipt without another send', async () => {
    const broker = createDraftBroker(brokerOptions());
    const first = message('read_block_catalog', 'read1', {});
    first.content.push({ type: 'tool_use', id: 'read2', name: 'read_block_schema', input: { type: 'manual' }, caller: { type: 'direct' } } as any);
    const requests: any[] = [];
    const port = createAnthropicToolPort({ broker, system: 'Synthetic', effort: 'high', client: sdk(async body => {
      requests.push(body);
      return response(requests.length === 1 ? first : message('propose_workflow_draft', 'proposal', { graph }));
    }) });
    const result = await runAuthoringLoop({ broker, port, messages: user, terminalToolNames: ['propose_workflow_draft'] });
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1].messages[1].content)).toBe(JSON.stringify(first.content));
    expect(requests[1].messages[2].content.map((block: any) => block.tool_use_id)).toEqual(['read1', 'read2']);
    expect(result).toMatchObject({ receipt: { status: 'draft-proposed', graph, executed: false, approved: false, deployed: false }, turns: 2, terminalToolName: 'propose_workflow_draft' });
    expect(JSON.stringify(result.events)).not.toMatch(/PRIVATE|synthetic-signature|synthetic-redaction|graph|content/);
    expect(broker.snapshot()).toMatchObject({ modelCalls: 2, toolCalls: 3, pending: 0 });
    await expect(broker.invoke('read_block_catalog', {})).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('whole-response protocol preflight — trusted fixture ports', () => {
  it.each(['end_turn', 'pause_turn', 'refusal', 'stop_sequence', 'max_tokens', 'model_context_window_exceeded', 'missing-tools', 'unknown-mixed', 'duplicate-ids', 'terminal-batch', 'invalid-later-input', 'wrong-model', 'unknown-block', 'bad-signature', 'unexpected-stop-sequence', 'unexpected-stop-details', 'truncated-flag', 'completion-extra', 'completion-flag-type', 'terminal-first', 'two-proposals'] as const)('rejects %s before ANY tool callback', async variant => {
    const broker = createDraftBroker(brokerOptions());
    const first: any = message('read_block_catalog', 'read1', {});
    if (['end_turn', 'pause_turn', 'refusal', 'stop_sequence', 'max_tokens', 'model_context_window_exceeded'].includes(variant)) first.stop_reason = variant;
    if (variant === 'missing-tools') first.content = [{ type: 'text', text: 'Not a receipt' }];
    if (variant === 'unknown-mixed') first.content.push({ type: 'tool_use', id: 'bad', name: 'shell', input: {} });
    if (variant === 'duplicate-ids') first.content.push({ type: 'tool_use', id: 'read1', name: 'read_block_schema', input: { type: 'manual' } });
    if (variant === 'terminal-batch') first.content.push({ type: 'tool_use', id: 'proposal', name: 'propose_workflow_draft', input: { graph } });
    if (variant === 'invalid-later-input') first.content.push({ type: 'tool_use', id: 'read2', name: 'read_block_schema', input: { type: 'invented' } });
    if (variant === 'wrong-model') first.model = 'other-model';
    if (variant === 'unknown-block') first.content.push({ type: 'server_tool_use', name: 'shell' });
    if (variant === 'bad-signature') delete first.content[0].signature;
    if (variant === 'unexpected-stop-sequence') first.stop_sequence = 'unrequested';
    if (variant === 'unexpected-stop-details') first.stop_details = { type: 'compaction' };
    if (variant === 'terminal-first' || variant === 'two-proposals') {
      first.content.unshift({ type: 'tool_use', id: 'proposal', name: 'propose_workflow_draft', input: { graph } });
      if (variant === 'two-proposals') first.content[3] = { type: 'tool_use', id: 'proposal2', name: 'propose_workflow_draft', input: { graph } };
    }
    let calls = 0;
    const port = { complete: async () => ({ message: calls++ === 0 ? first : message('propose_workflow_draft', 'proposal2', { graph }), truncated: variant === 'completion-flag-type' ? 0 : variant === 'truncated-flag', ...(variant === 'completion-extra' ? { retry: true } : {}) }) };
    await expect(runAuthoringLoop({ broker, port: port as any, messages: user, terminalToolNames: ['propose_workflow_draft'] })).rejects.toMatchObject({ code: ['max_tokens', 'model_context_window_exceeded', 'truncated-flag'].includes(variant) ? 'truncated' : 'invalid' });
    expect(broker.snapshot().toolCalls).toBe(0);
    expect(calls).toBe(1);
  });

  it('rejects a reused tool ID across responses before its second callback', async () => {
    const broker = createDraftBroker(brokerOptions());
    let calls = 0;
    const port = { complete: async () => ({ message: ++calls <= 2 ? message('read_block_catalog', 'same', {}) : message('propose_workflow_draft', 'proposal', { graph }), truncated: false }) };
    await expect(runAuthoringLoop({ broker, port: port as any, messages: user, terminalToolNames: ['propose_workflow_draft'] })).rejects.toMatchObject({ code: 'invalid' });
    expect(broker.snapshot().toolCalls).toBe(1);
    expect(calls).toBe(2);
  });
});

describe('explicit startup, turn and history bounds', () => {
  it.each(['empty-terminal', 'arbitrary-terminal', 'foreign-terminal', 'two-terminals', 'unknown-option', 'zero-bound', 'oversized-bound', 'assistant-prefill', 'resume-history'] as const)('rejects %s without a model call', async variant => {
    const broker = createDraftBroker(brokerOptions());
    let sends = 0;
    const options: any = { broker, port: { complete: async () => { sends++; return { message: message('propose_workflow_draft', 'proposal', { graph }), truncated: false }; } }, messages: user, terminalToolNames: ['propose_workflow_draft'] };
    if (variant === 'empty-terminal') options.terminalToolNames = [];
    if (variant === 'arbitrary-terminal') options.terminalToolNames = ['read_block_catalog'];
    if (variant === 'foreign-terminal') options.terminalToolNames = ['propose_subapp_spec'];
    if (variant === 'two-terminals') options.terminalToolNames.push('propose_subapp_spec');
    if (variant === 'unknown-option') options.retries = 1;
    if (variant === 'zero-bound') options.bounds = { maxTurns: 0 };
    if (variant === 'oversized-bound') options.bounds = { maxTurns: 33 };
    if (variant === 'assistant-prefill') options.messages = [...user, { role: 'assistant', content: 'prefill' }];
    if (variant === 'resume-history') options.messages = [...user, { role: 'assistant', content: message('read_block_catalog', 'old', {}).content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old', content: '{}' }] }];
    await expect(runAuthoringLoop(options)).rejects.toMatchObject({ code: 'invalid' });
    expect(sends).toBe(0);
  });

  it.each(['turn', 'messages', 'history-bytes', 'cumulative-bytes', 'tool-budget'] as const)('enforces %s before another send or partial batch', async variant => {
    const opts = brokerOptions();
    if (variant === 'tool-budget') opts.limits.maxToolCalls = 1;
    const broker = createDraftBroker(opts);
    let sends = 0;
    const port = { complete: async () => {
      sends++;
      const next = sends === 1 ? message('read_block_catalog', 'read1', {}) : message('propose_workflow_draft', 'proposal', { graph });
      if (variant === 'tool-budget' && sends === 1) next.content.push({ type: 'tool_use', id: 'read2', name: 'read_block_schema', input: { type: 'manual' }, caller: { type: 'direct' } } as any);
      return { message: next, truncated: false };
    } };
    const bounds = variant === 'turn' ? { maxTurns: 1 } : variant === 'messages' ? { maxMessages: 2 } : variant === 'history-bytes' ? { maxHistoryBytes: 100 } : variant === 'cumulative-bytes' ? { maxCumulativeBytes: 200 } : {};
    await expect(runAuthoringLoop({ broker, port: port as any, messages: user, terminalToolNames: ['propose_workflow_draft'], bounds } as any)).rejects.toMatchObject({ code: 'budget' });
    expect(sends).toBe(1);
    if (variant === 'tool-budget' || variant === 'messages' || variant === 'history-bytes' || variant === 'cumulative-bytes') expect(broker.snapshot().toolCalls).toBe(0);
  });
});

describe('ownership, cancellation and safe failures', () => {
  it.each([null, undefined])('returns a fixed error for absent startup options', async options => {
    await expect(runAuthoringLoop(options as any)).rejects.toMatchObject({ code: 'invalid', message: 'authoring invalid' });
  });

  it('rejects a non-native cancellation signal with a fixed error and drains the broker', async () => {
    const broker = createDraftBroker(brokerOptions());
    const port: any = { complete: async () => ({ message: message('propose_workflow_draft', 'proposal', { graph }), truncated: false }) };
    await expect(runAuthoringLoop({ broker, port, messages: user, terminalToolNames: ['propose_workflow_draft'], signal: {} as any })).rejects.toMatchObject({ code: 'invalid', message: 'authoring invalid' });
    await expect(broker.invoke('read_block_catalog', {})).rejects.toMatchObject({ code: 'denied' });
  });

  it('does not copy an arbitrary code/message/cause even from a mutated AuthoringError', async () => {
    const broker = createDraftBroker(brokerOptions());
    const raw: any = new AuthoringError('provider'); raw.code = 'PRIVATE thinking'; raw.message = 'PRIVATE source'; raw.cause = new Error('PRIVATE provider');
    const port = { complete: async () => { throw raw; } };
    const error: any = await runAuthoringLoop({ broker, port, messages: user, terminalToolNames: ['propose_workflow_draft'] }).catch(error => error);
    expect(error).toMatchObject({ code: 'invalid', message: 'authoring invalid' });
    expect(error.cause).toBeUndefined();
  });
  it('requires a fresh ledger rather than accepting unknown earlier tool IDs or model sends', async () => {
    const broker = createDraftBroker(brokerOptions());
    await broker.invokeNative({ type: 'tool_use', id: 'prior_id', name: 'read_block_catalog', input: {} });
    let calls = 0;
    const port = { complete: async () => { calls++; return { message: message('propose_workflow_draft', 'prior_id', { graph }), truncated: false }; } };
    await expect(runAuthoringLoop({ broker, port: port as any, messages: user, terminalToolNames: ['propose_workflow_draft'] })).rejects.toMatchObject({ code: 'invalid' });
    expect(calls).toBe(0);
  });

  it('pins the trusted port callable before policy waits instead of switching producers on continuation', async () => {
    let calls = 0;
    const port: any = { complete: async () => ({ message: ++calls === 1 ? message('read_block_catalog', 'read1', {}) : message('propose_workflow_draft', 'proposal', { graph }), truncated: false }) };
    const broker = createDraftBroker({ ...brokerOptions(), authorize: async request => {
      if (request.action === 'read_block_catalog') port.complete = async () => { throw new Error('PRIVATE replacement producer'); };
      return { allowed: true, binding };
    } });
    expect(await runAuthoringLoop({ broker, port, messages: user, terminalToolNames: ['propose_workflow_draft'] })).toMatchObject({ receipt: { status: 'draft-proposed' }, turns: 2 });
    expect(calls).toBe(2);
  });
  it('refuses a pre-aborted invocation before calling even a trusted fixture port', async () => {
    const broker = createDraftBroker(brokerOptions());
    const abort = new AbortController(); abort.abort();
    let calls = 0;
    const port = { complete: async () => { calls++; return { message: message('propose_workflow_draft', 'proposal', { graph }), truncated: false }; } };
    await expect(runAuthoringLoop({ broker, port: port as any, messages: user, signal: abort.signal, terminalToolNames: ['propose_workflow_draft'] })).rejects.toMatchObject({ code: 'denied' });
    expect(calls).toBe(0);
  });

  it('rejects a competing loop without closing or advancing the owner', async () => {
    const broker = createDraftBroker(brokerOptions());
    const entered = deferred<void>();
    const release = deferred<void>();
    let calls = 0;
    const port = { complete: async () => { calls++; entered.resolve(); await release.promise; return { message: message('propose_workflow_draft', 'proposal', { graph }), truncated: false }; } };
    const owner = runAuthoringLoop({ broker, port: port as any, messages: user, terminalToolNames: ['propose_workflow_draft'] });
    await entered.promise;
    const competing = runAuthoringLoop({ broker, port: port as any, messages: user, terminalToolNames: ['propose_workflow_draft'] });
    // Release even on RED, without leaving either synthetic promise unhandled.
    const second = competing.then(value => ({ value }), error => ({ error }));
    await Promise.resolve(); release.resolve();
    expect(await second).toMatchObject({ error: { code: 'denied' } });
    expect(await owner).toMatchObject({ receipt: { status: 'draft-proposed' } });
    expect(calls).toBe(1);
  });

  it('sanitizes a raw trusted-port rejection without retry, history or provider text', async () => {
    const broker = createDraftBroker(brokerOptions());
    let calls = 0;
    const port = { complete: async () => { calls++; throw new Error('PRIVATE provider body and signed thinking'); } };
    const error: any = await runAuthoringLoop({ broker, port, messages: user, terminalToolNames: ['propose_workflow_draft'] }).catch(error => error);
    expect(error).toMatchObject({ code: 'provider', message: 'authoring provider' });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(broker.events())).not.toContain('PRIVATE');
    expect(calls).toBe(1);
  });

  it.each(['original-await', 'early-runtime-rejection'] as const)('retains ignored-abort SDK/fake-fetch work through close: %s', async wrapper => {
    const broker = createDraftBroker(brokerOptions());
    const entered = deferred<void>(); const release = deferred<Response>();
    const abort = new AbortController();
    let sdkSignal: AbortSignal | null | undefined;
    let calls = 0;
    const native = createAnthropicToolPort({ broker, system: 'Synthetic', effort: 'high', client: sdk(async (_body, signal) => { calls++; sdkSignal = signal; entered.resolve(); return release.promise; }) });
    const port = wrapper === 'original-await' ? native : { complete: (turn: Parameters<typeof native.complete>[0], signal?: AbortSignal) => {
      const original = native.complete(turn, signal);
      return Promise.race([original, new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('PRIVATE wrapper abandoned')), { once: true }))]);
    } };
    let settled = false;
    const operation = runAuthoringLoop({ broker, port, messages: user, signal: abort.signal, terminalToolNames: ['propose_workflow_draft'] }).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    await entered.promise; abort.abort();
    await Promise.resolve(); await Promise.resolve();
    expect(sdkSignal?.aborted).toBe(true);
    expect(broker.snapshot().pending).toBe(1);
    expect(settled).toBe(false);
    release.resolve(response(message('propose_workflow_draft', 'proposal', { graph })));
    expect(await operation).toMatchObject({ error: { code: 'denied' } });
    expect(broker.snapshot()).toMatchObject({ toolCalls: 0, pending: 0 });
    expect(calls).toBe(1);
  });
});

describe('native SDK stop handling and shared ledger limits', () => {
  it.each(['end_turn', 'pause_turn', 'refusal', 'stop_sequence', 'max_tokens', 'model_context_window_exceeded'] as const)('stops safely on actual SDK %s with no callbacks or continuation', async stop => {
    const broker = createDraftBroker(brokerOptions());
    let sends = 0;
    const first: any = message('propose_workflow_draft', 'proposal', { graph });
    first.stop_reason = stop;
    if (['max_tokens', 'model_context_window_exceeded'].includes(stop)) first.content[2].input = '{"graph":';
    const port = createAnthropicToolPort({ broker, system: 'Synthetic', effort: 'high', client: sdk(async () => { sends++; return response(first); }) });
    await expect(runAuthoringLoop({ broker, port, messages: user, terminalToolNames: ['propose_workflow_draft'] })).rejects.toMatchObject({ code: ['max_tokens', 'model_context_window_exceeded'].includes(stop) ? 'truncated' : 'invalid' });
    expect(sends).toBe(1);
    expect(broker.snapshot().toolCalls).toBe(0);
  });

  it.each(['model-calls', 'tokens', 'tool-calls', 'response-bytes', 'provider-error'] as const)('keeps shared %s authoritative without retry', async variant => {
    const options = brokerOptions();
    if (variant === 'model-calls') options.limits.maxModelCalls = 1;
    if (variant === 'tokens') options.limits.maxTotalOutputTokens = options.limits.maxTokensPerCall;
    if (variant === 'tool-calls') options.limits.maxToolCalls = 1;
    if (variant === 'response-bytes') options.limits.maxOutputBytes = 3000;
    const broker = createDraftBroker(options);
    let sends = 0;
    const port = createAnthropicToolPort({ broker, system: 'Synthetic', effort: 'high', client: sdk(async () => {
      sends++;
      if (variant === 'provider-error') return new Response(JSON.stringify({ error: { message: 'PRIVATE provider error' } }), { status: 503 });
      const next: any = message('read_block_catalog', `read${sends}`, {});
      if (variant === 'response-bytes') next.content[0].thinking = 'PRIVATE'.repeat(1000);
      return response(next);
    }) });
    const error: any = await runAuthoringLoop({ broker, port, messages: user, terminalToolNames: ['propose_workflow_draft'] }).catch(error => error);
    expect(error).toMatchObject({ code: variant === 'provider-error' ? 'provider' : 'budget', message: variant === 'provider-error' ? 'authoring provider' : 'authoring budget' });
    expect(error.cause).toBeUndefined();
    expect(sends).toBe(variant === 'tool-calls' ? 2 : 1);
    expect(broker.snapshot().pending).toBe(0);
    expect(JSON.stringify(broker.events())).not.toContain('PRIVATE');
  });
});

export { message, sdk, response, user };
