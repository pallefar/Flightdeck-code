/** `.gitignore` must ignore `node_modules` whether it is a directory OR a symlink.
 *
 * ⛔ WHAT THIS PINS. Worktrees of this repo share one install by symlinking
 * `node_modules` to another checkout's `node_modules`. The pattern
 * `node_modules/` (trailing slash) only matches DIRECTORIES, and git sees a
 * symlink as a file, so the symlink showed up as `?? node_modules` in
 * `git status` — one `git add -A` away from being committed. The same
 * landmine was fixed in the OS repo; this is the Studio copy of it.
 *
 * The check runs against a throwaway git repo that holds this repo's real
 * `.gitignore`, so it does not depend on how the current checkout happens to
 * have its own `node_modules` laid out. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const STUDIO = path.resolve(__dirname, "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-gitignore-"));
const repo = path.join(tmp, "repo");
const target = path.join(tmp, "shared-install");

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

fs.mkdirSync(repo);
fs.mkdirSync(path.join(target, "some-pkg"), { recursive: true });
fs.writeFileSync(path.join(target, "some-pkg", "index.js"), "module.exports = 1;\n");
git("init", "-q");
fs.copyFileSync(path.join(STUDIO, ".gitignore"), path.join(repo, ".gitignore"));

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe(".gitignore node_modules", () => {
  it("ignores a node_modules SYMLINK at the root (shared-install worktrees)", () => {
    fs.symlinkSync(target, path.join(repo, "node_modules"));
    const check = spawnSync("git", ["-C", repo, "check-ignore", "-q", "node_modules"]);
    expect(check.status, "git check-ignore node_modules").toBe(0);
    expect(git("status", "--porcelain", "--untracked-files=all")).not.toMatch(/node_modules/);
  });

  it("ignores a nested node_modules symlink under a package", () => {
    fs.mkdirSync(path.join(repo, "packages", "spec"), { recursive: true });
    fs.symlinkSync(target, path.join(repo, "packages", "spec", "node_modules"));
    const check = spawnSync("git", ["-C", repo, "check-ignore", "-q", "packages/spec/node_modules"]);
    expect(check.status, "git check-ignore packages/spec/node_modules").toBe(0);
  });

  it("still ignores a real node_modules directory and everything in it", () => {
    fs.mkdirSync(path.join(repo, "packages", "codegen", "node_modules", "x"), { recursive: true });
    fs.writeFileSync(path.join(repo, "packages", "codegen", "node_modules", "x", "a.js"), "1\n");
    expect(git("status", "--porcelain", "--untracked-files=all", "--", "packages/codegen")).not.toMatch(
      /node_modules/,
    );
  });
});
