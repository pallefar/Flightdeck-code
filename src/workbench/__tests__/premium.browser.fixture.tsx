/** Owned isolated DEVELOPMENT harness. Frozen real generator artifacts; no
 * model, runtime adapters, credentials, or generated-source evaluation. */
import { Workbench } from "../Workbench";
import { mountWorkbenchFixture } from "./browser.fixture";
import { buildWalkthrough } from "../walkthrough";
import { VoiceSession } from "../../voice/Voice";
import { VoiceController } from "../../voice/controller";

/** Explicit real browser synthesis test; no recognition start, transcript,
 * remote speech consent, voice download or microphone request. */
export async function mountNativeSourceVoice(fixture: Awaited<ReturnType<typeof mountWorkbenchFixture>>) {
  const controller = new VoiceController();
  const events: { status: string; enabled: boolean; at: number }[] = [];
  let prompts = 0;
  controller.subscribe(() => { const state = controller.getSnapshot(); events.push({ status: state.status, enabled: state.enabled, at: performance.now() }); });
  const render = (active = true) => fixture.root.render(<VoiceSession controller={controller}><Workbench store={fixture.store} hideChat active={active} onPrompt={() => { prompts += 1; }} /></VoiceSession>);
  render();
  const button = document.createElement('button');
  button.id = 'native-source-voice-enable';
  button.textContent = 'Enable local synthesis verification';
  button.style.cssText = 'font:11px Arial;margin-left:12px;padding:6px';
  button.addEventListener('click', () => controller.setEnabled(true));
  document.querySelector('body > header')?.append(button);
  return { controller, events, render, prompts: () => prompts, microphoneRequested: false };
}

/** Host tokens supplied by the harness only; production inherits its parent. */
export function setFixtureAppearance(night: boolean) {
  const tokens = night ? { bg: '#0e1720', surface: '#17242f', surface2: '#182833', ink: '#eef2f7', muted: '#a7b6c3', line: '#304553', te: '#e98300', green: '#87c3a7', amber: '#c9b687', red: '#ff807d', shadow: '0 8px 26px #00000025, 0 1px 2px #00000020' } : { bg: '#f3f6f7', surface: '#fff', surface2: '#f8fafb', ink: '#253d4b', muted: '#586e7c', line: '#d5dfe5', te: '#e98300', green: '#367956', amber: '#806620', red: '#aa3122', shadow: '0 4px 16px #233e4d09, 0 1px 3px #233e4d08' };
  for (const [key, value] of Object.entries(tokens)) document.body.style.setProperty(`--${key}`, value);
  document.body.style.colorScheme = night ? 'dark' : 'light';
}

