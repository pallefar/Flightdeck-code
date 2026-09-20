/** What the builder is doing, while it is doing it.
 *
 * ── THE HOLE THIS FILLS ──────────────────────────────────────────────
 * Before this file the workbench's unit of work was an entire round with
 * a single `busy` flag. That is honest about the transport — one prompt,
 * one answer — and useless to the person watching, because a round is not
 * one thing. Generating a Flightdeck sub-app is a pipeline with named,
 * independently-failing stages that already exist in the sibling packages:
 *
 *   plan            `planSubApp` — parse, resolve, derive the manifest
 *   emit            one step per emitted file
 *   invariants      `checkEmittedInvariants` reads the TEXT back
 *   gate            one step per conformance check that RAN
 *   typecheck       `typecheckCandidate` — the real compiler, real output
 *   mount probe     `runSandboxed` — a real child process, stdout+stderr
 *
 * The last two are not metaphors: `verify/sandbox.ts` spawns Node and
 * captures both pipes. So "stream the builder's output" here means the
 * actual bytes a process wrote, not a progress animation.
 *
 * ── WHY THE STEP MODEL LIVES IN THE UI PACKAGE ───────────────────────
 * Same reason `types.ts` copies `GeneratedFile` instead of importing it.
 * The workbench is a renderer: it is handed steps and it draws them. A
 * driver — a fetch/SSE loop, a test, an in-process call to `@codegen` —
 * declares the steps it is about to take, then reports what happened. The
 * shape below is the whole protocol, and it is deliberately narrower than
 * anything in the generator.
 *
 * ── WHAT IS BOUNDED, AND WHY IT SAYS SO ──────────────────────────────
 * `tsc` on a candidate with a bad import emits hundreds of diagnostics; a
 * crashing probe can emit a megabyte of stack. A log pane that keeps all
 * of it takes the tab down, and one that silently keeps the last N lies
 * about what it has. So the buffer is capped, eviction is counted, and
 * `droppedLines` is rendered — a reader is told "2,310 earlier lines
 * dropped" rather than shown a log that begins in the middle of a
 * sentence and pretends that is the beginning.
 *
 * Pure and DOM-free. `run.test.ts` runs it in node. */

// ───────────────────────────── steps ─────────────────────────────────────

/** A step's lifecycle.
 *
 * `skipped` and `aborted` are separate on purpose. A step is SKIPPED when
 * an earlier failure made it pointless (no mount probe for a candidate
 * that did not compile) — the pipeline decided. A step is ABORTED when a
 * person pressed stop — the person decided. Painting both grey teaches a
 * reader that grey means "did not happen", which is true, and hides the
 * only part that matters: whose call it was. */
export type StepStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "aborted";

/** Statuses a step never leaves. */
export const TERMINAL: ReadonlySet<StepStatus> = new Set<StepStatus>([
  "succeeded",
  "failed",
  "skipped",
  "aborted",
]);

/** Which pipe a line came out of. Kept per line rather than per step
 * because a compiler writes progress to stdout and diagnostics to stderr
 * in the same run, and merging them loses the distinction that tells a
 * reader which half is the complaint. */
export type LogStream = "out" | "err";

export interface LogLine {
  /** Monotonic within a step, and stable — the render key. */
  readonly seq: number;
  readonly stream: LogStream;
  readonly text: string;
  /** False while this line has no terminating newline yet. A process
   * writes `Checking… ` and then `done\n` as two chunks; a log that starts
   * a new line per chunk shows that as two lines, which is not what the
   * process printed. The next chunk on the same pipe continues an open
   * line. */
  readonly closed: boolean;
}

export interface Step {
  readonly id: string;
  /** What is happening, in the person's language: "typecheck against the
   * host surface", not "verify.typecheck". */
  readonly label: string;
  /** What it is about — a path, a rule id, a command line. `null` when the
   * label is the whole story. */
  readonly detail: string | null;
  readonly status: StepStatus;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** Why it failed, in the failing thing's own words. Never swallowed:
   * `endStep(id, "failed")` without a message is a programming error the
   * pane will surface as "failed, no reason given" rather than hide. */
  readonly error: string | null;
  /** For steps that were a process. `null` for the ones that were not. */
  readonly exitCode: number | null;
  readonly log: readonly LogLine[];
  /** Lines evicted from the head by the cap. Rendered, not hidden. */
  readonly droppedLines: number;
  /** Repo-relative paths this step says it will write. While it is
   * running they are read-only in the editor — `editing.ts` reads this,
   * and it is the whole of "the agent wrote the file I am editing"
   * prevention on the run side. */
  readonly writes: readonly string[];
}

/** What a driver declares up front. Everything optional has a sane
 * default, because the common step is a label and nothing else. */
export interface StepSpec {
  readonly id: string;
  readonly label: string;
  readonly detail?: string | null;
  readonly writes?: readonly string[];
}

/** Per step. ~400 lines is more than a person reads and enough to hold a
 * full `tsc` run's tail, which is the part that names the error. */
export const MAX_LOG_LINES = 400;

/** Per line. A minified bundle printed as one line is not information. */
export const MAX_LINE_CHARS = 2_000;

const TRUNCATION_MARK = " …[line truncated]";

export function createStep(spec: StepSpec): Step {
  return {
    id: spec.id,
    label: spec.label,
    detail: spec.detail ?? null,
    status: "queued",
    startedAt: null,
    endedAt: null,
    error: null,
    exitCode: null,
    log: [],
    droppedLines: 0,
    writes: spec.writes ?? [],
  };
}

function clamp(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text;
  return text.slice(0, MAX_LINE_CHARS) + TRUNCATION_MARK;
}

