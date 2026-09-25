/**
 * The provenance SIDECAR (upd-studio-provenance).
 *
 * What the critique found, and what each block below pins:
 *
 * 1. Provenance inside the manifest makes the tree hash self-referential: the
 *    hash would cover the file that states the hash. So provenance is a
 *    sidecar, `<app dir>/PROVENANCE.json`, the subject tree hash EXCLUDES it,
 *    and the generated manifest carries none of it.
 * 2. A hash over the app directory alone says nothing about the host files a
 *    candidate patches outside it (`registry.ts`, the web module, the host
 *    test). Those are listed, each with its sha256 — and a changed host file
 *    that codegen did not declare fails the subject step (promote's dry run)
 *    instead of riding along uncovered.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { JOURNAL_DIR } from "../../../codegen/src/apply";
import { generateSubApp } from "../../../codegen/src/generate";
import {
  PROVENANCE_FILE,
  PROVENANCE_SCHEMA,
  ProvenanceError,
  buildProvenance,
  compareSubject,
  declaredHostFiles,
  treeSha256,
  type ProvenanceSubject,
} from "../provenance";
import { recordDigest } from "../record";
import { CODEGEN_JOURNAL_PREFIX, deriveSubject, isHostRuntimeArtifact, rehashSubject } from "../subject";

const STUDIO = path.resolve(__dirname, "..", "..", "..", "..");
const SPEC_PATH = path.join(STUDIO, "fixtures", "wc-clock.spec.json");
const SPEC = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8")) as unknown;
const CLI = path.join(STUDIO, "packages", "compliance", "src", "provenance-cli.ts");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-provenance-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args], { cwd, encoding: "utf8" });

const REGISTRY = [
  'import type { SubAppManifest } from "./types.js";',
  "",
  "export const SUBAPP_MANIFESTS: SubAppManifest[] = [",
  "];",
  "",
].join("\n");

/**
 * A sandbox shaped like promote.sh's: a git repo holding the host's HEAD as
 * one commit, with the candidate then written into `flightdeck/` exactly as
 * codegen + `patch -p1` leave it (host target only — never the standalone
 * harness), and codegen's journal beside it.
 */
function sandbox(name: string): string {
  const root = path.join(tmp, name);
  const fd = path.join(root, "flightdeck");
  fs.mkdirSync(path.join(fd, "server", "subapps"), { recursive: true });
  fs.writeFileSync(path.join(fd, "server", "subapps", "registry.ts"), REGISTRY);
  fs.writeFileSync(path.join(fd, "server", "index.ts"), "export const boot = 1;\n");
  git(root, "init", "-q");
  git(root, "add", "flightdeck");
  git(root, "commit", "-q", "--no-gpg-sign", "-m", "host HEAD");

  const generated = generateSubApp(SPEC);
  for (const file of generated.files) {
    if (file.kind === "standalone" || file.kind === "patch") continue;
    const at = path.join(fd, file.path);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, file.contents);
  }
  // What `patch -p1 <registry.ts.patch` leaves behind: a modified registry.
  fs.writeFileSync(
    path.join(fd, "server", "subapps", "registry.ts"),
    REGISTRY.replace("= [\n", "= [\n  wcClockManifest,\n"),
  );
  fs.mkdirSync(path.join(fd, JOURNAL_DIR), { recursive: true });
  fs.writeFileSync(path.join(fd, JOURNAL_DIR, "wc-clock.json"), "{}\n");
  return root;
}

const declared = () => declaredHostFiles(generateSubApp(SPEC).files);
const derive = (root: string) => deriveSubject({ root, subappId: "wc-clock", version: "0.1.0", declaredHostFiles: declared() });
const headOf = (root: string): string => git(root, "rev-parse", "HEAD").stdout.trim();
const subjectOf = (root: string): ProvenanceSubject => {
  const result = derive(root);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.subject;
};

