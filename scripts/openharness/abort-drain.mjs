// DEVELOPMENT ONLY: real SDK abort over a held original real broker promise.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect, Stream } from 'effect';
import { z } from 'zod';
import { agent, workflow, phase, run, ProviderError } from '@open-harness/sdk/core';
const { createDraftBroker } = await import(process.argv[2]);
const checks = [];
const check = (id, ok) => { assert.equal(ok, true, id); checks.push({ id, passed: true }); };
const binding = Object.freeze({ actorId: 'DEVELOPMENT_PUBLIC_FIXTURE', workspaceId: 'development-workspace', projectId: 'development-project', modelId: 'development-no-model', modelBindingId: 'development-no-vendor', contextEpoch: 'development-v1', policyEpoch: 'development-read-only-v1' });
let release;
let entered;
const gate = new Promise(resolve => { release = resolve; });
const entry = new Promise(resolve => { entered = resolve; });
const policyCalls = [];
const broker = createDraftBroker({ binding, protectedGraph: null, limits: { maxModelCalls: 1, maxToolCalls: 1, maxConcurrent: 1, maxDurationMs: 10000, maxInputBytes: 512000, maxOutputBytes: 512000, maxTotalOutputBytes: 1000000, maxTokensPerCall: 1, maxTotalOutputTokens: 1, maxEvents: 32 }, authorize: async request => {
  policyCalls.push(request.action + ':' + request.stage);
  if (request.stage === 'before') { entered(); await gate; }
  return { allowed: request.action === 'read_block_catalog', binding };
} });
const pending = new Set();
const provider = Object.freeze({ name: 'DEVELOPMENT_HELD_LOCAL_BROKER_NO_VENDOR', model: 'development-no-model', stream: () => Stream.fromEffect(Effect.tryPromise({ try: () => {
  const original = broker.invoke('read_block_catalog', {});
  pending.add(original);
  void original.then(() => pending.delete(original), () => pending.delete(original));
  return original.then(catalog => ({ _tag: 'Result', output: { blockCount: catalog.blocks.length }, stopReason: 'end_turn' }));
}, catch: () => new ProviderError({ code: 'UNKNOWN', message: 'development broker refused', retryable: false }) })) });
const local = agent({ name: 'development-held-catalog', provider, output: z.object({ blockCount: z.number().int().nonnegative() }), prompt: () => 'DEVELOPMENT LOCAL BROKER ONLY', update: (out, draft) => { draft.blockCount = out.blockCount; } });
const graph = workflow({ name: 'development-original-broker-drain', initialState: { blockCount: 0 }, start: () => {}, phases: { catalog: phase({ run: local, next: 'done' }), done: phase.terminal() } });
const store = { append: () => Effect.void, getEvents: () => Effect.succeed([]), getEventsFrom: () => Effect.succeed([]), listSessions: () => Effect.succeed([]), deleteSession: () => Effect.void };
const bus = { publish: () => Effect.void, subscribe: () => Stream.empty };
// Empty recording identity prevents append/finalize; all data is dropped.
const recorder = { load: () => Effect.succeed(null), list: () => Effect.succeed([]), delete: () => Effect.void, startRecording: () => Effect.succeed(''), appendEvent: () => Effect.void, finalizeRecording: () => Effect.void };
let handle;
let outer;
let drained;
try {
  handle = run(graph, { input: '', runtime: { mode: 'live', eventStore: store, eventBus: bus, recorder }, sessionId: 'development-held-real-broker' });
  let settled = false;
  outer = Promise.resolve(handle).then(() => { settled = true; return 'UNEXPECTED SUCCESS'; }, error => { settled = true; return String(error); });
  await entry;
  check('held-original-real-broker-pending', pending.size === 1 && broker.snapshot().pending === 1);
  handle.abort();
  await delay(30);
  check('sdk-abort-settles-before-original-broker', settled && pending.size === 1 && broker.snapshot().pending === 1);
  check('sdk-abort-is-not-success', (await outer).includes('Workflow aborted'));
  let drainFinished = false;
  drained = (async () => { await Promise.allSettled([...pending]); await broker.close(); drainFinished = true; })();
  await delay(30);
  check('drain-retains-original-work-after-outer-abort', !drainFinished && pending.size === 1);
  release();
  await drained;
  check('original-and-broker-close-fully-drained', drainFinished && pending.size === 0 && broker.snapshot().pending === 0);
  check('abort-control-zero-model-sends', broker.snapshot().modelCalls === 0);
  check('abort-control-no-retry-or-extra-tool-call', broker.snapshot().toolCalls === 1);
  check('original-policy-stages-remain-authoritative', JSON.stringify(policyCalls) === JSON.stringify(['read_block_catalog:before', 'read_block_catalog:after', 'read_block_catalog:return']));
} finally {
  release();
  await Promise.allSettled([...pending]);
  await broker.close();
  if (outer) await outer;
  if (drained) await drained;
}
writeFileSync(process.argv[3], JSON.stringify({ provenance: 'DEVELOPMENT ONLY. Actual SDK + existing local draft broker. Synthetic read-only policy, no host identity/grants.', checks, passed: checks.length, snapshot: broker.snapshot(), productionIntegration: false }, null, 2) + '\n');
