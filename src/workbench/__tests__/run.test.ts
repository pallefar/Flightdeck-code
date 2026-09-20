/** The step and log model.
 *
 * Most of these are about the log buffer, because that is the part that
 * meets something hostile: a child process writes whenever it likes, in
 * whatever sized chunks the pipe hands over, and a compiler with a bad
 * import writes a great deal of it. Everything else in this package is fed
 * by code we wrote. */
import { describe, expect, it } from "vitest";
import {
  MAX_LINE_CHARS,
  MAX_LOG_LINES,
  createRun,
  createStep,
  endStep,
  failedSteps,
  logText,
  pathsBeingWritten,
  pushOutput,
  runProgress,
  runStatus,
  startStep,
  type Run,
  type Step,
} from "../run";

function step(id = "s1"): Step {
  return createStep({ id, label: "typecheck against the host surface" });
}

describe("log buffering", () => {
  it("joins a line split across chunks instead of showing it as two", () => {
    // What a pipe actually does. `tsc` writing "Checking… " and then
    // "done\n" is ONE line the process printed, and a log that shows two
    // is describing the transport rather than the program.
    let s = step();
    s = pushOutput(s, "Checking 14 files… ");
    s = pushOutput(s, "done\n");
    expect(logText(s)).toBe("Checking 14 files… done");
    expect(s.log).toHaveLength(1);
    expect(s.log[0]?.closed).toBe(true);
  });

  it("does not continue an open line with the other pipe's output", () => {
    // stdout half-written, then stderr. Appending would put the
    // compiler's complaint inside the compiler's progress message.
    let s = step();
    s = pushOutput(s, "building", "out");
    s = pushOutput(s, "error TS2307\n", "err");
    expect(s.log).toHaveLength(2);
    expect(s.log[0]?.stream).toBe("out");
    expect(s.log[1]?.stream).toBe("err");
  });

  it("treats a trailing newline as a terminator, not an empty line", () => {
    let s = pushOutput(step(), "one\ntwo\n");
    expect(s.log.map((line) => line.text)).toEqual(["one", "two"]);
  });

  it("keeps an empty line the process actually printed", () => {
    const s = pushOutput(step(), "one\n\ntwo\n");
    expect(s.log.map((line) => line.text)).toEqual(["one", "", "two"]);
  });

  it("normalises CRLF, so Windows output is not one long line", () => {
    const s = pushOutput(step(), "a\r\nb\r\n");
    expect(s.log.map((line) => line.text)).toEqual(["a", "b"]);
  });

  it("returns the SAME step for an empty chunk", () => {
    // A driver polling a pipe that has nothing must not re-render every
    // subscriber. The store compares by identity.
    const s = step();
    expect(pushOutput(s, "")).toBe(s);
  });

  it("caps the buffer and COUNTS what it dropped", () => {
    let s = step();
    for (let i = 0; i < MAX_LOG_LINES + 100; i += 1) s = pushOutput(s, `line ${i}\n`);
    expect(s.log).toHaveLength(MAX_LOG_LINES);
    expect(s.droppedLines).toBe(100);
    // The tail is what is kept: the end of a failing run names the error.
    expect(s.log[s.log.length - 1]?.text).toBe(`line ${MAX_LOG_LINES + 99}`);
    // And the count is rendered, so the log never silently begins in the
    // middle of a sentence.
    expect(s.log[0]?.text).toBe("line 100");
  });

  it("truncates a single absurd line rather than holding a bundle in memory", () => {
    const s = pushOutput(step(), "x".repeat(MAX_LINE_CHARS * 3) + "\n");
    const text = s.log[0]?.text ?? "";
    expect(text.length).toBeLessThan(MAX_LINE_CHARS + 40);
    expect(text).toContain("truncated");
  });

  it("keeps output after the step ends", () => {
    // The output of the step that failed is the reason anybody opens the
    // pane. Discarding it on completion leaves a red row and no evidence.
    let s = startStep(step(), 1);
    s = pushOutput(s, "error TS2307: Cannot find module 'zod'\n", "err");
    s = endStep(s, "failed", 2, { error: "tsc exited 2", exitCode: 2 });
    expect(logText(s)).toContain("TS2307");
    expect(s.exitCode).toBe(2);
  });
});

describe("step lifecycle", () => {
  it("refuses to move a step that already reached a terminal status", () => {
    const done = endStep(startStep(step(), 1), "succeeded", 2);
    expect(endStep(done, "failed", 3, { error: "late" })).toBe(done);
  });

  it("never lets a failure be recorded without a reason", () => {
    // `endStep(id, "failed")` with no message is a programming error. The
    // pane says so rather than rendering a red row with a blank under it.
    const s = endStep(startStep(step(), 1), "failed", 2);
    expect(s.error).toBe("failed, no reason given");
  });

  it("gives a step that failed before it started a real duration", () => {
    const s = endStep(step(), "failed", 7, { error: "spawn ENOENT" });
    expect(s.startedAt).toBe(7);
    expect(s.endedAt).toBe(7);
  });
});

describe("run aggregates", () => {
  function run(steps: readonly Step[], endedAt: number | null = null): Run {
    return { ...createRun("t1", 0), steps, endedAt };
  }

  it("reports running until the run is closed", () => {
    expect(runStatus(run([endStep(startStep(step(), 1), "succeeded", 2)]))).toBe("running");
  });

  it("calls a run with a stopped step aborted, not failed", () => {
    // Whose call it was is the only thing that separates them, and it is
    // the thing a person wants to know.
    const stopped = endStep(startStep(step("a"), 1), "aborted", 2, { error: "you stopped this round" });
    const broke = endStep(startStep(step("b"), 1), "failed", 2, { error: "boom" });
    expect(runStatus(run([broke, stopped], 3))).toBe("aborted");
    expect(runStatus(run([broke], 3))).toBe("failed");
  });

  it("points at the running step, then the next queued one", () => {
    const a = endStep(startStep(step("a"), 1), "succeeded", 2);
    const b = startStep(createStep({ id: "b", label: "gate" }), 3);
    const c = createStep({ id: "c", label: "mount probe" });
    expect(runProgress(run([a, b, c])).current?.id).toBe("b");
    expect(runProgress(run([a, endStep(b, "succeeded", 4), c])).current?.id).toBe("c");
    expect(runProgress(null).total).toBe(0);
  });

  it("collects the failed steps for the pane that has to answer 'what broke?'", () => {
    const ok = endStep(startStep(step("a"), 1), "succeeded", 2);
    const bad = endStep(startStep(step("b"), 1), "failed", 2, { error: "FD-G001" });
    expect(failedSteps(run([ok, bad], 3)).map((s) => s.id)).toEqual(["b"]);
  });

  it("locks only the paths a RUNNING step is writing", () => {
    // Not the whole run's eventual footprint: locking every file for the
    // run's whole duration makes the editor useless exactly when somebody
    // wants to look at something, and the race only exists during the
    // write.
    const running = startStep(createStep({ id: "a", label: "emit", writes: ["server/subapps/x/manifest.ts"] }), 1);
    const queued = createStep({ id: "b", label: "emit", writes: ["server/subapps/x/routes/index.ts"] });
    const locked = pathsBeingWritten(run([running, queued]));
    expect([...locked]).toEqual(["server/subapps/x/manifest.ts"]);

    const after = pathsBeingWritten(run([endStep(running, "succeeded", 2), queued]));
    expect(after.size).toBe(0);
  });
});
