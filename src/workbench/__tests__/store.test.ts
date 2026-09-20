import { describe, expect, it, vi } from "vitest";
import { changeSet, currentCandidate } from "../selectors";
import { createStore, defaultSelection } from "../store";
import { ALL_ENABLED, isEnabled, refusingLayer } from "../types";
import { candidate, candidateOf } from "./fixtures";

/** A store with a readable clock and readable ids. Every test that asserts
 * on a timestamp or an id would otherwise be asserting on `Date.now()`. */
function store() {
  let tick = 1000;
  let n = 0;
  return createStore({
    clock: () => {
      tick += 10;
      return tick;
    },
    ids: () => {
      n += 1;
      return `id${n}`;
    },
  });
}

describe("initial state", () => {
  it("starts empty, on the files pane, with all three enable layers on", () => {
    const state = store().getState();
    expect(state.turns).toEqual([]);
    expect(state.rounds).toEqual([]);
    expect(state.selectedRoundId).toBeNull();
    expect(state.selectedPath).toBeNull();
    expect(state.view).toBe("files");
    expect(state.busy).toBe(false);
    expect(state.enable).toEqual(ALL_ENABLED);
  });
});

describe("prompt", () => {
  it("appends the person's turn and the Studio turn it will stream into", () => {
    const s = store();
    const turnId = s.prompt("build me a works council clock");

    const { turns } = s.getState();
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "you", text: "build me a works council clock", status: "settled" });
    expect(turns[1]).toMatchObject({ role: "studio", text: "", status: "streaming" });
    // The handle returned is the STUDIO turn — streaming into the person's
    // own message would be a silent corruption of the transcript.
    expect(turnId).toBe(turns[1]?.id);
    expect(s.getState().busy).toBe(true);
  });

  it("trims, and refuses a blank prompt without opening a turn", () => {
    const s = store();
    expect(s.prompt("   \n  ")).toBeNull();
    expect(s.getState().turns).toEqual([]);

    s.prompt("  spaced  ");
    expect(s.getState().turns[0]?.text).toBe("spaced");
  });

  it("refuses a second prompt while a round is in flight", () => {
    const s = store();
    s.prompt("first");
    const before = s.getState();

    expect(s.prompt("second")).toBeNull();
    // Not merely rejected — nothing moved. Two concurrent rounds would both
    // diff against the same base and the second would clobber the first.
    expect(s.getState()).toBe(before);
  });
});

describe("streaming", () => {
  it("accumulates chunks on the streaming turn", () => {
    const s = store();
    const id = s.prompt("go") ?? "";
    s.stream(id, "Planning");
    s.stream(id, " the manifest…");
    expect(s.getState().turns[1]?.text).toBe("Planning the manifest…");
  });

  it("ignores an empty chunk, an unknown turn and a turn that already settled", () => {
    const s = store();
    const id = s.prompt("go") ?? "";
    s.stream(id, "text");
    const before = s.getState();

    s.stream(id, "");
    s.stream("nope", "text");
    expect(s.getState()).toBe(before);

    s.settle(id, candidate());
    const settled = s.getState();
    s.stream(id, " more");
    // A stream that outlives its turn must not resurrect it.
    expect(s.getState().turns).toBe(settled.turns);
  });
});

describe("settle", () => {
  it("creates the round, selects it, opens the manifest and clears busy in ONE commit", () => {
    const s = store();
    const listener = vi.fn();
    const id = s.prompt("build it") ?? "";
    s.subscribe(listener);

    const round = s.settle(id, candidate());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(round?.ordinal).toBe(1);
    expect(round?.prompt).toBe("build it");

    const state = s.getState();
    expect(state.selectedRoundId).toBe(round?.id);
    expect(state.busy).toBe(false);
    expect(state.turns[1]).toMatchObject({ status: "settled", roundId: round?.id });
    // The manifest, not `guard.ts` — the file that decides whether the host
    // boots, rather than the one that is identical in every sub-app.
    expect(state.selectedPath).toBe("server/subapps/wc-clock/manifest.ts");
  });

  it("numbers rounds from one and appends rather than replacing", () => {
    const s = store();
    const first = s.settle(s.prompt("a") ?? "", candidate());
    const second = s.settle(s.prompt("b") ?? "", candidate());

    expect([first?.ordinal, second?.ordinal]).toEqual([1, 2]);
    expect(s.getState().rounds).toHaveLength(2);
    // Append-only: "what changed this round" is a question about two file
    // sets, and overwriting a round destroys the only record of the answer.
    expect(s.getState().rounds[0]?.id).toBe(first?.id);
  });

  it("refuses to settle a turn that is not streaming", () => {
    const s = store();
    const id = s.prompt("a") ?? "";
    s.settle(id, candidate());
    expect(s.settle(id, candidate())).toBeNull();
    expect(s.getState().rounds).toHaveLength(1);
  });

  it("takes the round's prompt from the nearest preceding turn of the person", () => {
    const s = store();
    s.settle(s.prompt("first ask") ?? "", candidate());
    const round = s.settle(s.prompt("second ask") ?? "", candidate());
    expect(round?.prompt).toBe("second ask");
  });
});

