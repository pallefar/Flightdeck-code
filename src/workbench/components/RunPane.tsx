/** The run pane: what the builder is doing, one step at a time.
 *
 * ── WHAT THIS PANE IS FOR ────────────────────────────────────────────
 * The other four panes are about the ARTEFACT — files, diff, preview,
 * gate. All four are only meaningful once a round has landed. This one is
 * about the WORK, and it is the only pane that is useful while the work is
 * still going. Before it existed, the answer to "what is it doing?" was a
 * blinking caret in the chat, which is an answer to "is it still alive?".
 *
 * ── THREE DELIBERATE CHOICES ─────────────────────────────────────────
 * 1. Queued steps are rendered, greyed, with their labels. The shape of
 *    the remaining work is information: a person who can see that the
 *    typecheck and the mount probe have not run yet knows not to trust a
 *    green gate summary.
 * 2. A failed step and a running step open their log automatically; the
 *    rest stay shut. Output is kept for every step, but a wall of eleven
 *    logs is the same as no log. The two a person opens by hand are the
 *    two the pane opens for them.
 * 3. The log is the process's bytes, not a summary of them. stderr is
 *    marked because a compiler writes its progress to one pipe and its
 *    complaints to the other, and merging them loses which half is the
 *    complaint. */
import { useState } from "react";
import { logText, runStatus, stepDuration, type Run, type Step, type StepStatus } from "../run";

interface Props {
  readonly run: Run | null;
  /** True while this run is the one in flight. Drives the stop button,
   * which is the only control on this pane. */
  readonly busy: boolean;
  /** Cancel the round. Absent in a read-only embedding, in which case no
   * button is drawn rather than a dead one. */
  readonly onStop?: (() => void) | undefined;
}

const STATUS_LABEL: Readonly<Record<StepStatus, string>> = {
  queued: "queued",
  running: "running",
  succeeded: "ok",
  failed: "failed",
  skipped: "skipped",
  aborted: "stopped",
};

export function RunPane({ run, busy, onStop }: Props) {
  // Which logs the person has opened or closed by hand. Absent from the
  // map means "whatever the step's status implies".
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());

  if (run === null) {
    return (
      <div className="fd-run">
        <div className="fd-empty">
          <strong>Nothing has run yet.</strong>
          <span>
            Ask for a mini-app in the chat. Every step Studio takes — plan, emit, invariants, the conformance
            gate, the typecheck, the mount probe — shows up here as it happens, with whatever it printed.
          </span>
        </div>
      </div>
    );
  }

  const status = runStatus(run);
  const done = run.steps.filter((step) => step.status !== "queued" && step.status !== "running").length;
  const failed = run.steps.filter((step) => step.status === "failed").length;

  return (
    <div className="fd-run">
      <header className="fd-run__head">
        <span className={`fd-runstatus fd-runstatus--${status}`}>{status}</span>
        <span className="fd-run__count mono">
          {done} / {run.steps.length} step{run.steps.length === 1 ? "" : "s"}
        </span>
        {failed > 0 && <span className="fd-run__failed mono">{failed} failed</span>}
        <span className="fd-tabs__spacer" />
        {busy && onStop !== undefined && (
          <button
            type="button"
            className="fd-stop"
            onClick={onStop}
            disabled={run.abortRequested}
            aria-label="Stop this round"
          >
            {run.abortRequested ? "Stopping…" : "Stop"}
          </button>
        )}
      </header>

      {run.steps.length === 0 ? (
        <p className="fd-note">
          Studio has not reported any steps for this round. The answer is streaming into the chat; nothing here
          is broken, but nothing here is being measured either.
        </p>
      ) : (
        <ol className="fd-steps">
          {run.steps.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              open={overrides.get(step.id) ?? (step.status === "failed" || step.status === "running")}
              onToggle={() => {
                const next = new Map(overrides);
                next.set(step.id, !(overrides.get(step.id) ?? (step.status === "failed" || step.status === "running")));
                setOverrides(next);
              }}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function StepRow({
  step,
  open,
  onToggle,
}: {
  readonly step: Step;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const duration = step.endedAt === null ? null : stepDuration(step, step.endedAt);
  const hasLog = step.log.length > 0 || step.droppedLines > 0;

  return (
    <li className={`fd-step fd-step--${step.status}`}>
      <div className="fd-step__head">
        <span className={`fd-step__pill fd-step__pill--${step.status}`}>{STATUS_LABEL[step.status]}</span>
        <span className="fd-step__label">{step.label}</span>
        {step.detail !== null && <span className="fd-step__detail mono">{step.detail}</span>}
        <span className="fd-tabs__spacer" />
        {step.exitCode !== null && <span className="fd-step__exit mono">exit {step.exitCode}</span>}
        {duration !== null && <span className="fd-step__ms mono">{duration} ms</span>}
        {hasLog && (
          <button type="button" className="fd-step__toggle" aria-expanded={open} onClick={onToggle}>
            {open ? "▾" : "▸"} {step.log.length + step.droppedLines} line
            {step.log.length + step.droppedLines === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {/* The failing step's reason, on the failing step. Not only in the
          chat, where finding it means reading the whole transcript. */}
      {step.error !== null && (
        <p className={`fd-step__error${step.status === "failed" ? "" : " fd-step__error--quiet"}`}>{step.error}</p>
      )}

      {open && hasLog && (
        <div className="fd-step__log">
          {step.droppedLines > 0 && (
            <p className="fd-step__dropped">
              {step.droppedLines} earlier line{step.droppedLines === 1 ? "" : "s"} dropped — the buffer keeps the
              most recent {step.log.length}.
            </p>
          )}
          <pre aria-label={`Output of ${step.label}`}>
            {step.log.map((line) => (
              <span key={line.seq} className={line.stream === "err" ? "fd-out--err" : "fd-out--out"}>
                {line.text}
                {"\n"}
              </span>
            ))}
          </pre>
        </div>
      )}
    </li>
  );
}

/** Exported for a driver that wants the same text a person can see — a
 * bug report, a retry prompt, a clipboard button the shell provides. */
export { logText };
