import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createStudioFromPrompt } from "../create-studio";
import type { Graph } from "../../../workflow/graph";
import { parseStudioResult } from "../../../../src/studio/result";
import { effectiveGrant } from "../../../approvals/src/decision";
import { createMemoryGrantStore } from "../../../approvals/src/store";
import { createMemoryDirectory } from "../../../approvals/src/directory";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const input = { prompt: "Prepare a local review process.", projectId: "alpha" };
const graph = (): Graph => ({ version: 1, id: "localFlow", name: "Local review", customBlocks: [], nodes: [
  { id: "intake_received", type: "manual", label: "Start", position: { x: 0, y: 0 }, config: {} },
  { id: "human_review", type: "approval", label: "Review", position: { x: 200, y: 0 }, config: {} },
  { id: "complete", type: "output", label: "Finish", position: { x: 400, y: 0 }, config: {} },
], edges: [{ id: "first", source: "intake_received", target: "human_review" }, { id: "last", source: "human_review", target: "complete" }] });
const deps = () => ({ ctx: { actor: "Karsten Haldan" }, digest, authorship: "first-party-operator" as const, projectSkills: [],
  llm: vi.fn(async () => ({ text: JSON.stringify({ target: "workflow", reason: "An ordered process." }) })),
  nativeAuthoring: { policyBindingId: "native-authoring/fixture-v1", draftWorkflow: vi.fn(async () => graph()), draftSubapp: vi.fn(async () => ({ spec: {}, understanding: "Unused" })) },
});

const subappSpec = () => ({ id: "review-form", label: "Review form", icon: "📋", navSection: "Contract pipeline", capabilities: ["write:inbox-proposal"], visibleToRoles: ["legal"], domains: [{ name: "reviews", routes: [{ method: "POST", path: "/propose", operation: { kind: "propose", proposalKind: "review", ticketField: "ticket", fields: [{ name: "ticket", type: "string" }], auditEvent: "review-form.proposed" } }] }] });
const subappAnswers = { "consent:write:inbox-proposal": "yes", visibleToRoles: "legal", navSection: "Contract pipeline", icon: "📋" };

it("routes native subapps through real generator gates using protected context without loading skills", async () => {
  const d = { ...deps(), names: ["Anna Mueller"], projectSkillSource: vi.fn(async () => { throw new Error("private loader"); }), llm: vi.fn(async () => ({ text: JSON.stringify({ target: "subapp", reason: "A proposal form." }) })), nativeAuthoring: { ...deps().nativeAuthoring, draftSubapp: vi.fn(async () => ({ spec: subappSpec(), understanding: "A review proposal form." })) } };
  const result = await createStudioFromPrompt({ ...input, prompt: "Prepare a proposal form.", answers: subappAnswers }, d);
  expect(result.status, JSON.stringify(result)).toBe("subapp-result");
  if (result.status !== "subapp-result") return;
  expect(result.outcome.status).toBe("proposed");
  expect(d.nativeAuthoring.draftSubapp).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(d.nativeAuthoring.draftSubapp.mock.calls)).not.toContain("Anna Mueller");
  expect(d.projectSkillSource).not.toHaveBeenCalled();
  expect(d.llm).toHaveBeenCalledTimes(1);
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  const wire = parseStudioResult(JSON.parse(JSON.stringify({ ...result, skillSourceState: "empty" })));
  expect(wire).toMatchObject({ status: "subapp-result", outcome: { status: "proposed" } });
  if (wire.status === "subapp-result" && wire.outcome.status === "proposed" && result.outcome.status === "proposed") {
    expect(wire.outcome.generated.files).toEqual(result.outcome.generated.files);
    expect(wire.outcome.generated.files.find(f => f.kind === "manifest")?.contents).toContain('generatedBy: "flightdeck-studio"');
  }
});

