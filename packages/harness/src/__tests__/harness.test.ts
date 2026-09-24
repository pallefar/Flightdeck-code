/** The four claims this package makes, tested as claims rather than as prose:
 * a record/replay round trip, a miss that fails loudly instead of phoning home,
 * a reordered suite that still hits its fixtures, and a fixture with no
 * credential in it. */
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HARNESS_MODE_ENV, HarnessCacheMiss, createHarness, resolveMode } from "../harness";
import { listFixtures, modelSlug } from "../fixture";
import { explodingProvider, fakeProvider } from "../test-support";

interface TestRequest {
  readonly model: string;
  readonly system?: string;
  readonly messages: readonly { role: string; content: string }[];
  readonly tools?: readonly { name: string }[];
  readonly output_config?: Readonly<Record<string, unknown>>;
  /** Not one of the keyed five: must never reach a fixture. */
  readonly apiKey?: string;
}

interface TestResponse {
  readonly text: string;
  readonly usage?: { readonly inputTokens: number };
}

const FIXED_NOW = (): Date => new Date("2026-01-01T00:00:00.000Z");

/** Credential-shaped test data, assembled at runtime. The bytes that reach the
 * redactor are identical; the source holds nothing a secret scanner can flag,
 * and nothing anyone is tempted to add to an allowlist. */
const SECRET = (...parts: string[]): string => parts.join("");

