/** The lexer the rules stand on.
 *
 * Every one of these is a case where the obvious `String.includes`
 * implementation of a rule gives the wrong answer — so if the scanner
 * regresses, the failure shows up here, in one line, rather than as a gate
 * that quietly stops noticing things. */
import { describe, expect, it } from "vitest";
import { findTokens, matchBrace, offsetInLiteral, scanFile } from "./scan";

const scan = (source: string) => scanFile("server/subapps/x/file.ts", source);

describe("comments", () => {
  it("are blanked out of both views, with the lines still lining up", () => {
    const file = scan(`// process.env is read per call\nconst a = 1;\n/* req.body */\nconst b = 2;\n`);
    expect(file.code).not.toContain("process.env");
    expect(file.skeleton).not.toContain("req.body");
    expect(file.positionAt(file.text.indexOf("const b")).line).toBe(4);
    expect(file.lineTextAt(file.text.indexOf("const b"))).toBe("const b = 2;");
  });

  it("do not swallow a string that contains a slash-slash", () => {
    const file = scan(`const url = "https://example.test/x";\nconst after = 1;\n`);
    expect(file.strings[0]?.value).toBe("https://example.test/x");
    expect(file.skeleton).toContain("const after");
  });
});

describe("strings", () => {
  it("are kept in `code` and blanked in `skeleton`", () => {
    const file = scan(`const message = "req.body must be an object";\n`);
    expect(file.code).toContain("req.body");
    expect(file.skeleton).not.toContain("req.body");
    expect(findTokens(file.skeleton, "req.body")).toEqual([]);
  });

  it("resolve escapes, and say when an index still maps to the file", () => {
    const file = scan(`const ddl = "CREATE TABLE a(\\n id TEXT\\n);";\n`);
    const literal = file.strings[0];
    expect(literal?.value).toContain("CREATE TABLE a(\n");
    expect(literal?.exact).toBe(false);
    // Escapes shifted the indexes, so the anchor falls back to the literal.
    expect(offsetInLiteral(literal!, 12)).toBe(literal?.offset);
  });

  it("map exactly inside a template literal, which is where DDL lives", () => {
    const source = "const SCHEMA = `\nCREATE TABLE IF NOT EXISTS subapp_x_rows(\n  id TEXT\n);\n`;\n";
    const file = scan(source);
    const literal = file.strings[0];
    expect(literal?.template).toBe(true);
    expect(literal?.exact).toBe(true);
    const at = offsetInLiteral(literal!, literal!.value.indexOf("subapp_x_rows"));
    // Line 1 is `const SCHEMA = \``; the DDL starts on line 2.
    expect(file.positionAt(at).line).toBe(2);
    expect(file.lineTextAt(at)).toContain("CREATE TABLE");
  });

  it("survive an apostrophe inside a double-quoted string", () => {
    const file = scan(`const t = "it's fine";\nconst u = 2;\n`);
    expect(file.strings[0]?.value).toBe("it's fine");
    expect(file.skeleton).toContain("const u");
  });
});

describe("regex literals", () => {
  it("do not let their braces count as scope", () => {
    const source = `const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;\nconst after = process.env.X;\n`;
    const file = scan(source);
    expect(file.functionDepthAt(source.indexOf("process.env"))).toBe(0);
  });

  it("are told apart from division", () => {
    const file = scan(`const half = total / 2;\nconst rest = total / 3;\nconst s = "kept";\n`);
    expect(file.strings.map((literal) => literal.value)).toEqual(["kept"]);
  });
});

describe("function depth", () => {
  const source = [
    `const MODULE_LEVEL = 1;`,
    `if (MODULE_LEVEL) { const stillModule = 2; }`,
    `const shape = { nested: 3 };`,
    `export function named(req: Request): Promise<void> {`,
    `  const inNamed = 4;`,
    `}`,
    `const arrow = async (req, reply) => {`,
    `  const inArrow = 5;`,
    `};`,
    `class Thing {`,
    `  method(arg: string) {`,
    `    const inMethod = 6;`,
    `  }`,
    `}`,
  ].join("\n");
  const file = scan(source);
  const depthOf = (token: string) => file.functionDepthAt(source.indexOf(token));

  it("counts a bare block at module scope as module scope", () => {
    expect(depthOf("stillModule")).toBe(0);
  });

  it("counts an object literal at module scope as module scope", () => {
    expect(depthOf("nested")).toBe(0);
  });

  it("sees a function body through its return-type annotation", () => {
    expect(depthOf("inNamed")).toBe(1);
  });

  it("sees an arrow body", () => {
    expect(depthOf("inArrow")).toBe(1);
  });

  it("sees a class method body", () => {
    expect(depthOf("inMethod")).toBe(1);
  });
});

describe("imports", () => {
  const source = [
    `import { z } from "zod";`,
    `import type { FastifyInstance } from "fastify";`,
    `import {`,
    `  requireXEnabled,`,
    `} from "../guard.js";`,
    `import "./side-effect.js";`,
    `export { helper } from "./helper.js";`,
    `const lazy = await import("./lazy.js");`,
    `const legacy = require("node:fs");`,
    `const notAnImport = "./decoy.js";`,
  ].join("\n");
  const file = scan(source);
  const specifiers = file.imports.map((ref) => ref.specifier);

  it("finds every form", () => {
    expect(specifiers).toEqual([
      "zod",
      "fastify",
      "../guard.js",
      "./side-effect.js",
      "./helper.js",
      "./lazy.js",
      "node:fs",
    ]);
  });

  it("does not mistake a plain string for one", () => {
    expect(specifiers).not.toContain("./decoy.js");
  });

  it("marks type-only imports", () => {
    expect(file.imports.find((ref) => ref.specifier === "fastify")?.typeOnly).toBe(true);
    expect(file.imports.find((ref) => ref.specifier === "zod")?.typeOnly).toBe(false);
  });

  it("points at the specifier itself, so a finding lands on the right line", () => {
    const ref = file.imports.find((item) => item.specifier === "../guard.js");
    expect(file.positionAt(ref?.offset ?? 0).line).toBe(5);
    expect(file.text.slice(ref?.offset ?? 0, (ref?.offset ?? 0) + 13)).toBe(`"../guard.js"`);
  });

  it("does not pair an import with a later statement's `from`", () => {
    const stray = scan(`import { a } from "./a.js";\nconst x = 1;\nconst from = "./b.js";\n`);
    expect(stray.imports.map((ref) => ref.specifier)).toEqual(["./a.js"]);
  });
});

describe("brace matching", () => {
  it("ignores braces inside strings and comments", () => {
    const source = `function f() {\n  const s = "}";\n  // }\n}\n`;
    const file = scan(source);
    const open = source.indexOf("{");
    expect(matchBrace(file.skeleton, open)).toBe(source.lastIndexOf("}"));
  });
});