const skill = { id: "review", version: "1", content: "review queue shows human_review for legal. human gate: human_review. country de." };
const workflowReply = {
  workflow: { name: "Review", slug: "review-flow", country: "DE", intakeFields: [{ name: "request", type: "string", required: true }], steps: ["intake_received", "human_review", "complete"], statutorySteps: ["human_review"] },
  pages: [{ slug: "review-queue", title: "Review queue", purpose: "review queue shows human_review for legal.", sourceSkillIds: ["review"], stepIds: ["human_review"], icon: "📋", navSection: "Contract pipeline", visibleToRoles: ["legal"], evidence: [{ skillId: "review", quote: "review queue shows human_review for legal." }] }],
};

it("uses the native graph callback only after exact skill review and grounded metadata planning", async () => {
  const d = { ...deps(), projectSkills: [skill], llm: vi.fn(async (r: { system: string }) => ({ text: JSON.stringify(r.system.includes("STUDIO_DETERMINATION_V1") ? { target: "workflow", reason: "A process." } : workflowReply) })) };
  const pending = await createStudioFromPrompt(input, d);
  if (pending.status !== "model-request-refused" || !pending.review) throw new Error("Expected review");
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
  const result = await createStudioFromPrompt({ ...input, reviewedSkillHash: pending.review.hash }, d);
  expect(result).toMatchObject({ status: "workflow-proposed", graph: graph(), workflow: workflowReply.workflow, skillSources: [{ id: "review", version: "1", contentHash: digest(skill.content) }] });
  expect(d.nativeAuthoring.draftWorkflow).toHaveBeenCalledExactlyOnceWith({ prompt: input.prompt, projectId: "alpha", projectSkills: [skill], workflow: workflowReply.workflow });
  expect(d.llm).toHaveBeenCalledTimes(3);
});

