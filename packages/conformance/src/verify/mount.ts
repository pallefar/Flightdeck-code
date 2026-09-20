/** Mount the generated sub-app against a recording host, and report what
 * it actually did.
 *
 * ⭐ THE FINDINGS HERE ARE THE ONES READING CANNOT PRODUCE. Each of them
 * is about an observed event, not about text:
 *
 *   FD-R004  the SQL that reached `db.exec`, after every constant,
 *            concatenation and template was resolved. `tablePrefix`
 *            (FD-S001) reads literals and says so honestly when a name is
 *            assembled at runtime; this one simply watches it arrive.
 *   FD-R006  the urls `app.get`/`app.post` were actually called with. A
 *            route registered in a `for` loop over a path list has no
 *            literal to scan.
 *   FD-R007  the ORDER. Contract §5.1 is about what runs first, and the
 *            recorder keeps one ordered event log per invocation, so a
 *            guard call that is present in the file but sits after a body
 *            read — or inside a branch that was not taken — is a log whose
 *            position 0 is `read:body`.
 *   FD-R008  what a handler does when it is called. A null-deref on an
 *            optional field is a 500 in production and nothing at all in
 *            a static read.
 *
 * ⛔ NOTHING IS INFERRED FROM A MISSING RESULT. If the probe process
 * crashes, hangs, is killed, or cannot be isolated, this file raises
 * FD-R009 and the gate refuses. "We could not watch it run" never becomes
 * "it ran fine" — the same fail-closed rule FD-Z001 applies to the static
 * checks. */
import { NO_POSITION, finding, type Finding, type Position } from "../finding";
import { HARNESS_SOURCE, PROBE_SENTINEL, type ProbeInput, type ProbeInvocation, type ProbeResult } from "./harness";
import { isolationAvailable, runSandboxed, stage, type SandboxRun } from "./sandbox";

export interface MountLocation {
  readonly file: string;
  readonly position: Position;
  readonly evidence: string | undefined;
}

export interface MountContext {
  readonly id: string;
  readonly manifestPath: string;
  readonly routePrefix: string;
  readonly tablePrefix: string;
  readonly indexPrefix: string;
  /** Best-effort: where in the candidate a piece of observed text (a url,
   * a table name) appears, so a runtime finding still lands on a line. */
  locate(needle: string): MountLocation | null;
}

