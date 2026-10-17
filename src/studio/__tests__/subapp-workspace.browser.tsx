import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Workbench } from '../../workbench/Workbench';
import { createStore } from '../../workbench/store';
import type { Candidate } from '../../workbench/types';
import { currentRound } from '../../workbench/selectors';
import { SubappWorkspace } from '../SubappWorkspace';
import { SubappWorkspaceController } from '../subapp-workspace-controller';
import { captureSubappSnapshot } from '../subapp-snapshot';

export async function mountSubappWorkspaceFixture() {
  const candidate: Candidate = await (await fetch('/src/studio/__tests__/subapp-workspace.generated.snapshot')).json();
  const store = createStore(); store.settle(store.prompt('Synthetic generator fixture, no model')!, candidate);
  const controller = new SubappWorkspaceController(store); // Real browser-native Fetch, real isolated loopback routes/store.
  const container = document.getElementById('fixture')!; const root = createRoot(container);
  let props = { active: true, projectId: 'synthetic-drafts', token: 'synthetic-subapp-fixture' }; let loaded = 0;
  let acceptReplacement = true; const bundles: string[] = [];
  const render = (update: Partial<typeof props> = {}) => {
    props = { ...props, ...update };
    root.render(<StrictMode><header className="fixture-bar"><strong>Flightdeck · synthetic source fixture</strong><SubappWorkspace store={store} controller={controller} {...props} onLoaded={() => { loaded++; }} confirmReplacement={() => acceptReplacement} onDownload={json => bundles.push(json)}/></header><main className="fixture-body"><Workbench store={store} hideChat active={props.active} onPrompt={(_text, turnId) => store.abort(turnId, 'No fixture model.')}/></main></StrictMode>);
  };
  render();
  const fixture = { store, controller, candidate, bundles, render, root, setAccept: (value: boolean) => { acceptReplacement = value; }, get loaded() { return loaded; } };
  Object.assign(window, { subappFixture: fixture }); return fixture;
}
export async function verifySubappWorkspaceFixture(fixture: Awaited<ReturnType<typeof mountSubappWorkspaceFixture>>) {
  const passed: string[] = [];
  const check = (yes: unknown, name: string) => { if (!yes) throw new Error(name); passed.push(name); };
  const pause = () => new Promise<void>(resolve => setTimeout(resolve, 35));
  const settled = async () => { for (let i = 0; i < 100; i++) { await pause(); if (fixture.controller.getState().phase === 'idle') return; } throw new Error('Fixture request did not settle.'); };
  const button = (name: string) => { const node = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === name); if (!node) throw new Error(`Missing ${name}`); return node; };
  const open = async () => { document.querySelector<HTMLButtonElement>('[aria-label="Saved sub-app drafts"]')!.click(); await pause(); };
  const close = async () => { document.querySelector<HTMLButtonElement>('[data-subapp-close]')!.click(); await pause(); };
  await pause();
  const beforeRequests = await (await fetch('/__subapp_fixture_evidence')).json(); check(beforeRequests.requests.length === 0, 'StrictMode mount performs zero workspace reads or writes');
  const source = document.querySelector<HTMLElement>('.fd-code')!; const height = source.getBoundingClientRect().height;
  await open();
  const dialog = document.querySelector<HTMLDialogElement>('.fd-subapp-workspace__dialog')!;
  check(dialog.open && dialog.matches(':modal'), 'compact disclosure opens native modal overlay');
  check(source.getBoundingClientRect().height === height, 'opening the source workspace consumes no source viewport rows');
  check(height >= 150, 'source remains readable in short desktop/mobile fixture');
  const rect = dialog.getBoundingClientRect(); check(rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, 'overlay contained in viewport');
  check((await (await fetch('/__subapp_fixture_evidence')).json()).requests.length === 0, 'opening the disclosure performs no automatic I/O');
  button('Save draft').click(); await settled();
  const saved = fixture.controller.getState().saved!; check(!!saved && saved.revision === 1, 'real native Fetch create and exact GET readback confirm durable draft');
  button('Refresh saved drafts').click(); await settled(); check(fixture.controller.getState().drafts?.length === 1, 'explicit refresh reads real file-backed draft summary');
  await close(); button('Edit').click(); await pause();
  const editor = document.querySelector<HTMLTextAreaElement>('.fd-editor')!; const original = editor.value; const manual = original + '\n// browser manual α\n';
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, manual); editor.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  await open(); check(button('Save new revision').disabled && button('Download source bundle').disabled, 'dirty editor buffers cannot masquerade as saved working source');
  await close(); button('Save').click(); await pause();
  const retainedEditor = document.querySelector('.fd-editor');
  await open(); check(!button('Save new revision').disabled, 'actual in-session Save enables durable revision');
  button('Save new revision').click(); await settled(); check(fixture.controller.getState().saved?.revision === 2, 'saved manual source round-trips through real revision CAS and exact readback');
  button('Download source bundle').click(); await pause();
  const bundle = JSON.parse(fixture.bundles[0]!); check(bundle.snapshot.files.some((file: { contents: string }) => file.contents === manual), 'explicit portable JSON bundle contains exact manual source');
  check(bundle.snapshot.baseline.files.every((file: { contents: string }) => file.contents !== manual), 'export keeps immutable generated evidence separate');
  check(document.querySelector('.fd-editor') === retainedEditor, 'modal actions retain the exact mounted editor DOM');
  await close();
  fixture.store.editFile(fixture.store.getState().selectedPath!, 'unsaved retained on decline'); await pause();
  await open(); fixture.setAccept(false); button('Open saved draft').click(); await settled();
  check(fixture.store.getState().drafts.get(fixture.store.getState().selectedPath!)?.buffer === 'unsaved retained on decline', 'declined saved-source replacement preserves editor bytes');
  fixture.setAccept(true); button('Open saved draft').click(); await settled();
  check(fixture.loaded === 1 && fixture.store.effectiveFiles().some(file => file.contents === manual), 'explicit accepted replacement restores saved overlays and calls parent once');
  check(currentRound(fixture.store.getState())!.candidate.files.every(file => file.contents !== manual), 'reopen retains generated baseline, not forged manual verification');
  check(fixture.store.getState().runs.every(run => run.steps.length === 0), 'reopening executes no checks or source');
  await close();
  fixture.render({ token: '' }); await pause(); await open();
  check(!button('Download source bundle').disabled && button('Save draft').disabled, 'credential-free local export remains available while durable writes are disabled');
  check(!dialog.textContent?.includes(saved.id), 'old credential scope metadata is removed');
  button('Download source bundle').click(); await pause(); check(fixture.bundles.length === 2, 'credential-free export requires and responds to a second explicit gesture');
  const finalRequests = (await (await fetch('/__subapp_fixture_evidence')).json()).requests;
  check(finalRequests.filter((entry: { method: string }) => entry.method === 'POST').length === 1 && finalRequests.filter((entry: { method: string }) => entry.method === 'PUT').length === 1, 'no model, run, duplicate or implicit save requests');
  await close();
  return { passed, sourceHeight: height, viewport: { width: innerWidth, height: innerHeight }, requests: finalRequests, finalSnapshot: captureSubappSnapshot(fixture.store.getState()) };
}
void mountSubappWorkspaceFixture().catch(error => { Object.assign(window, { fixtureError: String(error) }); });
