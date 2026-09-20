/**
 * THE LIFECYCLE ITSELF.
 *
 *     proposed ──> approved (BY A NAMED HUMAN) ──> registered ──> reusable
 *
 * Every function here is PURE: `(ledger, command) -> result`, returning a NEW
 * ledger and never touching the one it was given. Three things follow, and all
 * three are load-bearing rather than stylistic.
 *
 *  1. A REFUSAL CHANGES NOTHING, structurally. There is no partially-applied
 *     transition to unwind, because nothing was applied — the refusal path
 *     returns the caller's own ledger, by reference.
 *  2. THE OLD LEDGER SURVIVES, so `assertAppendOnly(before.history,
 *     after.history)` is a comparison a caller (and a test) can actually make.
 *     A mutable log can only be checked by a witness that was watching.
 *  3. NO `fs`, NO CLOCK, NO `process.env`. Studio runs as a sub-app of the host
 *     it generates for, and a sub-app route reaches the world only through the
 *     injected capability adapter (contract §5 rule 3 — reaching a host reader
 *     or the filesystem from a route is a capability escape). So timestamps
 *     arrive as arguments and persistence is the caller's business: this module
 *     hands back a value and an ordered list of audit bodies to append through
 *     `caps.auditAppend()`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY ENABLEMENT IS A SEPARATE ROW AND NOT A FIELD
 * ─────────────────────────────────────────────────────────────────────────
 * The host keys `subapp_installs` by `(project_id, id)` and resolves visibility
 * as a three-layer AND — kill switch AND ceiling row (`'*'`) AND this project's
 * row — re-read on every call. This module mirrors that exactly, minus the kill
 * switch, which is an environment variable the HOST owns and Studio must never
 * capture (contract §5 rule 2: "No module-level `process.env` capture"). So a
 * decision produced here is the registry's half of the answer, and the host
 * still asks its own layer at request time.
 *
 * The narrowing rule is the host's, verbatim in intent: a project may turn an
 * artifact OFF, never widen a Function's consent, and `grantedScopes` on a
 * project row are copied from the CEILING row rather than re-derived from the
 * artifact — "the project row must not be able to record a wider set".
 */

import type { Artifact, Capability } from "./artifact";
import { isHostInstallable } from "./artifact";
import type { Actor } from "./actor";
import { isActor } from "./actor";
import { toFlightdeckAuditBody, type FlightdeckAuditBody, type HistoryEntry, type RegistryEvent } from "./audit";
import {
  approverDefect,
  artifactDefect,
  contentHashDefect,
  isValidTimestamp,
  projectIdDefect,
  workflowIdDefect,
  type ApprovalSignature,
  type EnablementRow,
  type RegistryEntry,
  type RegistryEntryView,
} from "./entry";
import { artifactHash } from "./hash";
import { appendHistory, assertAppendOnly, EMPTY_HISTORY } from "./history";
import { CEILING_PROJECT_ID } from "./identity";
import { namedHuman } from "./actor";
import type { RegistryReason } from "./reasons";
import { canTransition, type LifecycleState } from "./states";

/* ── the ledger ─────────────────────────────────────────────────────────── */

export interface Ledger {
  /** One per REVISION, keyed `(artifactId, contentHash)`. Append-only in
   *  practice — entries change state, never disappear. */
  readonly entries: readonly RegistryEntry[];
  /** One per `(artifactId, projectId)`, `'*'` being the Function ceiling. */
  readonly enablements: readonly EnablementRow[];
  readonly history: readonly HistoryEntry[];
}

export function createLedger(): Ledger {
  return Object.freeze({
    entries: Object.freeze([]) as readonly RegistryEntry[],
    enablements: Object.freeze([]) as readonly EnablementRow[],
    history: EMPTY_HISTORY,
  });
}

