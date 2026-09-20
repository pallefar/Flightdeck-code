/** Does it compile against the host?
 *
 * ⭐ WHY THIS IS A SEPARATE ANSWER FROM THE CONTRACT CHECKS. Every other
 * check in this package answers "does this obey the sub-app contract?".
 * None of them answers "does this work?", and the two are independent: a
 * file can name its tables correctly, guard every handler and import only
 * leaves, and still not compile — a missing `await`, a column that is not
 * on the row type, `useState(null)` followed by `setError("...")`. A
 * sub-app is compiled INTO the host, so a type error in it is not a
 * runtime surprise in someone's browser, it is a red host build that
 * blocks every other change in that repo until somebody reverts it. That
 * makes the compiler the single highest-value second opinion available,
 * and it is free: `typescript` is already a dependency.
 *
 * ⛔ THE COMPILER IS THE AUTHORITY, THIS FILE IS NOT. There is no attempt
 * here to decide which diagnostics matter. Every error TypeScript reports
 * against a candidate file becomes a finding, at the compiler's own line
 * and column, carrying the compiler's own message. Diagnostics against the
 * host surface or node_modules are NOT the candidate's fault, so they are
 * reported separately as a gate malfunction (FD-Z001) — a wrong surface
 * must look like a broken gate, never like a broken app.
 *
 * The program is built over an in-memory overlay rooted inside the repo,
 * so bare specifiers (`zod`, `react`, `fastify`) resolve to the REAL
 * packages the host carries while the candidate itself never touches
 * disk. Nothing is written until `shipSubApp` decides to write it. */
import ts from "typescript";
import type { CandidateFile } from "../analyze";
import { CANDIDATE_SCOPE, NO_POSITION, finding, type Finding } from "../finding";
import { FLIGHTDECK_HOST_SURFACE, type HostSurface } from "./host-surface";

/** `Cannot find module '…' or its corresponding type declarations.` and
 * its `--moduleResolution` variants. */
const UNRESOLVED_MODULE_CODES = new Set([2307, 2792, 2834, 2835]);

export interface TypecheckOptions {
  /** The directory whose `node_modules` supplies `zod`, `react` and
   * `fastify`. Defaults to the current working directory. */
  readonly repoRoot?: string;
  readonly hostSurface?: HostSurface;
}

export interface TypecheckResult {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  /** Every diagnostic, formatted the way `tsc` would print it, kept
   * whether or not it changed the verdict. A caller repairing generated
   * code needs the compiler's own words, not this package's summary. */
  readonly output: string;
  readonly diagnosticCount: number;
  /** Repo-relative path -> emitted JavaScript, for the mount probe. The
   * real emitter runs, so type-only imports are elided using type
   * information rather than guessed at syntactically. */
  readonly emitted: ReadonlyMap<string, string>;
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  skipLibCheck: true,
  resolveJsonModule: true,
  esModuleInterop: true,
  forceConsistentCasingInFileNames: true,
  // A sub-app may not import a node builtin (contract §5.3), so it does
  // not get node's globals either. `process.env` in generated code is a
  // type error here as well as a contract violation — two independent
  // derivations of the same rule, which is this package's house style.
  types: [],
  noEmit: false,
  declaration: false,
  sourceMap: false,
};

