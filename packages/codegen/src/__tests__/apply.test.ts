/** The write path, tested where it actually hurts.
 *
 * Every test here is a failure mode the old `for … writeFileSync` loop had
 * no answer for: a path that leaves the repo, a disk that says no on the
 * fourth of eight files, a Ctrl-C mid-apply, a rerun after an interrupted
 * one, a file the operator edited by hand. The property under test is
 * almost always the same one — AFTER THE FAILURE, WHAT IS ON DISK? — and
 * the answer is meant to be "either all of it or none of it". */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PathEscapeError,
  applyGeneratedFiles,
  applyWrites,
  journalPathFor,
  planWrites,
  resolveWithinRoot,
  sha256,
  writeAction,
} from "../apply";
import type { GeneratedFile } from "../invariants";
import { generateSubApp } from "../generate";
import { wcClockSpec } from "../fixtures/specs";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-apply-"));
  try {
    return fn(fs.realpathSync(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const OPTS = { planId: "wc-clock", specFingerprint: "deadbeef", now: () => "2026-09-20T00:00:00.000Z" };

function file(p: string, contents: string, kind: GeneratedFile["kind"] = "routes-domain"): GeneratedFile {
  return { path: p, contents, kind };
}

const SET: GeneratedFile[] = [
  file("server/subapps/wc-clock/manifest.ts", "// manifest\n", "manifest"),
  file("server/subapps/wc-clock/guard.ts", "// guard\n", "guard"),
  file("server/subapps/wc-clock/routes/index.ts", "// routes index\n", "routes-index"),
  file("server/subapps/wc-clock/routes/shifts.ts", "// shifts\n", "routes-domain"),
  file("server/subapps/wc-clock/schema.ts", "// schema\n", "schema"),
  file("web/src/subapps/wc-clock/index.tsx", "// web\n", "web-module"),
  file("tests/subapps/wc-clock/wcClockConformance.test.ts", "// test\n", "host-test"),
  file("server/subapps/registry.ts.patch", "--- a\n+++ b\n", "patch"),
];

function existingFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

describe("path confinement", () => {
  it("refuses every shape of escape rather than clamping it", () => {
    const root = "/srv/host";
    for (const bad of ["/etc/passwd", "../outside.ts", "server/../../outside.ts", "C:\\windows\\system32", "\\\\unc\\share"]) {
      expect(() => resolveWithinRoot(root, bad), bad).toThrow(PathEscapeError);
    }
    expect(() => resolveWithinRoot(root, ".git/hooks/pre-commit")).toThrow(/git hook is executable code/);
    expect(() => resolveWithinRoot(root, "a/\0b")).toThrow(/NUL/);
    expect(resolveWithinRoot(root, "./server/./subapps/x/manifest.ts")).toBe(path.join(root, "server/subapps/x/manifest.ts"));
  });

  it("refuses an escaping action without writing anything, and --force does not unlock it", () => {
    withTempDir((root) => {
      for (const force of [false, true]) {
        const report = applyGeneratedFiles([...SET, file("../escaped.ts", "// nope\n")], { ...OPTS, root, force });
        expect(report.outcome).toBe("refused");
        expect(report.refusals.map((r) => r.reason)).toContain("path-escape");
        expect(report.refusals.every((r) => r.forceable)).toBe(false);
        expect(existingFiles(root)).toEqual([]);
        expect(fs.existsSync(path.join(path.dirname(root), "escaped.ts"))).toBe(false);
      }
    });
  });

  it("refuses to write through a symlinked ancestor", () => {
    withTempDir((root) => {
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-outside-"));
      try {
        fs.mkdirSync(path.join(root, "server"), { recursive: true });
        fs.symlinkSync(elsewhere, path.join(root, "server", "subapps"));
        const report = applyGeneratedFiles(SET, { ...OPTS, root, force: true });
        expect(report.outcome).toBe("refused");
        expect(report.refusals.map((r) => r.reason)).toContain("ancestor-is-symlink");
        expect(existingFiles(elsewhere)).toEqual([]);
      } finally {
        fs.rmSync(elsewhere, { recursive: true, force: true });
      }
    });
  });
});

describe("two-phase commit", () => {
  it("writes the whole set, in dependency order, with the registry patch last", () => {
    withTempDir((root) => {
      const report = applyGeneratedFiles(SET, { ...OPTS, root });
      expect(report.outcome).toBe("applied");
      expect(report.actions.every((a) => a.status === "committed")).toBe(true);
      expect(report.actions.map((a) => a.kind)).toEqual([
        "schema",
        "guard",
        "routes-domain",
        "routes-index",
        "web-module",
        "host-test",
        "manifest",
        "patch",
      ]);
      expect(existingFiles(root)).toContain("server/subapps/wc-clock/manifest.ts");
      expect(fs.readFileSync(path.join(root, "web/src/subapps/wc-clock/index.tsx"), "utf8")).toBe("// web\n");
    });
  });

  it("leaves NOTHING on disk when the filesystem refuses one file of eight", () => {
    withTempDir((root) => {
      // `routes` occupied by a regular file: mkdir of the parent fails with
      // ENOTDIR on the 3rd and 4th actions, uid-independently.
      fs.mkdirSync(path.join(root, "server/subapps/wc-clock"), { recursive: true });
      fs.writeFileSync(path.join(root, "server/subapps/wc-clock/routes"), "not a directory\n");

      const report = applyGeneratedFiles(SET, { ...OPTS, root });
      expect(report.outcome).toBe("failed");
      expect(report.failures[0]?.phase).toBe("stage");
      // Whichever errno the platform picks for "the parent is a file", it is
      // carried through to the caller verbatim rather than flattened.
      expect(["ENOTDIR", "EEXIST"]).toContain(report.failures[0]?.code);
      expect(report.failures[0]?.path).toBe("server/subapps/wc-clock/routes/shifts.ts");

      // The half-mounted sub-app the critic described: manifest and guard
      // present, routes and schema missing. It must not exist.
      expect(existingFiles(root)).toEqual(["server/subapps/wc-clock/routes"]);
      expect(report.actions.some((a) => a.status === "committed")).toBe(false);
      expect(report.actions.filter((a) => a.status === "aborted").length).toBeGreaterThan(0);
    });
  });

  it("reports a cancel as aborted, not as a failure, and commits nothing", () => {
    withTempDir((root) => {
      const controller = new AbortController();
      controller.abort();
      const report = applyGeneratedFiles(SET, { ...OPTS, root, signal: controller.signal });
      expect(report.outcome).toBe("aborted");
      expect(report.failures).toEqual([]);
      expect(report.actions.every((a) => a.status === "aborted")).toBe(true);
      expect(existingFiles(root)).toEqual([]);
    });
  });

  it("stages beside the destination and leaves no temp files behind, either way", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root });
      expect(existingFiles(root).filter((f) => path.basename(f).startsWith(".codegen-"))).toEqual([]);

      fs.writeFileSync(path.join(root, "server/subapps/wc-clock/routes/index.ts"), "edited\n");
      applyGeneratedFiles(SET, { ...OPTS, root });
      expect(existingFiles(root).filter((f) => path.basename(f).startsWith(".codegen-"))).toEqual([]);
    });
  });
});

