/** Is the emitted sub-app something a Flightdeck host can BUILD?
 *
 * ⭐ THE FAILURE THIS FILE EXISTS FOR, STATED PLAINLY. An earlier Studio
 * mounted: all four of the host's sub-app fences passed and the suite gained
 * four green tests. It still did not install. `service/pipeline.ts` imported
 * `@spec/index`, `@codegen/pure` and `@conformance/gate` — Studio's own
 * sibling packages — so following the documented install (two lines in
 * `registry.ts`) produced:
 *
 *     Cannot find package '@spec/index' imported from
 *     server/subapps/studio/service/pipeline.ts
 *
 * and vendoring the forty-six modules those three specifiers reach turned the
 * host's `npm run typecheck` red, because they are authored for Studio's
 * `moduleResolution: bundler` rather than the host's.
 *
 * "Mounts" and "the host can build it" are different claims, and the old
 * closure test only checked the first. It asked whether the closure was
 * `node:`-free — a runtime-safety question — and answered yes about a closure
 * containing twelve thousand lines of another repository. This file asks the
 * second question: does anything in the emitted tree name a module a
 * Flightdeck checkout does not already have?
 *
 * ⛔ THE LIST OF ALLOWED SPECIFIERS IS DELIBERATELY TINY, and it is spelled
 * out in `emit.ts` as the install requirement rather than kept here. A future
 * edit that reaches for a fifth package fails this test before it reaches
 * anybody's host.
 *
 * `typescript`'s own `preProcessFile` supplies the import list, so an import
 * spelled in a way a regex would miss is still seen. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { EMIT_MANIFEST, HOST_DEPENDENCIES, HOST_STANDINS, NODE_BUILTINS_IN_TESTS, STUDIO_ONLY } from "../emit.js";

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

function walkClosure(entries: readonly string[]): ClosureResult {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const unresolved: string[] = [];
  const queue = [...entries];

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

const EMITTED = EMIT_MANIFEST.map((file) => join(PACKAGE_SRC, file.source));
const MOUNTED = EMIT_MANIFEST.filter((file) => file.role !== "host-test").map((file) => join(PACKAGE_SRC, file.source));
const STANDINS = new Set(HOST_STANDINS.map((file) => join(PACKAGE_SRC, file)));

/* ══════════════════════════════════════════════════════════════════════════
 * The claim that matters
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the emitted tree is self-contained", () => {
  const closure = walkClosure(EMITTED);

  it("resolves every relative import it names", () => {
    expect(closure.unresolved).toEqual([]);
  });

  it("names only packages a Flightdeck host already has", () => {
    const unexpected = [...closure.bare].filter(
      (specifier) => !specifier.startsWith("node:") && !HOST_DEPENDENCIES.includes(specifier) && specifier !== "vitest",
    );
    expect(unexpected, "a host would have to install these before Studio would build").toEqual([]);
  });

  it("names NO engine package — the whole reason the old install did not work", () => {
    const engine = [...closure.bare].filter((s) => /^@(spec|codegen|conformance)\b/.test(s));
    expect(engine).toEqual([]);
    const reached = closure.files.map((f) => relative(REPO_ROOT, f));
    expect(reached.filter((f) => f.startsWith("packages/spec/"))).toEqual([]);
    expect(reached.filter((f) => f.startsWith("packages/codegen/"))).toEqual([]);
    expect(reached.filter((f) => f.startsWith("packages/conformance/"))).toEqual([]);
  });

  it("reaches no file outside this package's own emitted tree and host stand-ins", () => {
    const stray = closure.files.filter((file) => !EMITTED.includes(file) && !STANDINS.has(file));
    expect(stray.map((f) => relative(REPO_ROOT, f))).toEqual([]);
  });

  it("closes over a small, reviewable set — a closure nobody can read is a closure nobody checks", () => {
    // Ten emitted files plus the host modules they reach. The version this
    // replaced closed over fifty-three.
    expect(closure.files.length).toBeLessThan(25);
    expect(closure.files.length).toBeGreaterThanOrEqual(EMITTED.length);
  });

  it("needs no tsconfig path alias: every non-bare specifier is relative", () => {
    for (const file of EMITTED) {
      for (const specifier of importsOf(file)) {
        const bare = !specifier.startsWith(".");
        const aliased = Object.keys(ALIASES).some((prefix) => specifier.startsWith(prefix));
        expect(aliased, `${relative(PACKAGE_SRC, file)} imports the aliased ${specifier}`).toBe(false);
        if (!bare) {
          // The host resolves relative ESM imports by their `.js` spelling.
          expect(
            /\.jsx?$/.test(specifier) || /\/registry$/.test(specifier),
            `${relative(PACKAGE_SRC, file)} imports ${specifier} without a .js extension`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("the MOUNTED half reaches no disk at all", () => {
  const closure = walkClosure(MOUNTED);

  it("contains no `node:` specifier anywhere in it", () => {
    // An import merely PRESENT in a mounted module's closure fails the host's
    // `tests/subapps/subappImportClosure.test.ts`, whether or not it is called.
    expect([...closure.bare].filter((s) => s.startsWith("node:"))).toEqual([]);
  });

  it("contains no filesystem or database module under any spelling", () => {
    expect([...closure.bare].filter((s) => FORBIDDEN_BARE.includes(s))).toEqual([]);
  });

  it("names only zod, fastify and react", () => {
    expect([...closure.bare].sort()).toEqual(["fastify", "react", "zod"]);
  });

  it("never reaches a sibling sub-app or the host registry", () => {
    const reached = closure.files.map((f) => relative(REPO_ROOT, f));
    expect(reached.some((f) => /subapps\/(?!studio)[a-z-]+\//.test(f))).toBe(false);
    expect(reached.some((f) => f.endsWith("server/subapps/registry.ts"))).toBe(false);
  });
});

describe("the emitted TESTS are allowed a filesystem, and nothing else is", () => {
  const testFiles = EMIT_MANIFEST.filter((file) => file.role === "host-test").map((file) => join(PACKAGE_SRC, file.source));

  it("there are emitted tests to check", () => {
    expect(testFiles.length).toBe(3);
  });

  it("each names only node builtins the mapping admits for tests", () => {
    for (const file of testFiles) {
      const node = importsOf(file).filter((s) => s.startsWith("node:"));
      for (const specifier of node) {
        expect(NODE_BUILTINS_IN_TESTS, `${relative(PACKAGE_SRC, file)} imports ${specifier}`).toContain(specifier);
      }
    }
  });

  it("at least one of them DOES read the filesystem — otherwise the rule above checks nothing", () => {
    expect(testFiles.some((file) => importsOf(file).includes("node:fs"))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Studio's own side of the line
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the engine still runs, and still stays behind the line", () => {
  const conversion = join(PACKAGE_SRC, "studio/conversion.ts");
  const closure = walkClosure([conversion]);

  it("is listed as Studio-only, and is not in the emit manifest", () => {
    expect(STUDIO_ONLY).toContain("studio/conversion.ts");
    expect(EMIT_MANIFEST.map((file) => file.source)).not.toContain("studio/conversion.ts");
  });

  it("actually reaches all three engine packages — otherwise this test proves nothing", () => {
    const reached = closure.files.map((f) => relative(REPO_ROOT, f));
    expect(reached).toContain("packages/spec/src/workflowPlan.ts");
    expect(reached).toContain("packages/codegen/src/generate.ts");
    expect(reached).toContain("packages/conformance/src/gate.ts");
    // The size that made it unmountable, measured rather than asserted about.
    expect(closure.files.length).toBeGreaterThan(40);
  });

  it("reads the host's bundle contract, and the host reads nothing of Studio's", () => {
    // One-way by design: Studio compiles against the emitted schema, so a
    // bundle it builds that the host would reject is a typecheck error here.
    const reached = closure.files.map((f) => relative(PACKAGE_SRC, f));
    expect(reached).toContain("server/subapps/studio/service/bundle.ts");
    for (const file of EMITTED) {
      expect(importsOf(file).some((s) => s.includes("conversion")), `${relative(PACKAGE_SRC, file)} imports Studio's engine half`).toBe(false);
    }
  });

  it("never reaches @codegen's or @conformance's filesystem half", () => {
    const reached = closure.files.map((f) => relative(REPO_ROOT, f));
    expect(reached).not.toContain("packages/codegen/src/apply.ts");
    expect(reached).not.toContain("packages/codegen/src/cli.ts");
    expect(reached).not.toContain("packages/codegen/src/index.ts");
    expect(reached).not.toContain("packages/conformance/src/ship.ts");
    expect(reached).not.toContain("packages/conformance/src/index.ts");
    expect(reached.some((f) => f.startsWith("packages/conformance/src/verify"))).toBe(false);
  });
});

describe("the package as a whole", () => {
  const shipped = allPackageFiles(PACKAGE_SRC).filter(
    (file) => !file.includes("__tests__") && !file.includes(`${PACKAGE_SRC}/tests/`),
  );

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
});
