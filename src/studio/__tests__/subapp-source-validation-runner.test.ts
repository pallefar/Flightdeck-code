import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { build } from 'esbuild';
import { expect, it, vi } from 'vitest';
import { checkWorkingSource } from '../subapp-source-validation';
import { captureSubappSnapshot } from '../subapp-snapshot';
import { generatedStore } from './subapp-workspace.fixture';
import * as adapter from '../subapp-source-validation-runner';
import type { SubappSnapshot } from '../../../packages/subapp-workspace/schema';

/** Actual isolated worker thread; only the browser message transport is bridged.
 * esbuild bundles the unmodified production worker with browser resolution. */
async function threadFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'fd-source-worker-'));
  const outfile = join(directory, 'worker.mjs');
  try {
    await build({ entryPoints: [new URL('../subapp-source-validation.worker.ts', import.meta.url).pathname],
      outfile, bundle: true, platform: 'browser', format: 'esm', logLevel: 'silent' });
    const thread = new ThreadWorker(`
      const { parentPort, workerData } = require('node:worker_threads');
      globalThis.addEventListener = (type, listener) => {
        if (type === 'message') parentPort.on('message', data => listener({ data }));
      };
      globalThis.postMessage = data => parentPort.postMessage(data);
      import(workerData.url).then(() => parentPort.postMessage({ ready: true }));
    `, { eval: true, workerData: { url: pathToFileURL(outfile).href } });
    const exited = new Promise<number>(resolve => thread.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      thread.once('message', () => resolve()); thread.once('error', reject);
    });
    const target = new EventTarget();
    const bridge = {
      postMessage(value: unknown) { thread.postMessage(value); },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      terminated: 0,
      terminate() { bridge.terminated++; void thread.terminate(); },
    };
    thread.on('message', data => target.dispatchEvent(new MessageEvent('message', { data })));
    thread.on('error', () => target.dispatchEvent(new Event('error')));
    return { bridge, exited, async cleanup() { await thread.terminate(); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

it.each(['valid', 'edited', 'uninspectable', 'many-findings'])('returns the real %s static gate receipt from isolated source without executing candidate text', async kind => {
  expect(adapter.validateWorkingSource).toBeTypeOf('function');
  const fixture = await threadFixture();
  try {
    const snapshot = captureSubappSnapshot(generatedStore().getState());
    const file = snapshot.files.find(file => file.kind === 'web-module')!;
    if (kind === 'edited') file.contents = 'import fs from "node:fs";\nthrow new Error("CANDIDATE_MUST_NOT_EXECUTE");\n' + file.contents;
    if (kind === 'many-findings') file.contents = Array.from({ length: 120 }, (_, index) => `import fs${index} from "node:fs";`).join('\n') + '\n' + file.contents;
    if (kind === 'uninspectable') {
      const manifest = snapshot.files.find(file => file.kind === 'manifest')!;
      snapshot.baseline.files.find(file => file.path === manifest.path)!.path = manifest.path.replace('/manifest.ts', '/absent-manifest.ts');
      manifest.path = manifest.path.replace('/manifest.ts', '/absent-manifest.ts');
    }
    const report = checkWorkingSource(snapshot);
    const expectedHash = createHash('sha256').update(JSON.stringify(snapshot.files)).digest('hex');
    const pending = adapter.validateWorkingSource(snapshot, new AbortController().signal, { workerFactory: () => fixture.bridge });
    // The receipt must remain bound to the pre-await source, not later caller edits.
    file.contents = 'CALLER_CHANGED_AFTER_CAPTURE';
    const receipt = await pending;
    expect(receipt).toEqual({ ...report, sourceHash: expectedHash });
    expect(receipt.staticChecksComplete).toBe(kind !== 'uninspectable');
    expect(receipt.ok).toBe(kind === 'valid');
    if (kind === 'many-findings') { expect(receipt.findings).toHaveLength(100); expect(receipt.errorCount).toBeGreaterThan(100); }
    if (kind === 'edited') expect(receipt.findings).toContainEqual(expect.objectContaining({ rule: 'FD-C001', file: file.path }));
    expect(JSON.stringify(receipt)).not.toMatch(/CANDIDATE_MUST_NOT_EXECUTE|Synthetic retained evidence|contents|evidence/);
    expect(fixture.bridge.terminated).toBe(1);
    expect(await fixture.exited).toBe(1);
  } finally { await fixture.cleanup(); }
}, 15_000);

it('rejects pre-aborted requests without constructing a worker or exposing the abort reason', async () => {
  const abort = new AbortController(); abort.abort(new Error('PRIVATE_ABORT_REASON'));
  const factory = vi.fn((): adapter.WorkingSourceWorker => { throw new Error('PRIVATE_WORKER_ERROR'); });
  await expect(adapter.validateWorkingSource(captureSubappSnapshot(generatedStore().getState()), abort.signal, { workerFactory: factory }))
    .rejects.toMatchObject({ name: 'AbortError', message: 'Working-source validation cancelled.' });
  expect(factory).not.toHaveBeenCalled();
});

/** Synthetic transport fixtures cover races, not native browser lifecycle. */
function controlledWorker(onPost?: (value: unknown) => void) {
  const target = new EventTarget();
  const listeners = new Map<string, Set<EventListener>>();
  return {
    postMessage: vi.fn((value: unknown) => { onPost?.(value); }),
    terminate: vi.fn(),
    addEventListener(type: string, listener: EventListener) {
      const set = listeners.get(type) ?? new Set<EventListener>(); set.add(listener); listeners.set(type, set);
      target.addEventListener(type, listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener); target.removeEventListener(type, listener);
    },
    listenerCount() { return [...listeners.values()].reduce((count, set) => count + set.size, 0); },
    emit(type: string, data?: unknown) { target.dispatchEvent(type === 'message' ? new MessageEvent(type, { data }) : new Event(type, { cancelable: true })); },
  };
}

it.each(['construction', 'post', 'error', 'messageerror'])(
  'sanitizes %s failures and releases the owned transport', async kind => {
    const worker = controlledWorker(() => { if (kind === 'post') throw new Error('PRIVATE_SOURCE_ERROR'); });
    const factory = () => { if (kind === 'construction') throw new Error('PRIVATE_WORKER_URL'); return worker; };
    const pending = adapter.validateWorkingSource(captureSubappSnapshot(generatedStore().getState()), new AbortController().signal, { workerFactory: factory });
    if (kind === 'error' || kind === 'messageerror') worker.emit(kind);
    await expect(pending).rejects.toThrow('Working-source static validation unavailable.');
    expect(worker.terminate).toHaveBeenCalledTimes(kind === 'construction' ? 0 : 1);
    expect(worker.listenerCount()).toBe(0);
  },
);

it.each(['after-post', 'during-construction'])(
  'cancels %s without retaining worker or signal listeners', async when => {
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const worker = controlledWorker();
    const pending = adapter.validateWorkingSource(captureSubappSnapshot(generatedStore().getState()), abort.signal, {
      workerFactory: () => { if (when === 'during-construction') abort.abort('PRIVATE_REASON'); return worker; },
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Working-source validation cancelled.' });
    if (when === 'after-post') abort.abort('PRIVATE_REASON');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.listenerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    if (when === 'during-construction') expect(worker.postMessage).not.toHaveBeenCalled();
    worker.emit('message', { type: 'result', receipt: { ok: true } });
    await rejected;
  },
);

it('terminates a hung worker at ten seconds and removes the deadline and listeners', async () => {
  vi.useFakeTimers();
  try {
    const worker = controlledWorker();
    const pending = adapter.validateWorkingSource(captureSubappSnapshot(generatedStore().getState()), new AbortController().signal, { workerFactory: () => worker });
    const outcome = pending.then(value => value, error => error as Error);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(worker.terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ message: 'Working-source static validation timed out.' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    worker.emit('message', { type: 'result', receipt: { ok: true } });
    expect(worker.terminate).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it.each(['unknown-field', 'source-evidence', 'hash', 'executed', 'typechecked', 'scope', 'findings-count',
  'missing-complete', 'inconsistent-ok', 'unknown-rule', 'forged-title', 'unknown-file', 'check-text', 'error-envelope', 'null', 'accessor', 'oversized'])(
  'refuses %s worker replies instead of trusting unbounded or authority-bearing metadata', async kind => {
    const snapshot = captureSubappSnapshot(generatedStore().getState());
    const file = snapshot.files.find(file => file.kind === 'web-module')!;
    file.contents = 'import fs from "node:fs";\n' + file.contents;
    const receipt = { ...structuredClone(checkWorkingSource(snapshot)), sourceHash: 'a'.repeat(64) } as Record<string, unknown>;
    const findings = receipt.findings as Record<string, unknown>[];
    let reply: unknown = { type: 'result', receipt };
    const getter = vi.fn(() => false);
    if (kind === 'unknown-field') receipt.credential = 'NONSECRET_FIXTURE';
    if (kind === 'source-evidence') findings[0]!.evidence = 'PRIVATE_SOURCE_SNIPPET';
    if (kind === 'hash') receipt.sourceHash = 'invalid';
    if (kind === 'executed') receipt.executed = true;
    if (kind === 'typechecked') receipt.typechecked = true;
    if (kind === 'scope') receipt.scope = 'host-approved';
    if (kind === 'findings-count') receipt.findings = Array.from({ length: 101 }, () => findings[0]);
    if (kind === 'missing-complete') delete receipt.staticChecksComplete;
    if (kind === 'inconsistent-ok') receipt.ok = true;
    if (kind === 'unknown-rule') findings[0]!.rule = 'PRIVATE_RULE_TEXT';
    if (kind === 'forged-title') findings[0]!.title = 'PRIVATE_TITLE';
    if (kind === 'unknown-file') findings[0]!.file = 'server/not-in-this-snapshot.ts';
    if (kind === 'check-text') receipt.checks = ['PRIVATE_CHECK_TEXT'];
    if (kind === 'error-envelope') reply = { type: 'error', message: 'PRIVATE_WORKER_ERROR' };
    if (kind === 'null') reply = null;
    if (kind === 'accessor') Object.defineProperty(receipt, 'ok', { get: getter, enumerable: true });
    if (kind === 'oversized') receipt.padding = 'x'.repeat(100_000);
    const worker = controlledWorker();
    const pending = adapter.validateWorkingSource(snapshot, new AbortController().signal, { workerFactory: () => worker });
    worker.emit('message', reply);
    await expect(pending).rejects.toThrow('Working-source static validation unavailable.');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.listenerCount()).toBe(0);
    expect(getter).not.toHaveBeenCalled();
  },
);

it.each(['shape', 'source-size', 'total-size', 'inventory', 'accessor', 'cycle', 'extra-context'])(
  'refuses %s before constructing a worker with fixed safe errors', async kind => {
    const snapshot = captureSubappSnapshot(generatedStore().getState());
    const getter = vi.fn(() => { throw new Error('PRIVATE_GETTER'); });
    let invalid: unknown = snapshot;
    if (kind === 'shape') invalid = null;
    if (kind === 'source-size') snapshot.files[0]!.contents = 'x'.repeat(200_001);
    if (kind === 'total-size') {
      snapshot.files = Array.from({ length: 20 }, (_, index) => ({ path: `server/file${index}.ts`, contents: 'x'.repeat(100_000), kind: 'unknown' }));
      snapshot.baseline.files = structuredClone(snapshot.files);
    }
    if (kind === 'inventory') snapshot.files.pop();
    if (kind === 'accessor') Object.defineProperty(snapshot, 'files', { get: getter, enumerable: true });
    if (kind === 'cycle') Object.assign(snapshot, { cycle: snapshot });
    if (kind === 'extra-context') Object.assign(snapshot, { projectId: 'private-project', credential: 'NONSECRET_FIXTURE' });
    const factory = vi.fn((): adapter.WorkingSourceWorker => { throw new Error('PRIVATE_WORKER_ERROR'); });
    await expect(adapter.validateWorkingSource(invalid as SubappSnapshot, new AbortController().signal, { workerFactory: factory }))
      .rejects.toThrow('Working source exceeds snapshot bounds or has an invalid artifact inventory.');
    expect(factory).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  },
);