export type LedgerResult =
  | {
      readonly ok: true;
      readonly reason: "ok";
      readonly ledger: Ledger;
      readonly entry: RegistryEntry;
      /** The entries appended by THIS call, in order. One
       *  `toFlightdeckAuditBody()` per entry is what the caller appends. */
      readonly events: readonly HistoryEntry[];
    }
  | {
      readonly ok: false;
      readonly reason: RegistryReason;
      /** The caller's own ledger, unchanged and by reference. */
      readonly ledger: Ledger;
    };

function refuse(ledger: Ledger, reason: RegistryReason): LedgerResult {
  return { ok: false, reason, ledger };
}

/**
 * The ONE write. Every transition routes through it, so the append-only
 * invariant is checked at the moment of the write rather than asserted
 * afterwards by a test that might not exist.
 */
function commit(
  prev: Ledger,
  next: { entries: readonly RegistryEntry[]; enablements: readonly EnablementRow[]; history: readonly HistoryEntry[] },
  entry: RegistryEntry,
): LedgerResult {
  assertAppendOnly(prev.history, next.history);
  const ledger: Ledger = Object.freeze({
    entries: Object.freeze([...next.entries]),
    enablements: Object.freeze([...next.enablements]),
    history: next.history,
  });
  return {
    ok: true,
    reason: "ok",
    ledger,
    entry,
    events: Object.freeze(next.history.slice(prev.history.length)),
  };
}

/* ── reads (computed fresh, never cached — Pitfall 5) ───────────────────── */

export function findRevision(
  ledger: Ledger,
  artifactId: string,
  contentHash: string,
): RegistryEntry | null {
  return (
    ledger.entries.find((e) => e.artifactId === artifactId && e.contentHash === contentHash) ?? null
  );
}

export function revisionsOf(ledger: Ledger, artifactId: string): readonly RegistryEntry[] {
  return ledger.entries.filter((e) => e.artifactId === artifactId);
}

/**
 * The revision a project would actually get. At most one exists: `register`
 * supersedes any incumbent in the same call that promotes its successor, so two
 * `registered` rows for one id is not a state this module can produce.
 */
export function currentRegistered(ledger: Ledger, artifactId: string): RegistryEntry | null {
  return ledger.entries.find((e) => e.artifactId === artifactId && e.state === "registered") ?? null;
}

export function enablementRow(
  ledger: Ledger,
  artifactId: string,
  projectId: string,
): EnablementRow | null {
  return (
    ledger.enablements.find((r) => r.artifactId === artifactId && r.projectId === projectId) ?? null
  );
}

/**
 * Real project ids with a live row. Derived on every call — a stored list is
 * the cached boolean of contract §5 rule 2 wearing a plural.
 */
export function enabledProjectsFor(ledger: Ledger, artifactId: string): readonly string[] {
  return Object.freeze(
    ledger.enablements
      .filter((r) => r.artifactId === artifactId && r.projectId !== CEILING_PROJECT_ID && r.enabled)
      .map((r) => r.projectId)
      .sort(),
  );
}

export function ceilingEnabled(ledger: Ledger, artifactId: string): boolean {
  return enablementRow(ledger, artifactId, CEILING_PROJECT_ID)?.enabled === true;
}

/** The entry plus everything derived from the enablement rows. */
export function entryView(ledger: Ledger, entry: RegistryEntry): RegistryEntryView {
  return Object.freeze({
    ...entry,
    enabledProjects: enabledProjectsFor(ledger, entry.artifactId),
    ceilingEnabled: ceilingEnabled(ledger, entry.artifactId),
  });
}

/** Every audit body this ledger has produced, in order — the caller's feed. */
export function auditBodies(history: readonly HistoryEntry[]): readonly FlightdeckAuditBody[] {
  return Object.freeze(history.map(toFlightdeckAuditBody));
}

/* ── shared command validation ──────────────────────────────────────────── */

interface ActorStamp {
  readonly by: Actor;
  readonly at: string;
}

function stampDefect(stamp: ActorStamp): RegistryReason | null {
  if (!isActor(stamp.by)) return "invalid_actor";
  if (!isValidTimestamp(stamp.at)) return "invalid_timestamp";
  return null;
}

