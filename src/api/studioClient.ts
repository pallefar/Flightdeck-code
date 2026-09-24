/** The workbench's client for the Studio server — the first thing in `src/`
 * that calls `fetch`.
 *
 * ── THE TOKEN: ONE PLACE, IN MEMORY, FOR THIS TAB ───────────────────
 * The server's build route wants `Authorization: Bearer <STUDIO_OPERATOR_TOKEN>`
 * (`server/index.ts`, "single-operator authentication"). The token a person
 * pastes into the Connect dialog is held in ONE closure variable below and
 * nowhere else: not in `localStorage`, `sessionStorage` or IndexedDB, not in
 * the connection state a component can read, not in an outcome, not in a log
 * line. A reload forgets it, which is the point — a secret that outlives the
 * tab is one more place it can be read from. `studioClient.test.ts` spies on
 * all three stores and on `console` to hold that.
 *
 * It is sent on one route only, the build — as the build itself, and once
 * when connecting, as the token check below. The health probe is
 * unauthenticated on the server, so it goes without it.
 *
 * ── WHAT "CONNECTED" MEANS: THE SERVER ACCEPTED THIS TOKEN ─────────
 * The probe says a Studio server is there; it cannot say the token is right.
 * So connect then sends `POST /api/studio/build` with `{}` for a body and the
 * candidate bearer. The server checks the bearer BEFORE it parses the body
 * (`server/index.ts`), so a wrong token is answered 401 and a right one 400
 * "malformed request" — and neither spends a model call. Only that 400 is
 * `connected`; a 401 is `token-rejected` and nothing is kept.
 *
 * ── EVERY REPLY IS PARSED, NOT TRUSTED ──────────────────────────────
 * A reply is checked against the server's `BuildOutcome` union (plus the
 * route's own `grant-refused`) with Zod before the workbench sees it. What
 * does not parse — a proxy's HTML error page, a status this client has never
 * heard of, a `proposed` with no files — is a `protocol-error` OUTCOME. This
 * never throws: a caller that has to remember a try/catch around every build
 * is a caller that will one day forget it.
 *
 * Objects pass unknown keys through rather than stripping them, so a field the
 * server adds (the translated spec and its sha256 on `proposed`) reaches the
 * caller without this file changing first.
 *
 * ── WHAT A STATUS CODE MEANS HERE ───────────────────────────────────
 * 401 — the server refused the token. It is forgotten and the connection
 *       drops to `disconnected` (`token-rejected`): holding a secret the
 *       server has just said is wrong helps nobody.
 * 429 — an ANSWER, not a failure: `rate-limited` with the server's
 *       `Retry-After` in seconds, or `null` when it gave none it could count.
 *       The connection stays.
 * anything else that is not 200 — `protocol-error`, with the status.
 *
 * On connect, a 502/503/504 or a 500 that is not JSON is `unreachable`: that is
 * a gateway — in development, Vite's proxy with no Studio server behind it —
 * answering for a server that is not there, not the server saying something.
 */
import { z } from "zod";

/** `fetch`'s shape, narrowed to what this client passes. Injected so the
 * tests can stand the real server (or a stub) behind it. */
export type StudioFetch = (input: string, init?: RequestInit) => Promise<Response>;

// ── The health probe ────────────────────────────────────────────────

const healthSchema = z
  .object({
    ok: z.literal(true),
    model: z.string(),
    modelKeyConfigured: z.boolean(),
    /** `playback` answers from fixtures, not the model; `injected` is a test
     * double; `null` when the env names no mode it can read. */
    harnessMode: z.string().nullable(),
  })
  .passthrough();

export type StudioHealth = z.infer<typeof healthSchema>;

// ── The build reply: `BuildOutcome` plus the route's `grant-refused` ─

/** `@conformance`'s `Finding`. */
const conformanceFinding = z
  .object({
    rule: z.string(),
    severity: z.string(),
    file: z.string(),
    line: z.number(),
    column: z.number(),
    message: z.string(),
    evidence: z.string().nullable(),
  })
  .passthrough();

/** `@guardrails`' `GateDecision` — and `ModelRequestDecision`, which extends it. */
const gateDecision = z
  .object({
    gate: z.string(),
    decision: z.enum(["allow", "refuse", "approval-required"]),
    tier: z.number(),
    findings: z.array(z.unknown()),
    reason: z.string(),
    contentHash: z.string(),
  })
  .passthrough();

/** `@approvals`' `GrantDecision`: codes and booleans, never prose. */
const grantDecision = z
  .object({
    allowed: z.boolean(),
    reason: z.string(),
    tier: z.number(),
    contentHash: z.string(),
    requiresNamedApproval: z.boolean(),
    ceilingGranted: z.boolean(),
    projectGranted: z.boolean(),
  })
  .passthrough();

const clarifyingQuestion = z
  .object({
    id: z.string(),
    field: z.string(),
    severity: z.string(),
    question: z.string(),
    because: z.string(),
    options: z.array(z.string()).nullable(),
  })
  .passthrough();