describe("the subject tree hash", () => {
  it("⭐ is stable when only PROVENANCE.json changes — the sidecar is not part of what it describes", () => {
    const root = sandbox("tree-stable");
    const before = subjectOf(root).treeSha256;
    const sidecar = path.join(root, "flightdeck", "server", "subapps", "wc-clock", PROVENANCE_FILE);
    fs.writeFileSync(sidecar, '{"schema":"studio-provenance/1"}\n');
    expect(subjectOf(root).treeSha256).toBe(before);
    fs.writeFileSync(sidecar, '{"schema":"studio-provenance/1","changed":true}\n');
    expect(subjectOf(root).treeSha256).toBe(before);
  });

  it("changes when any other file in the app dir changes, including a new one", () => {
    const root = sandbox("tree-moves");
    const before = subjectOf(root).treeSha256;
    const guard = path.join(root, "flightdeck", "server", "subapps", "wc-clock", "guard.ts");
    fs.appendFileSync(guard, "// edited\n");
    const edited = subjectOf(root).treeSha256;
    expect(edited).not.toBe(before);
    fs.writeFileSync(path.join(root, "flightdeck", "server", "subapps", "wc-clock", "extra.ts"), "export {};\n");
    expect(subjectOf(root).treeSha256).not.toBe(edited);
  });

  it("excludes only the ROOT sidecar: a PROVENANCE.json deeper in the tree is ordinary content", () => {
    const base = [{ path: "manifest.ts", sha256: sha("m") }];
    expect(treeSha256([...base, { path: PROVENANCE_FILE, sha256: sha("x") }])).toBe(treeSha256(base));
    expect(treeSha256([...base, { path: `routes/${PROVENANCE_FILE}`, sha256: sha("x") }])).not.toBe(treeSha256(base));
  });

  it("does not depend on listing order, and refuses a duplicate or an escaping path", () => {
    const a = { path: "a.ts", sha256: sha("a") };
    const b = { path: "b/c.ts", sha256: sha("b") };
    expect(treeSha256([a, b])).toBe(treeSha256([b, a]));
    expect(() => treeSha256([a, a])).toThrow(ProvenanceError);
    expect(() => treeSha256([{ path: "../x.ts", sha256: sha("x") }])).toThrow(ProvenanceError);
    expect(() => treeSha256([{ path: "/abs.ts", sha256: sha("x") }])).toThrow(ProvenanceError);
  });

  it("refuses a symlink in the app dir rather than hashing whatever it points at", () => {
    const root = sandbox("tree-symlink");
    fs.symlinkSync("/etc/hosts", path.join(root, "flightdeck", "server", "subapps", "wc-clock", "link.ts"));
    const result = derive(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toContain("symlink-in-app-dir");
  });
});

describe("host files outside the app dir", () => {
  it("⭐ are listed with their sha256: the registry patch, the web module and the host test", () => {
    const root = sandbox("host-listed");
    const subject = subjectOf(root);
    const fd = path.join(root, "flightdeck");
    const paths = subject.hostFiles.map((f) => f.path);
    expect(paths).toEqual([
      "flightdeck/server/subapps/registry.ts",
      "flightdeck/tests/subapps/wc-clock/wcClockConformance.test.ts",
      "flightdeck/web/src/subapps/wc-clock/index.tsx",
    ]);
    for (const file of subject.hostFiles) {
      expect(file.sha256).toBe(sha(fs.readFileSync(path.join(root, file.path), "utf8")));
    }
    // Nothing from inside the app dir is double-listed, and codegen's journal is not a host file.
    expect(paths.some((p) => p.startsWith("flightdeck/server/subapps/wc-clock/"))).toBe(false);
    expect(CODEGEN_JOURNAL_PREFIX).toBe(`flightdeck/${JOURNAL_DIR}/`);
    expect(paths.some((p) => p.startsWith(CODEGEN_JOURNAL_PREFIX))).toBe(false);
    expect(fs.existsSync(path.join(fd, "server", "subapps", "wc-clock", "manifest.ts"))).toBe(true);
  });

  it("⭐ a host patch codegen did not declare fails the subject step, naming the file", () => {
    const root = sandbox("host-undeclared");
    fs.appendFileSync(path.join(root, "flightdeck", "server", "index.ts"), "export const sneaky = 1;\n");
    const result = derive(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual([
      expect.objectContaining({ code: "host-file-undeclared", path: "flightdeck/server/index.ts" }),
    ]);
  });

  it("a deleted host file fails too — codegen never deletes, so a deletion is not the candidate's", () => {
    const root = sandbox("host-deleted");
    fs.rmSync(path.join(root, "flightdeck", "server", "index.ts"));
    const result = derive(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.code)).toEqual(["host-file-deleted"]);
  });

  it("the dry run (CLI `subject --dry-run`) exits 0 on a clean candidate and non-zero on an unlisted host patch", () => {
    const clean = sandbox("cli-clean");
    const ok = spawnSync("npx", ["tsx", CLI, "subject", "--sandbox", clean, "--spec", SPEC_PATH, "--dry-run"], {
      cwd: STUDIO,
      encoding: "utf8",
    });
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("flightdeck/server/subapps/registry.ts");

    const dirty = sandbox("cli-dirty");
    fs.appendFileSync(path.join(dirty, "flightdeck", "server", "index.ts"), "export const sneaky = 1;\n");
    const bad = spawnSync("npx", ["tsx", CLI, "subject", "--sandbox", dirty, "--spec", SPEC_PATH, "--dry-run"], {
      cwd: STUDIO,
      encoding: "utf8",
    });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("flightdeck/server/index.ts");
    expect(bad.stderr).toContain("host-file-undeclared");
  });
});

describe("compareSubject — how a claimed subject is checked against a re-derived one", () => {
  it("names an unlisted host file, a hash that moved, a listed file that is not changed, and a moved tree", () => {
    const root = sandbox("compare");
    const derived = subjectOf(root);
    const [first, ...rest] = derived.hostFiles;
    expect(first).toBeDefined();
    const claimed: ProvenanceSubject = {
      ...derived,
      treeSha256: sha("not the tree"),
      hostFiles: [
        ...rest.map((f, i) => (i === 0 ? { ...f, sha256: sha("moved") } : f)),
        { path: "flightdeck/server/other.ts", sha256: sha("o") },
      ],
    };
    const codes = compareSubject(claimed, derived).map((m) => `${m.code}${m.path === undefined ? "" : ` ${m.path}`}`);
    expect(codes).toEqual([
      "tree-hash-mismatch",
      `host-file-unlisted ${first!.path}`,
      `host-file-hash-mismatch ${rest[0]!.path}`,
      "host-file-not-changed flightdeck/server/other.ts",
    ]);
    expect(compareSubject(derived, derived)).toEqual([]);
  });
});

describe("buildProvenance", () => {
  const record = {
    schema: "studio-compliance-record/1",
    at: "2026-09-20T09:00:00Z",
    specSha256: sha("spec"),
    passed: ["host-gate"],
    failed: [],
    skipped: [],
    readyForProduction: true,
  };
  const subject: ProvenanceSubject = {
    subappId: "wc-clock",
    version: "0.1.0",
    treeSha256: sha("tree"),
    hostFiles: [{ path: "flightdeck/server/subapps/registry.ts", sha256: sha("r") }],
  };
  const COMMIT = "0d230f2a".padEnd(40, "0");

  it("⭐ has exactly the studio-provenance/1 shape, bound to the record by its JCS digest", () => {
    const p = buildProvenance({ record, studioCommit: COMMIT, hostHead: COMMIT, catalogueEntryId: null, subject });
    expect(p).toEqual({
      schema: PROVENANCE_SCHEMA,
      recordSha256: recordDigest(record),
      studioCommit: COMMIT,
      hostHead: COMMIT,
      catalogueEntryId: null,
      subject,
    });
    expect(PROVENANCE_SCHEMA).toBe("studio-provenance/1");
  });

  it("records a dirty Studio tree as <sha>-dirty rather than claiming a commit that did not run", () => {
    expect(
      buildProvenance({ record, studioCommit: `${COMMIT}-dirty`, hostHead: COMMIT, catalogueEntryId: "triage-summary@2", subject })
        .studioCommit,
    ).toBe(`${COMMIT}-dirty`);
  });

  it("refuses a malformed commit, host head, hash or subject instead of writing it", () => {
    const base = { record, studioCommit: COMMIT, hostHead: COMMIT, catalogueEntryId: null, subject };
    expect(() => buildProvenance({ ...base, hostHead: "HEAD" })).toThrow(ProvenanceError);
    expect(() => buildProvenance({ ...base, hostHead: `${COMMIT}-dirty` })).toThrow(ProvenanceError);
    expect(() => buildProvenance({ ...base, studioCommit: "" })).toThrow(ProvenanceError);
    expect(() => buildProvenance({ ...base, catalogueEntryId: "" })).toThrow(ProvenanceError);
    expect(() => buildProvenance({ ...base, subject: { ...subject, treeSha256: "abc" } })).toThrow(ProvenanceError);
    expect(() => buildProvenance({ ...base, subject: { ...subject, subappId: "Not An Id" } })).toThrow(ProvenanceError);
    expect(() => buildProvenance({ ...base, record: null })).toThrow();
  });
});

describe("the manifest carries no provenance (coordination with apps-49)", () => {
  it("⭐ the emitted manifest names no provenance, tree hash or record digest, and codegen never emits the sidecar", () => {
    const generated = generateSubApp(SPEC);
    const manifest = generated.files.find((f) => f.kind === "manifest");
    expect(manifest).toBeDefined();
    expect(manifest!.contents).not.toMatch(/provenance|treeSha256|recordSha256|studioCommit|hostHead/i);
    expect(generated.files.some((f) => path.posix.basename(f.path) === PROVENANCE_FILE)).toBe(false);
  });
});

/**
 * Review round 2. The seal (step 6) used to re-hash only the SAVED list of
 * host files, so a host source file that was unchanged at step 3b and changed
 * during the build or the host gate was never looked at. It now re-runs the
 * change discovery and refuses any new change outside the app dir, except the
 * host's own runtime artifacts, which are named one by one.
 */
describe("rehashSubject — the seal re-discovers host changes, not just the saved list", () => {
  it("⭐ a host file that was unchanged at step 3b and changed afterwards refuses the seal, naming it", () => {
    const root = sandbox("seal-late-edit");
    const subject = subjectOf(root);
    expect(rehashSubject(root, subject, headOf(root))).toEqual([]);
    fs.appendFileSync(path.join(root, "flightdeck", "server", "index.ts"), "export const late = 1;\n");
    expect(rehashSubject(root, subject, headOf(root))).toEqual([{ code: "host-file-changed-after-subject", path: "flightdeck/server/index.ts" }]);
  });

  it("a new untracked host file, or a deleted one, after step 3b refuses too", () => {
    const added = sandbox("seal-late-add");
    const s1 = subjectOf(added);
    fs.writeFileSync(path.join(added, "flightdeck", "server", "extra.ts"), "export {};\n");
    expect(rehashSubject(added, s1, headOf(added))).toEqual([{ code: "host-file-changed-after-subject", path: "flightdeck/server/extra.ts" }]);

    const deleted = sandbox("seal-late-delete");
    const s2 = subjectOf(deleted);
    fs.rmSync(path.join(deleted, "flightdeck", "server", "index.ts"));
    expect(rehashSubject(deleted, s2, headOf(deleted))).toEqual([{ code: "host-file-changed-after-subject", path: "flightdeck/server/index.ts" }]);
  });

  it("the host's own runtime artifacts, written by the gate, are named and set aside — nothing else is", () => {
    const root = sandbox("seal-runtime");
    const runtime = ["app/BRAIN-INDEX.md", "app/skills-index.json", "audit/os-audit.jsonl", "subapps.json"];
    for (const rel of runtime) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), "host HEAD\n");
    }
    git(root, "add", ...runtime);
    git(root, "commit", "-q", "--no-gpg-sign", "-m", "runtime artifacts at host HEAD");
    const subject = subjectOf(root);
    for (const rel of runtime) fs.appendFileSync(path.join(root, rel), "written by the gate\n");
    fs.mkdirSync(path.join(root, "memory", "proposals"), { recursive: true });
    fs.writeFileSync(path.join(root, "memory", "proposals", "brain-lint-2026-09-25.md"), "lint\n");
    expect(rehashSubject(root, subject, headOf(root))).toEqual([]);

    for (const p of [...runtime, "memory/proposals/brain-lint-2026-09-25.md"]) expect(isHostRuntimeArtifact(p)).toBe(true);
    for (const p of [
      "app/BRAIN-INDEX.md.bak",
      "app/data/status.js",
      "audit/AUDIT-2026-06-09.md",
      "audit/nested/x.jsonl",
      "flightdeck/subapps.json",
      "memory/proposals/other.md",
      "memory/proposals/brain-lint-x/y.md",
      "flightdeck/server/index.ts",
    ]) {
      expect(isHostRuntimeArtifact(p), p).toBe(false);
    }
  });

  it("⭐ a commit made inside the sandbox after step 3b refuses: the check is against the captured host commit", () => {
    // Review round 3: `git status` compares with the sandbox's CURRENT HEAD, so a host edit
    // committed there after the subject was taken vanished from it and the seal named the old head.
    const root = sandbox("seal-late-commit");
    const derived = derive(root);
    if (!derived.ok) throw new Error(JSON.stringify(derived));
    expect(rehashSubject(root, derived.subject, derived.hostHead)).toEqual([]);
    fs.appendFileSync(path.join(root, "flightdeck", "server", "index.ts"), "export const late = 1;\n");
    git(root, "add", "flightdeck/server/index.ts");
    git(root, "commit", "-q", "--no-gpg-sign", "-m", "late host edit, committed in the sandbox");
    expect(rehashSubject(root, derived.subject, derived.hostHead)).toEqual([
      { code: "sandbox-head-moved" },
      { code: "host-file-changed-after-subject", path: "flightdeck/server/index.ts" },
    ]);
  });

  it("a sandbox whose git status cannot be read refuses rather than sealing blind", () => {
    const root = sandbox("seal-no-git");
    const subject = subjectOf(root);
    fs.rmSync(path.join(root, ".git"), { recursive: true, force: true });
    expect(rehashSubject(root, subject, headOf(root)).map((m) => m.code)).toContain("not-a-git-sandbox");
  });
});

