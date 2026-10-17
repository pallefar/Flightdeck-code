/** Browser-only interaction harness using frozen real generator output.
 * No Node imports, model calls, operator credentials or source execution. */
import { createRoot } from "react-dom/client";
import { Workbench } from "../Workbench";
import { createStore } from "../store";
import type { Candidate, GeneratedFileKind } from "../types";
import { fileAt } from "../selectors";

export async function mountWorkbenchFixture(hideChat = true) {
  const entries: readonly [string, string, GeneratedFileKind][] = [
    ["server/subapps/wc-clock/manifest.ts", "wc-clock.manifest.txt", "manifest"],
    ["server/subapps/wc-clock/routes/index.ts", "wc-clock.routes-index.txt", "routes-index"],
    ["server/subapps/wc-clock/routes/clocks.ts", "wc-clock.routes-clocks.txt", "routes-domain"],
    ["server/subapps/wc-clock/routes/review.ts", "wc-clock.routes-review.txt", "routes-domain"],
    ["web/src/subapps/wc-clock/index.tsx", "wc-clock.web-module.txt", "web-module"],
  ];
  const files = await Promise.all(entries.map(async ([path, name, kind]) => {
    const response = await fetch(`/src/workbench/__tests__/fixtures/${name}`);
    if (!response.ok) throw new Error(`Fixture source missing: ${name}`);
    return { path, contents: await response.text(), kind };
  }));
  const candidate: Candidate = {
    manifest: { id: "wc-clock", label: "Works Council Clock", version: "0.1.0", summary: "Tracks works-council consultation clocks.", icon: "⏱️", navSection: "Contract pipeline", routePrefix: "/api/apps/wc-clock", webModuleId: "wc-clock", capabilities: ["read:contracts", "write:inbox-proposal"], visibleToRoles: ["hr_preparer", "legal"], envVar: "SUBAPP_WC_CLOCK_ENABLED", tablePrefix: "subapp_wc_clock_" },
    files, findings: [], rulesRun: ["FD-M001", "FD-G001", "FD-X002", "FD-X003"], notes: ["Frozen generator fixture — not a live model or installed host."],
  };
  const store = createStore();
  store.settle(store.prompt("Build the clock") ?? "", candidate);
  // A second real store round makes saved edits comparable with a base.
  store.settle(store.prompt("Review the clock") ?? "", candidate);
  const container = document.createElement("div");
  container.id = "workbench-browser-fixture";
  container.style.cssText = "height:calc(100dvh - 72px);min-width:0;margin:0 16px 16px";
  const banner = document.createElement("header");
  banner.textContent = "Flightdeck · Sub-app source workspace · local generator fixture";
  banner.style.cssText = "box-sizing:border-box;height:56px;padding:16px;font:14px Arial;border-bottom:1px solid #d5dfe5;margin-bottom:0";
  document.body.replaceChildren(banner, container);
  document.body.style.cssText = "margin:0;--bg:#f3f6f7;--surface:#fff;--surface2:#f8fafb;--ink:#253d4b;--muted:#586e7c;--line:#d5dfe5;--te:#e98300;--green:#367956;--amber:#806620;--red:#aa3122;background:var(--bg);color:var(--ink)";
  const root = createRoot(container);
  const render = (hidden: boolean) => root.render(<Workbench store={store} hideChat={hidden} onPrompt={(_text, turnId) => store.abort(turnId, "This fixture has no model transport.")} />);
  render(hideChat);
  return { store, candidate, render, root };
}

