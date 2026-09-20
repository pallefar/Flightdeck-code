import { describe, expect, it } from "vitest";
import {
  CONTEXT_LINES,
  diffFileSets,
  diffLines,
  pairedEdit,
  segmentPair,
  splitLines,
  toHunks,
} from "../diff";

const render = (text: string) => diffLines(text, text);

describe("splitLines", () => {
  it("treats a trailing newline as a terminator, not an empty last line", () => {
    // Every generated file ends in "\n". Counting that as a line makes each
    // one report a phantom final line and makes adding a real last line
    // look like a modification.
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
  });

  it("normalises CRLF and lone CR", () => {
    expect(splitLines("a\r\nb\rc\n")).toEqual(["a", "b", "c"]);
  });
});

describe("diffLines", () => {
  it("reports nothing for identical text", () => {
    const d = render("one\ntwo\nthree\n");
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.ops.every((op) => op.kind === "context")).toBe(true);
  });

  it("keeps the unchanged tail unchanged when a block is inserted", () => {
    // The failure mode of the reference's 3-line look-ahead: insert four
    // lines and everything after them is reported as modified. A reviewer
    // deciding whether a sub-app is safe cannot find the real change in
    // 200 false ones.
    const before = "head\nTAIL1\nTAIL2\nTAIL3\nTAIL4\n";
    const after = "head\nnew1\nnew2\nnew3\nnew4\nTAIL1\nTAIL2\nTAIL3\nTAIL4\n";
    const d = diffLines(before, after);

    expect(d.added).toBe(4);
    expect(d.removed).toBe(0);
    expect(d.ops.filter((op) => op.kind === "add").map((op) => op.text)).toEqual([
      "new1",
      "new2",
      "new3",
      "new4",
    ]);
  });

  it("numbers lines in the coordinates of each side", () => {
    const d = diffLines("a\nb\nc\n", "a\nx\nc\n");
    const removed = d.ops.find((op) => op.kind === "remove");
    const added = d.ops.find((op) => op.kind === "add");
    expect(removed).toMatchObject({ beforeLine: 2, afterLine: null, text: "b" });
    expect(added).toMatchObject({ beforeLine: null, afterLine: 2, text: "x" });
    // Context after the change carries both numbers, which is what lets the
    // pane render a two-column gutter.
    expect(d.ops[d.ops.length - 1]).toMatchObject({ beforeLine: 3, afterLine: 3 });
  });

  it("handles a file that appears and a file that empties", () => {
    expect(diffLines("", "a\nb\n")).toMatchObject({ added: 2, removed: 0 });
    expect(diffLines("a\nb\n", "")).toMatchObject({ added: 0, removed: 2 });
  });

  it("reports line numbers correctly after a trimmed common prefix", () => {
    const before = ["1", "2", "3", "4", "5", "OLD", "7", "8"].join("\n");
    const after = ["1", "2", "3", "4", "5", "NEW", "7", "8"].join("\n");
    const d = diffLines(before, after);
    expect(d.ops.find((op) => op.kind === "remove")?.beforeLine).toBe(6);
    expect(d.ops.find((op) => op.kind === "add")?.afterLine).toBe(6);
  });

  it("is not truncated for a realistic file", () => {
    const a = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const b = a.replace("line 200", "line 200 changed");
    expect(diffLines(a, b).truncated).toBe(false);
  });
});

