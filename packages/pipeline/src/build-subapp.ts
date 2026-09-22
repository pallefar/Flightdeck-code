/**
 * ⭐ PROMPT TO PROPOSAL, THROUGH EVERY GATE. The whole chain, in one function.
 *
 *   prompt
 *     → planFromPrompt          (@spec: the planner, its own gates, its
 *                                clarifying questions and its blocked rules)
 *         └ gatedPlannerLlm     (@pipeline: pseudonymise → envelope →
 *                                gateModelRequest → provider)
 *     → generateSubApp          (@codegen, pure: spec to source files)
 *     → runConformanceGate      (@conformance: does it obey the sub-app contract)
 *     → gateGeneratedArtifacts  (@guardrails: does the OUTPUT carry cat 3/4)
 *     → a proposal a human applies
 *
 * Six packages that until now were reachable from nothing but their own tests.
 *
 * ── WHY THE OUTPUT IS GATED TOO, AND NOT ONLY THE INPUT ─────────────
 * `gateGeneratedArtifacts` is the strictest row in `GATE_POLICY` — tier 3 and
 * 4 are NEVER approvable there — and its reasoning applies exactly here: these
 * files were written by Studio from a source Studio already gated, so personal
 * data in them is a BUG IN GENERATION, and the remedy for a bug is to fix it
 * rather than sign it off. A model that echoes a name from the prompt into a
 * fixture is the concrete case, and it is not hypothetical: fixtures are the
 * classic leak.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────
 * It does not write a file. Nothing here has a filesystem write, by
 * construction — every module it reaches is route-safe — and the output is a
 * candidate a human applies through `@codegen`'s CLI or Studio's proposal
 * path. Propose, don't mutate (contract rule 7) is not worked around here; it
 * is why there is no write path to miss.
 */
import { planFromPrompt, type PlanInput } from "../../spec/src/planner";
import type { PlanOutcome } from "../../spec/src/outcome";
import type { ClarifyingQuestion } from "../../spec/src/questions";
import { generateSubApp, type GeneratedSubApp } from "../../codegen/src/pure";
import { runConformanceGate } from "../../conformance/src/gate";
import type { GateReport } from "../../conformance/src/gate";
import {
  gateGeneratedArtifacts,
  gateModelRequest,
  type Digest,
  type GateContext,
  type GateDecision,
  type ModelRequestDecision, refuseAtPayloadTierCeiling } from "../../guardrails/src/pure";
import { withPseudonymisation, type Tier } from "../../pseudonym/src/index";
import { PayloadTierError } from "../../pseudonym/src/errors";
import { approvedTemplateMenu } from "../../codegen/src/proposal-templates";
import { translateSpec, type TranslationRefusal } from "./translate-spec";
import type { PlannerLlmLike } from "./gated-planner";

/**
 * ⛔ `proposalTemplates` IS NOT THE CALLER'S. Owner ruling 2026-09-22 (8):
 * proposing apps are generated only from the closed catalogue of approved
 * templates, so the menu the planner is shown is always
 * `approvedTemplateMenu()` — set below, AFTER the caller's input is spread,
 * so even an input that smuggles one in (past the type) is overridden.
 */
export interface BuildFromPromptInput extends Omit<PlanInput, "proposalTemplates"> {
  /** The host's `registry.ts`, so codegen can emit a mount patch. Without it
   * the candidate still builds; there is simply no patch to apply. */
  readonly registrySource?: string;
}

export interface BuildDeps {
  /**
   * ⚠ RAW, NOT `gatedPlannerLlm` — and this comment used to say the opposite.
   *
   * It read "Already gated. Compose it with `gatedPlannerLlm`", which was
   * true of an earlier design and is now the one instruction that would
   * break this path. `gatedPlannerLlm` pseudonymises and gates
   * `request.user` — the prompt the PLANNER assembles, scaffolding and all —
   * which assesses as tier 4 and sends nothing; the measured symptom was a
   * guardrail refusal surfacing as `invalid_draft`.
   *
   * This function gates the INPUT boundary itself, before the planner builds
   * anything, and `__tests__/build-subapp.test.ts` asserts the model is never
   * called on a refusal. Double-gating is not belt and braces here; it is two
   * seams where the design has one.
   */
  readonly llm: PlannerLlmLike;
  readonly ctx: GateContext;
  readonly digest: Digest;
  /**
   * ⭐ HOW A REFUSAL GETS OUT, AND WHY IT IS NOT AN EXCEPTION.
   *
   * The obvious design was to let `ModelRequestRefused` propagate out of
   * `planFromPrompt`. It does not: the planner CATCHES a failing llm call —
   * correctly, that is how it retries and how it reports a model that returned
   * nonsense — and reports `invalid_draft`. So a guardrail refusal arrived
   * looking like a badly behaved model, which is the most misleading thing it
   * could have looked like.
   *
   * Measured, not assumed: with a raw llm the same input returns
   * `needs_input`; through the gated one it returned `invalid_draft`.
   *
   * So the decision is captured OUT OF BAND. `buildSubAppFromPrompt` wires
   * this itself and checks it before it believes anything the planner says.
   */
  readonly onModelDecision?: (decision: ModelRequestDecision) => void;
  /** Names the operator KNOWS are in their prompt. The caller's one
   * obligation; in exchange they are masked from every reported path. */
  readonly names?: readonly string[];
  /** See `TextAuthorship` in @envelope. Default third-party — the strict path. */
  readonly authorship?: "first-party-operator" | "third-party-content";
  readonly maxPayloadTier?: Tier;
}

