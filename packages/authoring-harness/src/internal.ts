import { createHash } from 'node:crypto';
import { z } from 'zod';
const identity = z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]*$/);
const bindingSchema = z.object({ actorId: identity, workspaceId: identity, projectId: identity, modelId: identity, modelBindingId: identity, contextEpoch: identity, policyEpoch: identity }).strict();
const count = z.number().int().min(1);
const limitsSchema = z.object({ maxModelCalls: count.max(32), maxToolCalls: count.max(256), maxConcurrent: count.max(8), maxDurationMs: count.max(300000), maxInputBytes: count.max(512000), maxOutputBytes: count.max(512000), maxTotalOutputBytes: count.max(4000000), maxTokensPerCall: count.max(8192), maxTotalOutputTokens: count.max(65536), maxEvents: count.max(2048) }).strict();
import { boundedJson } from '../../workflow/data';
import type { Binding, BrokerOptions, Limits } from './broker';

export class AuthoringError extends Error {
  constructor(readonly code: 'denied' | 'invalid' | 'budget' | 'provider' | 'truncated') {
    super(`authoring ${code}`); this.name = 'AuthoringError';
  }
}
export function fail(code: AuthoringError['code']): never { throw new AuthoringError(code); }
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export function copyJson<T>(value: T, maxBytes: number): T {
  if (!boundedJson(value, maxBytes, 32, 30000)) fail('invalid');
  return freeze(JSON.parse(JSON.stringify(value)) as T);
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type Action = 'read_block_catalog' | 'read_block_schema' | 'propose_workflow_draft' | 'read_subapp_contract' | 'propose_subapp_spec' | 'model_send';
export type Stage = 'before' | 'after' | 'return';
export interface PolicyRequest { readonly binding: Binding; readonly action: Action; readonly stage: Stage; readonly inputDigest: string; readonly envelopeJson?: string; readonly signal: AbortSignal }

export interface MetadataEvent { readonly sequence: number; readonly operation: Action; readonly phase: 'started' | 'returned' | 'failed'; readonly elapsedMs: number; readonly code?: AuthoringError['code'] }
export const runs = new WeakMap<object, Run>();

export class Run {
  readonly binding: Binding;
  readonly limits: Limits;
  readonly controller = new AbortController();
  private readonly authorize: BrokerOptions['authorize'];
  private readonly pending = new Set<Promise<unknown>>();
  private closing = false;
  private readonly timer: ReturnType<typeof setTimeout>;
  private toolCalls = 0;
  private modelCalls = 0;
  private outputBytes = 0;
  private reservedOutputTokens = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  recordUsage(input: number, output: number) {
    if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || output > this.limits.maxTokensPerCall) fail('invalid');
    this.inputTokens += input; this.outputTokens += output;
  }
  private readonly eventList: MetadataEvent[] = [];
  private droppedEvents = 0;
  events() { return Object.freeze([...this.eventList]); }
  private event(operation: Action, phase: MetadataEvent['phase'], code?: AuthoringError['code']) {
    if (this.eventList.length >= this.limits.maxEvents) { this.droppedEvents++; return; }
    this.eventList.push(Object.freeze({ sequence: this.eventList.length + 1, operation, phase, elapsedMs: Math.floor(Math.max(0, performance.now() - this.started)), ...(code ? { code } : {}) }));
  }
  private readonly started = performance.now();
  constructor(options: BrokerOptions) {
    if (!options || Object.keys(options).some(key => !['binding', 'limits', 'authorize', 'protectedGraph'].includes(key))) fail('invalid');
    const b = bindingSchema.safeParse(copyJson(options.binding, 4096));
    const l = limitsSchema.safeParse(copyJson(options.limits, 4096));
    if (!b.success || !l.success || typeof options.authorize !== 'function') fail('invalid');
    this.binding = freeze(b.data);
    this.limits = freeze(l.data);
    this.authorize = options.authorize;
    this.timer = setTimeout(() => this.controller.abort(), this.limits.maxDurationMs);
    this.timer.unref();
  }
  private active() {
    if (performance.now() - this.started >= this.limits.maxDurationMs) this.controller.abort();
    if (this.closing || this.controller.signal.aborted) fail('denied');
  }
  async guard(action: Action, stage: Stage, inputDigest: string, envelopeJson?: string) {
    this.active();
    let answer: Awaited<ReturnType<BrokerOptions['authorize']>>;
    try { answer = await this.authorize(Object.freeze({ binding: this.binding, action, stage, inputDigest, ...(envelopeJson === undefined ? {} : { envelopeJson }), signal: this.controller.signal })); }
    catch { fail('denied'); }
    this.active();
    if (!answer || answer.allowed !== true) fail('denied');
    const current = bindingSchema.safeParse(copyJson(answer.binding, 4096));
    if (!current.success || bindingSchema.keyof().options.some(field => current.data[field] !== this.binding[field])) fail('denied');
  }
  execute<T>(action: Action, inputDigest: string, work: () => Promise<T> | T, upstream?: AbortSignal, envelopeJson?: string): Promise<T> {
    if (upstream?.aborted) this.controller.abort();
    try { this.active(); } catch (error) { return Promise.reject(error); }
    if (this.pending.size >= this.limits.maxConcurrent || (action === 'model_send' ? this.modelCalls >= this.limits.maxModelCalls : this.toolCalls >= this.limits.maxToolCalls)) return Promise.reject(new AuthoringError('budget'));
    const abort = () => this.controller.abort();
    upstream?.addEventListener('abort', abort, { once: true });
    if (action === 'model_send') {
      if (this.reservedOutputTokens + this.limits.maxTokensPerCall > this.limits.maxTotalOutputTokens) { upstream?.removeEventListener('abort', abort); return Promise.reject(new AuthoringError('budget')); }
      this.reservedOutputTokens += this.limits.maxTokensPerCall; this.modelCalls++;
    } else this.toolCalls++;
    this.event(action, 'started');
    // Register before policy runs: even synchronous reentrancy sees this original promise.
    const operation = Promise.resolve().then(async () => {
      try {
      await this.guard(action, 'before', inputDigest, envelopeJson);
      const result = copyJson(await work(), this.limits.maxOutputBytes);
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (this.outputBytes + bytes > this.limits.maxTotalOutputBytes) fail('budget');
      this.outputBytes += bytes;
      await this.guard(action, 'after', inputDigest, envelopeJson);
      await this.guard(action, 'return', inputDigest, envelopeJson);
      this.event(action, 'returned');
      return result;
      } catch (error) {
        const safe = error instanceof AuthoringError ? error : new AuthoringError('invalid');
        this.event(action, 'failed', safe.code);
        throw safe;
      }
    });
    this.pending.add(operation);
    const settled = () => { this.pending.delete(operation); upstream?.removeEventListener('abort', abort); };
    void operation.then(settled, settled);
    return operation;
  }
  snapshot() { return Object.freeze({ toolCalls: this.toolCalls, modelCalls: this.modelCalls, outputBytes: this.outputBytes, reservedOutputTokens: this.reservedOutputTokens, inputTokens: this.inputTokens, outputTokens: this.outputTokens, pending: this.pending.size, droppedEvents: this.droppedEvents, elapsedMs: Math.max(0, performance.now() - this.started) }); }
  async close() {
    this.closing = true;
    clearTimeout(this.timer);
    this.controller.abort();
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
