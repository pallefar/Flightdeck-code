/**
 * ONE RECORD, TWO RENDERINGS — and no third vocabulary.
 *
 * Every transition in this package appends a `HistoryEntry`. That record is
 * shaped on the host's own `subapps.json#_history` row, which
 * `installRoutes.ts#writeSubAppRegistryEntry` writes as exactly:
 *
 *     { at, by, event, subAppId }
 *
 * — four keys, in that order. This file keeps those four as the CORE of the
 * record and adds only identifier fields the lifecycle needs (`kind`,
 * `contentHash`, `workflowId`, and where applicable `projectId` and
 * `grantedScopes`). Two renderings come off it:
 *
 *   `toHostHistoryRow()`  — what goes into `subapps.json`. For the four events
 *                           the host itself writes, this is the host's exact
 *                           four keys and nothing else, so a Studio-written row
 *                           and a host-written row are indistinguishable.
 *   `toFlightdeckAuditBody()` — what the caller hands to `caps.auditAppend()` /
 *                           `appendFlightdeckAudit()`. Host `AuditInput` names
 *                           the actor `actor`, not `by`, so the rename happens
 *                           here, once.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THREE RULES THIS FILE IS BUILT AROUND
 * ─────────────────────────────────────────────────────────────────────────
 * §5 rule 5 — "Never construct an audit hash." There is no `prevHash` here, no
 *   chain, no append, and no `node:crypto` import. This package EMITS bodies;
 *   the host computes the chain against the real tail of the real file. A
 *   second chain implementation from a second checkout is how a chain forks.
 *
 * §5 rule 8 — "Audit names fields, never PII values." `HistoryEntry` is a
 *   CLOSED record of identifiers: ids, a slug, a digest, an actor id, a
 *   timestamp, a scope list. There is no `message`, no `note`, no `detail`, no
 *   index signature — no field a salary figure could arrive in.
 *   `ApprovalSignature.note` is the one place in this package a human types
 *   free text, and there is deliberately nowhere here to copy it to.
 *
 * The host owns `at` on the audit chain. `appendFlightdeckAudit` stamps its own
 *   `at` at second precision ("matches existing chains' second precision"), so
 *   `toFlightdeckAuditBody` does NOT emit one — sending ours would either be
 *   overwritten or, worse, disagree.
 */

import type { ArtifactKind } from "./artifact";
import type { Capability } from "../../spec/src/vocabulary";

/**
 * ⭐ FOUR OF THESE ARE THE HOST'S OWN, SPELLED THE HOST'S WAY.
 * `subapp.enabled` / `subapp.disabled` / `subapp.project-enabled` /
 * `subapp.project-disabled` are copied from `installRoutes.ts` lines 115, 400,
 * 470, 536, 560. The other six are Studio's lifecycle, added INSIDE the host's
 * `subapp.` namespace rather than beside it in a parallel one — the whole point
 * of this package is that an approved tool becomes enableable through the
 * machinery that already exists.
 */
export const REGISTRY_EVENTS = [
  "subapp.proposed",
  "subapp.approved",
  "subapp.rejected",
  "subapp.registered",
  "subapp.superseded",
  "subapp.retired",
  "subapp.enabled",
  "subapp.disabled",
  "subapp.project-enabled",
  "subapp.project-disabled",
] as const;

export type RegistryEvent = (typeof REGISTRY_EVENTS)[number];

/** The four the host writes itself, projected to its exact key set. */
export const HOST_NATIVE_EVENTS: readonly RegistryEvent[] = Object.freeze([
  "subapp.enabled",
  "subapp.disabled",
  "subapp.project-enabled",
  "subapp.project-disabled",
]);

export interface HistoryEntry {
  /** Ledger-internal ordinal, 1-based. Never emitted to the host: the file's
   *  array order already carries sequence, and a second ordering claim is a
   *  second thing that can disagree. */
  readonly seq: number;
  /** ISO timestamp, supplied by the CALLER. This package owns no clock — a
   *  module-level `new Date()` is untestable and, in a package that decides
   *  approvals, a fact nobody can reproduce. */
  readonly at: string;
  /** Subject id of whoever acted. The host's `_history` calls this `by`. */
  readonly by: string;
  readonly event: RegistryEvent;
  /** The host's key name for the artifact. Kept even for scripts, which never
   *  reach `subapps.json`, so the ledger has one spelling. */
  readonly subAppId: string;
  readonly kind: ArtifactKind;
  /** WHICH REVISION this happened to. The field that makes the trail answer
   *  "was v2 ever approved" instead of only "was it approved". */
  readonly contentHash: string;
  readonly workflowId: string;
  /** Present on the two project-scoped events, and on nothing else. */
  readonly projectId?: string | undefined;
  /** D-05: "the FULL granted scope set in the event body — durable proof of
   *  consent (not just `enabled: true`)". Present on the events that record a
   *  consent decision. */
  readonly grantedScopes?: readonly Capability[] | undefined;
}

