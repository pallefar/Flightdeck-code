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

/** Mutators a test (or a first registry implementation) drives the store with. */
export interface MemoryGrantStore extends GrantStore {
  putGrantRow(row: GrantRow): void;
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
    putGrantRow(row) {
      rows.set(rowKey(row.projectId, row.toolId), row);
    },
    revokeGrantRow(projectId, toolId, at) {
      const key = rowKey(projectId, toolId);
      const existing = rows.get(key);
      if (existing) rows.set(key, { ...existing, revokedAt: at });
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