export type BuildOutcome =
  /** The model was never called: the guardrails refused the request. Carries
   * the decision whole, envelope included, so the caller can show a person
   * what they would be approving. */
  | { readonly status: "model-request-refused"; readonly decision: ModelRequestDecision }
  /** @spec wants answers before it will commit to a spec. */
  | { readonly status: "needs_input"; readonly questions: readonly ClarifyingQuestion[]; readonly understanding: string }
  /** @spec refused on a contract rule, quoting the user's own words. */
  | { readonly status: "blocked"; readonly rule: string; readonly explanation: string; readonly evidence: string }
  /** The model could not produce a valid draft in the attempts allowed. */
  | { readonly status: "invalid_draft"; readonly issues: readonly string[]; readonly attempts: number }
  /** Generation itself refused — a spec that cannot be emitted. */
  /** The @spec document could not be expressed as a @codegen one. Each
   * refusal names a path in the SOURCE spec and what @codegen needs that it
   * does not carry — never a coerced value. See `translate-spec.ts`. */
  | { readonly status: "translation-refused"; readonly refusals: readonly TranslationRefusal[] }
  | { readonly status: "generation-refused"; readonly issues: readonly string[] }
  /** ⛔ The generated FILES carry cat 3/4. Never approvable: this is a bug in
   * generation, and the decision names where. */
  | { readonly status: "artifacts-refused"; readonly decision: GateDecision }
  /** A candidate, with every verdict that produced it attached. */
  | {
      readonly status: "proposed";
      readonly generated: GeneratedSubApp;
      readonly conformance: GateReport;
      readonly artifacts: GateDecision;
      readonly understanding: string;
    };