describe("the journal", () => {
  it("makes a rerun of the same plan a no-op rather than a clash", () => {
    withTempDir((root) => {
      expect(applyGeneratedFiles(SET, { ...OPTS, root }).outcome).toBe("applied");
      const second = applyGeneratedFiles(SET, { ...OPTS, root });
      expect(second.outcome).toBe("no-op");
      expect(second.refusals).toEqual([]);
      expect(second.actions.every((a) => a.status === "already-applied")).toBe(true);
    });
  });

  it("resumes an interrupted apply without --force", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root });
      fs.rmSync(path.join(root, "server/subapps/wc-clock/routes/index.ts"));
      fs.rmSync(path.join(root, "server/subapps/wc-clock/schema.ts"));

      const resumed = applyGeneratedFiles(SET, { ...OPTS, root, force: false });
      expect(resumed.outcome).toBe("applied");
      const byPath = new Map(resumed.actions.map((a) => [a.path, a]));
      expect(byPath.get("server/subapps/wc-clock/routes/index.ts")?.disposition).toBe("resume");
      expect(byPath.get("server/subapps/wc-clock/schema.ts")?.disposition).toBe("resume");
      expect(byPath.get("server/subapps/wc-clock/manifest.ts")?.disposition).toBe("identical");
      expect(fs.existsSync(path.join(root, "server/subapps/wc-clock/schema.ts"))).toBe(true);
    });
  });

  it("refreshes its own unmodified output when the spec changes, no --force needed", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root });
      const changed = SET.map((f) => (f.kind === "guard" ? file(f.path, "// guard v2\n", "guard") : f));
      const report = applyGeneratedFiles(changed, { ...OPTS, root, force: false });
      expect(report.outcome).toBe("applied");
      expect(report.actions.find((a) => a.kind === "guard")?.disposition).toBe("refresh");
      expect(fs.readFileSync(path.join(root, "server/subapps/wc-clock/guard.ts"), "utf8")).toBe("// guard v2\n");
    });
  });

  it("refuses a hand-edited file as drift, distinctly from a foreign file as a clash", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root });
      fs.appendFileSync(path.join(root, "server/subapps/wc-clock/guard.ts"), "// mine\n");
      const drift = applyGeneratedFiles(SET, { ...OPTS, root });
      expect(drift.outcome).toBe("refused");
      expect(drift.refusals.map((r) => r.reason)).toEqual(["drift"]);
      expect(drift.refusals[0]?.forceable).toBe(true);
      expect(fs.readFileSync(path.join(root, "server/subapps/wc-clock/guard.ts"), "utf8")).toContain("// mine");
    });

    withTempDir((root) => {
      const squatted = path.join(root, "server/subapps/wc-clock/manifest.ts");
      fs.mkdirSync(path.dirname(squatted), { recursive: true });
      fs.writeFileSync(squatted, "// someone else\n");
      const clash = applyGeneratedFiles(SET, { ...OPTS, root });
      expect(clash.outcome).toBe("refused");
      expect(clash.refusals.map((r) => r.reason)).toEqual(["clash"]);
      expect(existingFiles(root)).toEqual(["server/subapps/wc-clock/manifest.ts"]);
    });
  });

  it("survives a corrupt journal by degrading to 'everything is a clash', not by throwing", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root });
      fs.writeFileSync(journalPathFor(root, "wc-clock"), "{ this is not json");
      fs.writeFileSync(path.join(root, "server/subapps/wc-clock/guard.ts"), "// changed\n");

      // Without a journal the tool cannot tell its own past output from a
      // stranger's file, so it assumes the stranger. Conservative, named,
      // and recoverable with --force — never an exception out of JSON.parse.
      const report = applyGeneratedFiles(SET, { ...OPTS, root });
      expect(report.outcome).toBe("refused");
      expect(report.refusals.map((r) => r.reason)).toEqual(["clash"]);
      expect(report.warnings.join(" ")).toMatch(/could not be read as a codegen journal/);

      // ...and a successful run rewrites a valid journal, so the damage is
      // self-healing rather than permanent.
      expect(applyGeneratedFiles(SET, { ...OPTS, root, force: true }).outcome).toBe("applied");
      expect(applyGeneratedFiles(SET, { ...OPTS, root }).outcome).toBe("no-op");
    });
  });

  it("does not call the old bytes 'drift' when a run was killed between two renames", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root });
      const v2 = SET.map((f) => (f.kind === "guard" ? file(f.path, "// guard v2\n", "guard") : f));

      // Exactly the state a SIGKILL mid-commit leaves: the intent record is
      // on disk naming the NEW bytes, the file still holds the OLD ones.
      // Without `supersedes` the next run matches neither and calls it a
      // hand edit — pushing the operator onto --force, which is the trap.
      const at = journalPathFor(root, "wc-clock");
      const journal = JSON.parse(fs.readFileSync(at, "utf8")) as {
        completedAt: string | null;
        entries: { path: string; sha256: string; supersedes: string | null }[];
      };
      journal.completedAt = null;
      for (const entry of journal.entries) {
        if (!entry.path.endsWith("guard.ts")) continue;
        entry.supersedes = entry.sha256;
        entry.sha256 = sha256(Buffer.from("// guard v2\n", "utf8"));
      }
      fs.writeFileSync(at, JSON.stringify(journal));

      const resumed = applyGeneratedFiles(v2, { ...OPTS, root, force: false });
      expect(resumed.outcome).toBe("applied");
      expect(resumed.actions.find((a) => a.kind === "guard")?.disposition).toBe("refresh");
      expect(fs.readFileSync(path.join(root, "server/subapps/wc-clock/guard.ts"), "utf8")).toBe("// guard v2\n");
    });
  });

  it("records the intent before the first rename, so an interrupted run is recognisable", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root });
      const journal = JSON.parse(fs.readFileSync(journalPathFor(root, "wc-clock"), "utf8")) as {
        completedAt: string | null;
        specFingerprint: string;
        entries: { path: string; sha256: string; supersedes: string | null }[];
      };
      expect(journal.completedAt).toBe("2026-09-20T00:00:00.000Z");
      expect(journal.specFingerprint).toBe("deadbeef");
      expect(journal.entries).toHaveLength(SET.length);
      const guard = journal.entries.find((e) => e.path.endsWith("guard.ts"));
      expect(guard?.sha256).toBe(sha256(Buffer.from("// guard\n", "utf8")));
    });
  });
});

