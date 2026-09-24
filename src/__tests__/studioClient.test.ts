/** The workbench's client for the Studio server — the first code in `src/`
 * that calls `fetch`.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────
 * - The operator token goes out ONLY as `Authorization: Bearer` on the build
 *   call, never on the unauthenticated health probe, never into storage and
 *   never into a log line.
 * - Every reply is parsed, not trusted: a body the schema does not know is a
 *   `protocol-error` outcome, never an exception and never a half-typed
 *   object handed to the workbench.
 * - A 401 drops the connection (the token is forgotten); a 429 is an answer
 *   with a `retryAfter`, and keeps the connection.
 * - The schema is checked against REAL server replies, not only fixtures:
 *   `createServer` is driven through `fastify.inject()` behind a `fetch`
 *   adapter, so a drift between `BuildOutcome` and the client's parser fails
 *   here rather than in a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryGrantStore } from "../../packages/approvals/src/store";
import type { BuildOutcome } from "../../packages/pipeline/src/build-subapp";
import { EXAMPLE_DRAFT_JSON } from "../../packages/spec/src/prompt";
import { createServer } from "../../server/index";
import { createStudioClient, parseBuildReply, type StudioFetch } from "../api/studioClient";

const TOKEN = "a-sufficiently-long-operator-token";
const OPERATOR = { actor: "Karsten Haldan", token: TOKEN };
const PROMPT = "Show contract folders needing review, visible to legal and admin.";

/** The server test's grounded draft: every claim quotable from PROMPT. */
const DRAFT = (() => {
  const base = JSON.parse(EXAMPLE_DRAFT_JSON) as Record<string, unknown>;
  const spec = base["spec"] as Record<string, unknown>;
  spec["visibleToRoles"] = { roles: ["legal", "admin"], evidence: "visible to legal and admin" };
  spec["capabilities"] = [{ capability: "read:contracts", evidence: "contract folders needing review" }];
  base["understanding"] = "Show contract folders needing review, for legal and admin.";
  return JSON.stringify(base);
})();

const HEALTH = { ok: true, model: "claude-opus-5", modelKeyConfigured: false, harnessMode: "playback" };

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/** A `fetch` that records every call and answers from `reply`. */
function stubFetch(reply: (call: Call) => Response | Promise<Response>): { fetch: StudioFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: StudioFetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return reply(call);
  };
  return { fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Health answers; the build answers with `build`. */
function server(build: (call: Call) => Response | Promise<Response>) {
  return stubFetch((call) => (call.url.endsWith("/api/studio/health") ? json(200, HEALTH) : build(call)));
}

/** The REAL server behind a `fetch`: routing, auth, body parse and the
 * serialiser all run, with an injected model and an in-memory grant store. */
function realServer(llm: () => Promise<{ text: string }>): StudioFetch {
  const app = createServer({ operator: OPERATOR, llm, store: createMemoryGrantStore({ rows: [] }) });
  return async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const res = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST",
      url: String(input),
      headers,
      ...(typeof init?.body === "string" ? { payload: init.body } : {}),
    });
    const out = new Headers();
    for (const [key, value] of Object.entries(res.headers)) {
      if (value !== undefined) out.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    return new Response(res.body, { status: res.statusCode, headers: out });
  };
}

async function connected(fetch: StudioFetch) {
  const client = createStudioClient({ fetch });
  const result = await client.connect(TOKEN);
  expect(result.ok).toBe(true);
  return client;
}

