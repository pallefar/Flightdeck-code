/** Wrapping `@providers`.
 *
 * `ModelProvider.complete(request) -> Completion` is that package's whole
 * surface, so this file turns a harness into one of those — recording or
 * replaying — and everything downstream keeps talking to a `ModelProvider`:
 *
 *     const provider = harnessProvider(
 *       resolveMode() === "live"
 *         ? { mode: "live", provider: new AnthropicProvider(), model: DEFAULT_MODEL, fixturesDir: FIXTURES }
 *         : { mode: "playback", model: DEFAULT_MODEL, fixturesDir: FIXTURES },
 *     );
 *     const outcome = await planFromPrompt({ prompt }, plannerLlm(provider));  // @providers' bridge
 *
 * TYPES ONLY from the peer — erased at build, so this adds no runtime edge to a
 * package somebody else is still writing, and no vendor SDK is loaded to replay
 * a fixture.
 *
 * ⛔ WHY `model` IS REQUIRED HERE WHEN `CompletionRequest.model` IS OPTIONAL.
 * A request that omits the model is served by whatever the provider was
 * configured with — and the harness cannot see that configuration. Keying such
 * a call as "no model" would file two genuinely different recordings, made
 * against two different models, under one name. So the wrapper is told which
 * model stands behind it (`DEFAULT_MODEL`, or `resolveConfig(...).model`), and
 * a per-call `request.model` still wins. The completion's own `model` — what
 * actually served it — is recorded in the fixture, where an alias resolving to
 * something else shows up in a diff instead of hiding.
 *
 * ⚠ `signal` is not keyed and never recorded: an AbortSignal is not part of
 * what was asked, and it is not JSON. The live path still forwards the caller's
 * real request, signal and all — see the WeakMap below.
 */
import type { Completion, CompletionRequest, ModelProvider } from "../../providers/src/index";
import { createHarness } from "./harness";
import type { Harness } from "./harness";
import type { KeyingOptions } from "./keys";
import type { RedactionOptions } from "./redact";

/** A `CompletionRequest` in the five-field shape the key covers. */
export interface ProviderCall {
  readonly model: string;
  readonly system?: string;
  readonly messages: CompletionRequest["messages"];
  /** `effort`, `maxTokens` and `format` are what the reply is shaped by, so they
   * belong in the key — grouped here to land in the default keyed field. */
  readonly output_config: {
    readonly effort?: CompletionRequest["effort"];
    readonly maxTokens?: number;
    readonly format?: CompletionRequest["format"];
  };
}

export function toProviderCall(request: CompletionRequest, model: string): ProviderCall {
  return {
    model: request.model ?? model,
    ...(request.system === undefined ? {} : { system: request.system }),
    messages: request.messages,
    output_config: {
      ...(request.effort === undefined ? {} : { effort: request.effort }),
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
      ...(request.format === undefined ? {} : { format: request.format }),
    },
  };
}

/** Rebuild a `Completion` from stored JSON, checking it is one.
 *
 * ⛔ A hand-edited or truncated fixture must not replay as a completion with
 * `undefined` text and `truncated: undefined` — the planner reads `truncated`
 * to decide whether the text is parseable at all, so a missing field there is a
 * wrong answer, not a missing one. */
export function completionFromRecord(stored: unknown): Completion {
  if (typeof stored !== "object" || stored === null) {
    throw new TypeError("harness: recorded response is not a Completion object");
  }
  const { text, truncated, stopReason, model, usage } = stored as Record<string, unknown>;
  if (typeof text !== "string") throw new TypeError("harness: recorded completion has no `text`");
  if (typeof truncated !== "boolean") throw new TypeError("harness: recorded completion has no `truncated`");
  if (typeof stopReason !== "string") throw new TypeError("harness: recorded completion has no `stopReason`");
  if (typeof model !== "string") throw new TypeError("harness: recorded completion has no `model`");
  if (typeof usage !== "object" || usage === null) throw new TypeError("harness: recorded completion has no `usage`");
  return stored as unknown as Completion;
}

export interface HarnessProviderCommon extends KeyingOptions, RedactionOptions {
  readonly fixturesDir: string;
  /** The model behind a request that does not name one. Required — see the header. */
  readonly model: string;
  /** `ModelProvider.name`, for logs and errors. */
  readonly name?: string | undefined;
}

export interface LiveHarnessProviderConfig extends HarnessProviderCommon {
  readonly mode: "live";
  readonly provider: ModelProvider;
  readonly onExisting?: "overwrite" | "keep" | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface PlaybackHarnessProviderConfig extends HarnessProviderCommon {
  readonly mode: "playback";
  /** ⛔ Nothing to fall through to, enforced by the compiler. */
  readonly provider?: never;
}

export type HarnessProviderConfig = LiveHarnessProviderConfig | PlaybackHarnessProviderConfig;

export interface HarnessProvider extends ModelProvider {
  /** The recordings this provider made or replayed, for assertions. */
  readonly harness: Harness<ProviderCall, Completion>;
}

export function harnessProvider(config: HarnessProviderConfig): HarnessProvider {
  // The keyed call is what the harness hashes and stores; the ORIGINAL request
  // is what the vendor must receive, because it carries the abort signal the
  // key has no business knowing about. One entry per call, so two concurrent
  // calls cannot read each other's request.
  const originals = new WeakMap<ProviderCall, CompletionRequest>();

  const shared = {
    fixturesDir: config.fixturesDir,
    keyFields: config.keyFields,
    extraKeyedFields: config.extraKeyedFields,
    secrets: config.secrets,
    env: config.env,
    reviveResponse: completionFromRecord,
  } as const;

  const harness =
    config.mode === "live"
      ? createHarness<ProviderCall, Completion>({
          ...shared,
          mode: "live",
          onExisting: config.onExisting,
          now: config.now,
          provider: async (call) => {
            const original = originals.get(call);
            if (original === undefined) throw new Error("harness: lost the original request for a call");
            return await config.provider.complete(original);
          },
        })
      : createHarness<ProviderCall, Completion>({ ...shared, mode: "playback" });

  const name =
    config.name ?? (config.mode === "live" ? `harness(live:${config.provider.name})` : "harness(playback)");

  return {
    name,
    harness,
    async complete(request: CompletionRequest): Promise<Completion> {
      const call = toProviderCall(request, config.model);
      originals.set(call, request);
      return await harness.call(call);
    },
  };
}
