import { expect, it } from 'vitest';
import { currentCandidate, currentRound } from '../../workbench/selectors';
import { captureSubappSnapshot, restoreSubappSnapshot, sourceBundle } from '../subapp-snapshot';
import { generatedStore } from './subapp-workspace.fixture';

it('transfers exact saved source through real Workbench edits without relabeling generated evidence', () => {
  const store = generatedStore();
  const baseline = currentRound(store.getState())!.candidate;
  const file = baseline.files[0]!;
  const manual = file.contents + '\r\n// manual α source\n';
  expect(store.editFile(file.path, manual)).toBeNull();
  store.saveFile(file.path);
  const snapshot = captureSubappSnapshot(store.getState());
  expect(snapshot.baseline).toEqual(baseline);
  expect(snapshot.baseline).not.toBe(baseline);
  expect(snapshot.files.find(f => f.path === file.path)!.contents).toBe(manual);
  const restored = generatedStore();
  const round = restoreSubappSnapshot(restored, snapshot);
  expect(round.candidate).toEqual(baseline);
  expect(currentCandidate(restored.getState())!.files).toEqual(snapshot.files);
  expect(restored.getState().drafts.get(file.path)).toMatchObject({ generated: file.contents, saved: manual, buffer: manual, conflict: null });
  expect(round.candidate.findings).toEqual(baseline.findings);
  expect(restored.getState().runs.every(r => r.steps.length === 0)).toBe(true);
});
it('exports portable inert JSON with exact source and baseline, without requiring a credential', () => {
  const snapshot = captureSubappSnapshot(generatedStore().getState());
  const bundle = JSON.parse(sourceBundle(snapshot));
  expect(bundle).toEqual({ format: 'flightdeck-subapp-source-v1', purpose: 'Source archive only; not an executable application or verified deployment.', snapshot });
});
it('refuses dirty, conflicted, busy and historical capture without losing source buffers', () => {
  const store = generatedStore(); const first = currentRound(store.getState())!; const file = first.candidate.files[0]!;
  store.editFile(file.path, 'unsaved');
  expect(() => captureSubappSnapshot(store.getState())).toThrow(/in-session Save/);
  const turn = store.prompt('another')!;
  expect(() => captureSubappSnapshot(store.getState())).toThrow(/finish/);
  store.settle(turn, { ...first.candidate, files: first.candidate.files.map(f => ({ ...f, contents: f.contents + '\n// regenerated' })) });
  expect(() => captureSubappSnapshot(store.getState())).toThrow(/conflict/);
  expect(store.getState().drafts.get(file.path)!.buffer).toBe('unsaved');
  store.resolveConflict(file.path, 'studio'); store.selectRound(first.id);
  expect(() => captureSubappSnapshot(store.getState())).toThrow(/latest/);
});
it('rejects invalid inventory, getters and unrestorable overlays before any current editor mutation', () => {
  const store = generatedStore(); const before = store.getState();
  const snapshot = captureSubappSnapshot(before);
  const bad = structuredClone(snapshot); bad.files[0]!.path = '../escape.ts';
  expect(() => restoreSubappSnapshot(store, bad)).toThrow(/Invalid/);
  const getter = { get baseline() { throw new Error('must not be read'); }, files: [] };
  expect(() => restoreSubappSnapshot(store, getter)).toThrow(/Invalid/);
  const binary = structuredClone(snapshot); binary.baseline.files[0]!.contents = '\0'; binary.files[0]!.contents = 'manual';
  expect(() => restoreSubappSnapshot(store, binary)).toThrow(/cannot be restored/);
  expect(store.getState()).toBe(before);
});
