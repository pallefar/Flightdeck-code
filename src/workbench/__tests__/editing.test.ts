/** Drafts, locks and the conflict policy.
 *
 * The reconciliation cases are the ones worth having. Every other test in
 * this file describes a state machine; those describe the moment a person
 * loses work, and each one names which of the two texts survives and why. */
import { describe, expect, it } from "vitest";
import {
  EDITABLE_MAX_BYTES,
  applyDrafts,
  draftState,
  editDraft,
  editability,
  editSummary,
  isDirty,
  looksBinary,
  openDraft,
  reconcileDrafts,
  resolveDraft,
  revertDraft,
  saveDraft,
  type Draft,
} from "../editing";
import type { GeneratedFile } from "../types";

const PATH = "server/subapps/wc-clock/routes/clocks.ts";

function file(path: string, contents: string): GeneratedFile {
  return { path, contents, kind: "routes-domain" };
}

function draft(contents = "original\n", roundId = "r1"): Draft {
  return openDraft(file(PATH, contents), roundId);
}

describe("draft state", () => {
  it("is clean when opened, dirty once typed in, and saved once committed", () => {
    const opened = draft();
    expect(draftState(opened)).toBe("clean");

    const typed = editDraft(opened, "changed\n");
    expect(draftState(typed)).toBe("dirty");
    expect(isDirty(typed)).toBe(true);

    const saved = saveDraft(typed);
    expect(draftState(saved)).toBe("saved");
    expect(isDirty(saved)).toBe(false);
  });

  it("reverts to the last SAVED text, not to the generated one", () => {
    // The distinction the two buttons exist for: revert undoes typing,
    // "restore generated" undoes the edit. Collapsing them into one undo
    // is how somebody loses work they believed they had saved.
    const saved = saveDraft(editDraft(draft(), "mine v1\n"));
    const typedMore = editDraft(saved, "mine v2\n");
    expect(revertDraft(typedMore).buffer).toBe("mine v1\n");
    expect(revertDraft(typedMore).saved).toBe("mine v1\n");
  });

  it("returns the same object when nothing moved", () => {
    const d = draft();
    expect(editDraft(d, d.buffer)).toBe(d);
    expect(revertDraft(d)).toBe(d);
    const once = saveDraft(d);
    expect(saveDraft(once)).toBe(once);
  });
});

describe("the overlay", () => {
  const files = [file(PATH, "generated\n"), file("server/subapps/wc-clock/manifest.ts", "m\n")];

  it("applies saved text and leaves the array identical when nothing is saved", () => {
    const drafts = new Map([[PATH, editDraft(draft(), "typed but not saved\n")]]);
    // Typing is theirs alone until they save it — every other pane reads
    // the saved text or the generated one, never a half-typed buffer.
    expect(applyDrafts(files, drafts, "r1")).toBe(files);

    const saved = new Map([[PATH, saveDraft(editDraft(draft(), "mine\n"))]]);
    const out = applyDrafts(files, saved, "r1");
    expect(out.find((f) => f.path === PATH)?.contents).toBe("mine\n");
  });

  it("keeps a file the round removed once the person chose to keep theirs", () => {
    // Otherwise "keep mine" on a removed file is a no-op with a message.
    const held = saveDraft(editDraft(draft(), "mine\n"));
    const out = applyDrafts([files[1] as GeneratedFile], new Map([[PATH, held]]), "r1");
    expect(out.map((f) => f.path)).toContain(PATH);
    expect(out.find((f) => f.path === PATH)?.contents).toBe("mine\n");
  });

  it("does NOT apply a draft anchored to another round", () => {
    const drafts = new Map([[PATH, saveDraft(editDraft(draft("generated\n", "r0"), "mine\n"))]]);
    expect(applyDrafts(files, drafts, "r1")).toBe(files);
  });

  it("does NOT apply a draft with an unresolved conflict", () => {
    // While a conflict is open the panes show what shipping would
    // produce. Overlaying a held version would make the diff, the preview
    // and the gate's line numbers all describe a file nobody agreed to.
    const conflicted: Draft = {
      ...saveDraft(editDraft(draft(), "mine\n")),
      conflict: { kind: "regenerated", incoming: "theirs\n", held: "mine\n", fromLock: false, at: 1 },
    };
    expect(applyDrafts(files, new Map([[PATH, conflicted]]), "r1")).toBe(files);
  });
});

