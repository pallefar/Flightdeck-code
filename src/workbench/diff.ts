/** Line diff, hunk grouping and intra-line highlighting.
 *
 * ── WHY NOT THE LOOK-AHEAD HEURISTIC THE REFERENCE USES ─────────────
 * bolt.diy's `processChanges` walks both files with a three-line
 * look-ahead: if the lines differ, peek up to three ahead on each side for
 * a match, and if none is found call it a modification. It is fast and it
 * is wrong in a way that matters here. Insert four lines — a guard clause
 * plus its import, say — and the look-ahead never finds the match, so the
 * two files "modify" every remaining line and the whole rest of the file
 * lights up. A reviewer is being asked "is this sub-app safe to add to a
 * Fastify host", and a diff that paints 200 unchanged lines as changed
 * makes the four that matter unfindable.
 *
 * So this does a real LCS. Costs are bounded by the two guards below,
 * which is the whole reason a real LCS is affordable:
 *
 *   1. Common prefix and suffix are trimmed first. Generated files change
 *      in the middle; a regenerated `routes/entries.ts` typically shares
 *      ~90% of its head and tail with the previous round, and the LCS runs
 *      on what is left.
 *   2. Whatever survives that is capped by `MAX_MATRIX_CELLS`. Past it the
 *      diff degrades to one replace block and SAYS SO via `truncated`, and
 *      the pane renders that as a stated limit. Silently emitting a wrong
 *      diff for a big file is the thing this is avoiding.
 *
 * Everything here is pure and DOM-free: `diff.test.ts` runs it in node. */
import type { GeneratedFile } from "./types";

export type LineOpKind = "context" | "add" | "remove";

export interface LineOp {
  readonly kind: LineOpKind;
  /** 1-based line number in the BEFORE file, or `null` for an addition. */
  readonly beforeLine: number | null;
  /** 1-based line number in the AFTER file, or `null` for a removal. */
  readonly afterLine: number | null;
  readonly text: string;
}

export interface Hunk {
  readonly beforeStart: number;
  readonly beforeCount: number;
  readonly afterStart: number;
  readonly afterCount: number;
  readonly ops: readonly LineOp[];
}

export interface LineDiff {
  readonly ops: readonly LineOp[];
  readonly added: number;
  readonly removed: number;
  /** True when the file exceeded `MAX_MATRIX_CELLS` and the result is one
   * coarse replace block rather than a real alignment. The pane shows this
   * to the reader rather than passing off an approximation as exact. */
  readonly truncated: boolean;
}

/** ~16M cells of a Uint32Array is 64MB, which is past what a browser tab
 * should spend on a diff nobody can read anyway. Generated sub-app files
 * are hundreds of lines; this trips only on something pathological. */
export const MAX_MATRIX_CELLS = 4_000_000;

/** Lines of unchanged context kept either side of a change. Three is the
 * unified-diff default and the number every reviewer's eye already expects. */
export const CONTEXT_LINES = 3;

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  // A trailing newline is a terminator, not an empty final line. Without
  // this every generated file — they all end in "\n" — reports a phantom
  // last line, and adding a real one at the end shows as a modification.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** How many leading lines the two share. */
function commonPrefix(a: readonly string[], b: readonly string[]): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