describe("connect: the health probe, and a token held in memory only", () => {
  it("⭐ probes GET /api/studio/health WITHOUT the token, and reports what the server said", async () => {
    const { fetch, calls } = server(() => json(500, {}));
    const client = createStudioClient({ fetch });
    expect(client.getConnection().status).toBe("disconnected");

    const result = await client.connect(TOKEN);

    expect(result).toEqual({ ok: true, health: HEALTH });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("/api/studio/health");
    // The probe is unauthenticated on the server; sending the secret where it
    // is not needed only widens where it can leak.
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    expect(client.getConnection()).toEqual({ status: "connected", health: HEALTH });
  });

  it("the connection state never carries the token", async () => {
    const client = await connected(server(() => json(500, {})).fetch);
    expect(JSON.stringify(client.getConnection())).not.toContain(TOKEN);
  });

  it("a blank token is refused without a request", async () => {
    const { fetch, calls } = server(() => json(500, {}));
    const client = createStudioClient({ fetch });
    expect(await client.connect("   ")).toEqual({ ok: false, reason: "empty-token" });
    expect(calls).toHaveLength(0);
  });

  it("an unreachable server leaves it disconnected — and the token is not kept for later", async () => {
    const { fetch, calls } = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = createStudioClient({ fetch });
    expect(await client.connect(TOKEN)).toEqual({ ok: false, reason: "unreachable" });
    expect(client.getConnection().status).toBe("disconnected");
    // A later build does not quietly use a token from a failed connect.
    expect(await client.build(PROMPT)).toEqual({ status: "not-connected" });
    expect(calls).toHaveLength(1);
  });

  it("a health reply that is not a health reply is a protocol error, not a connection", async () => {
    for (const reply of [
      () => new Response("<html>proxy error</html>", { status: 200 }),
      () => json(200, { ok: "yes" }),
      () => json(503, HEALTH),
    ]) {
      const client = createStudioClient({ fetch: stubFetch(reply).fetch });
      expect(await client.connect(TOKEN)).toEqual({ ok: false, reason: "protocol-error" });
      expect(client.getConnection().status).toBe("disconnected");
    }
  });

  it("disconnect forgets the token: the next build sends nothing", async () => {
    const { fetch, calls } = server(() => json(500, {}));
    const client = await connected(fetch);
    client.disconnect();
    expect(client.getConnection()).toEqual({ status: "disconnected", reason: "signed-out" });
    expect(await client.build(PROMPT)).toEqual({ status: "not-connected" });
    expect(calls).toHaveLength(1);
  });

  it("subscribers hear every change of connection", async () => {
    const client = createStudioClient({ fetch: server(() => json(401, { error: "operator token required" })).fetch });
    const seen: string[] = [];
    const stop = client.subscribe(() => seen.push(client.getConnection().status));
    await client.connect(TOKEN);
    await client.build(PROMPT);
    stop();
    await client.connect(TOKEN);
    expect(seen).toEqual(["connected", "disconnected"]);
  });
});