export async function verifySourceFocus() {
  const fixture = await mountWorkbenchFixture();
  const passed: string[] = [];
  let prompts = 0;
  const narrated: string[] = [];
  const pause = (ms = 60) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); passed.push(label); };
  const find = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
  };
  const click = async (selector: string) => { find<HTMLButtonElement>(selector).click(); await pause(); };
  fixture.root.render(<Workbench store={fixture.store} hideChat buildReveal onPrompt={() => { prompts += 1; }} onNarrate={text => narrated.push(text)} />);
  await pause();
  // Complete the actual first received artifact presentation before editing.
  await click('[aria-label="Skip received-artifact reveal"]');
  await click('.fd-source-slot:not([hidden]) .fd-modes button:last-child');
  const editor = find<HTMLTextAreaElement>('.fd-source-slot:not([hidden]) .fd-editor');
  const original = editor.value;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editor, `${original}// focused draft\n`);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  await pause();
  editor.setSelectionRange(4, 10);
  const width = editor.getBoundingClientRect().width;
  const height = editor.getBoundingClientRect().height;
  const search = find<HTMLInputElement>('[aria-label="Search source paths"]');
  const tour = find('.fd-tour');
  await click('[aria-label="Focus source workspace"]');
  check(find('.fd-tour-slot').hidden && find('.fd-tour-slot').inert && find('.fd-explorer').hidden && find('.fd-explorer').inert, "focus retains hidden inert explorer and walkthrough");
  check(find('.fd-source-slot:not([hidden]) .fd-editor') === editor && editor.value.endsWith('// focused draft\n') && editor.selectionStart === 4 && editor.selectionEnd === 10, "focus preserves actual textarea identity, selection and unsaved source");
  check(editor.getBoundingClientRect().height > height && (matchMedia('(max-width:680px)').matches || editor.getBoundingClientRect().width > width), "focus gives reclaimed chrome space to the source editor");
  fixture.store.settle(fixture.store.prompt('Explicit received fixture round while focused') ?? '', fixture.candidate);
  await pause(3200);
  check(tour.dataset.mode === 'ready' && narrated.length === 0, "a received round while focus hides the walkthrough defers assembly and narration");
  await click('[aria-label="Toggle file explorer"]');
  check(find('[aria-label="Focus source workspace"]').getAttribute('aria-pressed') === 'false' && find('.fd-explorer') === search.closest('.fd-explorer') && !find('.fd-explorer').hidden && find('[aria-label="Search source paths"]') === search, "explorer action exits focus and restores its existing search field");
  check(tour.dataset.mode === 'assembly', "leaving focus presents the previously unseen accepted round");
  await click('[aria-label="Skip received-artifact reveal"]');
  check(prompts === 0 && narrated.length === 0, "focus and presentation never call a model or automatically narrate skipped history");
  return { passed, count: passed.length, viewport: { width: innerWidth, height: innerHeight }, prompts, narrated, generatedSourceExecuted: false };
}

export async function verifyPremiumChrome(fixture: Awaited<ReturnType<typeof mountWorkbenchFixture>>, night = false) {
  setFixtureAppearance(night);
  const passed: string[] = [];
  const pause = (ms = 60) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); passed.push(label); };
  const find = <T extends HTMLElement>(selector: string): T => { const element = document.querySelector<T>(selector); if (!element) throw new Error(`Missing ${selector}`); return element; };
  const click = async (selector: string) => { find<HTMLButtonElement>(selector).click(); await pause(); };
  await pause();
  const root = find('.fd-wb');
  const parent = find('#workbench-browser-fixture').getBoundingClientRect();
  const bounds = root.getBoundingClientRect();
  const sourceBounds = find('.fd-code').getBoundingClientRect();
  check(bounds.top >= parent.top && bounds.bottom <= parent.bottom + 1 && bounds.right <= innerWidth && document.body.scrollWidth <= innerWidth, 'IDE remains parent-sized without document overflow');
  check(sourceBounds.height >= 180 && sourceBounds.width >= 300, 'default chrome preserves a usable source viewport');
  check(getComputedStyle(find('.fd-source')).backgroundColor === (night ? 'rgb(23, 36, 47)' : 'rgb(255, 255, 255)') && getComputedStyle(root).color === (night ? 'rgb(238, 242, 247)' : 'rgb(37, 61, 75)'), 'source and chrome inherit the actual scoped host Day/Night tokens');
  check(root.style.getPropertyValue('--bg') === '' && root.style.getPropertyValue('--surface') === '' && getComputedStyle(root).fontFamily.startsWith('Arial'), 'IDE does not overwrite the host palette or font');
  check([...root.querySelectorAll<HTMLElement>('.fd-view, .fd-source-slot, .fd-source, .fd-code, .fd-tree__row')].every(element => getComputedStyle(element).animationName === 'none' && getComputedStyle(element).transform === 'none'), 'all interactive source bounds have no entrance motion or transform');
  check(find('.fd-workspace-status').textContent?.includes('3 received modules · 5 artifacts') && find('.fd-workspace-limit').textContent === 'Page/PANELS only · other pages source-only', 'real artifact totals and source-only page limits stay visible when modules are collapsed');
  check([...root.querySelectorAll<HTMLButtonElement>('.fd-tabs button, .fd-focus-source')].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; }), 'all primary source/preview/checks/focus actions fit within the workspace');
  if (matchMedia('(max-width: 680px)').matches) check([...root.querySelectorAll<HTMLElement>('.fd-tab, .fd-source-tabs button, .fd-source__head button, .fd-focus-source')].every(element => element.getBoundingClientRect().height >= 44), 'mobile source and workspace actions have native 44px hit targets');
  await click('[aria-label="Show received modules"]');
  const module = find<HTMLButtonElement>('.fd-module[data-module="framework"]');
  const face = find('.fd-module[data-module="framework"] .fd-module__face');
  const rect = module.getBoundingClientRect();
  check(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === module && face.getAttribute('aria-hidden') === 'true' && getComputedStyle(face).pointerEvents === 'none', 'stationary module button owns native hit-testing and its decorative face is noninteractive');
  const editorHeight = find('.fd-code').getBoundingClientRect().height;
  await click('[aria-label="Hide received modules"]');
  check(find('.fd-tour__modules').hidden && find('.fd-tour__modules').inert && find('.fd-code').getBoundingClientRect().height > editorHeight && find('.fd-module[data-module="framework"]') === module, 'collapsing the retained module strip immediately returns space to source');
  await click('[role="tab"][aria-label="Preview"]');
  const frame = find<HTMLIFrameElement>('iframe');
  check(frame.getAttribute('sandbox') === 'allow-same-origin' && frame.getAttribute('allow') === "microphone 'none'; camera 'none'; on-device-speech-recognition 'none'" && frame.contentDocument?.querySelectorAll('script').length === 0 && frame.contentDocument.URL === 'about:blank', 'preview keeps its exact scriptless and recording-denied boundary');
  await click('[role="tab"][aria-label="Files"]'); await click('[role="tab"][aria-label="Preview"]');
  check(find('iframe') === frame && find('.fd-preview__scope').textContent?.includes('Capability responses are mocked'), 'retained descriptor preview and mock-data disclosure survive source navigation');
  await click('[role="tab"][aria-label="Files"]');
  return { passed, count: passed.length, viewport: { width: innerWidth, height: innerHeight }, night, bounds: bounds.toJSON(), sourceBounds: sourceBounds.toJSON(), generatedSourceExecuted: false };
}

