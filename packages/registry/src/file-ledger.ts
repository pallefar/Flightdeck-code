/**
 * A registry ledger that survives the process that wrote it.
 *
 * ⭐ WHY THIS MATTERS HERE. The registry is what makes an approved tool
 * reusable by later projects — "approve it once, use it for future
 * projects". `createLedger()` returns an empty value and every operation
 * returns a NEW one, which is the right shape for a pure core and means
 * nothing persisted: every approval, every registration and every
 * enablement vanished when the process ended. An approval system that
 * forgets is a formality.
 *
 * The lock, the atomic write and the corrupt-is-not-empty rule live in
 * `packages/store` — see its header for why each is a property rather than a
 * detail. What lives HERE is the one rule that is about a ledger.
 *
 * ── ⭐ THE APPEND-ONLY CHECK, AND WHAT IS ACTUALLY TRUE ABOUT IT ────────
 *
 * `assertAppendOnly` compares entries by REFERENCE (`next[i] !== prev[i]`).
 * In process that is exactly right: it proves the new history is literally
 * the old array plus more, so no entry can have been swapped for an
 * equal-looking one.
 *
 * ⚠ AND IT WOULD ALSO WORK HERE, which is worth saying because the obvious
 * justification for this function is wrong. The first version of this
 * comment claimed a reference check "would refuse every legitimate append"
 * across a save. It would not: `toLedger` spreads the parsed array, so the
 * entries keep their identity through one `updateLedger` call, and the
 * ledger's own operations preserve the prefix. A mutation swapping this
 * comparison back to `!==` changed no test — which is the evidence, and the
 * reason the claim is corrected rather than quietly left standing.
 *
 * The value comparison earns its place differently: it is the check that
 * does not depend on that identity holding. A loader that normalised
 * entries, a ledger rebuilt from two separate reads, or a caller that
 * reconstructs an entry it believes unchanged would all defeat a reference
 * check while this one still refuses. The durable guarantee should not rest
 * on an aliasing detail of the current code.
 *
 * What must NOT happen is dropping the check on the grounds that references
 * do not survive a reload — that reasoning sounds right, is wrong here, and
 * would leave the file's history rewritable between two runs.
 */
import { updateFile, readTextOrNull } from "../../store/src/atomic-file";

import type { HistoryEntry } from "./audit";
import type { EnablementRow, RegistryEntry } from "./entry";
import type { Ledger, LedgerResult } from "./ledger";

/** What is on disk. Versioned so a future shape change is a migration rather
 * than a silent misread of someone's approvals. */
interface LedgerFile {
  readonly version: 1;
  readonly entries: readonly RegistryEntry[];
  readonly enablements: readonly EnablementRow[];
  readonly history: readonly HistoryEntry[];
}

export class LedgerStoreCorruptError extends Error {
  constructor(
    readonly file: string,
    reason: string,
  ) {
    // ⚠ The REASON, never the content. A ledger holds approver names.
    super(
      `refused: the registry ledger at ${file} could not be read (${reason}) — it is not being treated as empty, because the next write would then erase every approval it holds`,
    );
    this.name = "LedgerStoreCorruptError";
  }
}

export class LedgerRewriteError extends Error {
  constructor(
    readonly file: string,
    readonly at: number,
  ) {
    super(
      at < 0
        ? `refused: the history being saved is SHORTER than the one in ${file} — a ledger may only be appended to`
        : `refused: history entry ${at} differs from the one in ${file} — a ledger may only be appended to`,
    );
    this.name = "LedgerRewriteError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function admitText(raw: string | null, file: string): LedgerFile {
  // ⭐ ABSENT IS NOT CORRUPT. A registry nobody has written to yet is
  // legitimately empty; anything else is refused.
  if (raw === null) return { version: 1, entries: [], enablements: [], history: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LedgerStoreCorruptError(file, "not valid JSON");
  }
  if (!isObject(parsed)) throw new LedgerStoreCorruptError(file, "not an object");
  if (parsed["version"] !== 1) throw new LedgerStoreCorruptError(file, "unknown version");
  const { entries, enablements, history } = parsed as Record<string, unknown>;
  if (!Array.isArray(entries) || !Array.isArray(enablements) || !Array.isArray(history)) {
    throw new LedgerStoreCorruptError(file, "entries, enablements and history must all be arrays");
  }
  for (const entry of history) {
    if (!isObject(entry) || typeof entry["seq"] !== "number" || typeof entry["event"] !== "string") {
      throw new LedgerStoreCorruptError(file, "a history entry is missing seq or event");
    }
  }
  return {
    version: 1,
    entries: entries as readonly RegistryEntry[],
    enablements: enablements as readonly EnablementRow[],
    history: history as readonly HistoryEntry[],
  };
}

function toLedger(file: LedgerFile): Ledger {
  return Object.freeze({
    entries: Object.freeze([...file.entries]),
    enablements: Object.freeze([...file.enablements]),
    history: Object.freeze([...file.history]),
  });
}

/** The ledger as it is on disk. An unwritten registry is an empty one. */
export function loadLedger(file: string): Ledger {
  return toLedger(admitText(readTextOrNull(file), file));
}

/**
 * ⭐ THE DURABLE APPEND-ONLY CHECK — by VALUE, because references do not
 * survive a reload. See this file's header.
 */
function assertExtendsByValue(prev: readonly HistoryEntry[], next: readonly HistoryEntry[], file: string): void {
  if (next.length < prev.length) throw new LedgerRewriteError(file, -1);
  for (let i = 0; i < prev.length; i += 1) {
    if (JSON.stringify(next[i]) !== JSON.stringify(prev[i])) throw new LedgerRewriteError(file, i);
  }
}

/**
 * Read the ledger, apply one operation, write the result — all under the
 * lock, so two processes cannot interleave a read-modify-write.
 *
 * A refusal from `fn` is returned unchanged and NOTHING is written: the
 * ledger's own operations already answer "no" as a value rather than an
 * exception, and persisting on a refusal would write a ledger nobody asked
 * for.
 */
export function updateLedger(file: string, fn: (ledger: Ledger) => LedgerResult): LedgerResult {
  let outcome: LedgerResult | null = null;
  updateFile(file, (current) => {
    const before = admitText(current, file);
    const result = fn(toLedger(before));
    outcome = result;
    if (!result.ok) return null; // decline the write; the caller is told why
    assertExtendsByValue(before.history, result.ledger.history, file);
    const next: LedgerFile = {
      version: 1,
      entries: result.ledger.entries,
      enablements: result.ledger.enablements,
      history: result.ledger.history,
    };
    return `${JSON.stringify(next, null, 2)}\n`;
  });
  /* c8 ignore next — `updateFile` always calls `change`, so this is set. */
  if (outcome === null) throw new Error("updateLedger: the change was never applied");
  return outcome;
}
