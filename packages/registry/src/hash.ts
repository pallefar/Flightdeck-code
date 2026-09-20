/**
 * WHAT EXACTLY WAS APPROVED — the third and last borrowing leaf.
 *
 * ⛔ THIS PACKAGE DOES NOT INVENT A DIGEST. `packages/guardrails/src/approval.ts`
 * already owns `canonicalJson` + `contentHash` for precisely this purpose
 * ("APPROVAL BOUND TO CONTENT — approving v1 must not bless v2"), and its
 * docstring explains why that is a plain digest and emphatically NOT an audit
 * chain hash. Sub-app contract §5 rule 5 — "Never construct an audit hash. Only
 * `appendFlightdeckAudit()` / `caps.auditAppend()`" — is about the chain, which
 * is GENESIS-rooted, computed against the real tail of the real file, and
 * belongs to the host. Nothing here is chained, ordered, or appended.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE HASH COVERS THE CONSENT SCREEN, NOT JUST THE BYTES
 * ─────────────────────────────────────────────────────────────────────────
 * An approval is a human saying "I read this and I am willing for it to run in
 * other people's projects". So the hash must cover everything that human was
 * shown, and nothing that moves without their knowledge. It covers:
 *
 *   id            — a rename is a different tool. The host locks `id` once
 *                   shipped (contract §2) because the env var, the nav path and
 *                   every table prefix derive from it; approving `wc-clock` is
 *                   not approving `payroll-clock` with the same body.
 *   kind          — "mini-app" and "script" are reviewed differently and reach
 *                   different surfaces. Same bytes, different question.
 *   version       — the label the operator will publish. Deliberately IN, even
 *                   though for a mini-app it also lives inside `manifest.ts`
 *                   and would move the digest anyway: for a script there is no
 *                   manifest, and a version bump that needs no re-approval is
 *                   exactly the "silently bless v2" move this file exists to
 *                   stop.
 *   capabilities  — the array IS the human consent screen (contract §5.9). A
 *                   scope set that could widen without moving the hash would
 *                   make the approval a standing permission over a mutable
 *                   grant, which is the thing an approval is not.
 *   files         — path AND text, sorted by path, so key order, emitter order
 *                   and filesystem order cannot change the digest.
 *
 * It covers nothing else. `workflowId`, the proposer, the timestamp and the
 * approver's note are provenance and process, not content: recording who
 * proposed it must not invalidate a signature over what was proposed.
 */

import { contentHash } from "../../guardrails/src/approval";
export { canonicalJson, contentHash } from "../../guardrails/src/approval";

import type { Artifact } from "./artifact";

/**
 * The exact projection that is hashed. Split out from `artifactHash` and
 * exported so a test can assert the field set instead of hoping, and so a
 * reviewer adding a field to `Artifact` has to decide, here, whether it is
 * something a human approves.
 */
export interface HashedArtifactShape {
  readonly id: string;
  readonly kind: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly files: readonly { readonly path: string; readonly text: string }[];
}

export const HASHED_ARTIFACT_FIELDS = Object.freeze([
  "id",
  "kind",
  "version",
  "capabilities",
  "files",
]) as readonly (keyof HashedArtifactShape)[];

export function hashedShape(artifact: Artifact): HashedArtifactShape {
  return {
    id: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    // Sorted: a manifest that declares the same two scopes in the other order
    // is the same consent screen, and re-approving over a reordering would
    // train operators to click through re-approvals.
    capabilities: [...artifact.capabilities].sort(),
    files: [...artifact.files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => ({ path: f.path, text: f.text })),
  };
}

/**
 * Bare lowercase sha256 hex. Satisfies `approvals`' `CONTENT_HASH_RE`, which is
 * what lets a registry entry's hash be handed straight to `effectiveGrant()`
 * without a second spelling of the same digest.
 */
export function artifactHash(artifact: Artifact): string {
  return contentHash(hashedShape(artifact));
}
