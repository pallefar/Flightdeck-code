/** What actually runs inside the sandbox.
 *
 * ⭐ THIS IS THE PART THE STATIC GATE CANNOT DO. Every other check in this
 * package reads text. This one imports the generated manifest, hands
 * `initSchema` a database that records instead of storing, hands
 * `registerRoutes` a Fastify that records instead of listening, and then
 * calls every handler it registered — twice: once with the sub-app
 * disabled, once with it enabled. Three things fall out that no amount of
 * reading can produce:
 *
 *   • The SQL that RAN, not the SQL that was written down. A table name
 *     assembled from a constant and a suffix is a literal the scanner
 *     cannot resolve; here it arrives at `db.exec` fully formed.
 *   • The routes that were REGISTERED. A route added in a loop, or with a
 *     url built from `manifest.routePrefix + path`, is invisible to a
 *     scanner and obvious to a recorder.
 *   • The ORDER a handler does things in. Contract §5.1 is not "the file
 *     contains a call to the guard", it is "the guard runs before any
 *     work". So the recorder keeps one ordered event log per invocation
 *     and the verdict is about position 0 of that log — a guard called
 *     inside an `if` that was not taken produces a log that starts with a
 *     body read, and says so.
 *
 * ⛔ IT PRINTS ONE LINE AND WRITES NOTHING. The process it runs in has no
 * filesystem write permission, no child process permission and no host
 * environment, so the only channel out is stdout. A crash, a hang or a
 * killed process therefore looks different from a clean refusal, which is
 * what lets the parent tell "the app failed" from "the probe failed" and
 * report the second one as a gate malfunction rather than a verdict. */

/** Printed immediately before the JSON result. */
export const PROBE_SENTINEL = "__FD_PROBE_RESULT__";

export interface ProbeInput {
  readonly manifestModule: string;
  readonly expectedId: string;
  readonly expectedRoutePrefix: string;
  readonly expectedTablePrefix: string;
  /** Milliseconds any single handler invocation may take. */
  readonly handlerTimeoutMs: number;
}

export interface ProbeSqlCall {
  readonly phase: "initSchema" | "disabled" | "enabled";
  readonly method: string;
  readonly sql: string;
}

export interface ProbeRoute {
  readonly method: string;
  readonly url: string;
  /** The ordered event log of the disabled invocation. */
  readonly disabled: ProbeInvocation;
  readonly enabled: ProbeInvocation;
}

export interface ProbeInvocation {
  readonly events: readonly string[];
  readonly status: number | null;
  readonly threw: { readonly name: string; readonly message: string } | null;
  readonly timedOut: boolean;
}

export interface ProbeResult {
  readonly loaded: boolean;
  readonly loadError: { readonly name: string; readonly message: string; readonly stack: string } | null;
  readonly manifestExport: string | null;
  readonly manifestShape: {
    readonly id: unknown;
    readonly routePrefix: unknown;
    readonly hasInitSchema: boolean;
    readonly hasRegisterRoutes: boolean;
    /** The object carried an OS-04 `contributions` member when it was
     * imported, or had one after `registerRoutes` and every route ran —
     * attached by any module, by any means. FD-M008. */
    readonly declaresContributions: boolean;
  } | null;
  readonly initSchemaError: { readonly name: string; readonly message: string } | null;
  readonly registerRoutesError: { readonly name: string; readonly message: string } | null;
  readonly sql: readonly ProbeSqlCall[];
  readonly routes: readonly ProbeRoute[];
}

/** The harness itself, as ESM source. It is a string rather than a module
 * because it executes in a different process, under a different module
 * resolution root, with no access to this package. */
