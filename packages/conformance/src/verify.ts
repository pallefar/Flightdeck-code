/** The gate with teeth: conforms, compiles, runs.
 *
 * ── WHY THE STATIC GATE WAS NOT ENOUGH ──────────────────────────────
 * `runConformanceGate` answers one question very well — "does this obey
 * the Flightdeck sub-app contract?" — and it cannot answer the question a
 * person actually has, which is "will this work?". Those come apart in
 * both directions, and the second one is the expensive failure: a
 * generated sub-app with a type error, a null-deref or a column that is
 * not on the table passes every contract rule in this package and then
 * turns the host build red, or 500s on its first request. A sub-app is
 * COMPILED INTO the host; there is no sandbox at the far end catching it.
 *
 * So the gate got two more stages, and neither of them reads text:
 *
 *   typecheck  the real TypeScript compiler, over the candidate plus a
 *              declared model of the host it will be compiled into, with
 *              `zod`, `react` and `fastify` resolved to the actual
 *              packages. Its diagnostics are the findings.
 *   mount      the emitted JavaScript, imported in a SEPARATE process
 *              under the platform permission model, against a host that
 *              records instead of storing: the SQL that really ran, the
 *              routes really registered, and the order each handler
 *              really did things in.
 *
 * ── THE ORDER IS A SAFETY PROPERTY, NOT AN OPTIMISATION ─────────────
 * Static first, always. Nothing is compiled until the contract checks
 * pass, and NOTHING IS EXECUTED until both of those pass. The static
 * stage is the one that refuses a candidate for importing `node:fs`, a
 * database driver or a sibling sub-app; running such a file to see what
 * it does would be doing the thing the check just refused. A stage that
 * did not run is reported as not having run — never as a pass.
 *
 * ── WHAT IS KEPT ────────────────────────────────────────────────────
 * Every stage's raw output is retained on the report after the verdict is
 * taken, because the consumer of a refusal is a repair loop: the model
 * that has to fix the app needs the compiler's own message and the
 * probe's own transcript, not this package's summary of them. */
import { analyzeCandidate, type CandidateSubApp } from "./analyze";
import { indexPrefix, routePrefix, tablePrefix } from "./derive";
import { CANDIDATE_SCOPE, NO_POSITION, finding, sortFindings, type Finding } from "./finding";
import { ConformanceError, runConformanceGate, type GateOptions, type GateReport } from "./gate";
import { FLIGHTDECK_HOST_SURFACE, type HostSurface } from "./verify/host-surface";
import { mountProbe, type MountContext, type MountResult } from "./verify/mount";
import { typecheckCandidate, type TypecheckResult } from "./verify/typecheck";

export type StageName = "static" | "typecheck" | "mount";

export interface VerificationStage {
  readonly name: StageName;
  /** False means the stage was not attempted. A report where a stage did
   * not run is never a pass — `verified` requires all three. */
  readonly ran: boolean;
  readonly ok: boolean;
  readonly durationMs: number;
  /** Retained verbatim: `tsc`'s diagnostics, the probe's transcript. */
  readonly output: string;
  /** Why it was not attempted, when it was not. */
  readonly skipped: string | null;
}

export interface VerificationReport extends GateReport {
  readonly stages: readonly VerificationStage[];
  /** Every stage ran, and none of them produced an error. The only value
   * a write path may act on. */
  readonly verified: boolean;
}

export interface VerifyOptions extends GateOptions {
  /** The directory whose `node_modules` the candidate is compiled and run
   * against. Defaults to `process.cwd()`. */
  readonly repoRoot?: string;
  /** Replaces the built-in model of the host — the one seam through which
   * a different target platform is described. */
  readonly hostSurface?: HostSurface;
  /** Stops in-flight work, including killing the probe process. */
  readonly signal?: AbortSignal;
  /** Wall clock for the whole probe process. Default 30s. */
  readonly timeoutMs?: number;
  /** Wall clock for one handler invocation. Default 2s. */
  readonly handlerTimeoutMs?: number;
  /** Skip the sandboxed mount, explicitly and on the record — the report
   * says the stage did not run and `verified` is false. For a caller that
   * wants the compile answer alone and knows it is not getting the other
   * one. */
  readonly skipMount?: boolean;
}

