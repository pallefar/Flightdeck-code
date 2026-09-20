/** The mapping from this package's tree to a Flightdeck checkout.
 *
 * ⭐ THE FAILURE THIS PREVENTS. The tree under `src/server` and `src/web`
 * mirrors the host's layout, and most of it is STAND-INS: narrower models of
 * host modules that already exist, present so the emitted files typecheck and
 * run outside a checkout. Installing one would overwrite a real host module
 * with a copy that declares three of its twelve members — the single genuinely
 * destructive thing this mapping could do. So the two lists are asserted
 * disjoint, and every file under `studio/` is asserted to be accounted for in
 * one of them: a fifth Studio file added without a manifest entry fails here
 * rather than silently not shipping.
 *
 * The manifest's own claims about Studio (id, route prefix, host floor) are
 * checked against the manifest object itself rather than restated, so the two
 * cannot drift. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EMIT_MANIFEST,
  HOST_DEPENDENCIES,
  HOST_STANDINS,
  INSTALL_STEPS,
  NODE_BUILTINS_IN_TESTS,
  REGISTRY_EDIT,
  STUDIO_MIN_HOST_VERSION,
  STUDIO_ONLY,
  STUDIO_ROUTE_PREFIX,
  STUDIO_SUBAPP_ID,
  TEST_ONLY_DEPENDENCIES,
} from "../emit.js";
import { studioManifest } from "../server/subapps/studio/manifest.js";

const PACKAGE_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(relative(PACKAGE_SRC, full));
  }
  return out;
}

describe("the emit manifest", () => {
  it("names 10 files, and every one of them is on disk", () => {
    expect(EMIT_MANIFEST).toHaveLength(10);
    for (const file of EMIT_MANIFEST) {
      expect(existsSync(join(PACKAGE_SRC, file.source)), `missing: ${file.source}`).toBe(true);
    }
  });

  it("accounts for every file under studio/, so a new one cannot silently not ship", () => {
    const onDisk = [
      ...walk(join(PACKAGE_SRC, "server/subapps/studio")),
      ...walk(join(PACKAGE_SRC, "web/src/subapps/studio")),
      ...walk(join(PACKAGE_SRC, "tests/subapps/studio")),
    ];
    expect(onDisk.sort()).toEqual([...EMIT_MANIFEST].map((f) => f.source).sort());
  });

  it("emits three host tests, in the folder the G3 layout fence requires", () => {
    // `tests/subapps/subappManifest.test.ts` fails a sub-app whose tests sit
    // in the flat `tests/` root. The vitest glob is already recursive, so
    // placing them is all the wiring there is.
    const hostTests = EMIT_MANIFEST.filter((file) => file.role === "host-test");
    expect(hostTests).toHaveLength(3);
    for (const test of hostTests) {
      expect(test.target.startsWith("flightdeck/tests/subapps/studio/")).toBe(true);
      expect(test.source.startsWith("tests/subapps/studio/")).toBe(true);
    }
  });

  it("never emits a host stand-in", () => {
    const emitted = new Set(EMIT_MANIFEST.map((f) => f.source));
    for (const standIn of HOST_STANDINS) {
      expect(emitted.has(standIn), `${standIn} is a model of a host module and must never be installed`).toBe(false);
    }
  });

  it("every stand-in it names is on disk, and every stand-in on disk is named", () => {
    for (const standIn of HOST_STANDINS) {
      expect(existsSync(join(PACKAGE_SRC, standIn)), `missing: ${standIn}`).toBe(true);
    }
    const shipped = new Set([...EMIT_MANIFEST.map((f) => f.source), ...HOST_STANDINS, ...STUDIO_ONLY, "emit.ts", "index.ts"]);
    const unaccounted = [
      ...walk(join(PACKAGE_SRC, "server")),
      ...walk(join(PACKAGE_SRC, "web")),
      ...walk(join(PACKAGE_SRC, "tests")),
      ...walk(join(PACKAGE_SRC, "studio")),
      "emit.ts",
      "index.ts",
    ].filter((file) => !shipped.has(file));
    expect(unaccounted).toEqual([]);
  });

  it("gives every file a distinct target inside the host's own directories", () => {
    const targets = EMIT_MANIFEST.map((f) => f.target);
    expect(new Set(targets).size).toBe(targets.length);
    for (const file of EMIT_MANIFEST) {
      const expected =
        file.role === "web-module"
          ? "flightdeck/web/src/subapps/studio/"
          : file.role === "host-test"
            ? "flightdeck/tests/subapps/studio/"
            : "flightdeck/server/subapps/studio/";
      expect(file.target.startsWith(expected), `${file.target} does not sit under ${expected}`).toBe(true);
      expect(file.target).toBe(`flightdeck/${file.source}`);
    }
  });

  it("vendors nothing: the install is the ten files plus one registry edit", () => {
    // ⭐ THE CLAIM THAT USED TO BE FALSE. The previous mapping said the host
    // edit was two lines in registry.ts while the emitted tree imported three
    // of Studio's sibling packages — so following it produced
    // "Cannot find package '@spec/index'", and the forty-six-file vendoring
    // that fixed THAT turned the host's own typecheck red.
    for (const step of INSTALL_STEPS) {
      expect(step.length).toBeGreaterThan(20);
    }
    expect(INSTALL_STEPS.join(" ")).toContain("No vendoring");
    expect(INSTALL_STEPS.join(" ")).toContain("No tsconfig change");
    // Named as Studio-only, and genuinely absent from what travels.
    expect(STUDIO_ONLY).toContain("studio/conversion.ts");
    expect(EMIT_MANIFEST.map((f) => f.source)).not.toContain("studio/conversion.ts");
  });

  it("declares only packages a Flightdeck host already has", () => {
    expect([...HOST_DEPENDENCIES]).toEqual(["zod", "fastify", "react", "react-dom/server"]);
    for (const dependency of HOST_DEPENDENCIES) {
      expect(/^@(spec|codegen|conformance)/.test(dependency)).toBe(false);
    }
    // A `node:` specifier is admitted for emitted TESTS only; a mounted module
    // carrying one fails the host's own import-closure fence. `vitest` is
    // listed apart from the runtime four for the same reason: a devDependency
    // in the runtime list would overstate what mounting Studio costs.
    expect([...NODE_BUILTINS_IN_TESTS].every((s) => s.startsWith("node:"))).toBe(true);
    expect([...TEST_ONLY_DEPENDENCIES]).toEqual(["vitest"]);
    for (const dependency of TEST_ONLY_DEPENDENCIES) expect(HOST_DEPENDENCIES).not.toContain(dependency);
  });

  it("names the registry edit as the ONE existing host file the install touches", () => {
    expect(REGISTRY_EDIT.file).toBe("flightdeck/server/subapps/registry.ts");
    const targets = EMIT_MANIFEST.map((file) => file.target);
    expect(targets).not.toContain(REGISTRY_EDIT.file);
    // Every emitted file lands in one of the sub-app's own three directories,
    // so nothing else in the host is overwritten by copying them.
    for (const target of targets) {
      expect(
        target.startsWith("flightdeck/server/subapps/studio/") ||
          target.startsWith("flightdeck/web/src/subapps/studio/") ||
          target.startsWith("flightdeck/tests/subapps/studio/"),
      ).toBe(true);
    }
  });
});

describe("the emitted files carry no test seam", () => {
  it("nothing under studio/ calls a stand-in-only function", () => {
    for (const file of EMIT_MANIFEST) {
      const source = readFileSync(join(PACKAGE_SRC, file.source), "utf8");
      // `standInSetInstallRow`, `standInAuditEntries`, … exist only in this
      // package. A call to one would compile here and fail to resolve in the
      // host, which is the worst possible place to find out.
      expect(source, `${file.source} reaches for a stand-in seam`).not.toMatch(/\bstandIn[A-Z]/);
    }
  });

  it("nothing under studio/ ships a stylesheet import", () => {
    for (const file of EMIT_MANIFEST) {
      const source = readFileSync(join(PACKAGE_SRC, file.source), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']+\.css["']/);
      expect(source).not.toMatch(/import\s+["'][^"']+\.css["']/);
    }
  });

  it("no emitted file reaches for a Studio engine package or a tsconfig alias", () => {
    for (const file of EMIT_MANIFEST) {
      const source = readFileSync(join(PACKAGE_SRC, file.source), "utf8");
      expect(source, `${file.source} names a Studio engine package`).not.toMatch(/from\s+["']@(spec|codegen|conformance)/);
      expect(source, `${file.source} imports Studio's generator half`).not.toMatch(/["'][^"']*studio\/conversion/);
    }
  });

  it("the page ships no i18n key — the host's frozen key counts are exact equality", () => {
    const page = readFileSync(join(PACKAGE_SRC, "web/src/subapps/studio/index.tsx"), "utf8");
    // `tests/subapps/i18nSplit.test.ts` asserts `TOTAL_KEYS = 4071`, not
    // `toBeGreaterThan`, so one key turns a host test red.
    expect(page).not.toMatch(/\bfrom\s+["'][^"']*i18n["']/);
    expect(page).not.toMatch(/\bt\(["']/);
    expect(page).not.toMatch(/\btf\(["']/);
  });
});

describe("the manifest Studio actually declares", () => {
  it("matches what the emit manifest claims about it", () => {
    expect(studioManifest.id).toBe(STUDIO_SUBAPP_ID);
    expect(studioManifest.routePrefix).toBe(STUDIO_ROUTE_PREFIX);
    expect(studioManifest.minHostVersion).toBe(STUDIO_MIN_HOST_VERSION);
    expect(REGISTRY_EDIT.importLine).toContain(`./${studioManifest.id}/manifest.js`);
  });

  it("obeys every manifest rule the host validates at boot", () => {
    expect(studioManifest.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(studioManifest.routePrefix).toMatch(/^\/api\/apps\/[a-z0-9-]+$/);
    expect(studioManifest.label.length).toBeGreaterThan(0);
    expect(studioManifest.icon.length).toBeGreaterThan(0);
    expect(studioManifest.webModuleId).toBe(studioManifest.id);
    expect(["Overview", "Contract pipeline", "Ops & insight", "Admin", "System apps"]).toContain(studioManifest.navSection);
    // Required and NON-EMPTY: a schema-valid manifest can never produce zero
    // derived RBAC coverage.
    expect(studioManifest.visibleToRoles.length).toBeGreaterThan(0);
    for (const role of studioManifest.visibleToRoles) {
      expect(["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"]).toContain(role);
    }
  });

  it("declares exactly the one capability it uses — the array IS the consent screen", () => {
    expect(studioManifest.capabilities).toEqual(["write:inbox-proposal"]);
    // Studio never opens a contract folder: the workflow arrives in the body.
    expect(studioManifest.capabilities).not.toContain("read:contracts");
  });

  it("is database-free: initSchema does nothing and there is no schema beside it", () => {
    // Calling it with no database at all is the proof that it touches none.
    expect(() => studioManifest.initSchema({})).not.toThrow();
    expect(studioManifest.initSchema({})).toBeUndefined();
    expect(existsSync(join(PACKAGE_SRC, "server/subapps/studio/schema.ts"))).toBe(false);
  });
});
