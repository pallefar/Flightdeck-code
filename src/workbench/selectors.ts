/** Derived views of the snapshot.
 *
 * Every cross-pane question lives here rather than in a component, for one
 * reason: the diff pane, the file tree and the gate pane all need the same
 * three derivations (what changed this round, which findings touch which
 * file, what the gate actually ran), and three components each deriving
 * them their own way is three chances to disagree about what "changed"
 * means.
 *
 * ── THE MEMOISATION IS LOad-BEARING, NOT AN OPTIMISATION ────────────
 * `changeSet` diffs every file in the round against every file in the one
 * before. React will call it on every render of every subscriber — and,
 * more to the point, `useSyncExternalStore` compares the value it gets by
 * identity. A selector that returns a fresh array each call makes the
 * hook believe the store changed on every render, which is a render loop,
 * not a slow frame. So results are cached by the pair of round ids that
 * produced them: same rounds in, same object out.
 *
 * The cache is bounded and keyed by identity of the inputs, so a store
 * reset or a new round evicts naturally. Pure and DOM-free. */
import { diffFileSets, type ChangeSet, type FileChange } from "./diff";
import type { FileGateVerdict } from "./download";
import {
  applyDrafts,
  draftState,
  editSummary,
  type Draft,
  type DraftState,
  type EditSummary,
} from "./editing";
import { pathsBeingWritten, runProgress, type Run, type RunProgress } from "./run";
import type { WorkbenchState } from "./store";
import { buildTree, type TreeNode } from "./tree";
import type { Candidate, Finding, GeneratedFile, Round, Severity } from "./types";

export function currentRound(state: WorkbenchState): Round | null {
  if (state.selectedRoundId === null) return null;
  return state.rounds.find((round) => round.id === state.selectedRoundId) ?? null;
}

/** The round before the selected one — the diff's base. `null` on the
 * first round, which the diff pane renders as "first round" rather than as
 * an all-green diff implying something was replaced. */
export function previousRound(state: WorkbenchState): Round | null {
  if (state.selectedRoundId === null) return null;
  const index = state.rounds.findIndex((round) => round.id === state.selectedRoundId);
  if (index <= 0) return null;
  return state.rounds[index - 1] ?? null;
}

/** ⭐ THE AUTHORITATIVE PROJECT STATE, AND THE ONLY ONE ANY PANE READS.
 *
 * The round's candidate with the person's saved edits applied. The tree,
 * the source view, the diff, the preview and the gate's line numbers all
 * come through here, so there is exactly one answer to "what is in this
 * file right now" and a saved edit either moves all five or none of them.
 * A pane that read `round.candidate.files` directly would be showing the
 * generator's text next to another pane showing the person's, and the
 * first symptom would be a diff nobody can reproduce.
 *
 * Cached on the pair (round identity, overlay epoch) because `applyDrafts`
 * allocates and `useSyncExternalStore` compares by identity — see the
 * note at the top of this file. The epoch moves on save, resolve and
 * reconcile, and deliberately NOT on a keystroke. */
const candidateCache = new WeakMap<Round, Map<number, Candidate>>();

export function currentCandidate(state: WorkbenchState): Candidate | null {
  const round = currentRound(state);
  if (round === null) return null;
  if (state.drafts.size === 0) return round.candidate;

  const cached = cacheFor(candidateCache, round);
  const hit = cached.get(state.editEpoch);
  if (hit !== undefined) return hit;

  const files = applyDrafts(round.candidate.files, state.drafts, round.id);
  const value = files === round.candidate.files ? round.candidate : { ...round.candidate, files };
  remember(cached, state.editEpoch, value);
  return value;
}

/** The round's own output, edits and all edits ignored. Two panes want
 * this and no more: the editor, which diffs the buffer against what
 * Studio actually wrote, and the conflict banner. */
export function generatedCandidate(state: WorkbenchState): Candidate | null {
  return currentRound(state)?.candidate ?? null;
}

// ───────────────────────────── memo cache ────────────────────────────────

const MAX_CACHE = 8;

function memo1<K, V>(compute: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>();
  return (key: K): V => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = compute(key);
    cache.set(key, value);
    if (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    return value;
  };
}

