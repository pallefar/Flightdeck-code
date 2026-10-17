import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioApp } from '../StudioApp';
import { StudioController } from '../controller';

// Explicit DEVELOPMENT entry: actual authenticated loopback root, blocked metadata,
// one intentionally refused JSON request, and an explicitly seeded pure-generated candidate.
const controller = new StudioController();
createRoot(document.getElementById('root')!).render(<StrictMode><StudioApp controller={controller}/></StrictMode>);
const checks: string[] = [];
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
  checks.push(label);
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text);
const requiredButton = (text: string) => { const node = button(text); if (!node) throw new Error('Missing ' + text); return node; };
function element<T extends Element>(selector: string): T { const node = document.querySelector<T>(selector); if (!node) throw new Error('Missing ' + selector); return node; }
async function input(node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  await pause();
}
async function waitFor(test: () => boolean, label: string) {
  const deadline = performance.now() + 8_000;
  while (performance.now() < deadline) { if (test()) return; await pause(); }
  throw new Error('Timed out ' + label);
}
const engine = () => element<HTMLSelectElement>('[aria-label="Authoring engine"]');
async function waitMetadata(count: number) {
  const deadline = performance.now() + 8_000;
  while (performance.now() < deadline) {
    const value = await (await fetch('/metadata-metrics.json', { cache: 'no-store' })).json();
    if (value.entered >= count) return;
    await pause();
  }
  throw new Error('Metadata request did not reach the owned fixture');
}
const composer = () => element<HTMLTextAreaElement>('.studio-compose textarea');
const publicSentinel = 'synthetic-public-metadata-hang-token';
const promptText = 'Prepare a local draft after configuration check.';
let originalRound: ReturnType<typeof controller.workbench.getState>['rounds'][number];
let originalTranscript: ReturnType<typeof controller.getState>['transcript'];
let originalTurns: ReturnType<typeof controller.workbench.getState>['turns'];
let baseline: string;
let editedPath: string;
let editedBuffer: string;
function retained(where: string) {
  const workbench = controller.workbench.getState();
  check(workbench.rounds.length === 1 && workbench.rounds[0] === originalRound, where + ': exact source round retained');
  check(JSON.stringify(originalRound.candidate) === baseline, where + ': immutable generated baseline retained');
  check(workbench.drafts.get(editedPath)?.buffer === editedBuffer && workbench.drafts.get(editedPath)?.saved === null, where + ': unapplied Unicode source buffer retained');
  check(controller.getState().transcript === originalTranscript && originalTranscript.length > 0, where + ': nonempty conversation retained');
  check(workbench.turns === originalTurns, where + ': Workbench history retained');
  check(composer().value === promptText, where + ': composer retained');
}
function result() { return { checks: [...checks], engine: engine().value, rounds: controller.workbench.getState().rounds.length, transcriptTurns: controller.getState().transcript.length, scope: 'Owned headless DOM-functional development composition; no model replies or source execution, not private-runtime/visual acceptance' }; }

