/**
 * A `GrantStore` that survives a restart.
 *
 * ⭐ WHY THIS WAS MISSING AND WHAT IT COST. `createMemoryGrantStore` calls
 * itself "a reference store held in memory … a faithful stand-in for a
 * SQLite-backed one", and its mutators are documented as what "a test (or a
 * first registry implementation)" drives it with. Nothing was that first
 * implementation. So the approval system was complete, correct, tested — and
 * every grant a person made vanished when the process ended, which in an
 * approval system means the record of WHO ALLOWED WHAT is the one thing that
 * did not persist.
 *
 * ── THREE PROPERTIES, AND WHY EACH IS NOT AN IMPLEMENTATION DETAIL ──────
 *
 * 1. EVERY READ GOES TO DISK. `GrantStore.readGrantRow` says "MUST reflect
 *    the store as it is now: no memoization", and that is a security
 *    property, not a performance note: a cached row is a revocation that has
 *    not happened yet. This re-reads the file on every call. For a Studio one
 *    person operates that cost is nothing, and the alternative is a decision
 *    made from a stale allow.
 *
 * 2. WRITES ARE ATOMIC. Staged to a temp file, fsynced, renamed — the same
 *    shape `codegen/src/apply.ts` uses. A half-written approvals file is not
 *    a corrupt cache that rebuilds; it is a lost audit trail.
 *
 * 3. ⭐ A FILE IT CANNOT PARSE IS AN ERROR, NEVER AN EMPTY STORE. This is
 *    the one that matters most and it is not obvious, because reading a
 *    corrupt file as empty LOOKS fail-safe: no rows means no grants means
 *    everything is refused. But the next write then persists that emptiness,
 *    and the record of every approval anyone ever made is gone — destroyed
 *    by the control that was protecting it. So a parse failure throws and
 *    the operator is told which file to look at.
 *
 * REVOCATION ARCHIVES, NEVER DELETES — `revokedAt` is set and the row stays,
 * matching `createMemoryGrantStore` exactly. A deleted row cannot answer
 * "was this ever allowed, and by whom".
 *
 * ROWS ARE VERSIONED, and the lock is not what does it. The lock serialises
 * two writes; a serialised overwrite is still an overwrite. Each row carries a
 * store-assigned `rev`, and `putGrantRow(row, expectedRev)` is refused with
 * `GrantRowConflictError` (409) when the row moved since the writer read it —
 * the same compare-and-swap `createMemoryGrantStore` applies, from the same
 * function (`versionedGrantWrite` in `store.ts`).
 */
import fs from "node:fs";

import { FileStoreBusyError, FileStoreConflictError, updateFile } from "../../store/src/atomic-file";

// Re-exported so a caller catching "the store was busy" does not have to know
// which package implements the lock.
export { FileStoreBusyError, FileStoreConflictError };

import type { ApprovalRecord } from "./approval";
import type { GrantRow } from "./grant";
import { versionedGrantRevoke, versionedGrantWrite, type MemoryGrantStore } from "./store";

/** What is on disk. Versioned so a future shape change is a migration rather
 * than a silent misread of someone's approvals. */
interface GrantFile {
  readonly version: 1;
  readonly rows: readonly GrantRow[];
  readonly approvals: readonly ApprovalRecord[];
}

export class GrantStoreCorruptError extends Error {
  constructor(
    readonly file: string,
    reason: string,
  ) {
    // ⚠ The REASON, never the content. This file holds approval notes, which
    // `approval.ts` documents as "the one field on this record that can
    // contain a salary or a name".
    super(`refused: the grant store at ${file} could not be read (${reason}) — it is not being treated as empty, because the next write would then erase every approval it holds`);
    this.name = "GrantStoreCorruptError";
  }
}

const rowKey = (projectId: string, toolId: string): string => `${projectId}\u0000${toolId}`;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Shape admission at LOAD time — structural only.
 *
 * Deliberately not semantic: whether an approval is *admissible* is
 * `admitApproval`'s single definition, and a second opinion here would be a
 * second definition. This checks only that what came back off disk is the
 * kind of thing that function can be handed.
 */
