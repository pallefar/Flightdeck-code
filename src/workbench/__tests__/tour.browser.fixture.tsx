/** Run from the isolated Workbench entry, not Studio's HMR root. Real frozen
 * generator files; no model transport, credentials or generated execution. */
import { Workbench } from "../Workbench";
import { mountWorkbenchFixture } from "./browser.fixture";
import { fileAt } from "../selectors";
import { VoiceSession } from "../../voice/Voice";
import { VoiceController } from "../../voice/controller";
import type { VoicePorts, UtterancePort } from "../../voice/ports";

export async function verifyArchitectureTour() {
  const fixture = await mountWorkbenchFixture();
  const { store, candidate, root } = fixture;
  const passed: string[] = []; const narrated: string[] = [];
  let prompts = 0; let stopped = 0;
  const pause = (ms = 50) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const check = (ok: unknown, name: string) => { if (!ok) throw new Error(name); passed.push(name); };
  const find = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector); if (!element) throw new Error(`Missing ${selector}`); return element;
  };
  const click = async (selector: string) => { const button = find<HTMLButtonElement>(selector); button.focus(); button.click(); await pause(); };
  const button = async (name: string) => click(`[aria-label="${name}"]`);
  const render = (active = true, buildReveal = true, voice = false) => root.render(<Workbench store={store} hideChat active={active} buildReveal={buildReveal} onPrompt={() => { prompts += 1; }} {...(voice ? { onNarrate: (text: string) => { narrated.push(text); } } : {})} onStopNarration={() => { stopped += 1; }} />);
  await pause(); render(); await pause();
  await button("Open architecture walkthrough");
  await button("Play walkthrough"); await button("Pause walkthrough");
  check(store.getState().selectedPath === "server/subapps/wc-clock/manifest.ts", "Play selects the actual manifest in the existing Sources pane");
  await button("Next walkthrough step");
  check(store.getState().selectedPath === "server/subapps/wc-clock/routes/index.ts", "Next selects the actual server route source");
  await button("Next walkthrough step");
  const frame = find<HTMLIFrameElement>("iframe");
  check(store.getState().view === "preview" && frame.contentDocument?.querySelectorAll("script").length === 0, "page walkthrough reuses the existing scriptless Preview");
  check(frame.getAttribute("allow") === "microphone 'none'; camera 'none'; on-device-speech-recognition 'none'" && frame.getAttribute("sandbox") === "allow-same-origin" && frame.contentDocument?.URL === "about:blank", "preview explicitly denies recording and keeps exact scriptless sandbox");
  await button("Next walkthrough step");
  check(find(".fd-tour__heading").textContent?.includes("Consultation clocks") && find(".fd-tour__facts").textContent?.includes("6 declared fields"), "actual descriptor section and form fields are explained");
  check(frame.contentDocument?.querySelector('[data-panel="clocks"][data-tour-highlight="true"]') !== null && frame.contentDocument?.querySelectorAll('[data-tour-highlight="true"]').length === 1, "walkthrough highlights only the actual descriptor section without camera scrolling");
  await click('.fd-tour__references button[title="web/src/subapps/wc-clock/index.tsx"]');
  check(store.getState().selectedPath === "web/src/subapps/wc-clock/index.tsx", "walkthrough reference opens exact generated web source");
  await click('.fd-source-tabs button[title="server/subapps/wc-clock/manifest.ts"]');
  const edit = Array.from(find('[data-view="files"]').querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === "Edit");
  if (!edit) throw new Error("Missing Edit"); edit.focus(); edit.click(); await pause();
  const editor = find<HTMLTextAreaElement>('.fd-source-slot:not([hidden]) .fd-editor, [data-view="files"] .fd-editor');
  const original = candidate.files.find(file => file.kind === "manifest")?.contents ?? "";
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editor, `${original}// retained private manual text\n`);
  editor.dispatchEvent(new Event("input", { bubbles: true })); await pause(); editor.setSelectionRange(5, 11);
  await click('.fd-tour__references button[title="web/src/subapps/wc-clock/index.tsx"]');
  await click('.fd-source-tabs button[title="server/subapps/wc-clock/manifest.ts"]');
  check(find('.fd-source-slot:not([hidden]) .fd-editor, [data-view="files"] .fd-editor') === editor && editor.selectionStart === 5 && editor.selectionEnd === 11 && editor.value.endsWith("// retained private manual text\n"), "source reference round-trip preserves textarea identity, selection and unsaved buffer");
  const replayWalk = Array.from(find('.fd-tour').querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === "Replay walkthrough");
  if (!replayWalk) throw new Error("Missing replay walkthrough"); replayWalk.focus(); replayWalk.click(); await pause(); editor.focus(); await pause(3650);
  check(document.activeElement === editor && store.getState().selectedPath === "server/subapps/wc-clock/manifest.ts" && find('.fd-tour').dataset.playing === "false" && find('.fd-wb').dataset.tourStep === undefined, "manual editor focus pauses timed guided navigation without stealing focus or highlighting the wrong source");
  check(find('iframe') === frame, "guided source references retain the original Preview iframe identity");
  await button("Close architecture walkthrough");
  check(document.activeElement === find('[aria-label="Open architecture walkthrough"]') && find('.fd-tour__details').hidden && find('.fd-tour__details').inert, "close returns focus to the real opener and removes hidden controls from keyboard order");
  await button("Open architecture walkthrough");
  find('.fd-tour').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await pause();
  check(document.activeElement === find('[aria-label="Open architecture walkthrough"]') && find('.fd-tour__details').hidden, "Escape closes walkthrough and restores opener focus");
  const newRound = store.settle(store.prompt("Actual received fixture candidate, no network") ?? "", candidate); await pause();
  check(find('.fd-tour').dataset.mode === "assembly" && find('.fd-tour__scope').textContent === "Draft received · assembling source view", "only actual accepted new round starts truthful received-artifact assembly");
  const manifestPiece = find<HTMLButtonElement>('.fd-module[data-module="framework"]');
  check(find<HTMLButtonElement>('.fd-tree [data-received-highlight="true"]').title === 'server/subapps/wc-clock/manifest.ts' && document.querySelectorAll('.fd-tree [data-received-highlight="true"]').length === 1 && manifestPiece.dataset.moduleState === "arriving" && document.querySelectorAll('.fd-module[data-module-state="socket"]').length === 2, "received-artifact reveal snaps only the actual manifest into typed source sockets");
  const normalMotion = { animation: getComputedStyle(find('.fd-module[data-module-state="arriving"] .fd-module__face')).animationName, duration: getComputedStyle(find('.fd-module[data-module-state="arriving"] .fd-module__face')).animationDuration, containerTransform: getComputedStyle(manifestPiece).transform };
  find('.fd-wb').dataset.motion = "off";
  const motionOff = { animation: getComputedStyle(find('.fd-module[data-module-state="arriving"] .fd-module__face')).animationName, transition: getComputedStyle(find('[aria-label="Play walkthrough"], [aria-label="Pause walkthrough"]')).transitionDuration, containerTransform: getComputedStyle(manifestPiece).transform };
  check(motionOff.animation === "none" && motionOff.transition === "0s" && normalMotion.containerTransform === "none", "data-motion off disables actual snap motion; interactive module containers never transform");
  await pause();
  check(find('.fd-tour').dataset.mode === "ready" && find('.fd-tour').dataset.playing === "false", "motion off immediately finalizes the received presentation clock");
  delete find('.fd-wb').dataset.motion;
  await pause();
  check(find('.fd-tour').dataset.mode === "ready", "restoring motion does not automatically replay an accepted receipt");
  await button("Open architecture walkthrough");
  find<HTMLButtonElement>('.fd-tour__replay button').click();
  await pause();
  const savedPaths = JSON.stringify(store.effectiveFiles());
  const drafts = store.getState().drafts; const locks = store.getState().locks; const runs = store.getState().runs;
  await pause(1100);
  check(document.querySelectorAll('.fd-tree [data-received-highlight="true"]').length === 3 && find('.fd-module[data-module="server"]').dataset.moduleState === "arriving" && find('.fd-module[data-module="framework"]') === manifestPiece, "actual route piece arrives next while module buttons retain identity");
  await pause(1000);
  check(document.querySelectorAll('.fd-tree [data-received-highlight="true"]').length === 1 && find<HTMLButtonElement>('.fd-tree [data-received-highlight="true"]').title === 'web/src/subapps/wc-clock/index.tsx', "received reveal advances to the actual web group without selecting a fake buffer");
  await pause(1200);
  check(find('.fd-tour').dataset.mode === "ready" && find('.fd-tour__counts').textContent === "5 artifacts · 1 supported page · 2 sections · 2 capabilities", "complete assembly shows actual artifact, page, section and capability counts");
  check(JSON.stringify(store.effectiveFiles()) === savedPaths && store.getState().drafts === drafts && store.getState().locks === locks && store.getState().runs === runs, "assembly does not mutate source exports, drafts, locks or execution history");
  check(document.querySelectorAll('.fd-module[data-module-state="placed"]').length === 3 && find('.fd-module[data-module="framework"]') === manifestPiece, "completed actual module pieces settle and lock their visual adjacency without changing source locks");
  check(narrated.length === 0 && prompts === 0, "voice-off playback never narrates or calls the model callback");
  await button("Open architecture walkthrough");
  const replay = Array.from(find('.fd-tour').querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === "Replay creation");
  if (!replay) throw new Error("Missing replay"); replay.focus(); replay.click(); await pause(); render(false); await pause();
  check(find('.fd-tour').dataset.playing === "false", "retained inactive Workbench pauses received reveal");
  await pause(3200); check(find('.fd-tour').dataset.mode === "assembly", "hidden reveal cannot complete or narrate from a stale timer");
  render(true); await pause(); check(find('.fd-tour').dataset.playing === "false", "returning to Workbench does not silently resume playback");
  await button("Skip received-artifact reveal");
  check(find('.fd-tour').dataset.mode === "ready", "Skip immediately completes only the local source presentation");
  render(true, true, true); await pause();
  check(narrated.length === 0, "enabling optional narration does not read an older candidate");
  await button("Play walkthrough");
  check(find('.fd-tour').dataset.playing === "false", "accepted scoped narration pauses only visual playback without cancelling the utterance");
  check(narrated.length === 1 && !narrated.join(" ").includes("private manual") && !narrated.join(" ").includes("wc-clock"), "explicit guided event narrates only safe technical synopsis");
  store.selectRound(store.getState().rounds[0]?.id ?? ""); await pause(); const spoken = narrated.length;
  await button("Play walkthrough"); await button("Next walkthrough step");
  check(find('.fd-tour__scope').textContent?.includes("Historical") && narrated.length === spoken, "historical rounds are marked read-only and never narrated");
  store.reset(); await pause(); await pause(3700);
  check(document.querySelector('.fd-tour') === null && store.effectiveFiles().length === 0 && narrated.length === spoken, "scope reset drops old tour, source and narration timers");
  check(stopped > 0 && prompts === 0 && (newRound?.id.length ?? 0) > 0 && fileAt(store.getState(), null) === null, "presentation lifecycle uses only received artifacts, never transport or generated execution");
  root.unmount(); await pause();
  return { passed, count: passed.length, viewport: { width: innerWidth, height: innerHeight }, prompts, narrated, normalMotion, motionOff, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, generatedSourceExecuted: false };
}