describe("refusal is not failure", () => {
  it("keeps the two apart, because painting them the same teaches people to ignore both", () => {
    const s = store();
    s.refuse(s.prompt("read the filesystem") ?? "", "A sub-app may not import node:fs (§5.3).");
    expect(s.getState().turns[1]).toMatchObject({
      status: "refused",
      text: "A sub-app may not import node:fs (§5.3).",
    });
    expect(s.getState().busy).toBe(false);

    const t = store();
    t.fail(t.prompt("go") ?? "", "the model timed out");
    expect(t.getState().turns[1]?.status).toBe("failed");
    expect(t.getState().busy).toBe(false);
  });
});

describe("subscription discipline", () => {
  it("notifies once per real change and NEVER on a no-op", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidate());

    const listener = vi.fn();
    s.subscribe(listener);

    s.selectFile("server/subapps/wc-clock/routes/clocks.ts");
    expect(listener).toHaveBeenCalledTimes(1);

    // The case that matters: `useSyncExternalStore` compares by identity, so
    // a store that notified here would re-render the workbench on every
    // click that changed nothing — and loop if a component committed during
    // render.
    const snapshot = s.getState();
    s.selectFile("server/subapps/wc-clock/routes/clocks.ts");
    s.setView("files");
    s.setEnable({ killSwitch: true });
    s.setSeverityFilter("all");
    s.focusRule(null);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.getState()).toBe(snapshot);
  });

  it("stops notifying after unsubscribe", () => {
    const s = store();
    const listener = vi.fn();
    const off = s.subscribe(listener);
    s.setView("diff");
    off();
    s.setView("preview");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("navigation", () => {
  it("revealFile opens the file AND the pane that shows files", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidate());
    s.setView("gate");
    s.revealFile("server/subapps/wc-clock/routes/clocks.ts");
    expect(s.getState()).toMatchObject({
      view: "files",
      selectedPath: "server/subapps/wc-clock/routes/clocks.ts",
    });
  });

  it("toggles a directory closed and open again", () => {
    const s = store();
    s.toggleDir("server/subapps/wc-clock/routes");
    expect(s.getState().collapsedDirs.has("server/subapps/wc-clock/routes")).toBe(true);
    s.toggleDir("server/subapps/wc-clock/routes");
    expect(s.getState().collapsedDirs.has("server/subapps/wc-clock/routes")).toBe(false);
  });

  it("keeps the open file when moving between rounds that both have it", () => {
    const s = store();
    const first = s.settle(s.prompt("a") ?? "", candidate());
    s.settle(s.prompt("b") ?? "", candidate());
    s.selectFile("server/subapps/wc-clock/routes/review.ts");

    s.selectRound(first?.id ?? "");
    // Comparing the SAME file across rounds is the common motion; a pane
    // that snapped back to the manifest every time would defeat it.
    expect(s.getState().selectedPath).toBe("server/subapps/wc-clock/routes/review.ts");
  });

  it("falls back to the default file when the round does not have the open one", () => {
    const s = store();
    const first = s.settle(s.prompt("a") ?? "", candidateOf([{ path: "server/subapps/x/manifest.ts", kind: "manifest" }]));
    s.settle(s.prompt("b") ?? "", candidate());
    s.selectFile("server/subapps/wc-clock/routes/review.ts");

    s.selectRound(first?.id ?? "");
    expect(s.getState().selectedPath).toBe("server/subapps/x/manifest.ts");
  });

  it("ignores an unknown round id", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidate());
    const before = s.getState();
    s.selectRound("nope");
    expect(s.getState()).toBe(before);
  });
});

