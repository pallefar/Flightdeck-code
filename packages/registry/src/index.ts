/**
 * `@registry` — the reuse ledger. One question: HAS A NAMED HUMAN APPROVED THIS
 * EXACT THING, AND MAY THIS PROJECT RUN IT?
 *
 * The user's requirement, verbatim: "when a new tool is created let's get it
 * approved and then it is used for future projects, same for any scripts etc
 * that can be scaled." That sentence is a lifecycle, and this package is it:
 *
 *     proposed ──> approved (BY A NAMED HUMAN) ──> registered ──> reusable
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FOUR PROPERTIES THAT MAKE IT MORE THAN A STATUS FIELD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. AN ENTRY IS A REVISION, NOT A NAME. The key is `(artifactId,
 *    contentHash)`. Approving v1 therefore cannot bless v2, not because a check
 *    forbids it but because v2 is a different row with no signature on it.
 *    Re-proposing changed content comes back as a new proposal for the same
 *    reason: the absence of a row IS the new proposal.
 *
 * 2. NOTHING SELF-APPROVES. The approver type has exactly one producer,
 *    `namedHuman()` in `packages/approvals`, which returns `null` for a tool, an
 *    agent, the system and an anonymous human (`boot.json` guardrail 4). On top
 *    of that, `approverDefect` refuses an approver whose subject id IS the
 *    artifact's, and one who is the actor that proposed it. Four refusals, four
 *    distinct reason codes, one implementation.
 *
 * 3. EVERY TRANSITION IS AN APPEND-ONLY ENTRY. Entries are frozen at birth, the
 *    log is a value rather than a handle, and every write routes through a
 *    commit that asserts the new log extends the old one by reference. What
 *    this package does NOT do is chain hashes — the host's audit chain is
 *    GENESIS-rooted and computed against the real tail of the real file, and a
 *    second implementation from a second checkout is how a chain forks
 *    (contract §5 rule 5). Studio emits bodies; the host appends them.
 *
 * 4. THE OUTPUT IS THE HOST'S OWN FILE. `emit.ts` produces
 *    `{schema: "subapp-registry/1", installs, _history}` — the shape
 *    `subapps.json` already has, with the host's four event names, the host's
 *    `'*'` ceiling, and the host's rule that a project may narrow a Function's
 *    consent and never widen it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS PACKAGE IS NOT
 * ─────────────────────────────────────────────────────────────────────────
 * It is not a permission check. "May this tool touch this datasource at this
 * tier" is `packages/approvals`' `effectiveGrant()`, and the content hash on an
 * entry here is the same opaque string that one compares — deliberately, so a
 * registered artifact can be handed to it without a second spelling of the same
 * digest.
 *
 * It owns no clock, no filesystem and no environment. Timestamps and actors are
 * arguments; persistence is the caller's; the kill switch stays the host's.
 */

export {
  ARTIFACT_KINDS,
  ARTIFACT_VERSION_RE,
  HOST_INSTALLABLE_KINDS,
  isArtifactKind,
  isHostInstallable,
} from "./artifact";
export type { Artifact, ArtifactFile, ArtifactKind, Capability } from "./artifact";

export { ACTOR_KINDS, isActor, isActorKind, isSameActor, isSelfApproval, namedHuman } from "./actor";
export type { Actor, ActorKind, NamedHuman } from "./actor";

export {
  HISTORY_ENTRY_FIELDS,
  HOST_NATIVE_EVENTS,
  REGISTRY_EVENTS,
  historyEntry,
  toFlightdeckAuditBody,
  toHostHistoryRow,
} from "./audit";
export type {
  FlightdeckAuditBody,
  HistoryEntry,
  HistoryEntryInput,
  HostHistoryRow,
  RegistryEvent,
} from "./audit";

export {
  approverDefect,
  artifactDefect,
  contentHashDefect,
  isSafeArtifactPath,
  isValidTimestamp,
  projectIdDefect,
  revisionKey,
  workflowIdDefect,
} from "./entry";
export type {
  ApprovalSignature,
  EnablementRow,
  RegistryEntry,
  RegistryEntryView,
} from "./entry";

export { HASHED_ARTIFACT_FIELDS, artifactHash, canonicalJson, contentHash, hashedShape } from "./hash";
export type { HashedArtifactShape } from "./hash";

export {
  EMPTY_HISTORY,
  HistoryRewriteError,
  appendHistory,
  assertAppendOnly,
  entriesSince,
  isAppendOnly,
  nextSeq,
} from "./history";

export {
  ARTIFACT_ID_RE,
  CEILING_PROJECT_ID,
  CONTENT_HASH_RE,
  DEFAULT_PROJECT_ID,
  PROJECT_SLUG_RE,
  TOOL_ID_RE,
  WORKFLOW_ID_RE,
  isValidArtifactId,
  isValidContentHash,
  isValidProjectId,
  isValidToolId,
  isValidWorkflowId,
} from "./identity";

export {
  auditBodies,
  ceilingEnabled,
  createLedger,
  currentRegistered,
  disableForProject,
  disableFunctionWide,
  enableForProject,
  enableFunctionWide,
  enabledProjectsFor,
  enablementRow,
  entryView,
  findRevision,
  hostInstallableEntries,
  propose,
  register,
  reject,
  retire,
  reusableCatalogue,
  reuseDecision,
  revisionsOf,
} from "./ledger";
export type {
  ApproveCommand,
  EnableCommand,
  Ledger,
  LedgerResult,
  ProjectEnableCommand,
  ProposeCommand,
  RegisterCommand,
  RejectCommand,
  RetireCommand,
  ReuseDecision,
  ReuseQuestion,
} from "./ledger";

export { REGISTRY_REASONS, SELF_APPROVAL_REASONS, isRefusal } from "./reasons";
export type { RegistryReason } from "./reasons";

export {
  LIFECYCLE_STATES,
  TERMINAL_STATES,
  TRANSITIONS,
  canTransition,
  isLifecycleState,
  isReusableState,
} from "./states";
export type { LifecycleState } from "./states";

export {
  SUBAPP_REGISTRY_REL,
  SUBAPP_REGISTRY_SCHEMA,
  applyEventsToHostRegistry,
  emittedRegistryFileSchema,
  hostInstallEntrySchema,
  hostRegistryFileSchema,
  readHostRegistryFile,
  serializeSubAppRegistryFile,
  toHostHistoryRows,
  toInstallEntries,
  toSubAppRegistryFile,
  validateAgainstHostSchema,
} from "./emit";
export type { HostInstallEntry, SubAppRegistryFile } from "./emit";