const generatedFile = z.object({ path: z.string(), contents: z.string(), kind: z.string() }).passthrough();

const buildReplySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("model-request-refused"), decision: gateDecision }).passthrough(),
  z
    .object({ status: z.literal("needs_input"), questions: z.array(clarifyingQuestion), understanding: z.string() })
    .passthrough(),
  z
    .object({ status: z.literal("blocked"), rule: z.string(), explanation: z.string(), evidence: z.string() })
    .passthrough(),
  z.object({ status: z.literal("invalid_draft"), issues: z.array(z.string()), attempts: z.number() }).passthrough(),
  z
    .object({
      status: z.literal("translation-refused"),
      refusals: z.array(z.object({ at: z.string(), needs: z.string() }).passthrough()),
    })
    .passthrough(),
  z.object({ status: z.literal("generation-refused"), issues: z.array(z.string()) }).passthrough(),
  z.object({ status: z.literal("artifacts-refused"), decision: gateDecision }).passthrough(),
  z
    .object({
      status: z.literal("proposed"),
      generated: z
        .object({
          plan: z.object({ id: z.string() }).passthrough(),
          files: z.array(generatedFile).min(1),
          registryPatch: z.unknown(),
          warnings: z.array(z.string()),
        })
        .passthrough(),
      conformance: z
        .object({
          ok: z.boolean(),
          id: z.string().nullable(),
          findings: z.array(conformanceFinding),
          errors: z.array(conformanceFinding),
          warnings: z.array(conformanceFinding),
          checks: z.array(z.string()),
          rules: z.array(z.string()),
          filesChecked: z.number(),
        })
        .passthrough(),
      artifacts: gateDecision,
      understanding: z.string(),
    })
    .passthrough(),
  /** Not a `BuildOutcome`: the route answers it itself, at intake, before
   * `buildSubAppFromPrompt` runs (`server/index.ts`). */
  z.object({ status: z.literal("grant-refused"), decision: grantDecision }).passthrough(),
]);

/** What the server answered, parsed. */
export type ServerOutcome = z.infer<typeof buildReplySchema>;

/** What the CLIENT answers without the server having produced an outcome. */
export type ClientOutcome =
  /** No connection, so nothing was sent. */
  | { readonly status: "not-connected" }
  /** 401: the token is forgotten and the connection dropped. */
  | { readonly status: "unauthorized" }
  /** 429: seconds from `Retry-After`, or `null` when it gave none it could count. */
  | { readonly status: "rate-limited"; readonly retryAfter: number | null }
  /** Nothing usable came back. `cause` says which kind of nothing. */
  | {
      readonly status: "protocol-error";
      readonly cause: "network" | "http-status" | "malformed-reply";
      readonly httpStatus: number | null;
    };

export type StudioOutcome = ServerOutcome | ClientOutcome;

/** Parse a build reply. Never throws: what does not parse is a `protocol-error`. */
export function parseBuildReply(reply: unknown): ServerOutcome | Extract<ClientOutcome, { status: "protocol-error" }> {
  const parsed = buildReplySchema.safeParse(reply);
  return parsed.success ? parsed.data : { status: "protocol-error", cause: "malformed-reply", httpStatus: null };
}

// ── The connection ─────────────────────────────────────────────────

export type ConnectionState =
  /** `reason` is why it is not connected: `null` before anyone connected. */
  | { readonly status: "disconnected"; readonly reason: null | "signed-out" | "token-rejected" }
  /** The server answered its health probe AND accepted the token. It checks
   * the token again on every build; a refused one drops back to `disconnected`. */
  | { readonly status: "connected"; readonly health: StudioHealth };

export type ConnectResult =
  | { readonly ok: true; readonly health: StudioHealth }
  | {
      readonly ok: false;
      /** `cancelled`: a disconnect (or a newer connect) superseded it while it waited. */
      readonly reason: "empty-token" | "unreachable" | "protocol-error" | "token-rejected" | "cancelled";
    };

export interface BuildOptions {
  /** Answers to the clarifying questions of a `needs_input`, by question id. */
  readonly answers?: Readonly<Record<string, string>>;
}

export interface StudioClient {
  getConnection(): ConnectionState;
  /** For `useSyncExternalStore`. The listener is called on every change of
   * connection; `getConnection` returns the same object until one. */
  subscribe(listener: () => void): () => void;
  connect(token: string): Promise<ConnectResult>;
  disconnect(): void;
  build(prompt: string, options?: BuildOptions): Promise<StudioOutcome>;
}

export interface StudioClientOptions {
  /** Defaults to the global `fetch`, looked up per call. */
  readonly fetch?: StudioFetch;
  /** Prefix for `/api/...`. Same origin (`""`) by default: the Vite proxy in
   * development, the server itself when it serves the build. */
  readonly baseUrl?: string;
}

const INITIAL: ConnectionState = { status: "disconnected", reason: null };