/**
 * Review round 2. The Studio identity was read only at seal time, so a
 * checkout that moved during the run (A -> clean B) was recorded as B although
 * A generated the candidate, and reverting local generator edits before the
 * seal dropped the -dirty marker. promote.sh now captures it at step 0 with
 * `studio-identity` and hands it to `seal --studio-at`.
 */
describe("the Studio identity is captured before generation and preserved at the seal", () => {
  const COMMIT_RE = /^[0-9a-f]{40}$/;
  const record = { schema: "studio-compliance-record/1", passed: [], failed: [], skipped: [], readyForProduction: true };

  function studioRepo(name: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "generator.ts"), "export const v = 1;\n");
    git(dir, "init", "-q");
    git(dir, "add", "generator.ts");
    git(dir, "commit", "-q", "--no-gpg-sign", "-m", "A");
    return dir;
  }

  function cli(...argv: string[]) {
    return spawnSync("npx", ["tsx", CLI, ...argv], { cwd: STUDIO, encoding: "utf8" });
  }

  function seal(name: string, studio: string, studioAt: string | null) {
    const dir = path.join(tmp, `${name}-seal`);
    fs.mkdirSync(dir, { recursive: true });
    const subject: ProvenanceSubject = {
      subappId: "wc-clock",
      version: "0.1.0",
      treeSha256: sha("tree"),
      hostFiles: [{ path: "flightdeck/server/subapps/registry.ts", sha256: sha("r") }],
    };
    fs.writeFileSync(path.join(dir, "subject.json"), JSON.stringify({ hostHead: "a".repeat(40), subject }));
    fs.writeFileSync(path.join(dir, "record.json"), JSON.stringify(record));
    const out = path.join(dir, "PROVENANCE.json");
    const argv = ["seal", "--subject", path.join(dir, "subject.json"), "--record", path.join(dir, "record.json"), "--studio", studio];
    if (studioAt !== null) argv.push("--studio-at", studioAt);
    argv.push("--out", out);
    const r = cli(...argv);
    return { r, out, sealed: fs.existsSync(out) ? (JSON.parse(fs.readFileSync(out, "utf8")) as { studioCommit: string }) : null };
  }

  const identity = (studio: string) => {
    const r = cli("studio-identity", "--studio", studio);
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim();
  };

  it("⭐ a Studio checkout that moved to a clean B after capture refuses the seal (A generated the candidate)", () => {
    const studio = studioRepo("studio-moved");
    const at = identity(studio);
    expect(at).toMatch(COMMIT_RE);
    fs.writeFileSync(path.join(studio, "generator.ts"), "export const v = 2;\n");
    git(studio, "commit", "-q", "--no-gpg-sign", "-am", "B");
    const { r, sealed } = seal("studio-moved", studio, at);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("studio-moved");
    expect(sealed).toBeNull();
  });

  it("⭐ dirty at capture, reverted before the seal: the record keeps the -dirty marker", () => {
    const studio = studioRepo("studio-reverted");
    fs.writeFileSync(path.join(studio, "generator.ts"), "export const v = 99;\n");
    const at = identity(studio);
    expect(at).toMatch(/^[0-9a-f]{40}-dirty$/);
    git(studio, "checkout", "--", "generator.ts");
    const { r, sealed } = seal("studio-reverted", studio, at);
    expect(r.status, r.stderr).toBe(0);
    expect(sealed?.studioCommit).toBe(at);
  });

  it("clean at capture, dirty at the seal refuses: what ran is not what the commit says", () => {
    const studio = studioRepo("studio-dirtied");
    const at = identity(studio);
    fs.writeFileSync(path.join(studio, "generator.ts"), "export const v = 3;\n");
    const { r, sealed } = seal("studio-dirtied", studio, at);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("studio-moved");
    expect(sealed).toBeNull();
  });

  it("an unchanged clean checkout seals with that commit; a seal without --studio-at, or a malformed one, is refused", () => {
    const studio = studioRepo("studio-same");
    const at = identity(studio);
    const ok = seal("studio-same", studio, at);
    expect(ok.r.status, ok.r.stderr).toBe(0);
    expect(ok.sealed?.studioCommit).toBe(at);

    const missing = seal("studio-missing", studio, null);
    expect(missing.r.status).toBe(2);
    expect(missing.r.stderr).toContain("--studio-at");
    expect(missing.sealed).toBeNull();

    const junk = seal("studio-junk", studio, "HEAD");
    expect(junk.r.status).not.toBe(0);
    expect(junk.sealed).toBeNull();
  });
});
