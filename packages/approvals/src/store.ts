/**
 * The store PORT — two reads, no writes, no cache.
 *
 * ⛔ PH27 PITFALL 5, AND IT IS LOAD-BEARING. The host's own research says it
 * plainly: "Never let a route handler read 'is this sub-app enabled' from a
 * stale in-memory flag; check the live registry state on each mount-seam
 * request." The generated sub-app contract repeats it as rule 2 — "Never cache
 * a boolean. Kill switch, install row and granted scopes are re-read on every
 * call. No module-level `process.env` capture."
 *
 * The interface is shaped so obeying that is the only option available:
 *
 *   - it exposes READS ONLY, so there is no write for a cache to be invalidated
 *     against and no place to hang a dirty flag;
 *   - the store is a PARAMETER of every decision, never a module-level
 *     singleton, so nothing in this package outlives a call;
 *   - both reads are async, which makes a synchronous "cached value" shortcut
 *     visibly wrong at the type level rather than merely tempting.
 *
 * A revoked row comes back WITH `revokedAt` set rather than missing. That is the
 * archive-never-delete idiom the rest of the codebase uses, and it is what lets
 * a refusal say `ceiling_revoked` instead of the much less useful
 * `no_ceiling_row`.
 */

import type { ApprovalRecord } from "./approval";
import type { GrantRow } from "./grant";

export interface GrantStore {
  /**
   * One row, by (projectId, toolId) — the same primary key the host's
   * `subapp_installs` uses, with `'*'` for the ceiling. `null` when there is
   * none. MUST reflect the store as it is now: no memoization.
   */
  readGrantRow(projectId: string, toolId: string): Promise<GrantRow | null>;
  /**
   * Every approval on record for (projectId, toolId), revoked ones included —
   * filtering happens in `admitApproval`, which is the one implementation of
   * what "admissible" means.
   */
  readApprovals(projectId: string, toolId: string): Promise<readonly ApprovalRecord[]>;
}

/**
 * A grant-row write based on a version that is no longer current.
 *
 * `status` is 409 so a route that ever exposes grant writes can map it
 * without a lookup table. It carries the KEY and the two revs — never the
 * row's content, which names datasources and tiers.
 */
export class GrantRowConflictError extends Error {
  readonly code = "grant_row_conflict" as const;
  readonly status = 409 as const;
  constructor(
    readonly projectId: string,
    readonly toolId: string,
    /** What the writer read: a rev, or `null` for "there was no row". */
    readonly expectedRev: number | null,
    /** What the store holds now: a rev, or `null` for "there is no row". */
    readonly actualRev: number | null,
  ) {
    const said = (rev: number | null): string => (rev === null ? "absent" : `rev ${rev}`);
    super(
      `refused: grant row (${projectId}, ${toolId}) is ${said(actualRev)}, and this write was based on ${said(expectedRev)} — it changed since it was read; read it again and re-apply the change`,
    );
    this.name = "GrantRowConflictError";
  }
}

/**
 * The rev a writer must pass as `expectedRev`, from what it READ: `null` for
 * no row, and 0 for a row stored before rows carried a version.
 */
export function grantRowRev(row: GrantRow | null): number | null {
  return row === null ? null : (row.rev ?? 0);
}

type VersionedGrantRow = GrantRow & { readonly rev: number };

/**
 * The compare-and-swap BOTH stores apply, so there is one definition of it.
 * Throws unless `current` is still at `expectedRev`; the stored row gets the
 * next rev, whatever `row.rev` the caller wrote.
 */
export function versionedGrantWrite(
  current: GrantRow | null,
  row: GrantRow,
  expectedRev: number | null,
): VersionedGrantRow {
  const actualRev = grantRowRev(current);
  if (actualRev !== expectedRev) {
    throw new GrantRowConflictError(row.projectId, row.toolId, expectedRev, actualRev);
  }
  return { ...row, rev: (actualRev ?? 0) + 1 };
}

/**
 * A revocation. Takes no expected rev — a kill switch must never fail on a
 * version, and narrowing to nothing needs nobody's agreement — but it BUMPS
 * the rev, so a widening someone prepared before it no longer lands.
 */
export function versionedGrantRevoke(current: GrantRow, at: string): VersionedGrantRow {
  return { ...current, revokedAt: at, rev: (current.rev ?? 0) + 1 };
}

/** Mutators a test (or a first registry implementation) drives the store with. */
export interface MemoryGrantStore extends GrantStore {
  /**
   * Write a whole row, if it is still at `expectedRev` — the rev the caller
   * READ (`grantRowRev(await readGrantRow(...))`); `null` = create-only.
   * Otherwise throws `GrantRowConflictError` and stores nothing. Returns the
   * rev the store assigned.
   */
  putGrantRow(row: GrantRow, expectedRev: number | null): number;
  /** Unconditional, and bumps the rev (see `versionedGrantRevoke`). No row = no-op. */
  revokeGrantRow(projectId: string, toolId: string, at: string): void;
  putApproval(record: ApprovalRecord): void;
  revokeApproval(index: number, at: string): void;
  /** How many reads each surface has served. The evidence for "no cached boolean". */
  readonly counts: { grantRows: number; approvals: number };
}

const rowKey = (projectId: string, toolId: string): string => `${projectId}\u0000${toolId}`;

/**
 * A reference store held in memory. Not a cache: it IS the storage, and every
 * read walks it afresh — which is what makes it a faithful stand-in for a
 * SQLite-backed one in tests that mutate between two calls.
 */
export function createMemoryGrantStore(seed?: {
  rows?: readonly GrantRow[];
  approvals?: readonly ApprovalRecord[];
}): MemoryGrantStore {
  const rows = new Map<string, GrantRow>();
  const approvals: ApprovalRecord[] = [...(seed?.approvals ?? [])];
  for (const row of seed?.rows ?? []) rows.set(rowKey(row.projectId, row.toolId), row);
  const counts = { grantRows: 0, approvals: 0 };

  return {
    counts,
    putGrantRow(row, expectedRev) {
      const key = rowKey(row.projectId, row.toolId);
      const stored = versionedGrantWrite(rows.get(key) ?? null, row, expectedRev);
      rows.set(key, stored);
      return stored.rev;
    },
    revokeGrantRow(projectId, toolId, at) {
      const key = rowKey(projectId, toolId);
      const existing = rows.get(key);
      if (existing) rows.set(key, versionedGrantRevoke(existing, at));
    },
    putApproval(record) {
      approvals.push(record);
    },
    revokeApproval(index, at) {
      const existing = approvals[index];
      if (existing) approvals[index] = { ...existing, revokedAt: at };
    },
    async readGrantRow(projectId, toolId) {
      counts.grantRows += 1;
      return rows.get(rowKey(projectId, toolId)) ?? null;
    },
    async readApprovals(projectId, toolId) {
      counts.approvals += 1;
      return approvals.filter((a) => a.projectId === projectId && a.toolId === toolId);
    },
  };
}