describe("toHunks", () => {
  it("collapses unchanged runs and keeps context on both sides", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const changed = [...lines];
    changed[20] = "CHANGED";
    const hunks = toHunks(diffLines(lines.join("\n"), changed.join("\n")));

    expect(hunks).toHaveLength(1);
    const hunk = hunks[0];
    // 3 context + remove + add + 3 context.
    expect(hunk?.ops).toHaveLength(CONTEXT_LINES * 2 + 2);
    expect(hunk?.ops.some((op) => op.text === "CHANGED")).toBe(true);
  });

  it("splits changes that are far apart and merges ones that are not", () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const far = [...lines];
    far[5] = "A";
    far[50] = "B";
    expect(toHunks(diffLines(lines.join("\n"), far.join("\n")))).toHaveLength(2);

    const near = [...lines];
    near[10] = "A";
    near[13] = "B";
    expect(toHunks(diffLines(lines.join("\n"), near.join("\n")))).toHaveLength(1);
  });

  it("returns no hunks when nothing changed", () => {
    expect(toHunks(render("a\nb\n"))).toEqual([]);
  });
});

describe("segmentPair", () => {
  it("marks only the middle that differs", () => {
    const { before, after } = segmentPair('const id = "old";', 'const id = "new";');
    expect(before.map((s) => s.text).join("")).toBe('const id = "old";');
    expect(before.filter((s) => s.changed).map((s) => s.text)).toEqual(["old"]);
    expect(after.filter((s) => s.changed).map((s) => s.text)).toEqual(["new"]);
  });

  it("handles a pure append and a pure truncation", () => {
    expect(segmentPair("abc", "abcdef").after.filter((s) => s.changed).map((s) => s.text)).toEqual(["def"]);
    expect(segmentPair("abcdef", "abc").before.filter((s) => s.changed).map((s) => s.text)).toEqual(["def"]);
  });

  it("never loses or duplicates text", () => {
    const a = "  return reply.code(403).send({ code: 'x' });";
    const b = "  return reply.code(404).send({ code: 'y' });";
    const { before, after } = segmentPair(a, b);
    expect(before.map((s) => s.text).join("")).toBe(a);
    expect(after.map((s) => s.text).join("")).toBe(b);
  });
});

describe("pairedEdit", () => {
  it("pairs a lone remove with the add that follows it", () => {
    const ops = diffLines("a\nb\nc\n", "a\nB\nc\n").ops;
    const at = ops.findIndex((op) => op.kind === "remove");
    expect(pairedEdit(ops, at)).toMatchObject({
      removed: { text: "b" },
      added: { text: "B" },
    });
  });

  it("refuses to pair inside a multi-line block, where the alignment is a guess", () => {
    const ops = diffLines("a\nb\nc\nd\n", "a\nX\nY\nd\n").ops;
    const at = ops.findIndex((op) => op.kind === "remove");
    expect(pairedEdit(ops, at)).toBeNull();
  });

  it("refuses to pair a pure insertion", () => {
    const ops = diffLines("a\nc\n", "a\nb\nc\n").ops;
    expect(pairedEdit(ops, 0)).toBeNull();
  });
});

describe("diffFileSets", () => {
  const file = (path: string, contents: string) => ({ path, contents, kind: "unknown" as const });

  it("classifies added, removed, modified and unchanged", () => {
    const before = [file("a.ts", "x\n"), file("b.ts", "y\n"), file("gone.ts", "z\n")];
    const after = [file("a.ts", "x\n"), file("b.ts", "y2\n"), file("new.ts", "n\n")];
    const set = diffFileSets(before, after);
    const byPath = new Map(set.changes.map((c) => [c.path, c.kind]));

    expect(byPath.get("a.ts")).toBe("unchanged");
    expect(byPath.get("b.ts")).toBe("modified");
    expect(byPath.get("gone.ts")).toBe("removed");
    expect(byPath.get("new.ts")).toBe("added");
  });

  it("flags the first round rather than showing everything as added", () => {
    const set = diffFileSets(null, [file("a.ts", "x\n")]);
    expect(set.isFirstRound).toBe(true);
    expect(set.changes[0]?.kind).toBe("added");
  });

  it("totals the line counts the tree badges show", () => {
    const set = diffFileSets([file("a.ts", "1\n2\n3\n")], [file("a.ts", "1\nTWO\n3\n4\n")]);
    expect(set.added).toBe(2);
    expect(set.removed).toBe(1);
  });
});
