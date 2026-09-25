/** `scripts/mount-into-worktree.sh` — the step that puts a Studio sub-app
 * INTO an OS checkout a person will run, rather than into a throwaway
 * sandbox (`mount-in-host.sh`) or the host repo behind a compliance record
 * (`promote.sh`).
 *
 * It regenerates from the SPEC (ruling 8: edited files never travel), writes
 * only into a linked git WORKTREE (a main checkout is refused — the owner's
 * standing rule), applies the emitted registry patch, and is idempotent: a
 * second run of the same spec changes nothing and exits 0.
 *
 * The fixture host is a throwaway repo holding the REAL host's
 * `server/subapps/registry.ts` (FLIGHTDECK_HOST_ROOT), so the patch is
 * applied against the text it will meet. MOUNT_SKIP_HOST_TESTS=1 stops the
 * script before it runs the host's own suite, which needs host deps. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { HOST_ROOT } from "../../packages/guardrails/src/host-source";

const STUDIO = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(STUDIO, "scripts", "mount-into-worktree.sh");
const SPEC = path.join(STUDIO, "fixtures", "shift-notes.spec.json");
const REGISTRY_REL = path.join("flightdeck", "server", "subapps", "registry.ts");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "studio mount wt-"));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function run(host: string, extraEnv: Record<string, string> = {}) {
  return spawnSync("bash", [SCRIPT, "--spec", SPEC, "--host", host], {
    encoding: "utf8",
    env: { ...process.env, MOUNT_SKIP_HOST_TESTS: "1", ...extraEnv },
  });
}

// A host repo shaped like the real one at the points the script touches.
const main = path.join(work, "host-main");
fs.mkdirSync(path.join(main, "flightdeck", "server", "subapps"), { recursive: true });
fs.copyFileSync(path.join(HOST_ROOT, REGISTRY_REL), path.join(main, REGISTRY_REL));
git(main, "init", "-q", "-b", "main");
git(main, "add", ".");
git(main, "commit", "-q", "-m", "fixture");
const worktree = path.join(work, "host wt");
git(main, "worktree", "add", "-q", worktree, "-b", "feat/x");

describe("mount-into-worktree.sh", () => {
  it("refuses a MAIN checkout — only a linked worktree may be written", () => {
    const r = run(main);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not a linked git worktree/);
    expect(fs.existsSync(path.join(main, "flightdeck", "server", "subapps", "shift-notes"))).toBe(false);
  });

  it("refuses a directory that is not a Flightdeck checkout", () => {
    const r = run(work);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not a Flightdeck checkout/);
  });

  it("generates the sub-app from the spec and applies the registry patch", () => {
    const r = run(worktree);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const fd = path.join(worktree, "flightdeck");
    expect(fs.existsSync(path.join(fd, "server", "subapps", "shift-notes", "manifest.ts"))).toBe(true);
    expect(fs.existsSync(path.join(fd, "web", "src", "subapps", "shift-notes", "index.tsx"))).toBe(true);
    const registry = fs.readFileSync(path.join(worktree, REGISTRY_REL), "utf8");
    expect(registry).toMatch(/from "\.\/shift-notes\/manifest\.js"/);
    expect(fs.existsSync(path.join(fd, "server", "subapps", "registry.ts.patch"))).toBe(false);
    // Off by default (D-036): the script names the switch, never sets it.
    expect(r.stdout).toMatch(/SUBAPP_SHIFT_NOTES_ENABLED=true/);
    expect(fs.readFileSync(path.join(fd, "server", "subapps", "shift-notes", "manifest.ts"), "utf8")).toMatch(
      /generatedBy: "flightdeck-studio"/,
    );
  });

  it("is idempotent: the same spec again changes nothing and exits 0", () => {
    const before = fs.readFileSync(path.join(worktree, REGISTRY_REL), "utf8");
    const r = run(worktree);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(worktree, REGISTRY_REL), "utf8")).toBe(before);
    expect(before.match(/shift-notes\/manifest\.js/g)?.length).toBe(1);
  });
});