describe("build: the bearer, and every reply parsed", () => {
  it("⭐ sends POST /api/studio/build with `Authorization: Bearer <token>` and only prompt/answers", async () => {
    const { fetch, calls } = server(() => json(200, { status: "invalid_draft", issues: [], attempts: 1 }));
    const client = await connected(fetch);

    await client.build(PROMPT, { answers: { "consent:read:contracts": "yes" } });

    const build = calls[1];
    expect(build?.method).toBe("POST");
    expect(build?.url).toBe("/api/studio/build");
    expect(build?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(build?.headers["content-type"]).toBe("application/json");
    // The server's body schema is `.strict()`: anything else is a 400.
    expect(JSON.parse(build?.body ?? "null")).toEqual({
      prompt: PROMPT,
      answers: { "consent:read:contracts": "yes" },
    });
  });

  it("omits `answers` when there are none", async () => {
    const { fetch, calls } = server(() => json(200, { status: "invalid_draft", issues: [], attempts: 1 }));
    const client = await connected(fetch);
    await client.build(PROMPT);
    expect(JSON.parse(calls[1]?.body ?? "null")).toEqual({ prompt: PROMPT });
  });

  it("refuses to send while disconnected — no request, no token", async () => {
    const { fetch, calls } = server(() => json(200, {}));
    const client = createStudioClient({ fetch });
    expect(await client.build(PROMPT)).toEqual({ status: "not-connected" });
    expect(calls).toHaveLength(0);
  });

  it("⭐ 401 moves the connection to disconnected and forgets the token", async () => {
    const { fetch, calls } = server(() => json(401, { error: "operator token required" }));
    const client = await connected(fetch);

    expect(await client.build(PROMPT)).toEqual({ status: "unauthorized" });
    expect(client.getConnection()).toEqual({ status: "disconnected", reason: "token-rejected" });
    expect(await client.build(PROMPT)).toEqual({ status: "not-connected" });
    expect(calls).toHaveLength(2);
  });

  it("⭐ 429 is 'rate-limited' with the server's Retry-After, and keeps the connection", async () => {
    const limited = await connected(server(() => json(429, { error: "busy" }, { "retry-after": "30" })).fetch);
    expect(await limited.build(PROMPT)).toEqual({ status: "rate-limited", retryAfter: 30 });
    expect(limited.getConnection().status).toBe("connected");

    // No header, or one that is an HTTP date rather than seconds: say "unknown"
    // rather than invent a number.
    for (const headers of [{}, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }]) {
      const client = await connected(server(() => json(429, {}, headers)).fetch);
      expect(await client.build(PROMPT)).toEqual({ status: "rate-limited", retryAfter: null });
    }
  });

  it("⭐ a malformed reply is a protocol-error and never throws", async () => {
    const replies: Array<() => Response> = [
      () => new Response("not json", { status: 200 }),
      () => json(200, { status: "proposed" }),
      () => json(200, { status: "shipped-to-production" }),
      () => json(200, { status: "needs_input", questions: "what?", understanding: "" }),
      () => json(200, null),
      () => json(500, { error: "boom" }),
      () => json(400, { error: "malformed request", at: ["prompt"] }),
    ];
    for (const reply of replies) {
      const client = await connected(server(reply).fetch);
      const outcome = await client.build(PROMPT);
      expect(outcome.status).toBe("protocol-error");
      expect(client.getConnection().status).toBe("connected");
    }
  });

  it("a network failure mid-build is a protocol-error too, not an exception", async () => {
    let first = true;
    const { fetch } = stubFetch(() => {
      if (first) {
        first = false;
        return json(200, HEALTH);
      }
      throw new TypeError("fetch failed");
    });
    const client = await connected(fetch);
    await expect(client.build(PROMPT)).resolves.toEqual({ status: "protocol-error", cause: "network", httpStatus: null });
  });
});

