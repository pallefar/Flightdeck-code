import type { SubappSnapshot } from '../../packages/subapp-workspace/schema';
import type { WorkbenchStore } from '../workbench/store';
import { captureSubappSnapshot } from './subapp-snapshot';
import type { WorkingSourceReport } from './subapp-source-validation';

export type WorkingSourceReceipt = WorkingSourceReport & { readonly sourceHash: string };
export type WorkingSourceValidator = (snapshot: SubappSnapshot, signal: AbortSignal) => Promise<WorkingSourceReceipt>;
export interface SourceValidationState {
  readonly status: 'idle' | 'checking' | 'checked' | 'failed';
  readonly report: WorkingSourceReceipt | null;
  readonly error: string | null;
}
const idle: SourceValidationState = { status: 'idle', report: null, error: null };

/** Ephemeral inspection only. Never installs evidence into a candidate or durable draft. */
export class SourceValidationController {
  #state = idle;
  #listeners = new Set<() => void>();
  #connected = false;
  #projectId = '';
  #token = '';
  #active = false;
  #epoch = 0;
  #abort: AbortController | null = null;
  #disconnect: (() => void) | null = null;
  constructor(private readonly store: WorkbenchStore, private readonly validate: WorkingSourceValidator) {}
  getState = (): SourceValidationState => this.#state;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  #publish(state: SourceValidationState) { this.#state = state; for (const listener of this.#listeners) listener(); }
  connect() {
    this.#disconnect?.(); this.cancel(); this.#connected = true;
    let previous = this.store.getState();
    const unsubscribe = this.store.subscribe(() => {
      const next = this.store.getState();
      const changed = next.rounds !== previous.rounds || next.selectedRoundId !== previous.selectedRoundId ||
        next.drafts !== previous.drafts || next.editEpoch !== previous.editEpoch || next.busy !== previous.busy;
      previous = next;
      if (changed) this.cancel();
    });
    const cleanup = () => {
      unsubscribe();
      if (this.#disconnect !== cleanup) return;
      this.#disconnect = null; this.#connected = false; this.cancel();
    };
    this.#disconnect = cleanup;
    return cleanup;
  }
  matchesScope(projectId: string, token: string, active: boolean) { return this.#projectId === projectId && this.#token === token && this.#active === active; }
  setScope(projectId: string, token: string, active: boolean) {
    if (this.matchesScope(projectId, token, active)) return;
    this.#projectId = projectId; this.#token = token; this.#active = active; this.cancel();
  }
  cancel() {
    this.#epoch++; this.#abort?.abort(); this.#abort = null;
    if (this.#state !== idle) this.#publish(idle);
  }
  async check(): Promise<boolean> {
    if (!this.#connected || !this.#active || this.#state.status === 'checking') return false;
    const epoch = ++this.#epoch;
    const abort = new AbortController(); this.#abort = abort;
    const current = () => this.#connected && this.#active && this.#epoch === epoch && !abort.signal.aborted;
    try {
      const snapshot = captureSubappSnapshot(this.store.getState());
      this.#publish({ status: 'checking', report: null, error: null });
      if (!current()) return false;
      const report = await this.validate(snapshot, abort.signal);
      if (!current()) return false;
      this.#publish({ status: 'checked', report, error: null });
      return true;
    } catch {
      if (!current()) return false;
      this.#publish({ status: 'failed', report: null, error: 'Static source check unavailable. Apply in-session Save, resolve conflicts and explicitly try again.' });
      return false;
    } finally {
      if (this.#abort === abort) this.#abort = null;
    }
  }
}
