/** "New workflow" — a described workflow becomes a
 * `studio-workflow-definition/1` file, without a model.
 *
 * Studio lands an OS workflow ONLY as that file: an admin imports it in the
 * OS New-workflow wizard, which submits it to the Workflow Builder. So this
 * dialog writes nothing anywhere but the person's own disk (the same
 * `saveInBrowser` the candidate download uses), and the file is built only
 * once a person has put their name to it AND to the statutory decision — the
 * file schema refuses it otherwise, and a model never decides a statutory
 * step.
 *
 * Like every pane it takes plain props: `build` is handed in by `main.tsx`
 * (`src/wiring.ts#buildWorkflowFile`), so this renders under
 * `react-dom/server` and imports no generator. */
import { useEffect, useMemo, useState } from "react";

export interface WorkflowBuildInput {
  readonly request: string;
  readonly by: string;
  readonly statutoryConfirmedBy: string;
  readonly statutory: boolean;
}

export type WorkflowBuildResult =
  | { readonly ok: true; readonly text: string; readonly filename: string }
  | { readonly ok: false; readonly error: string; readonly preview: string };

export interface WorkflowDialogProps {
  readonly build: (input: WorkflowBuildInput) => WorkflowBuildResult;
  readonly onSave: (file: { readonly filename: string; readonly mime: "application/json"; readonly text: string }) => void;
  readonly onClose: () => void;
}

export function WorkflowDialog({ build, onSave, onClose }: WorkflowDialogProps) {
  const [request, setRequest] = useState("");
  const [by, setBy] = useState("");
  const [confirmedBy, setConfirmedBy] = useState("");
  const [statutory, setStatutory] = useState(false);

  const result = useMemo(
    () => build({ request, by, statutoryConfirmedBy: confirmedBy, statutory }),
    [build, request, by, confirmedBy, statutory],
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fd-conn-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="fd-conn-dialog fd-wf-dialog" role="dialog" aria-modal="true" aria-labelledby="fd-wf-title" tabIndex={-1}>
        <span className="fd-pagehead__eyebrow">New workflow</span>
        <h2 id="fd-wf-title" className="fd-conn-dialog__h">
          Describe the workflow
        </h2>
        <p className="fd-conn-dialog__p">
          Studio drafts a studio-workflow-definition/1 file from the Workflow Builder&apos;s own steps and field types.
          Nothing is sent anywhere: you download the file and an admin imports it in the OS (New workflow → Import a
          Flightdeck Studio file). Name it with: called &quot;Your Name&quot;.
        </p>
        <label className="fd-conn-dialog__label">
          What should the workflow do?
          <textarea
            className="fd-conn-dialog__input"
            name="workflow-request"
            rows={3}
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            autoFocus
          />
        </label>
        <div className="fd-wf-row">
          <label className="fd-conn-dialog__label">
            Your name
            <input className="fd-conn-dialog__input" name="workflow-by" value={by} onChange={(event) => setBy(event.target.value)} />
          </label>
          <label className="fd-conn-dialog__label">
            Statutory steps decided by
            <input
              className="fd-conn-dialog__input"
              name="workflow-confirmed-by"
              value={confirmedBy}
              onChange={(event) => setConfirmedBy(event.target.value)}
            />
          </label>
        </div>
        <label className="fd-wf-check">
          <input type="checkbox" name="workflow-statutory" checked={statutory} onChange={(event) => setStatutory(event.target.checked)} />
          This workflow has a statutory step (locked, human-only)
        </label>
        <pre className="fd-wf-preview" aria-label="Workflow file preview">
          {result.ok ? result.text : result.preview}
        </pre>
        {!result.ok && (
          <p className="fd-conn-dialog__alert" role="alert">
            Not a file yet — {result.error}
          </p>
        )}
        <div className="fd-conn-dialog__acts">
          <button type="button" className="fd-lockbtn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="fd-save"
            disabled={!result.ok}
            onClick={() => {
              if (result.ok) onSave({ filename: result.filename, mime: "application/json", text: result.text });
            }}
          >
            Download workflow file
          </button>
        </div>
      </div>
    </div>
  );
}

/** On the workbench's existing tokens — no new colour. */
export const WORKFLOW_CSS = `
.fd-wf-dialog { width: min(640px, 100%); }
.fd-wf-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
@media (max-width: 560px) { .fd-wf-row { grid-template-columns: 1fr; } }
.fd-wf-check { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; color: var(--ink); }
.fd-wf-preview {
  margin: 12px 0 0; max-height: 220px; overflow: auto; padding: 10px 12px;
  background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-md);
  font-family: var(--mono); font-size: 12px; line-height: 1.45; white-space: pre;
}
`;
