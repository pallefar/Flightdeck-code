// DEVELOPMENT ONLY. Public nonsecret fixture scope, actual root and native browser Fetch.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioApp } from '../StudioApp';
import { StudioController } from '../controller';
const host = document.getElementById('fixture')!;
const controller = new StudioController();
createRoot(host).render(<StrictMode><StudioApp controller={controller}/></StrictMode>);
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
const checks: string[] = [];
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
const get = <T extends Element = HTMLElement,>(selector: string): T => { const value = host.querySelector<T>(selector); if (!value) throw new Error(`Missing ${selector}`); return value; };
const button = (text: string, parent: Element = host) => { const value = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text); if (!value) throw new Error(`Missing button ${text}`); return value; };
async function input(node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause();
}
async function waitFor(test: () => boolean, label: string) { for (let i = 0; i < 240; i++) { if (test()) return; await pause(); } throw new Error(`Timed out: ${label}`); }
async function metrics() { return (await fetch('/__authoring_fixture/metrics')).json(); }
function area() { return host.querySelector('[aria-current="page"]')?.textContent; }
async function configure(expectedSends = 0) {
  button('Connection settings').click(); await pause();
  // This public sentinel belongs only to a newly created isolated fixture, never a live login/key.
  await input(get<HTMLInputElement>('[aria-label="Operator token"]'), 'development-only-public-authoring-sentinel');
  await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'), 'authoring-fixture');
  button('Check connection & project skills').click();
  await waitFor(() => [...get<HTMLSelectElement>('[aria-label="Model connection"]').options].some(option => option.value === 'anthropic' && !option.disabled), 'authenticated metadata');
  assert(get<HTMLSelectElement>('[aria-label="Model connection"]').value === '', 'No automatic model selection');
  await input(get<HTMLSelectElement>('[aria-label="Model connection"]'), 'anthropic');
  get<HTMLDetailsElement>('.studio-authoring-options').open = true; await pause();
  const engine = get<HTMLSelectElement>('[aria-label="Authoring engine"]');
  assert(engine.value === 'json-planner' && engine.options[1]!.disabled, 'Native engine initially unavailable; JSON default retained');
  assert((await metrics()).sdkCalls.length === expectedSends, 'Connection reads make zero SDK sends');
  button('Check native authoring availability').click(); await waitFor(() => !engine.options[1]!.disabled, 'native metadata');
  assert(engine.value === 'json-planner', 'Reading native metadata does not select native');
  await input(engine, 'native-v1');
  assert((await metrics()).sdkCalls.length === expectedSends, 'Explicit engine selection sends no model request');
}
async function submit(prompt: string) {
  button('AI builder').click(); await pause();
  await input(get<HTMLTextAreaElement>('.studio-compose textarea'), prompt);
  button('Create draft').click(); await waitFor(() => controller.getState().phase !== 'requesting', 'routed draft'); await pause();
}
export function layoutCheck() {
  const source = get<HTMLElement>('.studio-ide-area .fd-source-slot:not([hidden]) .fd-editor, .studio-ide-area .fd-source-slot:not([hidden]) .fd-code');
  const height = source.getBoundingClientRect().height;
  assert(height >= 150, 'Composed source viewport remains readable');
  assert(document.documentElement.scrollWidth <= innerWidth, 'No horizontal page overflow');
  const modal = host.querySelector<HTMLDialogElement>('.fd-subapp-workspace__dialog[open]');
  if (modal) { const rect = modal.getBoundingClientRect(); assert(rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, 'Native source modal contained in viewport'); }
  return { width: innerWidth, height: innerHeight, sourceHeight: height, modalOpen: !!modal };
}
export async function runAuthoringEntryChecks() {
  await pause(); await pause();
  assert((await metrics()).sdkCalls.length === 0, 'StrictMode mount makes zero SDK sends');
  await configure();
  await submit('Create a local conditional routing workflow.');
  assert(controller.getState().result?.status === 'workflow-graph-proposed' && area() === 'Workflow builder', 'Native response opens the real local workflow builder');
  assert(host.querySelectorAll('.wf-node').length === 4, 'Real native DAG has four registered builtin nodes');
  button('Save as new draft').click(); await waitFor(() => !!get('.wf-workspace').textContent?.includes('Current draft:'), 'workflow exact saved readback');
  const workflowId = get('.wf-workspace').textContent!.match(/Current draft:\s*([a-f0-9-]{36})/)?.[1];
  assert(!!workflowId, 'Actual durable workflow identity confirmed');
  await input(get<HTMLInputElement>('[aria-label="Workflow name"]'), 'Edited conditional routing');
  button('Save New Revision · from r1').click(); await waitFor(() => !!get('.wf-workspace').textContent?.includes('revision 2'), 'workflow second revision');
  assert(get('.wf-workspace').textContent?.includes(workflowId!), 'Workflow edit retains the actual saved identity');
  await submit('Create a review proposal form.');
  const first = controller.getState().result;
  assert(first?.status === 'subapp-result' && first.outcome.status === 'needs_input', 'Native sub-app requests exact human manifest choices before generation');
  const values: Record<string, string> = { 'consent:write:inbox-proposal': 'yes', icon: '📋', navSection: 'Contract pipeline', visibleToRoles: 'legal' };
  for (const label of host.querySelectorAll<HTMLElement>('[data-studio-question]')) {
    const id = label.dataset.studioQuestion!; const control = label.querySelector<HTMLInputElement | HTMLSelectElement>('input,select')!;
    const value = values[id]; if (!value) throw new Error(`Unexpected question ${id}`);
    await input(control, control instanceof HTMLSelectElement ? [...control.options].find(option => option.value.toLowerCase() === value.toLowerCase())?.value ?? value : value);
  }
  button('Submit answers').click(); await waitFor(() => controller.getState().phase !== 'requesting', 'native source result'); await pause();
  assert(controller.getState().result?.status === 'subapp-result' && area() === 'Sub-app IDE', 'Human answers route actual generated sub-app into retained IDE');
  const state = controller.workbench.getState(); const round = state.rounds.at(-1)!;
  assert(round.candidate.files.length >= 5, 'Real generator emitted the SDK source inventory');
  assert(round.candidate.files.find(file => file.kind === 'manifest')?.contents.includes('generatedBy: "flightdeck-studio"'), 'Generated manifest retains host default-off policy classification');
  const skip = host.querySelector<HTMLButtonElement>('[aria-label="Skip received-artifact reveal"]');
  if (skip && skip.getClientRects().length) { skip.click(); await pause(); }
  const file = round.candidate.files.find(item => item.kind === 'web-module')!;
  controller.workbench.revealFile(file.path); await pause(); button('Edit', get('.fd-source-slot:not([hidden]) .fd-source')).click(); await pause();
  const textarea = get<HTMLTextAreaElement>('.fd-source-slot:not([hidden]) .fd-editor');
  assert(textarea.getAttribute('aria-label') === `Edit ${file.path}`, 'Editing the selected visible source, never a hidden retained pane');
  const edited = file.contents + '\n// synthetic durable annotation — Ω\n';
  await input(textarea, edited); button('Save', get('.fd-source-slot:not([hidden]) .fd-source')).click(); await pause();
  assert(controller.workbench.effectiveFiles().find(item => item.path === file.path)?.contents === edited, 'Actual in-session Save applies exact manual text');
  const before = layoutCheck();
  get<HTMLButtonElement>('[aria-label="Saved sub-app drafts"]').click(); await pause();
  const modal = get<HTMLDialogElement>('.fd-subapp-workspace__dialog');
  assert(modal.open, 'Main Studio header opens the actual durable-source modal');
  button('Save draft', modal).click(); await waitFor(() => !!modal.textContent?.includes('revision 1 confirmed'), 'sub-app first exact readback');
  const id = modal.querySelector('section[aria-label="Current sub-app source"] code')?.textContent;
  assert(!!id, 'Durable sub-app identity shown only after exact GET readback');
  const after = layoutCheck(); assert(before.sourceHeight === after.sourceHeight, 'Durable-source modal adds no source viewport rows');
  button('Close', modal).click(); await pause();
  assert(get('.fd-source-slot:not([hidden]) .fd-editor') === textarea, 'Native close retains the actual textarea identity');
  await input(textarea, edited + '// second saved annotation\n'); button('Save', get('.fd-source-slot:not([hidden]) .fd-source')).click(); await pause();
  get<HTMLButtonElement>('[aria-label="Saved sub-app drafts"]').click(); await pause();
  button('Save new revision', modal).click(); await waitFor(() => !!modal.textContent?.includes('revision 2 confirmed'), 'sub-app second exact readback');
  button('Refresh saved drafts', modal).click(); await waitFor(() => modal.querySelectorAll('[aria-label^="Open saved draft "]').length === 1, 'durable source list');
  const history = controller.getState().transcript;
  const originalConfirm = window.confirm; let confirmations = 0; window.confirm = () => { confirmations++; return true; };
  try { get<HTMLButtonElement>(`[aria-label="Open saved draft ${id}"]`).click(); await waitFor(() => !!modal.textContent?.includes('Saved source opened.'), 'explicit source replacement'); }
  finally { window.confirm = originalConfirm; }
  assert(confirmations === 1, 'Explicit source replacement asks once before replacing existing source');
  assert(controller.getState().result === null && controller.getState().acceptedRequestId === null, 'Saved-source load clears obsolete accepted model handoff');
  assert(controller.getState().transcript === history, 'Saved-source load retains the conversation');
  assert(controller.workbench.effectiveFiles().find(item => item.path === file.path)?.contents === edited + '// second saved annotation\n', 'Explicit saved-source load restores exact manual text');
  assert(controller.workbench.getState().rounds.at(-1)!.candidate.files.find(item => item.path === file.path)?.contents === file.contents, 'Immutable generated baseline remains distinct from reopened manual source');
  button('Close', modal).click(); await pause();
  const final = await metrics();
  const creates = final.http.filter((request: { url: string }) => request.url === '/api/studio/create');
  assert(creates.length === 3 && creates.every((request: { engine?: string }) => request.engine === 'native-v1'), 'All three explicit create/answer requests retain native engine with no JSON fallback');
  assert(final.sdkCalls.length === 9, 'Three real harness runs perform exact classifier/read/propose SDK fake-fetch sends');
  assert(!final.http.some((request: { url: string }) => request.url.includes('/runs')), 'Neither generation nor source save starts a workflow execution');
  return { passed: checks.length, checks, layout: before, workflowId, subappId: id, sdkSends: final.sdkCalls.length, http: final.http };
}
export async function reopenAuthoringEntrySource() {
  await pause(); await pause();
  assert(controller.workbench.getState().rounds.length === 0, 'Fresh browser entry has no retained source round');
  const before = await metrics();
  await configure(before.sdkCalls.length);
  button('Sub-app IDE').click(); await pause();
  get<HTMLButtonElement>('[aria-label="Saved sub-app drafts"]').click(); await pause();
  const modal = get<HTMLDialogElement>('.fd-subapp-workspace__dialog');
  button('Refresh saved drafts', modal).click();
  await waitFor(() => modal.querySelectorAll('[aria-label^="Open saved draft "]').length === 1, 'saved source after fresh entry');
  modal.querySelector<HTMLButtonElement>('[aria-label^="Open saved draft "]')!.click();
  await waitFor(() => !!modal.textContent?.includes('Saved source opened.'), 'saved source readback after fresh entry');
  const state = controller.workbench.getState();
  const original = state.rounds.at(-1)!.candidate.files.find(file => file.kind === 'web-module')!;
  const working = controller.workbench.effectiveFiles().find(file => file.path === original.path)!;
  assert(working.contents.endsWith('// second saved annotation\n') && working.contents.includes('Ω'), 'Fresh browser reopen restores exact saved Unicode manual source');
  assert(!original.contents.includes('synthetic durable annotation'), 'Fresh browser reopen retains the separate original generated baseline');
  assert(modal.textContent?.includes('Durable draft r2'), 'Fresh browser reopen retains the exact saved revision');
  assert((await metrics()).sdkCalls.length === before.sdkCalls.length, 'Saved-source reopen performs zero new SDK sends');
  button('Close', modal).click(); await pause();
  const layout = layoutCheck();
  return { passed: checks.length, checks, layout, sdkSends: before.sdkCalls.length };
}
Object.assign(window, { authoringEntry: { controller, run: runAuthoringEntryChecks, reopen: reopenAuthoringEntrySource, layout: layoutCheck } });
