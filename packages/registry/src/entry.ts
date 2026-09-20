/**
 * A LEDGER ENTRY IS A REVISION, NOT A NAME.
 *
 * This is the single decision the rest of the package falls out of. The key is
 * `(artifactId, contentHash)`, so "wc-clock" is not a row — "wc-clock at this
 * exact content" is. Everything the requirement asks for follows mechanically:
 *
 *   "approving v1 does not silently bless v2"  — v2 is a different key, and the
 *       approval lives on the v1 key. There is no write that moves it.
 *   "re-proposing changed content must come back as a NEW proposal" — proposing
 *       changed content finds no row at the new key and therefore creates one,
 *       in `proposed`. Not a branch: the absence of a row IS the new proposal.
 *   "nothing self-approves" — the signature is a field on the row, and the only
 *       producer of the type it holds is `namedHuman()`.
 *
 * The alternative — one row per artifact with a `currentHash` — was rejected
 * because it makes "was v2 ever approved, and by whom" a question the trail
 * cannot answer after v3 lands.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS **NOT** ON THIS RECORD
 * ─────────────────────────────────────────────────────────────────────────
 * `enabled`, `reusable`, and the list of projects using it. Those are
 * ENABLEMENT, which the host keys by `(project_id, id)` — per artifact, never
 * per version (`subapp_installs`, `installRow.ts`) — and computes fresh on
 * every call. Ph27 Pitfall 5 and contract §5 rule 2 say it in as many words:
 * "Never cache a boolean. Kill switch, install row and granted scopes are
 * re-read on every call." So they live in `EnablementRow`s beside the entries,
 * and the derived view (`entryView`) is built per call from both.
 */

import {
  isActor,
  isSameActor,
  isSelfApproval,
  namedHuman,
  type Actor,
  type NamedHuman,
} from "./actor";
import {
  ARTIFACT_VERSION_RE,
  isArtifactKind,
  type Artifact,
  type ArtifactKind,
  type Capability,
} from "./artifact";
import { CAPABILITIES } from "../../spec/src/vocabulary";
import {
  isValidArtifactId,
  isValidContentHash,
  isValidProjectId,
  isValidWorkflowId,
} from "./identity";
import type { RegistryReason } from "./reasons";
import type { LifecycleState } from "./states";

/**
 * A named human's signature over ONE revision.
 *
 * `approver` is a `NamedHuman`, whose only producer is `namedHuman()` in
 * `packages/approvals` — so a value of this type cannot exist without the
 * guardrail-4 narrowing having been performed. The type system does the
 * refusing; `ledger.ts` only reports which way it refused.
 */
export interface ApprovalSignature {
  readonly approver: NamedHuman;
  readonly at: string;
  /** Redundant with the entry's key, and deliberately so: a hand-edited ledger
   *  in which the two disagree is caught at registration rather than trusted. */
  readonly contentHash: string;
  /**
   * Free text the approver typed. Stored and shown; NEVER copied into a history
   * entry or an audit body — contract §5 rule 8, "audit names fields, never PII
   * values". This is the one field in the package a salary figure could reach,
   * which is exactly why `audit.ts` has no field to receive it.
   */
  readonly note?: string | undefined;
}

export interface RegistryEntry {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly version: string;
  /** The key, with `artifactId`. Bare lowercase sha256 hex from `hash.ts`. */
  readonly contentHash: string;
  /** The declared scope set — the consent screen, frozen into the digest. */
  readonly capabilities: readonly Capability[];
  /** Provenance: which workflow produced this. Required, never inferred. */
  readonly workflowId: string;
  readonly state: LifecycleState;
  readonly proposedBy: Actor;
  readonly proposedAt: string;
  /** `null` until a named human signs. Never a boolean. */
  readonly approval: ApprovalSignature | null;
  /** Set when a LATER revision of the same artifact was registered. The hash of
   *  that revision, so the trail reads forward as well as backward. */
  readonly supersededBy: string | null;
}

/**
 * The host's `SubAppInstallRow` with the project dimension made explicit — i.e.
 * a row of `subapp_installs`, whose primary key is `(project_id, id)`.
 * `projectId === "*"` is the Function-wide CEILING row (the host's
 * `WORKSPACE_SCOPE_PROJECT_ID`), which is also the row `subapps.json#installs[]`
 * serializes.
 *
 * Keyed by ARTIFACT, not by revision, because that is how the host keys it: a
 * project consents to a sub-app, and registering a newer approved revision
 * updates the `version` the row carries rather than asking every project to
 * consent again. The safety comes from the other side — no revision reaches
 * `registered` without its own named-human signature.
 */
export interface EnablementRow {
  readonly artifactId: string;
  readonly projectId: string;
  readonly enabled: boolean;
  /** Host field name. Set on every enable AND disable write, as the host does. */
  readonly installedAt: string;
  readonly installedBy: string;
  /** Host: "grantedScopes come ONLY from the ceiling row, never from the
   *  manifest here: the project row must not be able to record a wider set." */
  readonly grantedScopes: readonly Capability[];
  readonly version: string;
}