/** DEVELOPMENT speech event ports, not a native microphone or audio test. */
export async function verifySharedArchitectureVoice() {
  const fixture = await mountWorkbenchFixture();
  const controller = new VoiceController();
  const spoken: string[] = []; const utterances: UtterancePort[] = [];
  const passed: string[] = []; let cancelled = 0;
  const check = (ok: unknown, name: string) => { if (!ok) throw new Error(name); passed.push(name); };
  const ports: VoicePorts = { hidden: () => false, onVisibility: () => () => {}, synthesis: {
    getVoices: () => [{ voiceURI: "development-local", name: "Development local event voice", lang: "en-GB", localService: true }], busy: () => false, onVoicesChanged: () => () => {},
    createUtterance: text => { spoken.push(text); const utterance: UtterancePort = { voice: null, lang: "", rate: 1, onstart: null, onend: null, onerror: null }; utterances.push(utterance); return utterance; },
    speak: () => {}, cancel: () => { cancelled += 1; },
  } };
  const pause = () => new Promise<void>(resolve => setTimeout(resolve, 60));
  const render = (active = true) => fixture.root.render(<VoiceSession controller={controller} ports={ports}><Workbench store={fixture.store} hideChat active={active} onPrompt={() => { throw new Error("No transport is allowed"); }} /></VoiceSession>);
  const click = async (label: string) => { const target = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`); if (!target) throw new Error(`Missing ${label}`); target.focus(); target.click(); await pause(); };
  render(); await pause();
  await click("Play walkthrough"); await click("Pause walkthrough");
  check(spoken.length === 0, "shared voice is off by default and Play opens no speech session");
  controller.setEnabled(true); await pause();
  check(spoken.length === 0, "enabling shared voice never narrates a pre-existing candidate");
  await click("Play walkthrough");
  check(spoken.length === 1 && spoken[0] === "The received manifest declares 2 capabilities. These declarations do not grant access.", "explicit walkthrough event uses actual shared voice controller with safe synopsis");
  utterances.at(-1)?.onstart?.();
  check(controller.getSnapshot().status === "speaking", "shared speech status follows injected start event rather than a timer");
  render(false); await pause();
  check(cancelled > 0 && controller.getSnapshot().status === "idle", "inactive retained Workbench stops its shared narration");
  render(); await pause(); const before = spoken.length;
  fixture.store.selectRound(fixture.store.getState().rounds[0]?.id ?? ""); await pause();
  await click("Play walkthrough");
  check(spoken.length === before, "shared controller cannot narrate a historical candidate");
  fixture.root.unmount(); await pause();
  check(!controller.getSnapshot().enabled, "scope-owned voice session cleanup revokes enabled state");
  return { passed, count: passed.length, spoken, cancelled, evidence: "DEVELOPMENT event ports; no native audio or microphone" };
}
