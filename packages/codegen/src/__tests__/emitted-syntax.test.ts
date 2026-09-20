/** Does the emitted text actually PARSE?
 *
 * Every other test in this package reads the output as strings — which is
 * the right way to check a contract rule, and no way at all to notice a
 * missing brace. This one hands each emitted file to the TypeScript parser
 * and fails on a syntactic diagnostic. It cannot type-check (the host's
 * modules are not here), but "is this valid TypeScript" is exactly the
 * question string assertions cannot answer, and it is the first thing that
 * would break a generated sub-app in somebody else's repository. */
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

describe.each(apps)("$name parses", ({ app }) => {
  const sources = app.files.filter((f) => f.kind !== "patch");

  it("emits at least a manifest, a guard, a route aggregator, a domain file and a page", () => {
    expect(sources.length).toBeGreaterThanOrEqual(5);
  });

  it.each(sources.map((f) => [f.path, f.contents] as const))("%s is syntactically valid", (path, contents) => {
    expect(syntaxErrors(path, contents)).toEqual([]);
  });

  it("exports the symbols the manifest and registry patch name", () => {
    const manifest = sources.find((f) => f.kind === "manifest");
    const routesIndex = sources.find((f) => f.kind === "routes-index");
    expect(manifest?.contents).toMatch(/export const \w+Manifest: SubAppManifest = \{/);
    expect(routesIndex?.contents).toMatch(/export function register\w+Routes\(app: FastifyInstance, ctx: RegisterRoutesCtx\): void \{/);
    expect(app.registryPatch.importLine).toContain(app.plan.names.manifestConst);
  });
});
