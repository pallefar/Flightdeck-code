/**
 * What the Anthropic adapter actually SENDS, and what it does with what comes
 * back. No network: a real `Anthropic` client is constructed with a dummy key
 * and its `messages.create` / `messages.stream` replaced, so the request body
 * these tests assert on is the real typed object the SDK would have posted.
 *
 * ⭐ WHY ASSERT ON REQUEST SHAPE AT ALL. Every fact in this file is one a
 * model trained before mid-2026 will confidently get wrong: `budget_tokens`
 * was removed rather than deprecated, `effort` moved inside `output_config`,
 * `output_format` became `output_config.format`. All three are 400s, none are
 * type errors, and none would be caught by a test that only checks the reply.
 */

import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AnthropicProvider, buildAnthropicRequest, toCompletion, toProviderError } from "./anthropic";
import { DEFAULT_EFFORT, DEFAULT_MODEL, resolveConfig } from "./config";
import { ProviderError } from "./errors";
import { readJson } from "./structured";

/** A client that never reaches the network; individual tests install replies on it. */
function stubClient(): Anthropic {
  return new Anthropic({ apiKey: "test-key-not-used" });
}

function messageFixture(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: [{ type: "text", text: "hello", citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 11,
      output_tokens: 7,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
    },
    container: null,
    context_management: null,
    stop_details: null,
    ...overrides,
  } as Anthropic.Message;
}

/** Installs a non-streaming reply and hands back the spy that captured the request. */
function stubCreate(client: Anthropic, message: Anthropic.Message = messageFixture()) {
  const spy = vi.fn().mockResolvedValue(message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.messages as any).create = spy;
  return spy;
}

function stubStream(client: Anthropic, message: Anthropic.Message = messageFixture()) {
  const spy = vi.fn().mockReturnValue({ finalMessage: () => Promise.resolve(message) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.messages as any).stream = spy;
  return spy;
}

describe("request shaping", () => {
  let client: Anthropic;

  beforeEach(() => {
    client = stubClient();
  });

  it("sends the bare model id, with no date suffix", async () => {
    const create = stubCreate(client);
    await new AnthropicProvider({ client }).complete({ messages: [{ role: "user", content: "hi" }] });

    const params = create.mock.calls[0]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.model).toBe("claude-opus-5");
    // The specific way this goes wrong: a remembered date-suffixed id.
    expect(params.model).not.toMatch(/-\d{8}$/);
  });

  it("asks for adaptive thinking and never sends budget_tokens", async () => {
    const create = stubCreate(client);
    await new AnthropicProvider({ client }).complete({ messages: [{ role: "user", content: "hi" }] });

    const params = create.mock.calls[0]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.thinking).toEqual({ type: "adaptive" });
    // Removed on Opus 5 — its presence anywhere in the body is a 400.
    expect(JSON.stringify(params)).not.toContain("budget_tokens");
  });

  it("nests effort inside output_config rather than at the top level", async () => {
    const create = stubCreate(client);
    await new AnthropicProvider({ client, effort: "low" }).complete({
      messages: [{ role: "user", content: "hi" }],
    });

    const params = create.mock.calls[0]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.output_config?.effort).toBe("low");
    expect(params).not.toHaveProperty("effort");
  });

  it("defaults effort to the documented default", async () => {
    const create = stubCreate(client);
    await new AnthropicProvider({ client }).complete({ messages: [{ role: "user", content: "hi" }] });

    const params = create.mock.calls[0]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.output_config?.effort).toBe(DEFAULT_EFFORT);
  });

  it("lets a single call override model and effort without touching config", async () => {
    const create = stubCreate(client);
    const provider = new AnthropicProvider({ client });

    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      model: "claude-haiku-4-5",
      effort: "medium",
    });

    const params = create.mock.calls[0]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.model).toBe("claude-haiku-4-5");
    expect(params.output_config?.effort).toBe("medium");
    // The provider's own config is untouched by a per-call override.
    expect(provider.config.model).toBe(DEFAULT_MODEL);
    expect(provider.config.effort).toBe(DEFAULT_EFFORT);
  });

  it("puts a structured-output schema in output_config.format, not top-level output_format", async () => {
    const create = stubCreate(client);
    const schema = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };

    await new AnthropicProvider({ client }).complete({
      messages: [{ role: "user", content: "hi" }],
      format: { schema },
    });

    const params = create.mock.calls[0]?.[0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.output_config?.format).toEqual({ type: "json_schema", schema });
    // The deprecated spelling.
    expect(params).not.toHaveProperty("output_format");
  });

  it("omits format entirely when no schema was asked for", () => {
    const params = buildAnthropicRequest({ messages: [{ role: "user", content: "hi" }] }, resolveConfig());
    expect(params.output_config?.format).toBeUndefined();
  });

  it("sends the system prompt as a cached prefix, with volatile text after it", () => {
    const params = buildAnthropicRequest(
      { system: "stable instructions", messages: [{ role: "user", content: "volatile question" }] },
      resolveConfig(),
    );

    expect(params.system).toEqual([
      { type: "text", text: "stable instructions", cache_control: { type: "ephemeral" } },
    ]);
    // Caching is a prefix match: the varying part must come after the breakpoint.
    expect(params.messages).toEqual([{ role: "user", content: "volatile question" }]);
  });

  it("drops the cache breakpoint when caching is switched off", () => {
    const params = buildAnthropicRequest(
      { system: "stable", messages: [{ role: "user", content: "q" }] },
      resolveConfig({ cacheSystemPrompt: false }),
    );
    expect(params.system).toEqual([{ type: "text", text: "stable" }]);
  });

  it("never appends an assistant turn to shape the reply (a prefill is a 400 on Opus 5)", () => {
    const params = buildAnthropicRequest(
      { system: "s", messages: [{ role: "user", content: "q" }] },
      resolveConfig(),
    );
    expect(params.messages.at(-1)?.role).toBe("user");
  });
});

