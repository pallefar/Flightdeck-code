/** `RESERVED_SUBAPP_IDS` is a TRANSCRIBED CONSTANT — a copy of the ids the
 * host's `SUBAPP_MANIFESTS` already occupies — so it gets a drift test read
 * off the host's own `server/subapps/registry.ts`.
 *
 * ⭐ WHY THIS EXISTS. The host registered a fifth manifest,
 * `knowledgeGuardianManifest`, and the reserved list kept its four. Nothing
 * went red: `planSubApp` and Studio's conversion (`existingSubAppIds`) both
 * happily accepted `knowledge-guardian` as a fresh id, and the registry patch
 * would have pushed a second entry beside the hand-written one — duplicate
 * nav path, duplicate route prefix, colliding table prefix.
 *
 * ⚠ IT RESOLVES THE MANIFEST'S REAL `id`, NOT THE IMPORT NAME. The host's
 * knowledge-guardian manifest does not write its id as a literal; it writes
 * `id: KNOWLEDGE_GUARDIAN_SUBAPP_ID`, a constant exported from `./guard.ts`.
 * A test that derived ids from import names (`knowledgeGuardianManifest` →
 * "knowledge-guardian") would agree with itself and prove nothing about the
 * string the host actually routes under. So every entry is traced to its
 * manifest file, the manifest object's own top-level `id:` is read, and an
 * identifier is followed to its `export const X = "..."` in that file or in
 * a relative import it names. Anything that cannot be traced is UNRESOLVED,
 * and unresolved is a failure — never a quiet skip.
 *
 * ⚠ NON-VACUOUS. A parser that resolved nothing would find nothing
 * unreserved. The host has five manifests today; fewer than five resolved
 * ids means the parser or the host changed shape, and that fails too.
 *
 * Absent host = FAIL, unless a human sets the exact acknowledgement string
 * `guardrails/src/host-source.ts` documents — the same semantics as the
 * guardrail divergence tests. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOST_ABSENCE_ACK_ENV,
  HOST_ABSENCE_ACK_VALUE,
  HOST_ROOT,
  balancedArray,
  readHostSource,
} from "../../../guardrails/src/host-source";
import { RESERVED_SUBAPP_IDS } from "../spec-contract";

const HOST_REGISTRY = path.join(HOST_ROOT, "flightdeck", "server", "subapps", "registry.ts");

/** Fewer resolved ids than this means the parse went wrong, not that the host
 * shrank: sub-app ids are locked once shipped (D-04). */
const MIN_RESOLVED_IDS = 5;

// ─────────────────────────────────────────────────────────────────────────
// The resolver — source text only, same posture as host-source.ts
// ─────────────────────────────────────────────────────────────────────────

type ReadFile = (absolutePath: string) => string | null;

interface ResolvedManifest {
  readonly entry: string;
  readonly file: string;
  readonly id: string;
  /** A top-level `generatedBy: "flightdeck-studio"` member: Studio's own app. */
  readonly generated: boolean;
}

interface UnresolvedManifest {
  readonly entry: string;
  readonly why: string;
}

interface RegistryIds {
  readonly resolved: readonly ResolvedManifest[];
  readonly unresolved: readonly UnresolvedManifest[];
}

/** Comments out, strings kept intact — a `//` inside `"https://…"` is not a
 * comment, and a regex-based stripper that thought so would eat a closing
 * quote and a brace with it. */
function stripComments(src: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? "";
    if (quote !== null) {
      out += ch;
      if (ch === "\\") {
        out += src[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** The body of the `{ ... }` opening at `open`, strings skipped. */
function objectBody(code: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i] ?? "";
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  return null;
}

/** The members of an object body split at depth-0 commas. */
function topLevelMembers(body: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] ?? "";
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) {
      members.push(body.slice(start, i));
      start = i + 1;
    }
  }
  members.push(body.slice(start));
  return members.map((m) => m.trim()).filter((m) => m !== "");
}

/** `import { a, b as c } from "./x.js"` → local name → { imported, specifier }. */
function namedImports(code: string): Map<string, { imported: string; specifier: string }> {
  const out = new Map<string, { imported: string; specifier: string }>();
  for (const m of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const specifier = m[2] ?? "";
    for (const part of (m[1] ?? "").split(",")) {
      const named = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (named?.[1]) out.set(named[2] ?? named[1], { imported: named[1], specifier });
    }
  }
  return out;
}