describe("⭐ the parser against the REAL server's replies", () => {
  it("proposed", async () => {
    const client = await connected(realServer(async () => ({ text: DRAFT })));
    const outcome = await client.build(PROMPT);
    expect(outcome.status).toBe("proposed");
    if (outcome.status !== "proposed") return;
    expect(outcome.generated.files.map((f) => f.path)).toContain("server/subapps/works-council-gaps/manifest.ts");
    expect(typeof outcome.conformance.ok).toBe("boolean");
  });

  it("needs_input — questions the chat can ask back", async () => {
    const client = await connected(realServer(async () => ({ text: DRAFT })));
    const outcome = await client.build("an app");
    expect(outcome.status).toBe("needs_input");
    if (outcome.status !== "needs_input") return;
    expect(outcome.questions.length).toBeGreaterThan(0);
  });

  it("model-request-refused — the guardrails' answer, with its decision", async () => {
    const client = await connected(realServer(async () => ({ text: DRAFT })));
    const outcome = await client.build("Track sick leave and union membership for the team.");
    expect(outcome.status).toBe("model-request-refused");
    if (outcome.status !== "model-request-refused") return;
    expect(outcome.decision.tier).toBe(4);
  });

  it("invalid_draft — a model that answered nonsense", async () => {
    const client = await connected(realServer(async () => ({ text: "not a draft" })));
    const outcome = await client.build(PROMPT);
    expect(outcome.status).toBe("invalid_draft");
  });

  it("401 — the real server's refusal of a wrong token disconnects", async () => {
    const client = createStudioClient({ fetch: realServer(async () => ({ text: DRAFT })) });
    expect((await client.connect(`${TOKEN}-wrong`)).ok).toBe(true);
    expect(await client.build(PROMPT)).toEqual({ status: "unauthorized" });
    expect(client.getConnection()).toEqual({ status: "disconnected", reason: "token-rejected" });
  });

  it("grant-refused — the intake grant's answer, replayed byte for byte", async () => {
    const app = createServer({ operator: OPERATOR, llm: async () => ({ text: DRAFT }), store: createMemoryGrantStore({ rows: [] }) });
    const res = await app.inject({
      method: "POST",
      url: "/api/studio/build",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: PROMPT, projectId: "rhineland", datasource: { kind: "repo-path", id: "contracts", scope: "input" } },
    });
    const outcome = parseBuildReply(res.json());
    expect(outcome.status).toBe("grant-refused");
    if (outcome.status !== "grant-refused") return;
    expect(outcome.decision.allowed).toBe(false);
  });

  it("the other refusals, typed against the server's own BuildOutcome", async () => {
    // Real decisions where the variant carries one, so the shape is the
    // guardrails' own, not a hand-written approximation of it.
    const refused = (await (
      await realServer(async () => ({ text: DRAFT }))("/api/studio/build", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ prompt: "Track sick leave and union membership for the team." }),
      })
    ).json()) as BuildOutcome;
    if (refused.status !== "model-request-refused") throw new Error(`expected a refusal, got ${refused.status}`);
    const samples: BuildOutcome[] = [
      { status: "blocked", rule: "no-statutory-automation", explanation: "e", evidence: "close the hearing" },
      { status: "translation-refused", refusals: [{ at: "routes[0].kind", needs: "an approved template" }] },
      { status: "generation-refused", issues: ["no routes"] },
      { status: "artifacts-refused", decision: refused.decision },
    ];
    for (const sample of samples) {
      expect(parseBuildReply(JSON.parse(JSON.stringify(sample))).status).toBe(sample.status);
    }
  });
});

describe("⛔ the token never reaches storage or a log", () => {
  const storage = () => ({
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
  let local: ReturnType<typeof storage>;
  let session: ReturnType<typeof storage>;
  let idb: { open: ReturnType<typeof vi.fn>; deleteDatabase: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    local = storage();
    session = storage();
    idb = { open: vi.fn(), deleteDatabase: vi.fn() };
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("indexedDB", idb);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("⭐ connect, build, 401, reconnect, 429 and disconnect write nothing and log nothing", async () => {
    const logs = (["log", "info", "warn", "error", "debug", "trace"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    let n = 0;
    const replies = [
      () => json(200, { status: "invalid_draft", issues: [], attempts: 1 }),
      () => json(401, { error: "operator token required" }),
      () => json(429, {}, { "retry-after": "5" }),
      () => new Response("garbage", { status: 200 }),
    ];
    const { fetch } = server(() => (replies[n++] ?? replies[0]!)());
    const client = createStudioClient({ fetch });

    await client.connect(TOKEN);
    await client.build(PROMPT);
    await client.build(PROMPT); // 401
    await client.connect(TOKEN);
    await client.build(PROMPT); // 429
    await client.build(PROMPT); // malformed
    client.disconnect();

    for (const store of [local, session]) {
      expect(store.setItem).not.toHaveBeenCalled();
      expect(store.getItem).not.toHaveBeenCalled();
    }
    expect(idb.open).not.toHaveBeenCalled();
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it("no outcome the workbench is handed carries the token", async () => {
    const replies = [
      () => json(401, { error: `operator token required ${TOKEN}` }),
      () => json(500, { echo: TOKEN }),
      () => json(429, { echo: TOKEN }),
    ];
    for (const reply of replies) {
      const client = await connected(server(reply).fetch);
      expect(JSON.stringify(await client.build(PROMPT))).not.toContain(TOKEN);
    }
  });
});
