/** Live-source ABI projections using local dependencies; not installed-host evidence. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { FLIGHTDECK_HOST_SURFACE, type HostSurface } from "./verify/host-surface";
import { typecheckCandidate } from "./verify/typecheck";
import { EMIT_MANIFEST } from "../../subapp/src/emit";

function hostSource(path: string): ts.SourceFile {
  const root = process.env.FLIGHTDECK_HOST_ROOT;
  if (!root) throw new Error("Set FLIGHTDECK_HOST_ROOT; live-source ABI tests must not silently skip");
  return ts.createSourceFile(path, readFileSync(join(root, "flightdeck", path), "utf8"), ts.ScriptTarget.Latest, true);
}

function interfaceDeclaration(source: ts.SourceFile, name: string): ts.InterfaceDeclaration {
  let found: ts.InterfaceDeclaration | undefined;
  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error(`Missing actual interface ${name} in ${source.fileName}`);
  return found;
}

function shape(source: ts.SourceFile, name: string) {
  return interfaceDeclaration(source, name).members.map((member) => member.getText(source).replace(/\s/g, ""));
}

function requestProjection(): HostSurface {
  const workspace = hostSource("server/workspace/resolve.ts");
  const project = hostSource("server/project/resolve.ts");
  const model = ts.createSourceFile("model.ts", FLIGHTDECK_HOST_SURFACE.ambient["server/_fd_host_augmentation"]!, ts.ScriptTarget.Latest, true);
  const principal = interfaceDeclaration(model, "FastifyRequest").members.find((member) => member.name?.getText(model) === "principal");
  if (!principal) throw new Error("Missing modeled principal (outside this scope projection)");
  // Extract declarations, not resolver implementations/dependency closures.
  // Principal remains the existing model; only workspace/project are source-projected.
  const ambient = `import type { WorkspaceRuntime } from "./workspace/types.js";
    ${interfaceDeclaration(project, "RequestProject").getText(project)}
    declare module "fastify" {
      ${interfaceDeclaration(workspace, "FastifyRequest").getText(workspace)}
      ${interfaceDeclaration(project, "FastifyRequest").getText(project)}
      interface FastifyRequest { ${principal.getText(model)} }
    }
    export {};`;
  return { ...FLIGHTDECK_HOST_SURFACE, ambient: { "server/_fd_host_augmentation": ambient } };
}

function webProjection(): HostSurface {
  const source = hostSource("web/src/subapps/registry.ts");
  return { ...FLIGHTDECK_HOST_SURFACE, types: { ...FLIGHTDECK_HOST_SURFACE.types,
    "web/src/subapps/registry": `import type { ComponentType } from "react";\n${interfaceDeclaration(source, "SubAppModule").getText(source)}`,
  } };
}

it("pins nullable mandatory request scopes and the complete RequestProject to AST-extracted host ABI", () => {
  const actualWorkspace = hostSource("server/workspace/resolve.ts");
  const actualProject = hostSource("server/project/resolve.ts");
  const model = ts.createSourceFile("model.ts", FLIGHTDECK_HOST_SURFACE.ambient["server/_fd_host_augmentation"]!, ts.ScriptTarget.Latest, true);
  const actualMembers = [...shape(actualWorkspace, "FastifyRequest"), ...shape(actualProject, "FastifyRequest")];
  expect(shape(model, "FastifyRequest").filter((member) => /^(workspace|project)[?:]/.test(member))).toEqual(actualMembers);
  expect(shape(model, "RequestProject")).toEqual(shape(actualProject, "RequestProject"));
});

it("accepts actual null request decoration/absence but rejects undefined and incomplete projects in model and projection", () => {
  const valid = [{ path: "tests/subapps/studio/request-valid.ts", contents: `
    import fastify, { type FastifyRequest } from "fastify";
    const app = fastify();
    app.decorateRequest("workspace", null);
    app.decorateRequest("project", null);
    declare const req: FastifyRequest;
    req.workspace = null;
    req.project = null;
    req.project = { id: "project", label: "Project", enabled: true, isDefault: false };
  ` }];
  const invalid = [{ path: "tests/subapps/studio/request-invalid.ts", contents: `
    import type { FastifyRequest } from "fastify";
    declare const req: FastifyRequest;
    req.workspace = undefined;
    req.project = undefined;
    req.project = { id: "project" };
    req.project = { id: "project", label: "Project", enabled: "yes", isDefault: false };
  ` }];
  for (const hostSurface of [requestProjection(), FLIGHTDECK_HOST_SURFACE]) {
    const accepted = typecheckCandidate(valid, { hostSurface });
    expect(accepted.findings, accepted.output).toEqual([]);
    const rejected = typecheckCandidate(invalid, { hostSurface });
    expect(rejected.diagnosticCount, rejected.output).toBe(4);
    expect(rejected.findings.every((finding) => finding.rule === "FD-T003")).toBe(true);
  }
});

it("pins the web module component ABI to actual host AST and compiles every unchanged copied Studio file against source projections", () => {
  const actual = hostSource("web/src/subapps/registry.ts");
  const model = ts.createSourceFile("web-model.ts", FLIGHTDECK_HOST_SURFACE.types["web/src/subapps/registry"]!, ts.ScriptTarget.Latest, true);
  expect(shape(model, "SubAppModule")).toEqual(shape(actual, "SubAppModule"));
  const files = EMIT_MANIFEST.map((entry) => ({ path: entry.target.replace(/^flightdeck\//, ""),
    contents: readFileSync(join(process.cwd(), "packages/subapp/src", entry.source), "utf8") }));
  const hostSurface = { ...webProjection(), ambient: requestProjection().ambient };
  const compiled = typecheckCandidate(files, { hostSurface });
  expect(compiled.findings, compiled.output).toEqual([]);
});

it("accepts function/class components but rejects unknown-return and required-prop pages against actual web ABI", () => {
  const valid = [{ path: "web/src/subapps/abi/valid.tsx", contents: `
    import { Component, createElement } from "react";
    import type { SubAppModule } from "../registry.js";
    class Page extends Component { render() { return null; } }
    const classModule: SubAppModule = { Page, Rail: Page, railHeading: "Rail" };
    const functionModule: SubAppModule = { Page: () => null };
    createElement(classModule.Page);
    createElement(functionModule.Page);
  ` }];
  const invalid = [{ path: "web/src/subapps/abi/invalid.tsx", contents: `
    import type { SubAppModule } from "../registry.js";
    declare const wrongReturn: () => unknown;
    const badReturn: SubAppModule = { Page: wrongReturn };
    const badProps: SubAppModule = { Page: (props: { required: string }) => null };
  ` }];
  for (const hostSurface of [webProjection(), FLIGHTDECK_HOST_SURFACE]) {
    const accepted = typecheckCandidate(valid, { hostSurface });
    expect(accepted.findings, accepted.output).toEqual([]);
    const rejected = typecheckCandidate(invalid, { hostSurface });
    expect(rejected.diagnosticCount, rejected.output).toBe(2);
    expect(rejected.findings.every((finding) => finding.rule === "FD-T003")).toBe(true);
  }
});
