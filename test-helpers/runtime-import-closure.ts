/** Test-only static reachability guard, never a runtime package allowlist.
 * Resolve declared file: packages through their real exports and inspect BOTH
 * emitted JS and its tsconfig-derived source closure. Only zod is terminal.
 * Canonical physical identities deduplicate aliases; symlink escapes fail closed.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { runtimeSyntaxPolicy } from "./runtime-syntax-policy.js";

type RecordData = Record<string, unknown>;
interface FilePackage { root: string; source: string; output: string }
const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
function record(value: unknown): value is RecordData { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(reason: string): never { throw Error(`Runtime import closure: ${reason}`); }

export function runtimeImportClosure(rootPath: string, entries: readonly string[]): { seen: Set<string>; bare: Set<string> } {
  const root = fs.realpathSync(rootPath), seen = new Set<string>(), bare = new Set<string>(), pending = [...entries];
  const packages = new Map<string, FilePackage>();
  function canonical(file: string, boundary = root): string {
    const absolute = path.resolve(file);
    if (!inside(boundary, absolute)) fail("path escapes declared boundary");
    const actual = fs.realpathSync(absolute);
    if (!inside(boundary, actual) || !inside(root, actual)) fail("symlink escapes declared boundary");
    return actual;
  }
  function json(file: string, boundary = root): RecordData {
    const actual = canonical(file, boundary);
    if (fs.statSync(actual).size > 1_048_576) fail("metadata byte limit");
    const value: unknown = JSON.parse(fs.readFileSync(actual, "utf8"));
    if (!record(value)) fail("object metadata required");
    return value;
  }
  function resolveFile(base: string, boundary = root): string {
    const options = [base];
    if (/\.js$/.test(base)) options.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx");
    else if (!path.extname(base)) options.push(base + ".ts", base + ".tsx", base + ".js", path.join(base, "index.ts"), path.join(base, "index.js"));
    const found = options.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!found) fail("unresolved relative/source module");
    const actual = canonical(found, boundary);
    if (!/\.(?:ts|tsx|js|mjs)$/.test(actual) || actual.endsWith(".d.ts")) fail("unsupported runtime file");
    return actual;
  }
  function exportTarget(value: unknown, pkgRoot: string): string {
    if (record(value)) {
      if (Object.keys(value).some(k => k !== "types" && k !== "default") || !Object.hasOwn(value, "default")) fail("unsupported export conditions");
      if (value.types !== undefined) {
        if (typeof value.types !== "string" || !value.types.startsWith("./") || !value.types.endsWith(".d.ts")) fail("unsupported types export");
        canonical(path.resolve(pkgRoot, value.types), pkgRoot);
      }
      value = value.default;
    }
    if (typeof value !== "string" || !value.startsWith("./") || value.includes("*") || value.split("/").includes("..")) fail("unsupported or escaping export target");
    const actual = canonical(path.resolve(pkgRoot, value), pkgRoot);
    if (!fs.statSync(actual).isFile() || !actual.endsWith(".js")) fail("missing/unsupported compiled export");
    return actual;
  }
  function packageExport(id: string, from: string): string {
    const parts = id.split("/"), name = id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
    if (!/^(?:@[A-Za-z0-9_-]+\/)?[A-Za-z0-9_.-]+$/.test(name)) fail("unsupported bare specifier");
    const subpath = parts.slice(id.startsWith("@") ? 2 : 1).join("/");
    const key = subpath ? "./" + subpath : ".";
    if (subpath.split("/").some(p => p === "." || p === "..")) fail("invalid package subpath");
    let directory = path.dirname(from), declared: { root: string; name: string } | undefined;
    while (inside(root, directory)) {
      const metadata = path.join(directory, "package.json");
      if (fs.existsSync(metadata)) {
        const deps = json(metadata).dependencies;
        if (record(deps) && Object.hasOwn(deps, name)) {
          const spec = deps[name];
          if (typeof spec !== "string" || !spec.startsWith("file:") || !spec.slice(5)) fail("non-local bare dependency (only zod may terminate)");
          declared = { root: canonical(path.resolve(directory, spec.slice(5))), name };
          break;
        }
      }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
    if (!declared) fail("undeclared bare dependency (only zod may terminate)");
    // Match actual installed file-package resolution, not an imagined source alias.
    directory = path.dirname(from); let installed: string | undefined;
    while (inside(root, directory)) {
      const candidate = path.join(directory, "node_modules", name);
      if (fs.existsSync(candidate)) { installed = canonical(candidate); break; }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
    if (installed !== declared.root) fail("installed file-package identity differs from declaration");
    const metadata = json(path.join(declared.root, "package.json"), declared.root);
    if (metadata.name !== name) fail("file-package name mismatch");
    const exports = metadata.exports;
    let selected: unknown;
    if (typeof exports === "string") { if (key !== ".") fail("unknown package export"); selected = exports; }
    else if (record(exports) && Object.hasOwn(exports, key)) selected = exports[key];
    else fail("unknown package export");
    const target = exportTarget(selected, declared.root);
    const config = json(path.join(declared.root, "tsconfig.json"), declared.root), options = config.compilerOptions;
    if (config.extends !== undefined || !record(options) || typeof options.rootDir !== "string" || typeof options.outDir !== "string"
      || ["paths", "baseUrl", "rootDirs", "moduleSuffixes", "customConditions"].some(k => Object.hasOwn(options, k))) fail("unsupported source/output mapping");
    const source = canonical(path.resolve(declared.root, options.rootDir), declared.root);
    const output = canonical(path.resolve(declared.root, options.outDir), declared.root);
    if (source === output || output === declared.root || !inside(output, target)) fail("export outside compiled output mapping");
    const discovered = !packages.has(declared.root);
    // Distinct package contexts must not map a source tree back into another
    // context's output tree. Otherwise counterpart dispatch can requeue already
    // seen TS identities forever before the physical-file resource guard.
    const overlaps = (a: string, b: string) => inside(a, b) || inside(b, a);
    for (const pkg of packages.values()) if (pkg.root !== declared.root
      && (overlaps(source, pkg.output) || overlaps(output, pkg.source))) fail("conflicting source/output mappings");
    packages.set(declared.root, { root: declared.root, source, output });
    // A relative edge may have inspected compiled files before this real
    // package export supplied their source/output mapping. Revisit obligations,
    // not imports: each physical file's AST is still inspected only once.
    if (discovered) for (const file of seen) if (inside(output, file)) pending.push(file);
    return target;
  }
  function boundaryFor(file: string): string {
    return [...packages.keys()].filter(r => inside(r, file)).sort((a, b) => b.length - a.length)[0] ?? root;
  }
  while (pending.length) {
    const requested = path.resolve(pending.pop()!), file = canonical(requested, boundaryFor(requested));
    const relative = path.relative(root, file).split(path.sep).join("/");
    // Existing envelope consumers share ONE literal model-id declaration, not
    // a provider adapter. It is inspected below, never a terminal exemption.
    const modelMetadata = relative === "packages/providers/src/models.ts";
    if (!modelMetadata && (/(?:^|\/)(?:server|host|providers|models?|authoring-harness|node_modules)(?:\/|$)/.test(relative)
      || /(?:^|\/)(?:cli|apply)\.[cm]?[jt]sx?$/.test(relative))) fail(`IO/model/host module forbidden: ${relative}`);
    // Counterpart obligations are independent of physical AST deduplication.
    // New package contexts are discovered once; aliases/cycles cannot reparse
    // seen files or repeatedly rediscover the same mapping.
    for (const pkg of packages.values()) if (inside(pkg.output, file)) {
      const counterpart = resolveFile(path.resolve(pkg.source, path.relative(pkg.output, file)), pkg.root);
      if (!inside(pkg.source, counterpart) || inside(pkg.output, counterpart) || !/\.tsx?$/.test(counterpart)) fail("missing source counterpart");
      pending.push(counterpart);
    }
    if (seen.has(file)) continue;
    if (seen.size >= 2048 || fs.statSync(file).size > 1_048_576) fail("source resource limit");
    seen.add(file);
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) fail("invalid module syntax");
    runtimeSyntaxPolicy(source);
    if (modelMetadata) {
      const statement = source.statements[0];
      if (source.statements.length !== 1 || !statement || !ts.isVariableStatement(statement)
        || !(statement.declarationList.flags & ts.NodeFlags.Const)
        || statement.modifiers?.length !== 1 || statement.modifiers[0]!.kind !== ts.SyntaxKind.ExportKeyword
        || statement.declarationList.declarations.length !== 1) fail("model-id leaf expanded beyond literal metadata");
      const declaration = statement.declarationList.declarations[0]!;
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "DEFAULT_MODEL"
        || !declaration.initializer || !ts.isStringLiteral(declaration.initializer)) fail("model-id leaf must remain a literal constant");
    }
    const imports: string[] = [], nodes: Array<{ node: ts.Node; depth: number }> = [{ node: source, depth: 0 }];
    while (nodes.length) {
      const { node, depth } = nodes.pop()!;
      if (depth > 128) fail("AST nesting limit");
      if (ts.isTypeNode(node)) continue;
      // Reject references as well as direct calls: aliasing require/fetch or
      // reading process.env must not hide a runtime edge from this walker.
      if (ts.isIdentifier(node) && ["require", "process", "Buffer", "eval", "Function", "fetch", "WebSocket", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "console"].includes(node.text)) fail("ambient IO/Node/dynamic execution reference forbidden");
      if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) fail("require/import equals forbidden");
      if (ts.isImportDeclaration(node)) {
        const c = node.importClause;
        const typeOnly = c?.isTypeOnly || c?.namedBindings && ts.isNamedImports(c.namedBindings) && !c.name && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every(e => e.isTypeOnly);
        if (!typeOnly) { if (!ts.isStringLiteral(node.moduleSpecifier)) fail("nonliteral import"); imports.push(node.moduleSpecifier.text); }
        continue; // Named bindings are declarations, not ambient runtime references.
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const typeOnly = node.isTypeOnly || node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(e => e.isTypeOnly);
        if (!typeOnly) { if (!ts.isStringLiteral(node.moduleSpecifier)) fail("nonliteral export"); imports.push(node.moduleSpecifier.text); }
        continue;
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expr = node.expression;
        if (expr.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(expr) && expr.text === "require" || ts.isPropertyAccessExpression(expr) && expr.name.text === "require") fail("dynamic import/require forbidden");
        if (/\b(?:fetch|WebSocket|XMLHttpRequest|localStorage|sessionStorage|indexedDB|console)\b/.test(expr.getText(source))) fail("runtime IO forbidden");
      }
      ts.forEachChild(node, child => { nodes.push({ node: child, depth: depth + 1 }); });
    }
    for (const id of imports) {
      if (id === "zod") { bare.add(id); continue; }
      if (id.startsWith(".")) pending.push(resolveFile(path.resolve(path.dirname(file), id), boundaryFor(file)));
      else pending.push(packageExport(id, file));
    }
  }
  return { seen, bare };
}
