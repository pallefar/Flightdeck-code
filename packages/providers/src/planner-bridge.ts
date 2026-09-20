/**
 * The adapter that lets `@spec`'s `planFromPrompt` run on a real model without
 * `@spec` changing a line.
 *
 * `@spec/planner.ts` declares its own boundary:
 *
 *     type PlannerLlm = (request: PlannerRequest) => Promise<PlannerCompletion>
 *
 * `plannerLlm(provider)` returns exactly that. The planner keeps knowing
 * nothing about vendors, this package keeps knowing nothing about drafts,
 * gates or specs, and the two meet at a function type.
 *
 * ⛔ WHY THE TYPES BELOW ARE DECLARED HERE AND NOT IMPORTED. Same rule codegen
 * uses for `MiniAppSpec` (see `packages/codegen/src/spec-contract.ts`): this
 * package binds to @spec's SHAPE, not to its file layout, so a rename over
 * there is not a compile break here. The binding is still checked — the
 * conformance test asserts, at compile time, that what this returns is
 * assignable to the real `PlannerLlm` imported from @spec, and runs the real
 * `planFromPrompt` over a provider to prove it end to end. If @spec widens its
 * boundary, that test goes red at the seam instead of failing silently.
 */

import { ProviderError } from "./errors";
import type { Effort, ModelProvider } from "./types";

/** Structural port of `@spec`'s `PlannerRequest`. */
export interface PlannerRequestLike {
  readonly system: string;
  readonly user: string;
  readonly purpose: "draft" | "repair";
  /** 1-based. */
  readonly attempt: number;
}

/** Structural port of `@spec`'s `PlannerCompletion`. */
export interface PlannerCompletionLike {
  readonly text: string;
  readonly truncated?: boolean;
}

/** Structural port of `@spec`'s `PlannerLlm`. */
export type PlannerLlmLike = (request: PlannerRequestLike) => Promise<PlannerCompletionLike>;

export interface PlannerLlmOptions {
  /** Per-call override; left out, the provider's configured model is used. */
  readonly model?: string;
  /**
   * Effort for the first (draft) call.
   *
   * ⚠ A repair round-trip is the cheaper of the two: the model is being handed
   * its own broken output and a list of what is wrong with it, which is a much
   * narrower job than drafting. Both default to the provider's configured
   * effort so nothing surprising happens unless a caller asks for it.
   */
  readonly draftEffort?: Effort;
  /** Effort for the repair call. */
  readonly repairEffort?: Effort;
  readonly maxTokens?: number;
}

/**
 * Wraps a provider as a `PlannerLlm`.
 *
 * Two behaviours the planner depends on, both preserved here:
 *
 *  - `truncated` is passed straight through. The planner treats a truncated
 *    reply as "unusable, retry" WITHOUT parsing it — so this must never be
 *    dropped or inferred, only forwarded.
 *  - A provider failure is thrown. `planFromPrompt` catches around the call
 *    and turns it into an `invalid_draft` issue, so throwing is the contract,
 *    not a leak.
 *
 * The `system` string is stable across draft and repair, and the volatile
 * `user` text goes in `messages` after it — which is exactly the prefix layout
 * the Anthropic adapter's cache breakpoint wants. Check it is working with
 * `usage.cache_read_input_tokens`, surfaced as `TokenUsage.cacheReadTokens`.
 */
export function plannerLlm(provider: ModelProvider, options: PlannerLlmOptions = {}): PlannerLlmLike {
  return async (request: PlannerRequestLike): Promise<PlannerCompletionLike> => {
    const effort = request.purpose === "repair" ? options.repairEffort : options.draftEffort;

    const completion = await provider.complete({
      system: request.system,
      // ⛔ Exactly one user turn. No assistant message is appended to nudge the
      // format — a trailing assistant turn is a prefill, and a prefill is a 400
      // on Opus 5. The planner shapes the reply through its system prompt.
      messages: [{ role: "user", content: request.user }],
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(effort === undefined ? {} : { effort }),
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    });

    return { text: completion.text, truncated: completion.truncated };
  };
}

/** Re-exported so a caller catching planner failures does not have to reach into `errors.ts`. */
export { ProviderError };
