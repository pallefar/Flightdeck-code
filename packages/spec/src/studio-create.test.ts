import { expect, it, vi } from "vitest";
import { determineStudioTarget, planStudioWorkflow, projectSkillSchema } from "./studio-create";

it("preserves exact skill bytes for content-hash binding", () => {
  const source = { id: "review", version: "v1", content: "  review queue\n" };
  expect(projectSkillSchema.parse(source)).toEqual(source);
});

const skill = { id: "review", version: "1", content: "Review queue shows human_review for legal. Human gate: human_review. Country DE." };
const draft = {
  workflow: { name: "Review", slug: "review-flow", country: "DE", intakeFields: [{ name: "request", type: "string", required: true }], steps: ["intake_received", "human_review", "complete"], statutorySteps: ["human_review"] },
  pages: [{ slug: "review-queue", title: "Review queue", purpose: "Review queue shows human_review for legal.", sourceSkillIds: ["review"], stepIds: ["human_review"], icon: "📄", navSection: "Contract pipeline", visibleToRoles: ["legal"], evidence: [{ skillId: "review", quote: "Review queue shows human_review for legal." }] }],
};

it("plans a distinct skill-grounded workflow and user-facing pages", async () => {
  const result = await planStudioWorkflow({ prompt: "Review incoming requests", projectId: "alpha", projectSkills: [skill] }, async request => {
    expect(request.system).toContain("STUDIO_WORKFLOW_DRAFT_V1");
    expect(request.system).toContain("Human gate");
    return { text: JSON.stringify(draft) };
  });
  expect(result.status).toBe("workflow-proposed");
  if (result.status !== "workflow-proposed") return;
  expect(result.workflow.steps).toEqual(["intake_received", "human_review", "complete"]);
  expect(result.pages[0]).not.toHaveProperty("evidence");
  expect(result.projectId).toBe("alpha");
});

it("asks for explicit host step ids rather than dropping prose-only human obligations", async () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify(draft) }));
  const result = await planStudioWorkflow({ prompt: "Review incoming requests", projectId: "alpha", projectSkills: [{ ...skill, content: "Must never skip works council statutory review or human review." }] }, llm);
  expect(result.status).toBe("needs_input");
  if (result.status === "needs_input") expect(result.questions[0]?.id).toBe("humanGates");
  expect(llm).not.toHaveBeenCalled();
});

it("refuses a draft dropping a supplied mandatory human gate", async () => {
  const omitted = structuredClone(draft);
  omitted.workflow.steps = ["intake_received", "review", "complete"];
  omitted.workflow.statutorySteps = [];
  omitted.pages[0]!.stepIds = ["review"];
  const result = await planStudioWorkflow({ prompt: "Review incoming requests", projectId: "alpha", projectSkills: [skill] }, async () => ({ text: JSON.stringify(omitted) }));
  expect(result.status).toBe("invalid_workflow");
});

it.each([
  ["purpose not supported by quoted evidence", (d: typeof draft) => { d.pages[0]!.purpose = "An invented executive approval action"; }],
  ["source without matching evidence", (d: typeof draft) => { d.pages[0]!.sourceSkillIds = ["other"]; }],
  ["known step not supported by evidence", (d: typeof draft) => { d.pages[0]!.stepIds = ["complete"]; }],
  ["role not supported by evidence", (d: typeof draft) => { d.pages[0]!.visibleToRoles = ["admin"]; }],
  ["URL in page copy", (d: typeof draft) => { d.pages[0]!.title = "https://evil.test"; }],
] as const)("refuses %s", async (_label, change) => {
  const changed = structuredClone(draft);
  change(changed);
  const result = await planStudioWorkflow({ prompt: "Review incoming requests", projectId: "alpha", projectSkills: [skill, { id: "other", version: "1", content: "Unrelated records." }] }, async () => ({ text: JSON.stringify(changed) }));
  expect(result.status).toBe("invalid_workflow");
});

it.each([
  ["duplicate page slugs", (d: typeof draft) => { d.pages.push(structuredClone(d.pages[0]!)); }],
  ["duplicate intake field names", (d: typeof draft) => { d.workflow.intakeFields.push(structuredClone(d.workflow.intakeFields[0]!)); }],
  ["duplicate page step refs", (d: typeof draft) => { d.pages[0]!.stepIds.push("human_review"); }],
  ["ungrounded workflow steps", (d: typeof draft) => { d.workflow.steps.splice(2, 0, "auto_publish"); }],
] as const)("refuses %s", async (_label, change) => {
  const changed = structuredClone(draft);
  change(changed);
  const result = await planStudioWorkflow({ prompt: "Review incoming requests", projectId: "alpha", projectSkills: [skill] }, async () => ({ text: JSON.stringify(changed) }));
  expect(result.status).toBe("invalid_workflow");
});

it("rejects overlong determination replies even when padded valid JSON", async () => {
  const result = await determineStudioTarget({ prompt: "Review incoming requests" }, async () => ({ text: " ".repeat(8_001) + JSON.stringify({ target: "subapp", reason: "A UI." }) }));
  expect(result).toMatchObject({ status: "invalid_determination" });
});

it("rejects overlong workflow replies even when padded valid JSON", async () => {
  const result = await planStudioWorkflow({ prompt: "Review incoming requests", projectId: "alpha", projectSkills: [skill] }, async () => ({ text: " ".repeat(100_001) + JSON.stringify(draft) }));
  expect(result.status).toBe("invalid_workflow");
});

it("accepts a model ambiguity question without choosing a builder", async () => {
  const result = await determineStudioTarget({ prompt: "Help organize review work" }, async () => ({ text: JSON.stringify({ status: "needs_input", questions: [{ id: "target", question: "Do you want a step graph or a persistent dashboard?" }] }) }));
  expect(result).toEqual({ status: "needs_input", questions: [{ id: "target", question: "Do you want a step graph or a persistent dashboard?" }] });
});

it("uses the model determination, not workflow keywords", async () => {
  const seen: string[] = [];
  const outcome = await determineStudioTarget({ prompt: "Show a workflow dashboard" }, async (request) => {
    seen.push(request.system);
    return { text: JSON.stringify({ target: "subapp", reason: "A persistent UI, not an execution graph." }) };
  });
  expect(outcome).toEqual({ target: "subapp", reason: "A persistent UI, not an execution graph." });
  expect(seen[0]).toContain("STUDIO_DETERMINATION_V1");
});
