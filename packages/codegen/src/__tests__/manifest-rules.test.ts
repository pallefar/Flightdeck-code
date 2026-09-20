/** The local copy of `subAppManifestSchema`, checked against REALITY.
 *
 * ⭐ This is the test that makes the copy trustworthy. Codegen cannot import
 * the host's schema, so it carries its own; a carried copy is worthless
 * unless something forces it to keep agreeing. What forces it here is the
 * four hand-written manifests in `pallefar/project-contract`: they are read
 * off disk AS SOURCE, parsed by the same reader the generated manifest goes
 * through, and validated by this copy. If the host widens or narrows a
 * rule, a real manifest stops matching and this goes red.
 *
 * Skipped, loudly, when the checkout is not present — a test that silently
 * passes because it found no files is worse than one that says why. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertManifestWouldBoot, subAppManifestSchema } from "../manifest-rules";
import { readEmittedManifest } from "../testing/readEmittedManifest";

const CONTRACT_SUBAPPS = "/home/user/project-contract/flightdeck/server/subapps";
const REAL_MANIFESTS = ["shell-reference", "docusign", "maps", "advantage"];
const available = fs.existsSync(CONTRACT_SUBAPPS);

describe.skipIf(!available)("the local schema copy agrees with the host's real manifests", () => {
  for (const id of REAL_MANIFESTS) {
    it(`accepts the hand-written ${id} manifest, read from its source`, () => {
      const source = fs.readFileSync(path.join(CONTRACT_SUBAPPS, id, "manifest.ts"), "utf8");
      const data = readEmittedManifest(source);
      expect(data.id).toBe(id);
      // The real thing, boot rules and all — not just the Zod shape.
      expect(() => assertManifestWouldBoot(data)).not.toThrow();
    });
  }
});

describe("the boot rules the host applies", () => {
  const base = {
    id: "demo-app",
    label: "Demo",
    version: "0.1.0",
    minHostVersion: "5.0.0",
    icon: "🧪",
    navSection: "Ops & insight",
    routePrefix: "/api/apps/demo-app",
    webModuleId: "demo-app",
    capabilities: [],
    visibleToRoles: ["admin"],
  };

  it("accepts a well-formed manifest", () => {
    expect(() => assertManifestWouldBoot(base)).not.toThrow();
  });

  it("refuses an empty visibleToRoles — the APP-03 zero-RBAC-coverage gap", () => {
    expect(() => assertManifestWouldBoot({ ...base, visibleToRoles: [] })).toThrow(/visibleToRoles/);
  });

  it("refuses a routePrefix with a sub-path", () => {
    expect(() => assertManifestWouldBoot({ ...base, routePrefix: "/api/apps/demo-app/v2" })).toThrow(/routePrefix/);
  });

  it("refuses a nav section the shell does not know", () => {
    expect(() => assertManifestWouldBoot({ ...base, navSection: "Mini apps" })).toThrow(/navSection/);
  });

  it("refuses an id the host's SUBAPP_ID_RE rejects", () => {
    expect(() => assertManifestWouldBoot({ ...base, id: "Demo_App" })).toThrow(/id/);
  });

  it("refuses a manifest asking for a newer host than this build", () => {
    expect(() => assertManifestWouldBoot({ ...base, minHostVersion: "6.0.0" })).toThrow(/requires host >= 6\.0\.0/);
  });

  it("compares versions numerically, not lexically", () => {
    // "5.9.0" vs "5.10.0" is the case a string compare gets backwards.
    expect(() => assertManifestWouldBoot({ ...base, minHostVersion: "5.9.0" }, "5.10.0")).not.toThrow();
    expect(() => assertManifestWouldBoot({ ...base, minHostVersion: "5.10.0" }, "5.9.0")).toThrow();
  });

  it("reports every violation at once, not just the first", () => {
    try {
      assertManifestWouldBoot({ ...base, id: "NOPE", visibleToRoles: [], icon: "" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { issues: string[] }).issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("tolerates the optional additive fields the host allows (widgets)", () => {
    expect(() => assertManifestWouldBoot({ ...base, widgets: [{ anything: true }] })).not.toThrow();
    expect(subAppManifestSchema.safeParse({ ...base, widgets: [] }).success).toBe(true);
  });
});
