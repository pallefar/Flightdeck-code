/** Protected Studio routing: gate only context actually sent at each boundary. */
import { determineStudioTarget, planStudioWorkflow, projectSkillsSchema, type ProjectSkill, type ProjectSkillSource, type StudioDetermination, type StudioWorkflowDraft, type WorkflowPlanningOutcome } from "../../spec/src/studio-create";
import { buildSubAppFromPrompt, type BuildDeps, type BuildFromPromptInput, type BuildOutcome } from "./build-subapp";
import { buildSubAppFromSpec, type BuildSubAppSpecOutcome } from "./build-subapp-spec";
import { gateModelRequest, gateGeneratedArtifacts, refuseAtPayloadTierCeiling, type ModelRequestDecision } from "../../guardrails/src/pure";
import { withPseudonymisation } from "../../pseudonym/src/index";
import { PayloadTierError } from "../../pseudonym/src/errors";
import type { GrantDecision } from "../../approvals/src/decision";
import { isNamedHuman } from "../../guardrails/src/approval-pure";
import { proposeWorkflowGraph, type Graph } from "../../workflow/index";
import { preservesWorkflowSteps as graphPreservesWorkflow } from "../../workflow/preservation";
import { graphSchema } from "../../workflow/graph";
import { boundedJson } from "../../workflow/data";

/** Trusted server injection only; callbacks receive already protected context.
 * The binding identifies the entire tool-loop policy, not just its model. */
export interface NativeStudioAuthoring {
  readonly policyBindingId: string;
  readonly draftWorkflow: (input: { readonly prompt: string; readonly answers?: Readonly<Record<string, string>>; readonly projectId?: string; readonly projectSkills: readonly ProjectSkill[]; readonly workflow?: StudioWorkflowDraft }) => Promise<unknown>;
  readonly draftSubapp: (input: { readonly prompt: string; readonly answers?: Readonly<Record<string, string>> }) => Promise<{ spec: unknown; understanding: string }>;
}

export interface SkillSendReview {
  readonly hash: string;
  readonly preview: string;
  readonly unchecked: readonly string[];
}

export interface StudioCreateInput extends BuildFromPromptInput {
  readonly projectId?: string;
  readonly toolId?: string;
  readonly datasource?: { readonly kind: string; readonly id: string; readonly scope?: string };
  /** Reference context only. NEVER authority for a project or datasource. */
  readonly projectSkills?: readonly ProjectSkill[];
  /** Explicit human send confirmation, bound to project/prompt/skill bytes. */
  readonly reviewedSkillHash?: string;
}
export interface StudioCreateDeps extends BuildDeps {
  readonly nativeAuthoring?: NativeStudioAuthoring;
  /** Server-resolved connection/destination/model/policy identity. Never caller input. */
  readonly modelBindingId?: string;
  /** Already server-bound context for pure callers. HTTP uses the lazy source. */
  readonly projectSkills: readonly ProjectSkill[];
  readonly projectSkillSource?: ProjectSkillSource;
  /** Production enables graph drafting after legacy metadata/page proof. */
  readonly graphDrafts?: boolean;
  /** Re-check datasource authority bound to the exact loaded skill bytes. */
  readonly authorizeWorkflowContext?: (skills: readonly ProjectSkill[]) => Promise<GrantDecision | undefined>;
}
export type StudioCreateOutcome =
  | { readonly status: "workflow-graph-proposed"; readonly target: "workflow"; readonly determination: StudioDetermination & { target: "workflow" }; readonly graph: Graph; readonly projectId: string; readonly skillSources: readonly []; readonly warnings: readonly string[] }
  | { readonly status: "subapp-result"; readonly target: "subapp"; readonly determination: StudioDetermination & { target: "subapp" }; readonly outcome: BuildOutcome | BuildSubAppSpecOutcome }
  | (Extract<WorkflowPlanningOutcome, { status: "workflow-proposed" }> & { readonly target: "workflow"; readonly determination: StudioDetermination & { target: "workflow" }; readonly skillSources: readonly { id: string; version: string; contentHash: string }[]; readonly warnings: readonly string[]; readonly graph?: Graph })
  | Exclude<WorkflowPlanningOutcome, { status: "workflow-proposed" }>
  | { readonly status: "invalid_determination"; readonly issues: readonly string[] }
  | { readonly status: "grant-refused"; readonly decision: GrantDecision }
  | { readonly status: "model-request-refused"; readonly decision: ModelRequestDecision; readonly review?: SkillSendReview };
export type StudioSkillSourceState = "loaded" | "empty" | "unavailable" | "not-loaded";
export type StudioCreateResponse = StudioCreateOutcome & { readonly skillSourceState: StudioSkillSourceState };

