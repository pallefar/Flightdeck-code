/** Reading the manifest out of source, including the cases where it
 * refuses to. */
import { describe, expect, it } from "vitest";
import { parseLiteralText, readManifestSource } from "./manifest-read";
import { scanFile } from "./scan";

const read = (source: string) => readManifestSource(scanFile("server/subapps/x/manifest.ts", source));

const WHOLE = `/** A banner with a } brace and a "quote" in it. */
import type { SubAppManifest } from "../types.js";
import { applyXSchema } from "./schema.js";

export const xManifest: SubAppManifest = {
  // A comment naming navSection: "Admin" to mislead a naive reader.
  id: "x",
  label: "Ex",
  version: "0.1.0",
  minHostVersion: "5.0.0",
  icon: "🧭",
  navSection: "Ops & insight",
  routePrefix: "/api/apps/x",
  webModuleId: "x",
  capabilities: [],
  visibleToRoles: ["admin"],
  settingsPanel: { tier: "workspace-admin", webComponentId: "x", label: "Ex settings" },
  initSchema: (db) => applyXSchema(db),
  registerRoutes: (app, ctx) => registerXRoutes(app, ctx),
};
`;

describe("readManifestSource", () => {
  const result = read(WHOLE);
  const manifest = result.ok ? result.manifest : null;

  it("finds the declaration by its type annotation", () => {
    expect(manifest?.constName).toBe("xManifest");
  });

  it("reads every literal field, including a nested object", () => {
    expect(manifest?.data).toEqual({
      id: "x",
      label: "Ex",
      version: "0.1.0",
      minHostVersion: "5.0.0",
      icon: "🧭",
      navSection: "Ops & insight",
      routePrefix: "/api/apps/x",
      webModuleId: "x",
      capabilities: [],
      visibleToRoles: ["admin"],
      settingsPanel: { tier: "workspace-admin", webComponentId: "x", label: "Ex settings" },
    });
  });

  it("is not fooled by a comment that looks like a field", () => {
    expect(manifest?.data["navSection"]).toBe("Ops & insight");
  });

  it("records the function members without evaluating them", () => {
    expect(manifest?.memberAt("initSchema")?.valueText).toBe("(db) => applyXSchema(db)");
    expect(manifest?.memberAt("registerRoutes")?.literal).toBeNull();
  });

  it("gives every member an offset, so a finding can point at it", () => {
    const scan = scanFile("m.ts", WHOLE);
    const member = manifest?.memberAt("navSection");
    expect(scan.lineTextAt(member?.valueOffset ?? 0)).toContain("Ops & insight");
  });
});

describe("readManifestSource refuses rather than guesses", () => {
  it("when there is no manifest declaration", () => {
    const result = read(`export const notAManifest = 1;\n`);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toContain("SubAppManifest");
  });

  it("when the object never closes", () => {
    const result = read(`export const xManifest: SubAppManifest = {\n  id: "x",\n`);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toContain("never closed");
  });

  it("when a data field is computed, while still reading its neighbours", () => {
    const result = read(`export const xManifest: SubAppManifest = {\n  id: SUBAPP_ID,\n  label: "Ex",\n};\n`);
    expect(result.ok).toBe(true);
    const manifest = result.ok ? result.manifest : null;
    expect(manifest?.memberAt("id")?.literal).toBeNull();
    expect(manifest?.memberAt("id")?.valueText).toBe("SUBAPP_ID");
    expect(manifest?.data["label"]).toBe("Ex");
  });

  it("when a field is a template literal, which can interpolate", () => {
    const result = read("export const xManifest: SubAppManifest = {\n  label: `Ex ${suffix}`,\n};\n");
    const manifest = result.ok ? result.manifest : null;
    expect(manifest?.memberAt("label")?.literal).toBeNull();
  });

  it("finds a declaration that carries no type annotation", () => {
    const result = read(`export const xManifest = {\n  id: "x",\n};\n`);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.manifest.data["id"] : null).toBe("x");
  });
});

describe("parseLiteralText", () => {
  it("accepts JSON-compatible literals", () => {
    expect(parseLiteralText(`"a"`)).toEqual({ ok: true, value: "a" });
    expect(parseLiteralText(`'a'`)).toEqual({ ok: true, value: "a" });
    expect(parseLiteralText(`[ "a", "b" ]`)).toEqual({ ok: true, value: ["a", "b"] });
    expect(parseLiteralText(`{ a: 1, "b": true, c: null }`)).toEqual({ ok: true, value: { a: 1, b: true, c: null } });
    expect(parseLiteralText(`-2.5`)).toEqual({ ok: true, value: -2.5 });
  });

  it("refuses anything that has to be evaluated", () => {
    for (const text of [`SECTIONS.admin`, `fn()`, `"a" + "b"`, "`t`", `[...others]`, `{ ...spread }`, `undefined`]) {
      expect(parseLiteralText(text).ok).toBe(false);
    }
  });

  it("refuses trailing junk rather than reading the first half", () => {
    expect(parseLiteralText(`"a" as const`).ok).toBe(false);
  });
});
