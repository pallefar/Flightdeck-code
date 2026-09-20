/** What changed this round.
 *
 * ── UNIFIED, NOT SIDE-BY-SIDE ───────────────────────────────────────
 * Side-by-side reads better for prose and worse for code at this width —
 * the workbench already spends a third of the viewport on chat, and two
 * 60-column gutters of generated TypeScript wrap into noise. Unified with
 * an intra-line highlight puts the changed tokens next to each other,
 * which is the comparison a reviewer is actually making.
 *
 * The first round has no base, and says so rather than rendering every
 * file as an addition — an all-green diff implies something was replaced. */
import { useMemo } from "react";
import { pairedEdit, segmentPair, toHunks, diffLines, type ChangeSet, type FileChange, type LineOp } from "../diff";

interface Props {
  readonly set: ChangeSet | null;
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
}

export function DiffPane({ set, selectedPath, onSelect }: Props) {
  const touched = useMemo(() => {
    if (set === null) return [];
    const rank: Record<FileChange["kind"], number> = { added: 0, modified: 1, removed: 2, unchanged: 3 };
    return set.changes
      .filter((change) => change.kind !== "unchanged")
      .sort((a, b) => rank[a.kind] - rank[b.kind] || a.path.localeCompare(b.path));
  }, [set]);

  if (set === null) {
    return <div className="fd-empty">No round selected.</div>;
  }
  if (touched.length === 0) {
    return (
      <div className="fd-empty">
        <strong>This round changed nothing.</strong>
        <span>Every generated file is byte-identical to the round before it.</span>
      </div>
    );
  }

  const current = touched.find((change) => change.path === selectedPath) ?? touched[0] ?? null;

  return (
    <div className="fd-files">
      <nav className="fd-changes" aria-label="Files changed this round">
        {set.isFirstRound && (
          <p className="fd-note">
            First round — there is no previous version to compare against, so every file is new.
          </p>
        )}
        <p className="fd-note">
          <span className="fd-delta__add">+{set.added}</span>{" "}
          <span className="fd-delta__del">−{set.removed}</span> across {touched.length} file
          {touched.length === 1 ? "" : "s"}
        </p>
        {touched.map((change) => (
          <button
            type="button"
            key={change.path}
            className="fd-tree__row"
            aria-current={change.path === current?.path}
            onClick={() => onSelect(change.path)}
            title={change.path}
          >
            <span className="fd-tree__twisty">
              {change.kind === "added" ? "+" : change.kind === "removed" ? "−" : "~"}
            </span>
            <span className="fd-tree__name">{change.path.split("/").pop()}</span>
            <span className="fd-delta">
              {change.added > 0 && <span className="fd-delta__add">+{change.added}</span>}{" "}
              {change.removed > 0 && <span className="fd-delta__del">−{change.removed}</span>}
            </span>
          </button>
        ))}
      </nav>
      {current === null ? <div className="fd-empty">Select a file.</div> : <FileDiff change={current} />}
    </div>
  );
}

function FileDiff({ change }: { readonly change: FileChange }) {
  const diff = useMemo(
    () => diffLines(change.before?.contents ?? "", change.after?.contents ?? ""),
    [change],
  );
  const hunks = useMemo(() => toHunks(diff), [diff]);

  return (
    <div className="fd-source">
      <header className="fd-source__head">
        <span className="fd-source__path">
          <b>{change.path}</b>
        </span>
        <span className="fd-tabs__spacer" />
        <span className="fd-tabs__id">
          {change.kind === "added" ? "new file" : change.kind === "removed" ? "deleted" : "modified"}
        </span>
      </header>

      {diff.truncated && (
        <p className="fd-note fd-note--warn">
          This file is too large to align line by line, so it is shown as one replacement rather than a real
          diff. The counts above are exact; the alignment below is not.
        </p>
      )}

      <div className="fd-code">
        {hunks.map((hunk, index) => (
          <div key={index}>
            <div className="fd-hunk__head">
              @@ −{hunk.beforeStart},{hunk.beforeCount} +{hunk.afterStart},{hunk.afterCount} @@
            </div>
            <table>
              <tbody>
                {hunk.ops.map((op, i) => (
                  <Row key={i} op={op} ops={hunk.ops} index={i} />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({
  op,
  ops,
  index,
}: {
  readonly op: LineOp;
  readonly ops: readonly LineOp[];
  readonly index: number;
}) {
  // A lone remove followed by a lone add is an EDIT, and showing which
  // characters moved is the difference between reading a line and diffing
  // it by eye. Anything else is left plain: a guessed alignment inside a
  // multi-line block is worse than none.
  const pair = op.kind === "remove" ? pairedEdit(ops, index) : null;
  const previousPair = op.kind === "add" ? pairedEdit(ops, index - 1) : null;

  let content: React.ReactNode = op.text;
  if (pair !== null) {
    content = <Segments text={op.text} other={pair.added.text} side="before" />;
  } else if (previousPair !== null) {
    content = <Segments text={op.text} other={previousPair.removed.text} side="after" />;
  }

  return (
    <tr className={op.kind === "context" ? undefined : `fd-op--${op.kind}`}>
      <td className="fd-ln">{op.beforeLine ?? ""}</td>
      <td className="fd-ln">{op.afterLine ?? ""}</td>
      <td className="fd-sign">{op.kind === "add" ? "+" : op.kind === "remove" ? "−" : " "}</td>
      <td>{content}</td>
    </tr>
  );
}

function Segments({
  text,
  other,
  side,
}: {
  readonly text: string;
  readonly other: string;
  readonly side: "before" | "after";
}) {
  const segments = side === "before" ? segmentPair(text, other).before : segmentPair(other, text).after;
  return (
    <>
      {segments.map((segment, i) =>
        segment.changed ? (
          <span key={i} className="fd-seg">
            {segment.text}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