export const HARNESS_SOURCE = `import INPUT from "./input.js";

// ── Contain what the permission model does not. ─────────────────────────
// Node's --permission covers the filesystem, subprocesses, workers and
// native addons. It does not cover the network, and the generated code is
// untrusted. Nothing a sub-app may legally import reaches the network
// (contract §5.3, enforced statically before we get here), so removing the
// ambient clients costs a conforming app nothing and closes the one hole
// the flags leave open in-process.
for (const name of ["fetch", "WebSocket", "XMLHttpRequest", "EventSource", "navigator"]) {
  try { Object.defineProperty(globalThis, name, { value: undefined, configurable: true }); } catch {}
}

const PHASE = { current: "initSchema" };
const sql = [];
let events = null;

function log(event) { if (events !== null) events.push(event); }

const state = { killSwitch: true, installed: true, grantedScopes: [] };

function recordingDb() {
  const call = (method, defaultValue) => (statement, params) => {
    const text = String(statement);
    log("sql:" + method);
    sql.push({ phase: PHASE.current, method, sql: text });
    return Promise.resolve(defaultValue);
  };
  return {
    exec: call("exec", undefined),
    run: call("run", { changes: 0, lastID: 0 }),
    all: call("all", []),
    get: call("get", undefined),
    prepare: (statement) => {
      log("sql:prepare");
      sql.push({ phase: PHASE.current, method: "prepare", sql: String(statement) });
      return { run: () => ({ changes: 0 }), all: () => [], get: () => undefined, finalize: () => {} };
    },
  };
}

const db = recordingDb();

globalThis.__fdProbe = {
  killSwitch(id) { log("guard:killSwitch"); return state.killSwitch; },
  installRow(projectId, id) {
    log("guard:installRow");
    return state.installed
      ? { enabled: true, grantedScopes: state.grantedScopes }
      : { enabled: false, grantedScopes: [] };
  },
  audit(root, event) { log("audit:" + (event && event.event ? event.event : "?")); },
  capabilities(id, scopes) {
    log("capability:acquire");
    return {
      auditAppend(event) { log("audit:" + (event && event.event ? event.event : "?")); },
      async readContracts() { log("capability:readContracts"); return []; },
      async proposeInboxItem(proposal) { log("capability:proposeInboxItem"); return { path: "memory/proposals/probe.json" }; },
    };
  },
};

function makeRequest(route) {
  const req = { method: route.method, url: route.url, id: "probe-request", log: silentLog() };
  for (const prop of ["body", "query", "params", "headers", "cookies", "raw"]) {
    Object.defineProperty(req, prop, {
      configurable: true,
      get() { log("read:" + prop); return prop === "raw" ? { url: route.url } : {}; },
    });
  }
  req.workspace = { root: "/probe/workspace", db };
  req.project = { id: "default" };
  req.principal = { username: "probe", roles: ["admin", "hr_reviewer", "wc_liaison", "legal", "hr_preparer"] };
  return req;
}

function silentLog() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: silentLog };
}

function makeReply() {
  const reply = { statusCode: null, payload: undefined, sent: false };
  reply.code = (n) => { reply.statusCode = n; return reply; };
  reply.status = reply.code;
  reply.send = (payload) => {
    if (reply.statusCode === null) reply.statusCode = 200;
    reply.payload = payload;
    reply.sent = true;
    return reply;
  };
  reply.header = () => reply;
  reply.headers = () => reply;
  reply.type = () => reply;
  reply.serializer = () => reply;
  reply.redirect = () => reply;
  reply.callNotFound = () => reply;
  return reply;
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "all"];

function makeApp(routes) {
  const app = { log: silentLog() };
  for (const method of METHODS) {
    app[method] = (url, ...rest) => {
      const handler = rest.filter((arg) => typeof arg === "function").pop();
      routes.push({ method: method.toUpperCase(), url: String(url), handler: handler ?? null });
      return app;
    };
  }
  app.route = (opts) => {
    const methods = Array.isArray(opts.method) ? opts.method : [opts.method ?? "GET"];
    for (const method of methods) {
      routes.push({ method: String(method).toUpperCase(), url: String(opts.url), handler: opts.handler ?? null });
    }
    return app;
  };
  app.register = async (plugin, opts) => {
    if (typeof plugin === "function") await plugin(app, opts ?? {});
    return app;
  };
  for (const noop of ["addHook", "decorate", "decorateRequest", "decorateReply", "setErrorHandler", "setNotFoundHandler", "addSchema", "setValidatorCompiler", "setSerializerCompiler", "addContentTypeParser"]) {
    app[noop] = () => app;
  }
  app.after = (fn) => { if (typeof fn === "function") fn(); return app; };
  app.ready = async () => app;
  return app;
}

async function invoke(route, scenario) {
  state.killSwitch = scenario !== "disabled";
  state.installed = scenario !== "disabled";
  PHASE.current = scenario;
  events = [];
  const reply = makeReply();
  const outcome = { events, status: null, threw: null, timedOut: false };
  if (typeof route.handler !== "function") {
    outcome.threw = { name: "ProbeError", message: "route was registered without a handler function" };
    events = null;
    return outcome;
  }
  let timer = null;
  try {
    const raced = await Promise.race([
      Promise.resolve().then(() => route.handler(makeRequest(route), reply)),
      new Promise((resolve) => { timer = setTimeout(() => resolve("__FD_TIMEOUT__"), INPUT.handlerTimeoutMs); }),
    ]);
    if (raced === "__FD_TIMEOUT__") outcome.timedOut = true;
  } catch (error) {
    outcome.threw = { name: errName(error), message: errMessage(error) };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  outcome.status = reply.statusCode;
  outcome.events = events.slice();
  events = null;
  return outcome;
}

function errName(error) { return error && error.name ? String(error.name) : typeof error; }
function errMessage(error) { return error && error.message ? String(error.message) : String(error); }

const result = {
  loaded: false,
  loadError: null,
  manifestExport: null,
  manifestShape: null,
  initSchemaError: null,
  registerRoutesError: null,
  sql: [],
  routes: [],
};

try {
  const mod = await import(INPUT.manifestModule);
  result.loaded = true;

  let name = null;
  let manifest = null;
  for (const key of Object.keys(mod)) {
    const value = mod[key];
    if (value && typeof value === "object" && typeof value.registerRoutes !== "undefined") { name = key; manifest = value; break; }
  }
  if (manifest === null) {
    for (const key of Object.keys(mod)) {
      const value = mod[key];
      if (value && typeof value === "object" && typeof value.id === "string") { name = key; manifest = value; break; }
    }
  }
  result.manifestExport = name;

  if (manifest !== null) {
    result.manifestShape = {
      id: manifest.id,
      routePrefix: manifest.routePrefix,
      hasInitSchema: typeof manifest.initSchema === "function",
      hasRegisterRoutes: typeof manifest.registerRoutes === "function",
      declaresContributions: "contributions" in manifest,
    };

    if (typeof manifest.initSchema === "function") {
      PHASE.current = "initSchema";
      try { await manifest.initSchema(db); }
      catch (error) { result.initSchemaError = { name: errName(error), message: errMessage(error) }; }
    }

    const routes = [];
    if (typeof manifest.registerRoutes === "function") {
      try {
        await manifest.registerRoutes(makeApp(routes), {
          capabilitiesFor: (id) => globalThis.__fdProbe.capabilities(id, []),
        });
      } catch (error) {
        result.registerRoutesError = { name: errName(error), message: errMessage(error) };
      }
    }

    for (const route of routes) {
      result.routes.push({
        method: route.method,
        url: route.url,
        disabled: await invoke(route, "disabled"),
        enabled: await invoke(route, "enabled"),
      });
    }
    // Asked again once everything has run: a member attached during
    // registerRoutes or a handler is on the object the host would hold.
    if ("contributions" in manifest) result.manifestShape.declaresContributions = true;
  }
} catch (error) {
  result.loadError = { name: errName(error), message: errMessage(error), stack: String(error && error.stack ? error.stack : "") };
}

result.sql = sql;
process.stdout.write("\\n" + ${JSON.stringify(PROBE_SENTINEL)} + JSON.stringify(result) + "\\n");
`;