/** The read-side projection: the entry plus what is derived, never stored. */
export interface RegistryEntryView extends RegistryEntry {
  /** Real project ids only — the ceiling is reported separately so a caller
   *  cannot mistake `"*"` for somebody's project. */
  readonly enabledProjects: readonly string[];
  readonly ceilingEnabled: boolean;
}

export function revisionKey(artifactId: string, contentHash: string): string {
  return `${artifactId}\u0000${contentHash}`;
}

/* ── validation ─────────────────────────────────────────────────────────── */

/**
 * ISO-8601 instants only, and parseable. The host stamps its own audit `at`, so
 * the one this package records is the caller's claim about WHEN a human signed
 * — a claim worth refusing when it is not a timestamp at all.
 */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_INSTANT_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * A path shape a proposal may name. REFUSED, never normalized — the same posture
 * `packages/codegen/src/apply.ts` takes at the filesystem ("absolute paths,
 * drive letters, `..` escapes, NUL bytes and `.git` segments are REFUSED, not
 * clamped"). That module answers the question against a real disk, with symlink
 * checks it needs `fs` for; this one answers the part that is pure text, so a
 * malformed path is caught while it is still a proposal.
 */
export function isSafeArtifactPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((s) => s.length > 0 && s !== "." && s !== ".." && s !== ".git");
}

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITIES);

/**
 * Everything wrong with an artifact, checked in one place so the propose path
 * and any future import path apply one implementation. Returns the reason, or
 * `null` when the artifact is sound.
 *
 * Order is cheapest-and-most-identifying first: an operator who mistyped the id
 * should be told that, not told about the fourth file.
 */
export function artifactDefect(artifact: Artifact): RegistryReason | null {
  if (!isValidArtifactId(artifact.id)) return "invalid_artifact_id";
  if (!isArtifactKind(artifact.kind)) return "invalid_artifact_kind";
  if (typeof artifact.version !== "string" || !ARTIFACT_VERSION_RE.test(artifact.version)) {
    return "invalid_artifact_version";
  }
  if (!Array.isArray(artifact.capabilities)) return "invalid_capability";
  for (const cap of artifact.capabilities) {
    // ⛔ The host's `subAppManifestSchema` enumerates exactly two scopes and
    // `loadValidatedManifests` is fail-loud: one invented scope takes the whole
    // server down at boot. A gate in front of that must not pass one through.
    if (!CAPABILITY_SET.has(cap)) return "invalid_capability";
  }
  if (!Array.isArray(artifact.files) || artifact.files.length === 0) return "empty_artifact";
  const seen = new Set<string>();
  for (const file of artifact.files) {
    if (!file || typeof file.text !== "string") return "unsafe_file_path";
    if (!isSafeArtifactPath(file.path)) return "unsafe_file_path";
    if (seen.has(file.path)) return "duplicate_file_path";
    seen.add(file.path);
  }
  return null;
}

/**
 * Why this actor may not sign — the ONE implementation of "nothing
 * self-approves", used by the approve path and exported so a UI can grey out a
 * button using the same rule the ledger will apply.
 *
 * ⭐ ORDER, AND WHY. The first three questions are "is this an approval at
 * all"; the last two are "is it a second party". A signature that fails both is
 * reported by the earlier, coarser question, because its fix is not "find a
 * different colleague" — it is "software cannot sign this, at all, ever".
 *
 *   1. invalid_actor             — not a well-formed actor
 *   2. approval_actor_not_human  — a tool, an agent or the system (guardrail 4)
 *   3. approval_actor_missing    — a human with no name in the trail
 *   4. approval_self_approved    — the approver's subject id IS the artifact's
 *   5. approval_by_proposer      — the approver is who proposed it
 */
export function approverDefect(
  approver: Actor,
  artifactId: string,
  proposedBy: Actor,
): RegistryReason | null {
  if (!isActor(approver)) return "invalid_actor";
  if (approver.kind !== "human") return "approval_actor_not_human";
  if (!namedHuman(approver)) return "approval_actor_missing";
  if (isSelfApproval(approver, artifactId)) return "approval_self_approved";
  if (isSameActor(approver, proposedBy)) return "approval_by_proposer";
  return null;
}

export function projectIdDefect(projectId: unknown): RegistryReason | null {
  return isValidProjectId(projectId) ? null : "invalid_project_id";
}

export function contentHashDefect(hash: unknown): RegistryReason | null {
  return isValidContentHash(hash) ? null : "invalid_content_hash";
}

export function workflowIdDefect(workflowId: unknown): RegistryReason | null {
  return isValidWorkflowId(workflowId) ? null : "invalid_workflow_id";
}
