/**
 * `effectiveGrant()` — THE ONE QUERY, mirroring `effectiveSubAppEnabled`.
 *
 * The host's rule, verbatim from `subapps/installRow.ts`: this is "the ONE
 * helper both `GET /api/apps` and `GET /api/apps/catalog` route through — never
 * a second, divergent eligibility query (the T-28-16-04 rule)". Same discipline
 * here. Anything that wants to know whether a tool may touch a datasource asks
 * this function; there is no second path, and the pieces it is built from
 * (`intersectGrant`, `admitApproval`) each answer a narrower question that is
 * useless on its own — neither returns a permission.
 *
 * FOUR LAYERS, ANDed, fail-closed, default OFF:
 *
 *     the request is well-formed
 *       AND the '*' ceiling row grants THIS datasource
 *       AND this project's row still grants it
 *       AND the tier asked for survives the intersection
 *       AND (tier < 3  OR  a named human approved THIS content hash)
 *
 * ⛔ RE-READ, NEVER CACHE (Ph27 Pitfall 5 / sub-app contract §5 rule 2). Both
 * rows and the approvals are read from the store on every call. This module has
 * no module-level state of any kind — no Map, no WeakMap, no memo, no lazily
 * captured `process.env`. A revocation therefore takes effect on the very next
 * call, which is the only behaviour an operator hitting "revoke" can reasonably
 * expect.
 *
 * ⭐ AND IT READS THE PROJECT ROW EVEN WHEN THE CEILING IS SHUT. The host learned
 * this the expensive way: returning early on a closed ceiling made a project's
 * stored consent invisible, so "the Function never consented" and "this project
 * has consent on record that the ceiling is masking" looked identical on the
 * wire and "every console sentence about it was a guess, and three of them were
 * measurably false". `projectGranted` below is that third state, and it is read
 * independently of the ceiling for exactly that reason. The DECISION is
 * unchanged by it — the AND still governs — the read only adds a description.
 */

import { admitApproval, type ApprovalRecord } from "./approval";
import { auditEvent, type ApprovalAuditBody } from "./audit";
import { isActor, type Actor } from "./actor";
import { datasourceDefect, type DatasourceRef } from "./datasource";
import { intersectGrant, type GrantRow } from "./grant";
import { CEILING_PROJECT_ID, isValidContentHash, isValidProjectId, isValidToolId } from "./identity";
import type { GrantReason } from "./reasons";
import type { GrantStore } from "./store";
import { isDataTier, requiresNamedApproval, type DataTier } from "./tiers";

export interface GrantRequest {
  readonly store: GrantStore;
  readonly toolId: string;
  /** The tool's content AS IT WILL RUN. Changing it invalidates any approval. */
  readonly contentHash: string;
  readonly projectId: string;
  readonly datasource: DatasourceRef;
  /** Computed by `packages/guardrails`. Never computed here — see `tiers.ts`. */
  readonly tier: DataTier;
  /**
   * Who is asking. Required, because an append-only entry that cannot name the
   * actor is not an audit entry. A non-human requester is perfectly normal — an
   * agent asking is the common case; what a non-human may not do is APPROVE.
   */
  readonly requestedBy: Actor;
  /** ISO timestamp for the emitted event. Defaults to now; tests pass a fixture. */
  readonly at?: string | undefined;
}

export interface ApprovalSummary {
  readonly approverId: string;
  readonly approverName: string;
  readonly approvedAt: string;
  readonly tier: DataTier;
}

export interface GrantDecision {
  readonly allowed: boolean;
  /** A CODE. A UI renders it in its own language — never spliced prose. */
  readonly reason: GrantReason;
  /** Whether tier 3/4 put this request under guardrail 4 at all. */
  readonly requiresNamedApproval: boolean;
  /** Does the Function's ceiling name this datasource? */
  readonly ceilingGranted: boolean;
  /**
   * ⭐ THE THIRD STATE. This project's OWN stored row, read independently of the
   * ceiling. `projectGranted && !ceilingGranted` is MASKED — consent on record
   * that a shut ceiling is holding off, and which a later Function-wide grant
   * switches back on without anyone touching this project.
   */
  readonly projectGranted: boolean;
  readonly ceilingMaxTier: DataTier | null;
  readonly projectMaxTier: DataTier | null;
  /** The intersection: a subset of the ceiling's tiers, by construction. */
  readonly effectiveTiers: readonly DataTier[];
  /** Named human and when, for tier 3/4 allowances. `null` otherwise. */
  readonly approval: ApprovalSummary | null;
  /** Emit-only. The caller appends it via `caps.auditAppend()`; we never do. */
  readonly audit: ApprovalAuditBody;
}

