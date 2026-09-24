/** `docs/FLIGHTDECK-SUBAPP-CONTRACT.md` is the law this package enforces, and
 * two of its sections TRANSCRIBE the host. Transcribed facts get a drift test
 * (HANDOVER §5.4), read off the host checkout at `FLIGHTDECK_HOST_ROOT`.
 *
 * ⭐ WHY THIS EXISTS. §8 said `TOTAL_KEYS = 4071` at `i18nSplit.test.ts:709`
 * with per-sub-app counts 480/376/722. Measured on 2026-09-23 the host read
 * 4582 at line 978, and 600/429/760, and nothing noticed: a count copied into
 * prose with no date and no commit cannot be checked and cannot be seen to be
 * old. §11 listed the host's "prior art" generators and missed the one that
 * matters most to Studio, the Phase H sub-app SDK (`npm run scaffold:subapp`,
 * `server/subapps/conformance.ts`, host 981efc19).
 *
 * What is pinned, and what deliberately is not:
 *
 *  - §8's numbers are a SNAPSHOT at a named host commit, checked against that
 *    commit with `git show`. They are not compared with the host's working
 *    tree, because the counts move with every key a sub-app adds and two
 *    legitimate host checkouts on this Mac already disagree. A test that
 *    pinned the live numbers would turn Studio's suite (and promote.sh's
 *    studio-suite stack) red on every host i18n change.
 *  - The CLAIM §8 exists to make — the fence is exact equality on named
 *    constants — is checked against the live host: every constant the
 *    snapshot names must still be declared as an integer literal, and the
 *    total must still be asserted with `toBe`.
 *  - §11 must name every `scaffold:*` generator the host's package.json
 *    declares and the host's conformance kit when it has one; every host path
 *    §11 names must exist. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOST_ROOT } from "../../guardrails/src/host-source";

const DOC = path.resolve(__dirname, "..", "..", "..", "docs", "FLIGHTDECK-SUBAPP-CONTRACT.md");
const I18N_TEST_REL = "flightdeck/tests/subapps/i18nSplit.test.ts";
const HOST_I18N_TEST = path.join(HOST_ROOT, I18N_TEST_REL);
const HOST_PACKAGE = path.join(HOST_ROOT, "flightdeck", "package.json");
const HOST_KIT_REL = "flightdeck/server/subapps/conformance.ts";

const available = fs.existsSync(HOST_I18N_TEST) && fs.existsSync(HOST_PACKAGE);

/** The body of `## <n>. …` up to the next `#`/`##` heading. */
function section(doc: string, n: number): string {
  const start = doc.search(new RegExp(`^## ${n}\\. `, "m"));
  if (start < 0) throw new Error(`FLIGHTDECK-SUBAPP-CONTRACT.md has no "## ${n}." section`);
  const bodyStart = doc.indexOf("\n", start) + 1;
  const rest = doc.slice(bodyStart);
  const end = rest.search(/^#{1,2} /m);
  return end < 0 ? rest : rest.slice(0, end);
}

const doc = fs.readFileSync(DOC, "utf8");

/** §8's snapshot: "Measured at host `<sha>`" and a table of `| <line> | `<code>` |`. */
function snapshot(): { sha: string; rows: { line: number; code: string }[] } {
  const s8 = section(doc, 8);
  const sha = /Measured at host `([0-9a-f]{7,40})`/.exec(s8)?.[1];
  if (sha === undefined) {
    throw new Error("§8 quotes host counts without naming the host commit they were measured at (\"Measured at host `<sha>`\")");
  }
  const rows = [...s8.matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => ({ line: Number(m[1]), code: m[2]! }));
  return { sha, rows };
}

describe.skipIf(!available)("FLIGHTDECK-SUBAPP-CONTRACT.md against the host", () => {
  it("§8 quotes the host's i18n fence line for line, at the host commit it names", () => {
    const { sha, rows } = snapshot();
    expect(rows.length, "§8 has no `| line | `code` |` rows").toBeGreaterThan(0);
    const shown = spawnSync("git", ["-C", HOST_ROOT, "show", `${sha}:${I18N_TEST_REL}`], { encoding: "utf8" });
    expect(
      shown.status,
      `git show ${sha}:${I18N_TEST_REL} failed in ${HOST_ROOT} (${shown.stderr.trim()}). ` +
        "The host checkout does not hold the commit §8 cites — fetch it (git -C \"$FLIGHTDECK_HOST_ROOT\" fetch origin).",
    ).toBe(0);
    const lines = shown.stdout.split(/\r?\n/);
    const wrong = rows
      .filter((r) => (lines[r.line - 1] ?? "").trim() !== r.code)
      .map((r) => `line ${r.line}: doc \`${r.code}\`, host \`${(lines[r.line - 1] ?? "<none>").trim()}\``);
    expect(wrong, `§8 misquotes ${I18N_TEST_REL} at ${sha}`).toEqual([]);
  });

  it("§8's claim still holds on the live host: the named counts are exact integer constants and the total is asserted with toBe", () => {
    const live = fs.readFileSync(HOST_I18N_TEST, "utf8");
    const names = snapshot()
      .rows.map((r) => /^const ([A-Z_]+) = \d+;$/.exec(r.code)?.[1])
      .filter((n): n is string => n !== undefined);
    expect(names).toContain("TOTAL_KEYS");
    const gone = names.filter((n) => !new RegExp(`^const ${n} = \\d+;$`, "m").test(live));
    expect(gone, "the host no longer freezes these counts as integer constants — re-derive §8").toEqual([]);
    expect(live).toContain("expect(Object.keys(DICT).length).toBe(TOTAL_KEYS);");
  });

  it("§11 names every scaffold generator the host's package.json declares, and no script it lacks", () => {
    const s11 = section(doc, 11);
    const scripts = Object.keys((JSON.parse(fs.readFileSync(HOST_PACKAGE, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {});
    const hostScaffolds = scripts.filter((s) => s.startsWith("scaffold:"));
    const named = [...s11.matchAll(/`(?:npm run )?(scaffold:[a-z0-9-]+)`/g)].map((m) => m[1]!);
    expect(hostScaffolds.filter((s) => !named.includes(s)), "host scaffold scripts §11 does not name").toEqual([]);
    expect(named.filter((s) => !scripts.includes(s)), "§11 names scripts the host does not declare").toEqual([]);
  });

  it("§11 names the host's sub-app conformance kit when the host has one, and every host path it names exists", () => {
    const s11 = section(doc, 11);
    if (fs.existsSync(path.join(HOST_ROOT, HOST_KIT_REL))) {
      expect(s11).toContain(`\`${HOST_KIT_REL}\``);
    }
    const paths = [...s11.matchAll(/`((?:flightdeck|docs)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|md|mjs))`/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => !fs.existsSync(path.join(HOST_ROOT, p))), "§11 names host paths that do not exist").toEqual([]);
  });
});