/** How many trailing lines the two share, never overlapping the prefix. */
function commonSuffix(a: readonly string[], b: readonly string[], prefix: number): number {
  const limit = Math.min(a.length, b.length) - prefix;
  let i = 0;
  while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

export function diffLines(before: string, after: string): LineDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  const ops: LineOp[] = [];
  let added = 0;
  let removed = 0;

  const prefix = commonPrefix(a, b);
  const suffix = commonSuffix(a, b, prefix);
  for (let i = 0; i < prefix; i += 1) {
    ops.push({ kind: "context", beforeLine: i + 1, afterLine: i + 1, text: a[i] ?? "" });
  }

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  let truncated = false;

  if (aMid.length * bMid.length > MAX_MATRIX_CELLS) {
    truncated = true;
    for (let i = 0; i < aMid.length; i += 1) {
      ops.push({ kind: "remove", beforeLine: prefix + i + 1, afterLine: null, text: aMid[i] ?? "" });
      removed += 1;
    }
    for (let j = 0; j < bMid.length; j += 1) {
      ops.push({ kind: "add", beforeLine: null, afterLine: prefix + j + 1, text: bMid[j] ?? "" });
      added += 1;
    }
  } else {
    for (const op of lcsOps(aMid, bMid, prefix)) {
      ops.push(op);
      if (op.kind === "add") added += 1;
      else if (op.kind === "remove") removed += 1;
    }
  }

  for (let i = 0; i < suffix; i += 1) {
    const beforeLine = a.length - suffix + i + 1;
    const afterLine = b.length - suffix + i + 1;
    ops.push({ kind: "context", beforeLine, afterLine, text: a[beforeLine - 1] ?? "" });
  }

  return { ops, added, removed, truncated };
}

/** Classic LCS table plus a backtrack, over the trimmed middles only.
 *
 * `Uint32Array` rather than nested arrays: one allocation, no pointer
 * chasing, and it is what keeps `MAX_MATRIX_CELLS` a generous bound rather
 * than an optimistic one. `offset` shifts the emitted line numbers back up
 * into the coordinates of the untrimmed files. */
function lcsOps(a: readonly string[], b: readonly string[], offset: number): LineOp[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + (j + 1)] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + (j + 1)] ?? 0);
    }
  }

  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "context", beforeLine: offset + i + 1, afterLine: offset + j + 1, text: a[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + (j + 1)] ?? 0)) {
      ops.push({ kind: "remove", beforeLine: offset + i + 1, afterLine: null, text: a[i] ?? "" });
      i += 1;
    } else {
      ops.push({ kind: "add", beforeLine: null, afterLine: offset + j + 1, text: b[j] ?? "" });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: "remove", beforeLine: offset + i + 1, afterLine: null, text: a[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: "add", beforeLine: null, afterLine: offset + j + 1, text: b[j] ?? "" });
    j += 1;
  }
  return ops;
}

/** Collapse runs of unchanged lines, keeping `context` either side.
 *
 * A generated `routes/entries.ts` is ~200 lines of which a round changes
 * four. Rendering all 200 and expecting a reviewer to find the four is how
 * a gate gets rubber-stamped. */
export function toHunks(diff: LineDiff, context: number = CONTEXT_LINES): Hunk[] {
  const ops = diff.ops;
  const interesting: number[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i]?.kind !== "context") interesting.push(i);
  }
  if (interesting.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of interesting) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    // `+ 1` merges ranges that would otherwise abut with no gap between
    // them — two adjacent hunks separated by nothing read as one change.
    if (last !== undefined && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }

  return ranges.map((range) => {
    const slice = ops.slice(range.start, range.end + 1);
    const beforeLines = slice.map((op) => op.beforeLine).filter((n): n is number => n !== null);
    const afterLines = slice.map((op) => op.afterLine).filter((n): n is number => n !== null);
    return {
      beforeStart: beforeLines[0] ?? 0,
      beforeCount: beforeLines.length,
      afterStart: afterLines[0] ?? 0,
      afterCount: afterLines.length,
      ops: slice,
    };
  });
}

// ─────────────────────── intra-line highlighting ─────────────────────────

export interface Segment {
  readonly text: string;
  readonly changed: boolean;
}

/** Common prefix/suffix on a remove/add PAIR, so a one-word edit shows as
 * one word rather than two entirely red and green lines.
 *
 * Deliberately not a character LCS. On source text a character LCS finds
 * spurious alignments through punctuation — every `)` in the old line
 * matches every `)` in the new one — and paints a speckled line that is
 * harder to read than no highlighting at all. Prefix/suffix is the honest
 * amount of certainty available without tokenising the language. */
