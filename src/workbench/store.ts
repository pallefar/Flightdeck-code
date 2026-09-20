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
  applyDrafts,
  editability,
  editDraft,
  openDraft,
  reconcileDrafts,
  resolveDraft,
  revertDraft,
  saveDraft,
  type Draft,
} from "./editing";
import {
  createRun,
  createStep,
  endStep,
  pathsBeingWritten,
  pushOutput,
  startStep,
  TERMINAL,
  type LogStream,
  type Run,
  type Step,
  type StepSpec,
  type StepStatus,
} from "./run";
import {
  ALL_ENABLED,
  type Candidate,
  type EnableLayers,
  type GeneratedFile,
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

  // ── what the builder is doing, and what the person did to it ──────

  /** One per round attempted, in order, including the ones that were
   * refused, failed or stopped. Append-only for the same reason rounds
   * are: "why did round 3 fail" is a question about round 3's steps, and
   * a run that is overwritten by the next attempt cannot answer it. */
  readonly runs: readonly Run[];
  /** Open editors, keyed by path. A path is in here only because the
   * person touched it or locked it — this is not a document cache. */
  readonly drafts: ReadonlyMap<string, Draft>;
  /** Paths the person has claimed. See `editing.ts` for what a lock is
   * and, more importantly, what it is not. */
  readonly locks: ReadonlySet<string>;
  /** Bumped when, and only when, the SAVED overlay changes — so the
   * derived-value caches in `selectors.ts` can key on it. Typing does not
   * bump it: a keystroke must not invalidate a diff of every file in the
   * round. */
  readonly editEpoch: number;
}

export interface StoreOptions {
  /** Injected so tests are not at the mercy of the wall clock, and so a
   * replayed session can carry its original timestamps. */
  readonly clock?: () => number;
  /** Injected so ids in a test are readable (`t1`, `t2`) instead of uuids. */
  readonly ids?: () => string;
}

export type Listener = () => void;

/** A map with one key replaced, as a new map. The store compares by
 * identity, so every collection it holds is rebuilt rather than mutated —
 * a mutated map is a map `#commit` cannot see has changed. */
