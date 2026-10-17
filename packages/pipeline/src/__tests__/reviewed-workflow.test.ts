import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createStudioFromPrompt, type StudioCreateInput } from "../create-studio";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const input = { prompt: "Review incoming requests for legal.", projectId: "alpha" };
const skill = { id: "review", version: "1", content: "review queue shows human_review for legal. human gate: human_review. country de." };
const deps = { modelBindingId: 'fixture-destination/model/policy-v1', ctx: { actor: "Karsten Haldan" }, digest, authorship: "first-party-operator" as const, projectSkills: [skill] };

it('invalidates an exact review when the server-resolved model binding changes', async () => {
  const llm = vi.fn(async () => ({text: JSON.stringify({target: 'workflow', reason: 'A process.'})}));
  const pending = await createStudioFromPrompt(input, {...deps, llm});
  const hash = (pending as {review: {hash: string}}).review.hash;
  llm.mockClear();
  const changed = await createStudioFromPrompt({...input, reviewedSkillHash: hash}, {...deps, llm, modelBindingId: 'different-destination/model/policy'});
  expect(changed.status).toBe('model-request-refused');
  expect(changed).not.toHaveProperty('review.hash', hash);
  expect(llm).toHaveBeenCalledTimes(1);
});

it("offers an exact bounded masked skill context for authenticated human review without sending it", async () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "A process." }) }));
  const result = await createStudioFromPrompt(input, { ...deps, llm });
  expect(result.status).toBe("model-request-refused");
  expect(result).toHaveProperty("review.hash", expect.stringMatching(/^[a-f0-9]{64}$/));
  expect(result).toHaveProperty("review.preview", expect.stringContaining("human_review"));
  expect(llm).toHaveBeenCalledTimes(1);
});

const draft = {
  workflow: { name: "Review", slug: "review-flow", country: "DE", intakeFields: [{ name: "request", type: "string", required: true }], steps: ["intake_received", "human_review", "complete"], statutorySteps: ["human_review"] },
  pages: [{ slug: "review-queue", title: "Review queue", purpose: "review queue shows human_review for legal.", sourceSkillIds: ["review"], stepIds: ["human_review"], icon: "document", navSection: "Contract pipeline", visibleToRoles: ["legal"], evidence: [{ skillId: "review", quote: "review queue shows human_review for legal." }] }],
};
it("sends the masked skill context only after exact human-reviewed hash confirmation", async () => {
  const llm = vi.fn(async (request: { system: string }) => ({ text: JSON.stringify(request.system.includes("STUDIO_DETERMINATION_V1") ? { target: "workflow", reason: "A process." } : draft) }));
  const pending = await createStudioFromPrompt(input, { ...deps, llm });
  const hash = (pending as { review?: { hash: string } }).review?.hash;
  expect(hash).toBeDefined();
  llm.mockClear();
  const reviewedInput = { ...input, reviewedSkillHash: hash } as StudioCreateInput;
  const result = await createStudioFromPrompt(reviewedInput, { ...deps, llm });
  expect(result, JSON.stringify(result)).toMatchObject({ status: "workflow-proposed" });
  expect(llm).toHaveBeenCalledTimes(2);
});

it.each([
  { prompt: "Review other incoming requests for legal." },
  { projectId: "beta" },
  { actor: "Maren Keller" },
  { skillContent: skill.content + " new revision" },
  { hash: "0".repeat(64) },
])("does not reuse review after context changes %#", async change => {
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "A process." }) }));
  const pending = await createStudioFromPrompt(input, { ...deps, llm });
  const hash = (pending as { review?: { hash: string } }).review!.hash;
  llm.mockClear();
  const result = await createStudioFromPrompt({ ...input, ...("prompt" in change ? { prompt: change.prompt } : {}), ...("projectId" in change ? { projectId: change.projectId } : {}), reviewedSkillHash: "hash" in change ? change.hash : hash }, { ...deps, llm, ctx: { actor: "actor" in change ? change.actor : deps.ctx.actor }, projectSkills: [{ ...skill, content: "skillContent" in change ? change.skillContent : skill.content }] });
  expect(result.status).toBe("model-request-refused");
  expect(llm).toHaveBeenCalledTimes(1);
});
it("cannot review a privacy-refused skill bundle", async () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "A process." }) }));
  const result = await createStudioFromPrompt({ ...input, reviewedSkillHash: "0".repeat(64) }, { ...deps, llm, projectSkills: [{ ...skill, content: "Track sick leave and union membership for employees." }] });
  expect(result.status).toBe("model-request-refused");
  expect(result).not.toHaveProperty("review");
  expect(llm).toHaveBeenCalledTimes(1);
});
it("still rejects nested personal-record output in workflow label fields", async () => {
  const changed = structuredClone(draft);
  changed.workflow.name = '{"name":"Anna Mueller"}';
  const llm = vi.fn(async (request: { system: string }) => ({ text: JSON.stringify(request.system.includes("STUDIO_DETERMINATION_V1") ? { target: "workflow", reason: "A process." } : changed) }));
  const pending = await createStudioFromPrompt(input, { ...deps, llm });
  const hash = (pending as { review?: { hash: string } }).review!.hash;
  const result = await createStudioFromPrompt({ ...input, reviewedSkillHash: hash }, { ...deps, llm });
  expect(result.status).toBe("invalid_workflow");
  expect(JSON.stringify(result)).not.toContain("Anna");
});
