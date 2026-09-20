/** Where a specifier points, which is the whole basis of the sibling and
 * capability rules. */
import { describe, expect, it } from "vitest";
import { classifyImport, joinPath, normalizePath, subAppIdOf, type ResolveScope } from "./resolve";
import type { ImportRef } from "./scan";

const scope: ResolveScope = {
  id: "wc-clock",
  webModuleId: "wc-clock",
  files: new Set([
    "server/subapps/wc-clock/manifest.ts",
    "server/subapps/wc-clock/guard.ts",
    "server/subapps/wc-clock/routes/index.ts",
    "server/subapps/wc-clock/routes/entries.ts",
    "web/src/subapps/wc-clock/index.tsx",
  ]),
};

const ref = (specifier: string): ImportRef => ({ specifier, offset: 0, typeOnly: false, form: "static" });
const classify = (from: string, specifier: string) => classifyImport(from, ref(specifier), scope);

const ROUTES = "server/subapps/wc-clock/routes/entries.ts";
const GUARD = "server/subapps/wc-clock/guard.ts";
const WEB = "web/src/subapps/wc-clock/index.tsx";

describe("path arithmetic", () => {
  it("collapses .. and refuses to climb above the repo", () => {
    expect(joinPath("server/subapps/x/routes", "../guard.js")).toBe("server/subapps/x/guard.js");
    expect(joinPath("server/subapps/x", "../../../../etc/passwd")).toBeNull();
    expect(normalizePath("./server//subapps/x/manifest.ts")).toBe("server/subapps/x/manifest.ts");
  });

  it("knows which sub-app owns a path, and that a leaf owns none", () => {
    expect(subAppIdOf("server/subapps/docusign/guard.ts")).toBe("docusign");
    expect(subAppIdOf("server/subapps/types.ts")).toBeNull();
    expect(subAppIdOf("server/db.ts")).toBeNull();
  });
});

describe("classifyImport", () => {
  it("resolves the sub-app's own files, through the .js -> .ts substitution", () => {
    expect(classify(ROUTES, "../guard.js")).toEqual({ kind: "internal", path: GUARD });
    expect(classify("server/subapps/wc-clock/manifest.ts", "./routes/index.js")).toEqual({
      kind: "internal",
      path: "server/subapps/wc-clock/routes/index.ts",
    });
  });

  it("resolves a directory specifier to its index", () => {
    expect(classify("server/subapps/wc-clock/manifest.ts", "./routes")).toEqual({
      kind: "internal",
      path: "server/subapps/wc-clock/routes/index.ts",
    });
  });

  it("reports an internal import with no file behind it", () => {
    expect(classify(ROUTES, "./timesheets.js")).toEqual({
      kind: "missing-internal",
      path: "server/subapps/wc-clock/routes/timesheets.js",
    });
  });

  it("catches a sibling however it is spelled", () => {
    for (const specifier of ["../../docusign/guard.js", "./../../docusign/guard.js", "../../../subapps/docusign/guard.js"]) {
      expect(classify(ROUTES, specifier)).toMatchObject({ kind: "sibling", siblingId: "docusign" });
    }
  });

  it("names the registry and installRoutes specifically", () => {
    expect(classify(GUARD, "../registry.js")).toEqual({ kind: "registry", path: "server/subapps/registry" });
    expect(classify(GUARD, "../installRoutes.js")).toEqual({ kind: "registry", path: "server/subapps/installRoutes" });
  });

  it("accepts the leaf modules a sub-app is allowed to reach", () => {
    expect(classify(GUARD, "../killSwitch.js")).toEqual({ kind: "host-leaf", path: "server/subapps/killSwitch" });
    expect(classify(GUARD, "../../lib/flightdeckAudit.js")).toEqual({ kind: "host-leaf", path: "server/lib/flightdeckAudit" });
    expect(classify(WEB, "../registry")).toEqual({ kind: "host-leaf", path: "web/src/subapps/registry" });
  });

  it("reports any other host module, whether or not anyone thought of it", () => {
    expect(classify(ROUTES, "../../../contracts/reader.js")).toEqual({ kind: "host-other", path: "server/contracts/reader.js" });
    expect(classify(ROUTES, "../../../inbox/proposals.js")).toEqual({ kind: "host-other", path: "server/inbox/proposals.js" });
  });

  it("reports a reach across the server/web line, even within this sub-app", () => {
    expect(classify(ROUTES, "../../../../web/src/subapps/wc-clock/index.js")).toMatchObject({ kind: "cross-tier" });
    expect(classify(WEB, "../../../../server/subapps/wc-clock/guard.js")).toMatchObject({ kind: "cross-tier" });
  });

  it("treats a bare specifier as a package", () => {
    expect(classify(ROUTES, "zod")).toEqual({ kind: "package", name: "zod" });
    expect(classify(ROUTES, "node:fs")).toEqual({ kind: "package", name: "node:fs" });
    expect(classify(ROUTES, "@scope/thing")).toEqual({ kind: "package", name: "@scope/thing" });
  });

  it("reports a specifier that resolves to nothing at all", () => {
    expect(classify(ROUTES, "../../../../../../etc/passwd")).toEqual({ kind: "unresolvable", raw: "../../../../../../etc/passwd" });
  });
});