describe("reconciliation with what is actually on disk", () => {
  it("surfaces files under the sub-app's directories that the plan does not own", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root, ownedDirs: ["server/subapps/wc-clock", "web/src/subapps/wc-clock"] });
      fs.writeFileSync(path.join(root, "server/subapps/wc-clock/routes/extra.ts"), "// added by hand\n");

      const report = applyGeneratedFiles(SET, {
        ...OPTS,
        root,
        ownedDirs: ["server/subapps/wc-clock", "web/src/subapps/wc-clock"],
      });
      expect(report.reconciliation.untracked).toEqual(["server/subapps/wc-clock/routes/extra.ts"]);
      expect(report.reconciliation.missing).toEqual([]);
    });
  });

  it("read-back reports what the disk holds, not what was issued", () => {
    withTempDir((root) => {
      const report = applyGeneratedFiles(SET, { ...OPTS, root, ownedDirs: ["server/subapps/wc-clock"] });
      expect(report.reconciliation.missing).toEqual([]);
      fs.rmSync(path.join(root, "server/subapps/wc-clock/guard.ts"));
      const after = applyGeneratedFiles([], { ...OPTS, root, ownedDirs: ["server/subapps/wc-clock"] });
      expect(after.reconciliation.drifted).toEqual([]);
      expect(after.reconciliation.untracked).toContain("server/subapps/wc-clock/manifest.ts");
    });
  });

  it("names leftover staging files from a run that died", () => {
    withTempDir((root) => {
      applyGeneratedFiles(SET, { ...OPTS, root, ownedDirs: ["server/subapps/wc-clock"] });
      fs.writeFileSync(path.join(root, "server/subapps/wc-clock/.codegen-tmp-999-abcdef01"), "half a file");
      const report = applyGeneratedFiles(SET, { ...OPTS, root, ownedDirs: ["server/subapps/wc-clock"] });
      expect(report.reconciliation.staleTempFiles).toEqual(["server/subapps/wc-clock/.codegen-tmp-999-abcdef01"]);
      expect(report.reconciliation.untracked).toEqual([]);
    });
  });
});

