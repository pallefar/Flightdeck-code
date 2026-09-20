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
 *
 * ⭐ AND THE HASH IT IS COMPARED AGAINST IS NOW COMPUTED, NOT SUPPLIED. The
 * caller hands `effectiveGrant()` the tool CONTENT; `identity.ts` hashes it
 * with guardrails' single `contentHash()` implementation and `question.
 * contentHash` is that digest. "Edit the tool and present the old hash anyway"
 * is not an attack this code has to detect, because there is no longer a field
 * to present it in. The record's own `contentHash` stays a stored string — it
 * is what a human signed, and comparing it is the whole check.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AND THE APPROVER IS RESOLVED, NOT DECLARED
 * ─────────────────────────────────────────────────────────────────────────
 * `record.approvedBy.kind` is NOT READ. See `actor.ts`: the row used to declare
 * its own eligibility, so a service account with `kind:"human"` signed tier-4
 * releases. Only the subject ID is believed, and everything else about the
 * approver comes back from `IdentityDirectory`.
 *
 * Revocation archives rather than deletes, like every other retire/reinstate in
 * this codebase: `revokedAt` is set, the row stays, and the audit trail keeps
 * naming the human who once approved it.
 */

import {
  identityDefect,
  isActor,
  isSelfApproval,
  namedHumanIdentity,
  sameSubject,
  type Actor,
  type DirectoryEntry,
  type NamedHuman,
} from "./actor";
import { datasourceKey, type DatasourceRef } from "./datasource";
import type { IdentityDirectory } from "./directory";
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
  /**
   * WHO SIGNED — by subject id. `kind` and `displayName` on this actor are
   * descriptive; no decision reads them. See `actor.ts`.
   */
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
 * being asked AND independent of the directory. Structure only — "is there a
 * subject id, a tier and a hash on this row" — because the identity question
 * needs an await and this one does not.
 *
 * Returns the structural reason, or `null` when the record is sound.
 */
export function approvalDefect(record: ApprovalRecord): GrantReason | null {
  if (!isValidContentHash(record.contentHash)) return "invalid_content_hash";
  if (!isDataTier(record.tier)) return "invalid_tier";
  if (!isActor(record.approvedBy)) return "approval_actor_missing";
  if (isSelfApproval(record.approvedBy.id, record.toolId)) return "approval_self_approved";
  return null;
}

export function isRevoked(record: ApprovalRecord): boolean {
  return typeof record.revokedAt === "string" && record.revokedAt.length > 0;
}

export interface ApprovalQuestion {
  readonly toolId: string;
  /** COMPUTED from the tool content by the caller of `admitApproval`. */
  readonly contentHash: string;
  readonly projectId: string;
  readonly datasource: DatasourceRef;
  readonly tier: DataTier;
  /** The subject that is ASKING, for the four-eyes rule. */
  readonly requestedById: string;
}

export type ApprovalVerdict =
  | { readonly ok: true; readonly approval: ApprovalRecord; readonly approver: NamedHuman }
  | { readonly ok: false; readonly reason: GrantReason };

const IDENTITY_REASON: Record<string, GrantReason> = {
  unknown: "approval_identity_unknown",
  "not-human": "approval_actor_not_human",
  inactive: "approval_identity_inactive",
  unnamed: "approval_actor_missing",
};

/**
 * Order of examination WITHIN one candidate record, fixed so two readers get the
 * same reason for the same record:
 *
 *   1. revoked            — a withdrawn signature is not evidence of anything
 *   2. content hash       — does this approval even describe the tool being run?
 *   3. structure          — is the row an approval at all?
 *   4. identity           — is the signer a named, active human (directory)?
 *   5. four eyes          — is the signer someone other than the requester?
 *   6. tier               — does it reach as far as is being asked?
 *
 * Hash before actor because "approved a different version" is the more precise
 * statement about THIS request; an actor defect on a record that does not apply
 * would send an operator to fix the wrong thing.
 */
async function verdictFor(
  record: ApprovalRecord,
  question: ApprovalQuestion,
  directory: IdentityDirectory,
): Promise<ApprovalVerdict> {
  if (isRevoked(record)) return { ok: false, reason: "approval_revoked" };
  if (record.contentHash !== question.contentHash) {
    return { ok: false, reason: "approval_content_hash_mismatch" };
  }
  const defect = approvalDefect(record);
  if (defect) return { ok: false, reason: defect };

  const entry: DirectoryEntry | null = await directory.resolve(record.approvedBy.id);
  const identity = identityDefect(entry);
  if (identity) return { ok: false, reason: IDENTITY_REASON[identity] ?? "approval_actor_missing" };
  const approver = namedHumanIdentity(entry);
  if (!approver) return { ok: false, reason: "approval_actor_missing" };

  // Four eyes, against the RESOLVED approver id, so an alias on the row cannot
  // separate a requester from itself.
  if (sameSubject(approver.id, question.requestedById)) {
    return { ok: false, reason: "approval_requester_is_approver" };
  }
  if (isSelfApproval(approver.id, question.toolId)) {
    return { ok: false, reason: "approval_self_approved" };
  }

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
  "approval_requester_is_approver",
  "approval_actor_not_human",
  "approval_identity_unknown",
  "approval_identity_inactive",
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
 * Candidacy is EXACT on (tool, project, datasource) — the same `datasourceKey`
 * equality the grant lookup uses, so an approval for `microsoft-365/SharePoint`
 * is not a candidate for `microsoft-365/Outlook` and cannot be reported as a
 * near-miss either.
 *
 * ⭐ WHICH ADMISSIBLE RECORD IS RETURNED IS NOT ARRAY ORDER ANY MORE. It used to
 * be "the first admissible one", so `[narrow, wide]` named one approver and
 * `[wide, narrow]` named another for the identical question — the answer was
 * decided by the order the store happened to hand rows back in, which is not a
 * property any store promises. The selection is now a total order over the
 * admissible set:
 *
 *   1. the LOWEST tier that still reaches the question — the narrowest
 *      signature that actually covers what is being asked;
 *   2. then the most recent `approvedAt` — the freshest decision of that width;
 *   3. then the approver id, lexicographically — a tiebreak that is arbitrary
 *      but TOTAL, so there is no input for which two readers disagree.
 *
 * ⚠ STATED RESIDUAL: this makes the CHOICE deterministic; it does not make a
 * later narrow approval override an earlier wide one. A tier-4 signature still
 * answers a tier-4 question with a tier-3 signature sitting beside it, because
 * both are true statements and neither retracts the other. Narrowing an
 * approval means REVOKING the wide one. That is a store-side supersession rule
 * this package cannot invent for itself, and it is recorded in the README.
 *
 * `approvals` is re-read from the store by the caller on every decision; nothing
 * here retains it.
 */
export async function admitApproval(
  approvals: readonly ApprovalRecord[],
  question: ApprovalQuestion,
  directory: IdentityDirectory,
): Promise<ApprovalVerdict> {
  const wantedKey = datasourceKey(question.datasource);
  const refusals: GrantReason[] = [];
  const admitted: Array<{ approval: ApprovalRecord; approver: NamedHuman }> = [];

  for (const record of approvals) {
    if (record.toolId !== question.toolId) continue;
    if (record.projectId !== question.projectId) continue;
    if (datasourceKey(record.datasource) !== wantedKey) continue;
    const verdict = await verdictFor(record, question, directory);
    if (verdict.ok) admitted.push({ approval: verdict.approval, approver: verdict.approver });
    else refusals.push(verdict.reason);
  }

  if (admitted.length > 0) {
    admitted.sort(
      (a, b) =>
        a.approval.tier - b.approval.tier ||
        b.approval.approvedAt.localeCompare(a.approval.approvedAt) ||
        a.approver.id.localeCompare(b.approver.id),
    );
    const winner = admitted[0] as { approval: ApprovalRecord; approver: NamedHuman };
    return { ok: true, approval: winner.approval, approver: winner.approver };
  }

  if (refusals.length === 0) return { ok: false, reason: "approval_required" };
  for (const reason of REPORT_PRIORITY) {
    if (refusals.includes(reason)) return { ok: false, reason };
  }
  return { ok: false, reason: "approval_required" };
}
