/** Finite known-capability syntax policy. Not a JavaScript runtime sandbox. */
import ts from "typescript";

const namespaces = new Set(["globalThis", "global", "window", "self", "parent", "top", "frames"]);
const capabilities = new Set(["require", "process", "Buffer", "eval", "Function", "fetch", "WebSocket", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "console"]);

// Bounded syntax folding, not expression evaluation or constant propagation.
function literalKey(node: ts.Expression, depth = 0): string | undefined {
  if (depth > 16) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text.length <= 256 ? node.text : undefined;
  if (ts.isParenthesizedExpression(node)) return literalKey(node.expression, depth + 1);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalKey(node.left, depth + 1), right = literalKey(node.right, depth + 1);
    if (left !== undefined && right !== undefined && left.length + right.length <= 256) return left + right;
  }
  return undefined;
}

export function runtimeSyntaxPolicy(source: ts.SourceFile): void {
  // Binding only: no libraries, module resolution, reads or emission. Imported
  // aliases and JS binders remain declarations in this exact parsed file.
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, noEmit: true, allowJs: true, target: ts.ScriptTarget.Latest };
  const host: ts.CompilerHost = {
    getSourceFile: file => file === source.fileName ? source : undefined,
    getDefaultLibFileName: () => "", writeFile: () => { throw Error("syntax policy cannot emit"); },
    getCurrentDirectory: () => "", getDirectories: () => [], fileExists: file => file === source.fileName,
    readFile: () => undefined, getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
  const binding = (node: ts.Identifier) => ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
  function ambientDeclaration(node: ts.Node): boolean {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      if (ts.isSourceFile(current) && current.isDeclarationFile) return true;
      if (ts.canHaveModifiers(current) && ts.getModifiers(current)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return true;
    }
    return false;
  }
  function runtimeDeclaration(node: ts.Declaration): boolean {
    if (ambientDeclaration(node)) return false;
    if (ts.isImportSpecifier(node)) return !node.isTypeOnly && !node.parent.parent.isTypeOnly;
    if (ts.isImportClause(node)) return !node.isTypeOnly;
    if (ts.isNamespaceImport(node)) return !node.parent.isTypeOnly;
    if (ts.isFunctionDeclaration(node)) return !!node.body;
    // Default non-preserveConstEnums semantics: ordinary enums have a runtime
    // object; const/ambient enums do not establish a local runtime owner.
    if (ts.isEnumDeclaration(node)) return !ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ConstKeyword);
    if (ts.isEnumMember(node)) return runtimeDeclaration(node.parent);
    if (ts.isModuleDeclaration(node)) {
      const body = node.body;
      if (!body) return false;
      if (ts.isModuleDeclaration(body)) return runtimeDeclaration(body);
      if (!ts.isModuleBlock(body)) return false;
      return body.statements.some(statement => ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.some(runtimeDeclaration)
        : (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isModuleDeclaration(statement) || ts.isEnumDeclaration(statement)) && runtimeDeclaration(statement));
    }
    return ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isParameter(node)
      || ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isFunctionExpression(node);
  }
  const runtimeBinding = (node: ts.Identifier): boolean => binding(node)?.declarations?.some(runtimeDeclaration) ?? false;
  const ambientRoot = (node: ts.Expression) => ts.isIdentifier(node) && namespaces.has(node.text) && !runtimeBinding(node);
  function reference(node: ts.Identifier): boolean {
    const parent = node.parent;
    if ((ts.isPropertyAccessExpression(parent) && parent.name === node)
      || ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)
        || ts.isClassDeclaration(parent) || ts.isModuleDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node)
      || (ts.isPropertyAssignment(parent) && parent.name === node)
      || (ts.isBindingElement(parent) && parent.propertyName === node)
      || (ts.isMethodDeclaration(parent) && parent.name === node)
      || (ts.isLabeledStatement(parent) && parent.label === node)
      || ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)) return false;
    return true;
  }
  function directDigestOrAvailability(root: ts.Identifier): boolean {
    if (root.text !== "globalThis") return false;
    let expression: ts.Expression = root;
    const chain: ts.PropertyAccessExpression[] = [];
    while (ts.isPropertyAccessExpression(expression.parent) && expression.parent.expression === expression) {
      expression = expression.parent; chain.push(expression as ts.PropertyAccessExpression);
    }
    const keys = chain.map(member => member.name.text).join(".");
    if (keys === "crypto.subtle" && !chain[0]!.questionDotToken && chain[1]!.questionDotToken) {
      const negation = expression.parent;
      return ts.isPrefixUnaryExpression(negation) && negation.operator === ts.SyntaxKind.ExclamationToken
        && ts.isIfStatement(negation.parent) && negation.parent.expression === negation;
    }
    const call = expression.parent;
    return keys === "crypto.subtle.digest" && chain.every(member => !member.questionDotToken)
      && ts.isCallExpression(call) && call.expression === expression && !call.questionDotToken
      && call.arguments.length === 2 && ts.isStringLiteral(call.arguments[0]!) && call.arguments[0]!.text === "SHA-256";
  }
  const globalName = (node: ts.Node, name: string): boolean => ts.isIdentifier(node) && node.text === name && !runtimeBinding(node);
  const directMethod = (node: ts.Node, owner: string, member: string): node is ts.PropertyAccessExpression =>
    ts.isPropertyAccessExpression(node) && !node.questionDotToken && node.name.text === member && globalName(node.expression, owner);
  function erasedWrapper(node: ts.Node): node is ts.ParenthesizedExpression | ts.AsExpression | ts.TypeAssertion | ts.NonNullExpression | ts.SatisfiesExpression {
    return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node);
  }
  function unwrap(node: ts.Expression): ts.Expression {
    while (erasedWrapper(node)) node = node.expression;
    return node;
  }
  function outer(node: ts.Expression): ts.Expression {
    while (erasedWrapper(node.parent) && node.parent.expression === node) node = node.parent;
    return node;
  }
  // Resolve only the known Object owner through bounded const initializers;
  // this is not general value propagation or intrinsic-name patching.
  function objectOwner(node: ts.Expression, depth = 0, active = new Set<ts.Symbol>()): boolean {
    node = unwrap(node);
    if (globalName(node, "Object")) return true;
    if (depth >= 8 || !ts.isIdentifier(node)) return false;
    const symbol = binding(node), declarations = symbol?.declarations;
    if (!symbol || active.has(symbol) || declarations?.length !== 1) return false;
    const declaration = declarations[0]!;
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name) || !declaration.initializer
      || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return false;
    active.add(symbol);
    return objectOwner(declaration.initializer, depth + 1, active);
  }
  function prototypeRead(node: ts.Expression): ts.CallExpression | undefined {
    node = unwrap(node);
    if (!ts.isIdentifier(node)) return undefined;
    const declarations = binding(node)?.declarations;
    if (declarations?.length !== 1) return undefined;
    const declaration = declarations[0]!;
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name) || !declaration.initializer
      || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return undefined;
    const init = unwrap(declaration.initializer);
    return ts.isCallExpression(init) && !init.questionDotToken && init.arguments.length === 1 && directMethod(init.expression, "Object", "getPrototypeOf") ? init : undefined;
  }
  function prototypeValue(node: ts.Expression, read: ts.CallExpression): boolean {
    node = unwrap(node);
    if (ts.isPropertyAccessExpression(node) && !node.questionDotToken && node.name.text === "prototype" && globalName(node.expression, "Object")) return true;
    if (!ts.isConditionalExpression(node)) return false;
    const condition = unwrap(node.condition), yes = unwrap(node.whenTrue), no = unwrap(node.whenFalse);
    return ts.isCallExpression(condition) && !condition.questionDotToken && directMethod(condition.expression, "Array", "isArray")
      && condition.arguments.length === 1 && condition.arguments[0]!.getText(source) === read.arguments[0]!.getText(source)
      && ts.isPropertyAccessExpression(yes) && !yes.questionDotToken && yes.name.text === "prototype" && globalName(yes.expression, "Array")
      && ts.isPropertyAccessExpression(no) && !no.questionDotToken && no.name.text === "prototype" && globalName(no.expression, "Object");
  }
  function equalityOther(node: ts.Expression): ts.Expression | undefined {
    node = outer(node);
    const parent = node.parent;
    if (!ts.isBinaryExpression(parent) || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return undefined;
    return parent.left === node ? parent.right : parent.right === node ? parent.left : undefined;
  }
  function guardedPrototypeResult(call: ts.CallExpression): boolean {
    const init = outer(call), declaration = init.parent;
    if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== init || !ts.isIdentifier(declaration.name) || prototypeRead(declaration.name) !== call) return false;
    const symbol = binding(declaration.name), pending: ts.Node[] = [source]; let comparisons = 0;
    while (pending.length) {
      const node = pending.pop()!;
      if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) continue;
      if (ts.isIdentifier(node) && node !== declaration.name && reference(node) && binding(node) === symbol) {
        const other = equalityOther(node);
        if (!other || !(unwrap(other).kind === ts.SyntaxKind.NullKeyword || prototypeValue(other, call))) return false;
        comparisons++;
      }
      ts.forEachChild(node, child => { pending.push(child); });
    }
    return comparisons > 0;
  }
  function comparedPrototype(node: ts.Expression): boolean {
    let value = outer(node);
    if (ts.isConditionalExpression(value.parent) && (value.parent.whenTrue === value || value.parent.whenFalse === value)) value = outer(value.parent);
    const other = equalityOther(value), read = other && prototypeRead(other);
    return !!read && prototypeValue(value, read) && guardedPrototypeResult(read);
  }
  function inspectionInstall(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): boolean {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== "prototype" || node.questionDotToken || !ts.isIdentifier(node.expression)) return false;
    const classDeclarations = binding(node.expression)?.declarations;
    if (classDeclarations?.length !== 1 || !ts.isClassDeclaration(classDeclarations[0]!) || classDeclarations[0]!.getSourceFile() !== source) return false;
    const call = node.parent;
    if (!ts.isCallExpression(call) || call.questionDotToken || call.arguments.length !== 3 || call.arguments[0] !== node || !directMethod(call.expression, "Object", "defineProperty")) return false;
    const key = call.arguments[1]!, descriptor = call.arguments[2]!;
    if (!ts.isIdentifier(key) || !ts.isObjectLiteralExpression(descriptor) || descriptor.properties.length !== 4) return false;
    const declarations = binding(key)?.declarations, declaration = declarations?.[0];
    if (declarations?.length !== 1 || !declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer
      || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return false;
    const symbol = declaration.initializer;
    if (!ts.isCallExpression(symbol) || symbol.questionDotToken || !directMethod(symbol.expression, "Symbol", "for")
      || symbol.arguments.length !== 1 || !ts.isStringLiteral(symbol.arguments[0]!) || symbol.arguments[0]!.text !== "nodejs.util.inspect.custom") return false;
    const properties = new Map<string, ts.Expression>();
    for (const property of descriptor.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) || properties.has(property.name.text)) return false;
      properties.set(property.name.text, property.initializer);
    }
    if (!["enumerable", "writable", "configurable"].every(name => properties.get(name)?.kind === ts.SyntaxKind.FalseKeyword)) return false;
    const value = properties.get("value");
    if (!value || !ts.isFunctionExpression(value) || value.body.statements.length !== 1) return false;
    const statement = value.body.statements[0]!;
    if (!ts.isReturnStatement(statement) || !statement.expression || !ts.isCallExpression(statement.expression) || statement.expression.arguments.length) return false;
    const method = statement.expression.expression;
    return ts.isPropertyAccessExpression(method) && !method.questionDotToken && method.expression.kind === ts.SyntaxKind.ThisKeyword && method.name.text === "toString";
  }
  function callbackIteration(declaration: ts.VariableDeclaration): boolean {
    const list = declaration.parent, loop = list.parent;
    if (declaration.initializer || !ts.isVariableDeclarationList(list) || !(list.flags & ts.NodeFlags.Const)
      || !ts.isForOfStatement(loop) || loop.initializer !== list || loop.awaitModifier
      || !ts.isArrayLiteralExpression(loop.expression) || loop.expression.elements.length !== 1) return false;
    const spread = loop.expression.elements[0]!;
    if (!ts.isSpreadElement(spread) || !ts.isIdentifier(spread.expression)) return false;
    const symbol = binding(spread.expression), declarations = symbol?.declarations, set = declarations?.[0];
    if (!symbol || declarations?.length !== 1 || !set || !ts.isVariableDeclaration(set) || !set.initializer
      || !ts.isVariableDeclarationList(set.parent) || !(set.parent.flags & ts.NodeFlags.Const)
      || !ts.isNewExpression(set.initializer) || !globalName(set.initializer.expression, "Set") || set.initializer.arguments?.length) return false;
    const pending: ts.Node[] = [source];
    while (pending.length) {
      const node = pending.pop()!;
      if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) continue;
      if (ts.isIdentifier(node) && node !== set.name && binding(node) === symbol) {
        const parent = node.parent;
        if (ts.isSpreadElement(parent) && parent.expression === node && ts.isArrayLiteralExpression(parent.parent)
          && parent.parent.elements.length === 1 && ts.isForOfStatement(parent.parent.parent) && parent.parent.parent.expression === parent.parent) {
          // Only a direct local Set spread into this finite for-of grammar.
        } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node && ts.isCallExpression(parent.parent)
          && parent.parent.expression === parent && !parent.questionDotToken && !parent.parent.questionDotToken) {
          const call = parent.parent;
          if (parent.name.text === "clear") { if (call.arguments.length) return false; }
          else if (parent.name.text === "add" || parent.name.text === "delete") {
            if (call.arguments.length !== 1) return false;
            const argument = unwrap(call.arguments[0]!);
            if (ts.isIdentifier(argument)) {
              const values = binding(argument)?.declarations;
              if (!values?.length || !values.every(value => ts.isParameter(value) || ts.isFunctionDeclaration(value))) return false;
            } else if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) return false;
          } else return false;
        } else return false;
      }
      ts.forEachChild(node, child => { pending.push(child); });
    }
    return true;
  }
  // Finite callee grammar, with at most eight local initializer aliases.
  // This is not an arbitrary data-flow/return-value taint analysis.
  function supportedCallable(expression: ts.Expression, depth = 0, active = new Set<ts.Symbol>()): boolean {
    if (depth > 8) return false;
    expression = unwrap(expression);
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) || ts.isClassExpression(expression) || expression.kind === ts.SyntaxKind.SuperKeyword) return true;
    if (ts.isPropertyAccessExpression(expression)) {
      return !["call", "apply", "bind"].includes(expression.name.text) || supportedCallable(expression.expression, depth + 1, active);
    }
    if (ts.isConditionalExpression(expression)) return supportedCallable(expression.whenTrue, depth + 1, new Set(active)) && supportedCallable(expression.whenFalse, depth + 1, new Set(active));
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(expression.operatorToken.kind)) {
      return supportedCallable(expression.left, depth + 1, new Set(active)) && supportedCallable(expression.right, depth + 1, new Set(active));
    }
    if (!ts.isIdentifier(expression)) return false;
    const symbol = binding(expression), declarations = symbol?.declarations;
    if (!symbol || !declarations?.length) return true; // Unknown globals are not this finite policy's contract.
    if (active.has(symbol)) return false;
    active.add(symbol);
    if (declarations.every(declaration => ts.isFunctionDeclaration(declaration))) return true;
    if (declarations.length !== 1) return false;
    const declaration = declarations[0]!;
    if (ts.isVariableDeclaration(declaration)) return declaration.initializer ? supportedCallable(declaration.initializer, depth + 1, active) : callbackIteration(declaration);
    return ts.isParameter(declaration) || ts.isBindingElement(declaration) || ts.isImportSpecifier(declaration)
      || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration) || ts.isClassDeclaration(declaration);
  }
  const nodes: ts.Node[] = [source], callables: ts.Expression[] = [];
  while (nodes.length) {
    const node = nodes.pop()!;
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) continue;
    // Erased declarations/import binders are not runtime references themselves.
    if (ambientDeclaration(node) || ts.isImportDeclaration(node) || ts.isFunctionDeclaration(node) && !node.body) continue;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) callables.push(node.expression);
    if (ts.isTaggedTemplateExpression(node)) callables.push(node.tag);
    if (ts.isIdentifier(node) && reference(node) && ambientRoot(node) && !directDigestOrAvailability(node)) throw Error("Runtime import closure: known ambient capability namespace exposure forbidden");
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && !node.dotDotDotToken) {
      const property = node.propertyName ?? node.name;
      const key = ts.isIdentifier(property) || ts.isStringLiteral(property) ? property.text
        : ts.isComputedPropertyName(property) ? literalKey(property.expression) : undefined;
      if (key === undefined) throw Error("Runtime import closure: unsupported binding key");
      if (key === "constructor") throw Error("Runtime import closure: constructor access forbidden");
      if (key === "__proto__" || key === "prototype") throw Error("Runtime import closure: prototype access forbidden");
      const declaration = node.parent.parent;
      if (["getPrototypeOf", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors"].includes(key) && ts.isVariableDeclaration(declaration) && declaration.initializer && objectOwner(declaration.initializer)) throw Error("Runtime import closure: prototype access forbidden");
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : literalKey(node.argumentExpression);
      if (key === "constructor") throw Error("Runtime import closure: constructor access forbidden");
      if (key === "__proto__" || key === "prototype" && !comparedPrototype(node) && !inspectionInstall(node)) throw Error("Runtime import closure: prototype access forbidden");
      if (key === "getPrototypeOf" && objectOwner(node.expression)) {
        const call = node.parent;
        if (!directMethod(node, "Object", "getPrototypeOf") || !ts.isCallExpression(call) || call.expression !== node || !guardedPrototypeResult(call)) throw Error("Runtime import closure: prototype access forbidden");
      }
      // Preserve direct data-descriptor inspection, but not method extraction
      // or reflection over the intrinsic Object owner (including const aliases).
      if ((key === "getOwnPropertyDescriptor" || key === "getOwnPropertyDescriptors") && objectOwner(node.expression)) {
        const call = node.parent;
        if (!directMethod(node, "Object", key) || !ts.isCallExpression(call) || call.expression !== node || call.questionDotToken
          || call.arguments.length !== (key === "getOwnPropertyDescriptor" ? 2 : 1) || objectOwner(call.arguments[0]!)) throw Error("Runtime import closure: prototype access forbidden");
      }
      if (ambientRoot(node.expression) && key !== undefined && capabilities.has(key)) throw Error("Runtime import closure: known ambient capability access forbidden");
    }
    ts.forEachChild(node, child => { nodes.push(child); });
  }
  for (const callable of callables) if (!supportedCallable(callable)) throw Error("Runtime import closure: unsupported callable syntax or alias");
}