describe("streaming for long output", () => {
  it("streams once max_tokens passes the non-streaming ceiling", async () => {
    const client = stubClient();
    const create = stubCreate(client);
    const stream = stubStream(client, messageFixture({ content: [{ type: "text", text: "long", citations: null }] }));

    const completion = await new AnthropicProvider({ client }).complete({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 64_000,
    });

    expect(stream).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    // Same assembled Message either way — the caller cannot tell which path ran.
    expect(completion.text).toBe("long");
  });

  it("stays non-streaming at or below the ceiling", async () => {
    const client = stubClient();
    const create = stubCreate(client);
    const stream = stubStream(client);

    await new AnthropicProvider({ client }).complete({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16_000,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
  });
});

describe("reading the reply", () => {
  it("narrows the content union instead of indexing block zero", () => {
    const completion = toCompletion(
      messageFixture({
        content: [
          { type: "thinking", thinking: "reasoning", signature: "sig" },
          { type: "text", text: "the answer", citations: null },
        ] as Anthropic.ContentBlock[],
      }),
    );
    // A `content[0].text` implementation would have returned undefined here.
    expect(completion.text).toBe("the answer");
  });

  it("reports token usage including cache reads", () => {
    const completion = toCompletion(
      messageFixture({
        usage: {
          ...messageFixture().usage,
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 5,
        },
      }),
    );
    expect(completion.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 900,
      cacheWriteTokens: 5,
    });
  });

  it("treats null cache counters as zero rather than NaN", () => {
    const completion = toCompletion(
      messageFixture({
        usage: {
          ...messageFixture().usage,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      }),
    );
    expect(completion.usage.cacheReadTokens).toBe(0);
    expect(completion.usage.cacheWriteTokens).toBe(0);
  });
});

describe("a truncated reply is reported, not parsed", () => {
  it("flags truncated from the API's stop reason", async () => {
    const client = stubClient();
    stubCreate(
      client,
      messageFixture({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '{"understanding":"half a th', citations: null }],
      }),
    );

    const completion = await new AnthropicProvider({ client }).complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(completion.truncated).toBe(true);
    expect(completion.stopReason).toBe("max_tokens");
    // The fragment is still handed back for logging — it is just marked unusable.
    expect(completion.text).toContain("half a th");
  });

  it("does not flag truncation on a normal stop", () => {
    expect(toCompletion(messageFixture({ stop_reason: "end_turn" })).truncated).toBe(false);
  });

  it("refuses to parse a truncated reply EVEN WHEN the fragment is itself valid JSON", () => {
    // The dangerous case: the ceiling hit on an object boundary, so JSON.parse
    // would have succeeded and returned a plausible object missing half its fields.
    const completion = toCompletion(
      messageFixture({
        stop_reason: "max_tokens",
        content: [{ type: "text", text: '{"understanding":"ok"}', citations: null }],
      }),
    );

    const read = readJson(completion);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.truncated).toBe(true);
      expect(read.reason).toContain("cut off");
    }
  });

  it("parses a complete JSON reply normally", () => {
    const read = readJson(
      toCompletion(messageFixture({ content: [{ type: "text", text: '{"a":1}', citations: null }] })),
    );
    expect(read).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe("typed errors map to ProviderError", () => {
  /** Builds a real SDK error instance of the given class. */
  function apiError<T>(Ctor: new (...args: never[]) => T, status: number): T {
    return new (Ctor as unknown as new (
      status: number,
      error: unknown,
      message: string,
      headers: undefined,
    ) => T)(status, { type: "error" }, "boom", undefined);
  }

  it.each([
    ["BadRequestError", Anthropic.BadRequestError, 400, "bad_request", false],
    ["AuthenticationError", Anthropic.AuthenticationError, 401, "auth", false],
    ["PermissionDeniedError", Anthropic.PermissionDeniedError, 403, "permission", false],
    ["NotFoundError", Anthropic.NotFoundError, 404, "not_found", false],
    ["RateLimitError", Anthropic.RateLimitError, 429, "rate_limit", true],
    ["InternalServerError", Anthropic.InternalServerError, 500, "server", true],
  ] as const)("maps %s to kind %s", (_name, Ctor, status, kind, retryable) => {
    const mapped = toProviderError(apiError(Ctor as never, status));

    expect(mapped).toBeInstanceOf(ProviderError);
    expect(mapped.kind).toBe(kind);
    expect(mapped.status).toBe(status);
    expect(mapped.retryable).toBe(retryable);
    expect(mapped.provider).toBe("anthropic");
  });

  it("maps a connection failure to transport, not to the APIError catch-all", () => {
    // APIConnectionError extends APIError, so a chain in the wrong order lands here.
    const mapped = toProviderError(new Anthropic.APIConnectionError({ message: "socket hang up" }));
    expect(mapped.kind).toBe("transport");
    expect(mapped.retryable).toBe(true);
  });

  it("keeps the original error as the cause", () => {
    const original = apiError(Anthropic.BadRequestError as never, 400);
    expect(toProviderError(original).cause).toBe(original);
  });

  it("maps a non-SDK throw to unknown rather than crashing the mapper", () => {
    const mapped = toProviderError(new TypeError("undefined is not a function"));
    expect(mapped.kind).toBe("unknown");
    expect(mapped.retryable).toBe(false);
  });

  it("throws ProviderError out of complete(), never the raw SDK error", async () => {
    const client = stubClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.messages as any).create = vi
      .fn()
      .mockRejectedValue(apiError(Anthropic.RateLimitError as never, 429));

    await expect(
      new AnthropicProvider({ client }).complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ name: "ProviderError", kind: "rate_limit", retryable: true });
  });
});

describe("credentials", () => {
  it("never constructs a client until a call is actually made", () => {
    // No key in the environment must not break construction — the SDK resolves
    // ANTHROPIC_API_KEY, then ANTHROPIC_AUTH_TOKEN, then an `ant auth login`
    // profile, and only at call time.
    expect(() => new AnthropicProvider()).not.toThrow();
  });

  it("hardcodes no key anywhere in the adapter", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./anthropic.ts", import.meta.url), "utf8"),
    );
    expect(source).not.toMatch(/sk-ant-/);
    expect(source).not.toMatch(/apiKey\s*:/);
  });
});