describe("enable layers", () => {
  it("merges patches and leaves the other layers alone", () => {
    const s = store();
    s.setEnable({ ceiling: false });
    expect(s.getState().enable).toEqual({ killSwitch: true, ceiling: false, project: true });
    s.setEnable({ killSwitch: false });
    expect(s.getState().enable).toEqual({ killSwitch: false, ceiling: false, project: true });
  });

  it("is an AND of all three, and names the layer that refused", () => {
    // Contract §4: fail-closed, and the message has to name the actual
    // cause — "disabled" tells the person nothing they can act on.
    expect(isEnabled(ALL_ENABLED)).toBe(true);
    expect(isEnabled({ ...ALL_ENABLED, project: false })).toBe(false);
    expect(refusingLayer(ALL_ENABLED)).toBeNull();
    expect(refusingLayer({ ...ALL_ENABLED, ceiling: false })).toBe("ceiling");
    // The kill switch is reported first: it is the outermost layer, and
    // fixing an inner one while it is off changes nothing.
    expect(refusingLayer({ killSwitch: false, ceiling: false, project: false })).toBe("killSwitch");
  });
});

describe("defaultSelection", () => {
  it("prefers the manifest", () => {
    expect(defaultSelection(candidate())).toBe("server/subapps/wc-clock/manifest.ts");
  });

  it("falls back to the first path alphabetically when there is no manifest", () => {
    const c = candidateOf([{ path: "b/two.ts" }, { path: "a/one.ts" }]);
    expect(defaultSelection(c)).toBe("a/one.ts");
  });

  it("returns null for an empty file set rather than throwing", () => {
    expect(defaultSelection(candidateOf([]))).toBeNull();
  });
});

