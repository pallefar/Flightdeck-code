/** The workbench's single source of truth.
 *
 * ── WHY ONE IMMUTABLE SNAPSHOT AND NOT A BAG OF ATOMS ────────────────
 * The reference implementation this was measured against keeps a dozen
 * independent atoms (`selectedFile`, `currentView`, `unsavedFiles`,
 * `documents`, …) and lets components subscribe to each. That is a fine
 * shape when the panes are independent. These panes are not: the diff pane
 * is a function of TWO adjacent rounds, the preview is a function of the
 * selected round AND the enable layers AND the findings, and the gate pane
 * cross-highlights into the file tree. Every one of those is a derived
 * value spanning fields that would live in different atoms, and deriving
 * across atoms is where the tearing bugs live.
 *
 * So: one frozen `WorkbenchState`, one `subscribe`, and every cross-cutting
 * question answered by a pure selector in `selectors.ts` that takes the
 * snapshot. `useSyncExternalStore` then has exactly the contract it wants —
 * a stable reference that changes if and only if something changed.
 *
 * ── THE RULE THAT MAKES THAT WORK ────────────────────────────────────
 * Every action funnels through `#commit`, which does nothing and notifies
 * nobody when the patch changes no field. A store that notifies on a
 * no-op `selectFile(samePath)` makes `useSyncExternalStore` re-render the
 * whole workbench on every click that changed nothing, and — worse — an
 * infinite loop if any component commits during render. `store.test.ts`
 * asserts the no-op case explicitly, because it is invisible until it is a
 * performance bug nobody can reproduce.
 *
 * ── ROUNDS ARE APPEND-ONLY ───────────────────────────────────────────
 * "What changed this round" is the whole point of the diff pane, and it is
 * a question about two file sets. Mutating a round in place would answer
 * it with "nothing". Regeneration appends. */
import {
  ALL_ENABLED,
  type Candidate,
  type EnableLayers,
  type Round,
  type Severity,
  type Turn,
  type WorkbenchView,
} from "./types";

export type SeverityFilter = Severity | "all";

export interface WorkbenchState {
  /** Chat transcript, oldest first. */
  readonly turns: readonly Turn[];
  /** Generation rounds, oldest first. Append-only. */
  readonly rounds: readonly Round[];
  /** Which round the file/diff/preview/gate panes are showing. `null`
   * before the first one lands. */
  readonly selectedRoundId: string | null;
  readonly view: WorkbenchView;
  /** Repo-relative path of the open file, or `null`. */
  readonly selectedPath: string | null;
  readonly collapsedDirs: ReadonlySet<string>;
  readonly enable: EnableLayers;
  readonly severityFilter: SeverityFilter;
  /** A rule id the person is hovering or has clicked in the gate pane.
   * The tree and the preview both dim everything it does not touch. */
  readonly focusedRule: string | null;
  /** True between `prompt()` and the turn settling. The composer disables
   * itself off this, so a double-submit cannot open two rounds. */
  readonly busy: boolean;
}

export interface StoreOptions {
  /** Injected so tests are not at the mercy of the wall clock, and so a
   * replayed session can carry its original timestamps. */
  readonly clock?: () => number;
  /** Injected so ids in a test are readable (`t1`, `t2`) instead of uuids. */
  readonly ids?: () => string;
}

export type Listener = () => void;

function counterIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `w${n}`;
  };
}

const EMPTY_STATE: WorkbenchState = Object.freeze({
  turns: Object.freeze([]) as readonly Turn[],
  rounds: Object.freeze([]) as readonly Round[],
  selectedRoundId: null,
  view: "files" as WorkbenchView,
  selectedPath: null,
  collapsedDirs: new Set<string>() as ReadonlySet<string>,
  enable: ALL_ENABLED,
  severityFilter: "all" as SeverityFilter,
  focusedRule: null,
  busy: false,
});

/** Which file the workbench opens when a round lands.
 *
 * The manifest, when there is one. It is the file that decides whether the
 * host boots at all (contract §2, fail-loud), it is the shortest file in
 * the set, and it is the one whose fields every other file is derived
 * from — so it is the file that orients a reader fastest. Falling back to
 * "first alphabetically" would open `guard.ts`, which is the same text in
 * every generated app and therefore tells a reader nothing. */
export function defaultSelection(candidate: Candidate): string | null {
  const manifest = candidate.files.find((file) => file.kind === "manifest");
  if (manifest !== undefined) return manifest.path;
  const first = [...candidate.files].sort((a, b) => a.path.localeCompare(b.path))[0];
  return first?.path ?? null;
}

export class WorkbenchStore {
  #state: WorkbenchState = EMPTY_STATE;
  #listeners = new Set<Listener>();
  readonly #clock: () => number;
  readonly #nextId: () => string;

  constructor(options: StoreOptions = {}) {
    this.#clock = options.clock ?? (() => Date.now());
    this.#nextId = options.ids ?? counterIds();
  }

  // ── the `useSyncExternalStore` contract ────────────────────────────

