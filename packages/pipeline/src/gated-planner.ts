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
 * ── ⚠ WHEN THIS REFUSES, AND WHY THAT IS STILL MOST OF THE TIME ─────
 * The envelope ends free text in a person unless ALL FOUR of these hold: the
 * caller declared `first-party-operator`, a NAMED human is acting, the
 * pseudonymiser actually got the payload below tier 3, and the host's own
 * scanner re-proved the text clean. Miss any one — including simply not
 * passing the flag — and the request comes back `requires-human-approval`
 * with `approvalReasons` naming which condition failed.
 *
 * ⛔ THE SPINE ADDS NO BYPASS OF ITS OWN. It passes the caller's declaration
 * through and obeys the verdict; every refusal is returned whole, envelope
 * included, so the product can show the person what they would be approving
 * instead of a dead end. `gated-planner.test.ts` proves the provider is
 * unreachable when the gate says no, by mutation.
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
  /**
   * ⭐ WHO TYPED THE PROMPT. Default `third-party-content`, the strict path.
   *
   * `first-party-operator` says the acting human wrote this sentence here, in
   * this session — so they ARE the reviewer and need not stamp their own
   * words. It is not a bypass: the envelope still requires a NAMED actor, a
   * payload the pseudonymiser actually reduced below tier 3, and a clean
   * re-scan by the host's own detector. See `first-party.test.ts`, which
   * removes each of those in turn and shows every one of them alone puts the
   * request back in front of a person.
   */
  readonly authorship?: "first-party-operator" | "third-party-content";
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
        text: [
          {
            key: textKey,
            text: payload.text,
            assessment: payload.assessment,
            authorship: opts.authorship ?? "third-party-content",
          },
        ],
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
