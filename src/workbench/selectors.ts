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
import type { WorkbenchState } from "./store";
import { buildTree, type TreeNode } from "./tree";
import type { Candidate, Finding, Round, Severity } from "./types";

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

export function currentCandidate(state: WorkbenchState): Candidate | null {
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

const changeSetCache = new Map<string, ChangeSet>();

/** What this round changed, relative to the one before it. */
export function changeSet(state: WorkbenchState): ChangeSet | null {
  const current = currentRound(state);
  if (current === null) return null;
  const previous = previousRound(state);
  const key = `${previous?.id ?? "-"}>${current.id}`;
  const hit = changeSetCache.get(key);
  if (hit !== undefined) return hit;
  const computed = diffFileSets(previous?.candidate.files ?? null, current.candidate.files);
  changeSetCache.set(key, computed);
  if (changeSetCache.size > MAX_CACHE) {
    const oldest = changeSetCache.keys().next();
    if (!oldest.done) changeSetCache.delete(oldest.value);
  }
  return computed;
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

export function gateSummary(candidate: Candidate | null): GateSummary {
  if (candidate === null) {
    return { errors: 0, warnings: 0, rulesRun: 0, rulesClean: 0, shippable: false };
  }
  const errors = candidate.findings.filter((f) => f.severity === "error").length;
  const warnings = candidate.findings.length - errors;
  const raised = new Set(candidate.findings.map((f) => f.rule));
  const rulesClean = candidate.rulesRun.filter((rule) => !raised.has(rule)).length;
  return {
    errors,
    warnings,
    rulesRun: candidate.rulesRun.length,
    rulesClean,
    shippable: errors === 0,
  };
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