/** Run in a real browser at the Vite origin, never in a mocked DOM. */
export async function verifyWorkbenchFixture(fixture: Awaited<ReturnType<typeof mountWorkbenchFixture>>) {
  const passed: string[] = [];
  const pause = () => new Promise<void>(resolve => setTimeout(resolve, 40));
  const check = (condition: unknown, name: string) => { if (!condition) throw new Error(name); passed.push(name); };
  const find = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (element === null) throw new Error(`Missing ${selector}`);
    return element;
  };
  const clickText = async (text: string, scope = '[data-view="files"]') => {
    const button = Array.from(find(scope).querySelectorAll("button")).find(item => item.textContent?.trim() === text);
    if (!button) throw new Error(`Missing button ${text}`);
    button.click(); await pause();
  };
  const view = async (name: string) => { find<HTMLButtonElement>(`[role="tab"][aria-label="${name}"]`).click(); await pause(); };
  const type = async (element: HTMLTextAreaElement | HTMLInputElement, value: string) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true })); await pause();
  };
  await pause();
  const root = find('.fd-wb').getBoundingClientRect();
  const parent = find('#workbench-browser-fixture').getBoundingClientRect();
  check(root.top >= parent.top && root.bottom <= parent.bottom + 1 && root.right <= innerWidth, "contained relative workspace");
  check(document.body.scrollWidth <= innerWidth, "no document horizontal overflow");
  const manifest = "server/subapps/wc-clock/manifest.ts";
  const baseline = fixture.candidate.files.find(file => file.path === manifest)?.contents ?? "";
  if (find<HTMLButtonElement>('[aria-label="Toggle file explorer"]').getAttribute('aria-expanded') !== 'true') { find<HTMLButtonElement>('[aria-label="Toggle file explorer"]').click(); await pause(); }
  fixture.store.toggleDir('tier:server'); await pause();
  const search = find<HTMLInputElement>('[aria-label="Search source paths"]');
  await type(search, 'review.ts');
  check(document.querySelectorAll('.fd-tree button[title]').length === 1 && find<HTMLButtonElement>('.fd-tree button[title]').title === 'server/subapps/wc-clock/routes/review.ts', "search actual paths through collapsed tier");
  find<HTMLButtonElement>('.fd-tree button[title]').click(); await pause();
  check(fixture.store.getState().selectedPath === 'server/subapps/wc-clock/routes/review.ts' && find('.fd-source-slot:not([hidden]) .fd-source__path, [data-view="files"] > .fd-source .fd-source__path').textContent === 'server/subapps/wc-clock/routes/review.ts', 'source tree opens the exact authoritative file');
  check(!matchMedia('(max-width: 680px)').matches || (find('.fd-explorer').hidden && find('.fd-explorer').inert), 'mobile source selection hides retained explorer and returns focus');
  find<HTMLButtonElement>(`.fd-source-tabs button[title="${manifest}"]`).click(); await pause();
  if (find<HTMLButtonElement>('[aria-label="Toggle file explorer"]').getAttribute('aria-expanded') !== 'true') { find<HTMLButtonElement>('[aria-label="Toggle file explorer"]').click(); await pause(); }
  await type(search, '');
  check(document.querySelector('.fd-tree button[title="server/subapps/wc-clock/manifest.ts"]') === null, "clearing search restores directory collapse");
  fixture.store.toggleDir('tier:server'); await pause();
  await clickText('Edit');
  const editor = find<HTMLTextAreaElement>('.fd-editor');
  await type(editor, `${baseline}// browser source edit\n`);
  editor.setSelectionRange(5, 9);
  const beforeSelection = editor.selectionStart;
  await view('Gate'); await view('Files');
  check(find('.fd-editor') === editor && editor.selectionStart === beforeSelection && editor.value.endsWith('// browser source edit\n'), "retained editor identity, selection and unsaved buffer");
  await clickText('Save');
  check(fileAt(fixture.store.getState(), manifest)?.contents === `${baseline}// browser source edit\n`, "Save applies authoritative working sources");
  check(fixture.store.getState().rounds[1]?.candidate.files.find(file => file.path === manifest)?.contents === baseline, "Save does not rewrite generated round history");
  await view('Diff');
  check(find('[data-view="diff"]').textContent?.includes('// browser source edit'), "real change diff includes saved local edit");
  await view('Gate');
  check(find('[data-view="gate"]').textContent?.includes('Manual working-source edits have not been rechecked'), "checks disclose their stale generated snapshot");
  await view('Files');
  await type(editor, `${baseline}// discard unsaved typing\n`);
  await clickText('Revert');
  check(editor.value === `${baseline}// browser source edit\n`, "Revert drops typing and keeps saved working copy");
  await clickText('Restore generated');
  check(fileAt(fixture.store.getState(), manifest)?.contents === baseline, "Restore generated removes only the local overlay");
  await view('Preview'); await pause();
  const frame = find<HTMLIFrameElement>('iframe');
  check(frame.getAttribute('sandbox') === 'allow-same-origin' && frame.contentDocument?.querySelectorAll('script').length === 0 && frame.contentDocument?.URL === 'about:blank', "about:blank scriptless same-origin portal");
  check((frame.contentDocument?.body.textContent?.length ?? 0) > 0, "actual descriptor mirror rendered");
  await view('Files'); await view('Preview');
  check(find('iframe') === frame, "retained preview frame identity");
  const killSwitch = find<HTMLInputElement>('.fd-preview__bar input'); killSwitch.click(); await pause(); await pause();
  check(fixture.store.getState().enable.killSwitch === false && frame.contentDocument?.body.textContent?.includes('not enabled'), "mock guard diagnostic follows actual enable state");
  killSwitch.click(); await pause();
  const webPath = 'web/src/subapps/wc-clock/index.tsx';
  const generatedWeb = fixture.candidate.files.find(file => file.path === webPath)?.contents ?? '';
  fixture.store.editFile(webPath, generatedWeb.replace('id: "clocks"', 'id: manualDescriptorId')); fixture.store.saveFile(webPath); await pause();
  check(find('[data-view="preview"]').textContent?.includes('descriptor could not be read') && document.querySelector('iframe') === null, "unparsable saved page fails closed instead of executing source");
  fixture.store.restoreGenerated(webPath); await pause();
  fixture.render(false); await pause();
  const composer = find<HTMLTextAreaElement>('[aria-label="Describe the mini-app"]');
  await type(composer, 'Retain this external-chat draft');
  fixture.render(true); await pause();
  check(find('[aria-label="Describe the mini-app"]') === composer && find('.fd-chat-slot').hidden && find('.fd-chat-slot').inert, "external conversation hides retained chat from keyboard focus");
  fixture.render(false); await pause();
  check(find('[aria-label="Describe the mini-app"]') === composer && composer.value === 'Retain this external-chat draft', "restoring standalone chat preserves the composer draft");
  fixture.render(true); await pause();
  const turn = fixture.store.prompt('Explicit fixture failure diagnostic') ?? '';
  fixture.store.plan(turn, [{ id: 'fixture-no-adapter', label: 'Fixture diagnostic · no execution adapter' }]);
  fixture.store.startStep('fixture-no-adapter'); fixture.store.output('fixture-no-adapter', 'No runtime adapter configured. No command executed.\n', 'err');
  fixture.store.endStep('fixture-no-adapter', 'failed', { error: 'Execution adapter unavailable' }); fixture.store.fail(turn, 'Execution adapter unavailable'); await pause();
  await view('Run');
  check(find('[data-view="run"]').textContent?.includes('Execution adapter unavailable') && find('[data-view="run"]').textContent?.includes('No command executed'), "explicit failed diagnostic has actual store output, no fake execution");
  await view('Files');
  return { passed, count: passed.length, viewport: { width: innerWidth, height: innerHeight }, sandbox: 'allow-same-origin', generatedCodeExecuted: false };
}