export interface MountOptions {
  readonly repoRoot: string;
  /** The host's leaf modules as executable recorders, keyed by
   * extensionless repo-relative path. Staged beside the candidate so
   * `../killSwitch.js` resolves to something that reports what it was
   * asked rather than to nothing at all. */
  readonly hostRuntime: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly handlerTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface MountResult {
  readonly ran: boolean;
  readonly findings: readonly Finding[];
  /** Retained verbatim: the probe's stdout and stderr, the exit code, and
   * the routes and SQL it observed. A caller repairing the app needs the
   * evidence, not this package's conclusion about it. */
  readonly output: string;
  readonly probe: ProbeResult | null;
  readonly run: SandboxRun | null;
}

/** Errors that mean the code is broken, as opposed to the request being
 * refused. A handler that answers 400 to a body it does not like is
 * working; one that throws `TypeError: Cannot read properties of
 * undefined` is not. */
const CRASH_ERRORS = new Set(["TypeError", "ReferenceError", "RangeError", "SyntaxError"]);

export async function mountProbe(
  modules: ReadonlyMap<string, string>,
  context: MountContext,
  options: MountOptions,
): Promise<MountResult> {
  const manifestModule = `./app/server/subapps/${context.id}/manifest.js`;
  const serverModules = new Map([...modules].filter(([path]) => path.startsWith("server/")));

  if (!serverModules.has(`server/subapps/${context.id}/manifest.js`)) {
    return {
      ran: false,
      findings: [
        finding(
          "FD-R009",
          context.manifestPath,
          NO_POSITION,
          "the manifest produced no JavaScript to mount, so the gate could not watch this sub-app run — it refuses rather than approving code it never executed",
        ),
      ],
      output: "nothing to mount: the manifest emitted no module",
      probe: null,
      run: null,
    };
  }

  // ⛔ No isolation, no run. Studio does not execute a model's output in
  // an unsandboxed process because the safe path happened to be
  // unavailable; it says it could not check, and refuses.
  if ((await isolationAvailable()) === null) {
    const reason =
      `this Node runtime (${process.version}) supports neither --permission nor --experimental-permission, ` +
      "so the generated app cannot be isolated from the machine running the gate";
    return {
      ran: false,
      findings: [probeFailure(context, reason)],
      output: reason,
      probe: null,
      run: null,
    };
  }

  const input: ProbeInput = {
    manifestModule,
    expectedId: context.id,
    expectedRoutePrefix: context.routePrefix,
    expectedTablePrefix: context.tablePrefix,
    handlerTimeoutMs: options.handlerTimeoutMs ?? 2_000,
  };

  const staged = await stage({
    modules: new Map([
      ...serverModules,
      ...Object.entries(options.hostRuntime).map(([module, source]) => [`${module}.js`, source] as const),
    ]),
    rootFiles: new Map([
      ["harness.mjs", HARNESS_SOURCE],
      ["input.js", `export default ${JSON.stringify(input, null, 2)};\n`],
    ]),
    repoRoot: options.repoRoot,
  });

  let run: SandboxRun;
  try {
    run = await runSandboxed({
      stage: staged,
      entry: "harness.mjs",
      timeoutMs: options.timeoutMs ?? 30_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } finally {
    await staged.dispose();
  }

  const probe = parseProbe(run.stdout);
  if (probe === null) {
    return {
      ran: false,
      findings: [probeFailure(context, describeFailure(run))],
      output: transcript(run, null),
      probe: null,
      run,
    };
  }

  return {
    ran: true,
    findings: interpret(probe, context),
    output: transcript(run, probe),
    probe,
    run,
  };
}

function probeFailure(context: MountContext, reason: string): Finding {
  return finding(
    "FD-R009",
    context.manifestPath,
    NO_POSITION,
    `the mount probe did not complete (${reason}) — the gate never saw this sub-app run, and an app it could not watch has not passed`,
  );
}

function describeFailure(run: SandboxRun): string {
  if (run.unavailable !== null) return run.unavailable;
  if (run.aborted) return "cancelled by the caller";
  if (run.timedOut) return `no result within the deadline; the process was killed after ${run.durationMs}ms`;
  if (run.killedBy !== null) return `the process was killed by ${run.killedBy}`;
  const tail = run.stderr.trim().split("\n").slice(-6).join("\n");
  return `the process exited ${String(run.exitCode)}${tail.length === 0 ? "" : ` — ${tail}`}`;
}

function parseProbe(stdout: string): ProbeResult | null {
  const at = stdout.lastIndexOf(PROBE_SENTINEL);
  if (at === -1) return null;
  const line = stdout.slice(at + PROBE_SENTINEL.length).split("\n")[0] ?? "";
  try {
    return JSON.parse(line) as ProbeResult;
  } catch {
    return null;
  }
}

// ── Turning observations into findings ──────────────────────────────────

function interpret(probe: ProbeResult, context: MountContext): Finding[] {
  const out: Finding[] = [];
  const at = (needle: string | null): { file: string; position: Position; evidence: string | undefined } => {
    const located = needle === null ? null : context.locate(needle);
    return located === null
      ? { file: context.manifestPath, position: NO_POSITION, evidence: undefined }
      : { file: located.file, position: located.position, evidence: located.evidence };
  };
  const push = (rule: Parameters<typeof finding>[0], needle: string | null, message: string): void => {
    const where = at(needle);
    out.push(finding(rule, where.file, where.position, message, where.evidence));
  };

  if (!probe.loaded || probe.loadError !== null) {
    push(
      "FD-R001",
      null,
      `importing the manifest threw ${probe.loadError === null ? "an error" : `${probe.loadError.name}: ${probe.loadError.message}`} — the host imports this module at boot, so a sub-app that cannot be imported takes the whole server down with it`,
    );
    return out;
  }

  if (probe.manifestShape === null) {
    push(
      "FD-R002",
      null,
      "the manifest module exported nothing shaped like a SubAppManifest — registry.ts imports a named manifest object and pushes it into SUBAPP_MANIFESTS, and there is nothing here for it to import",
    );
    return out;
  }

  const shape = probe.manifestShape;
  if (!shape.hasInitSchema) {
    push("FD-R002", null, "the exported manifest has no callable `initSchema` — the host calls it on every boot, for every workspace, and a missing one is a TypeError at startup");
  }
  if (!shape.hasRegisterRoutes) {
    push("FD-R002", null, "the exported manifest has no callable `registerRoutes` — the host calls it while building the Fastify instance");
  }
  if (typeof shape.id !== "string" || shape.id !== context.id) {
    push(
      "FD-R002",
      null,
      `the manifest's id evaluates to ${JSON.stringify(shape.id)} at runtime, not ${JSON.stringify(context.id)} — every derived name (the kill switch, the nav path, the table prefix) is computed from the value that is actually there, not the one the source appears to say`,
    );
  }

  if (probe.initSchemaError !== null) {
    push(
      "FD-R003",
      null,
      `initSchema threw ${probe.initSchemaError.name}: ${probe.initSchemaError.message} — the host runs it at boot and does not catch it, so this sub-app prevents the server from starting`,
    );
  }

  for (const call of probe.sql) {
    for (const offence of offendingNames(call.sql, context)) {
      push(
        "FD-R004",
        offence.name,
        `${call.phase === "initSchema" ? "initSchema" : "a route handler"} executed SQL against \`${offence.name}\`, which is not under \`${offence.kind === "index" ? context.indexPrefix : context.tablePrefix}\` — this is the statement as it reached the database, with every constant and template already resolved, so a name assembled at runtime is visible here even when the source literal was not`,
      );
    }
  }

  if (probe.registerRoutesError !== null) {
    push(
      "FD-R005",
      null,
      `registerRoutes threw ${probe.registerRoutesError.name}: ${probe.registerRoutesError.message} — the host calls it while building the Fastify instance, so this fails the server's boot`,
    );
  } else if (probe.routes.length === 0) {
    push(
      "FD-R005",
      null,
      "registerRoutes ran and registered no route at all — the sub-app mounts, appears in the nav and answers 404 to everything under its own prefix",
    );
  }

  for (const route of probe.routes) {
    const label = `${route.method} ${route.url}`;

    if (!route.url.startsWith(context.routePrefix)) {
      push(
        "FD-R006",
        route.url,
        `registered ${label}, which is outside its own \`${context.routePrefix}\` — the shell derives RBAC and the kill switch from the route prefix, so a route outside it is served with neither`,
      );
    }

    const refusal = judgeDisabled(route.disabled);
    if (refusal !== null) {
      push("FD-R007", route.url, `with the kill switch OFF, ${label} ${refusal} — contract §5.1 is about ORDER: the guard runs before a body is parsed or anything is touched, and this is what the handler actually did, not what its source appears to say`);
    }

    if (route.enabled.timedOut) {
      push("FD-R008", route.url, `${label} never settled — the handler was still running when the probe's deadline passed, which is a request that hangs a worker in production`);
    } else if (route.enabled.threw !== null && CRASH_ERRORS.has(route.enabled.threw.name)) {
      push(
        "FD-R008",
        route.url,
        `${label} threw ${route.enabled.threw.name}: ${route.enabled.threw.message} on a well-formed request with the sub-app enabled — a refusal is fine, a crash is a 500 the caller cannot act on`,
      );
    }
  }

  return out;
}

/** What went wrong in the disabled run, or `null` when the handler did the
 * right thing. Deliberately narrow: this rule is about order and side
 * effects, not about which status code the refusal maps to — FD-G001 and
 * FD-G002 already have a view on the source. */
function judgeDisabled(invocation: ProbeInvocation): string | null {
  const events = invocation.events;
  const firstGuard = events.findIndex((event) => event.startsWith("guard:"));

  if (firstGuard === -1) {
    return invocation.events.length === 0 && invocation.threw === null && invocation.status === null
      ? "did nothing at all: it never called the enable guard, and never answered"
      : "never called the enable guard — the shell enforces roles only, so this handler answers with the kill switch off";
  }
  if (firstGuard > 0) {
    return `did \`${String(events[0])}\` before calling the enable guard — the guard has to be the first thing that runs, not merely present in the file`;
  }

  const sideEffect = events.find((event, index) => index > 0 && (event.startsWith("sql:") || event.startsWith("capability:")));
  if (sideEffect !== undefined) {
    return `went on to \`${sideEffect}\` after the guard refused — the refusal has to stop the handler, not be logged and stepped over`;
  }
  return null;
}

// ── Reading names out of SQL that has already run ───────────────────────
// Separate from `checks/table-prefix.ts` on purpose: that one reads source
// literals and has to reason about interpolation it cannot resolve. This
// one reads the finished statement, where there is nothing left to reason
// about.

const CREATE_TABLE = /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_.]*)/gi;
const ALTER_OR_DROP = /\b(?:ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_.]*)/gi;
const CREATE_INDEX = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_.]*)/gi;
const TABLE_REFERENCE = /\b(?:FROM|JOIN|INTO|UPDATE)\s+([A-Za-z_][A-Za-z0-9_.]*)/gi;

