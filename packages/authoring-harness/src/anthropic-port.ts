import type Anthropic from '@anthropic-ai/sdk';
import type { DraftBroker } from './broker';
import { messageSchema, truncatedMessageSchema, turnSchema } from './native';
import { AuthoringError, copyJson, digest, fail, runs } from './internal';
import { boundedResponse } from './response-bound';

export interface AnthropicToolPortOptions {
  readonly client: Anthropic;
  readonly broker: DraftBroker;
  readonly system: string;
  readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}
export interface NativeTurn { readonly messages: readonly Anthropic.MessageParam[] }
export interface NativeCompletion { readonly message: Anthropic.Message; readonly truncated: boolean }

/** One native Messages API turn. This is a model port, never an agent loop or planner replacement. */
export function createAnthropicToolPort(options: AnthropicToolPortOptions) {
  if (!options || Object.keys(options).some(key => !['client', 'broker', 'system', 'effort'].includes(key)) || typeof options.system !== 'string' || options.system.length > 32000 || !['low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) fail('invalid');
  const run = runs.get(options.broker);
  if (!run) fail('invalid');
  const client = options.client;
  const checkClient = () => {
    if (!client || client.logLevel !== 'off' || !Array.isArray(client.middleware) || client.middleware.length !== 0 || typeof client.messages?.create !== 'function') fail('invalid');
    // The SDK excludes these fields in types but spreads them last at runtime.
    // Refuse misconfiguration; this is not confinement of a hostile client.
    if (['body', 'method', 'headers', 'signal'].some(key => Object.hasOwn(client.fetchOptions ?? {}, key))) fail('invalid');
  };
  checkClient();
  const send = client.messages.create.bind(client.messages);
  const system = options.system;
  const effort = options.effort;
  const tools = options.broker.tools;
  const issuedContent = new Set<string>();
  return Object.freeze({
    async complete(turn: NativeTurn, signal?: AbortSignal): Promise<NativeCompletion> {
      const pinnedTurn = copyJson(turn, run.limits.maxInputBytes);
      const parsed = turnSchema.safeParse(pinnedTurn);
      if (!parsed.success || parsed.data.messages.at(-1)?.role !== 'user') fail('invalid');
      let pending: string[] = [];
      const seen = new Set<string>();
      for (const [index, message] of parsed.data.messages.entries()) {
        const blocks = typeof message.content === 'string' ? [] : message.content;
        if (message.role === 'assistant' && blocks.some(block => ['thinking', 'redacted_thinking', 'tool_use'].includes(block.type)) && !issuedContent.has(digest(pinnedTurn.messages[index]?.content))) fail('invalid');
        const results = blocks.filter(block => block.type === 'tool_result');
        if (pending.length || results.length) {
          if (message.role !== 'user' || results.length !== pending.length || results.some((result, index) => result.tool_use_id !== pending[index] || blocks[index] !== result)) fail('invalid');
          pending = [];
        }
        if (message.role === 'assistant') for (const block of blocks) if (block.type === 'tool_use') {
          if (seen.has(block.id)) fail('invalid');
          seen.add(block.id); pending.push(block.id);
        }
      }
      if (pending.length) fail('invalid');
      const params = copyJson({
        model: run.binding.modelId, max_tokens: run.limits.maxTokensPerCall,
        thinking: { type: 'adaptive' as const }, output_config: { effort }, system,
        tools, messages: [...pinnedTurn.messages], stream: false as const,
      }, run.limits.maxInputBytes);
      const completion = await run.execute('model_send', digest(params), async () => {
        checkClient();
        let message: Anthropic.Message;
        try { message = await send(params, { signal: run.controller.signal, maxRetries: 0, timeout: run.limits.maxDurationMs, middleware: [boundedResponse(run.limits.maxOutputBytes)] }); }
        catch (error) { if (error instanceof AuthoringError) throw error; fail('provider'); }
        const native = { id: message.id, type: message.type, role: message.role, model: message.model, content: message.content, stop_reason: message.stop_reason, stop_sequence: message.stop_sequence, usage: message.usage, container: message.container, stop_details: message.stop_details };
        const checked = copyJson(native, run.limits.maxOutputBytes);
        const truncated = message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded';
        if (!(truncated ? truncatedMessageSchema : messageSchema).safeParse(checked).success || checked.model !== run.binding.modelId) fail('invalid');
        const responseIds = new Set<string>();
        for (const block of checked.content) if (block.type === 'tool_use') {
          if (responseIds.has(block.id)) fail('invalid');
          responseIds.add(block.id);
        }
        run.recordUsage(checked.usage.input_tokens + (checked.usage.cache_creation_input_tokens ?? 0) + (checked.usage.cache_read_input_tokens ?? 0), checked.usage.output_tokens);
        return { message: checked, truncated };
      }, signal, JSON.stringify(params)).catch(error => { run.controller.abort(); throw error; });
      if (completion.truncated) run.controller.abort();
      else issuedContent.add(digest(completion.message.content));
      return completion;
    },
  });
}
