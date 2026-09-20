/** HOST STAND-IN — not emitted. See `src/db.ts` for why this tree exists.
 *
 * The host's `appendFlightdeckAudit` writes a hash-chained line to the
 * workspace's audit log. Contract rule 5 — never construct an audit hash —
 * means a sub-app may only CALL it, so the stand-in only has to record the
 * call. Recording it is also what lets the guard's audited refusal be asserted
 * in a test instead of taken on trust. */
export type AuditInput = Record<string, unknown> & { event: string };

export interface StandInAuditEntry {
  readonly root: string;
  readonly input: AuditInput;
}

const entries: StandInAuditEntry[] = [];

export function appendFlightdeckAudit(root: string, input: AuditInput): { hash: string } {
  entries.push({ root, input });
  return { hash: `standin-${String(entries.length)}` };
}

/** Test seam. Named with the `standIn` prefix so it is greppable, and absent
 * from the host — nothing in the emitted tree may call it, which
 * `__tests__/emit-manifest.test.ts` checks. */
export function standInAuditEntries(): readonly StandInAuditEntry[] {
  return entries;
}

export function standInResetAudit(): void {
  entries.length = 0;
}
