/**
 * ⭐ THE STANDALONE TREE TYPECHECKS — asked at test time, not only by
 * `npm run standalone`.
 *
 * `standalone.test.ts` proves the tree RESOLVES; it cannot prove it COMPILES.
 * The manifest emitter learned a `migrations` field (host sdk-63) while the
 * standalone `SubAppManifest` interface did not, and every table-backed app's
 * standalone tree then failed with TS2353 — found by a reviewer running tsc by
 * hand. This writes each fixture's full tree to a temp dir, links this repo's
 * node_modules, and runs the TypeScript compiler on the tree's OWN tsconfig.
 *
 * TS reports only the FIRST excess property of an object literal, so one
 * missing member hides the next: `settingsPanel` (already missing) masked
 * `migrations`. The fourth case adds a `listing` so every optional manifest
 * member the emitter can write is present in at least one compiled tree.
 *
 * ⚠ KNOWN, NOT FIXED HERE: the table profile's routes/schema call `rt.db` /
 * `db.exec`, and the standalone `Db` / `WorkspaceRuntime` shims are
 * deliberately driverless (`db: unknown`, optional members, `db: null` at
 * runtime). That is the standalone DB story, a separate item. Those
 * diagnostics are pinned EXACTLY below — a new one, anywhere, fails; the
 * manifest itself must be clean in every tree.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { generateSubApp } from "../generate";
import { contractRunSpec, minimalSpec, registryFixture, wcClockSpec } from "../fixtures/specs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const apps = [
  { name: "wc-clock", app: () => generateSubApp(wcClockSpec, { registrySource: registryFixture }) },
  { name: "contract-run", app: () => generateSubApp(contractRunSpec, { registrySource: registryFixture }) },
  { name: "shift-notes", app: () => generateSubApp(minimalSpec) },
  {
    name: "wc-clock + listing",
    app: () =>
      generateSubApp(
        {
          ...wcClockSpec,
          listing: {
            availability: "available",
            category: "documents",
            requirements: ["docusign"],
            publisher: { name: "Flightdeck" },
          },
        },
        { registrySource: registryFixture },
      ),
  },
];

/** The table profile's driverless-DB gap (see header). Keyed by file. */
const TABLE_PROFILE_DB_GAP = [
  "server/subapps/wc-clock/routes/clocks.ts: TS18046 'rt.db' is of type 'unknown'.",
  "server/subapps/wc-clock/routes/clocks.ts: TS18046 'rt.db' is of type 'unknown'.",
  "server/subapps/wc-clock/routes/clocks.ts: TS18046 'rt.db' is of type 'unknown'.",
  "server/subapps/wc-clock/schema.ts: TS2722 Cannot invoke an object which is possibly 'undefined'.",
];
const knownGap = (name: string): string[] => (name.startsWith("wc-clock") ? TABLE_PROFILE_DB_GAP : []);

describe.each(apps)("$name standalone tree", ({ name, app }) => {
  it("⭐ typechecks on its own tsconfig (tsc --noEmit -p standalone/tsconfig.json)", () => {
    const generated = app();
    const root = mkdtempSync(join(tmpdir(), "codegen-standalone-tsc-"));
    roots.push(root);
    for (const file of generated.files) {
      if (file.kind === "patch") continue;
      const target = join(root, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.contents);
    }
    symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"), "dir");

    const configPath = join(root, "standalone/tsconfig.json");
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
    expect(parsed.errors).toEqual([]);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
      const where = d.file ? `${d.file.fileName.slice(root.length + 1)}` : "<global>";
      return `${where}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
    });
    const manifestFile = `server/subapps/${generated.plan.id}/manifest.ts`;
    expect(diagnostics.filter((d) => d.startsWith(`${manifestFile}:`))).toEqual([]);
    expect(diagnostics).toEqual(knownGap(name));
  }, 120_000);
});
