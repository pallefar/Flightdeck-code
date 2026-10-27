/** Decision inventory, not source inventory: absent paths stay absent until
 * an explicit choice. Never evaluates or mounts the retained source. */
import type { Draft } from "../editing";

export interface RemovedSourceConflictsProps {
  readonly drafts: readonly Draft[];
  readonly retained: readonly Draft[];
  readonly onResolve: (path: string, choice: "mine" | "studio") => void;
  readonly onRestore: (path: string) => void;
}
export function RemovedSourceConflicts({ drafts, retained, onResolve, onRestore }: RemovedSourceConflictsProps) {
  if (drafts.length === 0 && retained.length === 0) return null;
  return <details className="fd-removed-conflicts" open={drafts.length > 0}>
    <summary>{drafts.length > 0 ? `Removed source conflicts (${drafts.length}) — review retained copies` : `Kept removed sources (${retained.length}) — in-session only`}</summary>
    <div className="fd-removed-conflicts__list">
      <p>Durable Save and source export cannot include paths absent from the latest generated baseline. Keep mine retains source in this session only; in-session Save applies pending typing locally, not to a supported durable snapshot. Restore generated discards a kept copy and its pending edits to accept removal.</p>
      {drafts.map(draft => <section className="fd-removed-conflicts__item" aria-label={`Removed source ${draft.path}`} key={draft.path}>
        <strong className="mono">{draft.path}</strong>
        <p>This round no longer contains this file.</p>
        <p>{draft.conflict?.fromLock ? "This path was locked. Studio's removal needs your explicit decision." : "Your retained source needs an explicit decision."} Neither copy is applied until you choose; Keep mine does not save pending typing.</p>
        <details className="fd-removed-conflicts__review">
          <summary>Review held project copy and editor buffer</summary>
          <h4>Held project copy (last saved or generated)</h4>
          <pre>{draft.conflict?.held}</pre>
          <h4>{draft.buffer !== draft.conflict?.held ? "Pending editor buffer (unsaved)" : "Editor buffer (no unsaved changes)"}</h4>
          <pre>{draft.buffer}</pre>
        </details>
        <div className="fd-conflict__acts">
          <button type="button" onClick={() => onResolve(draft.path, "mine")}>Keep mine — restore held project copy; keep pending edits unsaved</button>
          <button type="button" onClick={() => onResolve(draft.path, "studio")}>Take Studio — accept removal; discard my saved and pending text</button>
        </div>
      </section>)}
      {retained.map(draft => <section className="fd-removed-conflicts__item" aria-label={`Kept removed source ${draft.path}`} key={draft.path}>
        <strong className="mono">{draft.path}</strong> — kept in-session only
        <button type="button" onClick={() => onRestore(draft.path)}>Restore generated — discard retained copy and pending edits</button>
      </section>)}
    </div>
  </details>;
}
