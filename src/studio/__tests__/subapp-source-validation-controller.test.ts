import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { SourceValidationController, type WorkingSourceValidator } from '../subapp-source-validation-controller';
import { checkWorkingSource } from '../subapp-source-validation';
import { generatedStore } from './subapp-workspace.fixture';

const direct: WorkingSourceValidator = async snapshot => ({ ...checkWorkingSource(snapshot), sourceHash: createHash('sha256').update(JSON.stringify(snapshot.files)).digest('hex') });

it('requires an explicit check and reports the actual captured working source without changing editor or baseline', async () => {
  const store = generatedStore(); let calls = 0;
  const controller = new SourceValidationController(store, async (snapshot, signal) => { calls++; expect(signal.aborted).toBe(false); expect(Object.keys(snapshot)).toEqual(['baseline', 'files']); return direct(snapshot, signal); });
  const cleanup = controller.connect(); controller.setScope('demo', 'development-sentinel', true);
  const original = store.getState();
  expect(controller.getState().status).toBe('idle'); expect(calls).toBe(0);
  expect(await controller.check()).toBe(true);
  expect(calls).toBe(1); expect(controller.getState().status).toBe('checked');
  expect(controller.getState().report).toMatchObject({ ok: true, scope: 'working-source-static-only', staticChecksComplete: true, executed: false, typechecked: false });
  expect(controller.getState().report!.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(store.getState()).toBe(original);
  expect(JSON.stringify(controller.getState())).not.toContain('development-sentinel'); cleanup();
});

it('aborts and permanently discards a late check when a source buffer changes, even if it is reverted', async () => {
  const store = generatedStore(); let release!: () => void; let signal!: AbortSignal;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const controller = new SourceValidationController(store, async (snapshot, capturedSignal) => { signal = capturedSignal; await barrier; return direct(snapshot, capturedSignal); });
  const cleanup = controller.connect(); controller.setScope('demo', '', true);
  const pending = controller.check();
  expect(controller.getState().status).toBe('checking');
  const file = store.effectiveFiles().find(file => file.kind === 'web-module')!;
  store.editFile(file.path, file.contents + '\n// pending edit');
  expect(signal.aborted).toBe(true);
  expect(controller.getState().report).toBeNull();
  store.revertFile(file.path); release();
  expect(await pending).toBe(false);
  expect(controller.getState().status).toBe('idle');
  expect(controller.getState().report).toBeNull(); cleanup();
});


it.each(['project', 'credential', 'hide', 'disconnect', 'reset', 'new-generation'] as const)('permanently rejects late receipts after %s context drift', async change => {
  const store = generatedStore(); let release!: () => void; let signal!: AbortSignal;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const controller = new SourceValidationController(store, async (snapshot, captured) => { signal = captured; await barrier; return direct(snapshot, captured); });
  const cleanup = controller.connect(); controller.setScope('demo', 'old-development', true);
  const pending = controller.check();
  if (change === 'project') { controller.setScope('other', 'old-development', true); controller.setScope('demo', 'old-development', true); }
  if (change === 'credential') { controller.setScope('demo', 'new-development', true); controller.setScope('demo', 'old-development', true); }
  if (change === 'hide') { controller.setScope('demo', 'old-development', false); controller.setScope('demo', 'old-development', true); }
  if (change === 'disconnect') { cleanup(); controller.connect(); }
  if (change === 'reset') store.reset();
  if (change === 'new-generation') store.prompt('Follow-up');
  expect(signal.aborted).toBe(true); release();
  expect(await pending).toBe(false); expect(controller.getState().report).toBeNull(); cleanup();
});

it('revokes settled checks on first typing and does not revive them after reverting, but view navigation alone retains them', async () => {
  const store = generatedStore(); const controller = new SourceValidationController(store, direct);
  const cleanup = controller.connect(); controller.setScope('demo', '', true); await controller.check();
  const report = controller.getState().report;
  store.setView('diff'); expect(controller.getState().report).toBe(report);
  const file = store.effectiveFiles().find(file => file.kind === 'web-module')!;
  store.editFile(file.path, file.contents + '\n// unsaved'); expect(controller.getState().report).toBeNull();
  store.revertFile(file.path); expect(controller.getState().report).toBeNull(); cleanup();
});

it('refuses dirty buffers before invoking validation and rejects overlapping checks', async () => {
  const store = generatedStore(); let calls = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const controller = new SourceValidationController(store, async (snapshot, signal) => { calls++; await barrier; return direct(snapshot, signal); });
  const cleanup = controller.connect(); controller.setScope('demo', '', true);
  const file = store.effectiveFiles().find(file => file.kind === 'web-module')!;
  store.editFile(file.path, file.contents + '\n// pending');
  expect(await controller.check()).toBe(false); expect(calls).toBe(0);
  store.saveFile(file.path); const pending = controller.check();
  expect(await controller.check()).toBe(false); expect(calls).toBe(1); release();
  expect(await pending).toBe(true); cleanup();
});

it('does not let old StrictMode cleanup cancel a newer connection and sanitizes validator failures', async () => {
  const store = generatedStore();
  const controller = new SourceValidationController(store, async () => { throw new Error('PRIVATE-SOURCE-development-only'); });
  const oldCleanup = controller.connect(); controller.setScope('demo', '', true);
  const currentCleanup = controller.connect(); oldCleanup();
  expect(await controller.check()).toBe(false);
  expect(controller.getState().status).toBe('failed'); expect(controller.getState().error).not.toContain('PRIVATE-SOURCE'); currentCleanup();
});