it.each(["legacy-json", "changed-native-policy"])("does not accept a skill review for %s policy", async kind => {
  const d = { ...deps(), projectSkills: [skill] };
  const { nativeAuthoring: _native, ...legacy } = d;
  const initial = await createStudioFromPrompt(input, kind === "legacy-json" ? legacy : d);
  if (initial.status !== "model-request-refused" || !initial.review) throw new Error("Expected review");
  const changed = { ...d, nativeAuthoring: { ...d.nativeAuthoring, policyBindingId: "native-authoring/fixture-v2" } };
  const result = await createStudioFromPrompt({ ...input, reviewedSkillHash: initial.review.hash }, changed);
  expect(result.status).toBe("model-request-refused");
  expect(result).not.toHaveProperty("review.hash", initial.review.hash);
  expect(changed.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
  expect(d.llm).toHaveBeenCalledTimes(2);
});

it.each(["workflow", "subapp"] as const)("asks for a project before starting native %s drafting", async target => {
  const d = { ...deps(), llm: vi.fn(async () => ({ text: JSON.stringify({ target, reason: "A draft." }) })) };
  const result = await createStudioFromPrompt({ prompt: input.prompt }, d);
  expect(result).toMatchObject({ status: "needs_input", questions: [{ id: "projectId" }] });
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
  expect(d.nativeAuthoring.draftSubapp).not.toHaveBeenCalled();
});

it("keeps mandatory workflow steps immutable across the native callback boundary", async () => {
  const base = deps();
  const d = { ...base, projectSkills: [skill], llm: vi.fn(async (r: { system: string }) => ({ text: JSON.stringify(r.system.includes("STUDIO_DETERMINATION_V1") ? { target: "workflow", reason: "A process." } : workflowReply) })), nativeAuthoring: { ...base.nativeAuthoring, draftWorkflow: vi.fn(async (request: { workflow?: { steps: string[]; statutorySteps: string[] } }) => {
    request.workflow!.steps = ["intake_received", "complete"];
    request.workflow!.statutorySteps = [];
    const candidate = graph(); candidate.nodes = candidate.nodes.filter(n => n.id !== "human_review"); candidate.edges = [{ id: "bypass", source: "intake_received", target: "complete" }];
    return candidate;
  }) } };
  const pending = await createStudioFromPrompt(input, d);
  if (pending.status !== "model-request-refused" || !pending.review) throw new Error("Expected review");
  const result = await createStudioFromPrompt({ ...input, reviewedSkillHash: pending.review.hash }, d);
  expect(result.status).toBe("invalid_workflow");
});

it("cannot turn a declined manifest permission into consent by mutating callback arguments", async () => {
  const base = deps();
  const d = { ...base, llm: vi.fn(async () => ({ text: JSON.stringify({ target: "subapp", reason: "A form." }) })), nativeAuthoring: { ...base.nativeAuthoring, draftSubapp: vi.fn(async (request: { answers?: Readonly<Record<string, string>> }) => {
    (request.answers as Record<string, string>)["consent:write:inbox-proposal"] = "yes";
    return { spec: subappSpec(), understanding: "A review form." };
  }) } };
  const result = await createStudioFromPrompt({ ...input, answers: { ...subappAnswers, "consent:write:inbox-proposal": "no" } }, d);
  expect(result).toMatchObject({ status: "subapp-result", outcome: { status: "needs_input", questions: [{ id: "consent:write:inbox-proposal" }] } });
});

it.each(["", " ", "x".repeat(1_001)])("refuses an absent or unbounded native policy binding before sending %#", async policyBindingId => {
  const d = deps(); d.nativeAuthoring.policyBindingId = policyBindingId;
  const result = await createStudioFromPrompt(input, d);
  expect(result).toEqual({ status: "invalid_determination", issues: ["native authoring unavailable"] });
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
  expect(d.llm).not.toHaveBeenCalled();
});

it.each(["UPPER", "has space", "two--parts", "a".repeat(65)])("asks for a canonical bounded local project id before native calls %#", async projectId => {
  const d = deps();
  const result = await createStudioFromPrompt({ ...input, projectId }, d);
  expect(result.status).toBe("needs_input");
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
});

it("round-trips targeted native subapp questions into an exact human-chosen draft", async () => {
  const base = deps();
  const d = { ...base, llm: vi.fn(async () => ({ text: JSON.stringify({ target: "subapp", reason: "A form." }) })), nativeAuthoring: { ...base.nativeAuthoring, draftSubapp: vi.fn(async () => ({ spec: subappSpec(), understanding: "A review form." })) } };
  const missing = await createStudioFromPrompt(input, d);
  expect(missing).toMatchObject({ status: "subapp-result", outcome: { status: "needs_input" } });
  const complete = await createStudioFromPrompt({ ...input, answers: subappAnswers }, d);
  expect(complete).toMatchObject({ status: "subapp-result", outcome: { status: "proposed" } });
  expect(d.nativeAuthoring.draftSubapp).toHaveBeenCalledTimes(2);
  expect(d.nativeAuthoring.draftSubapp).toHaveBeenLastCalledWith({ prompt: input.prompt, answers: subappAnswers });
  expect(JSON.stringify(d.nativeAuthoring.draftSubapp.mock.calls)).not.toContain("contents");
  expect(d.llm).toHaveBeenCalledTimes(2);
});

it.each(["workflow", "subapp"] as const)("blocks sensitive input before the %s native seam", async target => {
  const d = { ...deps(), llm: vi.fn(async () => ({ text: JSON.stringify({ target, reason: "A draft." }) })) };
  const result = await createStudioFromPrompt({ ...input, answers: { note: "Track sick leave and union membership." } }, d);
  expect(result.status).toBe("model-request-refused");
  expect(d.llm).not.toHaveBeenCalled();
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
  expect(d.nativeAuthoring.draftSubapp).not.toHaveBeenCalled();
});

it("preserves lazy skill grant refusal before any native workflow call", async () => {
  const denied = await effectiveGrant({ store: createMemoryGrantStore(), directory: createMemoryDirectory(), toolId: "studio-workflow", toolContent: "Synthetic", projectId: "alpha", datasource: { kind: "repo-path", id: "skills/review" }, payload: {}, requestedBy: { id: "fixture", kind: "agent" }, at: "2026-01-01T00:00:00.000Z" });
  expect(denied.allowed).toBe(false);
  const d = { ...deps(), projectSkillSource: vi.fn(async () => []), authorizeWorkflowContext: vi.fn(async () => denied) };
  const result = await createStudioFromPrompt(input, d);
  expect(result.status).toBe("grant-refused");
  expect(d.projectSkillSource).toHaveBeenCalledExactlyOnceWith("alpha");
  expect(d.authorizeWorkflowContext).toHaveBeenCalledExactlyOnceWith([]);
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
});

it("pins the reviewed native policy and callback references across asynchronous metadata planning", async () => {
  const base = deps();
  const original = base.nativeAuthoring.draftWorkflow;
  const replacement = vi.fn(async () => graph());
  const d = { ...base, projectSkills: [skill], llm: vi.fn(async (r: { system: string }) => {
    if (r.system.includes("STUDIO_DETERMINATION_V1")) return { text: JSON.stringify({ target: "workflow", reason: "A process." }) };
    base.nativeAuthoring.policyBindingId = "changed-during-planning";
    base.nativeAuthoring.draftWorkflow = replacement;
    return { text: JSON.stringify(workflowReply) };
  }) };
  const pending = await createStudioFromPrompt(input, d);
  if (pending.status !== "model-request-refused" || !pending.review) throw new Error("Expected review");
  const result = await createStudioFromPrompt({ ...input, reviewedSkillHash: pending.review.hash }, d);
  expect(result.status).toBe("workflow-proposed");
  expect(original).toHaveBeenCalledTimes(1);
  expect(replacement).not.toHaveBeenCalled();
});

it("asks for a string project id instead of coercing a runtime number into a local result", async () => {
  const d = deps();
  const result = await createStudioFromPrompt({ ...input, projectId: 123 as unknown as string }, d);
  expect(result.status).toBe("needs_input");
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
});

it("proposes a connected local-only native graph without inventing host workflow metadata", async () => {
  const d = deps();
  const result = await createStudioFromPrompt(input, d);
  expect(result).toMatchObject({ status: "workflow-graph-proposed", target: "workflow", projectId: "alpha", graph: graph(), skillSources: [] });
  expect(parseStudioResult(JSON.parse(JSON.stringify({ ...result, skillSourceState: "empty" })))).toEqual({ ...result, skillSourceState: "empty" });
  expect(result).not.toHaveProperty("workflow");
  expect(result).not.toHaveProperty("pages");
  expect(result).toHaveProperty("warnings", expect.arrayContaining([expect.stringMatching(/local.only/i), expect.stringMatching(/host.*authority/i)]));
  expect(d.llm).toHaveBeenCalledTimes(1);
  expect(d.nativeAuthoring.draftWorkflow).toHaveBeenCalledExactlyOnceWith({ prompt: input.prompt, projectId: "alpha", projectSkills: [] });
  expect(d.nativeAuthoring.draftSubapp).not.toHaveBeenCalled();
});

it.each([
  ["malformed", () => ({ graph: graph() })],
  ["disconnected", () => { const g = graph(); g.edges = []; return g; }],
  ["gate bypass", () => { const g = graph(); g.edges.push({ id: "bypass", source: "intake_received", target: "complete" }); return g; }],
  ["cycle", () => { const g = graph(); g.edges.push({ id: "cycle", source: "complete", target: "intake_received" }); return g; }],
  ["missing root", () => { const g = graph(); g.nodes[0]!.type = "set"; return g; }],
  ["extra root", () => { const g = graph(); g.nodes[1]!.type = "manual"; return g; }],
  ["missing output", () => { const g = graph(); g.nodes[2]!.type = "set"; return g; }],
  ["oversized", () => ({ ...graph(), name: "x".repeat(100_001) })],
  ["sensitive label", () => ({ ...graph(), name: "person@example.test salary 98000 EUR" })],
  ["nested name", () => ({ ...graph(), name: '{"name":"Anna Mueller"}' })],
  ["unknown property", () => ({ ...graph(), hostApproved: true })],
  ["custom prototype", () => Object.assign(Object.create({ hidden: true }), graph())],
] as const)("refuses %s native graphs without JSON fallback", async (_kind, candidate) => {
  const base = deps();
  const d = { ...base, nativeAuthoring: { ...base.nativeAuthoring, draftWorkflow: vi.fn(async () => candidate()) } };
  const result = await createStudioFromPrompt(input, d);
  expect(result.status).toBe("invalid_workflow");
  expect(d.llm).toHaveBeenCalledTimes(1);
  expect(d.nativeAuthoring.draftWorkflow).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain("person@example.test");
});

it("does not inspect graph getters returned by native authoring", async () => {
  let reads = 0;
  const value = Object.defineProperty(graph(), "name", { enumerable: true, get() { reads++; throw new Error("private getter"); } });
  const base = deps();
  const result = await createStudioFromPrompt(input, { ...base, nativeAuthoring: { ...base.nativeAuthoring, draftWorkflow: async () => value } });
  expect(result.status).toBe("invalid_workflow");
  expect(reads).toBe(0);
});

it("refuses an unavailable skill source rather than silently drafting an empty-context workflow", async () => {
  const d = { ...deps(), projectSkillSource: vi.fn(async () => { throw new Error("private source details"); }) };
  const result = await createStudioFromPrompt(input, d);
  expect(result).toEqual({ status: "invalid_workflow", issues: ["project skill source unavailable"] });
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
});

it("does not use reference-only skills to authorize a general or host workflow", async () => {
  const d = deps();
  const pending = await createStudioFromPrompt({ ...input, projectSkills: [skill] }, d);
  if (pending.status !== "model-request-refused" || !pending.review) throw new Error("Expected review");
  expect(pending.review.preview).toBe(JSON.stringify({ projectSkills: [], referenceSkills: [skill] }));
  const result = await createStudioFromPrompt({ ...input, projectSkills: [skill], reviewedSkillHash: pending.review.hash }, d);
  expect(result.status).toBe("needs_input");
  expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
});

it.each(["workflow", "subapp"] as const)("never falls back or echoes a native %s exception", async target => {
  const base = deps();
  const fail = async (): Promise<never> => { throw new Error("private callback exception person@example.test"); };
  const d = { ...base, llm: vi.fn(async () => ({ text: JSON.stringify({ target, reason: "A draft." }) })), nativeAuthoring: { ...base.nativeAuthoring, draftWorkflow: vi.fn(fail), draftSubapp: vi.fn(fail) } };
  const result = await createStudioFromPrompt(input, d);
  if (target === "workflow") {
    expect(result).toEqual({ status: "invalid_determination", issues: ["studio planning unavailable"] });
    expect(d.nativeAuthoring.draftWorkflow).toHaveBeenCalledTimes(1);
    expect(d.nativeAuthoring.draftSubapp).not.toHaveBeenCalled();
  } else {
    expect(result).toMatchObject({ status: "subapp-result", outcome: { status: "generation-refused", issues: ["native subapp unavailable"] } });
    expect(d.nativeAuthoring.draftSubapp).toHaveBeenCalledTimes(1);
    expect(d.nativeAuthoring.draftWorkflow).not.toHaveBeenCalled();
  }
  expect(JSON.stringify(result)).not.toContain("private callback exception");
  expect(d.llm).toHaveBeenCalledTimes(1);
});