/** Stress candidate duplicates actual frozen route contents under diagnostic
 * paths; these are DEVELOPMENT receipt artifacts, not a model completion. */
export async function verifyReceiptLifecycle(fixture: Awaited<ReturnType<typeof mountWorkbenchFixture>>) {
  const passed: string[] = [];
  const narrated: string[] = [];
  let prompts = 0;
  let stopped = 0;
  const pause = (ms = 60) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); passed.push(label); };
  const find = <T extends HTMLElement>(selector: string): T => { const element = document.querySelector<T>(selector); if (!element) throw new Error(`Missing ${selector}`); return element; };
  const click = async (selector: string) => { find<HTMLButtonElement>(selector).click(); await pause(); };
  const parent = find('#workbench-browser-fixture');
  parent.hidden = true; parent.inert = true;
  fixture.root.render(<Workbench store={fixture.store} hideChat buildReveal onPrompt={() => { prompts += 1; }} onStopNarration={() => { stopped += 1; }} />);
  await pause();
  const source = fixture.candidate.files.find(file => file.kind === 'routes-domain');
  if (!source) throw new Error('Frozen route missing');
  const files = [...fixture.candidate.files, ...Array.from({ length: 995 }, (_, index) => ({ ...source, path: `server/subapps/wc-clock/routes/diagnostic-${index}.ts`, contents: `${source.contents}\n// PRIVATE_STRESS_SOURCE\n` }))];
  const stress = { ...fixture.candidate, files };
  const round = fixture.store.settle(fixture.store.prompt('DEVELOPMENT 1,000-artifact receipt; no transport') ?? '', stress);
  await pause(3200);
  check(find('.fd-tour').dataset.mode === 'ready' && find('.fd-tour').dataset.playing === 'false', 'native hidden/inert parent defers an unseen accepted receipt');
  parent.hidden = false; parent.inert = false;
  await pause();
  check(find('.fd-tour').dataset.mode === 'assembly' && find('.fd-module').dataset.moduleState === 'arriving', 'first visible acceptance begins actual received-module assembly');
  const module = find('.fd-module');
  check(document.querySelectorAll('.fd-module').length === 3 && find('.fd-tour__counts').textContent?.startsWith('1000 artifacts · 1 supported page'), '1,000 received artifacts remain exactly three bounded typed pieces');
  const before = JSON.stringify(fixture.store.effectiveFiles());
  const drafts = fixture.store.getState().drafts;
  const locks = fixture.store.getState().locks;
  const runs = fixture.store.getState().runs;
  const start = performance.now();
  await pause(3100);
  check(find('.fd-tour').dataset.mode === 'ready' && performance.now() - start < 4000 && find('.fd-module') === module && JSON.stringify(fixture.store.effectiveFiles()) === before && fixture.store.getState().drafts === drafts && fixture.store.getState().locks === locks && fixture.store.getState().runs === runs, 'bounded assembly settles in under four seconds without changing authoritative files, drafts, locks, execution history or button identity');
  const plan = buildWalkthrough(stress);
  check(plan.counts.artifacts === 1000 && plan.groups.flatMap(group => group.paths).length === 1000 && !plan.steps.map(step => step.narration).join(' ').includes('PRIVATE_'), 'large actual path grouping and fixed narration stay truthful and privacy-bounded');
  await click('[aria-label="Open architecture walkthrough"]');
  find<HTMLButtonElement>('.fd-tour__replay button').click();
  await pause();
  const normal = getComputedStyle(find('.fd-module[data-module-state="arriving"] .fd-module__face')).animationName;
  parent.dataset.motion = 'off';
  await pause();
  check(normal === 'fd-module-snap' && find('.fd-tour').dataset.mode === 'ready' && find('.fd-tour').dataset.playing === 'false' && getComputedStyle(find('.fd-module__face')).animationName === 'none' && find<HTMLButtonElement>('[aria-label="Play walkthrough"]').disabled, 'live ancestor motion-off immediately finalizes assembly and disables its clock');
  delete parent.dataset.motion; await pause();
  check(find('.fd-tour').dataset.mode === 'ready' && find('.fd-tour').dataset.playing === 'false', 'restoring motion never replays the accepted round');
  fixture.root.render(<Workbench store={fixture.store} hideChat buildReveal onPrompt={() => { prompts += 1; }} onNarrate={text => narrated.push(text)} onStopNarration={() => { stopped += 1; }} />);
  await pause();
  check(narrated.length === 0, 'enabling scoped narration does not read received history');
  await click('[aria-label="Play walkthrough"]');
  check(narrated.length === 1 && find('.fd-tour').dataset.playing === 'false' && narrated[0] === 'The received manifest declares 2 capabilities. These declarations do not grant access.', 'accepted safe scoped narration pauses only visual walkthrough playback');
  const step = find('.fd-tour__heading').textContent;
  const stops = stopped;
  parent.hidden = true; parent.inert = true;
  await pause(3700);
  check(stopped > stops && find('.fd-tour__heading').textContent === step, 'native retained hide cancels narration even though visual playback was already paused');
  parent.hidden = false; parent.inert = false; await pause();
  await click('[aria-label="Next walkthrough step"]');
  await click('[aria-label="Close architecture walkthrough"]');
  check(document.activeElement === find('[aria-label="Open architecture walkthrough"]') && find('.fd-tour__details').hidden && find('.fd-tour__details').inert, 'close cancels the scoped walkthrough and returns native focus');
  fixture.store.reset(); await pause();
  check(document.querySelector('.fd-tour') === null && fixture.store.effectiveFiles().length === 0 && prompts === 0 && round !== null, 'reset removes private sources and presentation without model or execution callbacks');
  return { passed, count: passed.length, viewport: { width: innerWidth, height: innerHeight }, prompts, narrated, normalMotion: normal, generatedSourceExecuted: false, stressArtifacts: 1000 };
}