  getState = (): WorkbenchState => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** The one place state changes. Returns whether anything actually did,
   * which a few actions use to decide if further work is worth doing. */
  #commit(patch: Partial<WorkbenchState>): boolean {
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof WorkbenchState>) {
      if (patch[key] !== undefined && !Object.is(patch[key], this.#state[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;
    this.#state = Object.freeze({ ...this.#state, ...patch });
    for (const listener of [...this.#listeners]) listener();
    return true;
  }

  // ── chat ───────────────────────────────────────────────────────────

  /** Opens a round: the person's turn, plus the empty Studio turn its
   * answer streams into. Returns the id of THAT turn, which is the handle
   * every other chat action takes — so a caller cannot accidentally stream
   * a model's answer into the person's own message.
   *
   * Refuses while busy. One in-flight round at a time is not a limitation
   * of the store, it is the product: two concurrent rounds would both diff
   * against the same base and the second would silently clobber the first. */
  prompt(text: string): string | null {
    const body = text.trim();
    if (body.length === 0 || this.#state.busy) return null;
    const at = this.#clock();
    const userTurn: Turn = { id: this.#nextId(), role: "you", text: body, status: "settled", at, roundId: null };
    const studioTurn: Turn = { id: this.#nextId(), role: "studio", text: "", status: "streaming", at, roundId: null };
    this.#commit({ turns: [...this.#state.turns, userTurn, studioTurn], busy: true });
    return studioTurn.id;
  }

  /** Appends streamed text. A no-op for an empty chunk or an unknown turn,
   * so a stream that outlives its turn cannot resurrect it. */
  stream(turnId: string, chunk: string): void {
    if (chunk.length === 0) return;
    this.#patchTurn(turnId, (turn) =>
      turn.status === "streaming" ? { ...turn, text: turn.text + chunk } : turn,
    );
  }

  /** The happy path: the answer is done and it produced a sub-app.
   *
   * Creating the round, selecting it, opening its most informative file
   * and clearing `busy` are ONE commit. Split across four, every subscriber
   * renders four times and three of those renders show a round that exists
   * with no file selected. */
  settle(turnId: string, candidate: Candidate, text?: string): Round | null {
    const turn = this.#state.turns.find((t) => t.id === turnId);
    if (turn === undefined || turn.status !== "streaming") return null;
    const at = this.#clock();
    const round: Round = {
      id: this.#nextId(),
      ordinal: this.#state.rounds.length + 1,
      prompt: this.#promptFor(turnId),
      candidate,
      at,
    };
    const turns = this.#state.turns.map((t) =>
      t.id === turnId
        ? { ...t, status: "settled" as const, roundId: round.id, text: text ?? t.text }
        : t,
    );
    this.#commit({
      turns,
      rounds: [...this.#state.rounds, round],
      selectedRoundId: round.id,
      selectedPath: defaultSelection(candidate),
      busy: false,
      focusedRule: null,
    });
    return round;
  }

  /** Studio declined — the ask breaks the contract and no file was written.
   * Deliberately NOT `fail`: a refusal is a correct outcome with a reason
   * and the pane renders it in amber, not red. Contract §2 is fail-loud by
   * design, and a UI that paints "I will not generate a sub-app that reads
   * `node:fs`" the same red as "Studio crashed" teaches people that red
   * means nothing. */
  refuse(turnId: string, reason: string): void {
    this.#patchTurn(turnId, (turn) => ({ ...turn, status: "refused", text: reason }));
    this.#commit({ busy: false });
  }

  /** Studio broke. */
  fail(turnId: string, reason: string): void {
    this.#patchTurn(turnId, (turn) => ({ ...turn, status: "failed", text: reason }));
    this.#commit({ busy: false });
  }

  #promptFor(studioTurnId: string): string {
    const index = this.#state.turns.findIndex((t) => t.id === studioTurnId);
    for (let i = index - 1; i >= 0; i -= 1) {
      const turn = this.#state.turns[i];
      if (turn !== undefined && turn.role === "you") return turn.text;
    }
    return "";
  }

  #patchTurn(turnId: string, patch: (turn: Turn) => Turn): void {
    const index = this.#state.turns.findIndex((t) => t.id === turnId);
    if (index === -1) return;
    const current = this.#state.turns[index];
    if (current === undefined) return;
    const next = patch(current);
    if (next === current) return;
    const turns = [...this.#state.turns];
    turns[index] = next;
    this.#commit({ turns });
  }

  // ── panes ──────────────────────────────────────────────────────────

  setView(view: WorkbenchView): void {
    this.#commit({ view });
  }

  selectFile(path: string | null): void {
    this.#commit({ selectedPath: path });
  }

  /** Open a file AND switch to the pane that shows files. What the gate
   * pane's "jump to source" does — a finding is only actionable if the
   * click lands you on the line. */
  revealFile(path: string): void {
    this.#commit({ selectedPath: path, view: "files" });
  }

  toggleDir(path: string): void {
    const next = new Set(this.#state.collapsedDirs);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.#commit({ collapsedDirs: next });
  }

  selectRound(roundId: string): void {
    const round = this.#state.rounds.find((r) => r.id === roundId);
    if (round === undefined) return;
    // Keep the open file if the newly selected round also has it — moving
    // between rounds to compare the SAME file is the common motion, and a
    // pane that resets to the manifest every time defeats it.
    const keep =
      this.#state.selectedPath !== null &&
      round.candidate.files.some((f) => f.path === this.#state.selectedPath);
    this.#commit({
      selectedRoundId: roundId,
      selectedPath: keep ? this.#state.selectedPath : defaultSelection(round.candidate),
    });
  }

  setEnable(patch: Partial<EnableLayers>): void {
    this.#commit({ enable: { ...this.#state.enable, ...patch } });
  }

  setSeverityFilter(severityFilter: SeverityFilter): void {
    this.#commit({ severityFilter });
  }

  focusRule(rule: string | null): void {
    this.#commit({ focusedRule: rule });
  }

  reset(): void {
    this.#state = EMPTY_STATE;
    for (const listener of [...this.#listeners]) listener();
  }
}

export function createStore(options: StoreOptions = {}): WorkbenchStore {
  return new WorkbenchStore(options);
}