function ask(content: string, model = "test-model-1"): TestRequest {
  return { model, system: "You are a test.", messages: [{ role: "user", content }] };
}

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flightdeck-harness-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("record once, replay forever", () => {
  it("records a live call and replays it with the provider gone", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>((request) => ({
      text: `answered: ${request.messages[0]?.content ?? ""}`,
      usage: { inputTokens: 11 },
    }));

    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      now: FIXED_NOW,
      env: {},
    });

    const live = await recorder.call(ask("what is the time"));
    expect(live).toEqual({ text: "answered: what is the time", usage: { inputTokens: 11 } });
    expect(fake.calls).toHaveLength(1);
    expect(recorder.events.map((event) => event.kind)).toEqual(["recorded"]);

    // A whole new harness, in the other mode, with no provider in scope at all.
    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    const replayed = await player.call(ask("what is the time"));

    expect(replayed).toEqual(live);
    expect(fake.calls).toHaveLength(1); // still one: playback made no call
    expect(player.events.map((event) => event.kind)).toEqual(["replayed"]);
  });

  it("writes one readable file per call, named by the request's key", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>(() => ({ text: "ok" }));
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      now: FIXED_NOW,
      env: {},
    });

    const request = ask("hello");
    await recorder.call(request);

    const stored = await listFixtures(dir);
    expect(stored).toHaveLength(1);
    const [only] = stored;
    expect(only?.path).toBe(join(dir, modelSlug("test-model-1"), `${recorder.keyFor(request)}.json`));
    expect(only?.record.keyedFields).toEqual(["messages", "model", "output_config", "system", "tools"]);
    expect(only?.record.recordedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(only?.record.request).toEqual({
      model: "test-model-1",
      system: "You are a test.",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(only?.record.response).toEqual({ text: "ok" });
  });

  it("re-recording an unchanged call rewrites the same bytes", async () => {
    // The two answers take different wall-clock time on purpose. With the clock
    // injected, how long the provider took is not allowed to leak into the
    // bytes: this used to flake whenever the two calls straddled a millisecond.
    let turn = 0;
    const options = {
      mode: "live",
      provider: async (): Promise<TestResponse> => {
        turn += 1;
        await delay(turn === 1 ? 0 : 15);
        return { text: "stable" };
      },
      fixturesDir: dir,
      now: FIXED_NOW,
      env: {},
    } as const;

    await createHarness<TestRequest, TestResponse>(options).call(ask("hello"));
    const first = await readFile((await listFixtures(dir))[0]?.path ?? "", "utf8");
    await createHarness<TestRequest, TestResponse>(options).call(ask("hello"));
    const second = await readFile((await listFixtures(dir))[0]?.path ?? "", "utf8");

    expect(second).toBe(first);
  });

  it("times the call on the injected clock, not the wall clock", async () => {
    // One clock for every recorded instant: a test that pins time pins the
    // duration too, so a recording is reproducible byte for byte.
    const ticks = ["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.250Z"];
    let tick = 0;
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: async (): Promise<TestResponse> => {
        await delay(15);
        return { text: "ok" };
      },
      fixturesDir: dir,
      now: () => new Date(ticks[Math.min((tick += 1) - 1, ticks.length - 1)] ?? ""),
      env: {},
    });
    await recorder.call(ask("hello"));

    const [only] = await listFixtures(dir);
    expect(only?.record.durationMs).toBe(250);
    expect(only?.record.recordedAt).toBe("2026-01-01T00:00:00.250Z");
    expect(recorder.events.map((event) => event.durationMs)).toEqual([250]);
  });

  it("records no duration, rather than a wrong one, when the injected clock cannot tell time", async () => {
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fakeProvider<TestRequest, TestResponse>(() => ({ text: "ok" })).provider,
      fixturesDir: dir,
      now: () => new Date("not a date"),
      env: {},
    });
    await recorder.call(ask("hello"));

    const [only] = await listFixtures(dir);
    expect(only?.record.durationMs).toBeNull();
    expect(only?.record.recordedAt).toBeNull();
  });

  it("leaves no temporary files behind", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>(() => ({ text: "ok" }));
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });
    await recorder.call(ask("hello"));

    const entries = await readdir(join(dir, modelSlug("test-model-1")));
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("says so when the answer arrives but cannot be recorded", async () => {
    // A live run whose recording silently fails is a paid call that will miss
    // in playback later, blamed on whoever runs the suite next.
    await writeFile(join(dir, "not-a-directory"), "", "utf8");
    const fake = fakeProvider<TestRequest, TestResponse>(() => ({ text: "ok" }));
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: join(dir, "not-a-directory", "fixtures"),
      env: {},
    });

    await expect(recorder.call(ask("hello"))).rejects.toThrow(/could not be written/);
    expect(fake.calls).toHaveLength(1);
    expect(recorder.events).toEqual([]);
  });

  it("with onExisting: keep, still answers live but does not overwrite the recording", async () => {
    let turn = 0;
    const fake = fakeProvider<TestRequest, TestResponse>(() => ({ text: `turn ${String((turn += 1))}` }));

    const first = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      now: FIXED_NOW,
      env: {},
    });
    await first.call(ask("hello"));

    const second = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      onExisting: "keep",
      now: FIXED_NOW,
      env: {},
    });
    expect(await second.call(ask("hello"))).toEqual({ text: "turn 2" });
    expect(second.events[0]?.kind).toBe("kept");

    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    expect(await player.call(ask("hello"))).toEqual({ text: "turn 1" });
  });
});

