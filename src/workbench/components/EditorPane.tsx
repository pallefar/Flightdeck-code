/** The file, and the person's hands on it.
 *
 * ── WHY THIS IS A TEXTAREA AND NOT CODEMIRROR ────────────────────────
 * The reference implementation ships CodeMirror 6 with a language pack per
 * file type, and it is right to: its target is arbitrary web apps, so the
 * editor is where its users live. Here the editor is a safety net. A
 * person reads a generated sub-app, sees the guard call in the wrong place
 * or a table name without its `subapp_<id>_` prefix, and fixes it in
 * place instead of spending another round hoping the generator does. That
 * is a handful of characters, not an afternoon, and ~700 KB of editor to
 * serve it would be the weight of a workshop for a job that needs a
 * screwdriver.
 *
 * So: a textarea for typing, and the annotated read view — line numbers,
 * finding rows, the rule that fired — for reading. The toggle between them
 * is the honest trade rather than a hidden one, and the cost of it is
 * stated here: there is no syntax highlighting while editing, and the
 * gate's line numbers describe the last text Studio SAW, so an edited
 * buffer says so rather than pointing at lines that have moved.
 *
 * ── WHAT THE BUTTONS MEAN ────────────────────────────────────────────
 *   Save in workbench the buffer becomes the file every other pane reads —
 *                     in this browser tab only. It writes no file, calls no
 *                     server and never touches the host repo (owner ruling
 *                     2026-09-22 (9) renamed it from a bare "Save", which read
 *                     as a disk write). "Download candidate", in the tab
 *                     strip, is how the saved files leave the browser.
 *   Revert            drop unsaved typing, keep what was saved.
 *   Restore generated throw the whole edit away, back to Studio's text.
 *   Lock              claim the file. See `editing.ts` for the promise
 *                     this makes and the one it refuses to make.
 * Each is separately reachable because they destroy different things, and
 * a single "undo" that sometimes means one and sometimes the other is how
 * a person loses work they thought they had saved. */
import { useMemo, useState } from "react";
import { diffLines } from "../diff";
import { editability, isDirty, type Draft } from "../editing";
import type { Finding, GeneratedFile } from "../types";
import { LineIcon } from "./LineIcon";
import { Note } from "./Note";

export interface EditorPaneProps {
  /** The file as every other pane sees it — saved edits applied. */
  readonly file: GeneratedFile | null;
  /** Exactly what Studio emitted this round, overlay ignored. The
   * baseline the "you changed this" banner counts against. */
  readonly generated?: GeneratedFile | null;
  readonly draft?: Draft | null;
  readonly findings: readonly Finding[];
  readonly locked?: boolean;
  /** Paths a running step says it is writing right now. */
  readonly beingWritten?: ReadonlySet<string>;
  /** True when the selected round is not the latest one. Earlier rounds
   * are a record of what Studio produced, not a working copy. */
  readonly historical?: boolean;
  /** Absent callbacks mean a read-only embedding: no buttons are drawn,
   * rather than dead ones.
   *
   * `onEdit` may return the reason a keystroke was refused — the store
   * knows why and this pane does not, and "Studio started writing this
   * file while you were typing" is not something a component should be
   * left to guess at. Returning nothing means it went through. */
  readonly onEdit?: (path: string, text: string) => string | null | void;
  readonly onSave?: (path: string) => void;
  readonly onRevert?: (path: string) => void;
  readonly onRestore?: (path: string) => void;
  readonly onResolve?: (path: string, choice: "mine" | "studio") => void;
  readonly onToggleLock?: (path: string) => void;
}