function withState(entry: RegistryEntry, state: LifecycleState, supersededBy?: string): RegistryEntry {
  return Object.freeze({
    ...entry,
    state,
    ...(supersededBy !== undefined ? { supersededBy } : {}),
  });
}

function replaceEntry(
  entries: readonly RegistryEntry[],
  target: RegistryEntry,
  replacement: RegistryEntry,
): readonly RegistryEntry[] {
  return entries.map((e) => (e === target ? replacement : e));
}

function upsertRow(
  rows: readonly EnablementRow[],
  row: EnablementRow,
): readonly EnablementRow[] {
  const without = rows.filter(
    (r) => !(r.artifactId === row.artifactId && r.projectId === row.projectId),
  );
  return [...without, Object.freeze({ ...row, grantedScopes: Object.freeze([...row.grantedScopes]) })];
}

/* ── propose ────────────────────────────────────────────────────────────── */

export interface ProposeCommand extends ActorStamp {
  readonly artifact: Artifact;
  /** Provenance. Which workflow produced this — required, never inferred. */
  readonly workflowId: string;
}

/**
 * Enter the lifecycle, or say why not.
 *
 * ⭐ THE RE-PROPOSAL RULE IS AN ABSENCE, NOT A BRANCH. The content hash is the
 * second half of the key, so changed content simply finds no row and creates
 * one in `proposed`. There is no code path by which an existing approval can be
 * carried onto it, because no code path here reads another revision's approval.
 *
 * Identical content that is already on record is refused with a reason that
 * says WHICH situation it is — open for review, already signed, already in the
 * catalogue, or closed. A resubmission of byte-identical content that was
 * rejected is `revision_closed`: overturning a human's refusal is a
 * conversation, not a state transition.
 */
export function propose(ledger: Ledger, command: ProposeCommand): LedgerResult {
  const stamp = stampDefect(command);
  if (stamp) return refuse(ledger, stamp);
  const bad = artifactDefect(command.artifact);
  if (bad) return refuse(ledger, bad);
  const badWorkflow = workflowIdDefect(command.workflowId);
  if (badWorkflow) return refuse(ledger, badWorkflow);

  const artifact = command.artifact;
  const siblings = revisionsOf(ledger, artifact.id);
  // The host derives the env var, the nav path and every table prefix from
  // `id` (contract §3), so one id cannot be two kinds of thing.
  const conflicting = siblings.find((e) => e.kind !== artifact.kind);
  if (conflicting) return refuse(ledger, "kind_conflict");

  const contentHash = artifactHash(artifact);
  const existing = findRevision(ledger, artifact.id, contentHash);
  if (existing) {
    switch (existing.state) {
      case "proposed":
        return refuse(ledger, "already_proposed");
      case "approved":
        return refuse(ledger, "already_approved");
      case "registered":
        return refuse(ledger, "already_registered");
      default:
        return refuse(ledger, "revision_closed");
    }
  }

  const entry: RegistryEntry = Object.freeze({
    artifactId: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    contentHash,
    capabilities: Object.freeze([...artifact.capabilities]),
    workflowId: command.workflowId,
    state: "proposed" as const,
    proposedBy: Object.freeze({ ...command.by }),
    proposedAt: command.at,
    approval: null,
    supersededBy: null,
  });

  const history = appendHistory(ledger.history, {
    at: command.at,
    by: command.by.id,
    event: "subapp.proposed",
    subAppId: entry.artifactId,
    kind: entry.kind,
    contentHash: entry.contentHash,
    workflowId: entry.workflowId,
    // The scope set is in the proposal because it is what the human will be
    // asked to consent to — contract §5.9, "the array *is* the human consent
    // screen".
    grantedScopes: entry.capabilities,
  });

  return commit(
    ledger,
    { entries: [...ledger.entries, entry], enablements: ledger.enablements, history },
    entry,
  );
}

/* ── approve / reject ───────────────────────────────────────────────────── */

