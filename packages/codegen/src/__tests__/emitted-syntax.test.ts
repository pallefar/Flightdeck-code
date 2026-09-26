/** Does the emitted text actually PARSE?
 *
 * Every other test in this package reads the output as strings — which is
 * the right way to check a contract rule, and no way at all to notice a
 * missing brace. This one hands each emitted file to the TypeScript parser
 * and fails on a syntactic diagnostic. It cannot type-check (the host's
 * modules are not here), but "is this valid TypeScript" is exactly the
 * question string assertions cannot answer, and it is the first thing that
 * would break a generated sub-app in somebody else's repository.
 *
 * ⭐ AND EVERY FILE IS CHECKED BY ITS OWN FORMAT, NOT SKIPPED.
 * The standalone harness added `.json`, `.css`, `.html` and `.md` to the
 * emitted set, none of which is TypeScript. Excluding them from "does it
 * parse?" would have been one line and would have left four file types whose
 * syntax nothing in this repo ever looks at — the same shape as every check
 * this session has caught not doing its job. So each type gets the strongest
 * question its format admits: JSON must parse, CSS must balance, the HTML
 * must actually point at a file that is in the set, and a Markdown fence must
 * close. `checkerFor` is exhaustive on purpose: a new extension fails LOUDLY
 * rather than being waved through. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { generateSubApp } from "../generate";
import { contractRunSpec, minimalSpec, registryFixture, wcClockSpec } from "../fixtures/specs";

const apps = [
  { name: "contract-run (a converted workflow — the mini-app)", app: generateSubApp(contractRunSpec, { registrySource: registryFixture }) },
  { name: "wc-clock (the table path, which is not the mini-app path)", app: generateSubApp(wcClockSpec, { registrySource: registryFixture }) },
  { name: "shift-notes (the smallest thing that generates)", app: generateSubApp(minimalSpec) },
];

function syntaxErrors(path: string, source: string): string[] {
  const result = ts.transpileModule(source, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  return (result.diagnostics ?? []).map((d) => `${path}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

/** JSON that does not parse is a package.json nobody can install. */
function jsonErrors(path: string, source: string): string[] {
  try {
    JSON.parse(source);
    return [];
  } catch (error) {
    return [`${path}: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** Not a SQL parser — what actually breaks an emitted migration under psql:
 * an unterminated statement, unbalanced parentheses or quotes, or a statement
 * that is not one of the DDL kinds codegen writes (mig-studio-emitted-migrations;
 * the full statement shapes are the "migration-sql" invariant's job). */
function sqlErrors(path: string, source: string): string[] {
  const out: string[] = [];
  const body = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim();
  if (body.length === 0) return [`${path}: no statement`];
  if (!body.endsWith(";")) out.push(`${path}: the last statement is not terminated with ;`);
  if ((body.match(/'/g) ?? []).length % 2 !== 0) out.push(`${path}: unbalanced single quotes`);
  for (const statement of body.split(";").map((st) => st.trim()).filter((st) => st.length > 0)) {
    let depth = 0;
    for (const ch of statement) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) out.push(`${path}: unbalanced parentheses in "${statement.slice(0, 60)}"`);
    if (!/^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ALTER TABLE) /.test(statement)) {
      out.push(`${path}: "${statement.slice(0, 60)}" is not a statement kind codegen writes`);
    }
  }
  return out;
}

/** Not a CSS parser — a brace counter, which is what actually breaks a
 * generated stylesheet, plus a check that it defines something at all. */
function cssErrors(path: string, source: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const ch of source) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (depth < 0) break;
  }
  if (depth !== 0) out.push(`${path}: unbalanced braces (depth ${depth} at end)`);
  if (!/\{[^}]*:[^}]*}/.test(source)) out.push(`${path}: declares no rule with a property`);
  return out;
}

/** The entry point has to have a mount node and a script, and the script has
 * to name a file that was actually emitted — a dangling src is a blank page. */
function htmlErrors(path: string, source: string, emitted: readonly string[]): string[] {
  const out: string[] = [];
  if (!source.includes('id="root"')) out.push(`${path}: no #root mount node`);
  const src = /<script[^>]*src="\.\/([^"]+)"/.exec(source);
  if (src === null) out.push(`${path}: no module script`);
  else {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    const target = dir + src[1];
    if (!emitted.includes(target)) out.push(`${path}: script src "${src[1]}" is not an emitted file (${target})`);
  }
  return out;
}

/** An unclosed fence swallows the rest of a README, which is how a runbook
 * silently loses its last half. */
function markdownErrors(path: string, source: string): string[] {
  const fences = (source.match(/^```/gm) ?? []).length;
  return fences % 2 === 0 ? [] : [`${path}: ${fences} code fences — one is unclosed`];
}

function checkerFor(path: string): (p: string, s: string, emitted: readonly string[]) => string[] {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return (p, s) => syntaxErrors(p, s);
  if (path.endsWith(".json")) return (p, s) => jsonErrors(p, s);
  if (path.endsWith(".css")) return (p, s) => cssErrors(p, s);
  if (path.endsWith(".html")) return htmlErrors;
  if (path.endsWith(".md")) return (p, s) => markdownErrors(p, s);
  if (path.endsWith(".sql")) return (p, s) => sqlErrors(p, s);
  // ⛔ NOT A DEFAULT-PASS. An extension nobody thought about is a file whose
  // syntax nothing checks, and that is a decision, not an oversight.
  return (p) => [`${p}: no syntax check exists for this extension — add one to checkerFor`];
}

describe.each(apps)("$name parses", ({ app }) => {
  const sources = app.files.filter((f) => f.kind !== "patch");
  const emittedPaths = app.files.map((f) => f.path);

  it("emits at least a manifest, a guard, a route aggregator, a domain file and a page", () => {
    expect(sources.length).toBeGreaterThanOrEqual(5);
  });

  it("emits the standalone harness alongside the host tree", () => {
    // Guards the premise of every case below: if the harness stopped being
    // emitted, the per-format checks would all pass by having nothing to check.
    expect(sources.filter((f) => f.kind === "standalone").length).toBeGreaterThanOrEqual(10);
  });

  it.each(sources.map((f) => [f.path, f.contents] as const))("%s is syntactically valid", (path, contents) => {
    expect(checkerFor(path)(path, contents, emittedPaths)).toEqual([]);
  });

  it("exports the symbols the manifest and registry patch name", () => {
    const manifest = sources.find((f) => f.kind === "manifest");
    const routesIndex = sources.find((f) => f.kind === "routes-index");
    expect(manifest?.contents).toMatch(/export const \w+Manifest: SubAppManifest = \{/);
    expect(routesIndex?.contents).toMatch(/export function register\w+Routes\(app: FastifyInstance, ctx: RegisterRoutesCtx\): void \{/);
    expect(app.registryPatch.importLine).toContain(app.plan.names.manifestConst);
  });
});
