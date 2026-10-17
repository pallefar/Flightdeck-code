import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { DraftBroker } from './broker';
import type { NativeCompletion, NativeTurn } from './anthropic-port';
import { graphSchema } from '../../workflow/graph';
import type { Graph } from '../../workflow/graph';
import type { SubappSpecReceipt } from './subapp-broker';
import { subappSpecInputSchema, subappToolInputs } from './subapp-tools';
import { AuthoringError, copyJson, fail, runs } from './internal';
import { messageSchema, truncatedMessageSchema, turnSchema } from './native';
import { toolInputs } from './tools';

export interface AuthoringPort {
  /** Trusted native port bound to this broker; no auxiliary model producers. */
  complete(turn: NativeTurn, signal?: AbortSignal): Promise<NativeCompletion>;
}
export interface WorkflowDraftReceipt {
  readonly status: 'draft-proposed'; readonly graph: Graph;
  readonly executed: false; readonly approved: false; readonly deployed: false;
}
export interface AuthoringLoopBounds {
  readonly maxTurns: number; readonly maxMessages: number;
  readonly maxHistoryBytes: number; readonly maxCumulativeBytes: number;
}
export const AUTHORING_LOOP_BOUNDS: AuthoringLoopBounds = Object.freeze({ maxTurns: 32, maxMessages: 100, maxHistoryBytes: 512000, maxCumulativeBytes: 4000000 });
const boundsSchema = z.object({
  maxTurns: z.number().int().min(1).max(AUTHORING_LOOP_BOUNDS.maxTurns).optional(),
  maxMessages: z.number().int().min(1).max(AUTHORING_LOOP_BOUNDS.maxMessages).optional(),
  maxHistoryBytes: z.number().int().min(1).max(AUTHORING_LOOP_BOUNDS.maxHistoryBytes).optional(),
  maxCumulativeBytes: z.number().int().min(1).max(AUTHORING_LOOP_BOUNDS.maxCumulativeBytes).optional(),
}).strict();
export type TerminalToolName = 'propose_workflow_draft' | 'propose_subapp_spec';
type LoopMetadata = { readonly turns: number; readonly events: ReturnType<DraftBroker['events']>; readonly snapshot: ReturnType<DraftBroker['snapshot']> };
export type AuthoringLoopResult = LoopMetadata & (
  { readonly terminalToolName: 'propose_workflow_draft'; readonly receipt: WorkflowDraftReceipt } |
  { readonly terminalToolName: 'propose_subapp_spec'; readonly receipt: SubappSpecReceipt }
);
const receiptFlags = { executed: z.literal(false), approved: z.literal(false), deployed: z.literal(false) };
const workflowReceiptSchema = z.object({ ...receiptFlags, status: z.literal('draft-proposed'), graph: graphSchema }).strict();
const subappReceiptSchema = z.object({ ...receiptFlags, status: z.literal('subapp-spec-proposed'), spec: subappSpecInputSchema, understanding: z.string().min(1).max(4000) }).strict();

export interface AuthoringLoopOptions {
  readonly broker: DraftBroker;
  readonly port: AuthoringPort;
  readonly messages: readonly Anthropic.MessageParam[];
  readonly terminalToolNames: readonly [TerminalToolName];
  /** Optional reductions only. The shared Run limits apply independently. */
  readonly bounds?: Partial<AuthoringLoopBounds>;
  readonly signal?: AbortSignal;
}

const completionSchema = z.object({ message: truncatedMessageSchema, truncated: z.boolean() }).strict();
const activeLoops = new WeakSet<object>();

