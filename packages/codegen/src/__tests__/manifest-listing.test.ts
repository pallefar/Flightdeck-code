/** apps-49: the manifest `listing` FACTS block, end to end through codegen.
 *
 * The host added `listing` under D-26's additive rule (apps-01, D-037) as a
 * `.strict()` block of FACTS — availability, discoverable, category,
 * requirements, publisher. Copy (taglines, descriptions, data-handling
 * statements), URLs, media and release state are human-owned and approved
 * per release, so codegen must never emit them. These tests read the
 * EMITTED FILE, the way `loadValidatedManifests` will at boot. */
import { describe, expect, it } from "vitest";
import { generateSubApp } from "../generate";
import { assertManifestWouldBoot } from "../manifest-rules";
import { SpecRejectedError } from "../plan";
import { readEmittedManifest } from "../testing/readEmittedManifest";
import { minimalSpec } from "../fixtures/specs";

const manifestOf = (input: unknown) => {
  const file = generateSubApp(input).files.find((f) => f.kind === "manifest");
  if (file === undefined) throw new Error("no manifest emitted");
  return file.contents;
};

const facts = {
  availability: "available",
  category: "documents",
  requirements: ["docusign"],
  publisher: { name: "Flightdeck" },
} as const;

describe("the listing facts block (apps-49)", () => {
  it("emits no listing block when the spec gives no listing facts", () => {
    const source = manifestOf(minimalSpec);
    expect(source).not.toContain("listing");
    expect(readEmittedManifest(source)).not.toHaveProperty("listing");
  });

  it("emits exactly the spec's facts, with discoverable defaulting to false (fail closed)", () => {
    const data = readEmittedManifest(manifestOf({ ...minimalSpec, listing: facts }));
    expect(data.listing).toEqual({
      availability: "available",
      discoverable: false,
      category: "documents",
      requirements: ["docusign"],
      publisher: { name: "Flightdeck" },
    });
    // And the file, as written, would boot — listing included, not stripped.
    expect(assertManifestWouldBoot(data).listing).toEqual(data.listing);
  });

  it("carries an explicit discoverable: true through unchanged, and omits absent requirements", () => {
    const { requirements: _omit, ...noReqs } = facts;
    const data = readEmittedManifest(
      manifestOf({ ...minimalSpec, listing: { ...noReqs, availability: "coming-soon", discoverable: true } }),
    );
    expect(data.listing).toEqual({
      availability: "coming-soon",
      discoverable: true,
      category: "documents",
      publisher: { name: "Flightdeck" },
    });
  });

  it.each([
    ["copy", { tagline: "Sign faster" }],
    ["copy", { description: "An app." }],
    ["copy", { dataHandling: "We store nothing." }],
    ["a URL", { supportUrl: "https://example.com/support" }],
    ["a URL", { privacyUrl: "https://example.com/privacy" }],
    ["media", { media: ["shot.png"] }],
    ["release state", { release: { status: "approved" } }],
    ["a publisher URL", { publisher: { name: "Flightdeck", url: "https://example.com" } }],
  ])("refuses a listing carrying %s at the spec door — never emitted", (_what, extra) => {
    expect(() => manifestOf({ ...minimalSpec, listing: { ...facts, ...extra } })).toThrow(SpecRejectedError);
  });

  it("does not map the spec's summary into the listing — summary stays the in-app page subtitle", () => {
    const source = manifestOf({ ...minimalSpec, listing: facts });
    const data = readEmittedManifest(source);
    expect(Object.keys(data.listing as object).sort()).toEqual(
      ["availability", "category", "discoverable", "publisher", "requirements"],
    );
    expect(source).not.toContain(minimalSpec.summary);
  });

  it("refuses a category, requirement or availability the host does not know", () => {
    expect(() => manifestOf({ ...minimalSpec, listing: { ...facts, category: "crm" } })).toThrow(SpecRejectedError);
    expect(() => manifestOf({ ...minimalSpec, listing: { ...facts, requirements: ["Not_An_Id"] } })).toThrow(SpecRejectedError);
    expect(() =>
      manifestOf({ ...minimalSpec, listing: { ...facts, requirements: ["a", "b", "c", "d", "e", "f"] } }),
    ).toThrow(SpecRejectedError);
    expect(() => manifestOf({ ...minimalSpec, listing: { ...facts, availability: "released" } })).toThrow(SpecRejectedError);
  });
});

describe("the local schema copy's listing rules (mirroring the host's .strict() block)", () => {
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

  it("keeps a valid listing and defaults discoverable to false", () => {
    const listing = { availability: "available", category: "signing", publisher: { name: "Flightdeck" } };
    expect(assertManifestWouldBoot({ ...base, listing }).listing).toEqual({ ...listing, discoverable: false });
  });

  it("refuses an unknown key inside listing instead of stripping it (host: fail loud)", () => {
    expect(() =>
      assertManifestWouldBoot({
        ...base,
        listing: { availability: "available", category: "signing", publisher: { name: "F" }, tagline: "x" },
      }),
    ).toThrow(/listing/);
  });
});