(window as any).reviewRun = async () => {
  await pause(); requiredButton('Connection settings').click(); await pause();
  await input(element<HTMLInputElement>('[aria-label="Operator token"]'), publicSentinel);
  await input(element<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'), 'review-fixture');
  requiredButton('Check connection & project skills').click();
  await waitFor(() => [...element<HTMLSelectElement>('[aria-label="Model connection"]').options].some(option => option.value === 'anthropic' && !option.disabled), 'real root descriptors');
  await input(element<HTMLSelectElement>('[aria-label="Model connection"]'), 'anthropic');
  await input(composer(), promptText);
  // The fixture's authenticated preHandler refuses this request before any model call.
  await controller.submit({ connectionId: 'anthropic', prompt: promptText, projectId: 'review-fixture' }, publicSentinel);
  check(controller.getState().phase === 'error' && controller.getState().transcript.length > 0, 'Explicitly refused development request seeds nonempty conversation without a model');
  controller.clearReceivedHandoff();
  const candidate = await (await fetch('/candidate.json')).json();
  const turn = controller.workbench.prompt('Explicitly seeded pure-generated source diagnostic');
  check(turn !== null, 'Seed source turn accepted'); controller.workbench.settle(turn, candidate);
  originalRound = controller.workbench.getState().rounds[0]!;
  const file = candidate.files.find((entry: { kind: string }) => entry.kind === 'web') ?? candidate.files[0];
  editedPath = file.path; editedBuffer = file.contents + '\r\n// METADATA_CHECK_MUST_KEEP_UNAPPLIED_SOURCE Ω\r\n';
  check(controller.workbench.editFile(editedPath, editedBuffer) === null, 'Seed unapplied source buffer accepted');
  baseline = JSON.stringify(originalRound.candidate); originalTranscript = controller.getState().transcript; originalTurns = controller.workbench.getState().turns;
  await pause();
  check(engine().value === 'json-planner' && !requiredButton('Create draft').disabled, 'JSON is usable before optional metadata');
  element<HTMLDetailsElement>('.studio-authoring-options').open = true;
  requiredButton('Check native authoring availability').click();
  await waitFor(() => !!button('Cancel native availability check'), 'explicit availability cancel');
  await waitMetadata(1);
  check(!requiredButton('Create draft').disabled && !engine().disabled, 'Stalled metadata does not block JSON or explicit engine choice');
  check(engine().options[1]!.disabled && engine().value === 'json-planner', 'Pending metadata cannot enable or select Native');
  retained('While metadata pending');
  requiredButton('Cancel native availability check').click(); await pause();
  check(!button('Cancel native availability check') && !requiredButton('Create draft').disabled, 'Availability-only cancel settles without resetting authoring');
  retained('After availability cancel');
  requiredButton('Sub-app IDE').click(); await pause(); requiredButton('AI builder').click(); await pause();
  retained('After ordinary navigation');
  requiredButton('Check native authoring availability').click();
  await waitFor(() => !!button('Cancel native availability check'), 'second metadata request');
  await waitMetadata(2);
  await waitFor(() => !button('Cancel native availability check'), 'bounded metadata deadline');
  check(document.body.textContent?.includes('Native authoring configuration unavailable. No native request or fallback was made.'), 'Deadline shows fixed truthful no-fallback error');
  check(!requiredButton('Create draft').disabled && engine().value === 'json-planner', 'JSON remains usable after deadline');
  check(engine().options[1]!.disabled, 'Deadline does not arm Native'); retained('After metadata deadline');
  return result();
};

(window as any).reviewAfterRelease = async () => {
  await pause(150);
  check(engine().options[1]!.disabled && engine().value === 'json-planner', 'Late cancelled and timed-out replies cannot re-arm Native'); retained('After late metadata replies');
  requiredButton('Check native authoring availability').click();
  await waitFor(() => !engine().options[1]!.disabled, 'fresh explicit availability read');
  check(engine().value === 'json-planner', 'Fresh successful metadata never selects Native automatically');
  await input(engine(), 'native-v1');
  check(engine().value === 'native-v1' && !requiredButton('Create draft').disabled, 'Fresh explicit Native choice remains usable'); retained('After explicit Native choice');
  return result();
};

(window as any).reviewNativeSwitch = async () => {
  requiredButton('Check native authoring availability').click();
  await waitFor(() => !!button('Cancel native availability check'), 'Native recheck');
  await waitMetadata(4);
  check(requiredButton('Create draft').disabled && engine().value === 'native-v1', 'Native stays blocked during a pending recheck without JSON fallback');
  check(!engine().disabled, 'Explicit JSON exit stays available while Native metadata is pending');
  await input(engine(), 'json-planner');
  check(!button('Cancel native availability check') && !requiredButton('Create draft').disabled, 'Explicit JSON switch cancels only metadata and restores JSON drafting');
  check(engine().options[1]!.disabled, 'Switch cancellation still requires fresh Native availability'); retained('After explicit JSON switch');
  return result();
};
