import { snapshotSchema, type SubappSnapshot } from '../../packages/subapp-workspace/schema';
import { editability, isDirty } from '../workbench/editing';
import { currentCandidate, currentRound } from '../workbench/selectors';
import { createStore, type WorkbenchState, type WorkbenchStore } from '../workbench/store';
import type { Round } from '../workbench/types';

export class SubappSnapshotError extends Error {}
export function snapshotDisabledReason(state: WorkbenchState): string | null {
  if (state.busy) return 'Wait for the current generation to finish.';
  const round = currentRound(state);
  if (!round) return 'Generate or open a sub-app first.';
  if (round !== state.rounds.at(-1)) return 'Select the latest round before saving or exporting working source.';
  if ([...state.drafts.values()].some(draft => draft.conflict !== null || isDirty(draft)))
    return 'Apply in-session Save first and resolve every source conflict. Durable Save does not apply editor buffers.';
  return null;
}
/** Detached, bounded snapshot captured synchronously, before any async work. */
export function captureSubappSnapshot(state: WorkbenchState): SubappSnapshot {
  const reason = snapshotDisabledReason(state);
  if (reason) throw new SubappSnapshotError(reason);
  const baseline = currentRound(state)!.candidate;
  const candidate = currentCandidate(state)!;
  const parsed = snapshotSchema.safeParse({ baseline, files: candidate.files });
  if (!parsed.success) throw new SubappSnapshotError('Source exceeds durable snapshot bounds or has an unsupported artifact inventory.');
  return parsed.data;
}

function install(store: WorkbenchStore, snapshot: SubappSnapshot): Round {
  store.reset();
  const turn = store.prompt('Opened saved sub-app source — no generation, verification or execution.');
  const round = turn ? store.settle(turn, snapshot.baseline, 'Saved source restored. Checks describe the immutable generated baseline only.') : null;
  if (!round) throw new SubappSnapshotError('Source restoration refused.');
  const originals = new Map(snapshot.baseline.files.map(file => [file.path, file]));
  for (const file of snapshot.files) {
    if (file.contents === originals.get(file.path)!.contents) continue;
    if (store.editFile(file.path, file.contents) !== null || !store.saveFile(file.path)) throw new SubappSnapshotError('Source restoration refused.');
  }
  store.setView('files');
  return round;
}
/** Validate and stage with actual edit/save semantics BEFORE replacing anything. */
export function restoreSubappSnapshot(store: WorkbenchStore, value: unknown): Round {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw new SubappSnapshotError('Invalid saved source snapshot; current editor was not changed.');
  const snapshot = parsed.data;
  const originals = new Map(snapshot.baseline.files.map(file => [file.path, file]));
  for (const file of snapshot.files) {
    const original = originals.get(file.path)!;
    if (file.contents !== original.contents && !editability(original).editable)
      throw new SubappSnapshotError('Saved overlay cannot be restored through this source editor; current editor was not changed.');
  }
  install(createStore(), snapshot);
  return install(store, snapshot);
}

/** Portable inert JSON only; never evaluates source or writes a host path. */
export function sourceBundle(snapshot: SubappSnapshot): string {
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new SubappSnapshotError('Invalid source bundle.');
  return JSON.stringify({ format: 'flightdeck-subapp-source-v1', purpose: 'Source archive only; not an executable application or verified deployment.', snapshot: parsed.data }, null, 2);
}
