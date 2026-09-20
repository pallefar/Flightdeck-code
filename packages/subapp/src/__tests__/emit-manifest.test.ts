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
  EXCLUDED_FROM_VENDORING,
  HOST_STANDINS,
  REGISTRY_EDIT,
  STUDIO_MIN_HOST_VERSION,
  STUDIO_ROUTE_PREFIX,
  STUDIO_SUBAPP_ID,
  VENDORED_PACKAGES,
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
  it("names five files, and every one of them is on disk", () => {
    expect(EMIT_MANIFEST).toHaveLength(5);
    for (const file of EMIT_MANIFEST) {
      expect(existsSync(join(PACKAGE_SRC, file.source)), `missing: ${file.source}`).toBe(true);
    }
  });

  it("accounts for every file under studio/, so a new one cannot silently not ship", () => {
    const onDisk = [...walk(join(PACKAGE_SRC, "server/subapps/studio")), ...walk(join(PACKAGE_SRC, "web/src/subapps/studio"))];
    expect(onDisk.sort()).toEqual([...EMIT_MANIFEST].map((f) => f.source).sort());
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
    const shipped = new Set([...EMIT_MANIFEST.map((f) => f.source), ...HOST_STANDINS, "emit.ts", "index.ts"]);
    const unaccounted = [...walk(join(PACKAGE_SRC, "server")), ...walk(join(PACKAGE_SRC, "web")), "emit.ts", "index.ts"].filter(
      (file) => !shipped.has(file),
    );
    expect(unaccounted).toEqual([]);
  });

  it("gives every file a distinct target inside the host's own directories", () => {
    const targets = EMIT_MANIFEST.map((f) => f.target);
    expect(new Set(targets).size).toBe(targets.length);
    for (const file of EMIT_MANIFEST) {
      const expected = file.role === "web-module" ? "flightdeck/web/src/subapps/studio/" : "flightdeck/server/subapps/studio/";
      expect(file.target.startsWith(expected), `${file.target} does not sit under ${expected}`).toBe(true);
      expect(file.target.endsWith(file.source.replace(/^web\/src\/|^server\//, ""))).toBe(true);
    }
  });

  it("keeps the CLI half of the engine packages out of what travels with Studio", () => {
    expect(VENDORED_PACKAGES).toEqual(["@spec", "@codegen/pure", "@conformance/gate"]);
    // `@codegen/index` re-exports `apply.ts`; `@conformance/index` re-exports
    // `ship.ts` and `verify/`. All of them open files.
    expect(EXCLUDED_FROM_VENDORING).toContain("@codegen/index");
    expect(EXCLUDED_FROM_VENDORING).toContain("@codegen/apply");
    expect(EXCLUDED_FROM_VENDORING).toContain("@conformance/ship");
    for (const excluded of EXCLUDED_FROM_VENDORING) {
      expect(VENDORED_PACKAGES).not.toContain(excluded);
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
