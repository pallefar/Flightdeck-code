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
import { CONNECTOR_KIND_IDS, assertManifestWouldBoot, subAppListingSchema, subAppManifestSchema } from "../manifest-rules";
import { LISTING_CATEGORIES } from "../spec-contract";
import { NON_DATA_MEMBERS, readEmittedManifest } from "../testing/readEmittedManifest";
import { HOST_ROOT, readInterfaceMembers, readStringArray, readZodObjectKeys } from "../../../guardrails/src/host-source";

// ⚠ DERIVED, NOT HARDCODED. This was the literal Linux path, so on any
// machine whose checkout lives elsewhere the file was simply absent and
// this whole file skipped — silently, and on a MAC that is every run.
// `HOST_ROOT` is the one place that reads FLIGHTDECK_HOST_ROOT.
const CONTRACT_SUBAPPS = `${HOST_ROOT}/flightdeck/server/subapps`;
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
      // apps-49: this copy is not `.strict()`, so a field it does not model
      // is STRIPPED, not refused — a real manifest's `listing` would pass
      // here while this copy never checked it. What it validates it keeps.
      if ("listing" in data) expect(assertManifestWouldBoot(data).listing).toEqual(data.listing);
    });
  }

  /** ⭐ apps-49: THE FIELD LIST ITSELF IS DRIFT-TESTED. The real-manifest
   * cases above cannot see a field the host added and this copy lacks —
   * the copy is not `.strict()`, so Zod strips the unknown key and the
   * manifest still "passes". That is how the host's `listing` (apps-01)
   * went unmodelled here. So: the host's `subAppManifestSchema` keys, read
   * off `types.ts`, must equal this copy's keys, except `widgets` — the one
   * optional additive field this copy deliberately accepts unmodelled. */
  it("validates every field the host's subAppManifestSchema validates (widgets excepted)", () => {
    const types = fs.readFileSync(path.join(CONTRACT_SUBAPPS, "types.ts"), "utf8");
    const hostKeys = readZodObjectKeys(types, "subAppManifestSchema").filter((k) => k !== "widgets");
    expect(Object.keys(subAppManifestSchema.shape).sort()).toEqual([...hostKeys].sort());
  });

  it("mirrors the host's listing facts block key for key, and its category list", () => {
    const types = fs.readFileSync(path.join(CONTRACT_SUBAPPS, "types.ts"), "utf8");
    expect(Object.keys(subAppListingSchema.shape).sort()).toEqual(readZodObjectKeys(types, "subAppListingSchema").sort());
    expect([...LISTING_CATEGORIES]).toEqual(readStringArray(types, "LISTING_CATEGORIES"));
  });

  /** sdk-21: the `integrations[].kind` enum is the host's shipped connector
   * kinds, DERIVED there from `KINDS` in services/connectors/kinds.ts. The
   * copy here is a transcribed constant, so it is read back off that file. */
  it("transcribes the host's connector kind ids for integrations[].kind", () => {
    const kinds = fs.readFileSync(path.join(HOST_ROOT, "flightdeck", "server", "services", "connectors", "kinds.ts"), "utf8");
    const hostKinds = Array.from(kinds.matchAll(/^\s{4}kind: "([a-z0-9-]+)",$/gm), (m) => m[1]);
    expect(hostKinds.length).toBeGreaterThan(0);
    expect([...CONNECTOR_KIND_IDS]).toEqual(hostKinds);
  });

  /** ⭐ THE READER'S SKIP LIST IS A TRANSCRIBED CONSTANT, SO IT GETS A DRIFT
   * TEST (HANDOVER §5.4). The reader skips exactly the members the host's
   * `SubAppManifest` interface declares on top of `SubAppManifestData` —
   * the ones `subAppManifestSchema` never sees. Read off the host's
   * `types.ts`, in both directions: a member the host adds and the reader
   * does not skip turns a real manifest red (that is how OS-04's
   * `contributions` surfaced); a member the reader skips and the host no
   * longer declares is a hole a computed field could hide in. */
  it("skips exactly the members the host's SubAppManifest adds beyond the Zod data", () => {
    const types = fs.readFileSync(path.join(CONTRACT_SUBAPPS, "types.ts"), "utf8");
    const hostMembers = readInterfaceMembers(types, "SubAppManifest");
    expect(hostMembers.length).toBeGreaterThan(0);
    expect([...NON_DATA_MEMBERS].sort()).toEqual([...hostMembers].sort());
    // And none of them is a field the Zod copy validates — skipping a
    // validated field would be exactly the weakening this list must not be.
    const validated = Object.keys(subAppManifestSchema.shape);
    expect(NON_DATA_MEMBERS.filter((m) => validated.includes(m))).toEqual([]);
  });
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

  it('accepts the generated marker, generatedBy: "flightdeck-studio", and keeps it (D-036)', () => {
    expect(assertManifestWouldBoot({ ...base, generatedBy: "flightdeck-studio" }).generatedBy).toBe("flightdeck-studio");
  });

  it("refuses any other generatedBy value — a literal, as the host declares it", () => {
    expect(() => assertManifestWouldBoot({ ...base, generatedBy: "someone-else" })).toThrow(/generatedBy/);
  });

  it("reports every violation at once, not just the first", () => {
    try {
      assertManifestWouldBoot({ ...base, id: "NOPE", visibleToRoles: [], icon: "" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { issues: string[] }).issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("maxHostVersion (sdk-60): an exclusive upper bound, strict semver, above minHostVersion", () => {
    expect(assertManifestWouldBoot({ ...base, maxHostVersion: "6.0.0" }, "5.0.0").maxHostVersion).toBe("6.0.0");
    expect(() => assertManifestWouldBoot({ ...base, minHostVersion: "4.0.0", maxHostVersion: "5.0.0" }, "5.0.0")).toThrow(/requires host < 5\.0\.0/);
    expect(() => assertManifestWouldBoot({ ...base, maxHostVersion: "5.0.0" }, "5.0.0")).toThrow(/must be above minHostVersion/);
    expect(() => assertManifestWouldBoot({ ...base, maxHostVersion: "6" })).toThrow(/maxHostVersion/);
  });

  it("integrations (sdk-21): validates the declared shape and refuses an unknown key or kind", () => {
    const integration = {
      key: "notify",
      kind: "teams",
      labelKey: "demo-app.integrations.notify",
      egressHosts: ["example.com"],
      secretRefs: [{ name: "hook", role: "webhook-url" }],
      operations: [{ key: "post", event: "subapp.demo-app.posted", payloadSchema: "schemas/post.json", maxBytes: 1024 }],
    };
    expect(assertManifestWouldBoot({ ...base, integrations: [integration] }).integrations).toEqual([integration]);
    expect(() => assertManifestWouldBoot({ ...base, integrations: [{ ...integration, url: "https://x" }] })).toThrow(/integrations/);
    expect(() => assertManifestWouldBoot({ ...base, integrations: [{ ...integration, kind: "smtp" }] })).toThrow(/integrations/);
  });

  it("tolerates the optional additive fields the host allows (widgets)", () => {
    expect(() => assertManifestWouldBoot({ ...base, widgets: [{ anything: true }] })).not.toThrow();
    expect(subAppManifestSchema.safeParse({ ...base, widgets: [] }).success).toBe(true);
  });
});
