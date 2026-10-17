/** Test-only SDK projection. The two ABI declarations come from the live host
 * source; unrelated host services and dependency closure are not simulated. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { HOST_ROOT } from "../../../guardrails/src/host-source";

export const hostTypes = join(HOST_ROOT, "flightdeck/server/subapps/types.ts");
export const hasHostSdk = existsSync(hostTypes);

export function withHostSdk(shim: string): string {
  const source = ts.createSourceFile(hostTypes, readFileSync(hostTypes, "utf8"), ts.ScriptTarget.Latest, true);
  function method(owner: string, name: string): string {
    const iface = source.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === owner);
    const member = iface?.members.find((m) => m.name?.getText(source) === name);
    if (!member || !ts.isMethodSignature(member)) throw new Error(`missing real host SDK ${owner}.${name}`);
    return member.getText(source);
  }
  const declarations = new Map([
    ["writeInboxProposal", method("SubAppCapabilities", "writeInboxProposal")],
    ["capabilitiesFor", method("RegisterRoutesCtx", "capabilitiesFor")],
  ]);
  const parsed = ts.createSourceFile("shim.ts", shim, ts.ScriptTarget.Latest, true);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const stmt of parsed.statements) if (ts.isInterfaceDeclaration(stmt)) {
    for (const m of stmt.members) {
      const replacement = declarations.get(m.name?.getText(parsed) ?? "");
      if (replacement) edits.push({ start: m.getStart(parsed), end: m.end, text: replacement });
    }
  }
  if (edits.length !== declarations.size) throw new Error("SDK shim is missing a required method");
  let sdk = shim;
  for (const edit of edits.sort((a, b) => b.start - a.start)) sdk = sdk.slice(0, edit.start) + edit.text + sdk.slice(edit.end);
  if (!/import type \{[^}]*FastifyRequest[^}]*\} from "fastify"/.test(sdk)) sdk = 'import type { FastifyRequest } from "fastify";\n' + sdk;
  return sdk;
}

export function typecheckSdk(root: string, entry: string, useHostSdk = false): string {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
    exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    noEmit: true, skipLibCheck: true, esModuleInterop: true,
  };
  const compiler = ts.createCompilerHost(options);
  if (useHostSdk) {
    const shimPath = join(root, "server/subapps/types.ts");
    const sdk = withHostSdk(readFileSync(shimPath, "utf8"));
    const read = compiler.readFile.bind(compiler);
    compiler.readFile = (file) => file === shimPath ? sdk : read(file);
  }
  const roots = [join(root, entry)];
  // The copied integration keeps Fastify augmentation in its own host file;
  // standalone declares it inline in the SDK shim instead.
  const ambient = join(root, "server/fastify.ts");
  if (existsSync(ambient)) roots.push(ambient);
  const program = ts.createProgram(roots, options, compiler);
  return ts.formatDiagnosticsWithColorAndContext(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => "\n",
  });
}