/** Append raw process output.
 *
 * Returns the SAME step when the chunk is empty, so a driver that polls a
 * pipe and gets nothing does not make every subscriber re-render. */
export function pushOutput(step: Step, chunk: string, stream: LogStream = "out"): Step {
  if (chunk.length === 0) return step;

  const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  const lines = [...step.log];
  let dropped = step.droppedLines;
  let seq = lines.length === 0 ? 0 : (lines[lines.length - 1]?.seq ?? 0) + 1;

  for (let i = 0; i < parts.length; i += 1) {
    const text = parts[i] ?? "";
    const last = lines[lines.length - 1];
    const isLastPart = i === parts.length - 1;
    // The chunk ended without a newline, so its final fragment stays open
    // for the next chunk to continue.
    const closed = !isLastPart;

    if (i === 0 && last !== undefined && !last.closed && last.stream === stream) {
      lines[lines.length - 1] = { ...last, text: clamp(last.text + text), closed };
      continue;
    }
    // A chunk ending in "\n" splits to a trailing "" — that is the
    // terminator, not an empty line the process printed.
    if (isLastPart && text.length === 0) {
      if (last !== undefined && !last.closed && last.stream === stream) {
        lines[lines.length - 1] = { ...last, closed: true };
      }
      continue;
    }
    lines.push({ seq, stream, text: clamp(text), closed });
    seq += 1;
  }

  while (lines.length > MAX_LOG_LINES) {
    lines.shift();
    dropped += 1;
  }

  return { ...step, log: lines, droppedLines: dropped };
}

export function startStep(step: Step, at: number): Step {
  if (step.status !== "queued") return step;
  return { ...step, status: "running", startedAt: at };
}

export interface StepOutcome {
  readonly error?: string | null;
  readonly exitCode?: number | null;
}

/** Move a step to a terminal status. A step that never started still gets
 * `startedAt`, so a failure that happened before the first byte still has
 * a duration of 0 rather than a blank where a number belongs. */
export function endStep(step: Step, status: StepStatus, at: number, outcome: StepOutcome = {}): Step {
  if (TERMINAL.has(step.status)) return step;
  const error =
    outcome.error !== undefined
      ? outcome.error
      : status === "failed"
        ? "failed, no reason given"
        : step.error;
  return {
    ...step,
    status,
    startedAt: step.startedAt ?? at,
    endedAt: at,
    error,
    exitCode: outcome.exitCode !== undefined ? outcome.exitCode : step.exitCode,
  };
}

/** The whole log as the process wrote it, for the copy button and for a
 * test that wants to assert on output rather than on markup. */
export function logText(step: Step): string {
  return step.log.map((line) => line.text).join("\n");
}

export function stepDuration(step: Step, now: number): number | null {
  if (step.startedAt === null) return null;
  return (step.endedAt ?? now) - step.startedAt;
}

// ───────────────────────────── the run ───────────────────────────────────

export type RunStatus = "running" | "succeeded" | "failed" | "aborted";

export interface Run {
  /** The studio turn this run is the work behind. Rounds do not exist yet
   * while a run is going, and turns do — so the turn is the handle. */
  readonly turnId: string;
  readonly steps: readonly Step[];
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** Set the instant a person presses stop, before any step has noticed.
   * The button reads this so it can say "stopping…" rather than looking
   * broken while an in-flight request unwinds. */
  readonly abortRequested: boolean;
}

export function createRun(turnId: string, at: number): Run {
  return { turnId, steps: [], startedAt: at, endedAt: null, abortRequested: false };
}

export function runStatus(run: Run): RunStatus {
  if (run.endedAt === null) return "running";
  if (run.steps.some((step) => step.status === "aborted")) return "aborted";
  if (run.steps.some((step) => step.status === "failed")) return "failed";
  return "succeeded";
}

export interface RunProgress {
  readonly total: number;
  /** Reached a terminal status, whatever it was. */
  readonly done: number;
  readonly failed: number;
  readonly running: number;
  readonly queued: number;
  /** The step a person would point at when asked "what is it doing?" —
   * the first running one, else the first queued one, else the last. */
  readonly current: Step | null;
}

export function runProgress(run: Run | null): RunProgress {
  const steps = run?.steps ?? [];
  let done = 0;
  let failed = 0;
  let running = 0;
  let queued = 0;
  for (const step of steps) {
    if (TERMINAL.has(step.status)) done += 1;
    if (step.status === "failed") failed += 1;
    if (step.status === "running") running += 1;
    if (step.status === "queued") queued += 1;
  }
  const current =
    steps.find((step) => step.status === "running") ??
    steps.find((step) => step.status === "queued") ??
    steps[steps.length - 1] ??
    null;
  return { total: steps.length, done, failed, running, queued, current };
}

/** Every step that failed, for the pane that has to answer "what broke?"
 * without making a person expand seven green rows to find the red one. */
export function failedSteps(run: Run | null): readonly Step[] {
  return (run?.steps ?? []).filter((step) => step.status === "failed");
}

/** Paths a currently-running step said it would write.
 *
 * This is the read-only-while-running set. It is deliberately the union of
 * RUNNING steps only and not of the whole run: locking every file the run
 * will eventually touch for the run's whole duration would make the editor
 * useless exactly when a person most wants to look at something, and the
 * race it prevents only exists while the write is actually happening. */
export function pathsBeingWritten(run: Run | null): ReadonlySet<string> {
  const out = new Set<string>();
  for (const step of run?.steps ?? []) {
    if (step.status !== "running") continue;
    for (const path of step.writes) out.add(path);
  }
  return out;
}
