import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectSkillsFile } from "../project-skill-source";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "studio-project-skills-"));
  directories.push(directory);
  const file = join(directory, "skills.json");
  await writeFile(file, JSON.stringify(value));
  return file;
}
async function moduleUnderTest() {
  return { loadProjectSkillsFile };
}

describe("operator-bound project skill source", () => {
  it("loads only the skill bundle bound to the selected project", async () => {
    const module = await moduleUnderTest();
    expect(module?.loadProjectSkillsFile, "a project-scoped source must exist").toBeTypeOf("function");
    const file = await fixture({ version: 1, projects: {
      alpha: { skills: [{ id: "intake-review", version: "2", content: "Review intake and pause for human approval." }] },
      beta: { skills: [{ id: "other-project", version: "1", content: "Unrelated project context." }] },
    } });
    const source = module.loadProjectSkillsFile(file);
    expect(await source("alpha")).toEqual([{ id: "intake-review", version: "2", content: "Review intake and pause for human approval." }]);
  });
  it("rejects malformed bundles without echoing their contents", async () => {
    const module = await moduleUnderTest();
    const file = await fixture({ version: 1, projects: { alpha: { skills: [
      { id: "review", version: "1", content: "PRIVATE-BUNDLE-CONTENT" },
      { id: "review", version: "2", content: "duplicate identity" },
    ] } } });
    await expect(module.loadProjectSkillsFile(file)("alpha")).rejects.toThrow("Project skill bundle is invalid");
  });
  it("bounds file acquisition before parsing a large valid JSON file", async () => {
    const module = await moduleUnderTest();
    const file = await fixture({ version: 1, projects: {} });
    await writeFile(file, " ".repeat(262145) + '{"version":1,"projects":{}}');
    await expect(module.loadProjectSkillsFile(file)("alpha")).rejects.toThrow("Project skill bundle is invalid");
  });
  it("fails closed without configured skills and never crosses project boundaries", async () => {
    const module = await moduleUnderTest();
    expect(await module.loadProjectSkillsFile(undefined)("alpha")).toEqual([]);
    const file = await fixture({ version: 1, projects: { alpha: { skills: [] } } });
    expect(await module.loadProjectSkillsFile(file)("beta")).toEqual([]);
    await expect(module.loadProjectSkillsFile(file)("../alpha")).rejects.toThrow("Project identity is invalid");
    await expect(module.loadProjectSkillsFile(file)("constructor")).resolves.toEqual([]);
  });
  it("reloads revisions instead of serving stale project skills", async () => {
    const file = await fixture({ version: 1, projects: { alpha: { skills: [] } } });
    const source = loadProjectSkillsFile(file);
    expect(await source("alpha")).toEqual([]);
    await writeFile(file, JSON.stringify({ version: 1, projects: { alpha: { skills: [
      { id: "human-review", version: "3", content: "Pause for approval." },
    ] } } }));
    expect(await source("alpha")).toEqual([{ id: "human-review", version: "3", content: "Pause for approval." }]);
  });
  it("rejects symlinks and never echoes broken configuration contents", async () => {
    const file = await fixture({ version: 1, projects: {} });
    const link = file + ".link";
    await symlink(file, link);
    await expect(loadProjectSkillsFile(link)("alpha")).rejects.toThrow("Project skill bundle is invalid");
    await writeFile(file, "SECRET-UNPARSEABLE-CONTENT");
    await expect(loadProjectSkillsFile(file)("alpha")).rejects.toThrow(/^Project skill bundle is invalid or unreadable$/);
  });
  it.each([
    { id: "../review", version: "1", content: "Review." },
    { id: "review", version: "", content: "Review." },
    { id: "review", version: "1", content: "x".repeat(2001) },
    { id: "review", version: "1", content: "Review.", filename: "/private/source" },
  ])("rejects unsafe and unbounded skill records", async skill => {
    const file = await fixture({ version: 1, projects: { alpha: { skills: [skill] } } });
    await expect(loadProjectSkillsFile(file)("alpha")).rejects.toThrow("Project skill bundle is invalid");
  });
});
