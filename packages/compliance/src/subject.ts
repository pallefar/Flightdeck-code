/**
 * Reads a promote sandbox and derives the provenance SUBJECT from it.
 *
 * The sandbox (`scripts/sandbox-lib.sh`) is a git repo holding the host's
 * HEAD as one commit, with the candidate mounted into `flightdeck/`. So what
 * the candidate changed is exactly what `git status` reports against that
 * commit — no guessing, no list the candidate supplies about itself:
 *
 * - everything under the app dir is covered by the tree hash, which walks
 *   the directory on disk (tracked or not) and leaves out only the root
 *   `PROVENANCE.json`;
 * - every other changed path is a HOST FILE. It must be one codegen declared
 *   (`declaredHostFiles`), and it is listed with its sha256;
 * - codegen's own journal (`flightdeck/.flightdeck-codegen/`) is Studio's
 *   bookkeeping, not part of the candidate, and is the one path set aside.
 *
 * ⛔ FAILS CLOSED. An undeclared host change, a deleted host file, a symlink
 * anywhere in what would be hashed, or a sandbox that is not a git checkout
 * is a PROBLEM, and there is no subject — the caller writes no sidecar.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { HOST_APP_ROOT, appDirOf, checkSubject, sha256Hex, treeSha256, type FileDigest, type ProvenanceSubject } from "./provenance";

/** codegen's `apply.ts#JOURNAL_DIR`, as it sits in the sandbox. Pinned against it in the test. */
export const CODEGEN_JOURNAL_PREFIX = `${HOST_APP_ROOT}/.flightdeck-codegen/`;

export type SubjectProblemCode =
  | "not-a-git-sandbox"
  | "app-dir-missing"
  | "symlink-in-app-dir"
  | "host-file-undeclared"
  | "host-file-deleted"
  | "host-file-not-regular";

export interface SubjectProblem {
  readonly code: SubjectProblemCode;
  readonly path?: string;
  readonly detail: string;
}

export interface DeriveSubjectOptions {
  /** The sandbox root: the git top level that holds `flightdeck/`. */
  readonly root: string;
  readonly subappId: string;
  readonly version: string;
  /** Repo-root relative paths codegen may change outside the app dir. */
  readonly declaredHostFiles: readonly string[];
}

export type SubjectDerivation =
  | { readonly ok: true; readonly subject: ProvenanceSubject; readonly hostHead: string }
  | { readonly ok: false; readonly problems: readonly SubjectProblem[] };

function git(root: string, args: readonly string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Walks `dir`, returning every regular file relative to it; symlinks are problems, never followed. */
function walk(dir: string, rel: string, files: FileDigest[], problems: SubjectProblem[], appDir: string): void {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    const abs = path.join(dir, childRel);
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) {
      problems.push({ code: "symlink-in-app-dir", path: `${appDir}/${childRel}`, detail: "a symlink in the app dir is refused, never followed" });
    } else if (stat.isDirectory()) {
      walk(dir, childRel, files, problems, appDir);
    } else if (stat.isFile()) {
      files.push({ path: childRel, sha256: sha256Hex(fs.readFileSync(abs)) });
    } else {
      problems.push({ code: "symlink-in-app-dir", path: `${appDir}/${childRel}`, detail: "not a regular file" });
    }
  }
}

export function deriveSubject(options: DeriveSubjectOptions): SubjectDerivation {
  const root = fs.realpathSync(options.root);
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!top.ok || !head.ok || fs.realpathSync(top.stdout.trim()) !== root) {
    return { ok: false, problems: [{ code: "not-a-git-sandbox", detail: `${options.root} is not the top level of a git checkout with a HEAD` }] };
  }

  const problems: SubjectProblem[] = [];
  const appDir = appDirOf(options.subappId);
  const appAbs = path.join(root, appDir);
  const treeFiles: FileDigest[] = [];
  if (!fs.existsSync(appAbs) || !fs.lstatSync(appAbs).isDirectory()) {
    problems.push({ code: "app-dir-missing", path: appDir, detail: "the candidate's app dir is not in the sandbox" });
  } else {
    walk(appAbs, "", treeFiles, problems, appDir);
  }

  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]);
  if (!status.ok) {
    return { ok: false, problems: [{ code: "not-a-git-sandbox", detail: `git status failed: ${status.stderr.trim()}` }] };
  }
  const declared = new Set(options.declaredHostFiles);
  const hostFiles: FileDigest[] = [];
  for (const entry of status.stdout.split("\0")) {
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const p = entry.slice(3);
    if (p.startsWith(`${appDir}/`) || p.startsWith(CODEGEN_JOURNAL_PREFIX)) continue;
    if (xy.includes("D")) {
      problems.push({ code: "host-file-deleted", path: p, detail: "the candidate deletes a host file; codegen never deletes" });
      continue;
    }
    if (!declared.has(p)) {
      problems.push({ code: "host-file-undeclared", path: p, detail: "changed outside the app dir, and codegen did not declare it" });
      continue;
    }
    const abs = path.join(root, p);
    const stat = fs.lstatSync(abs);
    if (!stat.isFile()) {
      problems.push({ code: "host-file-not-regular", path: p, detail: "a declared host file is a symlink or not a file" });
      continue;
    }
    hostFiles.push({ path: p, sha256: sha256Hex(fs.readFileSync(abs)) });
  }

  if (problems.length > 0) return { ok: false, problems };
  const subject = checkSubject({
    subappId: options.subappId,
    version: options.version,
    treeSha256: treeSha256(treeFiles),
    hostFiles,
  });
  return { ok: true, subject, hostHead: head.stdout.trim() };
}

/**
 * Re-hashes a subject derived EARLIER from the same sandbox — the app tree
 * and each listed host file — and names what moved. promote.sh derives the
 * subject right after mounting, runs the build and the host gate, and only
 * then seals the sidecar; this is how the seal knows the candidate it names
 * is still the candidate that was gated. (It does not re-run `git status`:
 * the gate leaves its own runtime files behind, which are not the candidate's.)
 */
export function rehashSubject(rootIn: string, subject: ProvenanceSubject): { code: "tree-hash-mismatch" | "host-file-hash-mismatch" | "symlink-in-app-dir"; path?: string }[] {
  const root = fs.realpathSync(rootIn);
  const out: { code: "tree-hash-mismatch" | "host-file-hash-mismatch" | "symlink-in-app-dir"; path?: string }[] = [];
  const appDir = appDirOf(subject.subappId);
  const files: FileDigest[] = [];
  const problems: SubjectProblem[] = [];
  if (fs.existsSync(path.join(root, appDir))) walk(path.join(root, appDir), "", files, problems, appDir);
  for (const p of problems) out.push({ code: "symlink-in-app-dir", ...(p.path === undefined ? {} : { path: p.path }) });
  if (problems.length === 0 && treeSha256(files) !== subject.treeSha256) out.push({ code: "tree-hash-mismatch" });
  for (const file of subject.hostFiles) {
    const abs = path.join(root, file.path);
    const now = fs.existsSync(abs) && fs.lstatSync(abs).isFile() ? sha256Hex(fs.readFileSync(abs)) : null;
    if (now !== file.sha256) out.push({ code: "host-file-hash-mismatch", path: file.path });
  }
  return out;
}
