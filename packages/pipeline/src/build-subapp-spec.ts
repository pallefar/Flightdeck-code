/** Generator-native, in-memory candidate path. No model, source evaluation or writes. */
import { generateSubApp, miniAppSpecSchema, type GeneratedSubApp, type MiniAppSpec } from "../../codegen/src/pure";
import { requiredScopeOf } from "../../codegen/src/spec-contract";
import { runConformanceGate } from "../../conformance/src/gate";
import { gateGeneratedArtifacts, gateModelRequest, refuseAtPayloadTierCeiling } from "../../guardrails/src/pure";
import type { BuildDeps, BuildOutcome } from "./build-subapp";
import { boundedJson } from "../../workflow/data";
import { withPseudonymisation } from "../../pseudonym/src/index";
import { PayloadTierError } from "../../pseudonym/src/errors";
import { readConsentAnswers } from "../../spec/src/gates";
import { capabilityConsentQuestion, missingFieldQuestion, navSectionQuestion, rolesQuestion, orderQuestions, type ClarifyingQuestion } from "../../spec/src/questions";

/** Registry edits are inert review data, never executable patch methods on the wire. */
export type NativeGeneratedSubApp = Omit<GeneratedSubApp, "registryPatch"> & {
  readonly registryPatch: Pick<GeneratedSubApp["registryPatch"], "file" | "importLine" | "entryLines">;
};
export type BuildSubAppSpecOutcome = Exclude<BuildOutcome, { status: "proposed" }> |
  (Omit<Extract<BuildOutcome, { status: "proposed" }>, "generated"> & { readonly generated: NativeGeneratedSubApp });
export interface BuildSubAppSpecInput {
  readonly prompt: string;
  readonly answers?: Readonly<Record<string, string>>;
  readonly spec: unknown;
  readonly understanding: string;
}
export type BuildSubAppSpecDeps = Pick<BuildDeps, "ctx" | "digest" | "names" | "authorship" | "maxPayloadTier" | "onModelDecision">;

export async function buildSubAppFromSpec(input: BuildSubAppSpecInput, deps: BuildSubAppSpecDeps): Promise<BuildSubAppSpecOutcome> {
  try {
    if (!boundedJson(input, 120_000, 16, 10_000)) return { status: "generation-refused", issues: ["native subapp spec invalid"] };
    const snapshot = JSON.parse(JSON.stringify(input)) as BuildSubAppSpecInput;
    if (typeof snapshot.prompt !== "string" || typeof snapshot.understanding !== "string" || (snapshot.answers !== undefined && (snapshot.answers === null || Array.isArray(snapshot.answers) || typeof snapshot.answers !== "object" || Object.values(snapshot.answers).some(v => typeof v !== "string")))) return { status: "generation-refused", issues: ["native subapp spec invalid"] };
    let result: BuildSubAppSpecOutcome = { status: "generation-refused", issues: ["native subapp unavailable"] };
    await withPseudonymisation(JSON.stringify({ prompt: snapshot.prompt, ...(snapshot.answers === undefined ? {} : { answers: snapshot.answers }) }), { names: [...(deps.names ?? [])], ...(deps.maxPayloadTier === undefined ? {} : { maxPayloadTier: deps.maxPayloadTier }) }, async payload => {
      const decision = gateModelRequest({ task: "studio.spec.draft", text: [{ key: "workflow", text: payload.text, assessment: payload.assessment, authorship: deps.authorship ?? "third-party-content" }] }, { ...deps.ctx, digest: deps.digest });
      deps.onModelDecision?.(decision);
      if (decision.decision !== "allow") { result = { status: "model-request-refused", decision }; return ""; }
      const protectedInput = JSON.parse(payload.text) as { prompt: string; answers?: Readonly<Record<string, string>> };
      result = await buildProtectedSpec({ ...snapshot, ...protectedInput }, deps);
      return "";
    });
    return result;
  } catch (error) {
    if (error instanceof PayloadTierError) {
      const decision = refuseAtPayloadTierCeiling({ payloadTier: error.payloadTier, ceiling: error.maxPayloadTier, reasonCodes: error.reasons }, { ...deps.ctx, digest: deps.digest });
      deps.onModelDecision?.(decision);
      return { status: "model-request-refused", decision };
    }
    return { status: "generation-refused", issues: ["native subapp unavailable"] };
  }
}

