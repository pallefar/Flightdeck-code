/** Which specs `scripts/promote.sh` and `scripts/mount-in-host.sh` may take
 * into the host at all.
 *
 * ⛔ WHY A TABLE-BACKED SPEC CANNOT BE CERTIFIED. On Postgres the host skips
 * every sub-app `initSchema` (flightdeck/server/workspace/runtime.ts: under
 * POSTGRES_ENABLED the migration files are the single source of schema truth
 * and the app role holds no DDL rights), and the host's
 * `tests/subapps/schemaMigrationParity.test.ts` fails any runtime CREATE TABLE
 * that has no migration. Codegen emits a `schema.ts` for profile
 * "table-backed" and NO migration, so such a sub-app's tables would exist on
 * SQLite and not on the tier the product ships on. The scripts therefore ask
 * `cli.ts --check-certifiable` first and stop, exit 2, before any sandbox.
 *
 * ⚠ What this does NOT change: `cli.ts --spec … --out …`, `--dry-run` and
 * `--standalone` still generate the table-backed shape (cli.test.ts and
 * standalone.test.ts pin that). Generating is not certifying. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { certifiableProfile } from "../profile";
import { contractRunSpec, minimalSpec, wcClockSpec } from "../fixtures/specs";

describe("certifiableProfile", () => {
  it("a mini-app spec (no profile, the default) is certifiable", () => {
    expect(certifiableProfile(contractRunSpec)).toEqual({ ok: true, profile: "mini-app" });
    expect(certifiableProfile(minimalSpec)).toEqual({ ok: true, profile: "mini-app" });
  });

  it("a spec that names profile mini-app explicitly is certifiable", () => {
    expect(certifiableProfile({ ...contractRunSpec, profile: "mini-app" })).toEqual({ ok: true, profile: "mini-app" });
  });

  it("⛔ a table-backed spec is refused with table_backed_needs_migration, and the reason says why", () => {
    const verdict = certifiableProfile(wcClockSpec);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe("table_backed_needs_migration");
    expect(verdict.reason).toContain("wc-clock");
    expect(verdict.reason).toMatch(/Postgres/);
    expect(verdict.reason).toMatch(/migration/);
  });

  it("⛔ fails closed on a profile it does not know, and on a spec that is not an object", () => {
    for (const spec of [{ ...contractRunSpec, profile: "Table-Backed" }, { ...contractRunSpec, profile: 1 }, null, [], "mini-app"]) {
      const verdict = certifiableProfile(spec);
      expect(verdict.ok, JSON.stringify(spec)).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe("profile_unrecognised");
    }
  });
});

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const CLI = path.join(process.cwd(), "packages", "codegen", "src", "cli.ts");

function check(spec: unknown): { status: number; stdout: string; stderr: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-certifiable-"));
  try {
    const at = path.join(dir, "spec.json");
    fs.writeFileSync(at, JSON.stringify(spec));
    try {
      const stdout = execFileSync(TSX, [CLI, "--check-certifiable", "--spec", at], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { status: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    } finally {
      // Nothing but the spec may be in the directory: the check writes nothing.
      expect(fs.readdirSync(dir)).toEqual(["spec.json"]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!fs.existsSync(TSX))("cli.ts --check-certifiable", () => {
  it("exits 0 for a mini-app spec, and needs no --out", () => {
    const r = check(contractRunSpec);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("certifiable");
  });

  it("⛔ exits 2 for a table-backed spec and prints the code", () => {
    const r = check(wcClockSpec);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("table_backed_needs_migration");
  });

  it("⛔ exits 2 for an unknown profile", () => {
    const r = check({ ...contractRunSpec, profile: "sql" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("profile_unrecognised");
  });

  it("the three shipped fixtures (wc-clock, contract-run, shift-notes) are all certifiable", () => {
    for (const name of ["wc-clock", "contract-run", "shift-notes"]) {
      const spec: unknown = JSON.parse(fs.readFileSync(path.join(process.cwd(), "fixtures", `${name}.spec.json`), "utf8"));
      const r = check(spec);
      expect(r.status, `${name}: ${r.stderr}`).toBe(0);
    }
  });
});
