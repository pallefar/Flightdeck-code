/** The import closure of the route-safe entry point.
 *
 * ⭐ WHAT THIS PINS. Studio runs as a sub-app of the host it generates
 * for, and a sub-app route may not reach `node:fs`, a database driver or a
 * host reader module — contract rule 3, which the host enforces by walking
 * the STATIC IMPORT CLOSURE (`tests/subapps/subappImportClosure.test.ts`).
 * A closure check does not care whether the code CALLS the filesystem; the
 * import being reachable is the failure.
 *
 * So this walks `pure.ts`'s closure the same way the host would, from the
 * files on disk, and fails on the first `node:` specifier. It also proves
 * the split is real rather than decorative, by checking that `index.ts` —
 * the CLI-and-tests entry point — genuinely does reach the filesystem. If
 * `pure.ts` ever quietly re-exports `apply.ts`, this goes red here instead
 * of going red in somebody's host repo at mount time. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_RE = /^\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s+"([^"]+)";?\s*$/gm;
const BARE_NAMESPACE_RE = /^\s*export\s+\*\s+as\s+\w+\s+from\s+"([^"]+)";?\s*$/gm;

/** Every module reachable from `entry` by relative import, plus every bare
 * specifier those modules name. Deliberately textual, like the host's own
 * check: it reads what the file SAYS, not what a bundler resolves. */
function closureOf(entry: string): { files: string[]; bare: string[] } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [path.join(SRC, entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const re of [IMPORT_RE, BARE_NAMESPACE_RE]) {
      re.lastIndex = 0;
      for (const match of source.matchAll(re)) {
        const specifier = match[1] as string;
        if (!specifier.startsWith(".")) {
          bare.add(specifier);
          continue;
        }
        const resolved = path.resolve(path.dirname(file), specifier);
        const candidate = [resolved, `${resolved}.ts`, path.join(resolved, "index.ts")].find(
          (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
        );
        if (candidate !== undefined) queue.push(candidate);
      }
    }
  }
  return { files: [...seen].map((f) => path.relative(SRC, f)).sort(), bare: [...bare].sort() };
}

describe("pure.ts — what a Studio route may import", () => {
  const closure = closureOf("pure.ts");

  it("reaches no node builtin at all", () => {
    const builtins = closure.bare.filter((s) => s.startsWith("node:"));
    expect(builtins, `reachable through: ${closure.files.join(", ")}`).toEqual([]);
  });

  it("reaches no database driver and no filesystem-shaped package", () => {
    for (const specifier of closure.bare) {
      expect(/better-sqlite3|sqlite3|^pg$|mysql|knex|drizzle|^fs-extra$|^glob$/.test(specifier), specifier).toBe(false);
    }
  });

  it("names only what generation actually needs", () => {
    expect(closure.bare).toEqual(["zod"]);
  });

  it("does not reach apply.ts or cli.ts, which are the human's half", () => {
    expect(closure.files).not.toContain("apply.ts");
    expect(closure.files).not.toContain("cli.ts");
  });

  it("still carries the whole generator", () => {
    for (const file of ["generate.ts", "plan.ts", "profile.ts", "invariants.ts", "emitters/web.ts", "emitters/manifest.ts"]) {
      expect(closure.files).toContain(file);
    }
  });
});

describe("index.ts — the CLI's and the tests' entry point", () => {
  it("does reach the filesystem, which is why a route may not import it", () => {
    const closure = closureOf("index.ts");
    expect(closure.files).toContain("apply.ts");
    expect(closure.bare).toContain("node:fs");
  });
});
