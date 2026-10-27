import { describe, expect, it } from "vitest";
import { searchTree, visibleFilePaths } from "../tree";
import { wcClockFiles } from "./fixtures";

describe("source explorer search", () => {
  it("finds actual source paths through collapsed tiers and leaves their collapse state untouched", () => {
    const files = wcClockFiles();
    const collapsed = new Set(["tier:server", "server/subapps/wc-clock/routes"]);
    expect(visibleFilePaths(searchTree(files, " REVIEW.ts ", collapsed))).toEqual(["server/subapps/wc-clock/routes/review.ts"]);
    expect(collapsed).toEqual(new Set(["tier:server", "server/subapps/wc-clock/routes"]));
    expect(visibleFilePaths(searchTree(files, "", collapsed))).toEqual(["web/src/subapps/wc-clock/index.tsx"]);
  });
  it("returns no invented entries and supports unknown file kinds by exact path", () => {
    const files = [...wcClockFiles(), { path: "notes/contract.custom", kind: "unknown" as const, contents: "actual custom text" }];
    expect(visibleFilePaths(searchTree(files, "contract.custom"))).toEqual(["notes/contract.custom"]);
    expect(searchTree(files, "does-not-exist")).toEqual([]);
  });
});
