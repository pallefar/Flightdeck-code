/** Live-source core metadata conformance, not generated-source admission or
 * full host callback/runtime validation. AST schema drift checks are necessary:
 * a handful of valid manifests cannot demonstrate equivalence of two schemas.
 * Ordinary local runs skip without a checkout; an explicit release host must exist. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertManifestWouldBoot, subAppManifestSchema } from "../manifest-rules";
import { readHostManifestContract, readHostManifestMetadata } from "../testing/readHostManifestMetadata";
import { HOST_ROOT } from "../../../guardrails/src/host-source";

// ⚠ DERIVED, NOT HARDCODED. This was the literal Linux path, so on any
// machine whose checkout lives elsewhere the file was simply absent and
// this whole file skipped — silently, and on a MAC that is every run.
// `HOST_ROOT` is the one place that reads FLIGHTDECK_HOST_ROOT.
const CONTRACT_SUBAPPS = `${HOST_ROOT}/flightdeck/server/subapps`;
const REAL_MANIFESTS = ["shell-reference", "docusign", "maps", "advantage"];
const available = fs.existsSync(CONTRACT_SUBAPPS);
if (process.env.FLIGHTDECK_HOST_ROOT && !available) throw new Error(`Missing explicit host source: ${CONTRACT_SUBAPPS}`);

function liveContract() {
  return readHostManifestContract(
    fs.readFileSync(path.join(CONTRACT_SUBAPPS, "types.ts"), "utf8"),
    fs.readFileSync(new URL("../manifest-rules.ts", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../spec-contract.ts", import.meta.url), "utf8"),
  );
}

describe.skipIf(!available)("the local core metadata schema agrees with live host declarations", () => {
  it("pins schema fields, required/optional semantics and core rules against authoritative AST", () => {
    expect([...liveContract().coreFields].sort()).toEqual(Object.keys(subAppManifestSchema.shape).sort());
  });
  for (const id of REAL_MANIFESTS) {
    it(`accepts the hand-written ${id} core metadata, read from its source`, () => {
      const source = fs.readFileSync(path.join(CONTRACT_SUBAPPS, id, "manifest.ts"), "utf8");
      const contract = liveContract();
      const { metadata, omittedMembers } = readHostManifestMetadata(source, contract);
      expect(metadata.id).toBe(id);
      expect(() => assertManifestWouldBoot(metadata)).not.toThrow();
      expect(omittedMembers.length).toBeGreaterThan(0);
      for (const member of omittedMembers) {
        expect(contract.coreFields.has(member.name)).toBe(false);
        expect(contract.omittedFields.get(member.name)).toBe(member.reason);
        expect(source.slice(member.start, member.end)).toContain(member.name);
      }
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
