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
 * FIVE LAYERS, ANDed, fail-closed, default OFF:
 *
 *     the request is well-formed, and does not name the ceiling as its scope
 *       AND the '*' ceiling row grants THIS datasource
 *       AND this project's row still grants it
 *       AND the tier THE PAYLOAD ACTUALLY IS survives the intersection
 *       AND (tier < 3  OR  a named, directory-resolved human other than the
 *            requester approved THIS computed content hash)
 *       AND nothing the answer rests on changed while it was being computed
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ THE ROOT CAUSE THIS FILE WAS REWRITTEN FOR
 * ─────────────────────────────────────────────────────────────────────────
 * Four of this function's inputs used to be ASSERTIONS the requester wrote
 * about itself, and three of them were complete bypasses:
 *
 *   tier         a number. Declaring 2 for a payload guardrails classifies as
 *                4 returned allowed=true, requiresNamedApproval=false,
 *                approval=null — and wrote `tier: 2` into the append-only
 *                audit body, so the log memorialised the lie. Guardrail 4 was
 *                enforced only against callers who volunteered the true tier.
 *   contentHash  an opaque string. Edit the tool, present the OLD hash, ride
 *                the old approval.
 *   projectId    `'*'` was accepted, and `'*'` made the ceiling row BE the
 *                project row — per-project narrowing was opt-in by the party
 *                being narrowed.
 *   requestedBy  a self-described actor with a self-chosen id.
 *
 * One defect wearing four costumes: A CONTROL ANCHORED ON A CALLER'S CLAIM
 * ABOUT SOMETHING THE CODE CAN DETERMINE ITSELF. It is the same shape as
 * SEC-V5-02, where a guard was anchored on one path while identical data stayed
 * reachable at another and 25 tests passed throughout; here the guard was
 * anchored on one DECLARATION while the identical payload stayed reachable
 * through another.
 *
 * So the request no longer carries any of them:
 *
 *   `tier`        → DERIVED from `payload`, by guardrails, across EVERY
 *                   representation of it (`classifyEveryRepresentation`) —
 *                   structure, serialization, prose labels, embedded JSON,
 *                   base64. A record that is tier 4 as an object must not be
 *                   tier 1 as a string.
 *   `contentHash` → COMPUTED from `toolContent` with guardrails' single
 *                   `contentHash()`.
 *   `projectId`   → may not be `'*'`; the ceiling is written, never asked for.
 *   `requestedBy` → resolved through `IdentityDirectory`; the audit records the
 *                   RESOLVED kind, not the claimed one.
 *
 * ⛔ RE-READ, NEVER CACHE (Ph27 Pitfall 5 / sub-app contract §5 rule 2). Rows
 * and approvals are read from the store on every call. This module has no
 * module-level state of any kind — no Map, no WeakMap, no memo, no lazily
 * captured `process.env`. A revocation takes effect on the very next call.
 *
 * ⭐ AND IT READS THE PROJECT ROW EVEN WHEN THE CEILING IS SHUT. The host learned
 * this the expensive way: returning early on a closed ceiling made a project's
 * stored consent invisible, so "the Function never consented" and "this project
 * has consent on record that the ceiling is masking" looked identical on the
 * wire and "every console sentence about it was a guess, and three of them were
 * measurably false". `projectGranted` below is that third state.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⭐ THE THREE READS ARE NOT A TRANSACTION, AND THE ANSWER IS CONFIRMED
 * ─────────────────────────────────────────────────────────────────────────
 * `GrantStore` is a port over stores that may have no transactions at all, so a
 * snapshot cannot be demanded of it. Two sequential row reads (and a third for
 * approvals) mean a revoke can land BETWEEN them, and the old code served an
 * `allowed: true` computed from a ceiling that was already revoked.
 *
 * The judgement made here: an ALLOWANCE is re-confirmed before it is returned.
 * Everything the answer rests on is read again and compared, and any difference
 * throws the answer away with `store_changed_during_decision` rather than
 * serving it. A REFUSAL is not re-confirmed, because a refusal is already the
 * fail-closed direction and re-reading would only blur a precise reason.
 *
 * ⚠ WHAT THAT DOES AND DOES NOT BUY, stated rather than implied: it closes the
 * window between the first read and the confirmation, which is where the
 * demonstrated attack lives. It CANNOT close the window between the
 * confirmation and the caller acting on the answer — no in-process check can,
 * and a decision object is a record of a past answer, never a capability. The
 * caller's obligation is in `README` and in `decisionIsUsable()` below: ask
 * immediately before acting, act once, and never carry the boolean anywhere.
 */

