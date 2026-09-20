/**
 * The audit EVENT BODY — and nothing else.
 *
 * Two rules from the sub-app contract shape this whole file:
 *
 *   §5 rule 5  "Never construct an audit hash. Only `appendFlightdeckAudit()` /
 *               `caps.auditAppend()`."
 *   §5 rule 8  "Audit names fields, never PII values. No address, DOB or salary
 *               value in an event."
 *
 * So this package EMITS a body and the caller appends it through the capability
 * adapter. There is no `append` here, no chain, no `prev_hash`, no clock of our
 * own, and — deliberately — no dependency that could hash anything. A second
 * audit-chain implementation is Pitfall 4 in the host's own research
 * ("divergent audit-chain implementation"), and the way not to write one is not
 * to have the ingredients.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY RULE 8 IS STRUCTURAL HERE AND NOT A REVIEW HABIT
 * ─────────────────────────────────────────────────────────────────────────
 * `ApprovalAuditBody` is a CLOSED record of identifiers: ids, an actor, a kind,
 * a tier number, a reason code, a timestamp. There is no `message`, no `note`,
 * no `detail`, no `metadata`, no index signature — no field a value could
 * arrive in. `ApprovalRecord.note` is the one place in this package a human can
 * type a salary figure, and there is no field here for it to be copied into.
 * `AUDIT_BODY_FIELDS` freezes the key set so a test can assert the shape rather
 * than trusting that nobody widened it.
 *
 * The datasource appears as `{kind, id, scope}` — the NAME of the thing touched,
 * which is exactly what rule 8 asks for: name the field, never the value.
 */

import { auditDatasource, type AuditDatasource, type DatasourceRef } from "./datasource";
import type { ActorKind } from "./actor";
import type { GrantReason } from "./reasons";
import type { DataTier } from "./tiers";

export const APPROVAL_AUDIT_EVENTS = [
  /** Every `effectiveGrant()` call — allowed and refused alike. */
  "grant.decision",
  "grant.recorded",
  "grant.revoked",
  "approval.recorded",
  "approval.revoked",
] as const;

export type ApprovalAuditEvent = (typeof APPROVAL_AUDIT_EVENTS)[number];

export interface ApprovalAuditBody {
  readonly event: ApprovalAuditEvent;
  /** ISO timestamp, supplied by the caller. This package owns no clock. */
  readonly at: string;
  /** Subject id of whoever acted. An id, never a data value. */
  readonly actor: string;
  readonly actorKind: ActorKind;
  readonly toolId: string;
  /** Opaque, caller-supplied. Never computed here. */
  readonly contentHash: string;
  readonly projectId: string;
  readonly datasource: AuditDatasource;
  readonly tier: DataTier;
  readonly decision: "allow" | "refuse";
  readonly reason: GrantReason;
}

/**
 * The exact key set of every body this module emits. Exported so the test suite
 * asserts it instead of hoping, and so a reviewer adding a field has to add it
 * here too — where the rule-8 comment is.
 */
export const AUDIT_BODY_FIELDS = Object.freeze([
  "event",
  "at",
  "actor",
  "actorKind",
  "toolId",
  "contentHash",
  "projectId",
  "datasource",
  "tier",
  "decision",
  "reason",
]) as readonly (keyof ApprovalAuditBody)[];

export interface AuditEventInput {
  readonly event: ApprovalAuditEvent;
  readonly at: string;
  readonly actorId: string;
  readonly actorKind: ActorKind;
  readonly toolId: string;
  readonly contentHash: string;
  readonly projectId: string;
  readonly datasource: DatasourceRef;
  readonly tier: DataTier;
  readonly decision: "allow" | "refuse";
  readonly reason: GrantReason;
}

/**
 * The one constructor. Field-by-field and exhaustive on purpose: no spread of a
 * caller's object, because a spread is how an unexpected key — and the value in
 * it — gets into an append-only log that nobody can edit afterwards.
 */
export function auditEvent(input: AuditEventInput): ApprovalAuditBody {
  return {
    event: input.event,
    at: input.at,
    actor: input.actorId,
    actorKind: input.actorKind,
    toolId: input.toolId,
    contentHash: input.contentHash,
    projectId: input.projectId,
    datasource: auditDatasource(input.datasource),
    tier: input.tier,
    decision: input.decision,
    reason: input.reason,
  };
}
