/**
 * Model choice and effort as CONFIG, not as edits.
 *
 * Studio ships one default that is correct for planning work, and two dials a
 * caller can turn without touching a source file: which model, and how hard it
 * works. Everything here is data — no client is constructed, no environment is
 * read unless you call `anthropicConfigFromEnv` by name.
 */

import { DEFAULT_MODEL } from "./models";
import type { Effort } from "./types";
import { isEffort } from "./types";

// The id itself lives in `models.ts` and is re-exported here so callers of
// this module are unaffected. See that file for why it is separate: this one
// reads `process.env`, and `packages/envelope` must not reach it.
export { DEFAULT_MODEL } from "./models";

/**
 * Anthropic's own default when `effort` is omitted, stated explicitly so the
 * value is visible in logs and diffable in config.
 *
 * Turn this DOWN for cheaper/faster. Do not reach for disabled thinking to save
 * money: on Opus 5 thinking is on by default and disabling it has two failure
 * modes (a tool call written into visible text instead of a `tool_use` block,
 * and `<thinking>` tags leaking into the reply). Lower effort is the supported,
 * cheaper knob, which is why this package offers no way to turn thinking off.
 */
export const DEFAULT_EFFORT: Effort = "high";

/**
 * Non-streaming ceiling. Anything at or below this is safe on a single
 * request/response; above it the SDK's HTTP timeout becomes the binding
 * constraint, so the adapter switches to streaming (see `STREAMING_THRESHOLD`).
 */
export const DEFAULT_MAX_TOKENS = 16_000;

/**
 * Above this many `max_tokens`, the adapter sends the request as a stream and
 * awaits `.finalMessage()`. Same request, same response object — it just does
 * not sit on an idle socket long enough to be cut off.
 */
export const STREAMING_THRESHOLD = 16_000;

/** Cache the system prompt by default: it is the stable prefix in every Studio call. */
export const DEFAULT_CACHE_SYSTEM_PROMPT = true;

export interface ProviderConfig {
  readonly model: string;
  readonly effort: Effort;
  readonly maxTokens: number;
  readonly cacheSystemPrompt: boolean;
  readonly streamingThreshold: number;
}

/** Everything optional — what is left out takes the documented default above. */
export type ProviderConfigInput = Partial<ProviderConfig>;

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  model: DEFAULT_MODEL,
  effort: DEFAULT_EFFORT,
  maxTokens: DEFAULT_MAX_TOKENS,
  cacheSystemPrompt: DEFAULT_CACHE_SYSTEM_PROMPT,
  streamingThreshold: STREAMING_THRESHOLD,
};

export function resolveConfig(input: ProviderConfigInput = {}): ProviderConfig {
  return {
    model: input.model ?? DEFAULT_PROVIDER_CONFIG.model,
    effort: input.effort ?? DEFAULT_PROVIDER_CONFIG.effort,
    maxTokens: input.maxTokens ?? DEFAULT_PROVIDER_CONFIG.maxTokens,
    cacheSystemPrompt: input.cacheSystemPrompt ?? DEFAULT_PROVIDER_CONFIG.cacheSystemPrompt,
    streamingThreshold: input.streamingThreshold ?? DEFAULT_PROVIDER_CONFIG.streamingThreshold,
  };
}

/** The env vars `anthropicConfigFromEnv` reads. Named so a deploy can grep for them. */
export const MODEL_ENV_VAR = "FLIGHTDECK_MODEL";
export const EFFORT_ENV_VAR = "FLIGHTDECK_EFFORT";

/**
 * Opt-in environment override, for changing model or effort on a deployed
 * Studio without a rebuild.
 *
 * ⚠ CALL IT, DO NOT IMPORT IT BY ACCIDENT. Nothing in this package reads
 * `process.env` on its own — a provider built with `new AnthropicProvider()`
 * and no arguments uses the constants above and only those. That keeps the
 * planner's behaviour a function of its inputs, which is what makes it
 * testable. An unrecognised effort value is ignored rather than crashing a
 * boot; the default stands and the caller is told which value was dropped.
 */
export function anthropicConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly config: ProviderConfigInput; readonly ignored: readonly string[] } {
  const config: { model?: string; effort?: Effort } = {};
  const ignored: string[] = [];

  const model = env[MODEL_ENV_VAR]?.trim();
  if (model !== undefined && model !== "") {
    config.model = model;
  }

  const effort = env[EFFORT_ENV_VAR]?.trim();
  if (effort !== undefined && effort !== "") {
    if (isEffort(effort)) {
      config.effort = effort;
    } else {
      ignored.push(`${EFFORT_ENV_VAR}=${effort} is not one of ${["low", "medium", "high", "xhigh", "max"].join(", ")}`);
    }
  }

  return { config, ignored };
}