describe("a cache miss fails loudly", () => {
  it("throws HarnessCacheMiss naming the key, the path and the nearest recordings", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>(() => ({ text: "recorded" }));
    await createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    }).call(ask("the recorded question"));

    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    const missing = ask("a question nobody recorded");

    const error = await player.call(missing).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(HarnessCacheMiss);
    const miss = error as HarnessCacheMiss;
    expect(miss.key).toBe(player.keyFor(missing));
    expect(miss.path).toBe(player.pathFor(missing));
    expect(miss.message).toContain("playback never calls the provider");
    expect(miss.message).toContain(`${HARNESS_MODE_ENV}=live`);
    // The hint attributes the miss: same model and system, different messages.
    expect(miss.nearest).toHaveLength(1);
    expect(miss.nearest[0]?.differingFields).toEqual(["messages"]);
    expect(miss.message).toContain("differs in: messages");
  });

  it("does not fall through to the provider, and does not write anything", async () => {
    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    await expect(player.call(ask("nothing here"))).rejects.toBeInstanceOf(HarnessCacheMiss);

    expect(player.events).toEqual([]);
    expect(await listFixtures(dir)).toEqual([]);
  });

  it("holds no provider to fall through to — passing one does not compile", () => {
    // @ts-expect-error playback takes no provider: `provider?: never` is the wall.
    const player = createHarness<TestRequest, TestResponse>({
      mode: "playback",
      fixturesDir: dir,
      env: {},
      provider: explodingProvider<TestRequest, TestResponse>(),
    });
    expect(player.mode).toBe("playback");
  });

  it("reports a corrupt recording as corrupt, not as absent", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>(() => ({ text: "ok" }));
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });
    const request = ask("hello");
    await recorder.call(request);
    await writeFile(recorder.pathFor(request), "{ this is not json", "utf8");

    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    await expect(player.call(request)).rejects.toThrow(/not valid JSON/);
  });

  it("resolveMode defaults to playback and refuses a value it does not know", () => {
    expect(resolveMode({})).toBe("playback");
    expect(resolveMode({ [HARNESS_MODE_ENV]: "live" })).toBe("live");
    expect(resolveMode({ [HARNESS_MODE_ENV]: "record" })).toBe("live");
    expect(resolveMode({ [HARNESS_MODE_ENV]: "replay" })).toBe("playback");
    expect(() => resolveMode({ [HARNESS_MODE_ENV]: "liv" })).toThrow(/is not a mode/);
  });
});

describe("keyed on the request, never on call order", () => {
  it("replays in a different order, and an inserted call costs exactly one miss", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>((request) => ({
      text: `answer to ${request.messages[0]?.content ?? ""}`,
    }));
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      now: FIXED_NOW,
      env: {},
    });

    for (const question of ["first", "second", "third"]) await recorder.call(ask(question));

    const before = new Map<string, string>();
    for (const stored of await listFixtures(dir)) before.set(stored.path, await readFile(stored.path, "utf8"));
    expect(before.size).toBe(3);

    // Same three calls, shuffled, with a brand new call inserted in the middle.
    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    expect(await player.call(ask("third"))).toEqual({ text: "answer to third" });
    expect(await player.call(ask("first"))).toEqual({ text: "answer to first" });
    await expect(player.call(ask("inserted"))).rejects.toBeInstanceOf(HarnessCacheMiss);
    expect(await player.call(ask("second"))).toEqual({ text: "answer to second" });

    // Recording the new call leaves every earlier fixture byte-identical.
    const second = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      now: FIXED_NOW,
      env: {},
    });
    await second.call(ask("inserted"));

    expect(await listFixtures(dir)).toHaveLength(4);
    for (const [path, contents] of before) {
      expect(await readFile(path, "utf8")).toBe(contents);
    }
  });

  it("a request that differs only in key order hits the same fixture", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>(() => ({ text: "ok" }));
    await createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    }).call({
      model: "test-model-1",
      system: "s",
      messages: [{ role: "user", content: "hello" }],
      output_config: { format: "json", maxTokens: 10 },
    });

    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    const reordered: TestRequest = {
      output_config: { maxTokens: 10, format: "json" },
      messages: [{ role: "user", content: "hello" }],
      system: "s",
      model: "test-model-1",
    };
    expect(await player.call(reordered)).toEqual({ text: "ok" });
  });

  it("a different model is a different fixture, in its own directory", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>((request) => ({ text: `from ${request.model}` }));
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });
    await recorder.call(ask("same question", "test-model-1"));
    // ⚠ LOWERCASE, and that is not cosmetic. This said "Other/Model:2", and
    // `writeFixtureAt` now refuses a recording whose payload assesses as
    // tier 4 — which "Other Model" does, as `unverified-name-shaped-content`:
    // two capitalised words are exactly what a person's name looks like, and
    // the pseudonymiser cannot tell them apart without being told. The slug
    // escaping this case exists to test is unaffected by the case of the
    // letters, so the fixture uses a spelling that is not name-shaped rather
    // than the guard learning an exception.
    await recorder.call(ask("same question", "other/model:2"));

    expect((await readdir(dir)).sort()).toEqual(["other-model-2", "test-model-1"]);
    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    expect(await player.call(ask("same question", "other/model:2"))).toEqual({ text: "from other/model:2" });
  });

  it("keeps a model id from escaping the fixtures directory", async () => {
    const fake = fakeProvider<TestRequest, TestResponse>(() => ({ text: "ok" }));
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });
    await recorder.call(ask("hello", "../../etc/passwd"));

    const stored = await listFixtures(dir);
    expect(stored[0]?.path.startsWith(dir)).toBe(true);
    expect(stored[0]?.path).not.toContain("..");
    await expect(stat(dir)).resolves.toBeDefined();
  });
});

