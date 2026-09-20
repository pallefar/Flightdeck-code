/** The CLI, driven as a subprocess — the only way to test a program whose
 * contract includes its exit code.
 *
 * Shape follows `flightdeck/scripts/scaffold-parity.ts`: refuse with a
 * named reason and a non-zero exit rather than a stack trace, print the
 * plan under `--dry-run`, and never overwrite without `--force`. Those are
 * the four behaviours below. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { wcClockSpec } from "../fixtures/specs";

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const CLI = path.join(process.cwd(), "packages", "codegen", "src", "cli.ts");
const available = fs.existsSync(TSX);

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-cli-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeSpec(dir: string, spec: unknown): string {
  const at = path.join(dir, "spec.json");
  fs.writeFileSync(at, JSON.stringify(spec, null, 2));
  return at;
}

describe.skipIf(!available)("codegen CLI", () => {
  it("refuses, with an exit code and a reason, when --spec is missing", () => {
    const result = run(["--out", "/tmp"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--spec <spec\.json> is required/);
  });

  it("refuses a spec that is not generatable, naming the field", () => {
    withTempDir((dir) => {
      const broken = { ...JSON.parse(JSON.stringify(wcClockSpec)) as Record<string, unknown>, id: "docusign" };
      const result = run(["--spec", writeSpec(dir, broken), "--out", dir]);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/already a hand-written sub-app/);
      expect(fs.existsSync(path.join(dir, "server"))).toBe(false);
    });
  });

  it("lists what it would write under --dry-run, and writes nothing", () => {
    withTempDir((dir) => {
      const result = run(["--spec", writeSpec(dir, wcClockSpec), "--out", dir, "--dry-run"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/dry-run.*wc-clock/);
      expect(result.stdout).toContain("server/subapps/wc-clock/manifest.ts");
      expect(result.stdout).toContain("tests/subapps/wc-clock/wcClockConformance.test.ts");
      expect(fs.existsSync(path.join(dir, "server"))).toBe(false);
    });
  });

  it("writes the sub-app, then refuses to overwrite it without --force", () => {
    withTempDir((dir) => {
      const spec = writeSpec(dir, wcClockSpec);
      expect(run(["--spec", spec, "--out", dir]).status).toBe(0);
      expect(fs.existsSync(path.join(dir, "server/subapps/wc-clock/manifest.ts"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "web/src/subapps/wc-clock/index.tsx"))).toBe(true);

      const second = run(["--spec", spec, "--out", dir]);
      expect(second.status).toBe(1);
      expect(second.stderr).toMatch(/already exist — pass --force/);

      expect(run(["--spec", spec, "--out", dir, "--force"]).status).toBe(0);
    });
  });

  it("emits a registry patch when the host's registry is under --out", () => {
    withTempDir((dir) => {
      const registryAt = path.join(dir, "server", "subapps", "registry.ts");
      fs.mkdirSync(path.dirname(registryAt), { recursive: true });
      fs.writeFileSync(
        registryAt,
        [
          'import { subAppManifestSchema, type SubAppManifest } from "./types.js";',
          'import { shellReferenceManifest } from "./shell-reference/manifest.js";',
          "",
          "export const SUBAPP_MANIFESTS: SubAppManifest[] = [",
          "  shellReferenceManifest,",
          "];",
          "",
        ].join("\n"),
      );
      expect(run(["--spec", writeSpec(dir, wcClockSpec), "--out", dir]).status).toBe(0);
      const diff = fs.readFileSync(path.join(dir, "server/subapps/registry.ts.patch"), "utf8");
      expect(diff).toContain('+import { wcClockManifest } from "./wc-clock/manifest.js";');
      expect(diff).toContain("+  wcClockManifest,");
      // The registry itself is READ, never written: mounting stays a human act.
      expect(fs.readFileSync(registryAt, "utf8")).not.toContain("wcClockManifest");
    });
  });
});
