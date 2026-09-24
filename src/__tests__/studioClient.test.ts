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
  readonly redirect: RequestRedirect | undefined;
  readonly credentials: RequestCredentials | undefined;
  readonly cache: RequestCache | undefined;
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
      redirect: init?.redirect,
      credentials: init?.credentials,
      cache: init?.cache,
    };
    calls.push(call);
    return reply(call);
  };
  return { fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** The server's answer to connect's token check when the token is RIGHT:
 * past the bearer, the empty body fails the build schema (`server/index.ts`). */
const TOKEN_ACCEPTED = () => json(400, { error: "malformed request", at: ["prompt"] });

/** connect's token check: a build with an empty object for a body. */
const isTokenCheck = (call: Call) => call.url.endsWith("/api/studio/build") && call.body === "{}";

/** Health answers, the token check accepts; the build answers with `build`.
 * So a connect is TWO calls (probe, token check) and the first build is `calls[2]`. */
function server(build: (call: Call) => Response | Promise<Response>) {
  return stubFetch((call) =>
    call.url.endsWith("/api/studio/health") ? json(200, HEALTH) : isTokenCheck(call) ? TOKEN_ACCEPTED() : build(call),
  );
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
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("/api/studio/health");
    // The probe is unauthenticated on the server; sending the secret where it
    // is not needed only widens where it can leak.
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
    expect(client.getConnection()).toEqual({ status: "connected", health: HEALTH });
  });

  it("⭐ 'Connected' means the server ACCEPTED the token: connect checks it with a bodiless build", async () => {
    const { fetch, calls } = server(() => json(500, {}));
    const client = createStudioClient({ fetch });
    await client.connect(TOKEN);

    // The server checks the bearer before it parses the body, so `{}` is
    // answered 401 (wrong token) or 400 (right token) and spends no model call.
    const check = calls[1];
    expect(check?.method).toBe("POST");
    expect(check?.url).toBe("/api/studio/build");
    expect(check?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(check?.headers["content-type"]).toBe("application/json");
    expect(check?.body).toBe("{}");
    expect(check?.redirect).toBe("error");
    expect(check?.credentials).toBe("omit");
    expect(check?.cache).toBe("no-store");
  });

  it("⭐ a token the server refuses is 'token-rejected': not connected, not kept", async () => {
    const { fetch, calls } = stubFetch((call) =>
      call.url.endsWith("/api/studio/health") ? json(200, HEALTH) : json(401, { error: "operator token required" }),
    );
    const client = createStudioClient({ fetch });
    expect(await client.connect(TOKEN)).toEqual({ ok: false, reason: "token-rejected" });
    expect(client.getConnection().status).toBe("disconnected");
    expect(await client.build(PROMPT)).toEqual({ status: "not-connected" });
    expect(calls).toHaveLength(2);
  });

  it("a token check answered by something other than the build schema's 400 is a protocol-error", async () => {
    for (const reply of [
      () => json(200, { status: "invalid_draft", issues: [], attempts: 1 }),
      () => json(400, { error: "something else" }),
      () => new Response("Bad Request", { status: 400 }),
      () => json(404, {}),
    ]) {
      const { fetch } = stubFetch((call) => (call.url.endsWith("/api/studio/health") ? json(200, HEALTH) : reply()));
      const client = createStudioClient({ fetch });
      expect(await client.connect(TOKEN)).toEqual({ ok: false, reason: "protocol-error" });
      expect(client.getConnection().status).toBe("disconnected");
    }
  });

  it("a probe that fails sends no token at all", async () => {
    const { fetch, calls } = stubFetch(() => json(404, {}));
    const client = createStudioClient({ fetch });
    await client.connect(TOKEN);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
  });

  it("⭐ a disconnect while a connect is still waiting abandons it: the token is not kept", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetch, calls } = stubFetch(async (call) => {
      await gate;
      return call.url.endsWith("/api/studio/health") ? json(200, HEALTH) : TOKEN_ACCEPTED();
    });
    const client = createStudioClient({ fetch });
    const pending = client.connect(TOKEN);
    client.disconnect(); // what the dialog does when a person cancels mid-connect
    release();
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
    expect(client.getConnection().status).toBe("disconnected");
    expect(await client.build(PROMPT)).toEqual({ status: "not-connected" });
    // Abandoned before the probe answered: the token check never went out.
    expect(calls.filter((c) => c.headers["authorization"] !== undefined)).toHaveLength(0);
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

  it("⭐ a dev proxy with no server behind it is 'unreachable', not a protocol error", async () => {
    // Vite's proxy answers a refused upstream with an empty text/plain 500;
    // gateways answer 502/503/504. None of them is the Studio server talking.
    for (const reply of [
      () => new Response("", { status: 500, headers: { "content-type": "text/plain" } }),
      () => new Response("", { status: 502 }),
      () => new Response("<html>Service Unavailable</html>", { status: 503, headers: { "content-type": "text/html" } }),
      () => new Response("", { status: 504 }),
    ]) {
      const client = createStudioClient({ fetch: stubFetch(reply).fetch });
      expect(await client.connect(TOKEN)).toEqual({ ok: false, reason: "unreachable" });
      expect(client.getConnection().status).toBe("disconnected");
    }
  });

  it("a health reply that is not a health reply is a protocol error, not a connection", async () => {
    for (const reply of [
      () => new Response("<html>proxy error</html>", { status: 200 }),
      () => json(200, { ok: "yes" }),
      () => json(500, { error: "boom" }),
      () => json(404, HEALTH),
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
    expect(calls).toHaveLength(2);
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

    const build = calls[2];
    expect(build?.method).toBe("POST");
    expect(build?.url).toBe("/api/studio/build");
    expect(build?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(build?.headers["content-type"]).toBe("application/json");
    // The bearer is for the Studio server only: a redirect would hand it to
    // somebody else, and ambient cookies/caches have no business here.
    expect(build?.redirect).toBe("error");
    expect(build?.credentials).toBe("omit");
    expect(build?.cache).toBe("no-store");
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
    expect(JSON.parse(calls[2]?.body ?? "null")).toEqual({ prompt: PROMPT });
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
    expect(calls).toHaveLength(3);
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
    let n = 0;
    const { fetch } = stubFetch(() => {
      n += 1;
      if (n === 1) return json(200, HEALTH);
      if (n === 2) return TOKEN_ACCEPTED();
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

  it("⭐ connect against the real server: a wrong token is refused, the right one accepted — no model call either way", async () => {
    const llm = vi.fn(async () => ({ text: DRAFT }));
    const wrong = createStudioClient({ fetch: realServer(llm) });
    expect(await wrong.connect(`${TOKEN}-wrong`)).toEqual({ ok: false, reason: "token-rejected" });
    expect(wrong.getConnection().status).toBe("disconnected");
    expect(await wrong.build(PROMPT)).toEqual({ status: "not-connected" });

    const right = createStudioClient({ fetch: realServer(llm) });
    const result = await right.connect(TOKEN);
    expect(result.ok).toBe(true);
    expect(right.getConnection().status).toBe("connected");
    expect(llm).not.toHaveBeenCalled();
  });

  it("proposed — `files: []` is a protocol-error, and a field the server adds survives", async () => {
    const client = await connected(realServer(async () => ({ text: DRAFT })));
    const outcome = await client.build(PROMPT);
    if (outcome.status !== "proposed") throw new Error(`expected proposed, got ${outcome.status}`);
    const reply = JSON.parse(JSON.stringify(outcome)) as Record<string, unknown>;

    const noFiles = structuredClone(reply);
    (noFiles["generated"] as Record<string, unknown>)["files"] = [];
    expect(parseBuildReply(noFiles).status).toBe("protocol-error");

    const extended = { ...structuredClone(reply), specSha256: "ab".repeat(32) };
    const parsed = parseBuildReply(extended) as unknown as Record<string, unknown>;
    expect(parsed["status"]).toBe("proposed");
    expect(parsed["specSha256"]).toBe("ab".repeat(32));
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
