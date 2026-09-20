/** `@harness` — Studio's model calls, made reproducible.
 *
 * ```ts
 * // A recording provider IS a `@providers` ModelProvider, so nothing
 * // downstream — including @spec's planner — knows the difference.
 * const provider = harnessProvider(
 *   resolveMode() === "live"
 *     ? { mode: "live", provider: new AnthropicProvider(), model: DEFAULT_MODEL, fixturesDir: FIXTURES }
 *     : { mode: "playback", model: DEFAULT_MODEL, fixturesDir: FIXTURES },
 * );
 * const outcome = await planFromPrompt({ prompt }, plannerLlm(provider));  // free, offline, deterministic
 *
 * // Under it, a harness over any request shape with a `model`.
 * const harness = createHarness<Req, Res>({ mode: "playback", fixturesDir: FIXTURES });
 *
 * // And because a recording is an artifact, not a cache: hold it fixed and
 * // change exactly one thing.
 * const { diff } = await replayVariant({
 *   fixturesDir: FIXTURES,
 *   baseline: judgeCall,
 *   variant: (base) => ({ ...base, model: "a-different-model" }),
 *   harness,
 * });
 * diff.verdict; // "input-changed" | "harness-changed" | "nondeterministic" | "identical"
 * ```
 *
 * Three properties hold this up, and each one is a failure this project has
 * already paid for:
 *
 * 1. **Content-addressed, never order-addressed.** A fixture is found by a
 *    stable hash of `(model, system, messages, tools, output_config)`. Adding a
 *    call in the middle of a suite costs one new recording, not a re-record of
 *    every later one.
 *
 * 2. **Playback cannot fall through to live.** A miss throws, with the key, the
 *    path it wanted and the nearest recordings; and a playback harness holds no
 *    provider to fall through to. A recorder that silently phones home turns a
 *    green suite into a claim nobody checked.
 *
 * 3. **A recorded run is a comparison artifact.** `diffFixtures` separates "the
 *    input changed" from "the harness changed" from "same input, different
 *    answer". The gauntlet returned 4/4 and then 1/4 on identical code because
 *    the third case was invisible; see `docs/HARNESS-NOTES.md`.
 *
 * Consequence worth stating out loud: **identical requests replay identically.**
 * Two calls with the same keyed fields share one recording, by design — so a
 * planner's draft and its repair round-trip are two recordings because their
 * prompts differ, not because the harness counts calls. When two calls must
 * answer differently, the difference has to be IN the request.
 */

export { canonicalDigest, canonicalStringify, CanonicalizeError } from "./canonical";

export { KEYED_FIELDS, KEY_LENGTH, differingFields, keyFieldsFor, keyOf, keyedView, requestKey } from "./keys";
export type { KeyingOptions } from "./keys";

export { REDACTED, collectEnvSecrets, redactString, redactValue, redactWithSecrets, resolveSecrets } from "./redact";
export type { RedactionOptions } from "./redact";

export {
  FIXTURE_FORMAT,
  FixtureFormatError,
  findFixtureByKey,
  fixturePath,
  listFixtures,
  modelSlug,
  parseFixture,
  readFixtureAt,
  tryReadFixtureAt,
  writeFixtureAt,
} from "./fixture";
export type { FixtureRecord, StoredFixture } from "./fixture";

export { HARNESS_MODE_ENV, HarnessCacheMiss, createHarness, resolveMode } from "./harness";
export type {
  CacheMissDetail,
  Harness,
  HarnessEvent,
  HarnessMode,
  HarnessOptions,
  LiveHarnessOptions,
  PlaybackHarnessOptions,
} from "./harness";

export { MissingBaseline, defaultProjection, diffFixtures, diffLines, diffRecorded, replayVariant } from "./compare";
export type {
  ComparisonVerdict,
  DiffOptions,
  DiffSide,
  FieldDelta,
  FixtureDiff,
  LineDiff,
  ReplayVariantInput,
  VariantComparison,
} from "./compare";

export { completionFromRecord, harnessProvider, toProviderCall } from "./providers-adapter";
export type {
  HarnessProvider,
  HarnessProviderCommon,
  HarnessProviderConfig,
  LiveHarnessProviderConfig,
  PlaybackHarnessProviderConfig,
  ProviderCall,
} from "./providers-adapter";

export type { HarnessCaller, ProviderCallShape, ProviderFn } from "./provider-contract";
