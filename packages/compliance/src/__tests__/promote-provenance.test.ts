/**
 * `scripts/promote.sh` writes the provenance sidecar (upd-studio-provenance).
 *
 * The REAL script runs against a throwaway fake host whose `scripts/gate.sh`
 * exits 0. `npx`/`npm` are stubbed on PATH, EXCEPT `npx tsx …`, which is
 * forwarded to the real one — so codegen really generates and mounts the
 * candidate into the sandbox, and the provenance steps really run. Nothing
 * touches a real host checkout.
 *
 * - A clean run writes `PROVENANCE.json` into the run dir (and into the
 *   sandbox's app dir), bound to the record by its JCS digest, with the host
 *   files listed.
 * - A host patch codegen did not declare fails the subject step: the record
 *   says `provenance-subject` FAILED and no sidecar is written.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PROVENANCE_SCHEMA, type Provenance } from "../provenance";
import { recordDigest } from "../record";
import { deriveSubject } from "../subject";

const STUDIO = path.resolve(__dirname, "..", "..", "..", "..");
const PROMOTE = path.join(STUDIO, "scripts", "promote.sh");
const SPEC = path.join(STUDIO, "fixtures", "wc-clock.spec.json");
const REAL_NPX = spawnSync("bash", ["-lc", "command -v npx"], { encoding: "utf8" }).stdout.trim();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "promote-provenance-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function fakeHost(dir: string): string {
  const fd = path.join(dir, "flightdeck");
  fs.mkdirSync(path.join(fd, "server", "subapps"), { recursive: true });
  for (let i = 0; i < 11; i++) fs.mkdirSync(path.join(fd, "node_modules", `dep${i}`), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "gate.sh"), "exit 0\n");
  fs.writeFileSync(
    path.join(fd, "server", "subapps", "registry.ts"),
    'import type { SubAppManifest } from "./types.js";\n\nexport const SUBAPP_MANIFESTS: SubAppManifest[] = [\n];\n',
  );
  fs.writeFileSync(path.join(fd, "server", "index.ts"), "export const boot = 1;\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", ".gitignore", "scripts/gate.sh", "flightdeck/server");
  git("commit", "-q", "--no-gpg-sign", "-m", "fake host");
  return dir;
}

/** npx/npm stubs. `npx tsx …` runs for real; with STRAY set, a codegen run is followed by an undeclared host edit. */
function stubBin(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    "#!/usr/bin/env bash",
    `if [ "$(basename "$0")" = npx ] && [ "$1" = tsx ]; then`,
    `  "${REAL_NPX}" "$@"; rc=$?`,
    `  if [ -n "\${STRAY:-}" ] && [ "$2" = packages/codegen/src/cli.ts ]; then`,
    `    out=""; prev=""; for a in "$@"; do [ "$prev" = --out ] && out="$a"; prev="$a"; done`,
    `    echo "export const sneaky = 1;" >>"$out/server/index.ts"`,
    "  fi",
    "  exit $rc",
    "fi",
    `[ "$1 $2" = "run redteam" ] && echo "7/7 planted violations produced a BLOCKING finding"`,
    "exit 0",
    "",
  ].join("\n");
  for (const name of ["npx", "npm"]) {
    fs.writeFileSync(path.join(dir, name), body);
    fs.chmodSync(path.join(dir, name), 0o755);
  }
  return dir;
}

function runPromote(name: string, extraEnv: Record<string, string> = {}) {
  const base = path.join(tmp, name);
  const host = fakeHost(path.join(base, "host"));
  const bin = stubBin(path.join(base, "bin"));
  const runs = path.join(base, "runs");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, {
    PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
    HOST_REPO: host,
    SPEC,
    SANDBOX: path.join(base, "sandbox"),
    STUDIO_RUNS_DIR: runs,
    FLIGHTDECK_GATE_POSTGRES: "0",
    ...extraEnv,
  });
  const result = spawnSync("bash", [PROMOTE], { env, encoding: "utf8", timeout: 120_000 });
  const runDirs = fs.existsSync(runs) ? fs.readdirSync(runs).map((d) => path.join(runs, d)) : [];
  expect(runDirs).toHaveLength(1);
  return { result, runDir: runDirs[0]!, sandbox: path.join(base, "sandbox"), host };
}

describe("promote.sh and the provenance sidecar", () => {
  it("⭐ a clean run writes PROVENANCE.json bound to its record, host files listed, the manifest untouched", () => {
    const { result, runDir, sandbox, host } = runPromote("clean", { CATALOGUE_ENTRY_ID: "triage-summary@2" });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output, output).toContain("PASS: provenance-subject");
    expect(result.status, output).toBe(0);

    const record = JSON.parse(fs.readFileSync(path.join(runDir, "compliance-record.json"), "utf8")) as { passed: string[] };
    expect(record.passed).toContain("provenance-subject");
    const sidecar = JSON.parse(fs.readFileSync(path.join(runDir, "PROVENANCE.json"), "utf8")) as Provenance;
    expect(sidecar.schema).toBe(PROVENANCE_SCHEMA);
    expect(sidecar.recordSha256).toBe(recordDigest(record));
    expect(sidecar.catalogueEntryId).toBe("triage-summary@2");
    const hostHead = spawnSync("git", ["-C", host, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    expect(sidecar.hostHead).toBe(hostHead);
    expect(sidecar.studioCommit).toMatch(/^[0-9a-f]{40}(-dirty)?$/);
    expect(sidecar.subject.subappId).toBe("wc-clock");
    expect(sidecar.subject.hostFiles.map((f) => f.path)).toContain("flightdeck/server/subapps/registry.ts");

    // The sidecar also sits in its place, and the tree hash re-derived WITH it there is unchanged.
    const placed = path.join(sandbox, "flightdeck", "server", "subapps", "wc-clock", "PROVENANCE.json");
    expect(fs.readFileSync(placed, "utf8")).toBe(fs.readFileSync(path.join(runDir, "PROVENANCE.json"), "utf8"));
    const rederived = deriveSubject({
      root: sandbox,
      subappId: "wc-clock",
      version: "0.1.0",
      declaredHostFiles: sidecar.subject.hostFiles.map((f) => f.path),
    });
    expect(rederived.ok && rederived.subject.treeSha256).toBe(sidecar.subject.treeSha256);

    // The manifest names none of it.
    const manifest = fs.readFileSync(path.join(sandbox, "flightdeck", "server", "subapps", "wc-clock", "manifest.ts"), "utf8");
    expect(manifest).not.toMatch(/provenance|treeSha256|recordSha256/i);
  });

  it("⭐ a host patch codegen did not declare fails provenance-subject, blocks the run, and writes no sidecar", () => {
    const { result, runDir } = runPromote("stray", { STRAY: "1" });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain("FAIL: provenance-subject");
    expect(output).toContain("host-file-undeclared flightdeck/server/index.ts");
    const record = JSON.parse(fs.readFileSync(path.join(runDir, "compliance-record.json"), "utf8")) as {
      failed: string[];
      readyForProduction: boolean;
    };
    expect(record.failed).toContain("provenance-subject");
    expect(record.readyForProduction).toBe(false);
    expect(fs.existsSync(path.join(runDir, "PROVENANCE.json"))).toBe(false);
  });
});
