/**
 * `@providers` — one model-call interface, one real implementation.
 *
 * Typical wiring, with @spec unchanged:
 *
 *     import { AnthropicProvider, plannerLlm } from "../providers/src";
 *     import { planFromPrompt } from "../spec/src";
 *
 *     const outcome = await planFromPrompt({ prompt }, plannerLlm(new AnthropicProvider()));
 *
 * Cheaper/faster without editing code: `new AnthropicProvider({ effort: "low" })`,
 * or `new AnthropicProvider(anthropicConfigFromEnv().config)` to take
 * `FLIGHTDECK_MODEL` / `FLIGHTDECK_EFFORT` from the environment.
 *
 * ADDING A PROVIDER: a new file implementing `ModelProvider` (`fake.ts` is the
 * worked example), exported from here. Nothing else in Studio changes, and
 * `anthropic.ts` is not touched.
 */

export type {
  Completion,
  CompletionMessage,
  CompletionRequest,
  Effort,
  JsonSchemaFormat,
  MessageRole,
  ModelProvider,
  StopReason,
  TokenUsage,
} from "./types";
export { EFFORTS, isEffort } from "./types";

export { ProviderError, isProviderError } from "./errors";
export type { ProviderErrorInit, ProviderErrorKind } from "./errors";

export {
  DEFAULT_CACHE_SYSTEM_PROMPT,
  DEFAULT_EFFORT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_CONFIG,
  EFFORT_ENV_VAR,
  MODEL_ENV_VAR,
  STREAMING_THRESHOLD,
  anthropicConfigFromEnv,
  resolveConfig,
} from "./config";
export type { ProviderConfig, ProviderConfigInput } from "./config";

export {
  ANTHROPIC_PROVIDER_NAME,
  AnthropicProvider,
  buildAnthropicRequest,
  textFromContent,
  toCompletion,
  toProviderError,
} from "./anthropic";
export type { AnthropicProviderOptions } from "./anthropic";

export { readJson } from "./structured";
export type { JsonRead } from "./structured";

export { plannerLlm } from "./planner-bridge";
export type { PlannerCompletionLike, PlannerLlmLike, PlannerLlmOptions, PlannerRequestLike } from "./planner-bridge";

export { FakeProvider, fakeProvider } from "./fake";
export type { FakeCall, FakeEngine, FakeProviderOptions, FakeReply } from "./fake";
