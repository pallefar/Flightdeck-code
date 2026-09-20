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

  /**
   * ⭐ THE FENCE ABOVE WALKS IMPORT LINES, AND A GLOBAL HAS NONE.
   *
   * `Buffer.byteLength(...)` reaches the `buffer` builtin with no import to
   * find, and `process.env` reaches nothing at all in a browser — it is
   * simply undefined. Both were sitting in this closure while every case in
   * this file was green: `envelope/src/build.ts`, `classify.ts` and
   * `names.ts` used `Buffer`, and `providers/src/config.ts` — pulled in by
   * ONE imported constant — had `process.env` as a default parameter.
   *
   * The fence was not wrong. It was looking at the only thing it could see.
   */
  const NODE_ONLY_GLOBALS = [
    "Buffer",
    "process",
    "__dirname",
    "__filename",
    "require",
    "module",
    "exports",
    "global",
    "setImmediate",
    "clearImmediate",
  ];

  /**
   * Comments and quoted strings come out first, and both removals were
   * needed: `lists.ts` has the STRING "process" in a denylist of dangerous
   * identifiers, which is data about a global rather than a use of one, and
   * several files discuss `Buffer` in prose. Template literals are left in
   * place deliberately — a `${...}` hole is executable code, and stripping
   * it would hide exactly the kind of use this case exists to find.
   */
  function stripFor(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  }

  const executableSource = (file: string): string => stripFor(fs.readFileSync(path.join(SRC, file), "utf8"));

  it("⭐ reaches no node-only GLOBAL either — the hole the import walk cannot see", () => {
    const hits: string[] = [];
    for (const file of closure.files) {
      const source = executableSource(file);
      for (const name of NODE_ONLY_GLOBALS) {
        // `\b` keeps `ArrayBuffer` and `globalThis` out: neither has a word
        // boundary before `Buffer` / after `global`.
        if (new RegExp(`\\b${name}\\b`).test(source)) hits.push(`${file}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the global scan can actually see one — and knows what is NOT one", () => {
    // ⚠ A POSITIVE CONTROL, because the case above asserts an EMPTY list and
    // an empty list is what a scanner that matches nothing also produces.
    // The first version of this control read `approval.ts` and looked for
    // `node:` — which the quote-stripping had already turned into `""`. It
    // failed honestly; a control that had passed for that reason would have
    // been worse than none.
    const scan = (src: string): string[] =>
      NODE_ONLY_GLOBALS.filter((n) => new RegExp(`\\b${n}\\b`).test(stripFor(src)));

    // Real uses — every one of these was in the closure before this commit.
    expect(scan('const n = Buffer.byteLength(w, "utf8");')).toContain("Buffer");
    expect(scan("function f(env = process.env) {}")).toContain("process");
    expect(scan("const p = __dirname;")).toContain("__dirname");
    expect(scan("const x = require('fs');")).toContain("require");

    // Not uses, and each one is a false positive this scan would otherwise
    // have: `ArrayBuffer` and `globalThis` share a prefix or suffix with a
    // banned name, and `lists.ts` legitimately holds "process" as DATA.
    expect(scan("if (ArrayBuffer.isView(value)) return;")).toEqual([]);
    expect(scan("const g = globalThis.crypto;")).toEqual([]);
    expect(scan('const DANGEROUS = ["process", "Buffer"];')).toEqual([]);
    expect(scan("// Buffer.byteLength is what this replaced\nconst n = 1;")).toEqual([]);
    expect(scan("/** uses process.env */\nconst n = 1;")).toEqual([]);
  });

  it("⭐ the Node barrel DOES reach crypto, and that is correct", () => {
    // The guarantee is a split, not an absence. If this goes green-by-empty
    // the split has collapsed and `pure.ts` is passing for the wrong reason.
    const node = closureOf("index.ts").bare.filter((s) => s.startsWith("node:"));
    expect(node).toContain("node:crypto");
  });
});

describe("⭐ one definition of a named human, across packages", () => {
  it("the envelope and the guardrails cannot disagree, because there is one rule", async () => {
    // ⚠ THE PROMISE THAT WAS FALSE. `build.ts` carried a second copy with the
    // comment "deliberately not imported … if they ever disagree,
    // first-party.test.ts fails". They disagreed in BOTH directions —
    // `service` and `automation` — and nothing failed, because nothing
    // compared them. This is that comparison, made real.
    const { isNamedHuman } = await import("../approval-pure");
    const build = await import("../../../envelope/src/build");

    // The envelope must not have re-grown a local rule.
    const source = (await import("node:fs")).readFileSync(
      new URL("../../../envelope/src/build.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/function isNamedActor/);
    expect(source).toContain('isNamedHuman } from "../../guardrails/src/approval-pure"');

    // And the rule itself still refuses the things it must.
    for (const notAName of ["", " ", "x", "system", "admin", "service", "svc", "bot", "automation", "agent", "unknown", "anonymous", "the approver"]) {
      expect(isNamedHuman(notAName), notAName).toBe(false);
    }
    for (const isAName of ["Anna Sørensen", "Karsten Haldan", "k.haldan"]) {
      expect(isNamedHuman(isAName), isAName).toBe(true);
    }
    expect(typeof build.buildEnvelope).toBe("function");
  });
});
