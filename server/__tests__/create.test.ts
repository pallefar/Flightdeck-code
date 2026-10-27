import { expect, it, vi } from "vitest";
import { toolContentHash } from "../../packages/approvals/src/identity";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../index";
import { createMemoryGrantStore } from "../../packages/approvals/src/store";
import { EXAMPLE_DRAFT_JSON } from "../../packages/spec/src/prompt";
const operator = { actor: "Karsten Haldan", token: "a-sufficiently-long-operator-token" };
const headers = { authorization: `Bearer ${operator.token}` };
const prompt = "Show contract folders needing review, visible to legal and admin.";

it("returns the discriminated subapp result through the real HTTP route", async () => {
  const draft = JSON.parse(EXAMPLE_DRAFT_JSON);
  draft.spec.visibleToRoles = { roles: ["legal", "admin"], evidence: "visible to legal and admin" };
  draft.spec.capabilities = [{ capability: "read:contracts", evidence: "contract folders needing review" }];
  draft.understanding = prompt;
  const llm = vi.fn(async (request: { system: string }) => ({ text: request.system.includes("STUDIO_DETERMINATION_V1") ? JSON.stringify({ target: "subapp", reason: "A persistent dashboard." }) : JSON.stringify(draft) }));
  const source = vi.fn(async () => { throw new Error("private skill loader path"); });
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm, projectSkillSource: source });
  const response = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: { prompt, projectId: "alpha" } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ status: "subapp-result", target: "subapp", determination: { target: "subapp" }, outcome: { status: "proposed" } });
  expect(llm).toHaveBeenCalledTimes(2);
  expect(source).not.toHaveBeenCalled();
  await app.close();
});

it("refuses a missing datasource grant before determination", async () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "A graph." }) }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm });
  const response = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: { prompt, projectId: "alpha", datasource: { kind: "repo-path", id: "contract-source" } } });
  expect(response.json().status).toBe("grant-refused");
  expect(llm).not.toHaveBeenCalled();
  await app.close();
});

it("exposes only authenticated project-isolated skill provenance, never content", async () => {
  const skill = { id: "review", version: "1", content: "Review queue for legal." };
  const source = vi.fn(async (projectId: string) => projectId === "alpha" ? [skill] : []);
  const llm = vi.fn(async () => ({ text: "unused" }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm, projectSkillSource: source });
  const refused = await app.inject({ url: "/api/studio/projects/alpha/skills" });
  expect(refused.statusCode).toBe(401);
  expect(source).not.toHaveBeenCalled();
  const a = await app.inject({ url: "/api/studio/projects/alpha/skills", headers });
  expect(a.json()).toMatchObject({ projectId: "alpha", skillSourceState: "loaded", skillSources: [{ id: "review", version: "1" }] });
  expect(a.body).not.toContain(skill.content);
  expect(a.json().skillSources[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  const b = await app.inject({ url: "/api/studio/projects/beta/skills", headers });
  expect(b.json()).toMatchObject({ projectId: "beta", skillSourceState: "empty", skillSources: [] });
  expect(source.mock.calls).toEqual([["alpha"], ["beta"]]);
  expect(llm).not.toHaveBeenCalled();
  await app.close();
});

it("wires the default file source lazily and refuses skills truthfully after classification", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-create-source-"));
  const file = join(dir, "skills.json");
  const skill = { id: "review", version: "1", content: "Review queue for legal." };
  await writeFile(file, JSON.stringify({ version: 1, projects: { alpha: { skills: [skill] } } }));
  vi.stubEnv("STUDIO_PROJECT_SKILLS_FILE", file);
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "A graph." }) }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm });
  try {
    const response = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: { prompt, projectId: "alpha" } });
    expect(response.json()).toMatchObject({ status: "model-request-refused", skillSourceState: "loaded" });
    expect(response.json().decision.envelope.approvalReasons).toContain("text-is-third-party-content");
    expect(llm).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(llm.mock.calls)).not.toContain(skill.content);
  } finally { await app.close(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); }
});

it("binds all caller input in the intake grant hash before classification", async () => {
  const llm = vi.fn(async () => ({ text: "unused" }));
  const source = vi.fn(async () => []);
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm, projectSkillSource: source });
  const body = { prompt, projectId: "alpha", datasource: { kind: "repo-path", id: "contracts" }, answers: { scope: "yes" }, registrySource: "registry source", projectSkills: [{ id: "reference", version: "1", content: "reference context" }] };
  const a = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: body });
  expect(a.json().status).toBe("grant-refused");
  expect(a.json().decision.contentHash).toBe(toolContentHash({ ...body, toolId: "studio-create" }));
  const b = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: { ...body, answers: { scope: "no" } } });
  expect(b.json().decision.contentHash).not.toBe(a.json().decision.contentHash);
  expect(llm).not.toHaveBeenCalled();
  expect(source).not.toHaveBeenCalled();
  await app.close();
});

it("rechecks grants against loaded skill bytes before a workflow planning call", async () => {
  const datasource = { kind: "repo-path" as const, id: "contracts" };
  const rows = ["*", "alpha"].map(projectId => ({ projectId, toolId: "studio-create", datasources: [{ datasource, maxTier: 2 as const }], revokedAt: null }));
  const skills = [{ id: "review", version: "1", content: "Track sick leave and union membership." }];
  const source = vi.fn(async () => skills);
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "A graph." }) }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore({ rows }), llm, projectSkillSource: source });
  const body = { prompt, projectId: "alpha", datasource };
  const response = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: body });
  expect(response.json().status).toBe("grant-refused");
  expect(response.json().decision.contentHash).toBe(toolContentHash({ ...body, toolId: "studio-create", serverProjectSkills: skills }));
  expect(llm).toHaveBeenCalledTimes(1);
  expect(source).toHaveBeenCalledWith("alpha");
  await app.close();
});

it("redacts a workflow source failure while preserving classification", async () => {
  const secret = "private /operator/skills.json sk-provider-secret";
  const source = vi.fn(async () => { throw new Error(secret); });
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "A graph." }) }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm, projectSkillSource: source });
  const response = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: { prompt, projectId: "alpha" } });
  expect(response.json()).toMatchObject({ status: "invalid_workflow", skillSourceState: "unavailable" });
  expect(response.body).not.toContain(secret);
  expect(llm).toHaveBeenCalledTimes(1);
  await app.close();
});

it.each([
  { prompt, authorship: "first-party-operator" },
  { prompt, projectId: "*" },
  { prompt, answers: { "person@example.test": 12 } },
  { prompt, projectSkills: [{ id: "bad_ID", version: "1", content: "private context" }] },
])("refuses malformed or self-attested requests without exposing input %#", async payload => {
  const llm = vi.fn(async () => ({ text: "unused" }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm });
  const response = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "malformed request", at: ["request"] });
  expect(llm).not.toHaveBeenCalled();
  await app.close();
});

it("authenticates create before loading project context or calling the model", async () => {
  const source = vi.fn(async () => []);
  const llm = vi.fn(async () => ({ text: EXAMPLE_DRAFT_JSON }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm, projectSkillSource: source });
  const response = await app.inject({ method: "POST", url: "/api/studio/create", payload: { prompt, projectId: "alpha" } });
  expect(response.statusCode).toBe(401);
  expect(source).not.toHaveBeenCalled();
  expect(llm).not.toHaveBeenCalled();
  await app.close();
});