describe("reset", () => {
  it("clears everything and tells subscribers", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidate());
    const listener = vi.fn();
    s.subscribe(listener);

    s.reset();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(s.getState().rounds).toEqual([]);
    expect(s.getState().turns).toEqual([]);
    expect(s.getState().selectedPath).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// What the builder is doing, and the person's hands on it.
// ─────────────────────────────────────────────────────────────────────────

describe("run steps", () => {
  it("declares steps up front, then moves them one at a time", () => {
    const s = store();
    const turnId = s.prompt("build it") ?? "";
    s.plan(turnId, [
      { id: "plan", label: "plan against the contract" },
      { id: "emit", label: "emit source", writes: ["server/subapps/wc-clock/manifest.ts"] },
      { id: "tsc", label: "typecheck against the host surface" },
    ]);

    // The shape of the work is itself information: a person can see the
    // typecheck has not run yet, so a green gate means nothing.
    expect(s.getState().runs[0]?.steps.map((step) => step.status)).toEqual(["queued", "queued", "queued"]);
    // And the pane it happens on is the one they are looking at.
    expect(s.getState().view).toBe("run");

    s.startStep("plan");
    s.endStep("plan", "succeeded");
    s.startStep("emit");
    expect(s.getState().runs[0]?.steps.map((step) => step.status)).toEqual(["succeeded", "running", "queued"]);
  });

  it("keeps a failed step's process output after the step ends", () => {
    const s = store();
    const turnId = s.prompt("build it") ?? "";
    s.plan(turnId, [{ id: "tsc", label: "typecheck" }]);
    s.startStep("tsc");
    s.output("tsc", "Checking 6 files… ");
    s.output("tsc", "done\n");
    s.output("tsc", "error TS2307: Cannot find module 'zod'\n", "err");
    s.endStep("tsc", "failed", { error: "tsc exited 2", exitCode: 2 });

    const step = s.getState().runs[0]?.steps[0];
    expect(step?.status).toBe("failed");
    expect(step?.error).toBe("tsc exited 2");
    expect(step?.exitCode).toBe(2);
    // The output of the step that failed is the reason anyone opens the
    // pane. It survives the step.
    expect(step?.log.map((line) => line.text)).toEqual([
      "Checking 6 files… done",
      "error TS2307: Cannot find module 'zod'",
    ]);
    expect(step?.log[1]?.stream).toBe("err");
  });

  it("ignores output for an unknown step rather than inventing one", () => {
    const s = store();
    s.prompt("build it");
    const before = s.getState();
    s.output("nope", "text");
    s.endStep("nope", "failed", { error: "x" });
    expect(s.getState()).toBe(before);
  });

  it("puts the failure on the failing step, not only in the chat", () => {
    const s = store();
    const turnId = s.prompt("build it") ?? "";
    s.plan(turnId, [
      { id: "gate", label: "conformance gate" },
      { id: "tsc", label: "typecheck" },
    ]);
    s.startStep("gate");
    s.fail(turnId, "FD-Z001: the gate itself threw");

    const [gate, tsc] = s.getState().runs[0]?.steps ?? [];
    expect(gate).toMatchObject({ status: "failed", error: "FD-Z001: the gate itself threw" });
    // And the one that never got its turn says so, rather than sitting
    // queued forever under a finished run.
    expect(tsc?.status).toBe("skipped");
    expect(tsc?.error).toContain("not reached");
    expect(s.getState().busy).toBe(false);
    expect(s.getState().view).toBe("run");
  });
});

describe("stopping a round", () => {
  it("marks the intent first, so the button can say so before anything unwinds", () => {
    const s = store();
    const turnId = s.prompt("build it") ?? "";
    expect(s.requestAbort()).toBe(turnId);
    expect(s.getState().runs[0]?.abortRequested).toBe(true);
    // Asking twice is not a second round of anything.
    expect(s.requestAbort()).toBeNull();
  });

  it("ends the round with no candidate, and files it as stopped rather than failed", () => {
    const s = store();
    const turnId = s.prompt("build it") ?? "";
    s.plan(turnId, [
      { id: "emit", label: "emit source" },
      { id: "tsc", label: "typecheck" },
    ]);
    s.startStep("emit");
    s.abort(turnId, "Stopped.");

    const state = s.getState();
    expect(state.busy).toBe(false);
    expect(state.rounds).toHaveLength(0);
    // Not "failed": nothing went wrong and nothing was refused. A UI that
    // files a cancelled round under failure makes a person doubt their own
    // hand on the button.
    expect(state.turns[1]?.status).toBe("aborted");
    expect(state.runs[0]?.steps[0]?.status).toBe("aborted");
    expect(state.runs[0]?.steps[1]?.status).toBe("skipped");
  });

  it("drops output and a candidate that arrive after the stop", () => {
    // The stop button is only worth believing if a driver that cannot be
    // cancelled has its work discarded rather than landing in a round the
    // person already stopped.
    const s = store();
    const turnId = s.prompt("build it") ?? "";
    s.abort(turnId);
    const stopped = s.getState();

    s.stream(turnId, "…still generating");
    expect(s.settle(turnId, candidate())).toBeNull();
    expect(s.getState().turns).toBe(stopped.turns);
    expect(s.getState().rounds).toHaveLength(0);
  });
});

describe("editing", () => {
  const MANIFEST = "server/subapps/wc-clock/manifest.ts";

  function withRound() {
    const s = store();
    s.settle(s.prompt("build it") ?? "", candidate());
    return s;
  }

  it("opens a draft on the first keystroke and leaves the round untouched", () => {
    const s = withRound();
    expect(s.editFile(MANIFEST, "// mine\n")).toBeNull();

    const state = s.getState();
    expect(state.drafts.get(MANIFEST)?.buffer).toBe("// mine\n");
    // Rounds are append-only. The edit is an overlay, not a mutation.
    expect(state.rounds[0]?.candidate.files.find((f) => f.path === MANIFEST)?.contents).toContain("GENERATED by Flightdeck Studio");
  });

  it("does not move the overlay until it is saved", () => {
    const s = withRound();
    s.editFile(MANIFEST, "// mine\n");
    // Typing is theirs alone: no pane reads a half-typed buffer, and — the
    // part that matters for performance — a keystroke does not invalidate
    // the diff of every file in the round.
    expect(currentCandidate(s.getState())?.files.find((f) => f.path === MANIFEST)?.contents).not.toBe("// mine\n");
    expect(s.getState().editEpoch).toBe(0);

    s.saveFile(MANIFEST);
    expect(s.getState().editEpoch).toBe(1);
    expect(currentCandidate(s.getState())?.files.find((f) => f.path === MANIFEST)?.contents).toBe("// mine\n");
  });

  it("shows a saved edit in the diff, not only in the editor", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidateOf([{ path: "a.ts", contents: "one\n" }]));
    s.settle(s.prompt("b") ?? "", candidateOf([{ path: "a.ts", contents: "one\ntwo\n" }]));
    expect(changeSet(s.getState())?.changes[0]).toMatchObject({ kind: "modified", added: 1 });

    s.editFile("a.ts", "one\ntwo\nthree\n");
    s.saveFile("a.ts");
    // One authoritative model: the diff answers "what is different", not
    // "what did the generator change".
    expect(changeSet(s.getState())?.changes[0]).toMatchObject({ kind: "modified", added: 2 });
  });

  it("reverts unsaved typing, and restores the generated text separately", () => {
    const s = withRound();
    s.editFile(MANIFEST, "// v1\n");
    s.saveFile(MANIFEST);
    s.editFile(MANIFEST, "// v2\n");

    s.revertFile(MANIFEST);
    expect(s.getState().drafts.get(MANIFEST)?.buffer).toBe("// v1\n");

    s.restoreGenerated(MANIFEST);
    expect(s.getState().drafts.has(MANIFEST)).toBe(false);
    expect(currentCandidate(s.getState())?.files.find((f) => f.path === MANIFEST)?.contents).toContain("GENERATED by Flightdeck Studio");
  });

  it("refuses to edit a file a running step says it is writing", () => {
    const s = withRound();
    const turnId = s.prompt("again") ?? "";
    s.plan(turnId, [{ id: "emit", label: "emit source", writes: [MANIFEST] }]);
    s.startStep("emit");

    expect(s.editFile(MANIFEST, "// mine\n")).toContain("writing this file right now");
    // And it unlocks when the step finishes, rather than for the round.
    s.endStep("emit", "succeeded");
    expect(s.editFile(MANIFEST, "// mine\n")).toBeNull();
  });

  it("refuses to edit an earlier round, and says why", () => {
    const s = store();
    const first = s.settle(s.prompt("a") ?? "", candidateOf([{ path: "a.ts" }]));
    s.settle(s.prompt("b") ?? "", candidateOf([{ path: "a.ts", contents: "// two\n" }]));
    s.selectRound(first?.id ?? "");

    expect(s.editFile("a.ts", "// mine\n")).toContain("record");

    const fresh = store();
    fresh.settle(fresh.prompt("a") ?? "", candidateOf([{ path: "a.ts" }]));
    expect(fresh.editFile("nope.ts", "x")).toContain("not in this round");
  });
});

