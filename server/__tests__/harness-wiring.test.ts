/**
 * ⭐ THE RECORD/PLAYBACK HARNESS, REACHED FROM THE COMPOSITION ROOT.
 *
 * `packages/harness` was built and tested and nothing constructed it:
 * `server/index.ts` handed `new AnthropicProvider(...)` straight to the
 * planner, so `FLIGHTDECK_HARNESS_MODE` — documented in HANDOVER §3.2 — did
 * nothing at all. These tests pin the wiring:
 *
 *   unset / empty  → the real provider, directly. Today's behaviour, and no
 *                    prompt is written to disk.
 *   live | record  → the real provider, recorded into the fixtures dir.
 *   playback       → the fixtures dir only; a miss throws HarnessCacheMiss and
 *                    the real provider is never even constructed.
 *   anything else  → a boot problem, not a silent fallback.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HarnessCacheMiss, listFixtures } from "../../packages/harness/src/index";
import { createMemoryGrantStore } from "../../packages/approvals/src/store";
import { fakeProvider } from "../../packages/providers/src/fake";
import type { CompletionRequest, ModelProvider } from "../../packages/providers/src/types";
import {
  HARNESS_FIXTURES_DIR,
  STUDIO_ROOT,
  bootProblems,
  createServer,
  harnessModeFromEnv,
  modelProviderFromEnv,
} from "../index";

const TOKEN = "a-sufficiently-long-operator-token";
const OPERATOR = { actor: "Karsten Haldan", token: TOKEN };
const OK_ENV = { STUDIO_OPERATOR: "Karsten Haldan", STUDIO_OPERATOR_TOKEN: TOKEN };
const MODEL = "claude-opus-5";

const ask = (content: string): CompletionRequest => ({
  system: "You plan sub-apps.",
  messages: [{ role: "user", content }],
});

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "studio-harness-wiring-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

/** A live-provider factory that counts how often it was asked to build one. */
function countingLive(inner: ModelProvider = fakeProvider("a real answer")) {
  const built = { count: 0 };
  return { built, live: () => ((built.count += 1), inner) };
}

describe("FLIGHTDECK_HARNESS_MODE, as the server reads it", () => {
  it("⭐ unset or empty is OFF — the default stays today's behaviour", () => {
    expect(harnessModeFromEnv({})).toEqual({ mode: "off" });
    expect(harnessModeFromEnv({ FLIGHTDECK_HARNESS_MODE: "" })).toEqual({ mode: "off" });
    expect(harnessModeFromEnv({ FLIGHTDECK_HARNESS_MODE: "  " })).toEqual({ mode: "off" });
  });

  it("live/record and playback/replay are the harness's own spellings", () => {
    for (const value of ["live", "record", "LIVE"]) {
      expect(harnessModeFromEnv({ FLIGHTDECK_HARNESS_MODE: value }), value).toEqual({ mode: "live" });
    }
    for (const value of ["playback", "replay", "Playback"]) {
      expect(harnessModeFromEnv({ FLIGHTDECK_HARNESS_MODE: value }), value).toEqual({ mode: "playback" });
    }
  });

  it("⛔ a typo is a boot problem — `liv` must not quietly become anything", () => {
    const read = harnessModeFromEnv({ FLIGHTDECK_HARNESS_MODE: "liv" });
    expect(read).toHaveProperty("problem");
    expect(bootProblems({ ...OK_ENV, FLIGHTDECK_HARNESS_MODE: "liv" })).toEqual([
      (read as { problem: string }).problem,
    ]);
    expect(bootProblems({ ...OK_ENV, FLIGHTDECK_HARNESS_MODE: "playback" })).toEqual([]);
  });

  it("the committed fixtures dir lives in the Studio checkout, never under cwd", () => {
    expect(HARNESS_FIXTURES_DIR).toBe(path.join(STUDIO_ROOT, "fixtures", "harness"));
    expect(fs.existsSync(path.join(HARNESS_FIXTURES_DIR, "README.md"))).toBe(true);
  });
});

describe("the provider the planner is handed", () => {
  it("⭐ mode unset calls the real provider DIRECTLY, and records nothing", async () => {
    const inner = fakeProvider("a real answer");
    const { built, live } = countingLive(inner);
    const provider = modelProviderFromEnv({}, { live, fixturesDir: dir, model: MODEL });
    expect(provider).toBe(inner);
    expect((await provider.complete(ask("a clock"))).text).toBe("a real answer");
    expect(built.count).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });

  it("⭐ playback with an empty fixtures dir throws HarnessCacheMiss — and never builds the real provider", async () => {
    const { built, live } = countingLive();
    const provider = modelProviderFromEnv(
      { FLIGHTDECK_HARNESS_MODE: "playback" },
      { live, fixturesDir: dir, model: MODEL },
    );
    await expect(provider.complete(ask("a clock"))).rejects.toBeInstanceOf(HarnessCacheMiss);
    expect(built.count).toBe(0);
  });

  it("live records into the fixtures dir, and playback then replays it offline", async () => {
    const { live } = countingLive(fakeProvider("a recorded answer"));
    const recorder = modelProviderFromEnv({ FLIGHTDECK_HARNESS_MODE: "live" }, { live, fixturesDir: dir, model: MODEL });
    const recorded = await recorder.complete(ask("a clock"));
    expect(await listFixtures(dir)).toHaveLength(1);

    const { built, live: never } = countingLive();
    const player = modelProviderFromEnv(
      { FLIGHTDECK_HARNESS_MODE: "playback" },
      { live: never, fixturesDir: dir, model: MODEL },
    );
    expect(await player.complete(ask("a clock"))).toEqual(recorded);
    expect(built.count).toBe(0);
  });

  it("⛔ an unrecognised mode throws rather than picking one", () => {
    const { live } = countingLive();
    expect(() =>
      modelProviderFromEnv({ FLIGHTDECK_HARNESS_MODE: "liv" }, { live, fixturesDir: dir, model: MODEL }),
    ).toThrow(/FLIGHTDECK_HARNESS_MODE="liv" is not a mode/);
  });
});

describe("through the HTTP surface", () => {
  it("⭐ a build in playback with no recordings reports the cache miss, not a model answer", async () => {
    vi.stubEnv("FLIGHTDECK_HARNESS_MODE", "playback");
    const app = createServer({ operator: OPERATOR, store: createMemoryGrantStore(), harnessFixturesDir: dir });
    const res = await app.inject({
      method: "POST",
      url: "/api/studio/build",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: "Show contract folders needing review, visible to legal and admin." },
    });
    expect(res.statusCode).toBe(200);
    // The planner turns a failed model call into an issue; the miss must be
    // what it says, so an operator knows to record rather than to debug.
    expect(res.body).toContain("harness playback: no recording for this request");
    expect(await readdir(dir)).toEqual([]);
  });

  it("health says which harness mode the server runs in", async () => {
    vi.stubEnv("FLIGHTDECK_HARNESS_MODE", "playback");
    const app = createServer({ operator: OPERATOR, store: createMemoryGrantStore(), harnessFixturesDir: dir });
    const res = await app.inject({ method: "GET", url: "/api/studio/health" });
    expect((res.json() as Record<string, unknown>)["harnessMode"]).toBe("playback");
  });

  it("a typo'd mode refuses createServer, like a typo'd effort does", () => {
    vi.stubEnv("FLIGHTDECK_HARNESS_MODE", "liv");
    expect(() => createServer({ operator: OPERATOR, store: createMemoryGrantStore(), harnessFixturesDir: dir })).toThrow(
      /FLIGHTDECK_HARNESS_MODE="liv" is not a mode/,
    );
  });
});
