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
 */
import fs from "node:fs";
import path from "node:path";

import type { ApprovalRecord } from "./approval";
import type { GrantRow } from "./grant";
import type { MemoryGrantStore } from "./store";

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

export class GrantStoreBusyError extends Error {
  constructor(readonly file: string) {
    super(
      `refused: another writer holds the lock on ${file} — no change was made. Retry; if this persists, a previous writer died holding it and the stale lock clears itself after ${Math.round(STALE_LOCK_MS / 1000)}s.`,
    );
    this.name = "GrantStoreBusyError";
  }
}

export class GrantStoreConflictError extends Error {
  constructor(readonly file: string) {
    super(
      `refused: ${file} changed while this write was being prepared, so the write was abandoned rather than overwriting it`,
    );
    this.name = "GrantStoreConflictError";
  }
}

/** How long a lock may be held before it is assumed to belong to a dead
 * process. Generous on purpose: taking over a live writer's lock is worse
 * than making a person wait. */
const STALE_LOCK_MS = 30_000;
const LOCK_ATTEMPTS = 50;

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
  }
  for (const record of approvals) {
    if (!isObject(record) || typeof record["toolId"] !== "string" || typeof record["contentHash"] !== "string") {
      throw new GrantStoreCorruptError(file, "an approval is missing toolId or contentHash");
    }
  }
  return { version: 1, rows: rows as readonly GrantRow[], approvals: approvals as readonly ApprovalRecord[] };
}

function readFile(file: string): GrantFile {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    // ⭐ ABSENT IS NOT CORRUPT. A store that has never been written is
    // legitimately empty; anything else is refused.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, rows: [], approvals: [] };
    throw new GrantStoreCorruptError(file, (error as NodeJS.ErrnoException).code ?? "unreadable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GrantStoreCorruptError(file, "not valid JSON");
  }
  return admitFile(parsed, file);
}

function writeFile(file: string, contents: GrantFile): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.grants-${process.pid}-${Date.now()}.tmp`);
  const bytes = `${JSON.stringify(contents, null, 2)}\n`;
  try {
    // ⚠ 0o600. This records who approved what, and approval notes may carry
    // a name or a salary. Default permissions would make it world-readable
    // on a shared machine.
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing staged */
    }
    throw error;
  }
  // Durability of the rename. A failure here costs durability, never
  // correctness — the same position `apply.ts` takes.
  let dirFd: number | undefined;
  try {
    dirFd = fs.openSync(dir, "r");
    fs.fsyncSync(dirFd);
  } catch {
    /* platform does not permit directory fsync */
  } finally {
    if (dirFd !== undefined) {
      try {
        fs.closeSync(dirFd);
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * ⭐ SERIALISES READ-MODIFY-WRITE ACROSS PROCESSES.
 *
 * The in-memory store never needed this: one process, one object. A FILE
 * store introduces a failure the interface has never had — two processes
 * each read, each modify, each write, and the second silently erases the
 * first. `redteam-attacks.test.ts` already records the row-level version of
 * this as open ("grant rows are last-write-wins, no version / CAS"); making
 * the store durable without a lock would have widened it from "one operator
 * overwrites another's narrowing" to "one process erases another's entire
 * ledger".
 *
 * `open(..., "wx")` is atomic create-exclusive — the lock IS the creation,
 * so there is no window between checking and taking it.
 *
 * ⚠ AND IT IS NOT A TRANSACTION, said plainly. A stale lock is taken over
 * after `STALE_LOCK_MS`, which is the standard bargain and the standard
 * risk: a writer paused longer than that could still be alive. That is why
 * `writeFile` ALSO verifies the file has not changed since it was read — the
 * lock makes conflicts rare and the check makes a missed one loud. Real
 * serialisation wants a database, and this store does not pretend to be one.
 */
function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let fd: number | undefined;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      fd = fs.openSync(lock, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        continue; // it vanished between the failure and the stat — try again
      }
      if (age > STALE_LOCK_MS) {
        try {
          fs.unlinkSync(lock);
        } catch {
          /* someone else cleared it first */
        }
        continue;
      }
      // A short spin. Writes here are rare and brief; a person approving
      // something is not a hot path.
      const until = Date.now() + 10;
      while (Date.now() < until) {
        /* wait */
      }
    }
  }
  if (fd === undefined) throw new GrantStoreBusyError(file);
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      fs.unlinkSync(lock);
    } catch {
      /* already cleared */
    }
  }
}

/** The bytes as they were when this write was planned, or null if absent. */
function currentBytes(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
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
    withLock(file, () => {
      const before = currentBytes(file);
      const next = change(readFile(file));
      // Belt to the lock's braces: if the file moved under us anyway — a
      // writer that ignored the lock, or a stale lock taken over from a
      // process that was still alive — abandon rather than overwrite.
      if (currentBytes(file) !== before) throw new GrantStoreConflictError(file);
      writeFile(file, next);
    });
  };

  return {
    counts,
    putGrantRow(row) {
      mutate((current) => {
        const key = rowKey(row.projectId, row.toolId);
        const rows = current.rows.filter((r) => rowKey(r.projectId, r.toolId) !== key);
        return { ...current, rows: [...rows, row] };
      });
    },
    revokeGrantRow(projectId, toolId, at) {
      mutate((current) => ({
        ...current,
        rows: current.rows.map((r) =>
          rowKey(r.projectId, r.toolId) === rowKey(projectId, toolId) ? { ...r, revokedAt: at } : r,
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
