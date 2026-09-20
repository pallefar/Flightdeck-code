/** Wrapping the real `@providers` seam.
 *
 * This file imports that package at RUNTIME on purpose — its `FakeProvider` and
 * its `plannerLlm` bridge — because the claim being tested is that a harness
 * really is a `ModelProvider` that the rest of Studio can be handed. A
 * structural type assertion would only prove the shape compiles. The harness
 * itself stays independent of the peer: every other test here runs without it. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeProvider, fakeProvider } from "../../../providers/src/fake";
import { plannerLlm } from "../../../providers/src/planner-bridge";
import type { CompletionRequest, ModelProvider } from "../../../providers/src/types";
import { HarnessCacheMiss } from "../harness";
import { listFixtures } from "../fixture";
import { completionFromRecord, harnessProvider, toProviderCall } from "../providers-adapter";

const MODEL = "configured-model-1";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flightdeck-providers-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ask(content: string): CompletionRequest {
  return { system: "You plan sub-apps.", messages: [{ role: "user", content }] };
}

describe("a CompletionRequest in keyed shape", () => {
  it("names the configured model when the request does not, and keeps an override", () => {
    expect(toProviderCall(ask("hello"), MODEL).model).toBe(MODEL);
    expect(toProviderCall({ ...ask("hello"), model: "override-2" }, MODEL).model).toBe("override-2");
  });

  it("groups the reply-shaping options into output_config and drops the signal", () => {
    const call = toProviderCall(
      { ...ask("hello"), effort: "low", maxTokens: 512, format: { schema: { type: "object" } }, signal: AbortSignal.abort() },
      MODEL,
    );
    expect(call.output_config).toEqual({ effort: "low", maxTokens: 512, format: { schema: { type: "object" } } });
    expect(JSON.stringify(call)).not.toContain("signal");
  });

  it("refuses a recorded completion that is missing a field the planner reads", () => {
    expect(() => completionFromRecord({ text: "hi", stopReason: "end", model: "m", usage: {} })).toThrow(
      /no `truncated`/,
    );
    expect(() => completionFromRecord("just a string")).toThrow(/not a Completion/);
  });
});

describe("a harness IS a ModelProvider", () => {
  it("records a completion whole and replays it with the vendor gone", async () => {
    const inner = fakeProvider({ output: "a drafted spec", tokens_in: 120, tokens_out: 34 });
    const recorder = harnessProvider({ mode: "live", provider: inner, model: MODEL, fixturesDir: dir, env: {} });

    expect(recorder.name).toBe("harness(live:fake)");
    const live = await recorder.complete(ask("a clock for the wall"));
    expect(live).toEqual({
      text: "a drafted spec",
      truncated: false,
      stopReason: "end",
      model: MODEL,
      usage: { inputTokens: 120, outputTokens: 34, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });

    const player: ModelProvider = harnessProvider({ mode: "playback", model: MODEL, fixturesDir: dir, env: {} });
    expect(await player.complete(ask("a clock for the wall"))).toEqual(live);
    // Every field of the Completion survives, not just the text.
    expect(inner.calls).toHaveLength(1);
  });

  it("carries a truncated reply across, because the planner acts on that flag", async () => {
    const inner = fakeProvider({ output: '{"understanding": tru', cut_off: true });
    await harnessProvider({ mode: "live", provider: inner, model: MODEL, fixturesDir: dir, env: {} }).complete(
      ask("a clock"),
    );

    const replayed = await harnessProvider({
      mode: "playback",
      model: MODEL,
      fixturesDir: dir,
      env: {},
    }).complete(ask("a clock"));

    expect(replayed.truncated).toBe(true);
    expect(replayed.stopReason).toBe("max_tokens");
  });

  it("keys a per-call model override separately", async () => {
    const inner = new FakeProvider((_prompt, model) => ({ output: `served by ${model}` }));
    const recorder = harnessProvider({ mode: "live", provider: inner, model: MODEL, fixturesDir: dir, env: {} });

    await recorder.complete(ask("hello"));
    await recorder.complete({ ...ask("hello"), model: "override-2" });

    expect(await listFixtures(dir)).toHaveLength(2);
    const player = harnessProvider({ mode: "playback", model: MODEL, fixturesDir: dir, env: {} });
    expect((await player.complete(ask("hello"))).text).toBe(`served by ${MODEL}`);
    expect((await player.complete({ ...ask("hello"), model: "override-2" })).text).toBe("served by override-2");
  });

  it("ignores the abort signal when keying, and never writes one", async () => {
    const inner = fakeProvider("ok");
    const controller = new AbortController();
    await harnessProvider({ mode: "live", provider: inner, model: MODEL, fixturesDir: dir, env: {} }).complete({
      ...ask("hello"),
      signal: controller.signal,
    });

    // The vendor still received the caller's real request, signal and all.
    expect(inner.calls[0]?.request.signal).toBe(controller.signal);

    const raw = await readFile((await listFixtures(dir))[0]?.path ?? "", "utf8");
    expect(raw).not.toContain("signal");

    const player = harnessProvider({ mode: "playback", model: MODEL, fixturesDir: dir, env: {} });
    await expect(player.complete({ ...ask("hello"), signal: AbortSignal.abort() })).resolves.toMatchObject({
      text: "ok",
    });
  });

  it("misses loudly rather than reaching for the vendor", async () => {
    const player = harnessProvider({ mode: "playback", model: MODEL, fixturesDir: dir, env: {} });
    await expect(player.complete(ask("never recorded"))).rejects.toBeInstanceOf(HarnessCacheMiss);
  });

  it("takes no provider in playback — the compiler says so", () => {
    const player = harnessProvider({
      mode: "playback",
      model: MODEL,
      fixturesDir: dir,
      env: {},
      // @ts-expect-error a playback provider has nothing to fall through to.
      provider: fakeProvider("should never run"),
    });
    expect(player.name).toBe("harness(playback)");
  });
});

describe("composed with @providers' planner bridge", () => {
  const draft = { system: "You plan sub-apps.", user: "a clock for the wall", purpose: "draft", attempt: 1 } as const;
  const repair = {
    system: "You plan sub-apps.",
    user: "that draft was not valid JSON; here is what is wrong: ...",
    purpose: "repair",
    attempt: 2,
  } as const;

  it("records a draft-then-repair round trip and replays both", async () => {
    const inner = fakeProvider({ output: '{"understanding": tru', cut_off: true }, { output: '{"understanding":"ok"}' });
    const recorder = harnessProvider({ mode: "live", provider: inner, model: MODEL, fixturesDir: dir, env: {} });

    const recording = plannerLlm(recorder);
    expect(await recording(draft)).toEqual({ text: '{"understanding": tru', truncated: true });
    expect(await recording(repair)).toEqual({ text: '{"understanding":"ok"}', truncated: false });
    expect(await listFixtures(dir)).toHaveLength(2);

    // ⭐ Two calls, two recordings, replayed in the same order the planner asks
    // for them — and then in the opposite order, because the key is the request.
    const replaying = plannerLlm(harnessProvider({ mode: "playback", model: MODEL, fixturesDir: dir, env: {} }));
    expect(await replaying(repair)).toEqual({ text: '{"understanding":"ok"}', truncated: false });
    expect(await replaying(draft)).toEqual({ text: '{"understanding": tru', truncated: true });
    expect(inner.calls).toHaveLength(2);
  });

  it("keys the bridge's effort dial, so a cheaper repair is a different recording", async () => {
    const inner = new FakeProvider((_prompt, model) => ({ output: `served by ${model}` }));
    const recorder = harnessProvider({ mode: "live", provider: inner, model: MODEL, fixturesDir: dir, env: {} });

    await plannerLlm(recorder, { draftEffort: "high" })(draft);
    await plannerLlm(recorder, { draftEffort: "low" })(draft);

    expect(await listFixtures(dir)).toHaveLength(2);
    const player = harnessProvider({ mode: "playback", model: MODEL, fixturesDir: dir, env: {} });
    await expect(plannerLlm(player, { draftEffort: "high" })(draft)).resolves.toBeDefined();
    // The effort that was never recorded misses; it is not quietly served the other one.
    await expect(plannerLlm(player, { draftEffort: "max" })(draft)).rejects.toBeInstanceOf(HarnessCacheMiss);
  });
});
