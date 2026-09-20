/**
 * The seam itself, exercised against BOTH implementations through the same
 * assertions.
 *
 * ⭐ WHY A SHARED SUITE AND NOT TWO SEPARATE ONES. An interface only one class
 * implements is not an interface, it is a habit. These cases are written
 * against `ModelProvider` and run twice — once over the Anthropic adapter with
 * a stubbed SDK client, once over the in-memory fake whose underlying engine
 * has a flat, non-Anthropic shape. Anything a caller may rely on belongs here;
 * anything that only passes for one of the two is a leak in the abstraction.
 */

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { AnthropicProvider } from "./anthropic";
import { anthropicConfigFromEnv, DEFAULT_EFFORT, DEFAULT_MODEL, resolveConfig } from "./config";
import { FakeProvider } from "./fake";
import type { FakeReply } from "./fake";
import { readJson } from "./structured";
import type { Completion, ModelProvider } from "./types";

/** What each case needs: a provider primed to answer once, however that vendor spells it. */
interface Harness {
  readonly label: string;
  readonly make: (reply: FakeReply) => ModelProvider;
}

function anthropicMessage(reply: FakeReply): Anthropic.Message {
  return {
    id: "msg_seam",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: [{ type: "text", text: reply.output, citations: null }],
    stop_reason: reply.cut_off === true ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: reply.tokens_in ?? 0,
      output_tokens: reply.tokens_out ?? 0,
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
  } as Anthropic.Message;
}

const HARNESSES: readonly Harness[] = [
  {
    label: "AnthropicProvider (stubbed SDK client)",
    make: (reply) => {
      const client = new Anthropic({ apiKey: "test-key-not-used" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.messages as any).create = vi.fn().mockResolvedValue(anthropicMessage(reply));
      return new AnthropicProvider({ client });
    },
  },
  {
    label: "FakeProvider (non-Anthropic engine shape)",
    make: (reply) => new FakeProvider(() => reply),
  },
];

describe.each(HARNESSES)("$label satisfies ModelProvider", ({ make }) => {
  it("returns text, a truncated flag and usage", async () => {
    const completion: Completion = await make({
      output: "the answer",
      tokens_in: 12,
      tokens_out: 4,
    }).complete({ system: "S", messages: [{ role: "user", content: "q" }] });

    expect(completion.text).toBe("the answer");
    expect(completion.truncated).toBe(false);
    expect(completion.stopReason).toBe("end");
    expect(completion.usage.inputTokens).toBe(12);
    expect(completion.usage.outputTokens).toBe(4);
    expect(typeof completion.model).toBe("string");
  });

  it("reports truncation rather than pretending the fragment is a whole reply", async () => {
    const completion = await make({ output: '{"a":1}', cut_off: true }).complete({
      messages: [{ role: "user", content: "q" }],
    });

    expect(completion.truncated).toBe(true);
    expect(completion.stopReason).toBe("max_tokens");

    // And the shared reader refuses it on both, without parsing.
    const read = readJson(completion);
    expect(read.ok).toBe(false);
  });

  it("reports cache counters as numbers even when the vendor has no cache", async () => {
    const completion = await make({ output: "x" }).complete({
      messages: [{ role: "user", content: "q" }],
    });

    expect(Number.isFinite(completion.usage.cacheReadTokens)).toBe(true);
    expect(Number.isFinite(completion.usage.cacheWriteTokens)).toBe(true);
  });

  it("carries a stable provider name", async () => {
    expect(make({ output: "x" }).name).toMatch(/\S/);
  });
});

describe("the fake adapter really is a different shape", () => {
  it("flattens roles into one prompt string, proving the seam assumes no message array", async () => {
    const provider = new FakeProvider((prompt) => ({ output: prompt }));

    const completion = await provider.complete({
      system: "be brief",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ack" },
        { role: "user", content: "second" },
      ],
    });

    // A vendor with no concept of roles or content blocks still satisfies ModelProvider.
    expect(completion.text).toBe("system: be brief\nuser: first\nassistant: ack\nuser: second");
  });

  it("raises the same ProviderError type from an error code rather than a typed class", async () => {
    const provider = new FakeProvider(() => ({ output: "", error_code: "rate_limit" }));

    await expect(provider.complete({ messages: [{ role: "user", content: "q" }] })).rejects.toMatchObject({
      name: "ProviderError",
      kind: "rate_limit",
      retryable: true,
    });
  });
});

describe("config defaults", () => {
  it("defaults to the documented model and effort", () => {
    expect(resolveConfig()).toMatchObject({ model: "claude-opus-5", effort: DEFAULT_EFFORT });
  });

  it("carries no date suffix on the default model id", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-5");
    expect(DEFAULT_MODEL).not.toMatch(/-\d{8}$/);
  });

  it("lets a caller ask for cheaper without editing code", () => {
    const provider = new AnthropicProvider({ effort: "low", model: "claude-haiku-4-5" });
    expect(provider.config.effort).toBe("low");
    expect(provider.config.model).toBe("claude-haiku-4-5");
  });

  it("reads model and effort from the environment only when asked", () => {
    const { config, ignored } = anthropicConfigFromEnv({
      FLIGHTDECK_MODEL: "claude-sonnet-5",
      FLIGHTDECK_EFFORT: "low",
    });
    expect(config).toEqual({ model: "claude-sonnet-5", effort: "low" });
    expect(ignored).toEqual([]);
  });

  it("ignores an unrecognised effort instead of taking a deploy down", () => {
    const { config, ignored } = anthropicConfigFromEnv({ FLIGHTDECK_EFFORT: "turbo" });
    expect(config.effort).toBeUndefined();
    expect(ignored).toHaveLength(1);
    expect(ignored[0]).toContain("turbo");
  });

  it("reads nothing from the environment by default", () => {
    expect(anthropicConfigFromEnv({})).toEqual({ config: {}, ignored: [] });
  });
});