/** ⭐ KEYED ON THE ROUND OBJECT, NOT ON ITS ID.
 *
 * Round ids come from the store's injected id source, which in a test is a
 * counter — so two stores both produce a round called `w3`. A cache keyed
 * on the id string would serve one store's diff to the other, and the
 * symptom is a test that passes alone and fails in a suite. A `WeakMap` on
 * the round itself cannot collide, and it evicts when the round does. */
const changeSetCache = new WeakMap<Round, Map<string, ChangeSet>>();

function cacheFor<K extends object, IK, V>(cache: WeakMap<K, Map<IK, V>>, key: K): Map<IK, V> {
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const fresh = new Map<IK, V>();
  cache.set(key, fresh);
  return fresh;
}

function remember<IK, V>(cache: Map<IK, V>, key: IK, value: V): V {
  cache.set(key, value);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return value;
}

/** What this round changed, relative to the one before it. */
export function changeSet(state: WorkbenchState): ChangeSet | null {
  const current = currentRound(state);
  if (current === null) return null;
  const previous = previousRound(state);
  // The epoch is in the key because a saved edit is a change this round
  // made, and a diff that omits it is answering "what did the generator
  // change" to a person asking "what is different".
  const cached = cacheFor(changeSetCache, current);
  const key = `${previous?.id ?? "-"}@${state.editEpoch}`;
  const hit = cached.get(key);
  if (hit !== undefined) return hit;
  return remember(
    cached,
    key,
    diffFileSets(previous?.candidate.files ?? null, currentCandidate(state)?.files ?? current.candidate.files),
  );
}

/** Only the files this round actually touched, in the order the diff pane
 * shows them: added, then modified, then removed. Unchanged files are
 * dropped — "what changed this round" is the question, and a list that
 * includes the twelve files that did not changes answers a different one. */
export function touchedFiles(set: ChangeSet | null): FileChange[] {
  if (set === null) return [];
  const rank: Record<FileChange["kind"], number> = { added: 0, modified: 1, removed: 2, unchanged: 3 };
  return set.changes
    .filter((change) => change.kind !== "unchanged")
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.path.localeCompare(b.path));
}

export function changeByPath(set: ChangeSet | null): ReadonlyMap<string, FileChange> {
  if (set === null) return new Map();
  return new Map(set.changes.map((change) => [change.path, change]));
}

// ───────────────────────────── the tree ──────────────────────────────────

export function treeNodes(state: WorkbenchState): TreeNode[] {
  const candidate = currentCandidate(state);
  if (candidate === null) return [];
  return buildTree(candidate.files, state.collapsedDirs);
}

export function fileAt(state: WorkbenchState, path: string | null) {
  if (path === null) return null;
  return currentCandidate(state)?.files.find((file) => file.path === path) ?? null;
}

// ───────────────────────────── the gate ──────────────────────────────────

const findingsByPathFor = memo1((candidate: Candidate): ReadonlyMap<string, Finding[]> => {
  const out = new Map<string, Finding[]>();
  for (const finding of candidate.findings) {
    const bucket = out.get(finding.file);
    if (bucket === undefined) out.set(finding.file, [finding]);
    else bucket.push(finding);
  }
  for (const bucket of out.values()) {
    bucket.sort((a, b) => (a.severity === b.severity ? a.line - b.line : a.severity === "error" ? -1 : 1));
  }
  return out;
});

export function findingsByPath(candidate: Candidate | null): ReadonlyMap<string, Finding[]> {
  return candidate === null ? new Map() : findingsByPathFor(candidate);
}

export interface GateSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly rulesRun: number;
  /** Rules that ran and raised nothing. The distinction the gate itself
   * insists on: a rule absent from the findings because it PASSED is not
   * the same as a rule that never ran, and a summary that reports only
   * "0 errors" cannot tell you which one you are looking at. */
  readonly rulesClean: number;
  readonly shippable: boolean;
}

const NOTHING_RAN: GateSummary = { errors: 0, warnings: 0, rulesRun: 0, rulesClean: 0, shippable: false };

function summarize(findings: readonly Finding[], rulesRun: readonly string[]): GateSummary {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  const raised = new Set(findings.map((f) => f.rule));
  const rulesClean = rulesRun.filter((rule) => !raised.has(rule)).length;
  return {
    errors,
    warnings,
    rulesRun: rulesRun.length,
    rulesClean,
    shippable: errors === 0,
  };
}

