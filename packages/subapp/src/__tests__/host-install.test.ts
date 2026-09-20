/** Follow the install document EXACTLY, then ask the host's compiler.
 *
 * ⭐ THE TEST THAT WOULD HAVE CAUGHT THE BUG. Every other fence in this
 * package reads Studio's files and reasons about them. The previous mount
 * passed all of those — and all four of the host's own sub-app fences — and
 * still did not install, because "the emitted files are clean" and "a
 * Flightdeck checkout can compile them" are different claims and only the
 * second one is the product. The specific failures were:
 *
 *   1. Following the documented install produced
 *      `Cannot find package '@spec/index'`, because the documented install was
 *      two lines in `registry.ts` and the emitted tree imported three of
 *      Studio's sibling packages.
 *   2. Vendoring those packages to fix (1) turned the host's own
 *      `npm run typecheck` RED, because they are authored for Studio's
 *      `moduleResolution: bundler` and the host's server compiles under
 *      NodeNext with `verbatimModuleSyntax`.
 *
 * So this file builds a Flightdeck-shaped checkout in a temp directory,
 * performs the install BY READING `EMIT_MANIFEST` AND `REGISTRY_EDIT` — not
 * by a list written out here, which could drift into being right about a
 * mapping that is wrong — and runs `tsc` over the result twice: once with the
 * server tier's NodeNext settings, once over the whole tree with the web
 * tier's bundler settings. Both with `paths` DELIBERATELY ABSENT.
 *
 * ⛔ IT IS NOT THE HOST, AND SAYS SO. The host modules in the sandbox are this
 * package's stand-ins — narrower models of the real ones, declaring only what
 * the emitted code uses. Source that compiles against a narrower type also
 * compiles against the wider real one, because it can only have used members
 * both of them have, so a pass here is evidence and not proof. What it proves
 * outright is the thing that actually broke: that nothing in the emitted tree
 * names a module a Flightdeck checkout does not have, and that the tree
 * survives the compiler settings the host uses.
 *
 * `npm run promote` and `scripts/mount-in-host.sh` remain the real answer,
 * against the real repository. This is the one that runs in two seconds on
 * every commit. */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EMIT_MANIFEST, HOST_STANDINS, INSTALL_STEPS, REGISTRY_EDIT } from "../emit.js";

const PACKAGE_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_SRC, "../../..");

/** The host tiers' compiler settings. NodeNext for the server — which is why
 * relative imports carry `.js` — and `bundler` for the web tier, which vite
 * builds. `paths` is absent from both, on purpose: the whole claim is that the
 * emitted tree needs no alias. */
const SERVER_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022"],
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
  },
  include: ["server"],
};

const WHOLE_TREE_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    module: "ESNext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    types: ["node"],
  },
  include: ["server", "web", "tests"],
};

function write(root: string, relative: string, contents: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

/** The install, performed by reading the mapping rather than by repeating it. */
function installInto(root: string): { copied: string[]; hostFilesTouched: string[] } {
  // The host, before Studio arrives. Its modules are this package's stand-ins.
  for (const standIn of HOST_STANDINS) {
    const target = join(root, standIn);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(PACKAGE_SRC, standIn), target);
  }
  // A registry with no Studio in it yet, shaped like the host's.
  write(
    root,
    "server/subapps/registry.ts",
    ['import type { SubAppManifest } from "./types.js";', "", 'export const HOST_VERSION = "5.0.0";', "export const SUBAPP_MANIFESTS: SubAppManifest[] = [", "];", ""].join("\n"),
  );

  // ── INSTALL STEP 1: copy the emitted files to their targets.
  const copied: string[] = [];
  for (const file of EMIT_MANIFEST) {
    const relative = file.target.replace(/^flightdeck\//, "");
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(PACKAGE_SRC, file.source), target);
    copied.push(relative);
  }

  // ── INSTALL STEP 2: the registry edit, and nothing else.
  const registryRelative = REGISTRY_EDIT.file.replace(/^flightdeck\//, "");
  const registry = readFileSync(join(root, registryRelative), "utf8");
  write(
    root,
    registryRelative,
    registry
      .replace('import type { SubAppManifest } from "./types.js";', `import type { SubAppManifest } from "./types.js";\n${REGISTRY_EDIT.importLine}`)
      .replace("export const SUBAPP_MANIFESTS: SubAppManifest[] = [", `export const SUBAPP_MANIFESTS: SubAppManifest[] = [\n${REGISTRY_EDIT.entryLines.join("\n")}`),
  );

  // ── INSTALL STEPS 3 AND 4: nothing. No vendoring, no tsconfig alias. The
  // absence is the point, so it is marked rather than merely not written.
  write(root, "package.json", JSON.stringify({ name: "mock-flightdeck-host", private: true, type: "module", version: "5.0.0" }, null, 2));
  write(root, "tsconfig.json", JSON.stringify(WHOLE_TREE_TSCONFIG, null, 2));
  write(root, "tsconfig.server.json", JSON.stringify(SERVER_TSCONFIG, null, 2));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));

  return { copied, hostFilesTouched: [registryRelative] };
}

const root = mkdtempSync(join(tmpdir(), "studio-host-install-"));
const installed = installInto(root);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function tsc(project: string): { ok: boolean; output: string } {
  try {
    execFileSync(join(REPO_ROOT, "node_modules/.bin/tsc"), ["-p", project], { cwd: root, encoding: "utf8", stdio: "pipe" });
    return { ok: true, output: "" };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("a Flightdeck host can BUILD the emitted sub-app", () => {
  it(
    "typechecks the server tier under NodeNext, strict, with no path alias at all",
    () => {
      const result = tsc("tsconfig.server.json");
      expect(result.ok, result.output).toBe(true);
    },
    120_000,
  );

  it(
    "typechecks server, web and the emitted tests together under the web tier's settings",
    () => {
      const result = tsc("tsconfig.json");
      expect(result.ok, result.output).toBe(true);
    },
    120_000,
  );

  it("needed no `paths` entry — which is the whole claim", () => {
    for (const config of ["tsconfig.json", "tsconfig.server.json"]) {
      const parsed = JSON.parse(readFileSync(join(root, config), "utf8")) as { compilerOptions: Record<string, unknown> };
      expect(parsed.compilerOptions.paths).toBeUndefined();
    }
  });

  it("copied nothing from packages/ — no vendored engine, at all", () => {
    // The version this replaced needed forty-six files from `packages/spec`,
    // `packages/codegen` and `packages/conformance` to resolve.
    for (const relative of installed.copied) {
      expect(relative.startsWith("packages/")).toBe(false);
    }
    expect(installed.copied.every((p) => p.startsWith("server/subapps/studio/") || p.startsWith("web/src/subapps/studio/") || p.startsWith("tests/subapps/studio/"))).toBe(true);
  });

  it("changed exactly one file that already existed: registry.ts", () => {
    expect(installed.hostFilesTouched).toEqual(["server/subapps/registry.ts"]);
    const registry = readFileSync(join(root, "server/subapps/registry.ts"), "utf8");
    expect(registry).toContain(REGISTRY_EDIT.importLine);
    for (const line of REGISTRY_EDIT.entryLines) expect(registry).toContain(line);
  });

  it("the install document describes the install that was just performed", () => {
    // Seven steps, and the two that matter most are the two that say "no".
    expect(INSTALL_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(INSTALL_STEPS[0]).toContain(String(EMIT_MANIFEST.length));
    expect(INSTALL_STEPS.some((step) => step.includes("No vendoring"))).toBe(true);
    expect(INSTALL_STEPS.some((step) => step.includes("No tsconfig change"))).toBe(true);
  });
});
