import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Workbench } from "../Workbench";
import { createStore } from "../store";
import { candidate } from "./fixtures";
import { WORKBENCH_CSS } from "../theme";
import { RunPane } from "../components/RunPane";
import { EditorPane } from "../components/EditorPane";
import { editDraft, openDraft, saveDraft } from "../editing";
import { finding } from "./fixtures";

const noop = () => {};

describe("embedded IDE", () => {
  it("gives the source IDE a command identity and a real retained focus action", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    expect(out).toContain("CODE / INSPECT");
    expect(out).toContain("3 received modules · 5 artifacts");
    expect(out).toMatch(/aria-label="Focus source workspace"[^>]*aria-pressed="false"/);
    expect(out).toContain('data-source-focus="false"');
    expect(out).not.toContain("terminal");
  });
  it("retains a collapsible module strip with stationary accessible labels and an explicit page-reader boundary", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />).replace(/<style>[\s\S]*?<\/style>/, "");
    expect(out).toMatch(/aria-label="Show received modules"[^>]*aria-expanded="false"/);
    expect(out).toMatch(/class="fd-tour__modules"[^>]*hidden=""[^>]*inert=""/);
    expect(out).toMatch(/class="fd-module__face"[^>]*aria-hidden="true"/);
    expect(out).toContain('aria-label="Manifest · 1 received artifact · open server/subapps/wc-clock/manifest.ts"');
    expect(out).toContain("Page/PANELS only · other pages source-only");
  });
  it("offers a compact truthful architecture walkthrough with real source references and no run controls", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    expect(out).toContain('aria-label="Sub-app architecture walkthrough"');
    expect(out).toContain("Design walkthrough · not installed / no source execution");
    expect(out).toContain("5 artifacts · 1 supported page · 2 sections · 2 capabilities");
    expect(out).toContain('aria-label="Received modules · visual placement only"');
    expect((out.match(/<button[^>]+data-module-state="placed"/g) ?? []).length).toBe(3);
    expect(out).toContain('data-module="framework"');
    expect(out).toContain('data-module="server"');
    expect(out).toContain('data-module="web"');
    expect(out).toContain("Sockets show placement, not missing source or installation.");
    expect(out).toContain('aria-label="Open architecture walkthrough"');
    expect(out).toContain('aria-label="Play walkthrough"');
    expect(out).toContain('aria-label="Previous walkthrough step"');
    expect(out).toContain('aria-label="Next walkthrough step"');
    expect(out).toContain('aria-label="Stop walkthrough"');
    expect(out).toContain("Replay creation");
    expect(out).not.toContain("Install framework");
    expect(out).not.toContain('aria-label="Run"');
  });
  it("keeps source annotations explicitly stale after a saved manual edit", () => {
    const generated = { path: "server/subapps/x/manifest.ts", contents: "one\ntwo\n", kind: "manifest" as const };
    const draft = saveDraft(editDraft(openDraft(generated, "r"), "new line\none\ntwo\n"));
    const out = renderToStaticMarkup(<EditorPane file={{ ...generated, contents: draft.saved ?? "" }} generated={generated} draft={draft} findings={[finding("FD-M003", generated.path, 2, "original line finding")]} onEdit={noop} />);
    expect(out).toContain("annotations describe the generated snapshot");
    expect(out).toContain("Saving does not rerun checks");
  });
  it("shows an actual latest failed generation attempt without replacing the selected candidate", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    const turn = store.prompt("failed follow-up") ?? "";
    store.plan(turn, [{ id: "verify", label: "Actual failed check" }]);
    store.startStep("verify");
    store.output("verify", "No adapter configured. No command executed.\n", "err");
    store.fail(turn, "Execution adapter unavailable");
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    expect(out).toContain("Actual failed check");
    expect(out).toContain("Execution adapter unavailable");
    expect(out).toContain("No command executed");
    expect(out).toContain('class="fd-artifact__name">Works Council Clock');
  });
  it("does not infer a successful execution from a settled answer with no step diagnostics", () => {
    const out = renderToStaticMarkup(<RunPane run={{ turnId: "t", steps: [], startedAt: 1, endedAt: 2, abortRequested: false }} busy={false} />);
    expect(out).not.toContain("fd-runstatus--succeeded");
    expect(out).toContain("No step diagnostics reported");
    expect(out).not.toContain("answer is streaming");
  });
  it("labels checks as a generated snapshot rather than re-verifying manual working sources", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    store.editFile("server/subapps/wc-clock/manifest.ts", "// working source\n");
    store.saveFile("server/subapps/wc-clock/manifest.ts");
    store.setView("gate");
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    expect(out).toContain("Static conformance snapshot");
    expect(out).toContain("Manual working-source edits have not been rechecked");
    expect(out).toContain("not installed-host verification");
  });
  it("identifies a preview as a non-executing descriptor mirror before showing its controls", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    store.setView("preview");
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    expect(out).toContain("Descriptor mirror · generated source is not executed");
    expect(out).toContain('sandbox="allow-same-origin"');
    expect(out).not.toContain("allow-scripts");
  });
  it("keeps all interactive editing bounds motion-free while composing host-toned compact command chrome", () => {
    const rules = (selector: string) => [...WORKBENCH_CSS.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter(match => match[1]?.trim() === selector).map(match => match[2] ?? "").join("\n");
    expect(rules(".fd-wb .fd-view")).not.toContain("animation:");
    expect(rules(".fd-wb .fd-tree__row[title]")).not.toContain("animation:");
    expect(WORKBENCH_CSS).toContain("--wb-shadow: var(--shadow,");
    expect(rules(".fd-wb .fd-command-bar")).toContain("display: flex");
    expect(rules(".fd-wb .fd-module__face")).toContain("pointer-events: none");
    expect(WORKBENCH_CSS).toMatch(/\.fd-wb \.fd-source__head button[^}]+min-height: 44px/);
    expect(WORKBENCH_CSS).toMatch(/\.fd-wb \.fd-source-tabs button[^}]+min-height: 44px/);
  });
  it("scopes responsive chrome and caps every entrance animation with a complete reduced-motion opt-out", () => {
    expect(WORKBENCH_CSS).not.toMatch(/^\.fd-(?!wb)/m);
    expect(WORKBENCH_CSS).toContain("container-type: inline-size");
    expect(WORKBENCH_CSS).toContain("@container");
    expect(WORKBENCH_CSS).toContain("prefers-reduced-motion: reduce");
    expect(WORKBENCH_CSS).toMatch(/prefers-reduced-motion: reduce[^}]+\.fd-wb \*::after/);
    expect(WORKBENCH_CSS).not.toContain("infinite");
    const durations = Array.from(WORKBENCH_CSS.matchAll(/(?:animation|transition):[^;]+?\b(\d+)ms/g), match => Number(match[1]));
    expect(durations.length).toBeGreaterThan(0);
    expect(durations.every(ms => ms <= 230)).toBe(true);
  });
  it("keeps historical source authoritative when the latest working copy has a draft", () => {
    const store = createStore();
    const first = store.settle(store.prompt("first") ?? "", candidate());
    store.settle(store.prompt("second") ?? "", candidate());
    store.editFile("server/subapps/wc-clock/manifest.ts", "// latest private draft\n");
    store.selectRound(first?.id ?? "");
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    const source = out.slice(out.indexOf('class="fd-source"'));
    expect(source).not.toContain("latest private draft");
    expect(source).toContain("wcClockManifest");
  });
  it("exposes search, a real explorer toggle and the selected-source strip", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    expect(out).toContain('aria-label="Search source paths"');
    expect(out).toContain('aria-label="Toggle file explorer"');
    expect(out).toContain('aria-label="Open sources"');
    expect(out).toContain('class="fd-source-kind">manifest · TypeScript');
  });
  it("names the actual artifact, draft and legacy-accessible workspace views with linked panels", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    const out = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    expect(out).toContain('aria-label="Sub-app workspace"');
    expect(out).not.toContain("<main");
    expect(out).toContain('class="fd-artifact__name">Works Council Clock');
    expect(out).toContain("Draft · not deployed");
    expect(out).toMatch(/role="tab"[^>]*aria-label="Files"[^>]*>Sources/);
    expect(out).toMatch(/role="tab"[^>]*aria-label="Diff"[^>]*>Changes/);
    expect(out).toMatch(/role="tab"[^>]*aria-label="Gate"[^>]*>Checks/);
    expect(out).toMatch(/role="tabpanel"[^>]*data-view="files"/);
    expect(out).toContain('aria-controls=');
    expect(out).toContain('tabindex="-1"');
    expect(out).not.toContain('aria-label="Run"');
  });
  it("contains the IDE in its parent and consumes host theme tokens without repainting them", () => {
    const root = WORKBENCH_CSS.match(/\.fd-wb \{([^}]+)\}/)?.[1] ?? "";
    expect(root).toContain("position: relative");
    expect(root).toContain("width: 100%");
    expect(root).toContain("min-width: 0");
    expect(root).not.toContain("inset: 0");
    expect(root).not.toMatch(/--(?:bg|surface|ink|muted|line|green|amber|red):/);
    expect(root).toContain("var(--bg,");
    expect(root).toContain("Arial");
    expect(WORKBENCH_CSS).toMatch(/\.fd-wb\[data-external-chat="true"\][^{]*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  });
  it("retains the chat composer in a hidden inert column for an external conversation", () => {
    const store = createStore();
    store.settle(store.prompt("Build the clock") ?? "", candidate());
    const hidden = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} hideChat />);
    expect(hidden).toContain('data-external-chat="true"');
    expect(hidden).toMatch(/class="fd-chat-slot"[^>]*hidden=""[^>]*inert=""/);
    expect(hidden).toContain('aria-label="Describe the mini-app"');
    const standalone = renderToStaticMarkup(<Workbench store={store} onPrompt={noop} />);
    expect(standalone).toContain('data-external-chat="false"');
    expect(standalone).toContain('<div class="fd-chat-slot">');
  });
});
