import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkbenchStore } from '../workbench/store';
import { currentRound } from '../workbench/selectors';
import { captureSubappSnapshot, snapshotDisabledReason, sourceBundle } from './subapp-snapshot';
import { SubappWorkspaceController } from './subapp-workspace-controller';
import { SubappSourceValidation } from './SubappSourceValidation';
import { validateWorkingSource } from './subapp-source-validation-runner';
import './SubappWorkspace.css';

export interface SubappWorkspaceProps {
  store: WorkbenchStore;
  projectId: string;
  token: string;
  active?: boolean;
  fetcher?: typeof fetch;
  controller?: SubappWorkspaceController;
  /** Clears a parent's old accepted chat receipt after an explicit saved-source replacement. */
  onLoaded?: () => void;
  confirmReplacement?: (message: string) => boolean | Promise<boolean>;
  /** Trusted test/embedding seam. Called only after the explicit download gesture. */
  onDownload?: (json: string) => void;
}
function downloadSource(json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'flightdeck-subapp-source.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function SubappWorkspace({ store, projectId, token, active = true, fetcher, controller: supplied, onLoaded, confirmReplacement, onDownload }: SubappWorkspaceProps) {
  const [owned] = useState(() => supplied ?? new SubappWorkspaceController(store, fetcher));
  const controller = supplied ?? owned;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const workbench = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [open, setOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null); const opener = useRef<HTMLButtonElement>(null);
  const context = useRef({ projectId, token, active }); context.current = { projectId, token, active };
  const id = useId(); const sameScope = controller.matchesScope(projectId, token);
  // Never expose the prior scope's metadata for a render while reset effects are pending.
  const state = sameScope ? snapshot : { connected: false, phase: 'idle' as const, drafts: null, saved: null, uncertain: false, error: null, message: null };
  const visible = open && active && sameScope;
  const busy = state.phase !== 'idle';
  let disabledReason = snapshotDisabledReason(workbench);
  const connected = sameScope && state.connected && active;
  const current = currentRound(workbench);
  let savedMatchesSource = false;
  if (!disabledReason) {
    try { const captured = captureSubappSnapshot(workbench); savedMatchesSource = !!state.saved && current === workbench.rounds.at(-1) && JSON.stringify(captured) === JSON.stringify(state.saved.snapshot); }
    catch { disabledReason = 'Source exceeds durable bounds or has an unsupported artifact inventory. The editor is unchanged.'; }
  }
  const exportAction = () => {
    if (!active) return;
    try { const json = sourceBundle(captureSubappSnapshot(store.getState())); setExportError(null); (onDownload ?? downloadSource)(json); }
    catch { setExportError('Source export refused. Apply in-session Save, resolve conflicts and select the latest round first.'); }
  };
  const close = () => { controller.cancel(); setOpen(false); setExportError(null); };
  useLayoutEffect(() => {
    controller.connect(); controller.setScope(projectId, token); controller.setActive(active);
    setOpen(false); setExportError(null);
  }, [controller, projectId, token, active]);
  useEffect(() => () => controller.disconnect(), [controller]);
  useLayoutEffect(() => {
    const node = dialog.current; if (!node) return;
    if (visible) {
      if (!node.open) node.showModal();
      node.querySelector<HTMLButtonElement>('[data-subapp-close]')?.focus();
    } else if (node.open) {
      node.close(); if (active) opener.current?.focus();
    }
  }, [visible, active]);
  return <div className="fd-subapp-workspace" hidden={!active}>
    <button type="button" className="fd-subapp-workspace__trigger" ref={opener} aria-label="Saved sub-app drafts" aria-haspopup="dialog" aria-controls={id} aria-expanded={visible} onClick={() => setOpen(true)}>
      <span aria-hidden="true">▱</span> Saved sub-app{state.uncertain ? ' · check save' : state.saved ? ` · r${state.saved.revision}` : ''}
    </button>
    <dialog id={id} ref={dialog} className="fd-subapp-workspace__dialog" aria-label="Durable sub-app source workspace" hidden={!visible}
      onCancel={event => { event.preventDefault(); close(); }}
      onClose={() => { if (!dialog.current?.open) { controller.cancel(); setOpen(false); } }}
      onClick={event => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter(node => !node.hidden && node.getClientRects().length > 0);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus(); }
      }}>
      <header><div><p className="fd-subapp-workspace__eyebrow">Durable source drafts</p><h2>Saved sub-app workspace</h2></div><button type="button" data-subapp-close aria-label="Close saved sub-app workspace" onClick={close}>Close</button></header>
      <div className="fd-subapp-workspace__body">
        <p className="fd-subapp-workspace__boundary"><strong>In-session Save</strong> applies an editor buffer only. <strong>Save draft</strong> stores the saved working source and a separate immutable <strong>Generated baseline</strong> with its original evidence. Saving or reopening does not run checks, call a model, execute source or install in the host.</p>
        <p className="fd-subapp-workspace__scope">Local project partition: <code>{projectId || 'not selected'}</code>. Operator-scoped private storage, not host project authorization or deployment.</p>
        {!connected && <p role="status">Connect an operator credential in AI builder for durable save/reopen. Local source export does not require a credential.</p>}
        <section aria-label="Current sub-app source"><h3>Current source</h3>
          {state.saved ? <p><strong>Durable draft r{state.saved.revision}</strong> · <code>{state.saved.id}</code><br/>{savedMatchesSource ? 'Working source matches the confirmed saved snapshot.' : 'In-session source differs or is not the latest selected round; the saved revision is unchanged.'}</p> : <p>In-session source only · no durable draft linked to this round.</p>}
          <div className="fd-subapp-workspace__actions">
            <button type="button" disabled={!connected || busy || !!disabledReason || state.uncertain} onClick={() => { void controller.save('new'); }}>Save draft</button>
            <button type="button" disabled={!connected || busy || !!disabledReason || state.uncertain || !state.saved} onClick={() => { void controller.save('revision'); }}>Save new revision</button>
            <button type="button" disabled={!!disabledReason || busy || !active} onClick={exportAction}>Download source bundle</button>
          </div>
          {disabledReason && <p className="fd-subapp-workspace__help">{disabledReason}</p>}
          <p className="fd-subapp-workspace__help">Save draft creates a separate identity. Save new revision uses the exact saved revision; conflicts preserve your editor. Download is portable plain JSON source, not an executable application. No automatic download or host writes.</p>
        </section>
        {state.uncertain && <p role="alert" className="fd-subapp-workspace__warning">Save outcome uncertain. No retry was performed. Refresh saved drafts, inspect the records, then explicitly open a saved draft before saving again.</p>}
        {(state.error || exportError) && <p role="alert" className="fd-subapp-workspace__warning">{state.error ?? exportError}</p>}
        {state.message && <p role="status">{state.message}</p>}
        {busy && <p role="status">{state.phase === 'saving' ? 'Saving and verifying exact readback…' : 'Loading saved source…'}</p>}
        <section aria-label="Saved sub-app draft list"><div className="fd-subapp-workspace__list-heading"><h3>Saved drafts</h3><button type="button" disabled={!connected || busy} onClick={() => { void controller.refresh(); }}>Refresh saved drafts</button></div>
          {state.drafts === null ? <p>Saved drafts not checked. Refresh explicitly to read durable records.</p> : !state.drafts.length ? <p>No saved sub-app drafts in this checked local project.</p> : <ul>{state.drafts.map(draft => <li key={draft.id}><div><strong>{draft.label}</strong><small>r{draft.revision} · {draft.fileCount} files · {draft.updatedAt}</small><code>{draft.id}</code></div><button type="button" disabled={!connected || busy || workbench.busy} aria-label={`Open saved draft ${draft.id}`} onClick={() => {
            const scope = context.current;
            void controller.open(draft.id, confirmReplacement, () => {
              const now = context.current;
              if (scope.projectId === now.projectId && scope.token === now.token && now.active && controller.matchesScope(now.projectId, now.token)) onLoaded?.();
            });
          }}>Open saved draft</button></li>)}</ul>}
        </section>
        <SubappSourceValidation store={store} projectId={projectId} token={token} active={visible} validate={validateWorkingSource}/>
        <p className="fd-subapp-workspace__help">Generated baseline checks remain original evidence. Reopening alone performs no new checks; an explicit working-source static check is not a typecheck, source evaluation, host installation or deployment.</p>
      </div>
    </dialog>
  </div>;
}