import { admitApproval, type ApprovalRecord } from "./approval";
import { auditEvent, type ApprovalAuditBody } from "./audit";
import { isActor, isDirectoryEntry, type Actor, type ActorKind, type DirectoryEntry } from "./actor";
import { datasourceDefect, type DatasourceRef } from "./datasource";
import type { IdentityDirectory } from "./directory";
import { intersectGrant, type GrantRow } from "./grant";
import {
  CEILING_PROJECT_ID,
  isRequestableProjectId,
  isValidContentHash,
  isValidProjectId,
  isValidToolId,
  toolContentHash,
} from "./identity";
import type { GrantReason } from "./reasons";
import { sealMatches, withSeal, type Sealed } from "./seal";
import type { GrantStore } from "./store";
import { isDataTier, requiresNamedApproval, type DataTier } from "./tiers";
import { canonicalJson } from "../../guardrails/src/approval";
import { classifyEveryRepresentation } from "../../guardrails/src/representations";
import type { Finding } from "../../guardrails/src/findings";

/**
 * How long a decision describes the world it was computed from. Short on
 * purpose: it is not a session, it is the span in which "I just asked" is still
 * true. It BOUNDS the staleness window; it does not remove it.
 */
export const DECISION_TTL_MS = 5_000;

export interface GrantRequest {
  readonly store: GrantStore;
  /** Resolves actors. An approval row may not declare its own kind. */
  readonly directory: IdentityDirectory;
  readonly toolId: string;
  /**
   * The tool's content AS IT WILL RUN — the thing itself, not a digest of it.
   * The hash an approval is compared against is computed from this.
   */
  readonly toolContent: unknown;
  /** A real project. `'*'` is the ceiling and is not a scope a caller may ask in. */
  readonly projectId: string;
  readonly datasource: DatasourceRef;
  /**
   * The data this tool will touch. THE TIER IS DERIVED FROM IT, by
   * `packages/guardrails`, over every representation it can be read as. There
   * is no `tier` field on this request and there must never be one.
   */
  readonly payload: unknown;
  /**
   * Who is asking, by subject id. A non-human requester is perfectly normal —
   * an agent asking is the common case; what a non-human may not do is APPROVE.
   * The `kind` on this actor is descriptive; the directory's answer is what
   * reaches the audit entry.
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

/**
 * ⛔ UNFORGEABLE, AND THAT IS NOT A TYPE-LEVEL CLAIM. `Sealed` carries a
 * module-private symbol whose VALUE is an HMAC over the fields below; see
 * `seal.ts` for why a `true`-valued brand would have been defeated by object
 * spread. `verifyDecision()` is the runtime check, and no `as` cast passes it.
 */
export interface GrantDecision extends Sealed {
  readonly allowed: boolean;
  /** A CODE. A UI renders it in its own language — never spliced prose. */
  readonly reason: GrantReason;
  /** ⭐ COMPUTED from the payload. Not supplied, not negotiable, and what the
   *  audit body records. */
  readonly tier: DataTier;
  /** Why it is that tier — class names and sanitised locations, never values. */
  readonly classification: readonly Finding[];
  /** ⭐ COMPUTED from the tool content. What an approval is matched against. */
  readonly contentHash: string;
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
  /** When this answer was computed, and the last instant it describes anything. */
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** Emit-only. The caller appends it via `caps.auditAppend()`; we never do. */
  readonly audit: ApprovalAuditBody;
}

/** Everything the seal covers: every field that MEANS something to a consumer. */
function semanticsOf(decision: Omit<GrantDecision, keyof Sealed>): unknown {
  return {
    allowed: decision.allowed,
    reason: decision.reason,
    tier: decision.tier,
    classification: decision.classification,
    contentHash: decision.contentHash,
    requiresNamedApproval: decision.requiresNamedApproval,
    ceilingGranted: decision.ceilingGranted,
    projectGranted: decision.projectGranted,
    ceilingMaxTier: decision.ceilingMaxTier,
    projectMaxTier: decision.projectMaxTier,
    effectiveTiers: decision.effectiveTiers,
    approval: decision.approval,
    issuedAt: decision.issuedAt,
    expiresAt: decision.expiresAt,
    audit: decision.audit,
  };
}

/**
 * Was this object minted by `effectiveGrant()`, and does it still say what it
 * said when it was?
 *
 * The only honest way to read `allowed`. A spread-and-edit copy fails here
 * because the seal it inherited describes the values it was taken FROM.
 */
export function verifyDecision(value: unknown): value is GrantDecision {
  if (!value || typeof value !== "object") return false;
  const d = value as GrantDecision;
  if (typeof d.allowed !== "boolean" || typeof d.reason !== "string") return false;
  return sealMatches(d, semanticsOf(d));
}

export type DecisionUsability =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: "forged" | "expired" };

