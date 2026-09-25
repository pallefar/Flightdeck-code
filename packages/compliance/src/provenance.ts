/**
 * ⭐ THE PROVENANCE SIDECAR — `studio-provenance/1` (upd-studio-provenance).
 *
 * What a promoted candidate says about where it came from: which compliance
 * record certified it (by digest), which Studio commit generated it, which
 * host commit it was gated against, which approved catalogue entry it was
 * built from (null until the section catalogue exists, sdk-86), and WHAT it
 * is — the subject.
 *
 * ── WHY A SIDECAR AND NOT A MANIFEST FIELD ──────────────────────────────
 * A manifest field makes the tree hash self-referential: the hash would have
 * to cover the file that states it. So the provenance is its own file,
 * `<app dir>/PROVENANCE.json`, the subject tree hash EXCLUDES exactly that
 * file, and the generated manifest carries no provenance at all (pinned in
 * `__tests__/provenance.test.ts`, in step with apps-49's manifest rules).
 *
 * ── WHY HOST FILES ARE LISTED ───────────────────────────────────────────
 * A candidate is more than its app dir: codegen also writes the web module,
 * the host test and a patch to `server/subapps/registry.ts`. A hash over the
 * app dir alone leaves every one of those uncovered. So each changed host
 * file outside the app dir is listed with its sha256, and a changed host
 * file codegen did not declare refuses the subject (`subject.ts`).
 *
 * This file is pure: it shapes and checks. Reading the sandbox is
 * `subject.ts`; the command is `provenance-cli.ts`.
 */
import { createHash } from "node:crypto";

import { canonicalize } from "./jcs";
import { recordDigest } from "./record";

export const PROVENANCE_SCHEMA = "studio-provenance/1";
/** The sidecar's name, at the root of the app dir. */
export const PROVENANCE_FILE = "PROVENANCE.json";
/** The schema tag inside the tree-hash preimage, so a future layout cannot collide with this one. */
export const TREE_SCHEMA = "studio-tree/1";
/** The host checkout's subdirectory that codegen's paths are relative to. */
export const HOST_APP_ROOT = "flightdeck";

const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const SUBAPP_ID_RE = /^[a-z][a-z0-9-]*$/;
const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(`provenance: ${message}`);
    this.name = "ProvenanceError";
  }
}

export interface FileDigest {
  /** POSIX, relative, no `.`/`..` segments. */
  readonly path: string;
  readonly sha256: string;
}

export interface ProvenanceSubject {
  readonly subappId: string;
  readonly version: string;
  /** Over the app dir, EXCLUDING the root `PROVENANCE.json`. */
  readonly treeSha256: string;
  /** Every changed host file outside the app dir, repo-root relative, sorted. */
  readonly hostFiles: readonly FileDigest[];
}

export interface Provenance {
  readonly schema: typeof PROVENANCE_SCHEMA;
  readonly recordSha256: string;
  /** 40-hex, or `<40-hex>-dirty` when the Studio checkout had local changes. */
  readonly studioCommit: string;
  readonly hostHead: string;
  readonly catalogueEntryId: string | null;
  readonly subject: ProvenanceSubject;
}

export function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The server-side app dir codegen writes, repo-root relative. */
export function appDirOf(subappId: string): string {
  return `${HOST_APP_ROOT}/server/subapps/${subappId}`;
}

function checkRelativePath(p: string, what: string): void {
  if (p.length === 0 || p.startsWith("/") || p.includes("\\") || p.includes("\0")) {
    throw new ProvenanceError(`${what} "${p}" is not a relative POSIX path`);
  }
  if (p.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new ProvenanceError(`${what} "${p}" has an empty, "." or ".." segment`);
  }
}

