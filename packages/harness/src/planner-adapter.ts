/** The adoption path `docs/HARNESS-NOTES.md` names: keep `PlannerLlm` as the
 * seam, and give it a recording implementation and a playback one.
 *
 * `@spec`'s planner already takes its model call as a parameter, so nothing in
 * it changes — this turns a harness into something the planner will accept.
 * Types only, erased at build: this file adds no runtime dependency on `@spec`.
 *
 * ⭐ WHY `attempt` IS IN THE KEY. Fixtures are content-addressed, so two
 * identical requests in one run replay the same recording — deterministic, and
 * correct for a pure call. The planner is the exception: it can ask twice, and
 * the whole point of the second ask is to get a DIFFERENT answer. Its repair
 * prompt normally differs on its own, but `attempt` makes the two calls
 * distinguishable even when it does not, so a recorded repair round-trip
 * replays as a repair round-trip instead of the first answer twice. */
import type { PlannerCompletion, PlannerLlm, PlannerRequest } from "../../spec/src/index";
import type { HarnessCaller } from "./provider-contract";

/** A planner call in provider shape: the five keyed fields and nothing else. */
export interface PlannerCall {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly { readonly role: "user"; readonly content: string }[];
  readonly output_config: {
    readonly purpose: PlannerRequest["purpose"];
    readonly attempt: number;
  };
}

export interface PlannerHarnessOptions {
  readonly model: string;
  readonly harness: HarnessCaller<PlannerCall, unknown>;
  /** Reads a completion out of whatever the provider returned. The default
   * accepts `{text, truncated?}` and a bare string. */
  readonly toCompletion?: ((response: unknown) => PlannerCompletion) | undefined;
}

export function toPlannerCall(request: PlannerRequest, model: string): PlannerCall {
  return {
    model,
    system: request.system,
    messages: [{ role: "user", content: request.user }],
    output_config: { purpose: request.purpose, attempt: request.attempt },
  };
}

/** Accepts the two shapes a text completion realistically arrives in, and says
 * so loudly when it is neither — a planner that silently receives `""` reports
 * a model failure that never happened. */
export function readCompletion(response: unknown): PlannerCompletion {
  if (typeof response === "string") return { text: response };
  if (typeof response === "object" && response !== null) {
    const { text, truncated } = response as { text?: unknown; truncated?: unknown };
    if (typeof text === "string") {
      return truncated === true ? { text, truncated: true } : { text };
    }
  }
  throw new TypeError(
    "harness: recorded response has no `text` — pass `toCompletion` to map this provider's shape onto PlannerCompletion",
  );
}

/** `planFromPrompt(input, plannerLlm({ model, harness }))`. */
export function plannerLlm(options: PlannerHarnessOptions): PlannerLlm {
  const toCompletion = options.toCompletion ?? readCompletion;
  return async (request: PlannerRequest): Promise<PlannerCompletion> =>
    toCompletion(await options.harness.call(toPlannerCall(request, options.model)));
}