describe("content is not coerced through one string path", () => {
  it("writes a byte payload as bytes", () => {
    withTempDir((root) => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
      const report = applyWrites([writeAction("web/src/subapps/wc-clock/icon.png", { kind: "bytes", bytes: png }, "web-module")], {
        ...OPTS,
        root,
      });
      expect(report.outcome).toBe("applied");
      const onDisk = fs.readFileSync(path.join(root, "web/src/subapps/wc-clock/icon.png"));
      expect(Uint8Array.from(onDisk)).toEqual(png);
      expect(onDisk.length).toBe(10);
    });
  });
});

describe("the real generator's output", () => {
  it("applies a generated wc-clock and is then idempotent", () => {
    withTempDir((root) => {
      const generated = generateSubApp(wcClockSpec);
      const hostFiles = generated.files.filter((f) => f.kind !== "standalone");
      const first = applyGeneratedFiles(generated.files, { ...OPTS, root });
      expect(first.outcome).toBe("applied");
      // ⭐ THE HOST TARGET IS THE DEFAULT AND IT DROPS THE HARNESS. Two of
      // those files sit at host paths and would overwrite the real registry
      // and the real capability types, so this length is the point of the
      // filter rather than an accident of it.
      expect(first.actions).toHaveLength(hostFiles.length);
      expect(hostFiles.length).toBeLessThan(generated.files.length);
      for (const emitted of hostFiles) {
        expect(fs.readFileSync(path.join(root, emitted.path), "utf8")).toBe(emitted.contents);
      }
      // And not one harness file landed.
      for (const emitted of generated.files.filter((f) => f.kind === "standalone")) {
        if (hostFiles.some((h) => h.path === emitted.path)) continue;
        expect(fs.existsSync(path.join(root, emitted.path))).toBe(false);
      }
      expect(applyGeneratedFiles(generated.files, { ...OPTS, root }).outcome).toBe("no-op");
    });
  });

  it("⛔ writes the harness to a root of its own, and refuses to mix the two", () => {
    withTempDir((root) => {
      const generated = generateSubApp(wcClockSpec);
      // "both" has no correct root: the shims would land on top of the host's
      // own registry and capability types. It is refused BY NAME rather than
      // skipped, because a silent skip is how half a harness lands.
      expect(() => applyGeneratedFiles(generated.files, { ...OPTS, root, target: "both" })).toThrow(
        /standalone harness into a host checkout/,
      );

      const alone = applyGeneratedFiles(generated.files, { ...OPTS, root, target: "standalone" });
      expect(alone.outcome).toBe("applied");
      expect(fs.existsSync(path.join(root, "standalone/server.ts"))).toBe(true);
      expect(fs.existsSync(path.join(root, "web/src/subapps/registry.ts"))).toBe(true);
    });
  });

  it("gives every emitted file a plan-derived identity that does not move between runs", () => {
    const a = planWrites(generateSubApp(wcClockSpec).files);
    const b = planWrites(generateSubApp(wcClockSpec).files);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
  });
});