export async function buildSubAppFromPrompt(
  input: BuildFromPromptInput,
  deps: BuildDeps,
): Promise<BuildOutcome> {
  /**
   * ── 1. THE USER'S OWN WORDS — pseudonymised, gated, and planned INSIDE the
   * round trip.
   *
   * ⚠ THE FIRST VERSION TOKENISED THE WRONG STRING, and running it is what
   * showed that. It wrapped the LLM, so what it pseudonymised was
   * `PlannerRequest.user` — the planner's FULLY ASSEMBLED prompt, which
   * carries our own few-shot example and the host's vocabulary. Those are
   * compiled-in, not the user's data; tokenising them is a category error, and
   * the pseudonymiser correctly assessed the result as tier 4
   * ("unverified-name-shaped-content") and refused to send anything at all.
   * The planner then reported that as `invalid_draft` — a guardrail refusal
   * wearing the costume of a badly behaved model.
   *
   * So the seam is the INPUT boundary: tokenise what the person wrote, gate
   * that, and let the planner build its own scaffolding around the tokens.
   *
   * ⭐ AND THE PLANNING HAPPENS INSIDE THE CALLBACK. It has to: the vault dies
   * in `withPseudonymisation`'s `finally`, so anything that needs a name
   * restored — the understanding, the spec's own label and purpose — must be
   * restored before that. The outcome is serialised on the way out so
   * `detokenize` walks all of it, and parsed back on the other side.
   */
  let refused: ModelRequestDecision | null = null;
  let planned: PlanOutcome | null = null;

  let restored: string;
  try {
    ({ text: restored } = await withPseudonymisation(
    input.prompt,
    {
      names: [...(deps.names ?? [])],
      ...(deps.maxPayloadTier === undefined ? {} : { maxPayloadTier: deps.maxPayloadTier }),
    },
    async (payload) => {
      const decision = gateModelRequest(
        {
          task: "studio.spec.draft",
          text: [
            {
              key: "workflow",
              text: payload.text,
              assessment: payload.assessment,
              authorship: deps.authorship ?? "third-party-content",
            },
          ],
        },
        { ...deps.ctx, digest: deps.digest },
      );
      deps.onModelDecision?.(decision);
      if (decision.decision !== "allow") {
        refused = decision;
        // Nothing reaches a model. An empty reply is what the round trip
        // detokenises, and `refused` is what the caller is told about.
        return "";
      }

      planned = await planFromPrompt(
        { ...input, prompt: payload.text, proposalTemplates: approvedTemplateMenu() },
        deps.llm,
      );
      return JSON.stringify(planned);
      },
    ));
  } catch (error) {
    // ⭐ THE ONE REFUSAL THAT LEFT NO TRACE.
    //
    // `withPseudonymisation` assesses the payload and throws BEFORE calling
    // the callback — correctly, because the callback is where the request
    // goes out. But `gateModelRequest` is INSIDE the callback, so the throw
    // pre-empted it, and the effect was exactly inverted: an ordinary
    // tier-2 request produced a decision, a contentHash and an audit event,
    // while a tier-4 payload produced none of the three and came out of
    // `buildSubApp` as an exception rather than an outcome. The refusals
    // that most needed a record were the only ones without one.
    //
    // Re-raised unchanged if it is anything else: a bug in the tokeniser is
    // not a policy refusal and must not be dressed as one.
    if (!(error instanceof PayloadTierError)) throw error;
    const decision = refuseAtPayloadTierCeiling(
      { payloadTier: error.payloadTier, ceiling: error.maxPayloadTier, reasonCodes: error.reasons },
      { ...deps.ctx, digest: deps.digest },
    );
    deps.onModelDecision?.(decision);
    return { status: "model-request-refused", decision };
  }

  if (refused !== null) return { status: "model-request-refused", decision: refused };
  if (planned === null) return { status: "invalid_draft", issues: ["the planner produced nothing"], attempts: 0 };

  // The names the person used are back, inside the understanding and the spec.
  const outcome: PlanOutcome = restored.length > 0 ? (JSON.parse(restored) as PlanOutcome) : planned;

  if (outcome.status === "needs_input") {
    return {
      status: "needs_input",
      questions: outcome.questions,
      understanding: outcome.understanding,
    };
  }
  if (outcome.status === "blocked") {
    return {
      status: "blocked",
      rule: outcome.rule,
      explanation: outcome.explanation,
      evidence: outcome.evidence,
    };
  }
  if (outcome.status === "invalid_draft") {
    return { status: "invalid_draft", issues: outcome.issues, attempts: outcome.attempts };
  }

  // ── 2. spec → source ──
  // ⭐ @spec → @codegen. Two documents that share a type name; this is the
  // only thing that turns one into the other, and it refuses rather than
  // coerces. Before it existed, every prompt reached `generateSubApp` and
  // came back as a schema error about `domains`.
  const translated = translateSpec(outcome.spec);
  if (!translated.ok) return { status: "translation-refused", refusals: translated.refusals };

  let generated: GeneratedSubApp;
  try {
    generated = generateSubApp(
      translated.spec,
      input.registrySource === undefined ? {} : { registrySource: input.registrySource },
    );
  } catch (error) {
    // SpecRejectedError / CodegenInvariantError both carry their own reasons;
    // neither is a crash and neither should look like one.
    const issues = (error as { issues?: readonly string[] }).issues;
    return {
      status: "generation-refused",
      issues: issues ?? [(error as Error).message],
    };
  }

  // ── 3. the HOST half only. The standalone harness is emitted too and is not
  // part of a candidate anyone mounts; `admit.ts`'s ADM-020 refuses a bundle
  // reaching outside the sub-app's own directories, and it is right to. ──
  const hostFiles = generated.files.filter((f) => f.kind !== "standalone");

  // ── 4. does it obey the sub-app contract ──
  const conformance = runConformanceGate({
    files: hostFiles.map((f) => ({ path: f.path, contents: f.contents })),
  });

  // ── 5. does the OUTPUT carry personal data ──
  //
  // ⚠ `contents` HERE, `content` THERE. @codegen's GeneratedFile has
  // `contents`; @guardrails' has `content`. They are different packages with
  // different owners and the field names have always differed — mapping them
  // silently the wrong way round would hand the gate a set of EMPTY FILES and
  // it would pass every one of them. Named here so the next person sees it.
  const artifacts = gateGeneratedArtifacts(
    hostFiles.map((f) => ({ path: f.path, content: f.contents })),
    { ...deps.ctx, digest: deps.digest },
  );
  if (artifacts.decision !== "allow") {
    return { status: "artifacts-refused", decision: artifacts };
  }

  return {
    status: "proposed",
    generated,
    conformance,
    artifacts,
    understanding: outcome.understanding,
  };
}