async function buildProtectedSpec(input: BuildSubAppSpecInput, deps: BuildSubAppSpecDeps): Promise<BuildSubAppSpecOutcome> {
  const parsed = miniAppSpecSchema.safeParse(input.spec);
  if (!parsed.success) return { status: "generation-refused", issues: ["native subapp spec invalid"] };
  const spec = parsed.data;
  if ((spec.profile !== undefined && spec.profile !== "mini-app") || (spec.tables?.length ?? 0) > 0 || spec.settingsPanel !== undefined || spec.domains.some(domain => domain.routes.some(route => !["list-contracts", "list-proposals", "propose"].includes(route.operation.kind)))) return { status: "generation-refused", issues: ["native subapp contribution unsupported"] };
  if (typeof input.understanding !== "string" || input.understanding.length === 0 || input.understanding.length > 8_000 || !await safeNativeOutput(JSON.stringify({ spec: specScanView(spec), understanding: input.understanding }), deps)) return { status: "generation-refused", issues: ["native subapp output refused"] };
  // Only explicit complete choice assignments are accepted from the prompt;
  // words such as "read", "contracts" or "admin" in other prose grant nothing.
  const promptChoice = (key: string): string | undefined => {
    const prefix = `${key}:`;
    const matches = input.prompt.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith(prefix));
    return matches.length === 1 ? matches[0]!.slice(prefix.length).trim() : undefined;
  };
  const supplied = input.answers ?? {};
  const answer = (key: string) => Object.hasOwn(supplied, key) ? supplied[key] : promptChoice(key);
  const scopes = new Set(spec.capabilities);
  for (const domain of spec.domains) for (const route of domain.routes) { const scope = requiredScopeOf(route.operation); if (scope) scopes.add(scope); }
  const answers = { ...supplied, ...Object.fromEntries([...scopes].map(cap => `consent:${cap}`).concat(["icon", "navSection", "visibleToRoles"]).flatMap(key => { const value = answer(key); return value === undefined ? [] : [[key, value]]; })) };
  const consent = readConsentAnswers(answers);
  const questions: ClarifyingQuestion[] = [];
  for (const capability of scopes) {
    if (consent.denied.has(capability) || answers[`consent:${capability}`]?.trim().toLowerCase() !== "yes") questions.push(capabilityConsentQuestion(capability, "A model proposal cannot choose a manifest permission."));
  }
  if (answers.icon !== spec.icon) questions.push(missingFieldQuestion("icon", "Which exact icon should this draft manifest use?", "failLoud"));
  if (answers.navSection !== spec.navSection) questions.push(navSectionQuestion(null));
  const chosenRoles = answers.visibleToRoles?.trim().split(/[\s,]+/) ?? [];
  if (chosenRoles.length !== spec.visibleToRoles.length || new Set(chosenRoles).size !== chosenRoles.length || !spec.visibleToRoles.every(role => chosenRoles.includes(role))) questions.push(rolesQuestion());
  if (questions.length > 0) return { status: "needs_input", questions: orderQuestions(questions), understanding: input.understanding };
  let generated: GeneratedSubApp;
  try { generated = generateSubApp(spec); }
  catch { return { status: "generation-refused", issues: ["native subapp generation refused"] }; }
  const hostFiles = generated.files.filter(f => f.kind !== "standalone");
  const conformance = runConformanceGate({ files: hostFiles.map(f => ({ path: f.path, contents: f.contents })) });
  if (!conformance.ok) return { status: "generation-refused", issues: ["native subapp conformance refused"] };
  const artifacts = gateGeneratedArtifacts(hostFiles.map(f => ({ path: f.path, content: f.contents })), { ...deps.ctx, digest: deps.digest });
  if (artifacts.decision !== "allow") return { status: "artifacts-refused", decision: artifacts };
  const { file, importLine, entryLines } = generated.registryPatch;
  return { status: "proposed", generated: { ...generated, warnings: [...generated.warnings, "Draft manifest ceiling only: host installation, project consent and effect-time capability grants are still required. Nothing has been written, mounted or executed."], registryPatch: { file, importLine, entryLines } }, conformance, artifacts, understanding: input.understanding };
}

/** Alias only schema-owned identifier labels; retain and scan every string value. */
function specScanView(spec: MiniAppSpec): unknown {
  const domains = spec.domains.map(({ name: domainKey, routes, ...domain }) => ({
    ...domain, domainKey,
    routes: routes.map(route => ({
      ...route,
      operation: "fields" in route.operation
        ? { ...route.operation, fields: route.operation.fields.map(({ name: fieldKey, ...field }) => ({ ...field, fieldKey })) }
        : route.operation,
    })),
  }));
  if (!spec.workflow) return { ...spec, domains };
  const { name: workflowLabel, ...workflow } = spec.workflow;
  return { ...spec, domains, workflow: { ...workflow, workflowLabel } };
}

async function safeNativeOutput(text: string, deps: BuildSubAppSpecDeps): Promise<boolean> {
  let allowed = false;
  try {
    await withPseudonymisation(text, { names: [...(deps.names ?? [])] }, async payload => {
      if (payload.text === text) allowed = gateGeneratedArtifacts([{ path: "studio-native-subapp.json", content: text }], { ...deps.ctx, digest: deps.digest }).decision === "allow";
      return "";
    });
  } catch (error) { if (!(error instanceof PayloadTierError)) throw error; }
  return allowed;
}
