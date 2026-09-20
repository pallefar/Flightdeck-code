/**
 * One JSON file, written safely, shared by the two stores that need it.
 *
 * ⭐ WHY THIS IS ITS OWN PACKAGE. `packages/approvals` needed a durable grant
 * store and `packages/registry` needs a durable ledger. Neither may depend on
 * the other — they answer different questions and the repo keeps them apart
 * deliberately — so without this the lock, the atomic write and the
 * corrupt-is-not-empty rule would exist twice and drift once.
 *
 * This is MECHANISM only. No policy lives here: what counts as a valid file,
 * and what a caller may do with it, belongs to the store that owns it.
 *
 * ── THE THREE PROPERTIES, AND WHY EACH IS NOT AN IMPLEMENTATION DETAIL ──
 *
 * 1. WRITES ARE ATOMIC. Staged to a temp file, fsynced, renamed. A
 *    half-written approvals file or ledger is not a cache that rebuilds; it
 *    is a lost audit trail.
 *
 * 2. READ-MODIFY-WRITE IS SERIALISED ACROSS PROCESSES. `open(..., "wx")` is
 *    atomic create-exclusive, so the lock IS the creation and there is no
 *    window between checking and taking it. A lock older than the stale
 *    window is taken over, because a writer that died holding it must not
 *    brick the store, and the lock is released in a `finally` — a store that
 *    keeps its lock after an error is permanently busy.
 *
 * 3. ⚠ IT IS NOT A TRANSACTION, said plainly. A stale takeover could hit a
 *    writer that is merely slow, so `update` also verifies the bytes have not
 *    changed since it read them: the lock makes conflicts rare and the check
 *    makes a missed one loud. Real serialisation wants a database.
 */
import fs from "node:fs";
import path from "node:path";

/** How long a lock may be held before it is assumed to belong to a dead
 * process. Generous on purpose: taking over a live writer's lock is worse
 * than making a person wait. */
export const STALE_LOCK_MS = 30_000;
const LOCK_ATTEMPTS = 50;

export class FileStoreBusyError extends Error {
  constructor(readonly file: string) {
    super(
      `refused: another writer holds the lock on ${file} — no change was made. Retry; if this persists, a previous writer died holding it and the stale lock clears itself after ${Math.round(STALE_LOCK_MS / 1000)}s.`,
    );
    this.name = "FileStoreBusyError";
  }
}

export class FileStoreConflictError extends Error {
  constructor(readonly file: string) {
    super(
      `refused: ${file} changed while this write was being prepared, so the write was abandoned rather than overwriting it`,
    );
    this.name = "FileStoreConflictError";
  }
}

/** The file's bytes, or null when it has never been written. */
export function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Stage, fsync, rename.
 *
 * ⚠ 0o600. Both callers record who approved what, and an approval note is
 * documented as the one field that can carry a salary or a name. Default
 * permissions would make it world-readable on a shared machine.
 */
export function atomicWriteFile(file: string, contents: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}-${process.pid}-${Date.now()}.tmp`);
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeSync(fd, contents);
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
  // correctness.
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

/** Run `fn` holding an exclusive lock on `file`. */
export function withFileLock<T>(file: string, fn: () => T): T {
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
  if (fd === undefined) throw new FileStoreBusyError(file);
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

/**
 * The whole read-modify-write, under the lock, with the conflict check.
 *
 * `change` receives the file's current bytes (null when absent) and returns
 * the bytes to write, or `null` to write nothing — which is how a caller
 * declines without having to throw.
 */
export function updateFile(file: string, change: (current: string | null) => string | null): void {
  withFileLock(file, () => {
    const before = readTextOrNull(file);
    const next = change(before);
    if (next === null) return;
    if (readTextOrNull(file) !== before) throw new FileStoreConflictError(file);
    atomicWriteFile(file, next);
  });
}
