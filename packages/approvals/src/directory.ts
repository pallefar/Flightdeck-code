/**
 * THE IDENTITY PORT — where `kind` comes from when it is not allowed to come
 * from the row that benefits from it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS CLOSES
 * ─────────────────────────────────────────────────────────────────────────
 * An `ApprovalRecord` carries `approvedBy: Actor`, and `Actor.kind` was read as
 * the answer to "is this a human?". Whoever can write an approval row writes
 * that field, so the answer to guardrail 4's only question was supplied by the
 * party the question is about. A service account declaring `kind: "human"` was
 * admitted; so was a human account called `system`.
 *
 * A fact the code can look up must never be taken as an assertion. The subject
 * ID is the one field on the row that REFERS to something outside it, so it is
 * the only field this package believes, and everything else about the actor —
 * kind, display name, whether they still work here — is resolved from it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A PORT, AND WHAT IT IS NOT
 * ─────────────────────────────────────────────────────────────────────────
 * Same shape as `GrantStore`: a read-only interface, passed as a PARAMETER of
 * every decision rather than held as a module singleton, async so a synchronous
 * "cached identity" shortcut is visibly wrong at the type level. A directory is
 * re-read on every decision for the same reason a grant row is — an account
 * disabled this morning must not authorize anything this afternoon.
 *
 * ⛔ IT IS NOT AN AUTHENTICATOR. It answers "what is subject `m.keller`?", not
 * "is the caller `m.keller`?". Nothing in this package can tell whether the
 * process that wrote an approval row was really that person; binding a row to a
 * verified session or a signature is the store's job and the host's, and the
 * residual is stated in the package README rather than papered over here. What
 * this port removes is the strictly larger hole underneath it: that the row did
 * not even have to refer to a real human.
 */

import type { DirectoryEntry } from "./actor";

export interface IdentityDirectory {
  /**
   * The directory's own record of a subject, or `null` when it has none.
   * MUST reflect the directory as it is now: no memoization.
   */
  resolve(subjectId: string): Promise<DirectoryEntry | null>;
}

/**
 * A reference directory held in memory. Not a cache: it IS the directory, and
 * `resolve` walks it afresh, so a test that deactivates an account between two
 * decisions sees the second one refuse.
 *
 * Lookup is case-insensitive on the subject id for the same reason
 * `isSelfApproval` is: an id casing difference is not a second person, and a
 * case-sensitive directory beside a case-insensitive self-check would be two
 * opinions about identity.
 */
export function createMemoryDirectory(entries: readonly DirectoryEntry[] = []): IdentityDirectory & {
  put(entry: DirectoryEntry): void;
  deactivate(subjectId: string): void;
  readonly lookups: { count: number };
} {
  const rows: DirectoryEntry[] = [...entries];
  const lookups = { count: 0 };
  const find = (subjectId: string): DirectoryEntry | null => {
    const wanted = subjectId.trim().toLowerCase();
    for (const row of rows) if (row.id.trim().toLowerCase() === wanted) return row;
    return null;
  };
  return {
    lookups,
    put(entry) {
      const at = rows.findIndex((r) => r.id.trim().toLowerCase() === entry.id.trim().toLowerCase());
      if (at >= 0) rows[at] = entry;
      else rows.push(entry);
    },
    deactivate(subjectId) {
      const existing = find(subjectId);
      if (existing) this.put({ ...existing, active: false });
    },
    async resolve(subjectId) {
      lookups.count += 1;
      return find(subjectId);
    },
  };
}
