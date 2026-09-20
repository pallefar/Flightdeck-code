/** The comparison artifact, tested against the shape of the failure it exists
 * for: the gauntlet's identical code scoring 4/4 and then 1/4. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MissingBaseline, defaultProjection, diffFixtures, diffLines, diffRecorded, replayVariant } from "../compare";
import { FIXTURE_FORMAT } from "../fixture";
import type { FixtureRecord } from "../fixture";
import { HarnessCacheMiss, createHarness } from "../harness";
import { fakeProvider } from "../test-support";

interface JudgeCall {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly { role: string; content: string }[];
}

function record(patch: Partial<FixtureRecord>): FixtureRecord {
  return {
    format: FIXTURE_FORMAT,
    key: "k",
    model: "judge-1",
    keyedFields: ["messages", "model", "output_config", "system", "tools"],
    recordedAt: null,
    durationMs: null,
    request: { model: "judge-1", system: "judge neutrally", messages: [{ role: "user", content: "package A" }] },
    response: { text: "verdict: A" },
    ...patch,
  };
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flightdeck-compare-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("attributing a difference", () => {
  it("calls it identical when nothing moved", () => {
    const diff = diffFixtures(record({}), record({}));
    expect(diff.verdict).toBe("identical");
    expect(diff.identical).toBe(true);
    expect(diff.response.unified).toBe("");
  });

  it("calls it input-changed, and names the field, when the prompt moved", () => {
    const diff = diffFixtures(
      record({}),
      record({
        request: { model: "judge-1", system: "judge neutrally", messages: [{ role: "user", content: "package B" }] },
        response: { text: "verdict: B" },
      }),
    );
    expect(diff.verdict).toBe("input-changed");
    expect(diff.changedRequestFields).toEqual(["messages"]);
    expect(diff.requestDeltas[0]?.field).toBe("messages");
    expect(diff.summary).toContain("messages differ");
  });

  it("calls it input-changed when only the model moved", () => {
    const diff = diffFixtures(
      record({}),
      record({
        model: "judge-2",
        request: { model: "judge-2", system: "judge neutrally", messages: [{ role: "user", content: "package A" }] },
        response: { text: "verdict: B" },
      }),
    );
    expect(diff.verdict).toBe("input-changed");
    expect(diff.changedRequestFields).toEqual(["model"]);
  });

  it("⭐ calls it nondeterministic when the keyed request is byte-identical and the answer is not", () => {
    // This is the gauntlet: same code, same question, 4/4 then 1/4. A result
    // that reads as a measurement of the work is a measurement of nothing.
    const diff = diffFixtures(record({ response: { text: "4/4 ours" } }), record({ response: { text: "1/4 ours" } }));
    expect(diff.verdict).toBe("nondeterministic");
    expect(diff.changedRequestFields).toEqual([]);
    expect(diff.summary).toContain("the difference is not in the input");
    expect(diff.response.unified).toContain("-4/4 ours");
    expect(diff.response.unified).toContain("+1/4 ours");
  });

  it("⭐ calls it harness-changed when the two sides were keyed on different fields", () => {
    // Two recorders that disagree about what a call IS cannot be compared: a
    // field one of them ignored may be the entire reason the answers differ.
    const diff = diffFixtures(
      record({}),
      record({ keyedFields: ["messages", "model", "system"], response: { text: "verdict: B" } }),
    );
    expect(diff.verdict).toBe("harness-changed");
    expect(diff.harnessDrift[0]).toContain("keyed fields");
    expect(diff.summary).toContain("not comparable");
  });

  it("ignores key order inside a request, which is not a difference", () => {
    const diff = diffFixtures(
      record({ request: { model: "judge-1", system: "s", messages: [] } }),
      record({ request: { messages: [], system: "s", model: "judge-1" } }),
    );
    expect(diff.verdict).toBe("identical");
  });
});

describe("the diff a human reads", () => {
  it("marks removals and additions and keeps context", () => {
    const diff = diffLines("alpha\nbeta\ngamma", "alpha\nBETA\ngamma");
    expect(diff.identical).toBe(false);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.unified.split("\n")).toEqual([" alpha", "-beta", "+BETA", " gamma"]);
  });

  it("elides long unchanged runs instead of printing a novel", () => {
    const base = Array.from({ length: 40 }, (_, i) => `line ${String(i)}`);
    const changed = [...base];
    changed[20] = "line twenty, rewritten";
    const diff = diffLines(base.join("\n"), changed.join("\n"));
    expect(diff.unified).toContain("@@ 17 unchanged lines @@");
    expect(diff.unified).toContain("-line 20");
    expect(diff.unified).toContain("+line twenty, rewritten");
    expect(diff.unified.split("\n").length).toBeLessThan(base.length);
  });

  it("projects a provider response to its text, and anything else canonically", () => {
    expect(defaultProjection({ text: "hello", usage: { tokens: 3 } })).toBe("hello");
    expect(defaultProjection("bare")).toBe("bare");
    expect(defaultProjection({ b: 1, a: 2 })).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });
});

describe("replaying a fixture against a different prompt or model", () => {
  const baseline: JudgeCall = {
    model: "judge-1",
    system: "judge neutrally",
    messages: [{ role: "user", content: "which package is better?" }],
  };

  async function recordBaseline(text: string): Promise<void> {
    const fake = fakeProvider<JudgeCall, { text: string }>(() => ({ text }));
    await createHarness<JudgeCall, { text: string }>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    }).call(baseline);
  }

  it("holds the recording fixed, changes the model, and attributes the difference", async () => {
    await recordBaseline("A, narrowly");

    const fake = fakeProvider<JudgeCall, { text: string }>((request) =>
      request.model === "judge-2" ? { text: "B, clearly" } : { text: "A, narrowly" },
    );
    const harness = createHarness<JudgeCall, { text: string }>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });

    const comparison = await replayVariant<JudgeCall, { text: string }>({
      fixturesDir: dir,
      baseline,
      variant: (base) => ({ ...base, model: "judge-2" }),
      harness,
    });

    expect(comparison.diff.verdict).toBe("input-changed");
    expect(comparison.diff.changedRequestFields).toEqual(["model"]);
    expect(comparison.variantResponse).toEqual({ text: "B, clearly" });
    expect(comparison.diff.response.unified).toContain("+B, clearly");
    // The comparison is itself now a recording: both sides can be replayed.
    const replayed = await diffRecorded(dir, comparison.diff.a.key, comparison.diff.b.key);
    expect(replayed.verdict).toBe("input-changed");
  });

  it("holds the model fixed and changes the prompt", async () => {
    await recordBaseline("A, narrowly");
    const fake = fakeProvider<JudgeCall, { text: string }>(() => ({ text: "A, narrowly" }));
    const harness = createHarness<JudgeCall, { text: string }>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });

    const comparison = await replayVariant<JudgeCall, { text: string }>({
      fixturesDir: dir,
      baseline,
      variant: (base) => ({ ...base, system: "steelman the mature side first" }),
      harness,
    });

    expect(comparison.diff.changedRequestFields).toEqual(["system"]);
    expect(comparison.diff.response.identical).toBe(true);
    expect(comparison.diff.verdict).toBe("input-changed");
  });

  it("refuses to compare against a baseline nobody recorded", async () => {
    const fake = fakeProvider<JudgeCall, { text: string }>(() => ({ text: "x" }));
    const harness = createHarness<JudgeCall, { text: string }>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });

    await expect(
      replayVariant<JudgeCall, { text: string }>({
        fixturesDir: dir,
        baseline,
        variant: (base) => ({ ...base, model: "judge-2" }),
        harness,
      }),
    ).rejects.toBeInstanceOf(MissingBaseline);
    // Nothing ran: a comparison with one unrepeatable side is not a comparison.
    expect(fake.calls).toEqual([]);
  });

  it("through a playback harness, requires the variant to be recorded too", async () => {
    await recordBaseline("A, narrowly");
    const harness = createHarness<JudgeCall, { text: string }>({ mode: "playback", fixturesDir: dir, env: {} });

    await expect(
      replayVariant<JudgeCall, { text: string }>({
        fixturesDir: dir,
        baseline,
        variant: (base) => ({ ...base, model: "judge-2" }),
        harness,
      }),
    ).rejects.toBeInstanceOf(HarnessCacheMiss);
  });

  it("detects the same answer to a changed question — the bar was too easy", async () => {
    await recordBaseline("ours wins");
    const fake = fakeProvider<JudgeCall, { text: string }>(() => ({ text: "ours wins" }));
    const harness = createHarness<JudgeCall, { text: string }>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });

    const comparison = await replayVariant<JudgeCall, { text: string }>({
      fixturesDir: dir,
      baseline,
      variant: (base) => ({ ...base, messages: [{ role: "user", content: "which package is worse?" }] }),
      harness,
    });

    expect(comparison.diff.changedRequestFields).toEqual(["messages"]);
    expect(comparison.diff.response.identical).toBe(true);
    expect(comparison.diff.summary).toContain("identical output");
  });
});
