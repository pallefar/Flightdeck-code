/** `tests/subapps/<id>/<id>Conformance.test.ts` — the conformance gate,
 * emitted INTO the host repository beside the sub-app it guards.
 *
 * ── WHY THE GATE TRAVELS WITH THE APP ────────────────────────────────
 * `invariants.ts` checks the emitted text at generation time, which is
 * worth exactly as much as the moment it runs. The generated sub-app then
 * lands in somebody's repository and gets edited by hand — that is the
 * point of generating source rather than shipping a runtime. This file is
 * what keeps the contract true AFTER that: it re-derives the same rules
 * from the files on disk, under the host's own vitest run.
 *
 * Placed in `tests/subapps/<id>/` because the host's G3 layout fence
 * (`tests/subapps/subappManifest.test.ts`) requires a sub-app's tests to
 * live in their own folder rather than the flat `tests/` root. The vitest
 * glob is already recursive, so placing it is all the wiring there is.
 *
 * `node:fs` appears here and nowhere else in a generated sub-app: a TEST
 * reading source files is not a route reaching the filesystem, and every
 * host test in `tests/subapps/` does the same. */
import { banner, joinLines, str } from "../emit";
import { tablePrefix } from "../naming";
import type { SubAppPlan } from "../plan";

export function emitHostTest(plan: SubAppPlan): string {
  const domainFiles = plan.domains.map((d) => `routes/${d.fileName}`);
  return joinLines([
    banner([
      `${plan.label} conformance — GENERATED, and meant to stay. Re-derives the sub-app contract's non-negotiables from the files on disk, so a later hand-edit cannot quietly drop one.`,
      "",
      "Reads source as TEXT rather than importing it: the properties under test are properties of the files (which module a route may import, what the first statement of a handler is), and importing would test the module graph instead.",
    ]),
    `import fs from "node:fs";`,
    `import path from "node:path";`,
    `import { describe, expect, it } from "vitest";`,
    `import { subAppManifestSchema } from "../../../server/subapps/types.js";`,
    `import { HOST_VERSION, isVersionNewer } from "../../../server/subapps/registry.js";`,
    `import { ${plan.names.manifestConst} } from "../../../server/subapps/${plan.id}/manifest.js";`,
    "",
    `const SUBAPP_DIR = path.join(process.cwd(), "server", "subapps", ${str(plan.id)});`,
    `const ROUTE_FILES = ${JSON.stringify(domainFiles)};`,
    `const TABLE_PREFIX = ${str(tablePrefix(plan.id))};`,
    "",
    "/** Allowlist, not blocklist: a route file may reach these and nothing",
    " * else. A blocklist only names the escapes someone already thought of. */",
    "const ROUTE_IMPORTS = [",
    `  "zod",`,
    `  "fastify",`,
    `  "../../types.js",`,
    `  "../../../workspace/types.js",`,
    `  "../../capabilities.js",`,
    `  "../guard.js",`,
    "];",
    "",
    "function read(relative: string): string {",
    `  return fs.readFileSync(path.join(SUBAPP_DIR, relative), "utf8");`,
    "}",
    "",
    `describe(${str(`${plan.id} sub-app conformance`)}, () => {`,
    `  it("manifest validates against subAppManifestSchema", () => {`,
    `    const parsed = subAppManifestSchema.safeParse(${plan.names.manifestConst});`,
    "    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues)).toBe(true);",
    "  });",
    "",
    `  it("does not ask for a host newer than this build", () => {`,
    `    expect(isVersionNewer(${plan.names.manifestConst}.minHostVersion, HOST_VERSION)).toBe(false);`,
    "  });",
    "",
    `  it("every route handler calls the enable guard before anything else", () => {`,
    "    for (const file of ROUTE_FILES) {",
    "      const source = read(file);",
    `      const handlers = source.split(/app\\.(?:get|post|patch|delete)\\(/).slice(1);`,
    "      expect(handlers.length, file + \" registers no handler\").toBeGreaterThan(0);",
    "      for (const handler of handlers) {",
    `        const guardAt = handler.indexOf(${str(plan.names.guardFn)});`,
    "        expect(guardAt, file + \" has a handler that never calls the guard\").toBeGreaterThan(-1);",
    `        for (const token of ["safeParse", "rt.db", "capabilitiesFor", "req.body", "req.params"]) {`,
    "          const at = handler.indexOf(token);",
    "          const reached = at !== -1 && at < guardAt;",
    "          expect(reached, file + \" reaches \" + token + \" before the guard\").toBe(false);",
    "        }",
    "      }",
    "    }",
    "  });",
    "",
    `  it("route files import only from the allowlist", () => {`,
    "    for (const file of ROUTE_FILES) {",
    `      for (const match of read(file).matchAll(/^import\\s+(?:type\\s+)?.*?from\\s+"([^"]+)";$/gm)) {`,
    "        expect(ROUTE_IMPORTS, file + \" imports \" + match[1]).toContain(match[1]);",
    "      }",
    "    }",
    "  });",
    "",
    ...(plan.tables.length > 0
      ? [
          `  it("every table it creates carries the sub-app table prefix", () => {`,
          `    const schema = read("schema.ts");`,
          `    const created = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\\s+([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);`,
          "    expect(created.length).toBeGreaterThan(0);",
          "    for (const table of created) expect(table.startsWith(TABLE_PREFIX)).toBe(true);",
          "  });",
          "",
        ]
      : []),
    `  it("caches no enable-state and reads no env var of its own", () => {`,
    `    for (const file of ["guard.ts", ...ROUTE_FILES]) {`,
    "      expect(read(file).includes(\"process.env\")).toBe(false);",
    "    }",
    "  });",
    "});",
    "",
  ]);
}