describe("a round landing on top of an edit", () => {
  it("holds both texts and applies neither, in the same commit as the round", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidateOf([{ path: "a.ts", contents: "generated v1\n" }]));
    s.editFile("a.ts", "mine\n");
    s.saveFile("a.ts");

    const turnId = s.prompt("b") ?? "";
    const listener = vi.fn();
    s.subscribe(listener);
    s.settle(turnId, candidateOf([{ path: "a.ts", contents: "generated v2\n" }]));

    // One commit: a subscriber never sees the new round's files beside
    // the old round's drafts.
    expect(listener).toHaveBeenCalledTimes(1);

    const state = s.getState();
    const draft = state.drafts.get("a.ts");
    expect(draft?.conflict).toMatchObject({ kind: "regenerated", incoming: "generated v2\n", held: "mine\n" });
    // What shipping would produce is what the panes show, until somebody
    // decides otherwise.
    expect(currentCandidate(state)?.files[0]?.contents).toBe("generated v2\n");
    // And the file in question is the one that is open.
    expect(state.selectedPath).toBe("a.ts");
  });

  it("applies the person's text again once they keep it", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidateOf([{ path: "a.ts", contents: "generated v1\n" }]));
    s.editFile("a.ts", "mine\n");
    s.saveFile("a.ts");
    s.settle(s.prompt("b") ?? "", candidateOf([{ path: "a.ts", contents: "generated v2\n" }]));

    s.resolveConflict("a.ts", "mine");
    expect(currentCandidate(s.getState())?.files[0]?.contents).toBe("mine\n");
    // Re-based: the baseline is now what Studio last produced.
    expect(s.getState().drafts.get("a.ts")?.generated).toBe("generated v2\n");
  });

  it("forgets the edit entirely once they take Studio's", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidateOf([{ path: "a.ts", contents: "generated v1\n" }]));
    s.editFile("a.ts", "mine\n");
    s.saveFile("a.ts");
    s.settle(s.prompt("b") ?? "", candidateOf([{ path: "a.ts", contents: "generated v2\n" }]));

    s.resolveConflict("a.ts", "studio");
    expect(s.getState().drafts.has("a.ts")).toBe(false);
    expect(currentCandidate(s.getState())?.files[0]?.contents).toBe("generated v2\n");
  });

  it("takes locks back from a driver that persisted them", () => {
    // The workbench owns no storage medium — a component that reaches for
    // `localStorage` cannot be rendered on a server or asserted on in
    // node — so persistence is the driver's, and this is the way back in.
    const s = store();
    s.restoreLocks(["a.ts", "b.ts"]);
    expect([...s.getState().locks]).toEqual(["a.ts", "b.ts"]);
    const before = s.getState();
    s.restoreLocks(["a.ts"]);
    expect(s.getState()).toBe(before);
  });

  it("tells a person their LOCKED file changed even though they never typed in it", () => {
    const s = store();
    s.settle(s.prompt("a") ?? "", candidateOf([{ path: "a.ts", contents: "generated v1\n" }]));
    s.toggleLock("a.ts");
    s.settle(s.prompt("b") ?? "", candidateOf([{ path: "a.ts", contents: "generated v2\n" }]));

    expect(s.getState().drafts.get("a.ts")?.conflict).toMatchObject({ fromLock: true });
    expect(s.getState().locks.has("a.ts")).toBe(true);
  });
});
