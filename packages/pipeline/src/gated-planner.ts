/**
 * ⭐ THE SPINE. Every model call Studio makes, through the guardrails.
 *
 * Until this file existed, `packages/spec`, `providers`, `pseudonym`,
 * `envelope` and `guardrails` were reachable from nothing but their own tests —
 * ~812 tests over eight packages with zero production call sites. Each vertebra
 * was adversarially verified; none of them touched another. This is the
 * composition, and writing it is what turns those tests into tests of
 * something that runs.
 *
 * ── THE ORDER, AND WHY IT IS THIS ORDER ─────────────────────────────
 *   1. PSEUDONYMISE FIRST. Personal data is replaced with tags before
 *      anything else looks at the text, so every later stage — the envelope,
 *      the gate, the audit body, the provider — sees tags and not people.
 *      Doing it after the gate would mean the gate's own findings carry the
 *      values it exists to keep off the wire.
 *   2. EXPRESS AS AN ENVELOPE. The payload becomes a `text` fact carrying the
 *      pseudonymiser's own coverage report, so the request states what was
 *      checked and what was not.
 *   3. GATE. `gateModelRequest` decides. Nothing here second-guesses it.
 *   4. ONLY THEN THE PROVIDER.
 *   5. DETOKENISE THE REPLY inside the pseudonymiser's round trip, so the
 *      vault dies in its `finally` whatever the provider did.
 *
 * ── ⚠ WHAT THIS WILL DO TODAY, STATED PLAINLY ───────────────────────
 * IT WILL REFUSE. `build.ts` computes
 *
 *     const disposition = textFacts > 0 ? "requires-human-approval" : "ready"
 *
 * — ANY free text needs a human, whatever its tier, so pseudonymising does not
 * lower it. And `gateModelRequest` never calls `checkApproval`, so there is no
 * approval that opens it either; `free-text.test.ts` asserts exactly that.
 *
 * That is the design, not a defect in it: an allowlist can prove things about
 * a vocabulary and can prove nothing about a sentence, so the envelope ends
 * that path in a person rather than in an allow.
 *
 * ⛔ SO THIS FILE DOES NOT ADD A BYPASS. A prompt-to-spec builder needs a
 * policy for first-party instructions — text the operator typed HERE, NOW, as
 * against third-party content being forwarded — and that is a decision for
 * whoever owns the policy, not something to settle by weakening the one gate
 * the guardrails exist to provide. The refusal is returned intact, with the
 * envelope a human would approve, so the product can show it and the question
 * is visible instead of buried.
 */
import {
  withPseudonymisation,
  type Tier,
  type WithPseudonymisationOptions,
} from "../../pseudonym/src/index";
import {
  gateModelRequest,
  type Digest,
  type GateContext,
  type ModelRequestDecision,
} from "../../guardrails/src/pure";

/** Structural port of `@spec`'s `PlannerRequest` — same reason
 * `providers/planner-bridge.ts` ports it rather than importing it: this binds
 * to the SHAPE, so a rename over there is not a compile break here. */
export interface PlannerRequestLike {
  readonly system: string;
  readonly user: string;
  readonly purpose: "draft" | "repair";
  readonly attempt: number;
}

export interface PlannerCompletionLike {
  readonly text: string;
  readonly truncated?: boolean;
}

export type PlannerLlmLike = (request: PlannerRequestLike) => Promise<PlannerCompletionLike>;

/**
 * Raised instead of calling the provider. Carries the decision whole — the
 * envelope included — because "refused" without the envelope a human would
 * approve is a dead end rather than a step.
 */
export class ModelRequestRefused extends Error {
  constructor(readonly decision: ModelRequestDecision) {
    super(
      "guardrails refused this model request: " +
        decision.reason +
        (decision.envelope === undefined
          ? ""
          : " (disposition: " + decision.envelope.disposition + ")"),
    );
    this.name = "ModelRequestRefused";
  }
}

export interface GatedPlannerOptions {
  /** Which compiled-in fact key the prompt travels as. `FACT_KEY_POLICY` must
   * declare it `kind: "text"` or the envelope refuses it positionally. */
  readonly textKey?: string;
  /** Names the operator KNOWS are in the text. Declaring them is the caller's
   * one obligation; in exchange they are masked from every reported path. */
  readonly names?: readonly string[];
  readonly sourceTier?: Tier;
  readonly maxPayloadTier?: Tier;
  /** sha256. A route supplies its own; see `@guardrails/pure`. */
  readonly digest: Digest;
  /** Called with every decision, allowed or refused, so the caller can audit
   * the ones that never reached a provider. A gate whose refusals are
   * invisible is a gate nobody can show anyone. */
  readonly onDecision?: (decision: ModelRequestDecision) => void;
}

/**
 * Wraps a planner LLM so the request is pseudonymised, expressed as an
 * envelope and gated before a provider ever sees it.
 *
 * The returned function is assignable to `@spec`'s `PlannerLlm`, so
 * `planFromPrompt(input, gatedPlannerLlm(...))` needs no change in @spec — the
 * seam `providers/planner-bridge.ts` was built for, now with the guardrails in
 * it.
 */
export function gatedPlannerLlm(
  inner: PlannerLlmLike,
  ctx: GateContext,
  opts: GatedPlannerOptions,
): PlannerLlmLike {
  const textKey = opts.textKey ?? "workflow";

  return async (request) => {
    const pseudonymOpts: WithPseudonymisationOptions = {
      names: [...(opts.names ?? [])],
      ...(opts.sourceTier === undefined ? {} : { sourceTier: opts.sourceTier }),
      ...(opts.maxPayloadTier === undefined ? {} : { maxPayloadTier: opts.maxPayloadTier }),
    };

    const { text } = await withPseudonymisation(request.user, pseudonymOpts, async (payload) => {
      // The request as the envelope must see it: a task from AI_TASKS, and the
      // prompt as a text fact carrying the pseudonymiser's OWN report. The
      // report is evidence, not a formality — the envelope re-proves the text
      // against the host's scanner and refuses if it still matches.
      const modelRequest = {
        task: "studio.spec.draft",
        text: [{ key: textKey, text: payload.text, assessment: payload.assessment }],
      };

      const decision = gateModelRequest(modelRequest, { ...ctx, digest: opts.digest });
      opts.onDecision?.(decision);
      if (decision.decision !== "allow") throw new ModelRequestRefused(decision);

      // Only now, and only with what the envelope admitted.
      const completion = await inner({ ...request, user: payload.text });
      return completion.text;
    });

    return { text };
  };
}
