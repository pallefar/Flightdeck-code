/**
 * An in-memory provider — and the proof that the seam in `types.ts` is really
 * vendor-neutral.
 *
 * ⭐ WHY THE ENGINE SHAPE IS UGLY ON PURPOSE. `FakeEngine` below takes ONE
 * flat prompt string and returns `{output, cut_off, tokens_in, tokens_out}`.
 * That is deliberately nothing like Anthropic's `messages[]` + content-block
 * union + `stop_reason` + `usage`: no roles, no blocks, no stop-reason
 * vocabulary, a boolean where Anthropic has an enum, and snake_case counters
 * that do not line up with `TokenUsage`. If `ModelProvider` had quietly grown
 * an Anthropic-shaped assumption, this file could not implement it without
 * inventing content blocks — so a compile failure here is the alarm.
 *
 * This is also the worked example for a real second adapter. An OpenAI or
 * Gemini provider is THIS file with the fake engine swapped for that vendor's
 * SDK: a new file, implementing `ModelProvider`, translating at the boundary.
 * It is never a branch inside `anthropic.ts`.
 */

import { ProviderError } from "./errors";
import type { ProviderErrorKind } from "./errors";
import type { Completion, CompletionRequest, ModelProvider, StopReason } from "./types";

/** A reply in the fake vendor's own vocabulary. Note: no roles, no blocks, no enum. */
export interface FakeReply {
  readonly output: string;
  /** This vendor reports truncation as a boolean, not as a stop-reason enum. */
  readonly cut_off?: boolean;
  readonly tokens_in?: number;
  readonly tokens_out?: number;
  /** This vendor signals failure by returning an error code, not by throwing a typed class. */
  readonly error_code?: ProviderErrorKind;
}

/** One flat string in, one flat record out. As un-Anthropic as it gets. */
export type FakeEngine = (prompt: string, model: string) => FakeReply | Promise<FakeReply>;

export interface FakeProviderOptions {
  readonly name?: string;
  readonly model?: string;
}

/** What the engine was handed, for assertions. */
export interface FakeCall {
  readonly prompt: string;
  readonly model: string;
  readonly request: CompletionRequest;
}

export class FakeProvider implements ModelProvider {
  readonly name: string;
  readonly calls: FakeCall[] = [];

  readonly #engine: FakeEngine;
  readonly #model: string;

  constructor(engine: FakeEngine, options: FakeProviderOptions = {}) {
    this.#engine = engine;
    this.name = options.name ?? "fake";
    this.#model = options.model ?? "fake-1";
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const model = request.model ?? this.#model;

    // The whole translation layer: a roles-and-messages request collapsed into
    // the one string this vendor understands.
    const prompt = [
      ...(request.system === undefined || request.system === "" ? [] : [`system: ${request.system}`]),
      ...request.messages.map((message) => `${message.role}: ${message.content}`),
    ].join("\n");

    this.calls.push({ prompt, model, request });

    const reply = await this.#engine(prompt, model);

    if (reply.error_code !== undefined) {
      throw new ProviderError(`${this.name} returned ${reply.error_code}`, {
        kind: reply.error_code,
        provider: this.name,
      });
    }

    const truncated = reply.cut_off === true;
    const stopReason: StopReason = truncated ? "max_tokens" : "end";

    return {
      text: reply.output,
      truncated,
      stopReason,
      model,
      usage: {
        inputTokens: reply.tokens_in ?? 0,
        outputTokens: reply.tokens_out ?? 0,
        // This vendor has no prompt cache at all. Zero is the honest answer,
        // and the neutral shape does not force it to pretend otherwise.
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}

/** Replies in order; the last one repeats. The convenience wrapper tests actually use. */
export function fakeProvider(
  ...replies: readonly (string | FakeReply)[]
): FakeProvider {
  let index = 0;
  return new FakeProvider(() => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply === undefined) {
      throw new Error("fakeProvider was called but no replies were configured");
    }
    return typeof reply === "string" ? { output: reply } : reply;
  });
}
