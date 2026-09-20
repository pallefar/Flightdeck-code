/**
 * APPEND-ONLY, AND STRUCTURALLY SO.
 *
 * "Every transition is an append-only audit entry." The cheap way to write that
 * sentence is a comment saying nobody should call `splice`. This file makes the
 * rewrite impossible-or-caught by three independent mechanisms, none of which
 * depends on a reviewer noticing:
 *
 * 1. THE ENTRIES ARE FROZEN. `historyEntry()` deep-freezes at birth and
 *    `appendHistory()` freezes the array. ES modules are strict mode, so
 *    `log.push(...)`, `log[0] = x` and `delete log[0]` all THROW rather than
 *    failing silently — which is the difference between a test that can prove
 *    this and a test that merely hopes.
 *
 * 2. THE LOG IS A VALUE, NOT A HANDLE. Every transition returns a NEW ledger
 *    carrying a NEW array; there is no `append` method on a mutable object for
 *    a caller to be handed. A caller that keeps an old ledger keeps an old log,
 *    intact, and can compare.
 *
 * 3. `assertAppendOnly()` CHECKS THE PREFIX BY REFERENCE. Because entries are
 *    frozen and shared, the only way to change entry `i` is to construct a
 *    different object — and a different object fails `===`. Every write in
 *    `ledger.ts` routes through `commit()` below, so a transition that tried to
 *    edit history would throw at the moment it did it, not at review time.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT
 * ─────────────────────────────────────────────────────────────────────────
 * It is NOT a hash chain and must not become one. The host's chain is
 * `sha256(prevHash + canonicalPyJson(body))`, GENESIS-rooted, computed against
 * the real tail of the real file by `appendFlightdeckAudit` — and sub-app
 * contract §5 rule 5 says a sub-app never constructs one. Studio emits bodies
 * (`audit.ts#toFlightdeckAuditBody`) and the caller appends them through the
 * capability adapter, which is the only thing that knows `prevHash`. So the
 * tamper-EVIDENCE lives in the host's file; what lives here is tamper-
 * RESISTANCE within one process, plus the ordering (`seq`) that lets an
 * operator line the two up.
 */

import { historyEntry, type HistoryEntry, type HistoryEntryInput } from "./audit";

/** Thrown when a caller hands `assertAppendOnly` a log that was rewritten. */
export class HistoryRewriteError extends Error {
  /** 0-based position of the first entry that does not match. `-1` when the
   *  defect is a TRUNCATION rather than an edit. */
  readonly at: number;
  constructor(message: string, at: number) {
    super(message);
    this.name = "HistoryRewriteError";
    this.at = at;
  }
}

/** The empty log. Frozen, and shared — there is nothing in it to mutate. */
export const EMPTY_HISTORY: readonly HistoryEntry[] = Object.freeze([]);

/** 1-based, so `seq` reads as "the nth thing that happened", never as an index. */
export function nextSeq(history: readonly HistoryEntry[]): number {
  return history.length + 1;
}

/**
 * Build the next entry and return the next log. Takes the input WITHOUT `seq`
 * and derives it, so a caller cannot hand in an ordinal that disagrees with the
 * position the entry lands at.
 */
export function appendHistory(
  history: readonly HistoryEntry[],
  input: Omit<HistoryEntryInput, "seq">,
): readonly HistoryEntry[] {
  const entry = historyEntry({ ...input, seq: nextSeq(history) });
  return Object.freeze([...history, entry]);
}

/**
 * Does `next` merely EXTEND `prev`?
 *
 * Throws rather than returning false: this is an invariant, not a question a
 * caller is meant to branch on. The three ways to fail are reported apart
 * because they mean different things — a shorter log is a deletion, a differing
 * entry is an edit, and both send an investigator somewhere different.
 */
export function assertAppendOnly(
  prev: readonly HistoryEntry[],
  next: readonly HistoryEntry[],
): void {
  if (next.length < prev.length) {
    throw new HistoryRewriteError(
      `history shrank: ${prev.length} entries became ${next.length}`,
      -1,
    );
  }
  for (let i = 0; i < prev.length; i++) {
    if (next[i] !== prev[i]) {
      throw new HistoryRewriteError(`history entry ${i} was rewritten`, i);
    }
  }
}

/** Non-throwing form, for a caller auditing a ledger it was handed. */
export function isAppendOnly(
  prev: readonly HistoryEntry[],
  next: readonly HistoryEntry[],
): boolean {
  try {
    assertAppendOnly(prev, next);
    return true;
  } catch {
    return false;
  }
}

/**
 * Entries added since `prev` — the set a caller feeds to `caps.auditAppend()`,
 * one body per entry, in order. Verifies the append-only invariant first, so
 * there is no way to ask "what is new" about a log that was tampered with.
 */
export function entriesSince(
  prev: readonly HistoryEntry[],
  next: readonly HistoryEntry[],
): readonly HistoryEntry[] {
  assertAppendOnly(prev, next);
  return Object.freeze(next.slice(prev.length));
}
