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
 * sandbox on disk to be inspected.
 *
 * 3. A full `git clone` of the host would be no better: it copies the host's
 *    whole object store, and the real host's history still holds person-bearing
 *    contracts that were committed once and removed later. The fixture host
 *    does the same (HISTORY_PII_FILE), and the sandbox must hold ONE commit and
 *    none of that history's blobs. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const STUDIO = path.resolve(__dirname, "..", "..");
const SECRET = "fixture-secret-must-never-be-printed";
const PII_FILE = "contracts/2026-07-15 Kowalski Jan New Hire contract.docx";
const HISTORY_PII_FILE = "contracts/2026-06-01 Nowak Anna New Hire contract.docx";
const HISTORY_PII_BODY = "person data committed once, removed later";

// A space in the path, like the real host's "FlightDeck OS".
const work = fs.mkdtempSync(path.join(os.tmpdir(), "studio sandbox test-"));
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

/** A host repo: tracked template + registry, ignored PII contract and secrets,
 * and a PII contract that sits in HISTORY only (committed, then removed). */
function makeHost(name: string, withNodeModules: boolean, gateSh = "#!/usr/bin/env bash\nexit 0\n"): string {
  const host = path.join(work, name);
  fs.mkdirSync(host);
  git(host, "init", "-q", "-b", "main");
  write(host, HISTORY_PII_FILE, HISTORY_PII_BODY);
  git(host, "add", "-f", HISTORY_PII_FILE);
  git(host, "commit", "-q", "-m", "baseline that carried a person's contract");
  git(host, "rm", "-q", HISTORY_PII_FILE);
  git(host, "commit", "-q", "-m", "remove it again");
  write(host, ".gitignore", "node_modules\ncontracts/*\n!contracts/_TEMPLATE/\n.env\n.env.*\n");
  write(host, "contracts/_TEMPLATE/manifest.json", "{}\n");
  write(host, "flightdeck/server/subapps/registry.ts", "export const SUBAPP_MANIFESTS = [];\n");
  write(host, "flightdeck/package.json", '{ "name": "fixture-host", "private": true, "scripts": { "build:web": "exit 7" } }\n');
  write(host, "scripts/gate.sh", gateSh);
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
  // 5. No history: one commit, and the blob of the contract that was committed
  //    once and removed later is NOT in the sandbox's object store.
  expect(git(root, "rev-list", "--all", "--count").trim()).toBe("1");
  expect(() => git(root, "cat-file", "-e", historyBlob())).toThrow();
}

/** The blob id of the history-only PII contract (content-addressed, so the
 * same in every fixture host). */
function historyBlob(): string {
  return execFileSync("git", ["hash-object", "--stdin"], { input: HISTORY_PII_BODY, encoding: "utf8" }).trim();
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

describe("sandbox_run_host_gate (scripts/sandbox-lib.sh)", () => {
  // The fixture gate records what it can see of flightdeck/.env.supabase while
  // it runs, then exits with a code the caller must get back.
  const probeGate = [
    "#!/usr/bin/env bash",
    'f=flightdeck/.env.supabase',
    'if [ -f "$f" ]; then echo "present $(ls -l "$f" | cut -c1-10)" >"$GATE_PROBE"; else echo absent >"$GATE_PROBE"; fi',
    "exit 3",
    "",
  ].join("\n");
  const lib = path.join(STUDIO, "scripts", "sandbox-lib.sh");

  function gateRun(name: string, env: Record<string, string>, body: string) {
    const host = makeHost(`${name}-host`, false, probeGate);
    const root = path.join(work, `${name}-root`);
    const probe = path.join(work, `${name}.probe`);
    const r = spawnSync("bash", ["-c", `set -uo pipefail; . "$1"; sandbox_from_tracked "$2" "$3" >/dev/null || exit 90; ${body}`, "_", lib, host, root], {
      encoding: "utf8",
      env: { ...process.env, GATE_PROBE: probe, ...env },
    });
    return { r, root, probe, out: `${r.stdout}${r.stderr}` };
  }

  it("brings .env.supabase in at mode 600 for the gate only, returns the gate's code, and removes it", () => {
    const { r, root, probe, out } = gateRun("gate-on", {}, 'sandbox_run_host_gate "$2" "$3" "$3/host-gate.log"; echo "rc=$?"');
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(probe, "utf8")).toBe("present -rw-------\n");
    expect(out).toContain("rc=3");
    expect(fs.existsSync(path.join(root, "flightdeck/.env.supabase"))).toBe(false);
    expect(out).not.toContain(SECRET);
  });

  it("never brings it in when FLIGHTDECK_GATE_POSTGRES=0", () => {
    const { r, root, probe, out } = gateRun("gate-off", { FLIGHTDECK_GATE_POSTGRES: "0" }, 'sandbox_run_host_gate "$2" "$3" "$3/host-gate.log"; echo "rc=$?"');
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(probe, "utf8")).toBe("absent\n");
    expect(out).toContain("rc=3");
    expect(fs.existsSync(path.join(root, "flightdeck/.env.supabase"))).toBe(false);
  });

  it("removes it on exit (the trap) even when the caller dies before the explicit rm", () => {
    // sandbox_add_pg_env has run and the trap is armed, then the caller exits
    // early — what an interrupted promote.sh does.
    const { r, root } = gateRun("gate-trap", {}, 'sandbox_arm_pg_env_cleanup "$3"; sandbox_add_pg_env "$2" "$3"; [ -f "$3/flightdeck/.env.supabase" ] || exit 91; exit 5');
    expect(r.status, r.stderr).toBe(5);
    expect(fs.existsSync(path.join(root, "flightdeck/.env.supabase"))).toBe(false);
  });
});

describe("scripts/promote.sh host-gate step", () => {
  it("runs the host gate only through sandbox_run_host_gate, never directly", () => {
    // The integration case above stops at step 0; this pins that step 5 uses
    // the helper the three cases above exercise, so its env handling is covered.
    const src = fs.readFileSync(path.join(STUDIO, "scripts", "promote.sh"), "utf8");
    const code = src.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
    expect(code).toMatch(/^sandbox_run_host_gate "\$REPO" "\$ROOT" "\$ROOT\/host-gate\.log"\nHOST_GATE_RC=\$\?$/m);
    expect(code).not.toMatch(/bash[^\n]*scripts\/gate\.sh/);
    expect(code).not.toMatch(/\.env\.supabase/);
  });
});
