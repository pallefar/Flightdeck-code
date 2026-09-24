/** The promotion / mount sandbox is built from TRACKED files only.
 *
 * ⛔ WHAT THIS PINS. Both `scripts/promote.sh` and `scripts/mount-in-host.sh`
 * used to build their sandbox with
 *
 *   tar -C "$REPO" --exclude=.git --exclude=node_modules -cf - . | tar -C "$ROOT" -xf -
 *
 * which was wrong in both directions at once:
 *
 * 1. It STRIPPED `.git`, so the host's git-based PII checks could not run in
 *    the sandbox: `tests/piiGitBoundary.test.ts` refuses to run without
 *    `git rev-parse`, and `scripts/check-contracts-boundary.sh --tracked` lists
 *    `git ls-files`. (The host gate still cannot pass in the new sandbox either:
 *    that test also asserts the gitignored PII files exist on disk. Open, owner
 *    decision — see the KNOWN note in scripts/sandbox-lib.sh.)
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
  // 0644 on purpose: cp keeps the source's mode, so a 0600 source would make
  // the "mode 600" assertions below pass even with no umask/chmod hardening.
  write(host, "flightdeck/.env.supabase", `POSTGRES_PASSWORD=${SECRET}\n`, 0o644);
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

/** A host that gets PAST mount-in-host.sh's sandbox step: build:web succeeds,
 * the registry has the anchors codegen's patch needs, and `vitest` is a fake
 * shell script. Its body sees `$AFTER` = 1 once the generated sub-app is in
 * the sandbox's registry (the second, "with a sub-app mounted" run). */
/** Pinned, not inherited: `SPEC=… bash scripts/promote.sh` (HANDOVER §4) puts
 * SPEC in the environment this suite runs in, and the fake vitest below
 * recognises the mounted run by the wc-clock id. */
const WC_CLOCK_SPEC = path.join(STUDIO, "fixtures", "wc-clock.spec.json");

function mountHost(name: string, vitestBody: string[]): string {
  const host = makeHost(name, true);
  write(host, "flightdeck/package.json", '{ "name": "fixture-host", "private": true, "scripts": { "build:web": "exit 0" } }\n');
  write(
    host,
    "flightdeck/server/subapps/registry.ts",
    [
      'import type { SubAppManifest } from "./types.js";',
      'import { fixtureManifest } from "./fixture/manifest.js";',
      "",
      "export const SUBAPP_MANIFESTS: SubAppManifest[] = [",
      "  fixtureManifest,",
      "];",
      "",
    ].join("\n"),
  );
  git(host, "add", "flightdeck/package.json", "flightdeck/server/subapps/registry.ts");
  git(host, "commit", "-q", "-m", "a host mount-in-host.sh can get through");
  write(
    host,
    "flightdeck/node_modules/.bin/vitest",
    [
      "#!/bin/sh",
      'if grep -q "wc-clock" server/subapps/registry.ts; then AFTER=1; else AFTER=0; fi',
      ...vitestBody,
      "",
    ].join("\n"),
    0o755,
  );
  return host;
}