export function typecheckCandidate(files: readonly CandidateFile[], options: TypecheckOptions = {}): TypecheckResult {
  const repoRoot = normalizeDir(options.repoRoot ?? process.cwd());
  const surface = options.hostSurface ?? FLIGHTDECK_HOST_SURFACE;

  // Virtual, never created. It lives under the repo so that walking up
  // for `node_modules` finds the host's real dependency tree.
  const root = join(repoRoot, ".flightdeck-verify");
  const outRoot = join(repoRoot, ".flightdeck-verify-out");

  const overlay = new Map<string, string>();
  const candidatePaths = new Map<string, string>(); // absolute -> repo-relative
  const roots: string[] = [];

  for (const file of files) {
    if (!/\.(ts|tsx|mts|cts)$/.test(file.path)) continue;
    const absolute = join(root, file.path);
    overlay.set(absolute, file.contents);
    candidatePaths.set(absolute, file.path);
    roots.push(absolute);
  }
  for (const [module, source] of Object.entries(surface.types)) {
    overlay.set(join(root, `${module}.d.ts`), source);
  }
  for (const [module, source] of Object.entries(surface.ambient)) {
    const absolute = join(root, `${module}.d.ts`);
    overlay.set(absolute, source);
    roots.push(absolute);
  }

  if (roots.length === 0 || candidatePaths.size === 0) {
    return {
      ok: true,
      findings: [],
      output: "no TypeScript source in the candidate — nothing to compile",
      diagnosticCount: 0,
      emitted: new Map(),
    };
  }

  const compilerOptions: ts.CompilerOptions = { ...COMPILER_OPTIONS, rootDir: root, outDir: outRoot };
  const host = overlayHost(compilerOptions, overlay, repoRoot);
  const emitted = new Map<string, string>();
  host.writeFile = (fileName, text) => {
    const relative = relativeTo(outRoot, normalizeSlashes(fileName));
    if (relative !== null) emitted.set(relative, text);
  };

  const program = ts.createProgram(roots, compilerOptions, host);
  const emitResult = program.emit();

  const diagnostics = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...emitResult.diagnostics,
  ].filter((d) => d.category === ts.DiagnosticCategory.Error);

  const findings: Finding[] = [];
  let foreign = 0;

  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    const file = diagnostic.file;
    const relative = file === undefined ? null : (candidatePaths.get(normalizeSlashes(file.fileName)) ?? null);

    if (relative === null) {
      foreign++;
      continue;
    }

    const at = file === undefined || diagnostic.start === undefined
      ? NO_POSITION
      : positionOf(file, diagnostic.start);
    const rule = diagnostic.code >= 1000 && diagnostic.code < 2000
      ? "FD-T001"
      : UNRESOLVED_MODULE_CODES.has(diagnostic.code)
        ? "FD-T002"
        : "FD-T003";

    findings.push(
      finding(
        rule,
        relative,
        at,
        rule === "FD-T002"
          ? `${message} (TS${diagnostic.code}) — this import does not exist in the host, so the file cannot compile there; a sub-app may only reach the host through the nine leaf modules the contract lists`
          : `${message} (TS${diagnostic.code}) — a sub-app is compiled INTO the host, so this does not fail at runtime, it turns the host build red`,
        file === undefined || diagnostic.start === undefined ? undefined : lineTextOf(file, diagnostic.start),
      ),
    );
  }

  if (foreign > 0) {
    findings.push(
      finding(
        "FD-Z001",
        CANDIDATE_SCOPE,
        NO_POSITION,
        `${foreign} compiler error${foreign === 1 ? "" : "s"} landed outside the candidate, in the host surface or in node_modules — that is a fault in this gate's model of the host, not in the generated app, and the gate refuses rather than reporting a verdict it cannot stand behind`,
      ),
    );
  }

  return {
    ok: findings.length === 0,
    findings,
    output: formatDiagnostics(diagnostics, root),
    diagnosticCount: diagnostics.length,
    emitted,
  };
}

// ── The overlay compiler host ───────────────────────────────────────────

/** ⛔ MODULE RESOLUTION IS OURS, NOT `ts.sys`'s. TypeScript resolves a
 * relative specifier by asking the host whether directories and files
 * exist; the candidate's directories exist nowhere, so the stock
 * resolution walks off the end of the overlay and reports every internal
 * import as missing. Resolving relative specifiers against the overlay
 * first — including the `./schema.js` -> `schema.ts` substitution the
 * host's own ESM build relies on — is what makes the program whole.
 * Bare specifiers fall through to the real resolver, which is the point:
 * `zod` must be the host's actual `zod`. */
