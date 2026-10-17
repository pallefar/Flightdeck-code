/** Local modeled verifier / live-source ABI projection, NOT a deployed host mount. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSubApp } from "../../codegen/src/generate";
import { minimalSpec, registryFixture, wcClockSpec } from "../../codegen/src/fixtures/specs";
import { verifySubApp } from "./verify";
import { FLIGHTDECK_HOST_SURFACE } from "./verify/host-surface";
import { EMIT_MANIFEST } from "../../subapp/src/emit";
import { typecheckCandidate } from "./verify/typecheck";

function signatures(text: string, owner: string, names: readonly string[]) {
  const source = ts.createSourceFile("sdk.ts", text, ts.ScriptTarget.Latest, true);
  const iface = source.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === owner);
  return names.map((name) => {
    const member = iface?.members.find((m) => m.name?.getText(source) === name);
    if (!member || !ts.isMethodSignature(member)) throw new Error(`missing SDK method ${owner}.${name}`);
    return { name, optional: !!member.questionToken,
      parameters: member.parameters.map((p) => ({ type: p.type?.getText(source).replace(/\s/g, ""), optional: !!p.questionToken, rest: !!p.dotDotDotToken })),
      returns: member.type?.getText(source).replace(/\s/g, "") };
  });
}

describe.each([false, true])("copied Studio (include host tests: %s)", (includeHostTests) => {
  it("verifies unchanged sources through all local modeled stages (not host deployment)", async () => {
    const entries = includeHostTests ? EMIT_MANIFEST : EMIT_MANIFEST.filter((f) => f.role !== "host-test");
    const files = entries.map((f) => ({
      path: f.target.replace(/^flightdeck\//, ""),
      contents: readFileSync(join(process.cwd(), "packages/subapp/src", f.source), "utf8"),
    }));
    expect(files).toHaveLength(includeHostTests ? EMIT_MANIFEST.length : EMIT_MANIFEST.length - 3);
    expect(files.some((f) => f.path === "server/subapps/registry.ts")).toBe(false);
    const report = await verifySubApp({ files }, { repoRoot: process.cwd() });
    console.log(JSON.stringify({ scope: includeHostTests ? "complete copied Studio including host tests, local modeled VERIFY" : "copied Studio server/web only, local modeled VERIFY",
      candidateFiles: files.length, registryEditSupplied: false, stages: report.stages, findings: report.findings }));
    expect(report.errors).toEqual([]);
    expect(report.verified).toBe(true);
    expect(report.stages.map((s) => [s.name, s.ran, s.ok])).toEqual([
      ["static", true, true], ["typecheck", true, true], ["mount", true, true],
    ]);
    // Current registry check searches all source text: the host admission test's
    // fixture mentions SUBAPP_MANIFESTS/studioManifest and suppresses FD-X001.
    // That is NOT registration evidence. The server/web-only pass retains the
    // actual missing-registry warning; no registry file is supplied in either.
    expect(report.warnings.map((f) => f.rule)).toEqual(includeHostTests ? [] : ["FD-X001"]);
    const compile = typecheckCandidate(files, { repoRoot: process.cwd() });
    console.log(JSON.stringify({ scope: "copied Studio compiler-only modeled SDK projection", includeHostTests, output: compile.output }));
    expect(compile.findings, compile.output).toEqual([]);
  }, 120_000);
});

it("keeps real SDK arity, missing-await, payload and invented-member errors rejecting", () => {
  const compile = typecheckCandidate([{ path: "server/subapps/sdk-probe/abi.ts", contents: `
    import type { RegisterRoutesCtx, SubAppCapabilities } from "../types.js";
    import type { FastifyRequest } from "fastify";
    declare const ctx: RegisterRoutesCtx;
    declare const req: FastifyRequest;
    declare const caps: SubAppCapabilities;
    ctx.capabilitiesFor("workspace");
    ctx.capabilitiesFor("workspace", req).readContracts();
    const path: string = caps.writeInboxProposal("sdk-probe.json", {});
    caps.writeInboxProposal({ path: "wrong" });
    caps.auditAppend({ fields: [] });
    caps.proposeInboxItem({});
    caps.readContracts()[0]!.madeUpField;
  ` }], { repoRoot: process.cwd() });
  expect(compile.ok).toBe(false);
  for (const code of ["TS2554", "TS2339", "TS2322", "TS2345"]) expect(compile.output).toContain(code);
  expect(compile.diagnosticCount).toBe(7);
});

it("pins the modeled SDK to AST-extracted current host declarations (explicit local source scope)", () => {
  const root = process.env.FLIGHTDECK_HOST_ROOT;
  if (!root) throw new Error("Set FLIGHTDECK_HOST_ROOT to the local Flightdeck checkout; source ABI proof must not silently skip");
  const path = join(root, "flightdeck/server/subapps/types.ts");
  if (!existsSync(path)) throw new Error(`Missing host SDK source: ${path}`);
  const host = readFileSync(path, "utf8");
  const model = FLIGHTDECK_HOST_SURFACE.types["server/subapps/types"]!;
  for (const [owner, methods] of [
    ["RegisterRoutesCtx", ["capabilitiesFor"]],
    ["SubAppCapabilities", ["readContracts", "writeInboxProposal", "listOwnInboxProposals", "auditAppend"]],
  ] as const) expect(signatures(model, owner, methods)).toEqual(signatures(host, owner, methods));
});

describe.each([["floor", minimalSpec], ["proposal", wcClockSpec]] as const)("actual emitted %s candidate", (_name, spec) => {
  it("passes real static/typecheck/modeled mount without false SDK rejection", async () => {
    // Verify the complete unmodified producer output, including host tests.
    // The producer now checks its regex capture; no candidate filtering or
    // text repair is needed to manufacture a local VERIFY pass.
    const files = generateSubApp(spec, { registrySource: registryFixture }).files.filter((f) => f.kind !== "standalone");
    const report = await verifySubApp({ files }, { repoRoot: process.cwd() });
    console.log(JSON.stringify({ scope: "local modeled verifier, not host deployment", candidate: spec.id, stages: report.stages, findings: report.findings }));
    expect(report.findings).toEqual([]);
    expect(report.verified).toBe(true);
    expect(report.stages.map((s) => [s.name, s.ran, s.ok])).toEqual([["static", true, true], ["typecheck", true, true], ["mount", true, true]]);
  }, 120_000);
});
