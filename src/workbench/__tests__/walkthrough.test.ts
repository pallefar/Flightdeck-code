import { describe, expect, it } from "vitest";
import { buildWalkthrough } from "../walkthrough";
import { candidate } from "./fixtures";

describe("received candidate architecture", () => {
  it("grounds manifest, folders, the single emitted page and its sections in frozen generated source", () => {
    const input = candidate();
    const plan = buildWalkthrough(input);
    expect(plan.counts).toMatchObject({ artifacts: 5, sourceFiles: 5, hostEdits: 0, pages: 1, sections: 2, capabilities: 2 });
    expect(plan.groups.map(group => group.id)).toEqual(["framework", "server", "web"]);
    expect(plan.groups.map(group => group.paths.length)).toEqual([1, 3, 1]);
    expect(plan.groups.flatMap(group => group.paths).sort()).toEqual(input.files.map(file => file.path).sort());
    expect(plan.steps.map(step => step.kind)).toEqual(["manifest", "server", "page", "section", "section", "registration", "checks"]);
    expect(plan.steps.find(step => step.kind === "server")?.facts).toContain("Guard source: absent from the received candidate.");
    expect(plan.steps.find(step => step.kind === "server")?.facts).toContain("Schema source: absent from the received candidate.");
    expect(plan.steps.find(step => step.kind === "manifest")?.facts).toContain("Declared capabilities: read:contracts, write:inbox-proposal");
    expect(plan.steps.find(step => step.kind === "page")?.facts).toContain("Navigation declaration: Contract pipeline; roles: hr_preparer, hr_reviewer, wc_liaison, admin");
    const clocks = plan.steps.find(step => step.sectionId === "clocks");
    expect(clocks?.paths).toEqual(["web/src/subapps/wc-clock/index.tsx", "server/subapps/wc-clock/routes/clocks.ts"]);
    expect(clocks?.facts).toContain("GET /api/apps/wc-clock/clocks · list descriptor · route scanned");
    expect(clocks?.facts).toContain("POST /api/apps/wc-clock/clocks · 6 declared fields · route scanned");
    expect(plan.steps.find(step => step.kind === "registration")?.facts).toContain("No host registration edit is present in this candidate.");
    expect(plan.steps.at(-1)?.facts).toContain("4 reported static rules; 0 errors; 0 warnings.");
    expect(plan.steps.find(step => step.kind === "page")?.facts).toContain("Settings contribution declared: Clock defaults · workspace-admin · web component wc-clock. Module presence and host registration are not established.");
    expect(plan.steps.find(step => step.kind === "page")?.facts).toContain("Reader scope: one emitted Page/PANELS module. PageDoc configurations and additional web modules remain source-only.");
    expect(plan.steps.at(-1)?.facts).toContain("Reported rules: FD-M001, FD-G001, FD-X002, FD-X003");
    expect(plan.steps.at(-1)?.tip).toContain("not installed-host or production verification");
  });
  it("deduplicates received paths and distinguishes standalone artifacts from proposed host edits", () => {
    const input = candidate();
    const plan = buildWalkthrough(candidate({ files: [
      ...input.files, input.files[0]!,
      { path: "server/subapps/registry.ts.patch", kind: "patch", contents: "proposed edit" },
      { path: "standalone/package.json", kind: "standalone", contents: '{"secret":"DO_NOT_NARRATE"}' },
      { path: "web/src/subapps/wc-clock/../registry.ts", kind: "standalone", contents: "shim only" },
    ] }));
    expect(plan.counts).toMatchObject({ artifacts: 8, sourceFiles: 7, standalone: 2, hostEdits: 1 });
    expect(plan.groups.find(group => group.id === "standalone")?.paths).toEqual(["standalone/package.json", "web/src/subapps/wc-clock/../registry.ts"]);
    expect(plan.steps.find(step => step.kind === "registration")?.paths).toEqual(["server/subapps/registry.ts.patch"]);
    expect(plan.steps.map(step => step.narration).join(" ")).not.toContain("DO_NOT_NARRATE");
  });
  it("does not substitute metadata for unreadable manifest declarations or speak source/configuration values", () => {
    const input = candidate();
    const broken = buildWalkthrough(candidate({ files: input.files.map(file => file.kind === "manifest" ? { ...file, contents: "computedManifest(PRIVATE_CREDENTIAL)" } : file) }));
    expect(broken.manifestSupported).toBe(false);
    expect(broken.steps[0]?.facts.join(" ")).toContain("received metadata is not substituted");
    expect(broken.steps[0]?.narration).toBe("The manifest source declarations are unsupported or absent. No capability grants have been inferred.");
    const invalidShape = buildWalkthrough(candidate({ files: input.files.map(file => file.kind === "manifest" ? { ...file, contents: file.contents.replace('capabilities: ["read:contracts", "write:inbox-proposal"]', 'capabilities: 4') } : file) }));
    expect(invalidShape.manifestSupported).toBe(false);
    expect(invalidShape.steps.find(step => step.kind === "page")?.facts).toContain("Navigation declaration unsupported / absent; no metadata fallback.");
    const privateInput = candidate({ manifest: { ...input.manifest, label: "PRIVATE_PERSON", summary: "PRIVATE_PROMPT", envVar: "PRIVATE_CREDENTIAL" }, files: input.files.map(file => ({ ...file, contents: file.contents + "\n// PRIVATE_RAW_SOURCE\n" })), findings: [{ rule: "PRIVATE_RULE_ID", severity: "warning", file: "(candidate)", line: 0, column: 0, message: "PRIVATE_ERROR_TEXT", evidence: "PRIVATE_EVIDENCE" }] });
    const synopsis = buildWalkthrough(privateInput).steps.map(step => step.narration).join(" ");
    expect(synopsis).not.toContain("PRIVATE_");
    expect(synopsis).toContain("1 warnings");
  });
  it("uses first authoritative duplicate path and refuses unsupported descriptors without fabricated sections", () => {
    const input = candidate();
    const web = input.files.find(file => file.kind === "web-module")!;
    expect(buildWalkthrough(candidate({ files: [...input.files, { ...web, contents: "unsafeComputedPage()" }] })).counts.pages).toBe(1);
    for (const files of [input.files.filter(file => file.kind !== "web-module"), input.files.map(file => file.kind === "web-module" ? { ...file, contents: "unsafeComputedPage()" } : file)]) {
      const plan = buildWalkthrough(candidate({ files }));
      expect(plan.counts.pages).toBe(0); expect(plan.counts.sections).toBe(0);
      expect(plan.steps.some(step => step.kind === "section")).toBe(false);
      expect(plan.steps.find(step => step.kind === "page")?.title).toBe("Page walkthrough unsupported");
      expect(plan.unsupported).not.toBeNull();
    }
  });
});