export async function verifySubApp(candidate: CandidateSubApp, options: VerifyOptions = {}): Promise<VerificationReport> {
  const stages: VerificationStage[] = [];
  const findings: Finding[] = [];

  // ── Stage 1: the contract. ────────────────────────────────────────
  const staticStarted = Date.now();
  const gate = runConformanceGate(candidate, options);
  findings.push(...gate.findings);
  stages.push({
    name: "static",
    ran: true,
    ok: gate.ok,
    durationMs: Date.now() - staticStarted,
    output: `${gate.checks.length} checks ran, ${gate.errors.length} error${gate.errors.length === 1 ? "" : "s"}, ${gate.warnings.length} warning${gate.warnings.length === 1 ? "" : "s"}`,
    skipped: null,
  });

  if (!gate.ok) {
    return assemble(gate, findings, [
      ...stages,
      notRun("typecheck", "the contract checks refused this candidate; compiling it would add noise to a decision already taken"),
      notRun("mount", "a candidate the contract checks refused is never executed — those checks are what stand between a generated file and `node:fs`"),
    ]);
  }

  if (aborted(options.signal)) return cancelled(gate, findings, stages, "typecheck");

  // ── Stage 2: does it compile into the host? ───────────────────────
  const typeStarted = Date.now();
  let typecheck: TypecheckResult;
  try {
    typecheck = typecheckCandidate(candidate.files, {
      ...(options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot }),
      ...(options.hostSurface === undefined ? {} : { hostSurface: options.hostSurface }),
    });
  } catch (error) {
    return assemble(
      gate,
      [
        ...findings,
        finding(
          "FD-Z001",
          CANDIDATE_SCOPE,
          NO_POSITION,
          `the typecheck stage could not complete (${(error as Error).message}) — a compile that did not finish has not passed this app`,
        ),
      ],
      [
        ...stages,
        { name: "typecheck", ran: false, ok: false, durationMs: Date.now() - typeStarted, output: String((error as Error).stack ?? error), skipped: "the compiler threw" },
        notRun("mount", "the candidate was never compiled, so there was nothing to mount"),
      ],
    );
  }

  findings.push(...typecheck.findings);
  stages.push({
    name: "typecheck",
    ran: true,
    ok: typecheck.ok,
    durationMs: Date.now() - typeStarted,
    output: typecheck.output,
    skipped: null,
  });

  if (!typecheck.ok) {
    return assemble(gate, findings, [
      ...stages,
      notRun("mount", "code that does not compile cannot be mounted; the compiler's errors come first because they are the ones that explain the rest"),
    ]);
  }

  if (options.skipMount === true) {
    return assemble(gate, findings, [
      ...stages,
      notRun("mount", "the caller passed skipMount — this app has NOT been run, and `verified` is false because of it"),
    ]);
  }

  if (aborted(options.signal)) return cancelled(gate, findings, stages, "mount");

  // ── Stage 3: mount it and watch. ──────────────────────────────────
  const analysis = analyzeCandidate(candidate);
  if (!analysis.ok) {
    // Unreachable in practice: stage 1 passed, so the analysis did too.
    return assemble(gate, [...findings, ...analysis.findings], [...stages, notRun("mount", "the candidate could not be analysed")]);
  }

  const mountStarted = Date.now();
  let mount: MountResult;
  try {
    mount = await mountProbe(typecheck.emitted, mountContext(analysis.app.id, analysis.app.manifestPath, locator(analysis.app)), {
      repoRoot: options.repoRoot ?? process.cwd(),
      hostRuntime: (options.hostSurface ?? FLIGHTDECK_HOST_SURFACE).runtime,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.handlerTimeoutMs === undefined ? {} : { handlerTimeoutMs: options.handlerTimeoutMs }),
    });
  } catch (error) {
    return assemble(
      gate,
      [
        ...findings,
        finding(
          "FD-R009",
          analysis.app.manifestPath,
          NO_POSITION,
          `the mount probe could not be set up (${(error as Error).message}) — the gate never saw this sub-app run, and an app it could not watch has not passed`,
        ),
      ],
      [...stages, { name: "mount", ran: false, ok: false, durationMs: Date.now() - mountStarted, output: String((error as Error).stack ?? error), skipped: "staging failed" }],
    );
  }

  findings.push(...mount.findings);
  stages.push({
    name: "mount",
    ran: mount.ran,
    ok: mount.ran && mount.findings.length === 0,
    durationMs: Date.now() - mountStarted,
    output: mount.output,
    skipped: mount.ran ? null : "the probe did not complete",
  });

  return assemble(gate, findings, stages);
}