export interface ApproveCommand extends ActorStamp {
  readonly artifactId: string;
  /** The hash of what the approver READ. Compared, never recomputed from a
   *  stored artifact — a signature is over what was shown, and the ledger
   *  refuses to guess that they were the same thing. */
  readonly contentHash: string;
  readonly note?: string | undefined;
}

/**
 * A named human signs THIS revision.
 *
 * ⛔ NOTHING SELF-APPROVES. `approverDefect` is the one implementation, and the
 * type it guards is the one only `namedHuman()` can produce. Four refusals come
 * out of it and they are four different sentences on purpose: a tool signing
 * for itself, an unnamed human, an approver whose id IS the artifact's, and the
 * proposer approving their own submission.
 *
 * The hash is checked BEFORE the approver, deliberately: "this approval is for
 * a different revision" is the more precise statement about this request, and
 * an approver defect reported against a revision that does not even apply would
 * send an operator to fix the wrong thing. Same ordering, and the same reason,
 * as `packages/approvals/src/approval.ts#verdictFor`.
 */
export function approve(ledger: Ledger, command: ApproveCommand): LedgerResult {
  const stamp = stampDefect(command);
  if (stamp) return refuse(ledger, stamp);
  const badHash = contentHashDefect(command.contentHash);
  if (badHash) return refuse(ledger, badHash);

  const entry = findRevision(ledger, command.artifactId, command.contentHash);
  if (!entry) {
    // An id nobody has ever proposed is a different mistake from an id whose
    // content moved between the proposal and the signature.
    return refuse(
      ledger,
      revisionsOf(ledger, command.artifactId).length > 0 ? "content_hash_mismatch" : "unknown_revision",
    );
  }
  if (!canTransition(entry.state, "approved")) return refuse(ledger, "wrong_state");

  const defect = approverDefect(command.by, entry.artifactId, entry.proposedBy);
  if (defect) return refuse(ledger, defect);
  const approver = namedHuman(command.by);
  // Unreachable after `approverDefect`; kept because the alternative is a
  // non-null assertion, and an assertion is a place a future edit can lie.
  if (!approver) return refuse(ledger, "approval_actor_missing");

  const signature: ApprovalSignature = Object.freeze({
    approver,
    at: command.at,
    contentHash: entry.contentHash,
    ...(command.note !== undefined ? { note: command.note } : {}),
  });
  const approved: RegistryEntry = Object.freeze({
    ...withState(entry, "approved"),
    approval: signature,
  });

  const history = appendHistory(ledger.history, {
    at: command.at,
    by: approver.id,
    event: "subapp.approved",
    subAppId: approved.artifactId,
    kind: approved.kind,
    contentHash: approved.contentHash,
    workflowId: approved.workflowId,
    grantedScopes: approved.capabilities,
  });

  return commit(
    ledger,
    { entries: replaceEntry(ledger.entries, entry, approved), enablements: ledger.enablements, history },
    approved,
  );
}

export interface RejectCommand extends ActorStamp {
  readonly artifactId: string;
  readonly contentHash: string;
}

/**
 * Refuse a proposal.
 *
 * ⭐ A REJECTION NEEDS NO NAMED HUMAN, and that asymmetry is deliberate.
 * Guardrail 4 governs GRANTING — "security, access, and connector permissions
 * require explicit human approval". Refusing grants nothing, and the
 * conformance gate, the red-team gate and `promote.sh` all legitimately reject
 * an artifact with no person in the loop. Requiring a human to countersign a
 * machine's refusal would mean an unattended pipeline could not close a
 * proposal it had already failed, and the proposal would sit in `proposed`
 * looking live.
 */
