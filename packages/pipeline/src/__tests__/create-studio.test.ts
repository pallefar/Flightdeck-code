import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createStudioFromPrompt } from "../create-studio";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const prompt = "Show contract folders needing review, visible to legal and admin.";
const ctx = { actor: "Karsten Haldan" };

it.each(["server", "browser"])("classifies before the %s skill review refusal, never sends skills to a model", async where => {
  const skills = [{ id: "review", version: "1", content: "Review queue for legal." }];
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "A step graph." }) }));
  const result = await createStudioFromPrompt({ prompt, ...(where === "browser" ? { projectSkills: skills } : {}) }, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: where === "server" ? skills : [] });
  expect(result.status).toBe("model-request-refused");
  expect(llm).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(llm.mock.calls)).not.toContain(skills[0]!.content);
  if (result.status === "model-request-refused") expect(result.decision.envelope?.approvalReasons).toContain("text-is-third-party-content");
});

it("refuses identifying model questions rather than echoing them", async () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify({ status: "needs_input", questions: [{ id: "target", question: "Email person@example.test with salary 98000 EUR?" }] }) }));
  const result = await createStudioFromPrompt({ prompt }, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: [] });
  expect(result.status).toBe("invalid_determination");
  expect(JSON.stringify(result)).not.toContain("person@example.test");
  expect(llm).toHaveBeenCalledTimes(1);
});

it("loads only the determined workflow project's skills after classification", async () => {
  const events: string[] = [];
  const source = vi.fn(async (id: string) => { events.push(id); return [{ id: "review", version: "1", content: "Review queue for legal." }]; });
  const llm = vi.fn(async () => { events.push("classification"); return { text: JSON.stringify({ target: "workflow", reason: "A graph." }) }; });
  const result = await createStudioFromPrompt({ prompt, projectId: "alpha" }, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: [], projectSkillSource: source });
  expect(result.status).toBe("model-request-refused");
  expect(events).toEqual(["classification", "alpha"]);
  expect(llm).toHaveBeenCalledTimes(1);
});

it("does not load project skills for a subapp determination", async () => {
  const source = vi.fn(async () => { throw new Error("private loader details"); });
  const llm = vi.fn(async (request: { system: string }) => ({ text: request.system.includes("STUDIO_DETERMINATION_V1") ? JSON.stringify({ target: "subapp", reason: "A UI." }) : "invalid" }));
  const result = await createStudioFromPrompt({ prompt, projectId: "alpha" }, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: [], projectSkillSource: source });
  expect(result.status).toBe("subapp-result");
  expect(source).not.toHaveBeenCalled();
});

it("asks for skills after workflow determination without calling the subapp builder", async () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "An ordered procedure." }) }));
  const result = await createStudioFromPrompt({ prompt, projectId: "alpha" }, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: [] });
  expect(result.status).toBe("needs_input");
  if (result.status === "needs_input") expect(result.questions[0]?.id).toBe("projectSkills");
  expect(llm).toHaveBeenCalledTimes(1);
});

it.each([
  { text: "not json" },
  { text: JSON.stringify({ target: "ambiguous", reason: "Either kind." }) },
  { text: JSON.stringify({ target: "workflow", reason: "A graph.", extra: "ignored?" }) },
  { text: JSON.stringify({ target: "workflow", reason: "A graph." }), truncated: true },
])("does not dispatch invalid or truncated determinations %#", async completion => {
  const source = vi.fn(async () => []);
  const llm = vi.fn(async () => completion);
  const result = await createStudioFromPrompt({ prompt, projectId: "alpha" }, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: [], projectSkillSource: source });
  expect(result.status).toBe("invalid_determination");
  expect(llm).toHaveBeenCalledTimes(1);
  expect(source).not.toHaveBeenCalled();
});

it.each([
  { prompt: "Track sick leave and union membership for the team." },
  { prompt, answers: { purpose: "Track salary 98000 EUR and sick leave." } },
  { prompt, registrySource: "Track sick leave and union membership." },
  { prompt, datasource: { kind: "repo-path", id: "person@example.test" } },
  { prompt, answers: { "person@example.test": "yes" } },
])("gates every dynamic operator field before any call %#", async input => {
  const llm = vi.fn(async () => ({ text: "unused" }));
  const source = vi.fn(async () => []);
  const result = await createStudioFromPrompt(input, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: [], projectSkillSource: source });
  expect(result.status).toBe("model-request-refused");
  expect(llm).not.toHaveBeenCalled();
  expect(source).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("person@example.test");
});

it("never exposes a raw provider exception", async () => {
  const secret = "sk-provider-secret-private";
  const result = await createStudioFromPrompt({ prompt }, { llm: async () => { throw new Error(secret); }, ctx, digest, authorship: "first-party-operator", projectSkills: [] });
  expect(result.status).toBe("invalid_determination");
  expect(JSON.stringify(result)).not.toContain(secret);
});

it("redacts provider exceptions from the downstream subapp builder", async () => {
  const secret = "sk-provider-secret-private";
  const llm = async (request: { system: string }) => {
    if (request.system.includes("STUDIO_DETERMINATION_V1")) return { text: JSON.stringify({ target: "subapp", reason: "A UI." }) };
    throw new Error(secret);
  };
  const result = await createStudioFromPrompt({ prompt }, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: [] });
  expect(result.status).toBe("subapp-result");
  expect(JSON.stringify(result)).not.toContain(secret);
});

it("dispatches an LLM subapp determination to the existing protected builder", async () => {
  const llm = vi.fn(async (request: { system: string }) => ({ text: request.system.includes("STUDIO_DETERMINATION_V1") ? JSON.stringify({ target: "subapp", reason: "A UI application." }) : "invalid draft" }));
  const result = await createStudioFromPrompt({ prompt }, { llm, ctx, digest, authorship: "first-party-operator", projectSkills: [] });
  expect(result.status).toBe("subapp-result");
  if (result.status !== "subapp-result") return;
  expect(result.target).toBe("subapp");
  expect(result.outcome.status).toBe("invalid_draft");
  expect(llm).toHaveBeenCalledTimes(3);
});