function replace<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

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
  runs: Object.freeze([]) as readonly Run[],
  drafts: new Map<string, Draft>() as ReadonlyMap<string, Draft>,
  locks: new Set<string>() as ReadonlySet<string>,
  editEpoch: 0,
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
    // Opening the run and switching to it is part of the same commit as
    // the turns. A person who pressed Build is asking to watch something
    // happen; landing them on the pane where it happens is not a
    // convenience, it is the answer to what they asked.
    this.#commit({
      turns: [...this.#state.turns, userTurn, studioTurn],
      runs: [...this.#state.runs, createRun(studioTurn.id, at)],
      busy: true,
      view: "run",
    });
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

    // Reconcile in the SAME commit that appends the round. Split in two, a
    // subscriber renders once with the new round's files and the old
    // round's drafts — which is precisely the frame in which the editor
    // would show somebody their own text over somebody else's file.
    const previous = this.#state.rounds[this.#state.rounds.length - 1];
    const drafts = reconcileDrafts({
      drafts: this.#state.drafts,
      locks: this.#state.locks,
      previousFiles: previous?.candidate.files ?? null,
      nextFiles: candidate.files,
      nextRoundId: round.id,
      at,
    });
    const runs = this.#endRun(turnId, at, null);

    // A file the person is holding against the round stays open — the
    // conflict IS the thing to look at, and dropping them on the manifest
    // instead would bury it behind a tab.
    const held = [...drafts.values()].find((draft) => draft.conflict !== null) ?? null;

    this.#commit({
      turns,
      runs,
      drafts,
      editEpoch: drafts === this.#state.drafts ? this.#state.editEpoch : this.#state.editEpoch + 1,
      rounds: [...this.#state.rounds, round],
      selectedRoundId: round.id,
      selectedPath: held?.path ?? defaultSelection(candidate),
      busy: false,
      focusedRule: null,
      // Success is a reason to go look at the result — at the file, which
      // is either the manifest or the one being held against the round.
      // Failure keeps them on the run pane; that is `fail`'s job, and this
      // branch only ever runs on success.
      ...(this.#state.view === "run" ? { view: "files" as WorkbenchView } : {}),
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
    // A refusal is a correct outcome, so no step goes red. The one that
    // was running stops where it stopped, carrying the reason.
    this.#commit({ busy: false, runs: this.#endRun(turnId, this.#clock(), { status: "skipped", reason }) });
  }

  /** Studio broke.
   *
   * The reason lands on the step that was running when it broke, not only
   * in the chat. A failure that is legible only as a paragraph in a
   * transcript is a failure a person has to read the whole transcript to
   * locate; on the step it is a red row with the message under it. */
  fail(turnId: string, reason: string): void {
    this.#patchTurn(turnId, (turn) => ({ ...turn, status: "failed", text: reason }));
    this.#commit({
      busy: false,
      runs: this.#endRun(turnId, this.#clock(), { status: "failed", reason }),
      view: "run",
    });
  }

  /** The person pressed stop.
   *
   * Two-phase on purpose. `requestAbort` marks the intent immediately, so
   * the button can say "stopping…" the instant it is pressed rather than
   * sitting there looking broken while an in-flight request unwinds; the
   * driver sees `abortRequested` (or is handed it by the shell's `onStop`)
   * and actually cancels. `abort` is the second phase: the round is over,
   * no candidate exists, and nothing was written. */
  requestAbort(): string | null {
    const run = this.activeRun();
    if (run === null || run.abortRequested) return null;
    this.#commit({
      runs: this.#state.runs.map((r) => (r.turnId === run.turnId ? { ...r, abortRequested: true } : r)),
    });
    return run.turnId;
  }

  abort(turnId: string, reason = "Stopped."): void {
    const turn = this.#state.turns.find((t) => t.id === turnId);
    if (turn === undefined || turn.status !== "streaming") return;
    const at = this.#clock();
    this.#patchTurn(turnId, (t) => ({
      ...t,
      status: "aborted",
      text: t.text.length === 0 ? reason : `${t.text}\n\n${reason}`,
    }));
    this.#commit({ busy: false, runs: this.#endRun(turnId, at, { status: "aborted", reason }) });
  }

  /** The run for a turn, whether it is still going or long finished. */
  runFor(turnId: string): Run | null {
    return this.#state.runs.find((run) => run.turnId === turnId) ?? null;
  }

  activeRun(): Run | null {
    return this.#state.runs.find((run) => run.endedAt === null) ?? null;
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

  // ── the run: what the builder is doing, step by step ───────────────

  /** Declare the steps this round is about to take.
   *
   * Up front and all at once, because the shape of the work is itself
   * information: seven queued rows tell a person the gate and the
   * typecheck are still coming, where one spinner tells them only that
   * something is happening. Appends, so a driver that discovers more work
   * (one step per emitted file, once the plan knows how many) can declare
   * it as it goes.
   *
   * Ids are the driver's, not the store's — a driver reporting output
   * from an async process needs to name the step it came from without
   * holding a handle the store gave it. Duplicate ids are ignored. */
  plan(turnId: string, specs: readonly StepSpec[]): void {
    if (specs.length === 0) return;
    this.#patchRun(turnId, (run) => {
      const known = new Set(run.steps.map((step) => step.id));
      const added = specs.filter((spec) => !known.has(spec.id)).map(createStep);
      if (added.length === 0) return run;
      return { ...run, steps: [...run.steps, ...added] };
    });
  }

  startStep(stepId: string): void {
    const at = this.#clock();
    this.#patchStep(stepId, (step) => startStep(step, at));
  }

  /** Raw output from the thing the step is doing — `tsc`'s diagnostics,
   * the mount probe's stdout and stderr. Kept after the step ends: the
   * output of the step that failed is the whole reason anyone opens this
   * pane, and discarding it on completion would leave a red row with
   * nothing behind it. */
  output(stepId: string, chunk: string, stream: LogStream = "out"): void {
    this.#patchStep(stepId, (step) => pushOutput(step, chunk, stream));
  }

  endStep(stepId: string, status: StepStatus, outcome: { error?: string | null; exitCode?: number | null } = {}): void {
    const at = this.#clock();
    this.#patchStep(stepId, (step) => endStep(step, status, at, outcome));
  }

  #patchRun(turnId: string, patch: (run: Run) => Run): void {
    const index = this.#state.runs.findIndex((run) => run.turnId === turnId);
    if (index === -1) return;
    const current = this.#state.runs[index];
    if (current === undefined || current.endedAt !== null) return;
    const next = patch(current);
    if (next === current) return;
    const runs = [...this.#state.runs];
    runs[index] = next;
    this.#commit({ runs });
  }

  #patchStep(stepId: string, patch: (step: Step) => Step): void {
    const runIndex = this.#state.runs.findIndex((run) => run.steps.some((step) => step.id === stepId));
    if (runIndex === -1) return;
    const run = this.#state.runs[runIndex];
    if (run === undefined) return;
    const stepIndex = run.steps.findIndex((step) => step.id === stepId);
    const current = run.steps[stepIndex];
    if (current === undefined) return;
    const next = patch(current);
    if (next === current) return;
    const steps = [...run.steps];
    steps[stepIndex] = next;
    const runs = [...this.#state.runs];
    runs[runIndex] = { ...run, steps };
    this.#commit({ runs });
  }

  /** Close a run out. Whatever was still running stops with the reason the
   * round stopped for, and whatever was still queued is marked as never
   * reached rather than left queued forever under a finished run. */
  #endRun(
    turnId: string,
    at: number,
    outcome: { status: StepStatus; reason: string } | null,
  ): readonly Run[] {
    const index = this.#state.runs.findIndex((run) => run.turnId === turnId);
    const run = index === -1 ? undefined : this.#state.runs[index];
    if (run === undefined || run.endedAt !== null) return this.#state.runs;

    const steps = run.steps.map((step) => {
      if (TERMINAL.has(step.status)) return step;
      if (step.status === "running") {
        return outcome === null
          ? endStep(step, "succeeded", at)
          : endStep(step, outcome.status, at, { error: outcome.reason });
      }
      return endStep(step, "skipped", at, {
        error: outcome === null ? "not reached" : `not reached — ${outcome.reason}`,
      });
    });

    const runs = [...this.#state.runs];
    runs[index] = { ...run, steps, endedAt: at };
    return runs;
  }

  // ── editing: the person's half ─────────────────────────────────────

  /** Type into a file.
   *
   * Returns why it could not, or `null` when it went through. A boolean
   * would make the editor invent its own explanation for a refusal the
   * store already has the reason for — and "the file you are looking at
   * is round 2 of 4" and "Studio is writing this file right now" are
   * different sentences with different remedies.
   *
   * Only the latest round is editable. An earlier round is a record of
   * what Studio produced then; editing it would produce a fourth thing
   * that is neither what was generated nor what would ship. */
  editFile(path: string, text: string): string | null {
    const round = this.#state.rounds[this.#state.rounds.length - 1];
    if (round === undefined) return "No round yet.";
    if (this.#state.selectedRoundId !== round.id) {
      return `Round #${round.ordinal} is the current one — earlier rounds are a record, not a working copy.`;
    }

    const existing = this.#state.drafts.get(path);
    if (existing !== undefined && existing.roundId === round.id) {
      const blocked = editability(
        { path, contents: existing.generated, kind: existing.kind },
        pathsBeingWritten(this.activeRun()),
      );
      if (!blocked.editable) return blocked.reason;
      const next = editDraft(existing, text);
      if (next === existing) return null;
      // Typing does not move the overlay, so no epoch bump: a keystroke
      // must not invalidate the diff of every file in the round.
      this.#commit({ drafts: replace(this.#state.drafts, path, next) });
      return null;
    }

    const file = round.candidate.files.find((f) => f.path === path);
    if (file === undefined) return `${path} is not in this round.`;
    const blocked = editability(file, pathsBeingWritten(this.activeRun()));
    if (!blocked.editable) return blocked.reason;
    this.#commit({ drafts: replace(this.#state.drafts, path, editDraft(openDraft(file, round.id), text)) });
    return null;
  }

  /** Commit the buffer. Every other pane reads it from here on. */
  saveFile(path: string): boolean {
    const draft = this.#state.drafts.get(path);
    if (draft === undefined || draft.conflict !== null) return false;
    const next = saveDraft(draft);
    if (next === draft) return false;
    this.#commit({
      drafts: replace(this.#state.drafts, path, next),
      editEpoch: this.#state.editEpoch + 1,
    });
    return true;
  }

  /** Throw away unsaved typing; keep what was saved. */
  revertFile(path: string): void {
    const draft = this.#state.drafts.get(path);
    if (draft === undefined) return;
    const next = revertDraft(draft);
    if (next === draft) return;
    this.#commit({ drafts: replace(this.#state.drafts, path, next) });
  }

  /** Throw the whole draft away — back to exactly what Studio generated.
   * The undo for a round a person started editing and thought better of. */
  restoreGenerated(path: string): void {
    const draft = this.#state.drafts.get(path);
    if (draft === undefined) return;
    const overlayMoved = draft.saved !== null || draft.conflict !== null;
    const drafts = new Map(this.#state.drafts);
    drafts.delete(path);
    this.#commit({
      drafts,
      ...(overlayMoved ? { editEpoch: this.#state.editEpoch + 1 } : {}),
    });
  }

  /** Answer the question a conflict asked. Both answers destroy one of the
   * two texts, which is why neither happens on its own. */
  resolveConflict(path: string, choice: "mine" | "studio"): void {
    const draft = this.#state.drafts.get(path);
    if (draft === undefined || draft.conflict === null) return;
    const next = resolveDraft(draft, choice);
    const drafts = new Map(this.#state.drafts);
    if (next === null) drafts.delete(path);
    else drafts.set(path, next);
    this.#commit({ drafts, editEpoch: this.#state.editEpoch + 1 });
  }

  /** Claim a file, or give it back. See `editing.ts` for what this does
   * and does not promise. */
  setLock(path: string, locked: boolean): void {
    const has = this.#state.locks.has(path);
    if (has === locked) return;
    const locks = new Set(this.#state.locks);
    if (locked) locks.add(path);
    else locks.delete(path);
    this.#commit({ locks });
  }

  toggleLock(path: string): void {
    this.setLock(path, !this.#state.locks.has(path));
  }

  /** Locks from a previous session. The workbench does not own a storage
   * medium — a component that reaches for `localStorage` is a component
   * that cannot be rendered on a server or asserted on in node — so
   * persistence is the driver's, and this is the way back in. */
  restoreLocks(paths: Iterable<string>): void {
    const locks = new Set([...this.#state.locks, ...paths]);
    if (locks.size === this.#state.locks.size) return;
    this.#commit({ locks });
  }

  /** The round's files with saved edits applied — what would actually
   * ship. The panes go through `selectors.ts`; this is here for a driver
   * that has to hand the bytes to something. */
  effectiveFiles(): readonly GeneratedFile[] {
    const round = this.#state.rounds.find((r) => r.id === this.#state.selectedRoundId);
    if (round === undefined) return [];
    return applyDrafts(round.candidate.files, this.#state.drafts, round.id);
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

  /** `#commit` compares by identity, and a spread always allocates — so a
   * patch that sets a layer to the value it already had would notify every
   * subscriber and hand `useSyncExternalStore` a new snapshot for nothing.
   * These are the toggles a person flicks back and forth while reading a
   * preview, so it is the one place that would happen constantly. Compare
   * the fields, and only then allocate. */
  setEnable(patch: Partial<EnableLayers>): void {
    const current = this.#state.enable;
    const next = { ...current, ...patch };
    if (
      next.killSwitch === current.killSwitch &&
      next.ceiling === current.ceiling &&
      next.project === current.project
    ) {
      return;
    }
    this.#commit({ enable: next });
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
