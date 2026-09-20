/** Can a mounted sub-app actually call these gates?
 *
 * ⭐ THE QUESTION NO OTHER TEST IN THIS PACKAGE ASKS. All ~150 of them import
 * the gates and run them in Node, where every builtin is simply present. They
 * measure the code. They cannot see the SEAM the code has to fit through — and
 * for the whole life of this package it did not fit: `gates.ts` imported
 * `contentHash`, `contentHash` imports `node:crypto`, `packages/conformance`
 * lists "crypto" in `NODE_BUILTINS`, and FD-C001 refuses a mounted sub-app
 * module that imports one.
 *
 * So the guardrails could not run inside a Studio route — the single process
 * the contract says this work happens in — and a full green suite said nothing
 * about it. This walks the import closure textually, exactly as the host's own
 * `subappImportClosure.test.ts` does, because an import that is merely PRESENT
 * in the closure fails the host's fence whether or not it is ever called.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_RE = /^\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s+"([^"]+)";?\s*$/gm;

function closureOf(entry: string): { files: string[]; bare: string[] } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [path.join(SRC, entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    IMPORT_RE.lastIndex = 0;
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] as string;
      if (!specifier.startsWith(".")) {
        bare.add(specifier);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), specifier).replace(/\.js$/, "");
      const candidate = [resolved, `${resolved}.ts`, path.join(resolved, "index.ts")].find(
        (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
      );
      if (candidate !== undefined) queue.push(candidate);
    }
  }
  return { files: [...seen].map((f) => path.relative(SRC, f)).sort(), bare: [...bare].sort() };
}

describe("pure.ts — what a mounted sub-app may import", () => {
  const closure = closureOf("pure.ts");

  it("⭐ reaches no node builtin at all", () => {
    // The exact rule packages/conformance/src/checks/capability-escape.ts
    // applies, and the reason this file exists.
    const builtins = closure.bare.filter((s) => s.startsWith("node:"));
    expect(builtins, `reachable through: ${closure.files.join(", ")}`).toEqual([]);
  });

  it("names only what the gates actually need", () => {
    expect(closure.bare).toEqual([]);
  });

  it("does not reach approval.ts, which is the Node half", () => {
    expect(closure.files).not.toContain("approval.ts");
    expect(closure.files).not.toContain("index.ts");
  });

  it("still carries every gate — a pure surface that dropped the gates is not a fix", () => {
    for (const file of ["gates.ts", "classify.ts", "findings.ts", "approval-pure.ts", "hash.ts"]) {
      expect(closure.files).toContain(file);
    }
  });

  it("⭐ the Node barrel DOES reach crypto, and that is correct", () => {
    // The guarantee is a split, not an absence. If this goes green-by-empty
    // the split has collapsed and `pure.ts` is passing for the wrong reason.
    const node = closureOf("index.ts").bare.filter((s) => s.startsWith("node:"));
    expect(node).toContain("node:crypto");
  });
});