/** Studio's own verdict, on the text it generated this round. */
export function gateSummary(candidate: Candidate | null): GateSummary {
  return candidate === null ? NOTHING_RAN : summarize(candidate.findings, candidate.rulesRun);
}

/** The verdict over the EDITED files — the one "Download candidate" follows
 * (`download.ts`). `null` is a gate that could not run, which is not a pass:
 * `shippable` is false, as the button is disabled. `shippable` is the gate's
 * own `ok`, never re-derived, so the pane and the button cannot disagree. */
export function verdictSummary(verdict: FileGateVerdict | null): GateSummary {
  return verdict === null ? NOTHING_RAN : { ...summarize(verdict.findings, verdict.rulesRun), shippable: verdict.ok };
}

export function filterBySeverity(
  findings: readonly Finding[],
  filter: Severity | "all",
): Finding[] {
  return filter === "all" ? [...findings] : findings.filter((f) => f.severity === filter);
}

/** The turn that produced a round, so the chat can mark it. */
export function roundOfTurn(state: WorkbenchState, turnId: string): Round | null {
  const turn = state.turns.find((t) => t.id === turnId);
  if (turn?.roundId == null) return null;
  return state.rounds.find((round) => round.id === turn.roundId) ?? null;
}

// ───────────────────────────── the run ───────────────────────────────────

/** The run still going, if one is. At most one: the store refuses a second
 * prompt while a round is in flight. */
export function activeRun(state: WorkbenchState): Run | null {
  return state.runs.find((run) => run.endedAt === null) ?? null;
}

/** The run behind the SELECTED round, so looking at round 2 shows round
 * 2's steps and its output rather than the most recent round's. Rounds do
 * not know their run — turns bridge them, which is the same link the chat
 * already uses to put a round chip on the turn that produced it. */
export function runOfRound(state: WorkbenchState, roundId: string | null): Run | null {
  if (roundId === null) return null;
  const turn = state.turns.find((t) => t.roundId === roundId);
  if (turn === undefined) return null;
  return state.runs.find((run) => run.turnId === turn.id) ?? null;
}

/** What the run pane shows: whatever is happening now, else the work
 * behind whatever the other panes are showing. */
export function visibleRun(state: WorkbenchState): Run | null {
  return activeRun(state) ?? runOfRound(state, state.selectedRoundId) ?? state.runs[state.runs.length - 1] ?? null;
}

export function progress(state: WorkbenchState): RunProgress {
  return runProgress(visibleRun(state));
}

/** Paths a running step says it is writing right now — the read-only set. */
export function beingWritten(state: WorkbenchState): ReadonlySet<string> {
  return pathsBeingWritten(activeRun(state));
}

// ───────────────────────────── the person's edits ────────────────────────

export function draftFor(state: WorkbenchState, path: string | null): Draft | null {
  if (path === null) return null;
  return state.drafts.get(path) ?? null;
}

/** Per-path marker for the tree: which files carry something of the
 * person's, and what kind of something. Built once here rather than in the
 * tree component, for the same reason every other cross-pane derivation
 * is here — the editor's dirty dot and the tree's dirty dot have to mean
 * the same thing. */
export function draftStates(state: WorkbenchState): ReadonlyMap<string, DraftState> {
  if (state.drafts.size === 0) return EMPTY_DRAFT_STATES;
  const out = new Map<string, DraftState>();
  for (const [path, draft] of state.drafts) out.set(path, draftState(draft));
  return out;
}

const EMPTY_DRAFT_STATES: ReadonlyMap<string, DraftState> = new Map();

export function edits(state: WorkbenchState): EditSummary {
  return editSummary(state.drafts, state.locks);
}

/** Every file the person is holding against the current round. The shell
 * refuses nothing on their behalf, but an unresolved conflict is the one
 * thing that must not be possible to lose track of. */
export function conflicts(state: WorkbenchState): readonly Draft[] {
  return [...state.drafts.values()].filter((draft) => draft.conflict !== null);
}

/** What Studio generated for a path this round, ignoring any overlay —
 * the editor's baseline. */
export function generatedFileAt(state: WorkbenchState, path: string | null): GeneratedFile | null {
  if (path === null) return null;
  return currentRound(state)?.candidate.files.find((file) => file.path === path) ?? null;
}
