import { describe, expect, it } from "vitest";
import {
  changeByPath,
  changeSet,
  currentCandidate,
  currentRound,
  fileAt,
  filterBySeverity,
  findingsByPath,
  gateSummary,
  previousRound,
  roundOfTurn,
  touchedFiles,
  treeNodes,
} from "../selectors";
import { createStore } from "../store";
import { candidate, finding, wcClockFiles } from "./fixtures";

function withRounds(n: number) {
  const store = createStore();
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const turnId = store.prompt(`round ${i + 1}`) ?? "";
    const files = wcClockFiles().map((f) =>
      f.kind === "manifest" ? { ...f, contents: f.contents.replace("0.1.0", `0.${i + 1}.0`) } : f,
    );
    const round = store.settle(turnId, candidate({ files }));
    ids.push(round?.id ?? "");
  }
  return { store, ids };
}

describe("round selection", () => {
  it("resolves the current round and the one before it", () => {
    const { store, ids } = withRounds(3);
    expect(currentRound(store.getState())?.id).toBe(ids[2]);
    expect(previousRound(store.getState())?.id).toBe(ids[1]);

    store.selectRound(ids[0] ?? "");
    // The first round has no base — the diff pane needs that to say
    // "first round" instead of rendering everything as an addition.
    expect(previousRound(store.getState())).toBeNull();
  });

  it("returns null for everything when no round is selected", () => {
    const state = createStore().getState();
    expect(currentRound(state)).toBeNull();
    expect(currentCandidate(state)).toBeNull();
    expect(changeSet(state)).toBeNull();
    expect(treeNodes(state)).toEqual([]);
  });

  it("finds the round a turn produced", () => {
    const { store, ids } = withRounds(1);
    const studioTurn = store.getState().turns[1];
    expect(roundOfTurn(store.getState(), studioTurn?.id ?? "")?.id).toBe(ids[0]);
    // The person's own turn produced nothing.
    expect(roundOfTurn(store.getState(), store.getState().turns[0]?.id ?? "")).toBeNull();
  });
});

describe("changeSet memoisation", () => {
  it("returns the SAME object for the same pair of rounds", () => {
    // Not an optimisation. `useSyncExternalStore` compares by identity, so
    // a selector returning a fresh array each call makes the hook believe
    // the store changed on every render — a loop, not a slow frame.
    const { store } = withRounds(2);
    const first = changeSet(store.getState());
    expect(changeSet(store.getState())).toBe(first);
    // Still the same after an unrelated state change.
    store.setView("diff");
    expect(changeSet(store.getState())).toBe(first);
  });

  it("recomputes when the selected round moves", () => {
    const { store, ids } = withRounds(3);
    const third = changeSet(store.getState());
    store.selectRound(ids[1] ?? "");
    const second = changeSet(store.getState());
    expect(second).not.toBe(third);
    // …and comes back to the same object when it moves back.
    store.selectRound(ids[2] ?? "");
    expect(changeSet(store.getState())).toBe(third);
  });

  it("diffs the round against the one before it", () => {
    const { store } = withRounds(2);
    const set = changeSet(store.getState());
    expect(set?.isFirstRound).toBe(false);
    const manifest = set?.changes.find((c) => c.path.endsWith("manifest.ts"));
    expect(manifest?.kind).toBe("modified");
    expect(manifest?.added).toBe(1);
  });
});

describe("touchedFiles", () => {
  it("drops unchanged files and orders added, modified, removed", () => {
    const { store } = withRounds(2);
    const touched = touchedFiles(changeSet(store.getState()));
    expect(touched).toHaveLength(1);
    expect(touched[0]?.kind).toBe("modified");
    expect(touchedFiles(null)).toEqual([]);
  });

  it("keys changes by path for the tree's badges", () => {
    const { store } = withRounds(2);
    const map = changeByPath(changeSet(store.getState()));
    expect(map.get("server/subapps/wc-clock/manifest.ts")?.kind).toBe("modified");
    expect(changeByPath(null).size).toBe(0);
  });
});

describe("findingsByPath", () => {
  it("groups by file and puts errors before warnings", () => {
    const c = candidate({
      findings: [
        finding("FD-X001", "server/subapps/wc-clock/manifest.ts", 30, "warn", "warning"),
        finding("FD-M003", "server/subapps/wc-clock/manifest.ts", 9, "error"),
        finding("FD-G001", "server/subapps/wc-clock/routes/clocks.ts", 4, "error"),
      ],
    });
    const map = findingsByPath(c);
    expect(map.get("server/subapps/wc-clock/manifest.ts")?.map((f) => f.rule)).toEqual(["FD-M003", "FD-X001"]);
    expect(map.get("server/subapps/wc-clock/routes/clocks.ts")).toHaveLength(1);
  });

  it("memoises per candidate", () => {
    const c = candidate();
    expect(findingsByPath(c)).toBe(findingsByPath(c));
    expect(findingsByPath(null).size).toBe(0);
  });
});

describe("gateSummary", () => {
  it("separates rules that ran clean from rules that never ran", () => {
    const clean = gateSummary(candidate({ rulesRun: ["FD-M001", "FD-G001", "FD-X002", "FD-X003"] }));
    expect(clean).toMatchObject({ errors: 0, warnings: 0, rulesRun: 4, rulesClean: 4, shippable: true });

    // The dangerous case: zero errors because nothing was checked.
    const nothing = gateSummary(candidate({ rulesRun: [] }));
    expect(nothing).toMatchObject({ errors: 0, rulesRun: 0, rulesClean: 0 });
  });

  it("does not count a rule as clean when it raised something", () => {
    const summary = gateSummary(
      candidate({
        rulesRun: ["FD-M001", "FD-G001"],
        findings: [finding("FD-G001", "server/subapps/wc-clock/routes/clocks.ts", 4, "no guard")],
      }),
    );
    expect(summary).toMatchObject({ errors: 1, rulesClean: 1, shippable: false });
  });

  it("counts warnings without blocking", () => {
    const summary = gateSummary(
      candidate({ findings: [finding("FD-X001", "(candidate)", 0, "no registry edit", "warning")] }),
    );
    expect(summary).toMatchObject({ errors: 0, warnings: 1, shippable: true });
  });

  it("is safe with no candidate", () => {
    expect(gateSummary(null)).toMatchObject({ rulesRun: 0, shippable: false });
  });
});

describe("filterBySeverity", () => {
  const findings = [
    finding("FD-M003", "a.ts", 1, "e"),
    finding("FD-X001", "b.ts", 1, "w", "warning"),
  ];

  it("filters, and copies rather than aliasing the input", () => {
    expect(filterBySeverity(findings, "error")).toHaveLength(1);
    expect(filterBySeverity(findings, "warning")).toHaveLength(1);
    const all = filterBySeverity(findings, "all");
    expect(all).toHaveLength(2);
    expect(all).not.toBe(findings);
  });
});

describe("fileAt", () => {
  it("finds a file in the selected round, and null for anything else", () => {
    const { store } = withRounds(1);
    expect(fileAt(store.getState(), "server/subapps/wc-clock/manifest.ts")?.kind).toBe("manifest");
    expect(fileAt(store.getState(), "nope.ts")).toBeNull();
    expect(fileAt(store.getState(), null)).toBeNull();
  });
});
