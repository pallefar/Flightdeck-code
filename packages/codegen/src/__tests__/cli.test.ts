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
import { contractRunSpec, wcClockSpec } from "../fixtures/specs";

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

function runWithStdin(args: string[], stdin: string): Run {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], { encoding: "utf8", input: stdin, stdio: ["pipe", "pipe", "pipe"] });
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

  /** Owner ruling 2026-09-22 (8), on the path `scripts/promote.sh` step 3 takes into the
   * host. A review ran exactly this and got exit 0 and 8 planned files. */
  describe("⛔ a spec whose proposal fields came from no approved template", () => {
    const invented = (): unknown => {
      const spec = JSON.parse(JSON.stringify(contractRunSpec)) as { domains: Array<{ name: string; routes: Array<Record<string, unknown>> }> };
      const flag = spec.domains.find((d) => d.name === "handoffs")?.routes.find((r) => r["path"] === "/flag");
      if (flag === undefined) throw new Error("contractRunSpec has no /flag route");
      flag["operation"] = {
        kind: "propose",
        proposalKind: "salary-change",
        ticketField: "ticket",
        auditEvent: "contract-run.salary-change-proposed",
        fields: [
          { name: "ticket", type: "string" },
          { name: "salary", type: "number" },
          { name: "employeeName", type: "string", maxLength: 120 },
        ],
      };
      return spec;
    };

    it("is refused from a file, exit 2, naming the ruling — even under --dry-run", () => {
      withTempDir((dir) => {
        const result = run(["--spec", writeSpec(dir, invented()), "--out", dir, "--dry-run"]);
        expect(result.status).toBe(2);
        expect(result.stderr).toContain("owner ruling 2026-09-22 (8)");
        expect(result.stdout).not.toContain("server/subapps/contract-run/");
      });
    });

    it("is refused from stdin — a model's output piped straight in — and writes nothing", () => {
      withTempDir((dir) => {
        const result = runWithStdin(["--spec", "-", "--out", dir], JSON.stringify(invented()));
        expect(result.status).toBe(2);
        expect(result.stderr).toContain("owner ruling 2026-09-22 (8)");
        expect(fs.existsSync(path.join(dir, "server"))).toBe(false);
      });
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

  it("writes the sub-app, and re-running the same spec is a no-op, not a refusal", () => {
    withTempDir((dir) => {
      const spec = writeSpec(dir, wcClockSpec);
      expect(run(["--spec", spec, "--out", dir]).status).toBe(0);
      expect(fs.existsSync(path.join(dir, "server/subapps/wc-clock/manifest.ts"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "web/src/subapps/wc-clock/index.tsx"))).toBe(true);
      expect(fs.existsSync(path.join(dir, ".flightdeck-codegen/wc-clock.json"))).toBe(true);

      // The executed-guard: same plan, same bytes, nothing to do. The old
      // behaviour — refuse and demand --force — is what pushed operators
      // onto the one flag that also discards their edits.
      const second = run(["--spec", spec, "--out", dir]);
      expect(second.status).toBe(0);
      expect(second.stdout).toMatch(/already on disk, byte for byte/);
    });
  });

  it("resumes an interrupted apply without --force, but refuses a hand-edited file", () => {
    withTempDir((dir) => {
      const spec = writeSpec(dir, wcClockSpec);
      expect(run(["--spec", spec, "--out", dir]).status).toBe(0);

      // Half-mounted sub-app: the failure mode the two-phase commit exists
      // to prevent, simulated after the fact. The journal knows these files
      // were ours, so the repair run needs no flag.
      const routes = path.join(dir, "server/subapps/wc-clock/routes/index.ts");
      fs.rmSync(routes);
      const resumed = run(["--spec", spec, "--out", dir]);
      expect(resumed.status).toBe(0);
      expect(fs.existsSync(routes)).toBe(true);

      // A file edited by hand is a different thing entirely: named, and
      // refused with a distinct reason.
      const guard = path.join(dir, "server/subapps/wc-clock/guard.ts");
      fs.appendFileSync(guard, "\n// operator's note\n");
      const drifted = run(["--spec", spec, "--out", dir]);
      expect(drifted.status).toBe(1);
      expect(drifted.stderr).toMatch(/guard\.ts was modified after codegen wrote it — pass --force/);
      expect(fs.readFileSync(guard, "utf8")).toContain("operator's note");

      expect(run(["--spec", spec, "--out", dir, "--force"]).status).toBe(0);
      expect(fs.readFileSync(guard, "utf8")).not.toContain("operator's note");
    });
  });

  it("refuses a pre-existing file it did not write, and writes nothing at all", () => {
    withTempDir((dir) => {
      const spec = writeSpec(dir, wcClockSpec);
      const squatter = path.join(dir, "server/subapps/wc-clock/manifest.ts");
      fs.mkdirSync(path.dirname(squatter), { recursive: true });
      fs.writeFileSync(squatter, "// somebody else's file\n");

      const result = run(["--spec", spec, "--out", dir]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/was not written by codegen — pass --force/);
      expect(result.stderr).toMatch(/nothing was written/);
      // The whole set is staged before any of it is committed, so ONE
      // refusal means NONE of the other seven files landed either.
      expect(fs.readFileSync(squatter, "utf8")).toBe("// somebody else's file\n");
      expect(fs.existsSync(path.join(dir, "web/src/subapps/wc-clock/index.tsx"))).toBe(false);
      expect(fs.existsSync(path.join(dir, "server/subapps/wc-clock/guard.ts"))).toBe(false);
    });
  });

  it("names a truncated spec on stdin as truncated, not as malformed", () => {
    withTempDir((dir) => {
      const whole = JSON.stringify(wcClockSpec);
      const result = runWithStdin(["--spec", "-", "--out", dir], whole.slice(0, Math.floor(whole.length / 2)));
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/ended mid-document .* it is truncated, not malformed/);
      expect(fs.existsSync(path.join(dir, "server"))).toBe(false);
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
