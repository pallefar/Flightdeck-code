/** Execute the emitted conformance assertion and VERIFY the complete,
 * unmodified host bundle. Local modeled mount, not an installed host. */
import { createRequire } from "node:module";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { verifySubApp } from "../../../conformance/src/verify";
import { generateSubApp } from "../generate";
import { registryFixture, wcClockSpec } from "../fixtures/specs";

const files = generateSubApp(wcClockSpec, { registrySource: registryFixture }).files.filter((f) => f.kind !== "standalone");

it("VERIFY accepts every unmodified emitted wc-clock host file, including its conformance test", async () => {
  expect(files.some((f) => f.path === "tests/subapps/wc-clock/wcClockConformance.test.ts")).toBe(true);
  const report = await verifySubApp({ files }, { repoRoot: process.cwd() });
  console.log(JSON.stringify({ scope: "unmodified full emitted host bundle; local modeled VERIFY, not installed host", fileCount: files.length, paths: files.map((f) => f.path), stages: report.stages, findings: report.findings }));
  expect(report.findings, report.stages.find((s) => s.name === "typecheck")?.output).toEqual([]);
  expect(report.verified).toBe(true);
  expect(report.stages.map((s) => [s.name, s.ran, s.ok])).toEqual([
    ["static", true, true], ["typecheck", true, true], ["mount", true, true],
  ]);
}, 120_000);

function emittedTableAssertion(schema: string): () => void {
  const source = files.find((f) => f.kind === "host-test");
  if (!source) throw new Error("missing generated host test");
  const callbacks = new Map<string, () => void>();
  const realRequire = createRequire(import.meta.url);
  const code = ts.transpileModule(source.contents, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const require_ = (name: string): unknown => {
    if (name === "node:fs") return { readFileSync: () => schema };
    if (name === "vitest") return { expect, describe: (_name: string, run: () => void) => run(), it: (name: string, run: () => void) => callbacks.set(name, run) };
    if (name.startsWith("../../../server/")) return {};
    return realRequire(name);
  };
  new Function("require", "exports", code)(require_, {});
  const assertion = callbacks.get("every table it creates carries the sub-app table prefix");
  if (!assertion) throw new Error("missing emitted table assertion");
  return assertion;
}

describe("the generated table assertion executes rather than merely matching a snapshot", () => {
  it("accepts the actual generated schema", () => {
    const schema = files.find((f) => f.path === "server/subapps/wc-clock/schema.ts");
    if (!schema) throw new Error("missing generated schema");
    expect(emittedTableAssertion(schema.contents)).not.toThrow();
  });
  it.each(["", "CREATE TABLE IF NOT EXISTS", "CREATE TABLE IF NOT EXISTS 123bad"])("rejects absent or malformed table declarations: %j", (schema) => {
    expect(emittedTableAssertion(schema)).toThrow(/greater than 0/);
  });
  it("rejects a table with a foreign prefix", () => {
    expect(emittedTableAssertion("CREATE TABLE IF NOT EXISTS foreign_clocks")).toThrow(/to be true/);
  });
});