describe("reconciling a new round", () => {
  const before = [file(PATH, "generated v1\n")];
  const after = [file(PATH, "generated v2\n")];

  function reconcile(drafts: Iterable<readonly [string, Draft]>, locks: string[] = []) {
    return reconcileDrafts({
      drafts: new Map(drafts),
      locks: new Set(locks),
      previousFiles: before,
      nextFiles: after,
      nextRoundId: "r2",
      at: 99,
    });
  }

  it("drops a draft nobody typed in — there is nothing to ask about", () => {
    expect(reconcile([[PATH, draft("generated v1\n")]]).size).toBe(0);
  });

  it("drops a draft the round happens to reproduce exactly", () => {
    // The generator agreed with them. There is no edit left to hold, so
    // asking "yours or theirs?" about two identical texts is noise.
    const agreed = saveDraft(editDraft(draft("generated v1\n"), "generated v2\n"));
    expect(reconcile([[PATH, agreed]]).size).toBe(0);
  });

  it("raises a conflict rather than letting either side win silently", () => {
    const mine = saveDraft(editDraft(draft("generated v1\n"), "mine\n"));
    const out = reconcile([[PATH, mine]]);
    const conflict = out.get(PATH)?.conflict;
    expect(conflict?.kind).toBe("regenerated");
    expect(conflict?.incoming).toBe("generated v2\n");
    // Held verbatim: "keep mine" has to mean the text they can see.
    expect(conflict?.held).toBe("mine\n");
    expect(out.get(PATH)?.roundId).toBe("r2");
  });

  it("raises a conflict for UNSAVED typing too", () => {
    const typing = editDraft(draft("generated v1\n"), "half a fix\n");
    expect(reconcile([[PATH, typing]]).get(PATH)?.conflict?.held).toBe("generated v1\n");
    expect(reconcile([[PATH, typing]]).get(PATH)?.buffer).toBe("half a fix\n");
  });

  it("raises a REMOVED conflict when the round dropped the file", () => {
    const mine = saveDraft(editDraft(draft("generated v1\n"), "mine\n"));
    const out = reconcileDrafts({
      drafts: new Map([[PATH, mine]]),
      locks: new Set(),
      previousFiles: before,
      nextFiles: [],
      nextRoundId: "r2",
      at: 99,
    });
    expect(out.get(PATH)?.conflict).toMatchObject({ kind: "removed", incoming: null });
  });

  it("opens a conflict on a LOCKED file the person never touched", () => {
    // The whole promise of a lock, and the only one this workbench can
    // keep on its own: a file you claimed cannot change under you quietly.
    const out = reconcile([], [PATH]);
    expect(out.get(PATH)?.conflict).toMatchObject({ fromLock: true, kind: "regenerated" });
    expect(out.get(PATH)?.conflict?.held).toBe("generated v1\n");
  });

  it("leaves a locked file alone when the round did not change it", () => {
    const out = reconcileDrafts({
      drafts: new Map(),
      locks: new Set([PATH]),
      previousFiles: before,
      nextFiles: before,
      nextRoundId: "r2",
      at: 99,
    });
    expect(out.size).toBe(0);
  });

  it("carries an unanswered conflict into a further round instead of re-pointing it", () => {
    // They were asked a question and have not answered it. Only the
    // incoming text is refreshed, so answering later applies against what
    // the round actually contains now.
    const mine = saveDraft(editDraft(draft("generated v1\n"), "mine\n"));
    const first = reconcile([[PATH, mine]]);
    const second = reconcileDrafts({
      drafts: first,
      locks: new Set(),
      previousFiles: after,
      nextFiles: [file(PATH, "generated v3\n")],
      nextRoundId: "r3",
      at: 100,
    });
    expect(second.get(PATH)?.conflict?.incoming).toBe("generated v3\n");
    expect(second.get(PATH)?.conflict?.held).toBe("mine\n");
  });

  it("returns the SAME map when nothing moved", () => {
    const drafts = new Map<string, Draft>();
    expect(reconcileDrafts({
      drafts,
      locks: new Set(),
      previousFiles: before,
      nextFiles: before,
      nextRoundId: "r2",
      at: 1,
    })).toBe(drafts);
  });
});

describe("resolving", () => {
  const conflicted: Draft = {
    ...draft("generated v1\n"),
    saved: "mine\n",
    buffer: "mine\n",
    conflict: { kind: "regenerated", incoming: "generated v2\n", held: "mine\n", fromLock: false, at: 1 },
  };

  it("'mine' re-bases the held text onto the new round", () => {
    // The baseline becomes what Studio last produced, so the diff answers
    // "what did I change relative to the current round" rather than
    // relative to a round that no longer exists.
    const out = resolveDraft(conflicted, "mine");
    expect(out?.generated).toBe("generated v2\n");
    expect(out?.saved).toBe("mine\n");
    expect(out?.conflict).toBeNull();
  });

  it("'studio' removes the draft entirely, leaving nothing to overlay later", () => {
    expect(resolveDraft(conflicted, "studio")).toBeNull();
  });
});

describe("editability", () => {
  it("refuses while a running step is writing the file", () => {
    const can = editability(file(PATH, "x\n"), new Set([PATH]));
    expect(can.editable).toBe(false);
    expect(can.reason).toContain("writing this file right now");
  });

  it("refuses a file too large to type into, and says how large", () => {
    const can = editability(file(PATH, "x".repeat(EDITABLE_MAX_BYTES + 1)));
    expect(can.editable).toBe(false);
    expect(can.reason).toContain("KB");
  });

  it("refuses something that did not decode as source", () => {
    expect(looksBinary("const a = 1;\n")).toBe(false);
    expect(looksBinary("PK\u0003\u0004\u0000\u0000")).toBe(true);
    expect(editability(file(PATH, "\u0000\u0001\u0002")).editable).toBe(false);
  });

  it("allows an ordinary generated file", () => {
    expect(editability(file(PATH, "export const x = 1;\n")).editable).toBe(true);
  });
});

describe("summary", () => {
  it("counts what is unsaved, edited, conflicted and locked", () => {
    const dirty = editDraft(draft("a\n"), "typed\n");
    const saved = saveDraft(editDraft(openDraft(file("b", "b\n"), "r1"), "mine\n"));
    const conflicted: Draft = {
      ...openDraft(file("c", "c\n"), "r1"),
      conflict: { kind: "regenerated", incoming: "x\n", held: "c\n", fromLock: true, at: 1 },
    };
    const out = editSummary(
      new Map([[PATH, dirty], ["b", saved], ["c", conflicted]]),
      new Set(["c"]),
    );
    expect(out).toEqual({ dirty: 1, saved: 1, conflicted: 1, locked: 1 });
  });
});