/** The build route's answer to an empty body once the bearer has passed. */
const tokenAccepted = z.object({ error: z.literal("malformed request") }).passthrough();

/** A gateway answering for a server that is not there: 502/503/504, or a 500
 * that is not JSON (Vite's dev proxy, when nothing listens behind it, answers
 * an empty text/plain 500). The Studio server itself answers JSON. */
function gatewayWithoutServer(res: Response): boolean {
  if (res.status === 502 || res.status === 503 || res.status === 504) return true;
  return res.status === 500 && !(res.headers.get("content-type") ?? "").includes("application/json");
}

/** `Retry-After` in delta-seconds. An HTTP date is not counted: `null`
 * ("the server did not say, in a form we can count") beats an invented number. */
function retryAfterSeconds(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function createStudioClient(options: StudioClientOptions = {}): StudioClient {
  const baseUrl = options.baseUrl ?? "";
  const doFetch: StudioFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  // ⛔ THE ONLY PLACE THE TOKEN LIVES. See the file header.
  let token: string | null = null;
  let connection: ConnectionState = INITIAL;
  let attempt = 0;
  const listeners = new Set<() => void>();

  const set = (next: ConnectionState) => {
    connection = next;
    for (const listener of listeners) listener();
  };

  async function probe(): Promise<ConnectResult> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/api/studio/health`, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      return { ok: false, reason: "unreachable" };
    }
    if (gatewayWithoutServer(res)) return { ok: false, reason: "unreachable" };
    if (res.status !== 200) return { ok: false, reason: "protocol-error" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "protocol-error" };
    }
    const parsed = healthSchema.safeParse(body);
    return parsed.success ? { ok: true, health: parsed.data } : { ok: false, reason: "protocol-error" };
  }

  /** The same request `build` makes, with the same fetch options, and the
   * one body the server's schema is certain to refuse. See the file header. */
  const postBuild = (bearer: string, body: unknown) =>
    doFetch(`${baseUrl}/api/studio/build`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      // The server never redirects /api. A redirect is somebody else
      // answering, and the bearer is not for them.
      redirect: "error",
    });

  async function checkToken(secret: string): Promise<"accepted" | Extract<ConnectResult, { ok: false }>["reason"]> {
    let res: Response;
    try {
      res = await postBuild(secret, {});
    } catch {
      return "unreachable";
    }
    if (res.status === 401) return "token-rejected";
    if (gatewayWithoutServer(res)) return "unreachable";
    if (res.status !== 400) return "protocol-error";
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return "protocol-error";
    }
    // Past the bearer, the build route's own refusal of an empty body — not
    // just any 400 from something in between.
    return tokenAccepted.safeParse(body).success ? "accepted" : "protocol-error";
  }

  return {
    getConnection: () => connection,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async connect(candidate) {
      const secret = candidate.trim();
      if (secret === "") return { ok: false, reason: "empty-token" };
      // Asking to connect is asking to use THIS token: whatever was held
      // before is dropped now, not after the probe answers.
      token = null;
      if (connection.status === "connected") set(INITIAL);
      const mine = ++attempt;
      const probed = await probe();
      // A later connect (or a disconnect) superseded this one while it waited.
      if (mine !== attempt) return { ok: false, reason: "cancelled" };
      if (!probed.ok) return probed;
      const checked = await checkToken(secret);
      if (mine !== attempt) return { ok: false, reason: "cancelled" };
      if (checked !== "accepted") return { ok: false, reason: checked };
      token = secret;
      set({ status: "connected", health: probed.health });
      return probed;
    },

    disconnect() {
      attempt += 1;
      token = null;
      set({ status: "disconnected", reason: "signed-out" });
    },

    async build(prompt, buildOptions = {}) {
      const sent = token;
      if (sent === null) return { status: "not-connected" };
      // The server's body schema is `.strict()`: send only what it names.
      const body = buildOptions.answers === undefined ? { prompt } : { prompt, answers: buildOptions.answers };
      let res: Response;
      try {
        res = await postBuild(sent, body);
      } catch {
        return { status: "protocol-error", cause: "network", httpStatus: null };
      }
      if (res.status === 401) {
        // Only the token this request carried is condemned: a person who
        // reconnected while it was in flight keeps their new one.
        if (token === sent) {
          token = null;
          attempt += 1;
          set({ status: "disconnected", reason: "token-rejected" });
        }
        return { status: "unauthorized" };
      }
      if (res.status === 429) return { status: "rate-limited", retryAfter: retryAfterSeconds(res.headers.get("retry-after")) };
      if (res.status !== 200) return { status: "protocol-error", cause: "http-status", httpStatus: res.status };
      let reply: unknown;
      try {
        reply = await res.json();
      } catch {
        return { status: "protocol-error", cause: "malformed-reply", httpStatus: 200 };
      }
      const outcome = parseBuildReply(reply);
      return outcome.status === "protocol-error" ? { ...outcome, httpStatus: 200 } : outcome;
    },
  };
}