describe("scripts/mount-in-host.sh runs the host suite behind the gate's Postgres fence", () => {
  // The host's scripts/gate.sh never runs vitest without unsetting
  // POSTGRES_ENABLED / POSTGRES_DSN / SUPABASE_TEST_DSN and pinning
  // AUTH_REQUIRED=false WORKSPACES_ENABLED=false: with POSTGRES_* in the
  // environment, an app-boot test with a fixture root binds the live workspace
  // and the indexers prune it (the 2026-08-20 data loss, gate.sh stack 2).
  // mount-in-host.sh ran the same host suite with the caller's environment
  // as-is, so an operator who had exported them for a server run armed that
  // mechanism against the live database. The fixture's `vitest` is a fake that
  // only records the environment it was started with.
  it("unsets POSTGRES_* and SUPABASE_TEST_DSN and pins AUTH/WORKSPACES off, in both runs", () => {
    const host = mountHost("fence-host", [
      "for v in POSTGRES_ENABLED POSTGRES_DSN SUPABASE_TEST_DSN AUTH_REQUIRED WORKSPACES_ENABLED; do",
      '  eval "val=\\${$v-<unset>}"; echo "$v=$val"',
      'done >>"$SUITE_PROBE"',
      'echo " Tests  $((10 + AFTER)) passed ($((10 + AFTER)))"',
    ]);
    const probe = path.join(work, "fence.probe");
    const root = path.join(work, "fence-root");
    // Values that cannot reach any database: the fake vitest only echoes them.
    run("mount-in-host.sh", {
      REPO: host,
      SANDBOX: root,
      SPEC: WC_CLOCK_SPEC,
      SUITE_PROBE: probe,
      POSTGRES_ENABLED: "true",
      POSTGRES_DSN: "postgres://fixture.invalid:1/none",
      SUPABASE_TEST_DSN: "postgres://fixture.invalid:1/none",
      AUTH_REQUIRED: "true",
      WORKSPACES_ENABLED: "true",
    });
    const fenced = [
      "POSTGRES_ENABLED=<unset>",
      "POSTGRES_DSN=<unset>",
      "SUPABASE_TEST_DSN=<unset>",
      "AUTH_REQUIRED=false",
      "WORKSPACES_ENABLED=false",
    ];
    expect(fs.readFileSync(probe, "utf8").trim().split("\n")).toEqual([...fenced, ...fenced]);
  }, 60_000);
});