function requestDefect(request: GrantRequest): GrantReason | null {
  if (!isValidToolId(request.toolId)) return "invalid_tool_id";
  if (!isValidProjectId(request.projectId)) return "invalid_project_id";
  if (!isValidContentHash(request.contentHash)) return "invalid_content_hash";
  if (datasourceDefect(request.datasource)) return "invalid_datasource";
  if (!isDataTier(request.tier)) return "invalid_tier";
  if (!isActor(request.requestedBy)) return "invalid_requester";
  return null;
}

/** Every return in this function goes through here, so no path can forget the event. */
function decide(
  request: GrantRequest,
  reason: GrantReason,
  state: {
    ceilingGranted: boolean;
    projectGranted: boolean;
    ceilingMaxTier: DataTier | null;
    projectMaxTier: DataTier | null;
    effectiveTiers: readonly DataTier[];
    approval: ApprovalSummary | null;
  },
): GrantDecision {
  const allowed = reason === "allowed";
  const tier: DataTier = isDataTier(request.tier) ? request.tier : 4;
  const actor: Actor = isActor(request.requestedBy)
    ? request.requestedBy
    : { kind: "system", id: "unknown" };
  return {
    allowed,
    reason,
    requiresNamedApproval: requiresNamedApproval(tier),
    ...state,
    audit: auditEvent({
      event: "grant.decision",
      at: request.at ?? new Date().toISOString(),
      actorId: actor.id,
      actorKind: actor.kind,
      toolId: request.toolId,
      contentHash: request.contentHash,
      projectId: request.projectId,
      datasource: request.datasource,
      tier,
      decision: allowed ? "allow" : "refuse",
      reason,
    }),
  };
}

const EMPTY = {
  ceilingGranted: false,
  projectGranted: false,
  ceilingMaxTier: null,
  projectMaxTier: null,
  effectiveTiers: [] as readonly DataTier[],
  approval: null,
} as const;

/**
 * A malformed request is refused BEFORE the store is touched — the host's
 * refuse-before-scan discipline (`setEnabledLocked`). A request we cannot
 * describe is not a request we should be running queries for.
 */
export async function effectiveGrant(request: GrantRequest): Promise<GrantDecision> {
  const defect = requestDefect(request);
  if (defect) return decide(request, defect, { ...EMPTY });

  const { store, toolId, projectId, datasource, tier } = request;

  // Both rows, every call. The project row is read even when the ceiling turns
  // out to be shut — see the header on why that is not a wasted query.
  const ceilingRow: GrantRow | null = await store.readGrantRow(CEILING_PROJECT_ID, toolId);
  const projectRow: GrantRow | null =
    projectId === CEILING_PROJECT_ID ? ceilingRow : await store.readGrantRow(projectId, toolId);

  // The description of what is on record, computed independently of the AND.
  const ceilingGranted = !!ceilingRow && !ceilingRow.revokedAt;
  const projectGranted = !!projectRow && !projectRow.revokedAt;

  const intersection = intersectGrant(ceilingRow, projectRow, datasource);
  if (intersection.outcome !== "granted") {
    const reason: GrantReason =
      intersection.outcome === "no-ceiling-row"
        ? "no_ceiling_row"
        : intersection.outcome === "ceiling-revoked"
          ? "ceiling_revoked"
          : intersection.outcome === "no-ceiling-entry"
            ? "no_ceiling_grant_for_datasource"
            : intersection.outcome === "no-project-row"
              ? "no_project_row"
              : intersection.outcome === "project-revoked"
                ? "project_revoked"
                : "no_project_grant_for_datasource";
    return decide(request, reason, {
      ...EMPTY,
      ceilingGranted,
      projectGranted,
      ceilingMaxTier: "ceilingMaxTier" in intersection ? intersection.ceilingMaxTier : null,
    });
  }

  const { grant, ceilingMaxTier, projectMaxTier } = intersection;
  const state = {
    ceilingGranted,
    projectGranted,
    ceilingMaxTier,
    projectMaxTier,
    effectiveTiers: grant.tiers,
    approval: null as ApprovalSummary | null,
  };

  // The tier layer. Naming WHICH side is short is the difference between an
  // operator raising the Function ceiling and one editing the project row.
  if (!grant.tiers.includes(tier)) {
    return decide(request, tier > ceilingMaxTier ? "tier_above_ceiling" : "tier_above_project", state);
  }

  // Tier 1 and 2: allowed without a signature, and still recorded.
  if (!requiresNamedApproval(tier)) return decide(request, "allowed", state);

  // Tier 3 and 4: guardrail 4. Re-read, never cached.
  const approvals: readonly ApprovalRecord[] = await store.readApprovals(projectId, toolId);
  const verdict = admitApproval(approvals, {
    toolId,
    contentHash: request.contentHash,
    projectId,
    datasource,
    tier,
  });
  if (!verdict.ok) return decide(request, verdict.reason, state);

  return decide(request, "allowed", {
    ...state,
    approval: {
      approverId: verdict.approver.id,
      approverName: verdict.approver.displayName,
      approvedAt: verdict.approval.approvedAt,
      tier: verdict.approval.tier,
    },
  });
}
