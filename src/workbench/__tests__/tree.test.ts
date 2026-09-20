import { describe, expect, it } from "vitest";
import { buildTree, classifyTier, TIER_ORDER, tierRoot, visibleFilePaths } from "../tree";
import type { GeneratedFile } from "../types";
import { wcClockFiles } from "./fixtures";

const patch: GeneratedFile = {
  path: "server/subapps/registry.ts.patch",
  contents: "--- a\n+++ b\n",
  kind: "patch",
};

describe("classifyTier", () => {
  it("separates the three landing places and the host edit", () => {
    expect(classifyTier({ path: "server/subapps/x/manifest.ts", kind: "manifest" })).toBe("server");
    expect(classifyTier({ path: "web/src/subapps/x/index.tsx", kind: "web-module" })).toBe("web");
    expect(classifyTier({ path: "tests/subapps/x/a.test.ts", kind: "host-test" })).toBe("tests");
    // A patch is not a file to read — it is a change to a file the host
    // already owns. Filing it beside manifest.ts is how a sub-app ships
    // unmounted.
    expect(classifyTier(patch)).toBe("host-edit");
  });

  it("classifies a patch by kind even under a server path", () => {
    expect(classifyTier({ path: "server/subapps/registry.ts.patch", kind: "patch" })).toBe("host-edit");
  });
});

describe("tierRoot", () => {
  it("finds the shared directory prefix", () => {
    expect(tierRoot("server", ["server/subapps/x/manifest.ts", "server/subapps/x/routes/a.ts"])).toBe(
      "server/subapps/x",
    );
  });

  it("never elides the file name itself", () => {
    expect(tierRoot("server", ["server/subapps/x/manifest.ts"])).toBe("server/subapps/x");
  });

  it("elides nothing for host edits, which have no shared home", () => {
    expect(tierRoot("host-edit", ["server/subapps/registry.ts.patch"])).toBe("");
  });

  it("is empty when paths share no directory", () => {
    expect(tierRoot("server", ["a/one.ts", "b/two.ts"])).toBe("");
  });
});

describe("buildTree", () => {
  const files = [...wcClockFiles(), patch];

  it("groups into tiers, in reading order, with the host edit last", () => {
    const tiers = buildTree(files)
      .filter((n) => n.type === "tier")
      .map((n) => n.tier);
    expect(tiers).toEqual(["server", "web", "host-edit"]);
    expect(TIER_ORDER.indexOf("host-edit")).toBeGreaterThan(TIER_ORDER.indexOf("server"));
  });

  it("opens the manifest first, not guard.ts", () => {
    const serverFiles = buildTree(files)
      .filter((n) => n.type === "file" && n.tier === "server")
      .map((n) => n.path);
    expect(serverFiles[0]).toBe("server/subapps/wc-clock/manifest.ts");
  });

  it("puts tier-root files above subdirectories", () => {
    const names = buildTree(files)
      .filter((n) => n.tier === "server" && n.type !== "tier")
      .map((n) => (n.type === "dir" ? `${n.name}/` : n.name));
    expect(names.indexOf("manifest.ts")).toBeLessThan(names.indexOf("routes/"));
  });

  it("emits a directory row once, with the count of what it holds", () => {
    const dirs = buildTree(files).filter((n) => n.type === "dir");
    expect(dirs).toHaveLength(1);
    expect(dirs[0]).toMatchObject({ path: "server/subapps/wc-clock/routes", fileCount: 3 });
  });

  it("renders the host edit as ONE row, not a directory tree", () => {
    // `server/ > subapps/ > registry.ts.patch` would spend three rows
    // implying a tree this tier does not have, and bury the single thing
    // a person must remember to apply.
    const rows = buildTree(files).filter((n) => n.tier === "host-edit" && n.type !== "tier");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "file", name: "server/subapps/registry.ts.patch" });
  });

  it("hides a collapsed directory's files but keeps the directory row", () => {
    const collapsed = new Set(["server/subapps/wc-clock/routes"]);
    const nodes = buildTree(files, collapsed);
    expect(nodes.some((n) => n.type === "dir" && n.path === "server/subapps/wc-clock/routes")).toBe(true);
    expect(visibleFilePaths(nodes).some((p) => p.includes("/routes/"))).toBe(false);
    // Collapsing one directory must not hide its siblings.
    expect(visibleFilePaths(nodes)).toContain("server/subapps/wc-clock/manifest.ts");
  });

  it("hides everything under a collapsed tier", () => {
    const nodes = buildTree(files, new Set(["tier:server"]));
    const serverRows = nodes.filter((n) => n.tier === "server" && n.type !== "tier");
    expect(serverRows).toEqual([]);
    // Collapsing a tier must not touch the others — including the host
    // edit, whose path also begins with `server/`.
    expect(visibleFilePaths(nodes)).toContain("web/src/subapps/wc-clock/index.tsx");
    expect(visibleFilePaths(nodes)).toContain("server/subapps/registry.ts.patch");
  });

  it("returns no rows for no files", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("gives every row a unique key", () => {
    const paths = buildTree(files).map((n) => n.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