/** For the write path, where the only interesting outcome is the refusal.
 * The async counterpart of `assertShippable` — and the one `shipSubApp`
 * uses, because "it conforms" is not the same claim as "it works". */
export async function assertVerified(candidate: CandidateSubApp, options: VerifyOptions = {}): Promise<VerificationReport> {
  const report = await verifySubApp(candidate, options);
  if (!report.verified) throw new ConformanceError(report);
  return report;
}

// ── Assembly ────────────────────────────────────────────────────────────

function assemble(gate: GateReport, findings: readonly Finding[], stages: readonly VerificationStage[]): VerificationReport {
  const sorted = sortFindings(findings);
  const errors = sorted.filter((f) => f.severity === "error");
  return {
    ...gate,
    ok: errors.length === 0,
    findings: sorted,
    errors,
    warnings: sorted.filter((f) => f.severity === "warning"),
    stages,
    verified: errors.length === 0 && stages.every((stage) => stage.ran && stage.ok),
  };
}

function notRun(name: StageName, why: string): VerificationStage {
  return { name, ran: false, ok: false, durationMs: 0, output: "", skipped: why };
}

function aborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

function cancelled(gate: GateReport, findings: readonly Finding[], stages: readonly VerificationStage[], from: StageName): VerificationReport {
  const remaining: StageName[] = from === "typecheck" ? ["typecheck", "mount"] : ["mount"];
  return assemble(
    gate,
    [
      ...findings,
      finding(
        "FD-Z001",
        CANDIDATE_SCOPE,
        NO_POSITION,
        "verification was cancelled before it finished — a cancelled run has not approved anything, and this report is a refusal rather than a partial pass",
      ),
    ],
    [...stages, ...remaining.map((name) => notRun(name, "cancelled by the caller"))],
  );
}

function mountContext(id: string, manifestPath: string, locate: MountContext["locate"]): MountContext {
  return {
    id,
    manifestPath,
    routePrefix: routePrefix(id),
    tablePrefix: tablePrefix(id),
    indexPrefix: indexPrefix(id),
    locate,
  };
}

/** Best effort: put a runtime finding on the line where the thing it is
 * about is written down. A route url observed at `app.get` usually appears
 * verbatim in the file that registered it; a table name observed at
 * `db.exec` usually appears in the DDL. When it does not — which is the
 * interesting case, a name assembled at runtime — the finding anchors on
 * the manifest and says what it saw. */
function locator(app: { readonly files: readonly { readonly path: string; readonly reachable: boolean; readonly scan: { readonly text: string; positionAt(offset: number): { line: number; column: number }; lineTextAt(offset: number): string } }[] }): MountContext["locate"] {
  return (needle: string) => {
    if (needle.length === 0) return null;
    for (const file of app.files) {
      if (!file.reachable) continue;
      const at = file.scan.text.indexOf(needle);
      if (at === -1) continue;
      return { file: file.path, position: file.scan.positionAt(at), evidence: file.scan.lineTextAt(at) };
    }
    return null;
  };
}
