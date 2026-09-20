/** Render smoke tests for every pane.
 *
 * ── WHY `react-dom/server` AND NOT A DOM ────────────────────────────
 * There is no jsdom or happy-dom in this project, and adding one to type a
 * character into a textarea would be a large dependency for a small
 * assertion. `renderToStaticMarkup` needs no DOM at all and still catches
 * the whole class of failure that matters most here: a pane that throws on
 * a shape it was handed — a candidate with no files, a diff with no base,
 * a preview that is blocked. Those are exactly the states a workbench
 * spends its first minute in, and exactly the ones that are easy to leave
 * untested because the happy path is what you build against.
 *
 * What it cannot check is interaction, and that is stated rather than
 * papered over: clicking a tab, typing a prompt and submitting a form in
 * the preview frame are not covered by any test in this package. The store
 * tests cover the state those interactions produce; nothing covers the
 * wiring in between.
 *
 * It is also why every pane takes plain props instead of reaching into the
 * store — each one can be rendered on its own, with no provider. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPane } from "../components/ChatPane";
import { DiffPane } from "../components/DiffPane";
import { FileTreePane } from "../components/FileTreePane";
import { GatePane } from "../components/GatePane";
import { PreviewPane } from "../components/PreviewPane";
import { diffFileSets } from "../diff";
import { buildPreview } from "../preview/state";
import { changeByPath, findingsByPath, gateSummary } from "../selectors";
import { createStore } from "../store";
import { buildTree } from "../tree";
import { ALL_ENABLED, type Candidate } from "../types";
import { candidate, finding, wcClockFiles } from "./fixtures";

const noop = () => {};
const layers = () => ALL_ENABLED;

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("ChatPane", () => {
  it("renders an empty transcript without a round", () => {
    const out = html(
      <ChatPane turns={[]} rounds={[]} selectedRoundId={null} busy={false} onSubmit={noop} onSelectRound={noop} />,
    );
    expect(out).toContain("no rounds yet");
  });

  it("shows a round chip with the blocking count on the turn that produced it", () => {
    const store = createStore();
    const turnId = store.prompt("build a clock") ?? "";
    store.stream(turnId, "Planning…");
    store.settle(
      turnId,
      candidate({ findings: [finding("FD-G001", "server/subapps/wc-clock/routes/clocks.ts", 4, "no guard")] }),
    );
    const state = store.getState();

    const out = html(
      <ChatPane
        turns={state.turns}
        rounds={state.rounds}
        selectedRoundId={state.selectedRoundId}
        busy={false}
        onSubmit={noop}
        onSelectRound={noop}
      />,
    );
    expect(out).toContain("build a clock");
    expect(out).toContain("Works Council Clock");
    expect(out).toContain("1 blocking");
  });

  it("disables the composer while a round is in flight", () => {
    const out = html(
      <ChatPane turns={[]} rounds={[]} selectedRoundId={null} busy onSubmit={noop} onSelectRound={noop} />,
    );
    expect(out).toContain("disabled");
    expect(out).toContain("Generating…");
  });
});

describe("FileTreePane", () => {
  it("renders the tiers, their blurbs and a selected file's source", () => {
    const c = candidate();
    const out = html(
      <FileTreePane
        nodes={buildTree(c.files)}
        selectedPath="server/subapps/wc-clock/manifest.ts"
        changes={new Map()}
        findings={new Map()}
        collapsedDirs={new Set()}
        focusedRule={null}
        file={c.files.find((f) => f.kind === "manifest") ?? null}
        onSelect={noop}
        onToggle={noop}
      />,
    );
    expect(out).toContain("Server");
    expect(out).toContain("the page the host lazy-mounts");
    expect(out).toContain("manifest.ts");
  });

  it("shows change deltas and finding dots", () => {
    const c = candidate();
    const previous = c.files.map((f) =>
      f.kind === "manifest" ? { ...f, contents: `${f.contents}// extra\n` } : f,
    );
    const set = diffFileSets(previous, c.files);
    const out = html(
      <FileTreePane
        nodes={buildTree(c.files)}
        selectedPath={null}
        changes={changeByPath(set)}
        findings={findingsByPath(
          candidate({ findings: [finding("FD-M003", "server/subapps/wc-clock/manifest.ts", 9, "bad")] }),
        )}
        collapsedDirs={new Set()}
        focusedRule={null}
        file={null}
        onSelect={noop}
        onToggle={noop}
      />,
    );
    expect(out).toContain("fd-dot--error");
    expect(out).toContain("−1");
  });

  it("renders with no file selected", () => {
    expect(
      html(
        <FileTreePane
          nodes={[]}
          selectedPath={null}
          changes={new Map()}
          findings={new Map()}
          collapsedDirs={new Set()}
          focusedRule={null}
          file={null}
          onSelect={noop}
          onToggle={noop}
        />,
      ),
    ).toContain("Select a file.");
  });
});

describe("DiffPane", () => {
  it("says the first round has no base rather than showing an all-green diff", () => {
    const out = html(
      <DiffPane set={diffFileSets(null, wcClockFiles())} selectedPath={null} onSelect={noop} />,
    );
    expect(out).toContain("First round");
  });

  it("says so plainly when a round changed nothing", () => {
    const files = wcClockFiles();
    const out = html(<DiffPane set={diffFileSets(files, files)} selectedPath={null} onSelect={noop} />);
    expect(out).toContain("changed nothing");
  });

  it("renders a hunk header and the changed line for a real edit", () => {
    const before = wcClockFiles();
    const after = before.map((f) =>
      f.kind === "manifest" ? { ...f, contents: f.contents.replace("0.1.0", "0.2.0") } : f,
    );
    const out = html(<DiffPane set={diffFileSets(before, after)} selectedPath={null} onSelect={noop} />);
    expect(out).toContain("@@");
    expect(out).toContain("fd-op--remove");
    expect(out).toContain("fd-op--add");
    // The changed version is NOT present as a contiguous "0.2.0": the
    // intra-line highlighter split it into `version: "0.` / `2` / `.0",`
    // so only the digit that actually changed is marked. That split is
    // the feature — asserting on the whole string would pass just as well
    // with no highlighting at all.
    expect(out).toContain('<span class="fd-seg">2</span>');
    expect(out).toContain('<span class="fd-seg">1</span>');
  });

  it("renders nothing selected without throwing", () => {
    expect(html(<DiffPane set={null} selectedPath={null} onSelect={noop} />)).toContain("No round selected");
  });
});

describe("GatePane", () => {
  const render = (c: Candidate | null) =>
    html(
      <GatePane
        candidate={c}
        summary={gateSummary(c)}
        filter="all"
        focusedRule={null}
        onFilter={noop}
        onFocusRule={noop}
        onReveal={noop}
      />,
    );

  it("distinguishes 'clean' from 'nothing ran'", () => {
    // The distinction the gate itself insists on. `0 errors` reads the
    // same either way, and only one of them is trustworthy.
    expect(render(candidate())).toContain("rules ran and found nothing");
    expect(render(candidate({ rulesRun: [] }))).toContain("not a pass");
  });

  it("explains why blocking findings block", () => {
    const out = render(
      candidate({ findings: [finding("FD-M003", "server/subapps/wc-clock/manifest.ts", 9, "bad label")] }),
    );
    expect(out).toContain("FD-M003");
    expect(out).toContain("takes the whole server down at boot");
  });

  it("renders a warning-only candidate without calling it blocking", () => {
    const out = render(
      candidate({ findings: [finding("FD-X001", "(candidate)", 0, "no registry edit", "warning")] }),
    );
    expect(out).toContain("Nothing blocking");
    expect(out).toContain("about the file set");
  });

  it("renders with no candidate", () => {
    expect(render(null)).toContain("No round selected");
  });
});

describe("PreviewPane", () => {
  const render = (c: Candidate | null) =>
    html(
      <PreviewPane
        state={buildPreview({ candidate: c, layers })}
        enable={ALL_ENABLED}
        onEnable={noop}
        onRevealFile={noop}
      />,
    );

  it("renders the frame, the switches and the ledger when ready", () => {
    const out = render(candidate());
    expect(out).toContain("<iframe");
    // The isolation the frame relies on. `allow-scripts` must never
    // appear here: nothing inside the frame is ever meant to run.
    expect(out).toContain('sandbox="allow-same-origin"');
    expect(out).not.toContain("allow-scripts");
    expect(out).toContain("Kill switch");
    expect(out).toContain("Ceiling row");
    expect(out).toContain("SQL and initSchema");
  });

  it("names the path it wanted when there is no page", () => {
    const out = render(candidate({ files: wcClockFiles().filter((f) => f.kind !== "web-module") }));
    expect(out).toContain("web/src/subapps/wc-clock/index.tsx");
    expect(out).toContain("A server-only sub-app is legal");
  });

  it("explains renderer drift as Studio's problem, not the app's", () => {
    const drifted = wcClockFiles().map((f) =>
      f.kind === "web-module" ? { ...f, contents: f.contents.replace("class ApiRefusal", "class Other") } : f,
    );
    const out = render(candidate({ files: drifted }));
    expect(out).toContain("out of date, not your app");
    expect(out).toContain("refusal-class");
  });

  it("invites a first prompt rather than showing an empty frame", () => {
    expect(render(null)).toContain("Nothing to preview yet");
  });

  it("blocks on a web-module finding and shows it", () => {
    const out = render(
      candidate({ findings: [finding("FD-X003", "web/src/subapps/wc-clock/index.tsx", 1, "no Page export")] }),
    );
    expect(out).toContain("gate refused the page itself");
    expect(out).toContain("FD-X003");
  });

  it("does NOT block on a server finding — it renders the page with the finding pinned to its panel", () => {
    const out = render(
      candidate({
        findings: [finding("FD-G001", "server/subapps/wc-clock/routes/clocks.ts", 14, "handler skips the guard")],
      }),
    );
    expect(out).toContain("<iframe");
    expect(out).not.toContain("gate refused");
  });
});
