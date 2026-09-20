/**
 * `@providers` — the model layer Studio calls, with the vendor swapped out.
 *
 * ┌─ THE SEAM ────────────────────────────────────────────────────────────────┐
 * │ `ModelProvider.complete(request) -> Completion` is the ONLY thing the     │
 * │ rest of Studio is allowed to know about a model vendor. Nothing in this   │
 * │ file imports a vendor SDK, names a vendor, or leaks a vendor's wire       │
 * │ shape. A second adapter is a NEW FILE next to `anthropic.ts` that         │
 * │ implements this interface — never an `if (vendor === ...)` inside the     │
 * │ Anthropic one.                                                            │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * ⛔ WHY THE ANTHROPIC ADAPTER STAYS PURE. `anthropic.ts` is written against
 * `@anthropic-ai/sdk` and nothing else — no branch for another vendor, no
 * lowest-common-denominator shim. The cost of that purity is that adapters
 * cannot share request-building code; the payoff is that each adapter can use
 * everything its own SDK offers (adaptive thinking, `output_config`, prompt
 * caching, typed errors) instead of the intersection of every vendor's API.
 * The intersection is what `CompletionRequest` below deliberately is, and it
 * is kept small on purpose: every field added here is a field every future
 * adapter must answer for.
 *
 * ⚠ THE SEAM IS PROVEN, NOT ASSERTED. `fake.ts` is an in-memory adapter whose
 * underlying engine has a flat, distinctly non-Anthropic shape (one prompt
 * string in, `{output, cut_off, tokens_in, tokens_out}` out). If a change to
 * this interface can only be satisfied by something Anthropic-shaped, that
 * file stops compiling — which is the point of it existing.
 */

/**
 * How hard the model should work. Maps to the vendor's own dial where one
 * exists (Anthropic: `output_config.effort`). This is the cheap/fast knob:
 * a caller lowers effort rather than reaching for a smaller model or, worse,
 * turning reasoning off.
 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly Effort[];

export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value);
}

export type MessageRole = "user" | "assistant";

/** Plain text only. Images, tool calls and vendor content blocks are out of scope here. */
export interface CompletionMessage {
  readonly role: MessageRole;
  readonly content: string;
}

/**
 * A JSON Schema the reply must satisfy. Every vendor worth adapting has some
 * form of this; the neutral shape is the schema itself and nothing else.
 */
export interface JsonSchemaFormat {
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface CompletionRequest {
  /**
   * Stable instructions. Adapters that support prompt caching cache THIS and
   * nothing after it, so callers should keep it byte-identical across calls
   * and put anything volatile (timestamps, ids, the actual question) in
   * `messages`.
   */
  readonly system?: string;
  readonly messages: readonly CompletionMessage[];
  /** Per-call override of the provider's configured model. */
  readonly model?: string;
  /** Per-call override of the provider's configured effort. */
  readonly effort?: Effort;
  readonly maxTokens?: number;
  /** Ask for a schema-constrained reply instead of free text. */
  readonly format?: JsonSchemaFormat;
  readonly signal?: AbortSignal;
}

/**
 * Why generation stopped, normalized. `max_tokens` is the one every caller
 * must handle: it means the reply is a fragment.
 */
export type StopReason = "end" | "max_tokens" | "refusal" | "tool_use" | "other";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Tokens served from a prompt cache. Zero across repeated identical prefixes means caching is not working. */
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface Completion {
  readonly text: string;
  /**
   * The provider hit its token ceiling and the text is a fragment.
   *
   * ⚠ A truncated reply must be REPORTED, never parsed. Half a JSON object is
   * not a smaller JSON object — see `readJson` in `structured.ts`, which
   * refuses a truncated completion without looking at the text at all.
   */
  readonly truncated: boolean;
  readonly stopReason: StopReason;
  /** What actually served the request, which may differ from what was asked for. */
  readonly model: string;
  readonly usage: TokenUsage;
}

/** The whole vendor surface, as far as the rest of Studio is concerned. */
export interface ModelProvider {
  /** Stable identifier for logs and errors, e.g. `"anthropic"`. */
  readonly name: string;
  complete(request: CompletionRequest): Promise<Completion>;
}
