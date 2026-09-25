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
import { CODEGEN_JOURNAL_PREFIX, deriveSubject } from "../subject";

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