function checkDigests(files: readonly FileDigest[], what: string): FileDigest[] {
  const seen = new Set<string>();
  for (const file of files) {
    checkRelativePath(file.path, what);
    if (!SHA256_RE.test(file.sha256)) throw new ProvenanceError(`${what} "${file.path}" has no sha256`);
    if (seen.has(file.path)) throw new ProvenanceError(`${what} "${file.path}" is listed twice`);
    seen.add(file.path);
  }
  return [...files].map((f) => ({ path: f.path, sha256: f.sha256 })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The subject tree hash: sha256 of the JCS text of
 * `{schema: "studio-tree/1", files: [{path, sha256}, …]}`, files sorted by
 * path, paths relative to the app dir. The ROOT `PROVENANCE.json` is left
 * out — and only that one: a file of the same name deeper in the tree is
 * content like any other.
 */
export function treeSha256(files: readonly FileDigest[]): string {
  const kept = checkDigests(files, "tree file").filter((f) => f.path !== PROVENANCE_FILE);
  return sha256Hex(canonicalize({ schema: TREE_SCHEMA, files: kept }));
}

/**
 * The host files codegen DECLARES for a candidate: every emitted host-target
 * file outside the app dir, plus `registry.ts` (the patch codegen emits is
 * applied to it; the `.patch` file itself never lands). Takes codegen's file
 * list by shape so this package does not import codegen.
 */
export function declaredHostFiles(files: readonly { readonly path: string; readonly kind: string }[]): string[] {
  const out = new Set<string>([`${HOST_APP_ROOT}/server/subapps/registry.ts`]);
  for (const file of files) {
    if (file.kind === "standalone" || file.kind === "patch") continue;
    out.add(`${HOST_APP_ROOT}/${file.path}`);
  }
  return [...out].sort();
}

export type SubjectMismatchCode =
  | "subapp-mismatch"
  | "version-mismatch"
  | "tree-hash-mismatch"
  | "host-file-unlisted"
  | "host-file-hash-mismatch"
  | "host-file-not-changed";

export interface SubjectMismatch {
  readonly code: SubjectMismatchCode;
  readonly path?: string;
}

/**
 * A CLAIMED subject (from a sidecar) against one RE-DERIVED from the tree.
 * Empty means they agree. Order: identity, tree, then host files by path —
 * a changed host file the claim does not list first, since that is the gap
 * this sidecar exists to close.
 */
export function compareSubject(claimed: ProvenanceSubject, derived: ProvenanceSubject): SubjectMismatch[] {
  const out: SubjectMismatch[] = [];
  if (claimed.subappId !== derived.subappId) out.push({ code: "subapp-mismatch" });
  if (claimed.version !== derived.version) out.push({ code: "version-mismatch" });
  if (claimed.treeSha256 !== derived.treeSha256) out.push({ code: "tree-hash-mismatch" });
  const listed = new Map(claimed.hostFiles.map((f) => [f.path, f.sha256]));
  const actual = new Map(derived.hostFiles.map((f) => [f.path, f.sha256]));
  for (const [p] of actual) if (!listed.has(p)) out.push({ code: "host-file-unlisted", path: p });
  for (const [p, h] of actual) if (listed.has(p) && listed.get(p) !== h) out.push({ code: "host-file-hash-mismatch", path: p });
  for (const [p] of listed) if (!actual.has(p)) out.push({ code: "host-file-not-changed", path: p });
  return out;
}

export function checkSubject(subject: ProvenanceSubject): ProvenanceSubject {
  if (!SUBAPP_ID_RE.test(subject.subappId)) throw new ProvenanceError(`subappId "${subject.subappId}" is not a sub-app id`);
  if (!VERSION_RE.test(subject.version)) throw new ProvenanceError(`version "${subject.version}" is not x.y.z`);
  if (!SHA256_RE.test(subject.treeSha256)) throw new ProvenanceError("subject.treeSha256 is not a sha256");
  return {
    subappId: subject.subappId,
    version: subject.version,
    treeSha256: subject.treeSha256,
    hostFiles: checkDigests(subject.hostFiles, "host file"),
  };
}

export interface BuildProvenanceInput {
  /** The parsed `studio-compliance-record/1`. Digested, not admitted: the admission side recomputes its verdict. */
  readonly record: unknown;
  readonly studioCommit: string;
  readonly hostHead: string;
  readonly catalogueEntryId: string | null;
  readonly subject: ProvenanceSubject;
}

/** Shapes and validates a sidecar. Throws rather than writing a field it cannot vouch for. */
export function buildProvenance(input: BuildProvenanceInput): Provenance {
  const recordSha256 = recordDigest(input.record);
  const commit = input.studioCommit.endsWith("-dirty") ? input.studioCommit.slice(0, -"-dirty".length) : input.studioCommit;
  if (!COMMIT_RE.test(commit)) throw new ProvenanceError(`studioCommit "${input.studioCommit}" is not a full commit sha`);
  // The host head is what the sandbox was built from — a commit, never a dirty tree
  // (scripts/sandbox-lib.sh certifies a commit, not uncommitted host edits).
  if (!COMMIT_RE.test(input.hostHead)) throw new ProvenanceError(`hostHead "${input.hostHead}" is not a full commit sha`);
  if (input.catalogueEntryId !== null && input.catalogueEntryId.trim().length === 0) {
    throw new ProvenanceError("catalogueEntryId is empty; pass null when the spec came from no catalogue entry");
  }
  return {
    schema: PROVENANCE_SCHEMA,
    recordSha256,
    studioCommit: input.studioCommit,
    hostHead: input.hostHead,
    catalogueEntryId: input.catalogueEntryId,
    subject: checkSubject(input.subject),
  };
}
