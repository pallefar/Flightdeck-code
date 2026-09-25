/** The manifest check's member lists are TRANSCRIBED CONSTANTS, so they get a
 * drift test (HANDOVER §5.4) — read off the host's `server/subapps/types.ts`.
 *
 * ⭐ WHY THIS EXISTS. OS-04 (host 42b0f308) added `contributions` to the
 * host's `SubAppManifest`. Codegen's test-only manifest reader had a drift
 * test and went red; this gate had none, went on calling every unknown member
 * "additive and ignored", and passed a generated manifest that contributed
 * signing state and would stop the host booting. So: every member the host's
 * manifest carries must be one the gate VALIDATES (a Zod data field), REQUIRES
 * (a function member the host calls), or REFUSES outright. A member the host
 * gains that is in none of the three fails here, before it can pass the gate
 * unexamined. And the other direction: a list entry the host no longer
 * declares is a rule about nothing.
 *
 * The second block needs no host: the compile-time stub the typecheck stage
 * compiles against (`verify/host-surface.ts`) must agree with the gate — the
 * same members, with every refused one typed `never`. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOST_ROOT, readInterfaceMembers, readStringArray, readZodObjectKeys } from "../../guardrails/src/host-source";
import { LISTING_CATEGORIES } from "./derive";
import { validateManifestData } from "./manifest-schema";
import { DATA_FIELDS, FUNCTION_MEMBERS, REFUSED_MEMBERS } from "./checks/manifest";
import { FLIGHTDECK_HOST_SURFACE } from "./verify/host-surface";

const HOST_TYPES = path.join(HOST_ROOT, "flightdeck", "server", "subapps", "types.ts");
const available = fs.existsSync(HOST_TYPES);

const sorted = (list: readonly string[]) => [...list].sort();

describe.skipIf(!available)("the manifest check against the host's SubAppManifest", () => {
  const source = available ? fs.readFileSync(HOST_TYPES, "utf8") : "";

  it("⭐ judges every member the host's manifest carries — validates, requires or refuses it", () => {
    const hostData = readZodObjectKeys(source, "subAppManifestSchema");
    const hostExtra = readInterfaceMembers(source, "SubAppManifest");
    const judged = new Set([...DATA_FIELDS, ...FUNCTION_MEMBERS, ...REFUSED_MEMBERS]);
    const unjudged = [...hostData, ...hostExtra].filter((member) => !judged.has(member));
    expect(
      unjudged,
      `the host's SubAppManifest gained member(s) the conformance gate neither validates nor refuses: ${unjudged.join(", ")} — ` +
        "decide which, in packages/conformance/src/checks/manifest.ts, before a generated manifest can carry it past the gate",
    ).toEqual([]);
  });

  it("validates exactly the host's Zod data fields", () => {
    expect(sorted(DATA_FIELDS)).toEqual(sorted(readZodObjectKeys(source, "subAppManifestSchema")));
  });

  it("requires or refuses exactly the members the host's interface adds beyond the Zod data", () => {
    expect(sorted([...FUNCTION_MEMBERS, ...REFUSED_MEMBERS])).toEqual(sorted(readInterfaceMembers(source, "SubAppManifest")));
  });

  it("transcribes the host's listing facts block (apps-01) key for key, and its category list", () => {
    expect(sorted(readZodObjectKeys(source, "subAppListingSchema"))).toEqual(
      sorted(["availability", "discoverable", "category", "requirements", "publisher"]),
    );
    expect([...LISTING_CATEGORIES]).toEqual(readStringArray(source, "LISTING_CATEGORIES"));
  });

  it("the typecheck stub's listing block has the host's OUTPUT optionality — only `.optional()` keys are optional (a `.default()` key is required in z.infer)", () => {
    const block = /subAppListingSchema = z\s*\.object\(\{([\s\S]*?)\n\s*\}\)/.exec(source)?.[1] ?? "";
    const stub = FLIGHTDECK_HOST_SURFACE.types["server/subapps/types"] ?? "";
    const stubListing = /readonly listing\?: \{([\s\S]*?)\n\s*\};/.exec(stub)?.[1] ?? "";
    const keys = readZodObjectKeys(source, "subAppListingSchema");
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const hostOptional = new RegExp(`\\b${key}:[^\\n]*\\.optional\\(\\)`).test(block);
      const stubOptional = new RegExp(`readonly\\s+${key}\\?\\s*:`).test(stubListing);
      expect(stubOptional, `listing.${key}: host optional=${hostOptional}, stub optional=${stubOptional}`).toBe(hostOptional);
    }
  });

  it("refuses contributions — the OS-04 member that stops the host booting when two sub-apps claim ticketSigning", () => {
    expect(readInterfaceMembers(source, "SubAppManifest")).toContain("contributions");
    expect(REFUSED_MEMBERS).toContain("contributions");
  });
});

describe("the typecheck stage's stub agrees with the gate", () => {
  const stub = FLIGHTDECK_HOST_SURFACE.types["server/subapps/types"] ?? "";

  it("declares every member the gate validates, requires or refuses, and nothing else", () => {
    expect(sorted(readInterfaceMembers(stub, "SubAppManifest"))).toEqual(
      sorted([...DATA_FIELDS, ...FUNCTION_MEMBERS, ...REFUSED_MEMBERS]),
    );
  });

  it("types listing.discoverable REQUIRED, as the host's Zod output type does (`.default(false)`), so a candidate that omits it fails here as it would when mounted", () => {
    expect(stub).toMatch(/readonly\s+discoverable\s*:\s*boolean\s*;/);
    expect(stub).not.toMatch(/readonly\s+discoverable\?\s*:/);
  });

  it("types every refused member `never`, so the compiler refuses what the gate refuses", () => {
    for (const member of REFUSED_MEMBERS) {
      expect(stub).toMatch(new RegExp(`readonly\\s+${member}\\?\\s*:\\s*never\\s*;`));
    }
  });
});

describe("the gate validates a manifest's listing facts (apps-49) instead of stripping them", () => {
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
  const listing = { availability: "available", discoverable: false, category: "signing", publisher: { name: "Flightdeck" } };

  it("passes a facts-only listing", () => {
    expect(validateManifestData({ ...base, listing })).toEqual([]);
  });

  it("refuses a malformed maxHostVersion and an integration carrying an unknown key (sdk-60, sdk-21)", () => {
    expect(validateManifestData({ ...base, maxHostVersion: "6" }).map((i) => i.field)).toContain("maxHostVersion");
    expect(validateManifestData({ ...base, maxHostVersion: "6.0.0" })).toEqual([]);
    expect(validateManifestData({ ...base, integrations: [{ key: "x", url: "https://x" }] }).map((i) => i.field)).toContain("integrations");
  });

  it("refuses copy, a URL or an unknown category inside listing — the host's block is .strict()", () => {
    for (const bad of [{ ...listing, tagline: "x" }, { ...listing, supportUrl: "https://x" }, { ...listing, category: "crm" }]) {
      expect(validateManifestData({ ...base, listing: bad }).map((i) => i.field)).toContain("listing");
    }
  });
});