export function reject(ledger: Ledger, command: RejectCommand): LedgerResult {
  const stamp = stampDefect(command);
  if (stamp) return refuse(ledger, stamp);
  const badHash = contentHashDefect(command.contentHash);
  if (badHash) return refuse(ledger, badHash);

  const entry = findRevision(ledger, command.artifactId, command.contentHash);
  if (!entry) return refuse(ledger, "unknown_revision");
  if (!canTransition(entry.state, "rejected")) return refuse(ledger, "wrong_state");

  const rejected = withState(entry, "rejected");
  const history = appendHistory(ledger.history, {
    at: command.at,
    by: command.by.id,
    event: "subapp.rejected",
    subAppId: rejected.artifactId,
    kind: rejected.kind,
    contentHash: rejected.contentHash,
    workflowId: rejected.workflowId,
  });

  return commit(
    ledger,
    { entries: replaceEntry(ledger.entries, entry, rejected), enablements: ledger.enablements, history },
    rejected,
  );
}

/* ── register ───────────────────────────────────────────────────────────── */

export interface RegisterCommand extends ActorStamp {
  readonly artifactId: string;
  readonly contentHash: string;
}

/**
 * Admit an APPROVED revision to the catalogue — the step that makes it a thing
 * future projects can enable.
 *
 * Two checks that look redundant and are not:
 *
 *  - `state === "approved"` comes from the transition table.
 *  - the signature's own `contentHash` is compared to the entry's key. By
 *    construction they agree; the check exists for a ledger that was
 *    round-tripped through JSON and edited on the way. Registration is the last
 *    gate before other people's projects can switch this on, so it verifies the
 *    signature rather than assuming the in-memory path produced it.
 *
 * Registering supersedes any incumbent registered revision of the same artifact
 * IN THE SAME CALL, so "two registered revisions of one id" is not a state this
 * module can produce. The incumbent keeps its approver and its history; it
 * gains `supersededBy` and a `subapp.superseded` entry naming ITS OWN hash,
 * because the event is a fact about the revision being replaced.
 */
export function register(ledger: Ledger, command: RegisterCommand): LedgerResult {
  const stamp = stampDefect(command);
  if (stamp) return refuse(ledger, stamp);
  const badHash = contentHashDefect(command.contentHash);
  if (badHash) return refuse(ledger, badHash);

  const entry = findRevision(ledger, command.artifactId, command.contentHash);
  if (!entry) return refuse(ledger, "unknown_revision");
  if (entry.state !== "approved") {
    return refuse(ledger, entry.state === "proposed" ? "not_approved" : "wrong_state");
  }
  if (!entry.approval) return refuse(ledger, "not_approved");
  if (entry.approval.contentHash !== entry.contentHash) return refuse(ledger, "content_hash_mismatch");
  if (!namedHuman(entry.approval.approver)) return refuse(ledger, "approval_actor_missing");

  const incumbent = currentRegistered(ledger, entry.artifactId);
  const registered = withState(entry, "registered");

  let entries = replaceEntry(ledger.entries, entry, registered);
  let history = ledger.history;

  if (incumbent) {
    const superseded = withState(incumbent, "superseded", registered.contentHash);
    entries = replaceEntry(entries, incumbent, superseded);
    history = appendHistory(history, {
      at: command.at,
      by: command.by.id,
      event: "subapp.superseded",
      subAppId: superseded.artifactId,
      kind: superseded.kind,
      contentHash: superseded.contentHash,
      workflowId: superseded.workflowId,
    });
  }

  history = appendHistory(history, {
    at: command.at,
    by: command.by.id,
    event: "subapp.registered",
    subAppId: registered.artifactId,
    kind: registered.kind,
    contentHash: registered.contentHash,
    workflowId: registered.workflowId,
    grantedScopes: registered.capabilities,
  });

  // The ceiling row follows the newly registered revision's version and scope
  // set — the host does the same on every enable write. It does NOT flip a
  // closed ceiling open: consent is a separate, human act.
  let enablements = ledger.enablements;
  const ceiling = enablementRow(ledger, registered.artifactId, CEILING_PROJECT_ID);
  if (ceiling) {
    enablements = upsertRow(enablements, {
      ...ceiling,
      version: registered.version,
      grantedScopes: registered.capabilities,
    });
  }

  return commit(ledger, { entries, enablements, history }, registered);
}

