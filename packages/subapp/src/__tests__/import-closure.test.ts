/** The route's STATIC IMPORT CLOSURE, walked.
 *
 * ⭐ WHY A CLOSURE WALK AND NOT A GREP. The host's
 * `tests/subapps/subappImportClosure.test.ts` fails a sub-app whose static
 * import closure merely CONTAINS `node:fs`, a database driver or a host reader
 * module — whether or not the code ever calls it. So the interesting failure is
 * never a `node:fs` in a Studio file; it is a `node:fs` three hops away, pulled
 * in by an import that looked harmless. `@codegen/index` re-exports `apply.ts`,
 * which imports `node:fs` correctly (it is the CLI half, the part a human runs
 * to apply an approved proposal) — so a Studio route writing
 * `from "@codegen"` instead of `from "@codegen/pure"` would fail the host's
 * fence with a generator that never opens a file. That is a one-character
 * mistake, and only a walk catches it.
 *
 * Two things are checked, separately:
 *   1. The closure of `routes/index.ts` — everything a request can reach.
 *   2. Every module in this package, whether or not a route reaches it.
 *
 * `typescript`'s own `preProcessFile` supplies the import list, so an import
 * spelled in a way a regex would miss is still seen. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_SRC = resolve(HERE, "..");
const REPO_ROOT = resolve(PACKAGE_SRC, "../../..");

/** Where the tsconfig `paths` point. Kept here rather than read out of the
 * tsconfig on purpose: if somebody adds an alias, this test should NOT silently
 * start following it. */
const ALIASES: Readonly<Record<string, string>> = {
  "@spec/": join(REPO_ROOT, "packages/spec/src/"),
  "@codegen/": join(REPO_ROOT, "packages/codegen/src/"),
  "@conformance/": join(REPO_ROOT, "packages/conformance/src/"),
};

/** External packages a sub-app route may legitimately name. Everything else
 * bare is a finding, so adding a dependency to a route is a deliberate edit to
 * this list rather than something that happens quietly. */
const ALLOWED_BARE = new Set(["fastify", "zod", "react", "react-dom"]);

/** Anything that reaches a disk or a database. The `node:` prefix is checked
 * separately and covers the rest of the standard library. */
const FORBIDDEN_BARE = [
  "fs",
  "path",
  "os",
  "child_process",
  "better-sqlite3",
  "sqlite3",
  "node-sqlite3-wasm",
  "libsql",
  "@libsql/client",
  "pg",
  "mysql",
  "mysql2",
  "knex",
  "drizzle-orm",
  "typeorm",
  "prisma",
  "@prisma/client",
];

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return ts.preProcessFile(source, true, true).importedFiles.map((ref) => ref.fileName);
}

/** Resolve a specifier the way the bundler does: `./x.js` is TypeScript's own
 * ESM spelling for `./x.ts`. Returns null for an unresolvable path, which the
 * caller reports rather than swallows. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    const alias = Object.keys(ALIASES).find((prefix) => specifier.startsWith(prefix));
    if (alias === undefined) return null;
    base = join(ALIASES[alias] as string, specifier.slice(alias.length));
  }
  const withoutJs = base.replace(/\.js$/, "");
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface ClosureResult {
  readonly files: string[];
  readonly bare: Set<string>;
  readonly unresolved: string[];
}

function walkClosure(entry: string): ClosureResult {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith("node:")) {
        bare.add(specifier);
        continue;
      }
      const resolved = resolveSpecifier(file, specifier);
      if (resolved === null) {
        if (specifier.startsWith(".") || Object.keys(ALIASES).some((p) => specifier.startsWith(p))) {
          unresolved.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
        } else {
          bare.add(specifier);
        }
        continue;
      }
      queue.push(resolved);
    }
  }
  return { files: [...seen], bare, unresolved };
}

function allPackageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...allPackageFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the route's static import closure", () => {
  const entry = join(PACKAGE_SRC, "server/subapps/studio/routes/index.ts");
  const closure = walkClosure(entry);

  it("resolves every relative and aliased import it names", () => {
    expect(closure.unresolved).toEqual([]);
  });

  it("actually reaches the three engine packages — otherwise this test proves nothing", () => {
    const reached = closure.files.map((f) => relative(REPO_ROOT, f));
    expect(reached).toContain("packages/spec/src/workflowPlan.ts");
    expect(reached).toContain("packages/codegen/src/generate.ts");
    expect(reached).toContain("packages/conformance/src/gate.ts");
    // A closure this size is the point: a grep over four Studio files would
    // have looked just as green while missing all of it.
    expect(closure.files.length).toBeGreaterThan(20);
  });

  it("contains no `node:` specifier anywhere in it", () => {
    const node = [...closure.bare].filter((s) => s.startsWith("node:"));
    expect(node).toEqual([]);
  });

  it("contains no filesystem or database module under any spelling", () => {
    const forbidden = [...closure.bare].filter((s) => FORBIDDEN_BARE.includes(s));
    expect(forbidden).toEqual([]);
  });

  it("names only the external packages a sub-app route is allowed to name", () => {
    const unexpected = [...closure.bare].filter((s) => !ALLOWED_BARE.has(s));
    expect(unexpected).toEqual([]);
  });

  it("never reaches @codegen's or @conformance's filesystem half", () => {
    const reached = closure.files.map((f) => relative(REPO_ROOT, f));
    // Each of these opens a file, and an import merely PRESENT in the closure
    // fails the host's fence.
    expect(reached).not.toContain("packages/codegen/src/apply.ts");
    expect(reached).not.toContain("packages/codegen/src/cli.ts");
    expect(reached).not.toContain("packages/codegen/src/index.ts");
    expect(reached).not.toContain("packages/conformance/src/ship.ts");
    expect(reached).not.toContain("packages/conformance/src/index.ts");
    expect(reached.some((f) => f.startsWith("packages/conformance/src/verify"))).toBe(false);
  });

  it("never reaches a sibling sub-app or the host registry", () => {
    const reached = closure.files.map((f) => relative(REPO_ROOT, f));
    expect(reached.some((f) => /subapps\/(?!studio)[a-z-]+\//.test(f))).toBe(false);
    expect(reached.some((f) => f.endsWith("subapps/registry.ts"))).toBe(false);
  });
});

describe("the package as a whole", () => {
  const shipped = allPackageFiles(PACKAGE_SRC).filter((file) => !file.includes("__tests__"));

  it("has modules to check — a loop over an empty list is a green test that proves nothing", () => {
    expect(shipped.length).toBeGreaterThan(10);
  });

  for (const file of shipped) {
    it(`${relative(PACKAGE_SRC, file)} imports no filesystem or database module`, () => {
      const specifiers = importsOf(file);
      expect(specifiers.filter((s) => s.startsWith("node:"))).toEqual([]);
      expect(specifiers.filter((s) => FORBIDDEN_BARE.includes(s))).toEqual([]);
    });
  }

  it("the test files ARE allowed a filesystem — otherwise this very file could not exist", () => {
    const thisFile = join(PACKAGE_SRC, "__tests__/import-closure.test.ts");
    expect(importsOf(thisFile)).toContain("node:fs");
  });
});
