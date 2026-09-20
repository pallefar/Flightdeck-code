/**
 * The named-human approval a tier 3 or 4 grant cannot do without.
 *
 * `boot.json` guardrail 4 — "Security, access, and connector permissions require
 * explicit human approval" — is the mandate. The user's tier rule says where it
 * binds: categories 3 (Confidential) and 4 (Restricted). Tier 1 and 2 need no
 * approval; they are still RECORDED, because "we allowed it and nobody had to
 * ask" is a fact an auditor needs as much as a refusal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AN APPROVAL IS BOUND TO A VERSION OF THE TOOL, NOT TO THE TOOL
 * ─────────────────────────────────────────────────────────────────────────
 * The `contentHash` is the point of the record. A human approved code they
 * could read; if the code changes, what they approved no longer exists, and the
 * new code must come back as a NEW REQUEST rather than riding the old approval.
 * That is enforced by equality here and nothing else: this package never
 * computes a hash (sub-app contract §5 rule 5 — "never construct an audit
 * hash"), it only compares the one the caller brings against the one the
 * approver signed.
 *
 * Revocation archives rather than deletes, like every other retire/reinstate in
 * this codebase: `revokedAt` is set, the row stays, and the audit trail keeps
 * naming the human who once approved it.
 */

import { isActor, isSelfApproval, namedHuman, type Actor, type NamedHuman } from "./actor";
import { datasourceKey, type DatasourceRef } from "./datasource";
import { isValidContentHash } from "./identity";
import type { GrantReason } from "./reasons";
import { type DataTier, isDataTier } from "./tiers";

export interface ApprovalRecord {
  readonly toolId: string;
  /** The content of the tool AS APPROVED. Opaque; compared, never parsed. */
  readonly contentHash: string;
  readonly projectId: string;
  readonly datasource: DatasourceRef;
  /** The highest tier this signature reaches. */
  readonly tier: DataTier;
  readonly approvedBy: Actor;
  readonly approvedAt: string;
  readonly revokedAt?: string | null;
  /**
   * Free text the approver typed. Stored, shown, and NEVER copied into an audit
   * event — sub-app contract §5 rule 8: "Audit names fields, never PII values."
   * A note is the one field on this record that can contain a salary or a name,
   * which is exactly why `audit.ts` has no field that could carry it.
   */
  readonly note?: string | undefined;
}

/**
 * Whether a record is a well-formed approval AT ALL, independent of what is
 * being asked. Exported so the WRITE path (whoever records an approval) and the
 * READ path (`admitApproval` below) apply one implementation — the host's
 * "never a second, divergent eligibility query" rule.
 *
 * Returns the structural reason, or `null` when the record is sound.
 */
export function approvalDefect(record: ApprovalRecord): GrantReason | null {
  if (!isValidContentHash(record.contentHash)) return "invalid_content_hash";
  if (!isDataTier(record.tier)) return "invalid_tier";
  if (!isActor(record.approvedBy)) return "approval_actor_missing";
  if (record.approvedBy.kind !== "human") return "approval_actor_not_human";
  if (!namedHuman(record.approvedBy)) return "approval_actor_missing";
  if (isSelfApproval(record.approvedBy, record.toolId)) return "approval_self_approved";
  return null;
}

export function isRevoked(record: ApprovalRecord): boolean {
  return typeof record.revokedAt === "string" && record.revokedAt.length > 0;
}

export interface ApprovalQuestion {
  readonly toolId: string;
  readonly contentHash: string;
  readonly projectId: string;
  readonly datasource: DatasourceRef;
  readonly tier: DataTier;
}

export type ApprovalVerdict =
  | { readonly ok: true; readonly approval: ApprovalRecord; readonly approver: NamedHuman }
  | { readonly ok: false; readonly reason: GrantReason };

/**
 * Order of examination WITHIN one candidate record, fixed so two readers get the
 * same reason for the same record:
 *
 *   1. revoked            — a withdrawn signature is not evidence of anything
 *   2. content hash       — does this approval even describe the tool being run?
 *   3. actor              — is it an approval at all (guardrail 4)?
 *   4. tier               — does it reach as far as is being asked?
 *
 * Hash before actor because "approved a different version" is the more precise
 * statement about THIS request; an actor defect on a record that does not apply
 * would send an operator to fix the wrong thing.
 */
function verdictFor(record: ApprovalRecord, question: ApprovalQuestion): ApprovalVerdict {
  if (isRevoked(record)) return { ok: false, reason: "approval_revoked" };
  if (record.contentHash !== question.contentHash) {
    return { ok: false, reason: "approval_content_hash_mismatch" };
  }
  const defect = approvalDefect(record);
  if (defect) return { ok: false, reason: defect };
  const approver = namedHuman(record.approvedBy);
  if (!approver) return { ok: false, reason: "approval_actor_missing" };
  if (record.tier < question.tier) return { ok: false, reason: "approval_tier_insufficient" };
  return { ok: true, approval: record, approver };
}

/**
 * Which refusal to REPORT when several candidates all fail. Most security-
 * salient first: an attempt at self-approval is a fact an operator must see even
 * if a second, merely-stale record is sitting next to it.
 */
const REPORT_PRIORITY: readonly GrantReason[] = [
  "approval_self_approved",
  "approval_actor_not_human",
  "approval_actor_missing",
  "invalid_content_hash",
  "invalid_tier",
  "approval_content_hash_mismatch",
  "approval_tier_insufficient",
  "approval_revoked",
];

/**
 * Does any approval on record authorize this exact question?
 *
 * Candidacy is EXACT on (tool, project, datasource) — the same
 * `datasourceKey` equality the grant lookup uses, so an approval for
 * `microsoft-365/SharePoint` is not a candidate for `microsoft-365/Outlook` and
 * cannot be reported as a near-miss either.
 *
 * `approvals` is re-read from the store by the caller on every decision; nothing
 * here retains it.
 */
export function admitApproval(
  approvals: readonly ApprovalRecord[],
  question: ApprovalQuestion,
): ApprovalVerdict {
  const wantedKey = datasourceKey(question.datasource);
  const refusals: GrantReason[] = [];
  for (const record of approvals) {
    if (record.toolId !== question.toolId) continue;
    if (record.projectId !== question.projectId) continue;
    if (datasourceKey(record.datasource) !== wantedKey) continue;
    const verdict = verdictFor(record, question);
    if (verdict.ok) return verdict;
    refusals.push(verdict.reason);
  }
  if (refusals.length === 0) return { ok: false, reason: "approval_required" };
  for (const reason of REPORT_PRIORITY) {
    if (refusals.includes(reason)) return { ok: false, reason };
  }
  return { ok: false, reason: "approval_required" };
}
