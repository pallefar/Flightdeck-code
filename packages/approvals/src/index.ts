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
 *   effectiveGrant({ store, directory, toolId, toolContent, projectId,
 *                    datasource, payload, requestedBy })  ->  Promise<GrantDecision>
 *
 * ⭐ NOTE WHAT IS NOT IN THAT LIST: no `tier` and no `contentHash`. Both used to
 * be caller-supplied, and both were bypasses — a requester declared tier 2 for
 * a payload guardrails classifies as tier 4 and was allowed with no approval,
 * and a requester presented a stale content hash for an edited tool and rode the
 * old signature. A control anchored on a caller's claim about a fact the code
 * can determine itself is not a control. The tier is DERIVED from `payload` by
 * `packages/guardrails`, across every representation of it; the content hash is
 * COMPUTED from `toolContent` by guardrails' single hasher; the approver's kind
 * is RESOLVED through `IdentityDirectory`; and `'*'` is not a project a caller
 * may ask in.
 *
 * `GrantDecision.reason` is a code, `GrantDecision.audit` is a body to append
 * through the capability adapter, and `GrantDecision.allowed` is computed
 * fresh from the store on every call — never stored, never cached, never
 * passed around as a boolean (Ph27 Pitfall 5). The decision object is SEALED:
 * `verifyDecision()` / `decisionIsUsable()` are the only honest ways to read
 * `allowed`, and a spread-and-edit copy fails both.
 */

export { DECISION_TTL_MS, decisionIsUsable, effectiveGrant, verifyDecision } from "./decision";
export type { ApprovalSummary, DecisionUsability, GrantDecision, GrantRequest } from "./decision";

export { createMemoryDirectory } from "./directory";
export type { IdentityDirectory } from "./directory";

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

export {
  ACTOR_KINDS,
  identityDefect,
  isActor,
  isActorKind,
  isDirectoryEntry,
  isSelfApproval,
  namedHumanIdentity,
  sameSubject,
} from "./actor";
export type { Actor, ActorKind, DirectoryEntry, IdentityDefect, NamedHuman } from "./actor";

export { APPROVAL_AUDIT_EVENTS, AUDIT_BODY_FIELDS, auditEvent } from "./audit";
export type { ApprovalAuditBody, ApprovalAuditEvent, AuditEventInput } from "./audit";

export { createFileGrantStore, GrantStoreCorruptError } from "./file-store";
export { FileStoreBusyError, FileStoreConflictError } from "../../store/src/atomic-file";
export { createMemoryGrantStore } from "./store";
export type { GrantStore, MemoryGrantStore } from "./store";

export {
  CEILING_PROJECT_ID,
  CONTENT_HASH_RE,
  DEFAULT_PROJECT_ID,
  PROJECT_SLUG_RE,
  TOOL_ID_RE,
  isRequestableProjectId,
  isValidContentHash,
  isValidProjectId,
  isValidToolId,
  toolContentHash,
} from "./identity";
