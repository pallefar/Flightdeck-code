import { expect, it } from "vitest";
import { createServer } from "../index";
import { createMemoryGrantStore } from "../../packages/approvals/src/store";
import { parseStudioResult } from "../../src/studio/result";
const operator = { actor: "Karsten Haldan", token: "a-sufficiently-long-operator-token" };
const headers = { authorization: `Bearer ${operator.token}` };
const skill = { id: "review", version: "1", content: "review queue shows human_review for legal. human gate: human_review. country de." };
const draft = {
  workflow: { name: "Review", slug: "review-flow", country: "DE", intakeFields: [{ name: "request", type: "string", required: true }], steps: ["intake_received", "human_review", "complete"], statutorySteps: ["human_review"] },
  pages: [{ slug: "review-queue", title: "Review queue", purpose: "review queue shows human_review for legal.", sourceSkillIds: ["review"], stepIds: ["human_review"], icon: "document", navSection: "Contract pipeline", visibleToRoles: ["legal"], evidence: [{ skillId: "review", quote: "review queue shows human_review for legal." }] }],
};
const graph = { version: 1, id: "reviewFlow", name: "Review", nodes: [
  { id: "intake_received", type: "manual", label: "intake", position: { x: 40, y: 120 }, config: {} },
  { id: "human_review", type: "approval", label: "review", position: { x: 320, y: 120 }, config: { reason: "human review required" } },
  { id: "complete", type: "output", label: "complete", position: { x: 600, y: 120 }, config: {} },
], edges: [{ id: "edge1", source: "intake_received", target: "human_review" }, { id: "edge2", source: "human_review", target: "complete" }], customBlocks: [] };
it("allows explicit authenticated review to reach a real workflow proposal response", async () => {
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), projectSkillSource: async () => [skill], llm: async request => ({ text: JSON.stringify(request.system.includes("STUDIO_DETERMINATION_V1") ? { target: "workflow", reason: "A process." } : request.system.includes("strict JSON Graph object") ? graph : draft) }) });
  try {
    const body = { prompt: "Review incoming requests for legal.", projectId: "alpha" };
    const first = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: body });
    const pending = first.json();
    expect(pending.review.hash).toMatch(/^[a-f0-9]{64}$/);
    const response = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: { ...body, reviewedSkillHash: pending.review.hash } });
    expect(response.statusCode).toBe(200);
    expect(parseStudioResult(response.json()).status).toBe("workflow-proposed");
    expect(parseStudioResult(response.json())).toHaveProperty("graph.nodes", graph.nodes);
  } finally { await app.close(); }
});
it.each(["drop", "bypass", "disconnected"])("refuses an AI graph that would %s a mandatory gate", async change => {
  const altered = structuredClone(graph);
  if (change === "drop") altered.nodes[1]!.type = "set";
  if (change === "bypass") altered.edges.push({ id: "bypass", source: "intake_received", target: "complete" });
  if (change === "disconnected") altered.edges = [{ id: "bypass", source: "intake_received", target: "complete" }];
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), projectSkillSource: async () => [skill], llm: async request => ({ text: JSON.stringify(request.system.includes("STUDIO_DETERMINATION_V1") ? { target: "workflow", reason: "A process." } : request.system.includes("strict JSON Graph object") ? altered : draft) }) });
  try {
    const body = { prompt: "Review incoming requests for legal.", projectId: "alpha" };
    const pending = (await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: body })).json();
    const response = await app.inject({ method: "POST", url: "/api/studio/create", headers, payload: { ...body, reviewedSkillHash: pending.review.hash } });
    expect(response.json().status).toBe("invalid_workflow");
    expect(response.json()).not.toHaveProperty("graph");
  } finally { await app.close(); }
});
