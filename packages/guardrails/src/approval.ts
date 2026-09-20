/**
 * APPROVAL BOUND TO CONTENT — "approving v1 must not bless v2".
 *
 * boot.json's guardrails, verbatim:
 *   "Security, access, and connector permissions require explicit human
 *    approval."
 *   "All actions touching guardrails are proposed, never auto-applied, and
 *    audited."
 *
 * An approval that names only a subject ("mini-app wc-clock is approved") is
 * a standing permission, and a standing permission over mutable content is
 * not an approval of anything in particular. The host already treats this as
 * the failure mode worth engineering against: `config.integrity-alarm` in
 * `audit/flightdeck-audit.jsonl` fires on an "unaudited config change" by
 * comparing an expected sha256 to an actual one. Same idea, same primitive.
 *
 * So an `Approval` carries a `contentHash`, and `checkApproval` compares it to
 * the hash of what is being decided RIGHT NOW. Edit the spec and every
 * existing approval stops matching — not because it was revoked, but because
 * it was never an approval of this.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────
 * It does not construct an AUDIT hash. The host's audit chain is
 * `sha256(prevHash + canonicalPyJson(body))`, GENESIS-rooted and append-only
 * (`flightdeck/server/lib/flightdeckAudit.ts`), and its integrity comes from
 * being computed in one place against the real tail of the real file. A second
 * implementation computing chain hashes from a different checkout is how a
 * chain forks. Studio emits an event BODY (`./audit.ts`) and the caller
 * appends it through the capability adapter, which is the only thing that
 * knows `prevHash`.
 *
 * `contentHash` here is a plain digest of a proposal. It is not chained, not
 * appended to anything, and carries no ordering claim.
 */

import { createHash } from "node:crypto";

/**
 * Deterministic JSON: object keys sorted at every depth, so two structurally
 * equal proposals hash equal regardless of key insertion order. Arrays keep
 * their order — order is meaning in an array.
 *
 * Deliberately NOT the host's `canonicalPyJson`: that one exists to reproduce
 * a Python-side byte layout for the engine's chain, and reusing it here would
 * imply a compatibility this hash does not have and does not need.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, val] of entries) out[k] = walk(val);
    return out;
  };
  return JSON.stringify(walk(value));
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export interface Approval {
  /** A NAMED human. "the approver", "system" and "" are not names, and
   * `checkApproval` refuses them — an unnamed approval is an audit trail that
   * cannot be followed back to a person. */
  readonly approver: string;
  /** The sha256 of the exact proposal that was approved. */
  readonly contentHash: string;
  /** ISO timestamp, for the audit body. Not verified here. */
  readonly at: string;
  /** What was approved, so an approval for one gate cannot be replayed at
   * another. */
  readonly scope: "registration" | "model-request" | "workflow-intake" | "generated-artifacts";
  /** Optional free note from the approver. Never scanned, never echoed into a
   * finding — it is the human's words, not data under classification. */
  readonly note?: string;
}

export type ApprovalProblem =
  | "no-approval"
  | "unnamed-approver"
  | "content-hash-mismatch"
  | "wrong-scope";

export interface ApprovalCheck {
  readonly ok: boolean;
  readonly problem?: ApprovalProblem;
  /** The hash the proposal actually has, so a human can re-approve the right
   * thing rather than guess why their approval stopped working. A digest of a
   * proposal is not the proposal. */
  readonly expectedHash: string;
}

const NON_NAMES = new Set([
  "",
  "system",
  "automation",
  "agent",
  "studio",
  "flightdeck",
  "flightdeck-server",
  "the approver",
  "approver",
  "admin",
  "unknown",
  "n/a",
]);

export function isNamedHuman(approver: string | undefined): boolean {
  if (typeof approver !== "string") return false;
  const t = approver.trim().toLowerCase();
  if (NON_NAMES.has(t)) return false;
  return t.length >= 2;
}

export function checkApproval(
  proposal: unknown,
  scope: Approval["scope"],
  approval: Approval | undefined,
): ApprovalCheck {
  const expectedHash = contentHash(proposal);
  if (!approval) return { ok: false, problem: "no-approval", expectedHash };
  if (!isNamedHuman(approval.approver)) return { ok: false, problem: "unnamed-approver", expectedHash };
  if (approval.scope !== scope) return { ok: false, problem: "wrong-scope", expectedHash };
  if (approval.contentHash !== expectedHash) {
    return { ok: false, problem: "content-hash-mismatch", expectedHash };
  }
  return { ok: true, expectedHash };
}