export function EditorPane({
  file,
  generated = null,
  draft = null,
  findings,
  locked = false,
  beingWritten,
  historical = false,
  onEdit,
  onSave,
  onRevert,
  onRestore,
  onResolve,
  onToggleLock,
}: EditorPaneProps) {
  const [mode, setMode] = useState<"read" | "edit" | null>(null);
  // Why the last keystroke did not take. Only reachable in a race — the
  // pane pre-empts every refusal it can see coming — which is exactly why
  // it must not be silent when it happens.
  const [refused, setRefused] = useState<string | null>(null);

  if (file === null) {
    return (
      <div className="fd-source">
        <div className="fd-empty">Select a file.</div>
      </div>
    );
  }

  const conflict = draft?.conflict ?? null;
  const dirty = draft !== null && isDirty(draft);
  // What the person is looking at: their working copy when they have one,
  // otherwise the file. While a conflict is open the file is Studio's —
  // `applyDrafts` refuses to overlay an unresolved edit — so the two texts
  // stay visibly separate until somebody picks one.
  const text = conflict !== null ? file.contents : draft?.buffer ?? file.contents;

  const can = editability(file, beingWritten ?? new Set());
  const editable = can.editable && onEdit !== undefined && !historical && conflict === null;
  const reason = historical
    ? "An earlier round is a record of what Studio produced, not a working copy. Select the latest round to edit."
    : conflict !== null
      ? "Resolve the conflict before typing — a third version helps nobody."
      : can.reason;
  const effectiveMode = editable ? (mode ?? (dirty ? "edit" : "read")) : "read";

  const name = file.path.split("/").pop() ?? file.path;

  return (
    <div className="fd-source">
      <header className="fd-source__head">
        <span className="fd-source__path">
          <LineIcon name="file-code" size={15} />
          <span>
            {file.path.slice(0, file.path.length - name.length)}
            <b>{name}</b>
          </span>
        </span>
        {dirty && (
          <span className="fd-dirty" title="unsaved changes">
            unsaved
          </span>
        )}
        {!dirty && draft?.saved != null && draft.saved !== draft.generated && (
          <span className="fd-edited" title="your edit, saved over Studio's text">
            edited
          </span>
        )}
        {locked && <span className="fd-lockmark">locked</span>}

        <span className="fd-tabs__spacer" />

        {editable && (
          <div className="fd-modes" role="group" aria-label="Editor mode">
            <button type="button" aria-pressed={effectiveMode === "read"} onClick={() => setMode("read")}>
              Read
            </button>
            <button type="button" aria-pressed={effectiveMode === "edit"} onClick={() => setMode("edit")}>
              Edit
            </button>
          </div>
        )}
        {onToggleLock !== undefined && !historical && (
          <button
            type="button"
            className="fd-lockbtn"
            aria-pressed={locked}
            onClick={() => onToggleLock(file.path)}
            title="A locked file always asks before a new round changes it."
          >
            <LineIcon name={locked ? "lock-open" : "lock"} size={15} />
            {locked ? "Unlock" : "Lock"}
          </button>
        )}
        {dirty && onSave !== undefined && (
          <button
            type="button"
            className="fd-save"
            onClick={() => onSave(file.path)}
            title="Makes this text the file every pane reads, in this browser tab only. Nothing is written to disk, the server or the host repo. Download candidate saves the edited files to this computer. (Ctrl/Cmd+S)"
          >
            <LineIcon name="check" size={15} />
            Save in workbench
          </button>
        )}
        {dirty && onRevert !== undefined && (
          <button type="button" className="fd-revert" onClick={() => onRevert(file.path)}>
            <LineIcon name="undo-2" size={15} />
            Revert
          </button>
        )}
        {draft !== null && draft.saved !== null && onRestore !== undefined && (
          <button type="button" className="fd-revert" onClick={() => onRestore(file.path)}>
            <LineIcon name="rotate-ccw" size={15} />
            Restore generated
          </button>
        )}
        <span className="fd-tabs__id">
          {countLines(text)} line{countLines(text) === 1 ? "" : "s"}
        </span>
      </header>

      {conflict !== null && (
        <ConflictBanner
          path={file.path}
          held={conflict.held}
          incoming={conflict.incoming}
          kind={conflict.kind}
          fromLock={conflict.fromLock}
          {...(onResolve === undefined ? {} : { onResolve })}
        />
      )}

      {conflict === null && reason !== null && !editable && onEdit !== undefined && <Note warn>{reason}</Note>}
      {refused !== null && editable && <Note warn>{refused}</Note>}

      {dirty && findings.length > 0 && (
        <Note>
          The gate's line numbers below are from the last text Studio saw. You have unsaved changes, so they may
          point at lines that have moved — re-run to re-check.
        </Note>
      )}

      {effectiveMode === "edit" && onEdit !== undefined ? (
        <textarea
          className="fd-editor"
          value={text}
          spellCheck={false}
          aria-label={`Edit ${file.path}`}
          onChange={(event) => setRefused(onEdit(file.path, event.target.value) ?? null)}
          onKeyDown={(event) => {
            // Ctrl/Cmd+S saves. The browser's own "save page" dialog on a
            // workbench is never what anybody meant.
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              onSave?.(file.path);
            }
          }}
        />
      ) : (
        <AnnotatedSource text={text} findings={findings} />
      )}

      {generated !== null && draft !== null && draft.saved !== null && conflict === null && (
        <footer className="fd-source__foot">
          <EditDelta before={generated.contents} after={draft.saved} />
        </footer>
      )}
    </div>
  );
}