describe("credentials never reach a fixture", () => {
  it("scrubs keys from the request, the response and the environment", async () => {
    const apiKey = SECRET("sk-", "ant-", "api03-", "Zx9QpLmT4vR8wN2bK7jF6hC1sD0aG5eY3uI");
    const bearer = SECRET("eyJhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NSJ9.", "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    const envKey = "env-secret-value-9f83ba1c77";

    const fake = fakeProvider<TestRequest, TestResponse>(() => ({
      // A provider that echoes the credential back — the case redaction exists for.
      text: `accepted key ${apiKey} and token ${bearer}`,
    }));

    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      now: FIXED_NOW,
      env: { ANTHROPIC_API_KEY: envKey, HOME: "/home/nobody" },
    });

    const request: TestRequest = {
      model: "test-model-1",
      system: `Authenticate with Bearer ${bearer}`,
      messages: [
        { role: "user", content: `my key is ${apiKey}` },
        { role: "user", content: `and the env one is ${envKey}` },
      ],
      output_config: { api_key: apiKey, temperature: 0.2 },
      apiKey,
    };

    await recorder.call(request);

    const stored = await listFixtures(dir);
    expect(stored).toHaveLength(1);
    const raw = await readFile(stored[0]?.path ?? "", "utf8");

    for (const secret of [apiKey, bearer, envKey]) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).toContain("[redacted]");
    // The unkeyed `apiKey` field is not redacted — it never gets written at all.
    expect(raw).not.toContain("apiKey");
    // And the parts that are not credentials survive, or the recording is useless.
    expect(raw).toContain("my key is");
    expect(raw).toContain("temperature");
  });

  it("still replays after redaction, because the key is taken before it", async () => {
    const apiKey = SECRET("sk-", "ant-", "api03-", "Zx9QpLmT4vR8wN2bK7jF6hC1sD0aG5eY3uI");
    const other = SECRET("sk-", "ant-", "api03-", "DIFFERENTbutALSOaSecretVALUE12345678");

    // The answer names WHICH key was used without repeating the key itself, so
    // the two recordings stay distinguishable after redaction.
    const fake = fakeProvider<TestRequest, TestResponse>((request) => ({
      text: request.output_config?.["api_key"] === apiKey ? "answer for the first key" : "answer for the second key",
    }));
    const recorder = createHarness<TestRequest, TestResponse>({
      mode: "live",
      provider: fake.provider,
      fixturesDir: dir,
      env: {},
    });

    const base = ask("hello");
    await recorder.call({ ...base, output_config: { api_key: apiKey } });
    await recorder.call({ ...base, output_config: { api_key: other } });

    // Both fixtures store the SAME redacted request bytes — had the key been
    // hashed after redaction, these two calls would have collided on one file.
    const stored = await listFixtures(dir);
    expect(stored).toHaveLength(2);
    expect(JSON.stringify(stored[0]?.record.request)).toBe(JSON.stringify(stored[1]?.record.request));

    const player = createHarness<TestRequest, TestResponse>({ mode: "playback", fixturesDir: dir, env: {} });
    expect(await player.call({ ...base, output_config: { api_key: apiKey } })).toEqual({
      text: "answer for the first key",
    });
    expect(await player.call({ ...base, output_config: { api_key: other } })).toEqual({
      text: "answer for the second key",
    });
  });
});