interface Offence {
  readonly name: string;
  readonly kind: "table" | "index";
}

function offendingNames(sql: string, context: MountContext): Offence[] {
  const seen = new Set<string>();
  const out: Offence[] = [];
  const take = (name: string | undefined, kind: "table" | "index"): void => {
    if (name === undefined || name.length === 0) return;
    const prefix = kind === "index" ? context.indexPrefix : context.tablePrefix;
    if (name.startsWith(prefix)) return;
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, kind });
  };

  for (const match of sql.matchAll(CREATE_TABLE)) take(match[1], "table");
  for (const match of sql.matchAll(ALTER_OR_DROP)) take(match[1], "table");
  for (const match of sql.matchAll(CREATE_INDEX)) {
    take(match[1], "index");
    take(match[2], "table");
  }
  for (const match of sql.matchAll(TABLE_REFERENCE)) take(match[1], "table");
  return out;
}

function transcript(run: SandboxRun, probe: ProbeResult | null): string {
  const lines = [
    `probe process: exit ${String(run.exitCode)}${run.killedBy === null ? "" : ` (killed by ${run.killedBy})`}${run.timedOut ? " TIMED OUT" : ""}${run.aborted ? " CANCELLED" : ""} in ${run.durationMs}ms`,
  ];
  if (probe !== null) {
    lines.push(`manifest export: ${probe.manifestExport ?? "(none found)"}`);
    lines.push(`routes registered: ${probe.routes.length === 0 ? "(none)" : probe.routes.map((r) => `${r.method} ${r.url}`).join(", ")}`);
    lines.push(`sql executed (${probe.sql.length}):`);
    for (const call of probe.sql) lines.push(`  [${call.phase}] ${call.method}: ${collapse(call.sql)}`);
    for (const route of probe.routes) {
      lines.push(`  ${route.method} ${route.url} disabled -> ${describeInvocation(route.disabled)}`);
      lines.push(`  ${route.method} ${route.url} enabled  -> ${describeInvocation(route.enabled)}`);
    }
  }
  const stderr = run.stderr.trim();
  if (stderr.length > 0) lines.push("stderr:", stderr);
  return lines.join("\n");
}

function describeInvocation(invocation: ProbeInvocation): string {
  const status = invocation.status === null ? "no reply" : `${invocation.status}`;
  const threw = invocation.threw === null ? "" : ` threw ${invocation.threw.name}`;
  const timedOut = invocation.timedOut ? " TIMED OUT" : "";
  return `${status}${threw}${timedOut} [${invocation.events.join(" ")}]`;
}

function collapse(sql: string): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}