export function segmentPair(before: string, after: string): { before: Segment[]; after: Segment[] } {
  let head = 0;
  const headLimit = Math.min(before.length, after.length);
  while (head < headLimit && before[head] === after[head]) head += 1;

  let tail = 0;
  const tailLimit = Math.min(before.length, after.length) - head;
  while (tail < tailLimit && before[before.length - 1 - tail] === after[after.length - 1 - tail]) {
    tail += 1;
  }

  const build = (text: string): Segment[] => {
    const middle = text.slice(head, text.length - tail);
    const segments: Segment[] = [];
    if (head > 0) segments.push({ text: text.slice(0, head), changed: false });
    if (middle.length > 0) segments.push({ text: middle, changed: true });
    if (tail > 0) segments.push({ text: text.slice(text.length - tail), changed: false });
    return segments.length > 0 ? segments : [{ text: "", changed: false }];
  };

  return { before: build(before), after: build(after) };
}

/** Pair up a remove immediately followed by an add, which is what a
 * modified line looks like after the LCS. Returns `null` for anything
 * else, so a pure insertion is never mis-highlighted as an edit. */
export function pairedEdit(ops: readonly LineOp[], index: number): { removed: LineOp; added: LineOp } | null {
  const removed = ops[index];
  const added = ops[index + 1];
  if (removed?.kind !== "remove" || added?.kind !== "add") return null;
  const previous = ops[index - 1];
  if (previous?.kind === "remove") return null; // part of a multi-line block
  const following = ops[index + 2];
  if (following?.kind === "add") return null;
  return { removed, added };
}

// ────────────────────────── file-set changes ─────────────────────────────

export type FileChangeKind = "added" | "removed" | "modified" | "unchanged";

export interface FileChange {
  readonly path: string;
  readonly kind: FileChangeKind;
  readonly before: GeneratedFile | null;
  readonly after: GeneratedFile | null;
  readonly added: number;
  readonly removed: number;
}

export interface ChangeSet {
  readonly changes: readonly FileChange[];
  readonly added: number;
  readonly removed: number;
  /** `true` when there is no previous round: every file is new, and the
   * pane says "first round" rather than showing an all-green diff that
   * implies something was replaced. */
  readonly isFirstRound: boolean;
}

/** What this round changed. Line counts are computed eagerly because the
 * file tree puts `+12 −3` beside every path and computing them lazily
 * means computing them once per render. */
export function diffFileSets(
  before: readonly GeneratedFile[] | null,
  after: readonly GeneratedFile[],
): ChangeSet {
  const beforeByPath = new Map((before ?? []).map((file) => [file.path, file]));
  const afterByPath = new Map(after.map((file) => [file.path, file]));
  const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );

  const changes: FileChange[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const path of paths) {
    const prior = beforeByPath.get(path) ?? null;
    const next = afterByPath.get(path) ?? null;
    if (prior === null && next !== null) {
      const lines = splitLines(next.contents).length;
      changes.push({ path, kind: "added", before: null, after: next, added: lines, removed: 0 });
      totalAdded += lines;
      continue;
    }
    if (prior !== null && next === null) {
      const lines = splitLines(prior.contents).length;
      changes.push({ path, kind: "removed", before: prior, after: null, added: 0, removed: lines });
      totalRemoved += lines;
      continue;
    }
    if (prior === null || next === null) continue;
    if (prior.contents === next.contents) {
      changes.push({ path, kind: "unchanged", before: prior, after: next, added: 0, removed: 0 });
      continue;
    }
    const line = diffLines(prior.contents, next.contents);
    changes.push({
      path,
      kind: "modified",
      before: prior,
      after: next,
      added: line.added,
      removed: line.removed,
    });
    totalAdded += line.added;
    totalRemoved += line.removed;
  }

  return { changes, added: totalAdded, removed: totalRemoved, isFirstRound: before === null };
}