/** Owns and drains this broker; a receipt, never model prose, is terminal. */
export async function runAuthoringLoop(options: AuthoringLoopOptions): Promise<AuthoringLoopResult> {
  if (!options || typeof options !== 'object') fail('invalid');
  const { broker, port, signal } = options;
  const run = runs.get(broker);
  if (!run) fail('invalid');
  if (activeLoops.has(broker)) fail('denied');
  activeLoops.add(broker);
  const abort = () => run.controller.abort();
  const active = () => { if (signal?.aborted || run.controller.signal.aborted) fail('denied'); };
  try {
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('invalid');
    signal?.addEventListener('abort', abort, { once: true });
    active();
    if (Object.keys(options).some(key => !['broker', 'port', 'messages', 'terminalToolNames', 'bounds', 'signal'].includes(key)) || typeof port?.complete !== 'function') fail('invalid');
    const initial = run.snapshot();
    if (initial.toolCalls || initial.modelCalls || initial.pending) fail('invalid');
    const complete = port.complete.bind(port);
    const parsedBounds = boundsSchema.safeParse(copyJson(options.bounds ?? {}, 4096));
    if (!parsedBounds.success) fail('invalid');
    const bounds: AuthoringLoopBounds = {
      maxTurns: parsedBounds.data.maxTurns ?? AUTHORING_LOOP_BOUNDS.maxTurns,
      maxMessages: parsedBounds.data.maxMessages ?? AUTHORING_LOOP_BOUNDS.maxMessages,
      maxHistoryBytes: parsedBounds.data.maxHistoryBytes ?? AUTHORING_LOOP_BOUNDS.maxHistoryBytes,
      maxCumulativeBytes: parsedBounds.data.maxCumulativeBytes ?? AUTHORING_LOOP_BOUNDS.maxCumulativeBytes,
    };
    const terminalNames = copyJson(options.terminalToolNames, 1024);
    if (!Array.isArray(terminalNames) || terminalNames.length !== 1 || !['propose_workflow_draft', 'propose_subapp_spec'].includes(terminalNames[0])) fail('invalid');
    const terminal = terminalNames[0];
    const supported = new Set(broker.tools.map(tool => tool.name));
    const inputs: Readonly<Record<string, z.ZodTypeAny>> = terminal === 'propose_workflow_draft' ? toolInputs : subappToolInputs;
    if (!supported.has(terminal) || supported.size !== Object.keys(inputs).length || [...supported].some(name => !Object.hasOwn(inputs, name))) fail('invalid');
    const messages = [...copyJson(options.messages, run.limits.maxInputBytes)];
    if (!turnSchema.safeParse({ messages }).success || messages.at(-1)?.role !== 'user' || messages.some(message => typeof message.content !== 'string' && message.content.some(block => !['text'].includes(block.type)))) fail('invalid');
    const history = (value: readonly Anthropic.MessageParam[]) => {
      if (value.length > bounds.maxMessages || Buffer.byteLength(JSON.stringify(value)) > Math.min(bounds.maxHistoryBytes, run.limits.maxInputBytes)) fail('budget');
    };
    let cumulativeBytes = 0;
    const account = (value: unknown) => {
      cumulativeBytes += Buffer.byteLength(JSON.stringify(value));
      if (cumulativeBytes > bounds.maxCumulativeBytes) fail('budget');
    };
    history(messages);
    let turns = 0;
    const seen = new Set<string>();
    for (;;) {
      if (turns >= bounds.maxTurns || turns >= run.limits.maxModelCalls) fail('budget');
      history(messages);
      account({ messages });
      active();
      let rawCompletion: NativeCompletion;
      try { rawCompletion = await complete({ messages }, signal); }
      catch (error) {
        if (signal?.aborted) fail('denied');
        if (error instanceof AuthoringError) throw error;
        active();
        fail('provider');
      }
      if (signal?.aborted) fail('denied');
      const completion = copyJson(rawCompletion, run.limits.maxOutputBytes);
      turns++;
      account(completion);
      if (!completionSchema.safeParse(completion).success) fail('invalid');
      if (completion.truncated || completion.message.stop_reason === 'max_tokens' || completion.message.stop_reason === 'model_context_window_exceeded') fail('truncated');
      active();
      if (!messageSchema.safeParse(completion.message).success || completion.message.model !== run.binding.modelId || completion.message.stop_reason !== 'tool_use' || completion.message.stop_sequence !== null || completion.message.stop_details !== null) fail('invalid');
      const calls = completion.message.content.filter(block => block.type === 'tool_use');
      const isTerminal = calls.some(block => block.name === terminal);
      if (calls.length === 0 || (isTerminal && calls.length !== 1)) fail('invalid');
      const responseIds = new Set<string>();
      for (const block of calls) {
        if (!supported.has(block.name) || !Object.hasOwn(inputs, block.name) || seen.has(block.id) || responseIds.has(block.id)) fail('invalid');
        if (!inputs[block.name]!.safeParse(block.input).success) fail('invalid');
        responseIds.add(block.id);
      }
      if (run.snapshot().toolCalls + calls.length > run.limits.maxToolCalls || messages.length + (isTerminal ? 1 : 2) > bounds.maxMessages) fail('budget');
      for (const id of responseIds) seen.add(id);
      messages.push({ role: 'assistant', content: completion.message.content });
      history(messages);
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of calls) {
        const result = await broker.invokeNative(block, signal);
        account(result);
        results.push(result);
        if (isTerminal) {
          const rawReceipt = copyJson(JSON.parse(result.content as string), run.limits.maxOutputBytes);
          const metadata = { turns, events: broker.events(), snapshot: broker.snapshot() };
          if (terminal === 'propose_workflow_draft') return Object.freeze({ ...metadata, terminalToolName: terminal, receipt: copyJson(workflowReceiptSchema.parse(rawReceipt), run.limits.maxOutputBytes) });
          return Object.freeze({ ...metadata, terminalToolName: terminal, receipt: copyJson(subappReceiptSchema.parse(rawReceipt), run.limits.maxOutputBytes) });
        }
      }
      messages.push({ role: 'user', content: results });
      history(messages);
    }
  } catch (error) {
    throw error instanceof AuthoringError && ['denied', 'invalid', 'budget', 'provider', 'truncated'].includes(error.code) ? new AuthoringError(error.code) : new AuthoringError('invalid');
  } finally {
    try { await broker.close(); }
    finally { if (signal instanceof AbortSignal) signal.removeEventListener('abort', abort); activeLoops.delete(broker); }
  }
}