/* ── enablement: the ceiling, then the projects ─────────────────────────── */

export interface EnableCommand extends ActorStamp {
  readonly artifactId: string;
}

export interface ProjectEnableCommand extends EnableCommand {
  readonly projectId: string;
}

function ceilingWrite(
  ledger: Ledger,
  command: EnableCommand,
  enabled: boolean,
  event: Extract<RegistryEvent, "subapp.enabled" | "subapp.disabled">,
): LedgerResult {
  const stamp = stampDefect(command);
  if (stamp) return refuse(ledger, stamp);

  const registered = currentRegistered(ledger, command.artifactId);
  if (!registered) return refuse(ledger, "no_ceiling_row");

  const existing = enablementRow(ledger, command.artifactId, CEILING_PROJECT_ID);
  if (existing?.enabled === enabled) return refuse(ledger, enabled ? "already_enabled" : "not_enabled");

  // Host, D-05 / Open Q2: "consent this phase is all-or-nothing — the granted
  // set IS the manifest's own declared capabilities". At the CEILING, and only
  // at the ceiling, the scopes come from the artifact.
  const grantedScopes: readonly Capability[] = registered.capabilities;
  const enablements = upsertRow(ledger.enablements, {
    artifactId: registered.artifactId,
    projectId: CEILING_PROJECT_ID,
    enabled,
    installedAt: command.at,
    installedBy: command.by.id,
    grantedScopes,
    version: registered.version,
  });

  const history = appendHistory(ledger.history, {
    at: command.at,
    by: command.by.id,
    event,
    subAppId: registered.artifactId,
    kind: registered.kind,
    contentHash: registered.contentHash,
    workflowId: registered.workflowId,
    // D-05: "the FULL granted scope set in the event body — durable proof of
    // consent (not just `enabled: true`)". On the disable side the host emits
    // no scopes, and neither do we.
    ...(enabled ? { grantedScopes } : {}),
  });

  return commit(ledger, { entries: ledger.entries, enablements, history }, registered);
}

/** Function-wide consent: the `'*'` ceiling row, and `installs[].enabled`. */
export function enableFunctionWide(ledger: Ledger, command: EnableCommand): LedgerResult {
  return ceilingWrite(ledger, command, true, "subapp.enabled");
}

/**
 * Close the ceiling. Per the host, this LEAVES PROJECT ROWS STANDING: a
 * project's recorded consent survives a closed Function ceiling and comes back
 * the moment the ceiling reopens. The host built `projectConsented` and
 * `consentedProjectIds` onto the wire precisely because that masked state was
 * byte-identical to never-enabled and "every console sentence about it was a
 * guess, and three of them were measurably false". `enabledProjectsFor` reports
 * the stored consent; `reuseDecision` reports the effective answer. Two
 * questions, two functions, neither guessing.
 */
export function disableFunctionWide(ledger: Ledger, command: EnableCommand): LedgerResult {
  return ceilingWrite(ledger, command, false, "subapp.disabled");
}