export async function createStudioFromPrompt(input: StudioCreateInput, deps: StudioCreateDeps): Promise<StudioCreateOutcome> {
  // Pin the policy identity and actual callbacks before any asynchronous send.
  const configuredNative = deps.nativeAuthoring;
  const native = configuredNative && { policyBindingId: configuredNative.policyBindingId, draftWorkflow: configuredNative.draftWorkflow, draftSubapp: configuredNative.draftSubapp };
  if (native && (typeof native.policyBindingId !== "string" || native.policyBindingId.trim().length === 0 || native.policyBindingId.length > 1_000 || typeof native.draftWorkflow !== "function" || typeof native.draftSubapp !== "function")) return { status: "invalid_determination", issues: ["native authoring unavailable"] };
  let result: StudioCreateOutcome = { status: "invalid_determination", issues: ["determination unavailable"] };
  // Construct explicitly: no plan-only fields or third-party skills are sent
  // to determination. A selected project's skills cannot block a UI build.
  const dynamic = { prompt: input.prompt, answers: input.answers, projectId: input.projectId, toolId: input.toolId, datasource: input.datasource, registrySource: input.registrySource };
  const safeLlm: BuildDeps["llm"] = async request => {
    try { return await deps.llm(request); } catch { throw new Error("model request failed"); }
  };
  try {
    await withPseudonymisation(JSON.stringify(dynamic), { names: [...(deps.names ?? [])], ...(deps.maxPayloadTier === undefined ? {} : { maxPayloadTier: deps.maxPayloadTier }) }, async payload => {
      const decision = gateModelRequest({ task: "studio.spec.draft", text: [{ key: "workflow", text: payload.text, assessment: payload.assessment, authorship: deps.authorship ?? "third-party-content" }] }, { ...deps.ctx, digest: deps.digest });
      const allowed = decision.decision === "allow";
      deps.onModelDecision?.(decision);
      if (!allowed) { result = { status: "model-request-refused", decision }; return ""; }
      const protectedInput = JSON.parse(payload.text) as typeof dynamic;
      const determination = await determineStudioTarget({ prompt: protectedInput.prompt, ...(protectedInput.answers === undefined ? {} : { answers: protectedInput.answers }) }, safeLlm);
      if ("status" in determination && determination.status === "invalid_determination") { result = determination; return ""; }
      const outputGate = gateGeneratedArtifacts([{ path: "studio-determination.json", content: JSON.stringify(determination) }], { ...deps.ctx, digest: deps.digest });
      if (outputGate.decision !== "allow") { result = { status: "invalid_determination", issues: ["determination output refused"] }; return ""; }
      if ("status" in determination) { result = determination; return ""; }
      if (native && (typeof protectedInput.projectId !== "string" || protectedInput.projectId.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(protectedInput.projectId))) { result = { status: "needs_input", questions: [{ id: "projectId", question: "Which project should own this native authoring draft?" }] }; return ""; }
      if (determination.target === "subapp") {
        if (native) {
          let outcome: BuildSubAppSpecOutcome = { status: "generation-refused", issues: ["native subapp unavailable"] };
          try {
            const draft = await native.draftSubapp({ prompt: protectedInput.prompt, ...(protectedInput.answers === undefined ? {} : { answers: structuredClone(protectedInput.answers) }) });
            if (boundedJson(draft, 120_000, 16, 10_000) && draft !== null && Object.keys(draft).length === 2 && Object.hasOwn(draft, "spec") && typeof draft.understanding === "string") outcome = await buildSubAppFromSpec({ prompt: protectedInput.prompt, ...(protectedInput.answers === undefined ? {} : { answers: protectedInput.answers }), spec: draft.spec, understanding: draft.understanding }, deps);
          } catch { /* Native failures never fall back or expose adapter details. */ }
          result = { status: "subapp-result", target: "subapp", determination: { ...determination, target: "subapp" }, outcome };
          return "";
        }
        const outcome = await buildSubAppFromPrompt({ prompt: protectedInput.prompt, ...(protectedInput.answers === undefined ? {} : { answers: protectedInput.answers }), ...(protectedInput.registrySource === undefined ? {} : { registrySource: protectedInput.registrySource }) }, { ...deps, llm: safeLlm });
        result = { status: "subapp-result", target: "subapp", determination: { ...determination, target: "subapp" }, outcome: outcome.status === "invalid_draft" ? { ...outcome, issues: ["subapp draft unavailable"] } : outcome };
        return "";
      }
      let loaded: readonly ProjectSkill[];
      try {
        loaded = deps.projectSkillSource && input.projectId ? await deps.projectSkillSource(input.projectId) : deps.projectSkills;
      } catch {
        result = { status: "invalid_workflow", issues: ["project skill source unavailable"] };
        return "";
      }
      if (!projectSkillsSchema.safeParse(loaded).success || !projectSkillsSchema.safeParse(input.projectSkills ?? []).success) { result = { status: "invalid_workflow", issues: ["invalid project skill context"] }; return ""; }
      const grant = await deps.authorizeWorkflowContext?.(loaded);
      if (grant && !grant.allowed) { result = { status: "grant-refused", decision: grant }; return ""; }
      let protectedSkills: readonly ProjectSkill[] = [];
      if (loaded.length > 0 || (input.projectSkills?.length ?? 0) > 0) {
        let skillRefusal: ModelRequestDecision | undefined;
        let skillReview: SkillSendReview | undefined;
        await withPseudonymisation(JSON.stringify({ projectSkills: loaded, referenceSkills: input.projectSkills ?? [] }), { names: [...(deps.names ?? [])] }, async skillPayload => {
          const skillDecision = gateModelRequest({ task: "studio.spec.draft", text: [{ key: "workflow", text: skillPayload.text, assessment: skillPayload.assessment, authorship: "third-party-content" }] }, { ...deps.ctx, digest: deps.digest });
          const skillAllowed = skillDecision.decision === "allow";
          deps.onModelDecision?.(skillDecision);
          if (!skillAllowed) {
            skillRefusal = skillDecision;
            const envelope = skillDecision.envelope;
            // Review is available only for bounded, independently re-proved
            // tier <=2 text. Structural, privacy and over-limit failures stay
            // non-approvable. Imported prose retains third-party provenance.
            if (envelope?.disposition === "requires-human-approval" && skillDecision.tier <= 2 && isNamedHuman(deps.ctx.actor)) {
              skillReview = {
                hash: deps.digest(JSON.stringify({ purpose: native ? "studio-workflow-skill-send/3-native" : "studio-workflow-skill-send/2", ...(native ? { nativePolicyBindingId: native.policyBindingId } : {}), modelBindingId: deps.modelBindingId, projectId: input.projectId, actor: deps.ctx.actor, promptHash: decision.contentHash, skillHash: skillDecision.contentHash })),
                preview: skillPayload.text,
                unchecked: envelope.assurance.notChecked,
              };
              // A separate, explicit human send action consumes this review.
              // It does NOT change the original refusal or authorship, and
              // cannot approve failed privacy/shape proofs or a changed hash.
              if (input.reviewedSkillHash === skillReview.hash) {
                protectedSkills = (JSON.parse(skillPayload.text) as { projectSkills: ProjectSkill[] }).projectSkills;
                skillRefusal = undefined;
              }
            }
          } else protectedSkills = (JSON.parse(skillPayload.text) as { projectSkills: ProjectSkill[] }).projectSkills;
          return "";
        });
        // Ordinary third-party sends still fail closed. Only the explicit,
        // exact-hash human action above can release a re-proved review packet.
        if (skillRefusal) { result = { status: "model-request-refused", decision: skillRefusal, ...(skillReview === undefined ? {} : { review: skillReview }) }; return ""; }
      }
      if (native && loaded.length === 0 && (input.projectSkills?.length ?? 0) === 0) {
        const proposal = await native.draftWorkflow({ prompt: protectedInput.prompt, ...(protectedInput.answers === undefined ? {} : { answers: protectedInput.answers }), ...(protectedInput.projectId === undefined ? {} : { projectId: protectedInput.projectId }), projectSkills: [] });
        const graph = await acceptNativeGraph(proposal, deps);
        if (!graph) { result = { status: "invalid_workflow", issues: ["graph draft invalid or mandatory gates not preserved"] }; return ""; }
        result = { status: "workflow-graph-proposed", target: "workflow", determination: { ...determination, target: "workflow" }, graph, projectId: protectedInput.projectId!, skillSources: [], warnings: ["Local-only draft: review and configure adapters before local execution.", "No host authority: no project pages, host metadata, publication or execution grants are established."] };
        return "";
      }
      const planned = await planStudioWorkflow({ prompt: protectedInput.prompt, ...(protectedInput.answers === undefined ? {} : { answers: protectedInput.answers }), ...(protectedInput.projectId === undefined ? {} : { projectId: protectedInput.projectId }), projectSkills: protectedSkills }, safeLlm);
      if (planned.status !== "workflow-proposed") result = planned;
      else {
        // These schema-owned `name` keys identify a workflow/field, not a
        // person's record. Preserve every value but use domain labels in the
        // scanner view; otherwise any valid workflow is a false-positive
        // personal-name record. Strings remain scanned in all representations.
        const { name: workflowLabel, intakeFields, ...workflowMetadata } = planned.workflow;
        const scanView = { ...planned, workflow: { ...workflowMetadata, workflowLabel, intakeFields: intakeFields.map(({ name: fieldKey, ...field }) => ({ ...field, fieldKey })) } };
        let outputAllowed = false;
        try {
          const serialized = JSON.stringify(scanView);
          await withPseudonymisation(serialized, { names: [...(deps.names ?? [])] }, async payload => {
            // Generated labels must not need identifier replacement: a model
            // echoing personal data is a generation defect, never an approval.
            if (payload.text !== serialized) return "";
            outputAllowed = gateGeneratedArtifacts([{ path: "studio-workflow.json", content: payload.text }], { ...deps.ctx, digest: deps.digest }).decision === "allow";
            return "";
          });
        } catch (error) {
          if (!(error instanceof PayloadTierError)) throw error;
        }
        if (!outputAllowed) { result = { status: "invalid_workflow", issues: ["workflow output refused"] }; return ""; }
        let graph: Graph | undefined;
        if (native) {
          const proposal = await native.draftWorkflow({ prompt: protectedInput.prompt, ...(protectedInput.answers === undefined ? {} : { answers: protectedInput.answers }), projectId: planned.projectId, projectSkills: structuredClone(protectedSkills), workflow: structuredClone(planned.workflow) });
          graph = await acceptNativeGraph(proposal, deps);
          if (!graph || !graphPreservesWorkflow(graph, planned.workflow.steps, planned.workflow.statutorySteps)) { result = { status: "invalid_workflow", issues: ["graph draft invalid or mandatory gates not preserved"] }; return ""; }
        } else if (deps.graphDrafts) {
          const proposal = await proposeWorkflowGraph(JSON.stringify({ request: protectedInput.prompt, workflow: planned.workflow, requirement: "Preserve every workflow step ID as a graph node ID and every statutory step as an unavoidable approval node. Reuse generic blocks or propose reviewed declarative wrappers." }), protectedSkills, async request => {
            const completion = await safeLlm(request);
            if (completion.truncated || completion.text.length > 100_000) throw new Error("invalid graph completion");
            return completion.text;
          });
          if (proposal.status !== "proposed" || !graphPreservesWorkflow(proposal.graph, planned.workflow.steps, planned.workflow.statutorySteps)) { result = { status: "invalid_workflow", issues: ["graph draft invalid or mandatory gates not preserved"] }; return ""; }
          const { name: graphLabel, ...graphData } = proposal.graph;
          const graphText = JSON.stringify({ ...graphData, graphLabel });
          let graphAllowed = false;
          try {
            await withPseudonymisation(graphText, { names: [...(deps.names ?? [])] }, async payload => {
              if (payload.text === graphText) graphAllowed = gateGeneratedArtifacts([{ path: "studio-graph.json", content: graphText }], { ...deps.ctx, digest: deps.digest }).decision === "allow";
              return "";
            });
          } catch (error) { if (!(error instanceof PayloadTierError)) throw error; }
          if (!graphAllowed) { result = { status: "invalid_workflow", issues: ["graph output refused"] }; return ""; }
          graph = proposal.graph;
        }
        result = { ...planned, target: "workflow", determination: { ...determination, target: "workflow" }, skillSources: loaded.map(s => ({ id: s.id, version: s.version, contentHash: deps.digest(s.content) })), warnings: ["Draft only: human review and host builder validation are required before publication."], ...(graph === undefined ? {} : { graph }) };
      }
      return "";
    });
  } catch (error) {
    if (error instanceof PayloadTierError) {
      const decision = refuseAtPayloadTierCeiling({ payloadTier: error.payloadTier, ceiling: error.maxPayloadTier, reasonCodes: error.reasons }, { ...deps.ctx, digest: deps.digest });
      deps.onModelDecision?.(decision);
      return { status: "model-request-refused", decision };
    }
    return { status: "invalid_determination", issues: ["studio planning unavailable"] };
  }
  return result;
}

/** Native values are data, never executable source or authority. */
async function acceptNativeGraph(value: unknown, deps: StudioCreateDeps): Promise<Graph | undefined> {
  if (!boundedJson(value, 100_000, 16, 10_000)) return undefined;
  const parsed = graphSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const graph = parsed.data;
  if (!graphPreservesWorkflow(graph, graph.nodes.map(n => n.id), graph.nodes.filter(n => n.type === "approval").map(n => n.id))) return undefined;
  const { name: graphLabel, ...graphData } = graph;
  const graphText = JSON.stringify({ ...graphData, graphLabel });
  let allowed = false;
  try {
    await withPseudonymisation(graphText, { names: [...(deps.names ?? [])] }, async payload => {
      if (payload.text === graphText) allowed = gateGeneratedArtifacts([{ path: "studio-graph.json", content: graphText }], { ...deps.ctx, digest: deps.digest }).decision === "allow";
      return "";
    });
  } catch (error) { if (!(error instanceof PayloadTierError)) throw error; }
  return allowed ? graph : undefined;
}
