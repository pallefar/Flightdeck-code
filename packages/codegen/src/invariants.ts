/** The generator polices its own output.
 *
 * ⭐ WHY THIS FILE EXISTS. The contract's non-negotiables are properties of
 * EMITTED TEXT, and the emitters are the things most likely to drift away
 * from them — a new operation kind added in a hurry, a handler that parses
 * a body one line too early. Checking the invariants on the emitters'
 * output, rather than trusting the emitters, means a regression shows up as
 * a thrown `CodegenInvariantError` at generation time instead of as a route
 * that answers with the kill switch off.
 *
 * Every check here reads the text the way a reviewer would, not the plan
 * the emitters were handed — so a check cannot pass because the plan said
 * the right thing while the emitter wrote something else.
 *
 * ── IMPORTS ARE CHECKED AGAINST AN ALLOWLIST ────────────────────────
 * Not against a list of forbidden modules. A blocklist of `node:fs`,
 * `better-sqlite3`, `../registry.js` is a list of the escapes somebody
 * already thought of; the next one is not on it. The allowlist says what an
 * emitted file of each kind may reach, full stop, and anything else is a
 * violation whether or not it looked dangerous. */
import { tablePrefix, underscored } from "./naming";
import type { SubAppPlan } from "./plan";

export interface GeneratedFile {
  /** Repo-relative path in the HOST repository. */
  path: string;
  contents: string;
  kind: "manifest" | "guard" | "routes-index" | "routes-domain" | "schema" | "web-module" | "patch";
}

export interface Violation {
  file: string;
  rule: string;
  detail: string;
}

export class CodegenInvariantError extends Error {
  constructor(readonly violations: readonly Violation[]) {
    super(
      `generated sub-app violates the sub-app contract:\n  - ${violations
        .map((v) => `[${v.rule}] ${v.file}: ${v.detail}`)
        .join("\n  - ")}`,
    );
  }
}

/** Anything reaching the database, the filesystem, a host service or a
 * sibling sub-app has to arrive through one of these. */
function allowedImports(plan: SubAppPlan, file: GeneratedFile): readonly string[] | null {
  switch (file.kind) {
    case "manifest":
      return ["../types.js", "./schema.js", "./routes/index.js"];
    case "guard":
      return ["fastify", "../../lib/flightdeckAudit.js", "../installRow.js", "../killSwitch.js", "../../project/types.js", "../../workspace/types.js"];
    case "routes-index":
      return ["fastify", "../../types.js", ...plan.domains.map((d) => `./${d.name}.js`)];
    case "routes-domain":
      return ["zod", "fastify", "../../types.js", "../../../workspace/types.js", "../../capabilities.js", "../guard.js"];
    case "schema":
      return ["../../db.js"];
    case "web-module":
      return ["react", "../registry"];
    case "patch":
      return null;
  }
}

const IMPORT_RE = /^import\s+(?:type\s+)?.*?from\s+"([^"]+)";\s*$/gm;

export function checkEmittedInvariants(files: readonly GeneratedFile[], plan: SubAppPlan): Violation[] {
  const violations: Violation[] = [];
  const add = (file: string, rule: string, detail: string) => violations.push({ file, rule, detail });

  const code = new Map<string, string>(files.map((f) => [f.path, stripComments(f.contents)]));
  const codeOf = (file: GeneratedFile) => code.get(file.path) ?? file.contents;

  for (const file of files) {
    if (file.kind === "patch") continue;
    checkImports(file, codeOf(file), add);
    checkNoCachedBooleans(file, codeOf(file), add);
    checkSql(file, codeOf(file), plan, add);
  }

  for (const file of files.filter((f) => f.kind === "routes-domain")) {
    checkNoTemplateLiterals(file, codeOf(file), add);
    checkAuditRoute(file, codeOf(file), add);
    checkZodStrict(file, codeOf(file), add);
    checkGuardFirst(file, codeOf(file), plan, add);
  }

  const manifest = files.find((f) => f.kind === "manifest");
  if (manifest === undefined) {
    add("(none)", "manifest-present", "no manifest.ts was emitted");
  } else if (!manifest.contents.includes(`minHostVersion: "5.0.0"`)) {
    add(manifest.path, "min-host-version", 'manifest must declare minHostVersion: "5.0.0"');
  }

  return violations;
}