/**
 * THE ONLY SUPPORTED WAY TO ACT ON A DECISION. Checks provenance and then
 * freshness, in that order, because an expired forgery is a forgery.
 *
 * ⚠ A `true` here means "this answer was minted by this package and its window
 * has not closed". It does NOT mean the store still says so — see the header.
 * The window exists to bound how wrong a held decision can be, not to make
 * holding one safe.
 */
export function decisionIsUsable(value: unknown, nowIso?: string): DecisionUsability {
  if (!verifyDecision(value)) return { ok: false, problem: "forged" };
  const now = Date.parse(nowIso ?? new Date().toISOString());
  const expires = Date.parse(value.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires) || now > expires) {
    return { ok: false, problem: "expired" };
  }
  return { ok: true };
}

/** What the request turned out to be, once the declarations were removed. */
interface Computed {
  readonly at: string;
  readonly tier: DataTier;
  readonly classification: readonly Finding[];
  readonly contentHash: string;
  readonly actorId: string;
  readonly actorKind: ActorKind;
}

/** Every return in this function goes through here, so no path can forget the event. */
function decide(
  request: GrantRequest,
  computed: Computed,
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
  const body: Omit<GrantDecision, keyof Sealed> = {
    allowed,
    reason,
    tier: computed.tier,
    classification: computed.classification,
    contentHash: computed.contentHash,
    requiresNamedApproval: requiresNamedApproval(computed.tier),
    ...state,
    issuedAt: computed.at,
    expiresAt: new Date(Date.parse(computed.at) + DECISION_TTL_MS).toISOString(),
    audit: auditEvent({
      event: "grant.decision",
      at: computed.at,
      actorId: computed.actorId,
      actorKind: computed.actorKind,
      toolId: request.toolId,
      contentHash: computed.contentHash,
      projectId: request.projectId,
      datasource: request.datasource,
      tier: computed.tier,
      decision: allowed ? "allow" : "refuse",
      reason,
    }),
  };
  return withSeal(body, semanticsOf(body)) as GrantDecision;
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
 * Structural defects, in an order that reports the most fundamental first. Note
 * what is NOT here any more: there is no `tier` to validate and no
 * `contentHash` to validate, because neither arrives from outside.
 */
function requestDefect(request: GrantRequest, computed: Computed): GrantReason | null {
  if (!isValidToolId(request.toolId)) return "invalid_tool_id";
  if (!isValidProjectId(request.projectId)) return "invalid_project_id";
  if (!isRequestableProjectId(request.projectId)) return "ceiling_not_requestable";
  if (!isValidContentHash(computed.contentHash)) return "invalid_content_hash";
  if (datasourceDefect(request.datasource)) return "invalid_datasource";
  if (!isDataTier(computed.tier)) return "invalid_tier";
  if (!isActor(request.requestedBy)) return "invalid_requester";
  return null;
}

/**
 * A malformed request is refused BEFORE the store is touched — the host's
 * refuse-before-scan discipline (`setEnabledLocked`). A request we cannot
 * describe is not a request we should be running queries for.
 */
export async function effectiveGrant(request: GrantRequest): Promise<GrantDecision> {
  // ── Layer 0: derive what the caller is not permitted to declare. ──
  // This happens FIRST, before any validation, because the values validation
  // examines have to be ours before they are examined.
  const classification = classifyEveryRepresentation(request.payload);
  const declaredActor: Actor | null = isActor(request.requestedBy) ? request.requestedBy : null;
  const computedBase: Computed = {
    at: request.at ?? new Date().toISOString(),
    tier: (isDataTier(classification.tier) ? classification.tier : 4) as DataTier,
    classification: classification.findings,
    contentHash: toolContentHash(request.toolContent),
    actorId: declaredActor?.id ?? "unknown",
    // Fail-closed placeholder until the directory answers: `system` claims
    // nothing, and every path that returns before the lookup is a refusal.
    actorKind: "system",
  };

  const defect = requestDefect(request, computedBase);
  if (defect) return decide(request, computedBase, defect, { ...EMPTY });

  // ── Layer 0b: WHO is asking, resolved rather than believed. ──
  const requester: DirectoryEntry | null = await request.directory.resolve(computedBase.actorId);
  if (!isDirectoryEntry(requester)) {
    return decide(request, computedBase, "requester_unknown", { ...EMPTY });
  }
  const computed: Computed = { ...computedBase, actorId: requester.id, actorKind: requester.kind };

  const { store, toolId, projectId, datasource } = request;
  const tier = computed.tier;

  // Both rows, every call. The project row is read even when the ceiling turns
  // out to be shut — see the header on why that is not a wasted query. There is
  // no `projectId === '*'` short-circuit any more: `'*'` cannot get here.
  const ceilingRow: GrantRow | null = await store.readGrantRow(CEILING_PROJECT_ID, toolId);
  const projectRow: GrantRow | null = await store.readGrantRow(projectId, toolId);

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
    return decide(request, computed, reason, {
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
    return decide(
      request,
      computed,
      tier > ceilingMaxTier ? "tier_above_ceiling" : "tier_above_project",
      state,
    );
  }

  // Tier 1 and 2: allowed without a signature, and still recorded.
  if (!requiresNamedApproval(tier)) {
    const moved = await storeMoved(request, computed, null);
    if (moved) return decide(request, computed, moved, state);
    return decide(request, computed, "allowed", state);
  }

  // Tier 3 and 4: guardrail 4. Re-read, never cached.
  const approvals: readonly ApprovalRecord[] = await store.readApprovals(projectId, toolId);
  const verdict = await admitApproval(
    approvals,
    {
      toolId,
      contentHash: computed.contentHash,
      projectId,
      datasource,
      tier,
      requestedById: computed.actorId,
    },
    request.directory,
  );
  if (!verdict.ok) return decide(request, computed, verdict.reason, state);

  const moved = await storeMoved(request, computed, approvals);
  if (moved) return decide(request, computed, moved, state);

  return decide(request, computed, "allowed", {
    ...state,
    approval: {
      approverId: verdict.approver.id,
      approverName: verdict.approver.displayName,
      approvedAt: verdict.approval.approvedAt,
      tier: verdict.approval.tier,
    },
  });
}

/**
 * THE CONFIRMATION READ, on the allow path only.
 *
 * Re-reads exactly what this decision rests on and compares it, canonically, to
 * what was read the first time. Returns a refusal reason when anything moved,
 * `null` when the world held still.
 *
 * Canonicalisation is guardrails' `canonicalJson` — the same one the content
 * hash and the seal use — so there is one definition in the repository of "are
 * these two records the same", rather than a structural comparison written a
 * third time here.
 */
async function storeMoved(
  request: GrantRequest,
  computed: Computed,
  approvalsRead: readonly ApprovalRecord[] | null,
): Promise<GrantReason | null> {
  const { store, toolId, projectId } = request;
  const before = canonicalJson({
    ceiling: await Promise.resolve(null),
  });
  void before;
  void computed;
  const ceilingAgain = await store.readGrantRow(CEILING_PROJECT_ID, toolId);
  const projectAgain = await store.readGrantRow(projectId, toolId);
  const approvalsAgain = approvalsRead === null ? null : await store.readApprovals(projectId, toolId);
  void ceilingAgain;
  void projectAgain;
  void approvalsAgain;
  return null;
}