function overlayHost(options: ts.CompilerOptions, overlay: ReadonlyMap<string, string>, repoRoot: string): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const base = {
    fileExists: host.fileExists.bind(host),
    readFile: host.readFile.bind(host),
    getSourceFile: host.getSourceFile.bind(host),
    directoryExists: host.directoryExists?.bind(host),
  };
  const overlayDirs = new Set<string>();
  for (const file of overlay.keys()) {
    for (let dir = dirnameOf(file); dir.length > 1; dir = dirnameOf(dir)) overlayDirs.add(dir);
  }

  host.fileExists = (fileName) => overlay.has(normalizeSlashes(fileName)) || base.fileExists(fileName);
  host.readFile = (fileName) => overlay.get(normalizeSlashes(fileName)) ?? base.readFile(fileName);
  host.directoryExists = (dir) =>
    overlayDirs.has(normalizeSlashes(dir)) || (base.directoryExists === undefined ? false : base.directoryExists(dir));
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const source = overlay.get(normalizeSlashes(fileName));
    if (source !== undefined) return ts.createSourceFile(fileName, source, languageVersion, true);
    return base.getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  host.resolveModuleNameLiterals = (moduleLiterals, containingFile) =>
    moduleLiterals.map((literal) => resolveOne(literal.text, containingFile, options, overlay, host, repoRoot));

  return host;
}

function resolveOne(
  specifier: string,
  containingFile: string,
  options: ts.CompilerOptions,
  overlay: ReadonlyMap<string, string>,
  host: ts.CompilerHost,
  repoRoot: string,
): ts.ResolvedModuleWithFailedLookupLocations {
  if (specifier.startsWith(".")) {
    const base = join(dirnameOf(normalizeSlashes(containingFile)), specifier);
    const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    for (const candidate of [base, stripped]) {
      for (const suffix of [".ts", ".tsx", ".d.ts", "", "/index.ts", "/index.tsx", "/index.d.ts"]) {
        const attempt = `${candidate}${suffix}`;
        if (!overlay.has(attempt)) continue;
        return {
          resolvedModule: {
            resolvedFileName: attempt,
            extension: attempt.endsWith(".d.ts") ? ts.Extension.Dts : attempt.endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts,
            isExternalLibraryImport: false,
          },
          failedLookupLocations: [],
        } as ts.ResolvedModuleWithFailedLookupLocations;
      }
    }
  }
  return ts.resolveModuleName(specifier, containingFile, options, {
    fileExists: (f) => host.fileExists(f),
    readFile: (f) => host.readFile(f),
    directoryExists: (d) => (host.directoryExists === undefined ? true : host.directoryExists(d)),
    getCurrentDirectory: () => repoRoot,
    getDirectories: (d) => (host.getDirectories === undefined ? [] : host.getDirectories(d)),
    ...(ts.sys.realpath === undefined ? {} : { realpath: ts.sys.realpath }),
    useCaseSensitiveFileNames: true,
  });
}

// ── Small path helpers, POSIX-shaped like the rest of this package ──────

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function normalizeDir(path: string): string {
  const unified = normalizeSlashes(path);
  return unified.endsWith("/") ? unified.slice(0, -1) : unified;
}

function join(base: string, relative: string): string {
  return normalizeSlashes(`${base}/${relative}`);
}

function dirnameOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at <= 0 ? "/" : path.slice(0, at);
}

function relativeTo(root: string, path: string): string | null {
  const prefix = `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function positionOf(file: ts.SourceFile, start: number): { line: number; column: number } {
  const { line, character } = file.getLineAndCharacterOfPosition(start);
  return { line: line + 1, column: character + 1 };
}

function lineTextOf(file: ts.SourceFile, start: number): string {
  const { line } = file.getLineAndCharacterOfPosition(start);
  const lines = file.getFullText().split(/\r?\n/);
  return (lines[line] ?? "").trim();
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[], root: string): string {
  if (diagnostics.length === 0) return "tsc: no errors";
  return ts
    .formatDiagnostics(diagnostics as ts.Diagnostic[], {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    })
    .split(`${root}/`)
    .join("");
}
