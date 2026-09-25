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
 * The host's own RUNTIME ARTIFACTS: tracked (or, for brain-lint, new) files
 * the running OS and its test suites rewrite, so the host gate (step 5) leaves
 * them changed in the sandbox. They are the host's bookkeeping, not the
 * candidate's, and they are the ONLY paths the seal sets aside when it looks
 * for host changes made after step 3b. Each is matched exactly, one path
 * segment at a time — no prefix match, so `app/BRAIN-INDEX.md.bak` or a
 * nested `audit/x/y.jsonl` is NOT a runtime artifact and refuses the seal.
 * (The same list the Flightdeck repo keeps out of every commit.)
 */
const HOST_RUNTIME_ARTIFACTS: readonly RegExp[] = [
  /^app\/BRAIN-INDEX\.md$/,
  /^app\/skills-index\.json$/,
  /^audit\/[^/]+\.jsonl$/,
  /^subapps\.json$/,
  /^memory\/proposals\/brain-lint-[^/]+\.md$/,
];

export function isHostRuntimeArtifact(repoPath: string): boolean {
  return HOST_RUNTIME_ARTIFACTS.some((re) => re.test(repoPath));
}

export type RehashProblemCode =
  | "tree-hash-mismatch"
  | "host-file-hash-mismatch"
  | "host-file-changed-after-subject"
  | "symlink-in-app-dir"
  | "not-a-git-sandbox"
  | "sandbox-head-moved";

/**
 * Re-checks, at the seal, a subject derived EARLIER from the same sandbox and
 * names what moved. promote.sh derives the subject right after mounting, runs
 * the build and the host gate, and only then seals the sidecar; this is how
 * the seal knows the candidate it names is still the candidate that was gated.
 *
 * - the app tree is re-hashed, and each listed host file too;
 * - the host CHANGE SET is re-discovered with `git status` against the host
 *   commit, exactly as at step 3b: a path outside the app dir (and codegen's
 *   journal) that is not a listed host file and not one of the host's named
 *   runtime artifacts means something changed the host after the subject was
 *   taken — a build, a test, a concurrent edit — and the seal refuses. (Before
 *   review round 2 only the saved list was re-hashed, so a host file that was
 *   unchanged at step 3b and edited during the gate was never looked at.)
 *
 * - the sandbox HEAD must still be `hostHead`, the commit captured with the
 *   subject, and the change set is taken against THAT commit: a host edit
 *   committed inside the sandbox after step 3b would otherwise drop out of
 *   `git status` (which compares with the current HEAD) and the seal would
 *   name a host commit that is not what was gated (review round 3).
 *
 * ⛔ FAILS CLOSED: a sandbox whose git status or HEAD cannot be read is a problem.
 */
export function rehashSubject(
  rootIn: string,
  subject: ProvenanceSubject,
  hostHead: string,
): { code: RehashProblemCode; path?: string }[] {
  const root = fs.realpathSync(rootIn);
  const out: { code: RehashProblemCode; path?: string }[] = [];
  const appDir = appDirOf(subject.subappId);
  const files: FileDigest[] = [];
  const problems: SubjectProblem[] = [];
  if (fs.existsSync(path.join(root, appDir))) walk(path.join(root, appDir), "", files, problems, appDir);
  for (const p of problems) out.push({ code: "symlink-in-app-dir", ...(p.path === undefined ? {} : { path: p.path }) });
  if (problems.length === 0 && treeSha256(files) !== subject.treeSha256) out.push({ code: "tree-hash-mismatch" });
  const listed = new Set<string>();
  for (const file of subject.hostFiles) {
    listed.add(file.path);
    const abs = path.join(root, file.path);
    const now = fs.existsSync(abs) && fs.lstatSync(abs).isFile() ? sha256Hex(fs.readFileSync(abs)) : null;
    if (now !== file.sha256) out.push({ code: "host-file-hash-mismatch", path: file.path });
  }

  const top = git(root, ["rev-parse", "--show-toplevel"]);
  const status = top.ok && fs.realpathSync(top.stdout.trim()) === root
    ? git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"])
    : { ok: false, stdout: "", stderr: `${rootIn} is not the top level of a git checkout` };
  if (!status.ok) {
    out.push({ code: "not-a-git-sandbox" });
    return out;
  }
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const headNow = head.ok ? head.stdout.trim() : null;
  const changed = new Set<string>();
  if (headNow !== hostHead) {
    out.push({ code: "sandbox-head-moved" });
    // Whatever was committed since the captured host commit is a change too.
    const committed = headNow === null || !/^[0-9a-f]{40}$/.test(hostHead)
      ? { ok: false, stdout: "", stderr: "" }
      : git(root, ["diff", "--name-only", "-z", "--no-renames", hostHead, headNow, "--"]);
    if (!committed.ok) {
      out.push({ code: "not-a-git-sandbox" });
      return out;
    }
    for (const p of committed.stdout.split("\0")) if (p.length > 0) changed.add(p);
  }
  for (const entry of status.stdout.split("\0")) {
    if (entry.length < 4) continue;
    changed.add(entry.slice(3));
  }
  for (const p of changed) {
    if (p.startsWith(`${appDir}/`) || p.startsWith(CODEGEN_JOURNAL_PREFIX)) continue;
    if (listed.has(p) || isHostRuntimeArtifact(p)) continue;
    out.push({ code: "host-file-changed-after-subject", path: p });
  }
  return out;
}