describe("scripts/mount-in-host.sh enforces its own comparison", () => {
  // The script printed "Mounting must ADD passing tests and add no failures"
  // and then exited 0 whatever the numbers said. Its first run on the Mac
  // (host c44d665b) went from 0 failed to 1 failed with a sub-app mounted,
  // and reported success.
  function mount(name: string, before: string[], after: string[]) {
    const host = mountHost(name, [
      'if [ "$AFTER" = 1 ]; then',
      ...after.map((l) => `  echo ${JSON.stringify(l)}`),
      "else",
      ...before.map((l) => `  echo ${JSON.stringify(l)}`),
      "fi",
      "true",
    ]);
    return run("mount-in-host.sh", { REPO: host, SANDBOX: path.join(work, `${name}-root`), SPEC: WC_CLOCK_SPEC });
  }
  const PRE = " FAIL  tests/subapps/docusign/docusignLibreoffice.test.ts > converts a real docx";
  const NEW = " FAIL  tests/subapps/launcherSubappDefaults.test.ts > every registered sub-app is defaulted ON";

  it("passes when mounting adds passing tests and no failures", () => {
    const { status, out } = mount("cmp-ok", [" Tests  10 passed (10)"], [" Tests  12 passed (12)"]);
    expect(status, out).toBe(0);
    expect(out).toContain("MOUNT OK");
  }, 60_000);

  it("a failure present in BOTH runs is not the candidate's", () => {
    const { status, out } = mount(
      "cmp-pre",
      [PRE, " Tests  1 failed | 10 passed (11)"],
      [PRE, " Tests  1 failed | 12 passed (13)"],
    );
    expect(status, out).toBe(0);
  }, 60_000);

  it("FAILS when mounting adds a failure", () => {
    const { status, out } = mount("cmp-new", [" Tests  10 passed (10)"], [NEW, " Tests  1 failed | 12 passed (13)"]);
    expect(status).toBe(1);
    expect(out).toContain("MOUNT FAILED");
    expect(out).toContain("launcherSubappDefaults.test.ts");
  }, 60_000);

  it("FAILS when a different test fails after, even at the same failure count", () => {
    const { status, out } = mount(
      "cmp-swap",
      [PRE, " Tests  1 failed | 10 passed (11)"],
      [NEW, " Tests  1 failed | 12 passed (13)"],
    );
    expect(status).toBe(1);
    expect(out).toContain("launcherSubappDefaults.test.ts");
  }, 60_000);

  it("FAILS when mounting adds no passing test", () => {
    const { status, out } = mount("cmp-flat", [" Tests  10 passed (10)"], [" Tests  10 passed (10)"]);
    expect(status).toBe(1);
    expect(out).toContain("MOUNT FAILED");
  }, 60_000);

  it("FAILS when a run printed no summary at all", () => {
    const { status, out } = mount("cmp-none", [" Tests  10 passed (10)"], ["Error: the suite crashed"]);
    expect(status).toBe(1);
    expect(out).toContain("MOUNT FAILED");
  }, 60_000);
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
    // Checked INSIDE the same shell, before it exits: after exit the EXIT trap
    // would have removed the file anyway and hide a missing explicit rm.
    const { r, root, probe, out } = gateRun(
      "gate-on",
      // Explicit, not inherited: promote.sh runs this suite in step [1/6] with
      // the operator's environment, and a run with FLIGHTDECK_GATE_POSTGRES=0
      // (the safe way to promote without touching a database) failed this
      // case on the first Mac run for that reason alone.
      { FLIGHTDECK_GATE_POSTGRES: "1" },
      'sandbox_run_host_gate "$2" "$3" "$3/host-gate.log"; echo "rc=$?"; [ -e "$3/flightdeck/.env.supabase" ] && echo STILL_PRESENT; true',
    );
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(probe, "utf8")).toBe("present -rw-------\n");
    expect(out).toContain("rc=3");
    expect(out).not.toContain("STILL_PRESENT");
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

describe("sandbox_run_host_gate hands the host's engine venv to the gate", () => {
  // The host gate's run_eval stack prefers $ROOT/.venv/bin/python, else
  // python3. .venv is gitignored, so the tracked-only sandbox never has one:
  // on a PEP 668 Mac (Homebrew python3, no python-docx) run_eval was RED in
  // every promote run for the SANDBOX's reason, even with a working venv on
  // the host. The gate honours PYTHON_BIN, so the helper passes the host's.
  const pyGate = [
    "#!/usr/bin/env bash",
    'echo "PYTHON_BIN=${PYTHON_BIN:-<unset>}" >"$GATE_PROBE"',
    "exit 0",
    "",
  ].join("\n");
  const lib = path.join(STUDIO, "scripts", "sandbox-lib.sh");

  function pyRun(name: string, withVenv: boolean, env: Record<string, string> = {}) {
    const host = makeHost(`${name}-host`, false, pyGate);
    if (withVenv) write(host, ".venv/bin/python", "#!/bin/sh\nexit 0\n", 0o755);
    const root = path.join(work, `${name}-root`);
    const probe = path.join(work, `${name}.probe`);
    const { PYTHON_BIN: _drop, ...base } = process.env;
    const r = spawnSync(
      "bash",
      ["-c", 'set -uo pipefail; . "$1"; sandbox_from_tracked "$2" "$3" >/dev/null || exit 90; sandbox_run_host_gate "$2" "$3" "$3/host-gate.log"', "_", lib, host, root],
      { encoding: "utf8", env: { ...base, GATE_PROBE: probe, FLIGHTDECK_GATE_POSTGRES: "0", ...env } },
    );
    return { r, host, root, probe };
  }

  it("uses the host's .venv/bin/python when PYTHON_BIN is not set", () => {
    const { r, host, root, probe } = pyRun("py-venv", true);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(probe, "utf8")).toBe(`PYTHON_BIN=${host}/.venv/bin/python\n`);
    // The venv is used in place, never copied into the sandbox.
    expect(fs.existsSync(path.join(root, ".venv"))).toBe(false);
  });

  it("an explicit PYTHON_BIN still wins", () => {
    const { r, probe } = pyRun("py-explicit", true, { PYTHON_BIN: "/opt/elsewhere/python" });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(probe, "utf8")).toBe("PYTHON_BIN=/opt/elsewhere/python\n");
  });

  it("leaves PYTHON_BIN unset when the host has no venv (the gate's own fallback applies)", () => {
    const { r, probe } = pyRun("py-none", false);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(probe, "utf8")).toBe("PYTHON_BIN=<unset>\n");
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