function admitFile(parsed: unknown, file: string): GrantFile {
  if (!isObject(parsed)) throw new GrantStoreCorruptError(file, "not an object");
  if (parsed["version"] !== 1) throw new GrantStoreCorruptError(file, "unknown version");
  const rows = parsed["rows"];
  const approvals = parsed["approvals"];
  if (!Array.isArray(rows) || !Array.isArray(approvals)) {
    throw new GrantStoreCorruptError(file, "rows and approvals must both be arrays");
  }
  for (const row of rows) {
    if (!isObject(row) || typeof row["projectId"] !== "string" || typeof row["toolId"] !== "string") {
      throw new GrantStoreCorruptError(file, "a grant row is missing projectId or toolId");
    }
    if (!Array.isArray(row["datasources"])) {
      throw new GrantStoreCorruptError(file, "a grant row is missing its datasources");
    }
    // ⚠ ABSENT IS FINE (a row written before rows carried a version counts as
    // rev 0, so the file stays version 1); PRESENT AND WRONG IS NOT. Reading
    // `"rev": "2"` or `-1` as 0 would let a write based on a stale read land.
    const rev = row["rev"];
    if (rev !== undefined && !(typeof rev === "number" && Number.isInteger(rev) && rev >= 0)) {
      throw new GrantStoreCorruptError(file, "a grant row has a rev that is not a non-negative integer");
    }
  }
  for (const record of approvals) {
    if (!isObject(record) || typeof record["toolId"] !== "string" || typeof record["contentHash"] !== "string") {
      throw new GrantStoreCorruptError(file, "an approval is missing toolId or contentHash");
    }
  }
  return { version: 1, rows: rows as readonly GrantRow[], approvals: approvals as readonly ApprovalRecord[] };
}

/**
 * Bytes → a grant file, or a refusal.
 *
 * ⭐ ABSENT IS NOT CORRUPT. A store that has never been written is
 * legitimately empty; anything else is refused, for the reason in this
 * file's header — reading a corrupt file as empty looks fail-safe and
 * destroys the record on the next write.
 */
function admitText(raw: string | null, file: string): GrantFile {
  if (raw === null) return { version: 1, rows: [], approvals: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GrantStoreCorruptError(file, "not valid JSON");
  }
  return admitFile(parsed, file);
}

function readFile(file: string): GrantFile {
  let raw: string | null;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, rows: [], approvals: [] };
    throw new GrantStoreCorruptError(file, (error as NodeJS.ErrnoException).code ?? "unreadable");
  }
  return admitText(raw, file);
}

/**
 * A grant store backed by one JSON file.
 *
 * Satisfies `MemoryGrantStore` so it is a drop-in wherever the reference
 * store is used today — including its `counts`, which exist as "the evidence
 * for no cached boolean" and stay meaningful here for the same reason.
 */
export function createFileGrantStore(file: string): MemoryGrantStore {
  const counts = { grantRows: 0, approvals: 0 };
  const mutate = (change: (current: GrantFile) => GrantFile): void => {
    // The lock, the conflict check and the atomic write all live in
    // `packages/store` — see its header. What stays here is the only part
    // that is about GRANTS: what a valid file contains.
    updateFile(file, (current) => `${JSON.stringify(change(admitText(current, file)), null, 2)}\n`);
  };

  return {
    counts,
    putGrantRow(row, expectedRev) {
      let assigned = 0;
      mutate((current) => {
        // ⭐ THE VERSION CHECK RUNS HERE, INSIDE THE LOCK, against the rows
        // just read from disk — so "is it still at the rev I read" and "write
        // it" are one step. A conflict throws out of `updateFile`, which
        // writes nothing and releases the lock.
        const key = rowKey(row.projectId, row.toolId);
        const existing = current.rows.find((r) => rowKey(r.projectId, r.toolId) === key) ?? null;
        const stored = versionedGrantWrite(existing, row, expectedRev);
        assigned = stored.rev;
        const rows = current.rows.filter((r) => rowKey(r.projectId, r.toolId) !== key);
        return { ...current, rows: [...rows, stored] };
      });
      return assigned;
    },
    revokeGrantRow(projectId, toolId, at) {
      mutate((current) => ({
        ...current,
        rows: current.rows.map((r) =>
          rowKey(r.projectId, r.toolId) === rowKey(projectId, toolId) ? versionedGrantRevoke(r, at) : r,
        ),
      }));
    },
    putApproval(record) {
      mutate((current) => ({ ...current, approvals: [...current.approvals, record] }));
    },
    revokeApproval(index, at) {
      mutate((current) => ({
        ...current,
        approvals: current.approvals.map((a, i) => (i === index ? { ...a, revokedAt: at } : a)),
      }));
    },
    async readGrantRow(projectId, toolId) {
      counts.grantRows += 1;
      // Re-read. See property 1 in the header: a cached row is a revocation
      // that has not happened yet.
      return readFile(file).rows.find((r) => rowKey(r.projectId, r.toolId) === rowKey(projectId, toolId)) ?? null;
    },
    async readApprovals(projectId, toolId) {
      counts.approvals += 1;
      return readFile(file).approvals.filter((a) => a.projectId === projectId && a.toolId === toolId);
    },
  };
}
