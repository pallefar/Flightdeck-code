/**
 * `scripts/promote.sh` step 1 must point the Studio suite at the host it is
 * promoting into.
 *
 * The guardrail divergence tests read the host's security lists from
 * `FLIGHTDECK_HOST_ROOT`, which defaults to `/home/user/project-contract`.
 * promote.sh is told where the host is through `HOST_REPO` and never passed
 * that on, so on a Mac (host somewhere else) step 1 ran the suite against a
 * path that does not exist: 2 failed, and the stack reported `studio-suite`
 * FAIL although nothing was wrong. The divergence tests were right to fail —
 * the lists really were unverifiable from there. The gap was in the script.
 *
 * This runs the REAL script against a throwaway fake host, with `npx`/`npm`
 * replaced by a stub on PATH that records the environment it was called with
 * and runs nothing. Nothing touches a real host checkout.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const STUDIO = path.resolve(__dirname, "..", "..", "..", "..");
const PROMOTE = path.join(STUDIO, "scripts", "promote.sh");
const SPEC = path.join(STUDIO, "fixtures", "wc-clock.spec.json");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "promote-host-root-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A directory promote.sh accepts as a Flightdeck host, and nothing more. */
function fakeHost(dir: string): string {
  fs.mkdirSync(path.join(dir, "flightdeck", "server", "subapps"), { recursive: true });
  for (let i = 0; i < 11; i++) fs.mkdirSync(path.join(dir, "flightdeck", "node_modules", `dep${i}`), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "gate.sh"), "exit 0\n");
  // promote.sh builds its sandbox from the host's HEAD commit (scripts/sandbox-lib.sh),
  // so the fake host must be a git repo with its files committed.
  fs.writeFileSync(path.join(dir, "flightdeck", "server", "subapps", ".keep"), "");
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  git("init", "-q");
  git("add", "scripts/gate.sh", "flightdeck/server/subapps/.keep");
  git("commit", "-q", "--no-gpg-sign", "-m", "fake host");
  return dir;
}

/** `npx` and `npm` stubs: log argv + the host root they would have seen. */
function stubBin(dir: string, log: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const body =
    `#!/usr/bin/env bash\n` +
    `echo "$(basename "$0") $* | FLIGHTDECK_HOST_ROOT=\${FLIGHTDECK_HOST_ROOT-<unset>}" >>"${log}"\n` +
    `[ "$1 $2" = "run redteam" ] && echo "7/7 planted violations produced a BLOCKING finding"\n` +
    `exit 0\n`;
  for (const name of ["npx", "npm"]) {
    fs.writeFileSync(path.join(dir, name), body);
    fs.chmodSync(path.join(dir, name), 0o755);
  }
  return dir;
}

function runPromote(name: string, extraEnv: Record<string, string>): string[] {
  const host = fakeHost(path.join(tmp, name, "host"));
  const log = path.join(tmp, name, "calls.log");
  const bin = stubBin(path.join(tmp, name, "bin"), log);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env["FLIGHTDECK_HOST_ROOT"];
  Object.assign(env, {
    PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
    HOST_REPO: host,
    SPEC,
    SANDBOX: path.join(tmp, name, "sandbox"),
    ...extraEnv,
  });
  spawnSync("bash", [PROMOTE], { env, encoding: "utf8", timeout: 60_000 });
  return fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
}

/** Step 1's two calls, and only those. */
const studioSuiteCalls = (calls: string[]) =>
  calls.filter((c) => c.startsWith("npx tsc --noEmit ") || c.startsWith("npx vitest run "));

describe("promote.sh step 1 (studio-suite) and FLIGHTDECK_HOST_ROOT", () => {
  it("⭐ with only HOST_REPO set, tsc and vitest see FLIGHTDECK_HOST_ROOT = HOST_REPO", () => {
    const calls = runPromote("only-host-repo", {});
    const host = path.join(tmp, "only-host-repo", "host");
    const step1 = studioSuiteCalls(calls);
    expect(step1).toHaveLength(2);
    for (const call of step1) expect(call).toContain(`FLIGHTDECK_HOST_ROOT=${host}`);
  });

  it("an explicitly set FLIGHTDECK_HOST_ROOT is respected, not overwritten", () => {
    const explicit = path.join(tmp, "explicit-root");
    const calls = runPromote("explicit", { FLIGHTDECK_HOST_ROOT: explicit });
    const step1 = studioSuiteCalls(calls);
    expect(step1).toHaveLength(2);
    for (const call of step1) expect(call).toContain(`FLIGHTDECK_HOST_ROOT=${explicit}`);
  });
});
