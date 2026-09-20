import { describe, expect, it, vi } from "vitest";
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
