/**
 * The Anthropic adapter. Pure `@anthropic-ai/sdk` — no other vendor is named,
 * branched on, or accommodated in this file.
 *
 * ⛔ DO NOT ADD A SECOND VENDOR HERE. A second provider is a new file that
 * implements `ModelProvider` (see `types.ts` and the worked example in
 * `fake.ts`). The moment this file grows an `if (vendor === ...)` it stops
 * being able to use Anthropic's API properly, which is the whole reason the
 * seam is a function type and not a config object.
 *
 * What this file gets right, and what breaks if it is "simplified":
 *
 *   model          `claude-opus-5`, no date suffix. A suffixed id is a 404.
 *   thinking       `{type: "adaptive"}`. `budget_tokens` is REMOVED on Opus 5
 *                  and returns a 400 — it is not deprecated, it is gone.
 *   effort         nested in `output_config`, never top-level.
 *   structured     `output_config.format`. Top-level `output_format` is the
 *                  deprecated spelling.
 *   long output    `messages.stream(...).finalMessage()` once `max_tokens`
 *                  passes the non-streaming ceiling.
 *   no prefill     an assistant turn last in `messages` is a 400 on Opus 5.
 *                  Shape replies with `format` or `system`, never a prefill.
 *   content        a discriminated union — narrow on `type === "text"`.
 *                  `content[0].text` does not typecheck and is not safe.
 *   errors         the SDK's typed classes, most-specific-first.
 *   credentials    a bare `new Anthropic()` resolves ANTHROPIC_API_KEY, then
 *                  ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile.
 *                  No key is read, stored or required by this code.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { ProviderConfig, ProviderConfigInput } from "./config";
import { resolveConfig } from "./config";
import { ProviderError } from "./errors";
import type {
  Completion,
  CompletionRequest,
  ModelProvider,
  StopReason,
  TokenUsage,
} from "./types";

export const ANTHROPIC_PROVIDER_NAME = "anthropic";

export interface AnthropicProviderOptions extends ProviderConfigInput {
  /**
   * An already-built client. Left out, the provider builds a bare
   * `new Anthropic()` the first time it is actually used — lazily, so that
   * merely importing or constructing a provider never throws for want of a
   * credential, and tests never need one.
   */
  readonly client?: Anthropic;
}

/**
 * Builds the exact request body sent to the Messages API.
 *
 * Exported because request SHAPE is the part of this adapter most worth
 * testing and least worth mocking a network for: a test can assert on what
 * this returns without a client, a key, or a socket.
 */
export function buildAnthropicRequest(
  request: CompletionRequest,
  config: ProviderConfig,
): Anthropic.MessageCreateParamsNonStreaming {
  const outputConfig: Anthropic.OutputConfig = {
    // Nested here. A top-level `effort` is silently ignored by the API.
    effort: request.effort ?? config.effort,
  };

  if (request.format !== undefined) {
    // The current spelling. Top-level `output_format` is deprecated.
    outputConfig.format = { type: "json_schema", schema: { ...request.format.schema } };
  }

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: request.model ?? config.model,
    max_tokens: request.maxTokens ?? config.maxTokens,
    // Adaptive, always. Never `{type: "enabled", budget_tokens: N}` — a 400 here.
    thinking: { type: "adaptive" },
    output_config: outputConfig,
    messages: request.messages.map(
      (message): Anthropic.MessageParam => ({ role: message.role, content: message.content }),
    ),
  };

  if (request.system !== undefined && request.system !== "") {
    // Caching is a PREFIX match and render order is tools -> system -> messages,
    // so the breakpoint goes at the end of the stable system block and the
    // volatile per-call text stays in `messages`, after it.
    const systemBlock: Anthropic.TextBlockParam = config.cacheSystemPrompt
      ? { type: "text", text: request.system, cache_control: { type: "ephemeral" } }
      : { type: "text", text: request.system };
    params.system = [systemBlock];
  }

  return params;
}

/** `response.content` is a discriminated union; narrowing is mandatory, not stylistic. */
export function textFromContent(content: readonly Anthropic.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

function normalizeStopReason(raw: Anthropic.StopReason | null): StopReason {
  switch (raw) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    case "tool_use":
      return "tool_use";
    default:
      return "other";
  }
}

function normalizeUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    // Null when the request was not cacheable at all; zero is the honest report.
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

export function toCompletion(message: Anthropic.Message): Completion {
  const stopReason = normalizeStopReason(message.stop_reason);
  return {
    text: textFromContent(message.content),
    // The flag the whole `truncated` contract hangs off. Set from the API's own
    // stop reason — never inferred from whether the text "looks finished".
    truncated: stopReason === "max_tokens",
    stopReason,
    model: message.model,
    usage: normalizeUsage(message.usage),
  };
}

/**
 * Maps the SDK's typed error classes onto `ProviderError`, MOST SPECIFIC
 * FIRST. `BadRequestError`, `AuthenticationError` and `RateLimitError` all
 * extend `APIError`, and `APIConnectionError` does too — so `APIError` must be
 * the last `instanceof` tested or it swallows every case above it.
 *
 * ⛔ No branch in here looks at `error.message`. Message text is not an API.
 */
export function toProviderError(error: unknown): ProviderError {
  const base = { provider: ANTHROPIC_PROVIDER_NAME, cause: error } as const;

  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderError(`the request was rejected: ${error.message}`, {
      ...base,
      kind: "bad_request",
      status: error.status,
    });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ProviderError(
      "no usable Anthropic credential: set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN, or run `ant auth login`",
      { ...base, kind: "auth", status: error.status },
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError(`this credential is not allowed to do that: ${error.message}`, {
      ...base,
      kind: "permission",
      status: error.status,
    });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ProviderError(
      `no such model or endpoint: ${error.message} (a date-suffixed model id is a common cause)`,
      { ...base, kind: "not_found", status: error.status },
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError(`rate limited: ${error.message}`, {
      ...base,
      kind: "rate_limit",
      status: error.status,
    });
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ProviderError(`the provider failed: ${error.message}`, {
      ...base,
      kind: "server",
      status: error.status,
    });
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return new ProviderError("the request was aborted by the caller", { ...base, kind: "canceled" });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(`could not reach the provider: ${error.message}`, {
      ...base,
      kind: "transport",
    });
  }
  // Last: the base class every one of the above extends.
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(`provider error ${error.status ?? "?"}: ${error.message}`, {
      ...base,
      kind: "unknown",
      ...(typeof error.status === "number" ? { status: error.status } : {}),
    });
  }

  return new ProviderError(
    `the provider call failed: ${error instanceof Error ? error.message : String(error)}`,
    { ...base, kind: "unknown" },
  );
}

export class AnthropicProvider implements ModelProvider {
  readonly name = ANTHROPIC_PROVIDER_NAME;
  readonly config: ProviderConfig;

  #client: Anthropic | undefined;

  constructor(options: AnthropicProviderOptions = {}) {
    this.config = resolveConfig(options);
    this.#client = options.client;
  }

  /**
   * Built on first use, not in the constructor.
   *
   * A bare `new Anthropic()` resolves ANTHROPIC_API_KEY, then
   * ANTHROPIC_AUTH_TOKEN, then an `ant auth login` profile. It throws when
   * none of those exist — which is correct at call time and hostile at import
   * time, hence lazy.
   */
  client(): Anthropic {
    if (this.#client === undefined) {
      this.#client = new Anthropic();
    }
    return this.#client;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const params = buildAnthropicRequest(request, this.config);
    const options = request.signal === undefined ? undefined : { signal: request.signal };

    try {
      // Past the non-streaming ceiling the risk is an HTTP timeout on a long
      // generation, not a bigger reply. Streaming keeps the socket busy;
      // `.finalMessage()` hands back the same assembled `Message` either way,
      // so nothing downstream can tell which path ran.
      const message =
        params.max_tokens > this.config.streamingThreshold
          ? await this.client().messages.stream(params, options).finalMessage()
          : await this.client().messages.create(params, options);

      return toCompletion(message);
    } catch (error) {
      throw toProviderError(error);
    }
  }
}
