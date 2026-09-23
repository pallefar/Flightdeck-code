/** The red-team must be a real test in every case it lists.
 *
 * ⭐ THE DEFECT THIS FILE PINS. The "table prefix not subapp_<id>_" case was
 * `{ ...files, [man]: files[man]! }` — an unchanged copy — so every run
 * printed SKIP and then "7/7": FD-S001/FD-S002 (a table outside the sub-app
 * prefix) and FD-M008 (a `contributions` member) were never planted at all,
 * and promote.sh step 2 read the 7/7 as a clean red-team.
 *
 * Runs the script exactly as promote.sh does and reads its output the same
 * way: the summary must match promote.sh's grep, be N/N with N pinned, and
 * no case may SKIP, MISS or THROW. */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TSX = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const SCRIPT = path.join(process.cwd(), "scripts", "redteam-gate.ts");

describe("scripts/redteam-gate.ts", () => {
  const out = execFileSync(TSX, [SCRIPT], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  it("plants every case for real — no SKIP, no MISSED, no THREW", () => {
    expect(out).not.toMatch(/^ {2}SKIP/m);
    expect(out).not.toMatch(/^ {2}MISSED/m);
    expect(out).not.toMatch(/^ {2}THREW/m);
  });

  it("blocks a table outside subapp_<id>_ with FD-S001 (DDL) and FD-S002 (queries)", () => {
    const line = out.split("\n").find((l) => l.includes("table prefix not subapp_<id>_")) ?? "";
    expect(line).toMatch(/^ {2}BLOCKED/);
    expect(line).toContain("FD-S001");
    expect(line).toContain("FD-S002");
  });

  it("blocks a manifest that declares host-surface contributions with FD-M008", () => {
    const line = out.split("\n").find((l) => l.includes("contributions")) ?? "";
    expect(line).toMatch(/^ {2}BLOCKED/);
    expect(line).toContain("FD-M008");
  });

  it("prints the summary promote.sh step 2 greps for, and it reads 9/9", () => {
    const summary = out.match(/[0-9]+\/[0-9]+ planted violations produced a BLOCKING finding/g)?.at(-1);
    expect(summary).toBe("9/9 planted violations produced a BLOCKING finding");
  });
});
