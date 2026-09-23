/** The promotion / mount sandbox is built from TRACKED files only.
 *
 * ⛔ WHAT THIS PINS. Both `scripts/promote.sh` and `scripts/mount-in-host.sh`
 * used to build their sandbox with
 *
 *   tar -C "$REPO" --exclude=.git --exclude=node_modules -cf - . | tar -C "$ROOT" -xf -
 *
 * which was wrong in both directions at once:
 *
 * 1. It STRIPPED `.git`, so the host gate could never pass in the sandbox:
 *    `tests/piiGitBoundary.test.ts` refuses to run without `git rev-parse`, and
 *    `scripts/check-contracts-boundary.sh --tracked` lists `git ls-files`.
 *    `readyForProduction` could therefore never be true.
 * 2. It COPIED EVERYTHING ELSE, including what `.gitignore` exists to keep
 *    out: the loose person-bearing contracts under `contracts/`, and the
 *    secrets in `flightdeck/.env` and `flightdeck/.env.supabase` — into /tmp,
 *    with default permissions.
 *
 * The fixture below is a throwaway host repo shaped like the real one at the
 * points that matter. Each script is run for real against it and stops right
 * after building its sandbox (promote.sh: host deps missing, exit 2;
 * mount-in-host.sh: the fixture's build:web fails, exit 1), which leaves the
 * sandbox on disk to be inspected. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const STUDIO = path.resolve(__dirname, "..", "..");
const SECRET = "fixture-secret-must-never-be-printed";
const PII_FILE = "contracts/2026-07-15 Kowalski Jan New Hire contract.docx";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "studio-sandbox-test-"));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "pipe", encoding: "utf8" },
  );
}

function write(root: string, rel: string, body: string, mode?: number): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  if (mode !== undefined) fs.chmodSync(p, mode);
}

/** A host repo: tracked template + registry, ignored PII contract and secrets. */
function makeHost(name: string, withNodeModules: boolean): string {
  const host = path.join(work, name);
  fs.mkdirSync(host);
  git(host, "init", "-q", "-b", "main");
  write(host, ".gitignore", "node_modules\ncontracts/*\n!contracts/_TEMPLATE/\n.env\n.env.*\n");
  write(host, "contracts/_TEMPLATE/manifest.json", "{}\n");
  write(host, "flightdeck/server/subapps/registry.ts", "export const SUBAPP_MANIFESTS = [];\n");
  write(host, "flightdeck/package.json", '{ "name": "fixture-host", "private": true, "scripts": { "build:web": "exit 7" } }\n');
  write(host, "scripts/gate.sh", "#!/usr/bin/env bash\nexit 0\n");
  git(host, "add", ".gitignore", "contracts/_TEMPLATE/manifest.json", "flightdeck", "scripts");
  git(host, "commit", "-q", "-m", "fixture host");
  // Present on disk, never tracked — exactly the files the old tar copied.
  write(host, PII_FILE, "person data");
  write(host, "contracts/INDEX.json", "[]\n");
  write(host, "flightdeck/.env", "AUTH_REQUIRED=true\n", 0o600);
  write(host, "flightdeck/.env.supabase", `POSTGRES_PASSWORD=${SECRET}\n`, 0o600);
  if (withNodeModules) {
    for (let i = 0; i < 12; i++) fs.mkdirSync(path.join(host, "flightdeck/node_modules", `pkg${i}`), { recursive: true });
  }
  return host;
}

function hostState(host: string): string {
  return git(host, "worktree", "list", "--porcelain") + git(host, "status", "--porcelain", "--ignored");
}

function run(script: string, env: Record<string, string>): { status: number | null; out: string } {
  const r = spawnSync("bash", [path.join(STUDIO, "scripts", script)], {
    cwd: STUDIO,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** The assertions both scripts' sandboxes must satisfy. */
function expectTrackedOnly(root: string): void {
  // 1. A real git checkout — the host gate's PII stack needs one.
  expect(() => git(root, "rev-parse", "--git-dir")).not.toThrow();
  expect(git(root, "rev-parse", "--show-toplevel").trim()).toBe(fs.realpathSync(root));
  expect(git(root, "ls-files", "contracts/")).toBe("contracts/_TEMPLATE/manifest.json\n");
  // 2. Nothing ignored came along.
  expect(git(root, "status", "--porcelain", "--ignored", "contracts/")).toBe("");
  expect(fs.existsSync(path.join(root, PII_FILE))).toBe(false);
  expect(fs.existsSync(path.join(root, "contracts/INDEX.json"))).toBe(false);
  expect(fs.existsSync(path.join(root, "flightdeck/.env"))).toBe(false);
  expect(fs.existsSync(path.join(root, "flightdeck/.env.supabase"))).toBe(false);
  // 3. The tracked tree did come along, and the sandbox is private to its owner.
  expect(fs.existsSync(path.join(root, "flightdeck/server/subapps/registry.ts"))).toBe(true);
  expect(fs.statSync(root).mode & 0o077).toBe(0);
  // 4. The sandbox cannot push back into the host.
  expect(git(root, "remote")).toBe("");
}

describe("scripts/promote.sh sandbox", () => {
  it("is a git checkout of the host's tracked files only, and the host is untouched", () => {
    const host = makeHost("promote-host", false);
    const before = hostState(host);
    const root = path.join(work, "promote-root");
    const { status, out } = run("promote.sh", { HOST_REPO: host, SANDBOX: root, FLIGHTDECK_GATE_POSTGRES: "1" });

    expect(out).toContain("host deps missing");
    expect(status).toBe(2);
    expectTrackedOnly(root);
    expect(out).not.toContain(SECRET);
    expect(hostState(host)).toBe(before);
  });
});

describe("scripts/mount-in-host.sh sandbox", () => {
  it("is a git checkout of the host's tracked files only, and the host is untouched", () => {
    const host = makeHost("mount-host", true);
    const before = hostState(host);
    const root = path.join(work, "mount-root");
    const { status, out } = run("mount-in-host.sh", { REPO: host, SANDBOX: root });

    expect(out).toContain("build:web FAILED");
    expect(status).toBe(1);
    expectTrackedOnly(root);
    // node_modules stays a symlink to the host's, as before.
    expect(fs.lstatSync(path.join(root, "flightdeck/node_modules")).isSymbolicLink()).toBe(true);
    expect(out).not.toContain(SECRET);
    expect(hostState(host)).toBe(before);
  });
});

describe("sandbox_add_pg_env (scripts/sandbox-lib.sh)", () => {
  it("copies ONLY flightdeck/.env.supabase, mode 600, without printing it", () => {
    const host = makeHost("pgenv-host", false);
    const root = path.join(work, "pgenv-root");
    const lib = path.join(STUDIO, "scripts", "sandbox-lib.sh");
    const r = spawnSync(
      "bash",
      ["-c", 'set -euo pipefail; . "$1"; sandbox_from_tracked "$2" "$3"; sandbox_add_pg_env "$2" "$3"', "_", lib, host, root],
      { encoding: "utf8" },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toContain(SECRET);
    const dst = path.join(root, "flightdeck/.env.supabase");
    expect(fs.statSync(dst).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(dst, "utf8")).toBe(`POSTGRES_PASSWORD=${SECRET}\n`);
    expect(fs.existsSync(path.join(root, "flightdeck/.env"))).toBe(false);
    expect(fs.existsSync(path.join(root, PII_FILE))).toBe(false);
  });
});
