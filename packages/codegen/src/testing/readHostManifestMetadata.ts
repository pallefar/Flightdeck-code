/** Static, bounded source conformance only. Never imports/evaluates host code.
 * Generated source admission MUST continue to use readEmittedManifest. */
import ts from "typescript";

type Fields = Map<string, ts.PropertyAssignment>;
export interface HostManifestContract {
  readonly coreFields: ReadonlySet<string>;
  readonly omittedFields: ReadonlyMap<string, "optional-schema" | "schema-stripped-callback">;
}
export interface OmittedHostMember {
  name: string;
  start: number;
  end: number;
  reason: "optional-schema" | "schema-stripped-callback";
}
function fail(message: string): never { throw new Error(`Host manifest source conformance: ${message}`); }
function parse(text: string): ts.SourceFile {
  if (Buffer.byteLength(text, "utf8") > 1_048_576) fail("source exceeds 1 MiB");
  // Bound parser nesting before constructing an AST. Tokens inside strings and
  // comments are inert. A conservative lexical bound may refuse exotic source.
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  let depth = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if ([ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.OpenBracketToken, ts.SyntaxKind.OpenParenToken].includes(token)) {
      if (++depth > 64) fail("source nesting exceeds 64");
    } else if ([ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseParenToken].includes(token)) depth--;
  }
  let source: ts.SourceFile;
  try { source = ts.createSourceFile("manifest.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
  catch { return fail("parser nesting/resource limit"); }
  const pending: Array<{ node: ts.Node; depth: number }> = [{ node: source, depth: 0 }];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > 64) fail("AST nesting exceeds 64");
    ts.forEachChild(current.node, child => { pending.push({ node: child, depth: current.depth + 1 }); });
  }
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) fail("invalid TypeScript syntax");
  return source;
}
function key(node: ts.PropertyName): string {
  if (!ts.isIdentifier(node) && !ts.isStringLiteral(node)) fail("computed/unsupported property key");
  const name = node.text;
  if (["__proto__", "constructor", "prototype"].includes(name)) fail(`unsafe key ${name}`);
  return name;
}
function fields(node: ts.ObjectLiteralExpression): Fields {
  const result: Fields = new Map();
  for (const member of node.properties) {
    if (!ts.isPropertyAssignment(member)) fail("spreads, accessors and shorthand members are forbidden");
    const name = key(member.name);
    if (result.has(name)) fail(`duplicate member ${name}`);
    result.set(name, member);
  }
  return result;
}
function declarations(source: ts.SourceFile): Map<string, ts.Expression> {
  const result = new Map<string, ts.Expression>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      if (result.has(decl.name.text)) fail(`duplicate declaration ${decl.name.text}`);
      result.set(decl.name.text, decl.initializer);
    }
  }
  return result;
}
function objectSchema(node: ts.Expression | undefined): ts.ObjectLiteralExpression {
  if (!node || !ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)
    || node.expression.expression.getText() !== "z" || node.expression.name.text !== "object"
    || node.arguments.length !== 1 || !ts.isObjectLiteralExpression(node.arguments[0]!)) fail("expected bare z.object schema (unknown-key strip semantics)");
  return node.arguments[0]! as ts.ObjectLiteralExpression;
}
function optional(node: ts.Expression): boolean {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "optional" && node.arguments.length === 0;
}
/** Canonical AST of the supported core Zod DSL, resolving only static const
 * aliases. Unsupported schema expressions fail closed, never execute/default. */
function canonical(node: ts.Expression, decls: Map<string, ts.Expression>, depth = 0): string {
  if (depth > 32) fail("schema alias/nesting limit");
  const next = (n: ts.Expression) => canonical(n, decls, depth + 1);
  if (ts.isAsExpression(node) && node.type.getText() === "const") return next(node.expression);
  if (ts.isIdentifier(node)) {
    const value = decls.get(node.text);
    if (!value) fail(`unresolved const schema alias ${node.text}`);
    return next(value);
  }
  if (ts.isStringLiteral(node)) return JSON.stringify(node.text);
  if (ts.isNumericLiteral(node) || ts.isRegularExpressionLiteral(node)) return node.getText();
  if (ts.isArrayLiteralExpression(node)) return `[${node.elements.map(n => next(n)).join(",")}]`;
  if (ts.isObjectLiteralExpression(node)) return `{${[...fields(node)].map(([name, prop]) => `${JSON.stringify(name)}:${next(prop.initializer)}`).join(",")}}`;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    if (!["object", "string", "regex", "min", "enum", "array", "optional"].includes(method)) fail(`unsupported core schema method ${method}`);
    const receiver = ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "z" ? "z" : next(node.expression.expression);
    return `${receiver}.${method}(${node.arguments.map(n => next(n)).join(",")})`;
  }
  return fail("unsupported core schema expression");
}
/** Pin every local core field's rules AND every live required data field.
 * Optional additive schemas are reported, not interpreted as runtime proof. */