type Add = (file: string, rule: string, detail: string) => void;

/** Comments are prose. Every textual check below runs on the file with its
 * comments blanked out, because an emitted banner legitimately quotes the
 * very things the checks look for — a header explaining that this file
 * contains no template literal must not itself trip the template-literal
 * check. Newlines survive so reported positions still line up. */
export function stripComments(source: string): string {
  const out = source.split("");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "`") {
      const end = source.indexOf("`", i + 1);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") out[j++] = " ";
      i = j - 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j++) if (source[j] !== "\n") out[j] = " ";
      i = stop - 1;
    }
  }
  return out.join("");
}

function checkImports(file: GeneratedFile, code: string, plan: SubAppPlan, add: Add): void {
  const allowed = allowedImports(plan, file);
  if (allowed === null) return;
  for (const match of code.matchAll(IMPORT_RE)) {
    const specifier = match[1] as string;
    if (!allowed.includes(specifier)) {
      add(
        file.path,
        "import-allowlist",
        `imports "${specifier}", which a ${file.kind} file may not reach (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

/** Contract rule 2. The kill switch, the install row and the granted scopes
 * are re-read per call; a module-level `process.env` read would turn the
 * kill switch into a restart-only control. The guard reaches the env
 * through `subAppKillSwitchEnabled`, which does the reading itself. */
function checkNoCachedBooleans(file: GeneratedFile, code: string, add: Add): void {
  if (code.includes("process.env")) {
    add(file.path, "no-cached-boolean", "reads process.env directly — the kill switch is read per call via subAppKillSwitchEnabled");
  }
  for (const match of code.matchAll(/^(?:const|let|var)\s+([A-Za-z0-9_]*[Ee]nabled[A-Za-z0-9_]*)\s*=/gm)) {
    add(file.path, "no-cached-boolean", `module-level "${match[1] as string}" caches an enable-state that must be re-read on every call`);
  }
}

/** Contract rule 3 + the table-prefix rule, checked on the SQL text itself
 * rather than on the plan that produced it. */
function checkSql(file: GeneratedFile, code: string, plan: SubAppPlan, add: Add): void {
  const prefix = tablePrefix(plan.id);
  const indexPrefix = `idx_${underscored(plan.id)}_`;
  for (const sql of extractStringContents(code)) {
    for (const match of sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const table = match[1] as string;
      if (!table.startsWith(prefix)) {
        add(file.path, "table-prefix", `SQL references table "${table}", which is not under "${prefix}"`);
      }
    }
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const table = match[1] as string;
      if (!table.startsWith(prefix)) add(file.path, "table-prefix", `DDL creates table "${table}", which is not under "${prefix}"`);
    }
    for (const match of sql.matchAll(/CREATE INDEX IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const [, index, table] = match as unknown as [string, string, string];
      if (!index.startsWith(indexPrefix)) add(file.path, "table-prefix", `DDL creates index "${index}", which is not under "${indexPrefix}"`);
      if (!table.startsWith(prefix)) add(file.path, "table-prefix", `DDL indexes table "${table}", which is not under "${prefix}"`);
    }
    if (/SELECT\s+\*/.test(sql)) {
      add(file.path, "explicit-columns", "SELECT * makes the response shape depend on the DDL — name the columns");
    }
  }
}

/** No template literal means no syntactic route from request data or spec
 * text into a SQL string. The rule is cheap to keep and impossible to
 * half-keep, which is why it is spelled this way rather than as "do not
 * interpolate into SQL". */
function checkNoTemplateLiterals(file: GeneratedFile, code: string, add: Add): void {
  if (code.includes("`")) {
    add(file.path, "no-template-literal", "contains a template literal — generated route files build strings with + so nothing can be interpolated into SQL");
  }
}

/** Contract rule 5 + rule 8. Routes audit through the injected adapter
 * only, and an event names FIELDS, never their values. */
function checkAuditRoute(file: GeneratedFile, code: string, add: Add): void {
  if (code.includes("appendFlightdeckAudit")) {
    add(file.path, "audit-via-capability", "calls appendFlightdeckAudit — a route audits only through ctx.capabilitiesFor(...).auditAppend");
  }
  for (const body of extractCallArguments(code, "auditAppend({")) {
    if (body.includes("parsed.data.")) {
      add(file.path, "audit-names-not-values", "an audit event reads a parsed body VALUE — events name fields (Object.keys), never their contents");
    }
  }
}

function checkZodStrict(file: GeneratedFile, code: string, add: Add): void {
  const objects = (code.match(/\.object\(\{/g) ?? []).length;
  const stricts = (code.match(/\.strict\(\)/g) ?? []).length;
  if (objects !== stricts) {
    add(file.path, "zod-strict", `${objects} z.object(...) but ${stricts} .strict() — an unknown key that passes silently is a widening nobody reviewed`);
  }
}

/** Contract rule 1, checked semantically: the guard call must be the first
 * thing in the handler, and nothing that parses, reads or writes may appear
 * above it. */
const BEFORE_GUARD_FORBIDDEN = ["safeParse", "rt.db", "capabilitiesFor", "req.body", "req.params", "appendFlightdeckAudit"];

function checkGuardFirst(file: GeneratedFile, code: string, plan: SubAppPlan, add: Add): void {
  const handlers = extractHandlers(code);
  if (handlers.length === 0) {
    add(file.path, "guard-first", "no route handler found — the guard check could not be verified, which is itself a failure");
    return;
  }
  for (const handler of handlers) {
    const guardAt = handler.body.indexOf(plan.names.guardFn);
    if (guardAt === -1) {
      add(file.path, "guard-first", `handler ${handler.route} never calls ${plan.names.guardFn}`);
      continue;
    }
    for (const token of BEFORE_GUARD_FORBIDDEN) {
      const at = handler.body.indexOf(token);
      if (at !== -1 && at < guardAt) {
        add(file.path, "guard-first", `handler ${handler.route} reaches "${token}" before calling ${plan.names.guardFn}`);
      }
    }
  }
}

interface ExtractedHandler {
  route: string;
  body: string;
}

const HANDLER_OPEN_RE = /app\.(get|post|patch|delete)\("([^"]+)",\s*async \(req, reply\) => \{/g;

export function extractHandlers(source: string): ExtractedHandler[] {
  const out: ExtractedHandler[] = [];
  for (const match of source.matchAll(HANDLER_OPEN_RE)) {
    const openBrace = (match.index ?? 0) + match[0].length - 1;
    const close = matchBrace(source, openBrace);
    if (close === -1) continue;
    out.push({ route: `${(match[1] as string).toUpperCase()} ${match[2] as string}`, body: source.slice(openBrace + 1, close) });
  }
  return out;
}

/** Brace matcher that skips string literals and line comments. Generated
 * route files contain no template literal (enforced above) and no regex
 * literal carrying a brace, so those two cases do not arise; an unbalanced
 * result returns -1 and the caller treats it as a failure rather than a
 * pass. */
function matchBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipString(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return source.length;
}

/** The contents of every double-quoted string and every template literal in
 * the file — where SQL lives. Approximate by design: it over-collects
 * rather than under-collects, so a table name can never hide from the
 * prefix check by sitting in an unexpected literal. */
export function extractStringContents(source: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      const end = skipString(source, i);
      out.push(source.slice(i + 1, end));
      i = end;
      continue;
    }
    if (ch === "`") {
      const end = source.indexOf("`", i + 1);
      if (end === -1) break;
      out.push(source.slice(i + 1, end));
      i = end;
    }
  }
  return out;
}

/** The text between `<marker>` and its matching close brace — used to read
 * the inside of an `auditAppend({ ... })` call. */
function extractCallArguments(source: string, marker: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) return out;
    const openBrace = at + marker.length - 1;
    const close = matchBrace(source, openBrace);
    if (close === -1) return out;
    out.push(source.slice(openBrace + 1, close));
    from = close;
  }
}