function projectWrite(
  ledger: Ledger,
  command: ProjectEnableCommand,
  enabled: boolean,
  event: Extract<RegistryEvent, "subapp.project-enabled" | "subapp.project-disabled">,
): LedgerResult {
  const stamp = stampDefect(command);
  if (stamp) return refuse(ledger, stamp);
  const badProject = projectIdDefect(command.projectId);
  if (badProject) return refuse(ledger, badProject);
  if (command.projectId === CEILING_PROJECT_ID) return refuse(ledger, "ceiling_is_not_a_project");

  const registered = currentRegistered(ledger, command.artifactId);
  if (!registered) return refuse(ledger, "no_ceiling_row");

  const ceiling = enablementRow(ledger, command.artifactId, CEILING_PROJECT_ID);
  // Host: "A project may turn a sub-app OFF, never widen the Function's consent
  // (guardrail 4 / D-05) — so the ceiling row must ALREADY be enabled."
  if (enabled && !ceiling?.enabled) return refuse(ledger, "ceiling_not_enabled");

  const existing = enablementRow(ledger, command.artifactId, command.projectId);
  if (existing?.enabled === enabled) return refuse(ledger, enabled ? "already_enabled" : "not_enabled");
  if (!enabled && !existing) return refuse(ledger, "not_enabled");

  // Host: "grantedScopes come ONLY from the ceiling row, never from the
  // manifest here: the project row must not be able to record a wider set."
  const grantedScopes: readonly Capability[] = ceiling?.grantedScopes ?? existing?.grantedScopes ?? [];
  const version = ceiling?.version ?? registered.version;

  const enablements = upsertRow(ledger.enablements, {
    artifactId: registered.artifactId,
    projectId: command.projectId,
    enabled,
    installedAt: command.at,
    installedBy: command.by.id,
    grantedScopes,
    version,
  });

  const history = appendHistory(ledger.history, {
    at: command.at,
    by: command.by.id,
    event,
    subAppId: registered.artifactId,
    kind: registered.kind,
    contentHash: registered.contentHash,
    workflowId: registered.workflowId,
    projectId: command.projectId,
  });

  return commit(ledger, { entries: ledger.entries, enablements, history }, registered);
}

/** The point of the whole package: reuse in a project that did not build it. */
export function enableForProject(ledger: Ledger, command: ProjectEnableCommand): LedgerResult {
  return projectWrite(ledger, command, true, "subapp.project-enabled");
}

export function disableForProject(ledger: Ledger, command: ProjectEnableCommand): LedgerResult {
  return projectWrite(ledger, command, false, "subapp.project-disabled");
}

/* ── retire ─────────────────────────────────────────────────────────────── */

export interface RetireCommand extends ActorStamp {
  readonly artifactId: string;
  readonly contentHash: string;
}

/**
 * Take a revision out of service. Archives, never deletes — the same
 * retire/reinstate idiom as the host's `revokedAt`-set-row-stays, so the trail
 * keeps naming the human who once approved it.
 *
 * Retiring a REGISTERED revision closes the ceiling in the same call, because
 * leaving `installs[].enabled: true` for an artifact with no registered
 * revision would be a row pointing at nothing — the exact shape of the host's
 * "consented and invisible at the same time" defect, inverted.
 */
export function retire(ledger: Ledger, command: RetireCommand): LedgerResult {
  const stamp = stampDefect(command);
  if (stamp) return refuse(ledger, stamp);
  const badHash = contentHashDefect(command.contentHash);
  if (badHash) return refuse(ledger, badHash);

  const entry = findRevision(ledger, command.artifactId, command.contentHash);
  if (!entry) return refuse(ledger, "unknown_revision");
  if (!canTransition(entry.state, "retired")) return refuse(ledger, "wrong_state");

  const wasRegistered = entry.state === "registered";
  const retired = withState(entry, "retired");
  let enablements = ledger.enablements;
  let history = ledger.history;

  const ceiling = enablementRow(ledger, entry.artifactId, CEILING_PROJECT_ID);
  if (wasRegistered && ceiling?.enabled) {
    enablements = upsertRow(enablements, {
      ...ceiling,
      enabled: false,
      installedAt: command.at,
      installedBy: command.by.id,
    });
    history = appendHistory(history, {
      at: command.at,
      by: command.by.id,
      event: "subapp.disabled",
      subAppId: entry.artifactId,
      kind: entry.kind,
      contentHash: entry.contentHash,
      workflowId: entry.workflowId,
    });
  }

  history = appendHistory(history, {
    at: command.at,
    by: command.by.id,
    event: "subapp.retired",
    subAppId: retired.artifactId,
    kind: retired.kind,
    contentHash: retired.contentHash,
    workflowId: retired.workflowId,
  });

  return commit(
    ledger,
    { entries: replaceEntry(ledger.entries, entry, retired), enablements, history },
    retired,
  );
}

/* ── the reuse question ─────────────────────────────────────────────────── */