function countLines(text: string): number {
  return text.replace(/\n$/, "").split("\n").length;
}

/** The read view: the file with the gate's findings on the lines they
 * fired on. This is the half a textarea cannot do, which is why both
 * exist. */
function AnnotatedSource({ text, findings }: { readonly text: string; readonly findings: readonly Finding[] }) {
  const lines = useMemo(() => text.replace(/\n$/, "").split("\n"), [text]);
  const worst = useMemo(() => {
    const map = new Map<number, Finding>();
    for (const finding of findings) {
      // The worse of two findings on a line wins the row's colour;
      // otherwise a warning drawn second hides an error drawn first.
      const existing = map.get(finding.line);
      if (existing === undefined || (existing.severity === "warning" && finding.severity === "error")) {
        map.set(finding.line, finding);
      }
    }
    return map;
  }, [findings]);

  return (
    <div className="fd-code">
      <table>
        <tbody>
          {lines.map((line, i) => {
            const finding = worst.get(i + 1);
            return (
              <tr key={i} data-finding={finding?.severity}>
                <td className="fd-ln">{i + 1}</td>
                <td>
                  {line}
                  {finding !== undefined && (
                    <span className="fd-finding__where">  ← {finding.rule} {finding.message}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** How far the saved edit has moved from Studio's text. Small, and at the
 * bottom, because the number a person wants at a glance is "did I change
 * anything and roughly how much", not a second diff pane. */
function EditDelta({ before, after }: { readonly before: string; readonly after: string }) {
  const delta = useMemo(() => diffLines(before, after), [before, after]);
  if (delta.added === 0 && delta.removed === 0) {
    return <span className="fd-ledger__note">Your saved copy is identical to what Studio generated.</span>;
  }
  return (
    <span className="fd-ledger__note">
      Your edit, against what Studio generated this round:{" "}
      <span className="fd-delta__add">+{delta.added}</span>{" "}
      <span className="fd-delta__del">−{delta.removed}</span>
    </span>
  );
}

/** The whole point of the locking subsystem, rendered.
 *
 * Both buttons name what they destroy. A dialog whose options are "OK" and
 * "Cancel" over a data-loss decision is how a person loses an hour of work
 * to a reflex. */
function ConflictBanner({
  path,
  held,
  incoming,
  kind,
  fromLock,
  onResolve,
}: {
  readonly path: string;
  readonly held: string;
  readonly incoming: string | null;
  readonly kind: "regenerated" | "removed";
  readonly fromLock: boolean;
  readonly onResolve?: (path: string, choice: "mine" | "studio") => void;
}) {
  const delta = useMemo(() => diffLines(held, incoming ?? ""), [held, incoming]);

  return (
    <div className="fd-conflict" role="alert">
      <div className="fd-conflict__head">
        <strong>
          <LineIcon name="triangle-alert" size={16} />
          <span>
            {kind === "removed"
              ? "This round no longer contains this file."
              : "Studio rewrote this file while you had your own version of it."}
          </span>
        </strong>
        <span className="fd-conflict__why">
          {fromLock
            ? "You locked it, so nothing here was applied until you say so."
            : "Your version is held, unapplied. The panes are showing Studio's."}
        </span>
      </div>

      <p className="fd-conflict__stat mono">
        {kind === "removed" ? (
          <>your copy is {countLines(held)} lines; the round has no file at {path}</>
        ) : (
          <>
            <span className="fd-delta__add">{delta.removed}</span> line
            {delta.removed === 1 ? "" : "s"} only in yours,{" "}
            <span className="fd-delta__del">{delta.added}</span> only in this round
          </>
        )}
      </p>

      {onResolve !== undefined && (
        <div className="fd-conflict__acts">
          <button type="button" onClick={() => onResolve(path, "mine")}>
            <LineIcon name="check" size={15} />
            Keep mine — discard Studio's {kind === "removed" ? "removal" : "rewrite"}
          </button>
          <button type="button" onClick={() => onResolve(path, "studio")}>
            <LineIcon name="rotate-ccw" size={15} />
            Take Studio's — discard my version
          </button>
        </div>
      )}
    </div>
  );
}