/** A relative `./x.js` specifier as the `.ts` file on disk. Bare specifiers
 * (packages) are not followed — an id constant from a package is unresolved. */
function relativeTs(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = path.resolve(path.dirname(fromFile), specifier);
  return target.endsWith(".js") ? `${target.slice(0, -3)}.ts` : target.endsWith(".ts") ? target : `${target}.ts`;
}

/** `(export) const NAME(: T) = "literal"( as const);` in `code`, or null. */
function stringConst(code: string, name: string): string | null {
  const m = new RegExp(`(?:^|[\\s;])const\\s+${name}\\s*(?::[^=]+)?=\\s*(["'])([^"'\\\\]*)\\1`).exec(code);
  return m?.[2] ?? null;
}

/** Resolve `id:`'s value: a literal, or an identifier traced to a string
 * const in the manifest file or in the relative module it imports it from. */
function resolveIdValue(value: string, manifestFile: string, code: string, read: ReadFile): string | { why: string } {
  const literal = /^(["'])([^"'\\]*)\1$/.exec(value);
  if (literal) return literal[2] ?? "";
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) return { why: `id is neither a string literal nor an identifier: \`${value}\`` };
  const local = stringConst(code, value);
  if (local !== null) return local;
  const imported = namedImports(code).get(value);
  if (imported === undefined) return { why: `identifier ${value} is neither a string const in the manifest nor imported` };
  const file = relativeTs(manifestFile, imported.specifier);
  if (file === null) return { why: `identifier ${value} is imported from a non-relative module "${imported.specifier}"` };
  const source = read(file);
  if (source === null) return { why: `identifier ${value}'s module ${file} is not readable` };
  const traced = stringConst(stripComments(source), imported.imported);
  return traced ?? { why: `no \`export const ${imported.imported} = "..."\` in ${file}` };
}

/** Every entry of the registry's `SUBAPP_MANIFESTS`, traced to its manifest's
 * real `id`. Never throws for one bad entry — it reports it unresolved, so
 * the test names every problem at once. Throws only when the registry itself
 * has no `SUBAPP_MANIFESTS` to read. */
function resolveRegistryIds(registryFile: string, read: ReadFile): RegistryIds {
  const registrySource = read(registryFile);
  if (registrySource === null) throw new Error(`registry not readable: ${registryFile}`);
  const code = stripComments(registrySource);
  const entries = topLevelMembers(balancedArray(code, "SUBAPP_MANIFESTS"));
  const imports = namedImports(code);
  const resolved: ResolvedManifest[] = [];
  const unresolved: UnresolvedManifest[] = [];

  for (const entry of entries) {
    if (!/^[A-Za-z_$][\w$]*$/.test(entry)) {
      unresolved.push({ entry, why: "entry is not a plain identifier (a spread or an inline object cannot be traced)" });
      continue;
    }
    const imported = imports.get(entry);
    if (imported === undefined) {
      unresolved.push({ entry, why: "no named import for this entry in the registry" });
      continue;
    }
    const manifestFile = relativeTs(registryFile, imported.specifier);
    if (manifestFile === null) {
      unresolved.push({ entry, why: `imported from a non-relative module "${imported.specifier}"` });
      continue;
    }
    const manifestSource = read(manifestFile);
    if (manifestSource === null) {
      unresolved.push({ entry, why: `manifest file ${manifestFile} is not readable` });
      continue;
    }
    const manifestCode = stripComments(manifestSource);
    const head = new RegExp(`const\\s+${imported.imported}\\b[^=]*=\\s*\\{`).exec(manifestCode);
    if (head === null) {
      unresolved.push({ entry, why: `no \`const ${imported.imported} = {\` in ${manifestFile}` });
      continue;
    }
    const body = objectBody(manifestCode, head.index + head[0].length - 1);
    if (body === null) {
      unresolved.push({ entry, why: `the object literal for ${imported.imported} is never closed` });
      continue;
    }
    const idMember = topLevelMembers(body)
      .map((m) => /^id\s*(?::\s*([\s\S]+))?$/.exec(m))
      .find((m) => m !== null);
    if (idMember === undefined || idMember === null) {
      unresolved.push({ entry, why: `${imported.imported} has no top-level \`id\` member` });
      continue;
    }
    const value = (idMember[1] ?? "id").trim();
    const id = resolveIdValue(value, manifestFile, manifestCode, read);
    const generated = topLevelMembers(body).some((m) => /^generatedBy\s*:\s*(["'])flightdeck-studio\1$/.test(m.trim()));
    if (typeof id === "string") resolved.push({ entry, file: manifestFile, id, generated });
    else unresolved.push({ entry, why: id.why });
  }
  return { resolved, unresolved };
}

function unreservedIds(registry: RegistryIds, reserved: readonly string[]): string[] {
  return registry.resolved.filter((r) => !r.generated).map((r) => r.id).filter((id) => !reserved.includes(id));
}

const readDisk: ReadFile = (file) => (fs.existsSync(file) ? readHostSource(file) : null);

// ─────────────────────────────────────────────────────────────────────────
// Against the real host
// ─────────────────────────────────────────────────────────────────────────

const hostAvailable = fs.existsSync(HOST_REGISTRY);
const acknowledged = process.env[HOST_ABSENCE_ACK_ENV] === HOST_ABSENCE_ACK_VALUE;

describe("the host registry, or a named reason it is absent", () => {
  it(`FAILS when the host registry could not be read [ack=${acknowledged ? HOST_ABSENCE_ACK_VALUE : "not given"}]`, () => {
    expect(
      hostAvailable || acknowledged,
      `HOST REGISTRY NOT READABLE at ${HOST_REGISTRY} — RESERVED_SUBAPP_IDS cannot be verified against the host. ` +
        `Set FLIGHTDECK_HOST_ROOT to the pallefar/project-contract checkout, or set ` +
        `${HOST_ABSENCE_ACK_ENV}=${HOST_ABSENCE_ACK_VALUE} to proceed knowingly unverified.`,
    ).toBe(true);
  });
});

describe.skipIf(!hostAvailable)(`RESERVED_SUBAPP_IDS vs the host registry at ${HOST_REGISTRY}`, () => {
  const registry = hostAvailable ? resolveRegistryIds(HOST_REGISTRY, readDisk) : { resolved: [], unresolved: [] };

  it("traces every SUBAPP_MANIFESTS entry to its manifest's real id — none unresolved", () => {
    expect(registry.unresolved, JSON.stringify(registry.unresolved, null, 2)).toEqual([]);
  });

  it(`resolves at least ${MIN_RESOLVED_IDS} ids (non-vacuous)`, () => {
    expect(registry.resolved.length).toBeGreaterThanOrEqual(MIN_RESOLVED_IDS);
  });

  it("⭐ reserves every id the host registers", () => {
    const missing = unreservedIds(registry, RESERVED_SUBAPP_IDS);
    expect(
      missing,
      `the host registers sub-app id(s) RESERVED_SUBAPP_IDS does not: ${missing.join(", ")} — add them in ` +
        "packages/codegen/src/spec-contract.ts, or codegen and Studio will generate over a live sub-app",
    ).toEqual([]);
  });

  it("follows an identifier id to its constant — knowledge-guardian is read out of guard.ts", () => {
    const kg = registry.resolved.find((r) => r.entry === "knowledgeGuardianManifest");
    expect(kg?.id).toBe("knowledge-guardian");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The resolver itself, on a synthetic host
// ─────────────────────────────────────────────────────────────────────────

describe("the resolver itself", () => {
  const root = "/synthetic/flightdeck/server/subapps";
  const registryFile = `${root}/registry.ts`;
  const manifest = (name: string, idExpr: string, extraImports = "") =>
    `import type { SubAppManifest } from "../types.js";\n${extraImports}\n` +
    `export const ${name}: SubAppManifest = {\n  // id: "a-comment-id"\n  id: ${idExpr},\n` +
    `  navItem: { id: "nested-id-not-the-manifest", path: "https://example.test/x" },\n  label: "{ not a brace }",\n};\n`;
  const files: Record<string, string> = {
    [registryFile]: [
      `import { subAppManifestSchema } from "./types.js";`,
      `import { alphaManifest } from "./alpha/manifest.js";`,
      `import { betaManifest } from "./beta/manifest.js";`,
      `import { gammaManifest } from "./gamma/manifest.js";`,
      `import { deltaManifest } from "./delta/manifest.js";`,
      `import { epsilonManifest } from "./epsilon/manifest.js";`,
      `import { zetaManifest } from "./zeta/manifest.js";`,
      `export const SUBAPP_MANIFESTS: SubAppManifest[] = [`,
      `  alphaManifest,`,
      `  betaManifest, // trailing comment`,
      `  /* block */ gammaManifest,`,
      `  deltaManifest,`,
      `  epsilonManifest,`,
      `  zetaManifest,`,
      `];`,
    ].join("\n"),
    [`${root}/alpha/manifest.ts`]: manifest("alphaManifest", `"alpha"`),
    [`${root}/beta/manifest.ts`]: manifest("betaManifest", `'beta'`),
    [`${root}/gamma/manifest.ts`]: `const GAMMA_ID = "gamma" as const;\n${manifest("gammaManifest", "GAMMA_ID")}`,
    [`${root}/delta/manifest.ts`]: manifest("deltaManifest", "DELTA_ID", `import { DELTA_ID } from "./guard.js";`),
    [`${root}/delta/guard.ts`]: `export const DELTA_ID: string = "delta";\n`,
    [`${root}/epsilon/manifest.ts`]: manifest("epsilonManifest", "ID", `import { EPSILON_ID as ID } from "./ids.js";`),
    [`${root}/epsilon/ids.ts`]: `export const EPSILON_ID = "epsilon";\n`,
    // The sixth manifest — the one a reserved list of five would miss.
    [`${root}/zeta/manifest.ts`]: manifest("zetaManifest", "ZETA_ID", `import { ZETA_ID } from "./guard.js";`),
    [`${root}/zeta/guard.ts`]: `export const ZETA_ID = "zeta";\n`,
  };
  const read: ReadFile = (file) => files[file] ?? null;

  it("resolves literals and traced constants, ignoring comments and nested ids", () => {
    const registry = resolveRegistryIds(registryFile, read);
    expect(registry.unresolved).toEqual([]);
    expect(registry.resolved.map((r) => r.id)).toEqual(["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
  });

  it("⭐ reports a sixth manifest the reserved list does not name as unreserved", () => {
    const registry = resolveRegistryIds(registryFile, read);
    expect(unreservedIds(registry, ["alpha", "beta", "gamma", "delta", "epsilon"])).toEqual(["zeta"]);
  });

  it("reports an id it cannot trace as unresolved rather than skipping it", () => {
    const broken: Record<string, string> = {
      ...files,
      [`${root}/zeta/guard.ts`]: `export const ZETA_ID = computeId();\n`,
      [`${root}/delta/manifest.ts`]: manifest("deltaManifest", "`delta`"),
    };
    const registry = resolveRegistryIds(registryFile, (file) => broken[file] ?? null);
    expect(registry.unresolved.map((u) => u.entry)).toEqual(["deltaManifest", "zetaManifest"]);
    expect(registry.resolved).toHaveLength(4);
  });

  it("a manifest Studio GENERATED (top-level generatedBy marker) is Studio's own, not a live sub-app to reserve", () => {
    // mount-into-worktree.sh puts a generated app into an OS worktree; the
    // codegen CLI then refuses to overwrite it without --force, and the same
    // spec regenerates it byte for byte. Reserving it would make Studio unable
    // to regenerate its own app. A marker in a comment or a nested object
    // does not count — only the manifest's own top-level member.
    const marked = (idExpr: string, marker: string) =>
      manifest("zetaManifest", idExpr, `import { ZETA_ID } from "./guard.js";`).replace(
        `  label: "{ not a brace }",\n`,
        `  label: "{ not a brace }",\n${marker}\n`,
      );
    const generated: Record<string, string> = { ...files, [`${root}/zeta/manifest.ts`]: marked("ZETA_ID", `  generatedBy: "flightdeck-studio",`) };
    const reg = resolveRegistryIds(registryFile, (file) => generated[file] ?? null);
    expect(unreservedIds(reg, ["alpha", "beta", "gamma", "delta", "epsilon"])).toEqual([]);
    for (const marker of [`  // generatedBy: "flightdeck-studio",`, `  nested: { generatedBy: "flightdeck-studio" },`]) {
      const fake: Record<string, string> = { ...files, [`${root}/zeta/manifest.ts`]: marked("ZETA_ID", marker) };
      const r = resolveRegistryIds(registryFile, (file) => fake[file] ?? null);
      expect(unreservedIds(r, ["alpha", "beta", "gamma", "delta", "epsilon"]), marker).toEqual(["zeta"]);
    }
  });

  it("reports an entry whose manifest file is missing as unresolved", () => {
    const { [`${root}/alpha/manifest.ts`]: _gone, ...rest } = files;
    const registry = resolveRegistryIds(registryFile, (file) => rest[file] ?? null);
    expect(registry.unresolved.map((u) => u.entry)).toEqual(["alphaManifest"]);
  });
});