export interface ReuseQuestion {
  readonly artifactId: string;
  readonly projectId: string;
  /** The bytes ON HAND. Supply the artifact and the hash is recomputed here —
   *  which is what turns "was this approved" into "is what is about to run the
   *  thing that was approved". Omit both and the answer covers enablement only,
   *  and says so via `verifiedAgainstContent`. */
  readonly artifact?: Artifact | undefined;
  readonly contentHash?: string | undefined;
}

export interface ReuseDecision {
  readonly allowed: boolean;
  readonly reason: RegistryReason;
  readonly entry: RegistryEntry | null;
  readonly grantedScopes: readonly Capability[];
  /** False when the caller supplied neither an artifact nor a hash. A `true`
   *  allowed with this `false` is a weaker claim, and saying so is cheaper than
   *  a caller assuming otherwise. */
  readonly verifiedAgainstContent: boolean;
}

function decision(
  reason: RegistryReason,
  entry: RegistryEntry | null,
  grantedScopes: readonly Capability[],
  verified: boolean,
): ReuseDecision {
  return Object.freeze({
    allowed: reason === "ok",
    reason,
    entry,
    grantedScopes: Object.freeze([...grantedScopes]),
    verifiedAgainstContent: verified,
  });
}

/**
 * May THIS project run THIS artifact, right now, with THESE bytes?
 *
 * ⛔ COMPUTED FRESH, NEVER STORED. No `allowed` flag is written to any record
 * here (contract §5 rule 2), and the three layers are asked in the order an
 * operator can act on:
 *
 *   1. is there a registered revision at all      -> no_ceiling_row
 *   2. are the bytes on hand the ones approved    -> content_drift
 *   3. is the Function ceiling open               -> ceiling_not_enabled
 *   4. is this project's row open                 -> not_enabled
 *
 * ⭐ DRIFT IS CHECKED BEFORE ENABLEMENT, on purpose. If the bytes moved, the
 * honest answer is "what is on disk is not what was approved" — and reporting
 * `not_enabled` first would send someone to flip a switch, which would then let
 * unapproved code run.
 *
 * This is the registry's half of the answer. The host still applies its own
 * kill-switch layer at request time; Studio must never read `SUBAPP_<ID>_ENABLED`
 * itself (contract §5 rule 2, "no module-level `process.env` capture").
 */
export function reuseDecision(ledger: Ledger, question: ReuseQuestion): ReuseDecision {
  const badProject = projectIdDefect(question.projectId);
  if (badProject) return decision(badProject, null, [], false);

  const registered = currentRegistered(ledger, question.artifactId);
  if (!registered) return decision("no_ceiling_row", null, [], false);

  const presented = question.artifact ? artifactHash(question.artifact) : question.contentHash;
  const verified = presented !== undefined;
  if (verified && presented !== registered.contentHash) {
    return decision("content_drift", registered, [], true);
  }

  const ceiling = enablementRow(ledger, question.artifactId, CEILING_PROJECT_ID);
  if (!ceiling?.enabled) return decision("ceiling_not_enabled", registered, [], verified);

  if (question.projectId !== CEILING_PROJECT_ID) {
    const row = enablementRow(ledger, question.artifactId, question.projectId);
    if (!row?.enabled) return decision("not_enabled", registered, [], verified);
  }

  return decision("ok", registered, ceiling.grantedScopes, verified);
}

/** Every artifact a future project could be offered, with its provenance. */
export function reusableCatalogue(ledger: Ledger): readonly RegistryEntryView[] {
  return Object.freeze(
    ledger.entries
      .filter((e) => e.state === "registered")
      .map((e) => entryView(ledger, e))
      .sort((a, b) => (a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0)),
  );
}

/** Registered artifacts the HOST's sub-app machinery can resolve (see `emit.ts`). */
export function hostInstallableEntries(ledger: Ledger): readonly RegistryEntry[] {
  return Object.freeze(ledger.entries.filter((e) => e.state === "registered" && isHostInstallable(e.kind)));
}
