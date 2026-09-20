/**
 * `@approvals` — may THIS tool, in THIS project, touch THIS datasource, at up
 * to THIS data tier?
 *
 * One question, one answer, one function: `effectiveGrant()`. Everything else
 * exported here either builds an input to it or renders its output.
 *
 * THE SHAPE, in one paragraph. The host already solved per-PROJECT scoping for
 * sub-apps as a ceiling-and-narrow pair of rows — a `'*'` row that is the
 * maximum any project may have, and a per-project row that may only turn things
 * OFF. This package adds the second dimension, per DATASOURCE, with the same
 * shape: a grant names a datasource EXACTLY (`microsoft-365/SharePoint` is not
 * `microsoft-365`, and neither is `microsoft-365/Outlook`), carries the highest
 * data tier it reaches there, and is narrowed — never widened — by the project.
 * Tier 3 (Confidential) and 4 (Restricted) additionally require a named human's
 * approval bound to the tool's content hash, per `boot.json` guardrail 4.
 *
 * WHAT A CONSUMER (`packages/registry`) NEEDS, and nothing more:
 *
 *   effectiveGrant({ store, toolId, contentHash, projectId, datasource, tier,
 *                    requestedBy })  ->  Promise<GrantDecision>
 *
 * `GrantDecision.reason` is a code, `GrantDecision.audit` is a body to append
 * through the capability adapter, and `GrantDecision.allowed` is computed
 * fresh from the store on every call — never stored, never cached, never
 * passed around as a boolean (Ph27 Pitfall 5).
 */

export { effectiveGrant } from "./decision";
export type { ApprovalSummary, GrantDecision, GrantRequest } from "./decision";

export { GRANT_REASONS, isRefusal } from "./reasons";
export type { GrantReason } from "./reasons";

export {
  DATA_TIERS,
  NAMED_APPROVAL_FROM_TIER,
  TIER_NAMES,
  isDataTier,
  requiresNamedApproval,
  tiersUpTo,
} from "./tiers";
export type { DataTier, TierName } from "./tiers";

export {
  DATASOURCE_KINDS,
  auditDatasource,
  datasourceDefect,
  datasourceKey,
  isValidDatasourceKind,
  sameDatasource,
} from "./datasource";
export type { AuditDatasource, DatasourceGrantEntry, DatasourceKind, DatasourceRef } from "./datasource";

export { grantAllows, intersectGrant, intersectGrantRows } from "./grant";
export type { EffectiveGrant, GrantRow, Intersection } from "./grant";

export { admitApproval, approvalDefect, isRevoked } from "./approval";
export type { ApprovalQuestion, ApprovalRecord, ApprovalVerdict } from "./approval";

export { ACTOR_KINDS, isActor, isActorKind, isSelfApproval, namedHuman } from "./actor";
export type { Actor, ActorKind, NamedHuman } from "./actor";

export { APPROVAL_AUDIT_EVENTS, AUDIT_BODY_FIELDS, auditEvent } from "./audit";
export type { ApprovalAuditBody, ApprovalAuditEvent, AuditEventInput } from "./audit";

export { createMemoryGrantStore } from "./store";
export type { GrantStore, MemoryGrantStore } from "./store";

export {
  CEILING_PROJECT_ID,
  CONTENT_HASH_RE,
  DEFAULT_PROJECT_ID,
  PROJECT_SLUG_RE,
  TOOL_ID_RE,
  isValidContentHash,
  isValidProjectId,
  isValidToolId,
} from "./identity";
