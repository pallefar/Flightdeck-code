/** The manifest reader, on the shapes the host actually writes.
 *
 * The reader's job is narrow and it has to stay narrow: read the DATA
 * fields `subAppManifestSchema` validates, and throw rather than guess
 * when one of them is not a literal. The host's `SubAppManifest` interface
 * also carries members Zod never sees — `initSchema`, `registerRoutes`
 * and, since OS-04 (host 42b0f308), an optional `contributions` bundle —
 * and those are skipped because the host's own boot check skips them, not
 * because they are hard to read.
 *
 * Every case below pairs a thing the reader now accepts with the thing it
 * must still refuse, so the fix cannot be "accept more". */
import { describe, expect, it } from "vitest";
import { NON_DATA_MEMBERS, ManifestReadError, readEmittedManifest } from "../testing/readEmittedManifest";

const HEAD = `import type { SubAppManifest } from "../types.js";
export const demoManifest: SubAppManifest = {
  id: "demo-app",
  label: "Demo",
  version: "0.1.0",
  minHostVersion: "5.0.0",
  icon: "🧪",
  navSection: "Ops & insight",
  routePrefix: "/api/apps/demo-app",
  webModuleId: "demo-app",
  capabilities: ["read:contracts"],
  visibleToRoles: ["admin"],`;

const manifest = (tail: string) => `${HEAD}\n${tail}\n};\n`;

const FUNCTIONS = `  initSchema: (db) => applyDemoSchema(db),
  registerRoutes: (app, ctx) => registerDemoRoutes(app, ctx),`;

describe("the host's non-data members", () => {
  it("are exactly the four SubAppManifest adds on top of the Zod data", () => {
    // Pinned against the host's interface by manifest-rules.test.ts; pinned
    // here so a local edit to the list is a visible, reviewed change.
    // `firstObject`: the host's optional onboarding probe
    // (x-subapp-first-object-probe; maps declares it).
    expect([...NON_DATA_MEMBERS]).toEqual(["initSchema", "registerRoutes", "contributions", "firstObject"]);
  });
});

describe("OS-04: a manifest that declares contributions", () => {
  it("⭐ reads the data fields and leaves an identifier-valued contributions alone", () => {
    // The shape of the host's docusign manifest today.
    const data = readEmittedManifest(manifest(`${FUNCTIONS}\n  contributions: demoContributions,`));
    expect(data["id"]).toBe("demo-app");
    expect(data["visibleToRoles"]).toEqual(["admin"]);
    expect(data).not.toHaveProperty("contributions");
    expect(data).not.toHaveProperty("initSchema");
  });

  it("skips a multi-line contributions value whole, not just its first line", () => {
    const inline = `${FUNCTIONS}
  contributions: {
    stateFlags: () => ({ demo: { enabled: true } }),
    fixedConnectors: [{ id: "demo", row: (rt, flags) => buildRow(rt, flags) }],
  },`;
    const data = readEmittedManifest(manifest(inline));
    expect(data["label"]).toBe("Demo");
    expect(Object.keys(data)).not.toContain("stateFlags");
    expect(Object.keys(data)).not.toContain("fixedConnectors");
  });

  it("does not depend on member order — contributions before the functions", () => {
    const data = readEmittedManifest(manifest(`  contributions: demoContributions,\n${FUNCTIONS}`));
    expect(data["webModuleId"]).toBe("demo-app");
  });

  it("skips a multi-line function member whole, too", () => {
    const multi = `  initSchema: (db) => {
    applyDemoSchema(db);
  },
  registerRoutes: (app, ctx) => registerDemoRoutes(app, ctx),`;
    expect(readEmittedManifest(manifest(multi))["id"]).toBe("demo-app");
  });

  it("reads a string value containing a colon, a comma or a brace", () => {
    const tricky = readEmittedManifest(
      manifest(`${FUNCTIONS}\n  settingsPanel: { tier: "workspace-admin", webComponentId: "demo-app", label: "Demo settings: all, {x}" },`),
    );
    expect(tricky["settingsPanel"]).toEqual({ tier: "workspace-admin", webComponentId: "demo-app", label: "Demo settings: all, {x}" });
  });
});

describe("what it must still refuse", () => {
  it("⛔ a computed DATA field — the reason the reader throws at all", () => {
    const computed = manifest(`${FUNCTIONS}\n  contributions: demoContributions,`).replace(
      'navSection: "Ops & insight"',
      "navSection: SECTIONS.ops",
    );
    expect(() => readEmittedManifest(computed)).toThrow(ManifestReadError);
  });

  it("⛔ a computed id, the way a hand-written manifest might spell it", () => {
    const computed = manifest(FUNCTIONS).replace('id: "demo-app"', "id: DEMO_SUBAPP_ID");
    expect(() => readEmittedManifest(computed)).toThrow(ManifestReadError);
  });

  it("⛔ a computed widgets array — widgets IS validated by the host's Zod", () => {
    expect(() => readEmittedManifest(manifest(`${FUNCTIONS}\n  widgets: demoWidgets,`))).toThrow(ManifestReadError);
  });

  it("⛔ an unknown computed member — only the host's three are skipped", () => {
    expect(() => readEmittedManifest(manifest(`${FUNCTIONS}\n  hooks: demoHooks,`))).toThrow(ManifestReadError);
  });

  it("⛔ a spread, which could carry any data field at all", () => {
    expect(() => readEmittedManifest(manifest(`${FUNCTIONS}\n  ...demoExtras,`))).toThrow(ManifestReadError);
  });

  it("⛔ a shorthand data member — `id,` is a computed id by another spelling", () => {
    const shorthand = manifest(FUNCTIONS).replace('id: "demo-app",', "id,");
    expect(() => readEmittedManifest(shorthand)).toThrow(ManifestReadError);
  });
});
