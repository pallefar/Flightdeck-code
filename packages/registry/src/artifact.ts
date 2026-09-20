/**
 * The thing being proposed: a mini-app or a script.
 *
 * The user's requirement is one sentence — "when a new tool is created let's
 * get it approved and then it is used for future projects, same for any scripts
 * etc that can be scaled" — and the word doing the work is "same". A script is
 * not a lesser artifact with a shorter path through the gate; it is the same
 * artifact with a different `kind`. So `kind` is a field on ONE record rather
 * than the discriminant of two parallel ledgers, and every refusal in
 * `ledger.ts` applies to both.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE THE TWO KINDS GENUINELY DIVERGE, AND IT IS EXACTLY ONE PLACE
 * ─────────────────────────────────────────────────────────────────────────
 * `subapps.json#installs[]` is the host's SUB-APP install ledger. The host
 * looks every entry up with `getManifest(id)` and 404s an id that is not in
 * `SUBAPP_MANIFESTS` (`installRoutes.ts`, both the enable and disable routes),
 * so writing a script into `installs` would put a permanently unresolvable row
 * in a host file. Scripts therefore live in the Studio ledger and in its
 * history, and `emit.ts` filters them out of the host projection — see the
 * comment there, and the test that holds it.
 *
 * That is the ONLY divergence. A script is proposed, approved by a named human,
 * registered, enabled per project and superseded on content change through the
 * same code path as a mini-app.
 */

import type { Capability } from "../../spec/src/vocabulary";

/**
 * ⛔ WIDENING IS A CONSENT DECISION. A third kind would need its own answer to
 * "does this belong in the host's `installs`" before it could be added — the
 * projection in `emit.ts` switches on this list, not on a truthiness test.
 */
export const ARTIFACT_KINDS = ["mini-app", "script"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** Only kinds the host's sub-app machinery can resolve to a manifest. */
export const HOST_INSTALLABLE_KINDS: readonly ArtifactKind[] = Object.freeze(["mini-app"]);

export function isHostInstallable(kind: ArtifactKind): boolean {
  return HOST_INSTALLABLE_KINDS.includes(kind);
}

/**
 * One emitted file. `text` deliberately, not bytes: every Studio emitter
 * produces text (`packages/codegen/src/emit.ts`), and a digest over a union
 * would have to canonicalize two representations of the same content — two
 * answers to "did this change".
 */
export interface ArtifactFile {
  /** Repo-relative, exactly as the emitters named it. Never absolute. */
  readonly path: string;
  readonly text: string;
}

/**
 * ⭐ A SEMVER-ISH VERSION, NOT A SEMVER. The host's `subAppManifestSchema`
 * declares `version: z.string()` with no pattern (`server/subapps/types.ts`),
 * and `subapps.json` carries `"0.1.0"` as a plain string. This package
 * therefore requires only "a non-empty label with no whitespace" — inventing a
 * stricter rule than the host's would refuse artifacts the host accepts, which
 * is the wrong direction for a gate that sits in front of it.
 */
export const ARTIFACT_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

export interface Artifact {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly version: string;
  /**
   * The declared scope set — the human consent screen (contract §5.9). `[]` is
   * valid and common: an audit-append-only mini-app declares none, and a script
   * that touches nothing declares none.
   */
  readonly capabilities: readonly Capability[];
  /** At least one. An artifact with no content is not a thing to approve. */
  readonly files: readonly ArtifactFile[];
}

export type { Capability };