/**
 * The exact key set this module emits. Exported so a test asserts the shape
 * rather than trusting nobody widened it — and so a reviewer adding a field has
 * to add it HERE, where the rule-8 comment is.
 */
export const HISTORY_ENTRY_FIELDS = Object.freeze([
  "seq",
  "at",
  "by",
  "event",
  "subAppId",
  "kind",
  "contentHash",
  "workflowId",
  "projectId",
  "grantedScopes",
]) as readonly (keyof HistoryEntry)[];

export interface HistoryEntryInput {
  readonly seq: number;
  readonly at: string;
  readonly by: string;
  readonly event: RegistryEvent;
  readonly subAppId: string;
  readonly kind: ArtifactKind;
  readonly contentHash: string;
  readonly workflowId: string;
  readonly projectId?: string | undefined;
  readonly grantedScopes?: readonly Capability[] | undefined;
}

/**
 * The one constructor. Field-by-field and exhaustive on purpose: never a spread
 * of a caller's object, because a spread is how an unexpected key — and the
 * value in it — gets into a log nobody can edit afterwards.
 *
 * Deep-frozen at birth. `history.ts` relies on the freeze AND on reference
 * identity to prove the log was appended to rather than rewritten.
 */
export function historyEntry(input: HistoryEntryInput): HistoryEntry {
  const entry: Record<string, unknown> = {
    seq: input.seq,
    at: input.at,
    by: input.by,
    event: input.event,
    subAppId: input.subAppId,
    kind: input.kind,
    contentHash: input.contentHash,
    workflowId: input.workflowId,
  };
  if (input.projectId !== undefined) entry["projectId"] = input.projectId;
  if (input.grantedScopes !== undefined) {
    entry["grantedScopes"] = Object.freeze([...input.grantedScopes]);
  }
  return Object.freeze(entry) as unknown as HistoryEntry;
}

/** The host's `_history` row, exactly. */
export interface HostHistoryRow {
  readonly at: string;
  readonly by: string;
  readonly event: string;
  readonly subAppId: string;
  readonly kind?: ArtifactKind;
  readonly contentHash?: string;
  readonly workflowId?: string;
  readonly projectId?: string;
  readonly grantedScopes?: readonly Capability[];
}

/**
 * ⭐ A HOST-NATIVE EVENT IS EMITTED WITH THE HOST'S FOUR KEYS AND NO MORE.
 * `writeSubAppRegistryEntry` produces `{at, by, event, subAppId}`; a Studio-
 * written enable row that carried five keys would be visibly ours in a file
 * both sides write, and the next person to diff two rows would have to work out
 * which tool wrote which. The six LIFECYCLE events are new to the file, so they
 * carry their identifiers — the host reads `_history` as `z.array(z.unknown())`
 * and rewrites it additively, so extra keys survive untouched.
 */
export function toHostHistoryRow(entry: HistoryEntry): HostHistoryRow {
  const base = { at: entry.at, by: entry.by, event: entry.event, subAppId: entry.subAppId };
  if (HOST_NATIVE_EVENTS.includes(entry.event)) {
    return Object.freeze(base);
  }
  return Object.freeze({
    ...base,
    kind: entry.kind,
    contentHash: entry.contentHash,
    workflowId: entry.workflowId,
    ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
    ...(entry.grantedScopes !== undefined ? { grantedScopes: entry.grantedScopes } : {}),
  });
}

/**
 * The body for `appendFlightdeckAudit(root, body)` / `caps.auditAppend(body)`.
 * `by` becomes `actor` (host `AuditInput`'s name) and `at` is dropped (the host
 * stamps its own). Everything else is an identifier, per rule 8.
 */
export interface FlightdeckAuditBody {
  readonly event: RegistryEvent;
  readonly actor: string;
  readonly subAppId: string;
  readonly kind: ArtifactKind;
  readonly contentHash: string;
  readonly workflowId: string;
  readonly projectId?: string;
  readonly grantedScopes?: readonly Capability[];
}

export function toFlightdeckAuditBody(entry: HistoryEntry): FlightdeckAuditBody {
  return Object.freeze({
    event: entry.event,
    actor: entry.by,
    subAppId: entry.subAppId,
    kind: entry.kind,
    contentHash: entry.contentHash,
    workflowId: entry.workflowId,
    ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
    ...(entry.grantedScopes !== undefined ? { grantedScopes: entry.grantedScopes } : {}),
  });
}