export function readHostManifestContract(hostText: string, localText: string, specText: string): HostManifestContract {
  const host = parse(hostText);
  const hd = declarations(host);
  const ld = declarations(parse(localText));
  for (const [name, value] of declarations(parse(specText))) if (!ld.has(name)) ld.set(name, value);
  // The full host vocabulary is NOT generated-app admission. Pin the separate
  // general-role declaration too, so owner-only HRSS admission cannot leak into
  // the input contract while the seven-role metadata schema still agrees.
  const generalRoles = hd.get("GENERAL_ROLE_VALUES");
  const generatedRoles = ld.get("WORKSPACE_ROLES");
  if (!generalRoles || !generatedRoles || canonical(generalRoles, hd) !== canonical(generatedRoles, ld)) fail("general generated-app role admission drift");
  const hostFields = fields(objectSchema(hd.get("subAppManifestSchema")));
  const localFields = fields(objectSchema(ld.get("subAppManifestSchema")));
  for (const [name, prop] of localFields) {
    const actual = hostFields.get(name);
    if (!actual || canonical(actual.initializer, hd) !== canonical(prop.initializer, ld)) fail(`core schema drift: ${name}`);
  }
  const omittedFields = new Map<string, "optional-schema" | "schema-stripped-callback">();
  for (const [name, prop] of hostFields) {
    if (localFields.has(name)) continue;
    if (!optional(prop.initializer)) fail(`unmodelled required schema field ${name}`);
    omittedFields.set(name, "optional-schema");
  }
  const interfaces = host.statements.filter(ts.isInterfaceDeclaration).filter(n => n.name.text === "SubAppManifest");
  if (interfaces.length !== 1) fail("expected one SubAppManifest interface");
  const iface = interfaces[0]!;
  if (iface.heritageClauses?.length !== 1 || iface.heritageClauses[0]!.token !== ts.SyntaxKind.ExtendsKeyword
    || iface.heritageClauses[0]!.types.length !== 1 || iface.heritageClauses[0]!.types[0]!.getText() !== "SubAppManifestData") fail("SubAppManifest inheritance drift");
  const names = new Set<string>();
  for (const member of iface.members) {
    if ((!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) || !member.name) fail("unsupported manifest interface member");
    const name = key(member.name);
    if (names.has(name) || hostFields.has(name)) fail(`overlapping manifest interface member ${name}`);
    names.add(name);
    if (["initSchema", "registerRoutes"].includes(name) && (member.questionToken || !ts.isMethodSignature(member))) fail(`required callback declaration drift: ${name}`);
    if (!member.questionToken && !["initSchema", "registerRoutes"].includes(name)) fail(`unmodelled required interface member ${name}`);
    omittedFields.set(name, "schema-stripped-callback");
  }
  if (!names.has("initSchema") || !names.has("registerRoutes")) fail("required callback declaration drift");
  return { coreFields: new Set(localFields.keys()), omittedFields };
}
function literal(node: ts.Expression, depth = 0): unknown {
  if (depth > 32) fail("literal nesting exceeds 32");
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) {
    const value = Number(node.text);
    if (!Number.isFinite(value)) fail("nonfinite number");
    return value;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    const value = -Number(node.operand.text);
    if (!Number.isFinite(value)) fail("nonfinite number");
    return value;
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(n => literal(n, depth + 1));
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [name, prop] of fields(node)) value[name] = literal(prop.initializer, depth + 1);
    return value;
  }
  return fail("core metadata must be literal (no calls, references or interpolation)");
}
export function readHostManifestMetadata(text: string, contract: HostManifestContract): { metadata: Record<string, unknown>; omittedMembers: OmittedHostMember[] } {
  const source = parse(text);
  const candidates: ts.VariableDeclaration[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (decl.type?.getText() === "SubAppManifest") {
        if (!ts.isIdentifier(decl.name)) fail("manifest declaration must have a single identifier");
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) fail("manifest must be const");
        candidates.push(decl);
      }
    }
  }
  if (candidates.length !== 1) fail("expected exactly one typed SubAppManifest const");
  const initializer = candidates[0]!.initializer;
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) fail("manifest initializer must be an object literal");
  const metadata: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const omittedMembers: OmittedHostMember[] = [];
  for (const [name, prop] of fields(initializer)) {
    if (contract.coreFields.has(name)) metadata[name] = literal(prop.initializer);
    else {
      const reason = contract.omittedFields.get(name);
      if (!reason) fail(`undeclared manifest member ${name}`);
      omittedMembers.push({ name, start: prop.getStart(source), end: prop.end, reason });
    }
  }
  return { metadata, omittedMembers };
}
