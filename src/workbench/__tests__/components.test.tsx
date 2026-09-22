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
 * papered over: clicking a tab, typing a prompt, typing into the EDITOR,
 * pressing stop and submitting a form in the preview frame are not covered
 * by any test in this package. The store tests cover the state those
 * interactions produce — including every edit, save, revert, conflict
 * resolution and abort — and `run.test.ts`/`editing.test.ts` cover the
 * models underneath; nothing covers the wiring in between.
 *
 * It is also why every pane takes plain props instead of reaching into the
 * store — each one can be rendered on its own, with no provider. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPane } from "../components/ChatPane";
import { DiffPane } from "../components/DiffPane";
import { EditorPane } from "../components/EditorPane";
import { FileTreePane } from "../components/FileTreePane";
import { GatePane } from "../components/GatePane";
import { PreviewPane } from "../components/PreviewPane";
import { RunPane } from "../components/RunPane";
import { Workbench } from "../Workbench";
import { diffFileSets } from "../diff";
import { editDraft, openDraft, saveDraft, type Draft } from "../editing";
import { MAX_LOG_LINES, createStep, endStep, pushOutput, startStep, type Run, type Step } from "../run";
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

describe("RunPane", () => {
  function run(steps: Step[], endedAt: number | null = null): Run {
    return { turnId: "t1", steps, startedAt: 0, endedAt, abortRequested: false };
  }

  it("renders queued steps rather than hiding the work that has not happened", () => {
    // The shape of the remaining work is information: a person who can see
    // the typecheck has not run yet knows not to trust a green gate.
    const out = html(
      <RunPane
        busy
        run={run([
          endStep(startStep(createStep({ id: "a", label: "plan against the contract" }), 1), "succeeded", 2),
          startStep(createStep({ id: "b", label: "emit source" }), 3),
          createStep({ id: "c", label: "typecheck against the host surface" }),
        ])}
      />,
    );
    expect(out).toContain("plan against the contract");
    expect(out).toContain("typecheck against the host surface");
    expect(out).toContain("fd-step--queued");
    expect(out).toContain("1 / 3 steps");
  });

  it("puts a failing step's reason and its raw output on the step", () => {
    let step = startStep(createStep({ id: "tsc", label: "typecheck" }), 1);
    step = pushOutput(step, "error TS2307: Cannot find module 'zod'\n", "err");
    step = endStep(step, "failed", 2, { error: "tsc exited 2", exitCode: 2 });

    const out = html(<RunPane busy={false} run={run([step], 3)} />);
    expect(out).toContain("tsc exited 2");
    // A failed step opens its own log: the output is the whole reason
    // anybody clicked into this pane.
    expect(out).toContain("TS2307");
    expect(out).toContain("exit 2");
    expect(out).toContain("fd-out--err");
  });

  it("says how many lines it dropped instead of starting mid-sentence", () => {
    let step = startStep(createStep({ id: "noisy", label: "mount probe" }), 1);
    for (let i = 0; i < MAX_LOG_LINES + 7; i += 1) step = pushOutput(step, `line ${i}\n`);
    step = endStep(step, "failed", 2, { error: "probe crashed" });
    expect(html(<RunPane busy={false} run={run([step], 3)} />)).toContain("7 earlier lines dropped");
  });

  it("offers a stop button only while the round is in flight", () => {
    const steps = [startStep(createStep({ id: "a", label: "emit" }), 1)];
    expect(html(<RunPane busy run={run(steps)} onStop={noop} />)).toContain("Stop");
    expect(html(<RunPane busy={false} run={run(steps, 2)} onStop={noop} />)).not.toContain(">Stop<");
    // No handler, no button — a dead stop is worse than none, because the
    // whole value of the control is that a person believes it.
    expect(html(<RunPane busy run={run(steps)} />)).not.toContain(">Stop<");
  });

  it("renders before anything has run", () => {
    expect(html(<RunPane busy={false} run={null} />)).toContain("Nothing has run yet");
  });
});

describe("EditorPane", () => {
  const FILE = { path: "server/subapps/wc-clock/manifest.ts", contents: "one\ntwo\n", kind: "manifest" as const };

  it("renders read-only with no callbacks — no dead buttons", () => {
    const out = html(<EditorPane file={FILE} findings={[]} />);
    expect(out).toContain("manifest.ts");
    expect(out).not.toContain("Save");
    expect(out).not.toContain("<textarea");
  });

  it("shows the unsaved marker and the two separate undos", () => {
    const draft = saveDraft(editDraft(openDraft(FILE, "r1"), "one\nedited\n"));
    const dirty = editDraft(draft, "one\nedited again\n");
    const out = html(
      <EditorPane file={FILE} generated={FILE} draft={dirty} findings={[]} onEdit={noop} onSave={noop} onRevert={noop} onRestore={noop} />,
    );
    expect(out).toContain("unsaved");
    // Owner ruling 2026-09-22 (9): the label and tooltip say where a save
    // goes — into the workbench, and nowhere else.
    expect(out).toContain(">Save in workbench<");
    expect(out).toMatch(/title="[^"]*Nothing is written to disk, the server or the host repo[^"]*"/);
    // Revert drops typing; restore drops the edit. Two buttons because
    // they destroy different things.
    expect(out).toContain(">Revert<");
    expect(out).toContain("Restore generated");
    expect(out).toContain("<textarea");
  });

  it("names the conflict and labels both answers with what they destroy", () => {
    const draft: Draft = {
      ...saveDraft(editDraft(openDraft(FILE, "r1"), "mine\n")),
      conflict: { kind: "regenerated", incoming: "one\ntwo\n", held: "mine\n", fromLock: false, at: 1 },
    };
    const out = html(<EditorPane file={FILE} draft={draft} findings={[]} onEdit={noop} onResolve={noop} />);
    expect(out).toContain("Studio rewrote this file while you had your own version");
    expect(out).toContain("Keep mine");
    expect(out).toContain("Take Studio&#x27;s — discard my version");
    // No typing until it is answered: a third version helps nobody.
    expect(out).not.toContain("<textarea");
  });

  it("says a file is read-only while a step is writing it", () => {
    const out = html(
      <EditorPane file={FILE} findings={[]} onEdit={noop} beingWritten={new Set([FILE.path])} />,
    );
    expect(out).toContain("writing this file right now");
    expect(out).not.toContain("<textarea");
  });

  it("refuses to edit an earlier round and says it is a record", () => {
    const out = html(<EditorPane file={FILE} findings={[]} onEdit={noop} historical />);
    expect(out).toContain("record");
  });

  it("still annotates findings on the lines they fired on", () => {
    const out = html(
      <EditorPane
        file={FILE}
        findings={[finding("FD-M003", FILE.path, 2, "label is an i18n key")]}
        onEdit={noop}
      />,
    );
    expect(out).toContain("FD-M003");
    expect(out).toContain('data-finding="error"');
  });
});

describe("the shell, wired to a store", () => {
  /** The one test that renders the WORKBENCH rather than a pane. Every
   * other test here hands a component its props directly, which is what
   * makes them readable and is also what makes them blind to the wiring:
   * a pane can be perfect and still never be reached. */
  function running() {
    const store = createStore();
    const turnId = store.prompt("a works-council clock") ?? "";
    store.plan(turnId, [
      { id: "plan", label: "plan against the contract" },
      { id: "tsc", label: "typecheck against the host surface" },
    ]);
    store.startStep("plan");
    store.output("plan", "resolved 2 domains\n");
    return { store, turnId };
  }

  it("lands on the run pane while a round is in flight, with a way out of it", () => {
    const { store } = running();
    const out = html(<Workbench store={store} onPrompt={noop} />);

    expect(out).toContain("plan against the contract");
    expect(out).toContain("resolved 2 domains");
    // Queued work is visible, so a person knows what has NOT been checked.
    expect(out).toContain("typecheck against the host surface");
    expect(out).toContain("fd-step--queued");
    // And the round can be stopped from both places a person is looking.
    expect(out.match(/Stop/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("aborts the round itself when the driver supplies no way to cancel", () => {
    // A stop button that leaves the round running is the one lie this
    // pane cannot afford, so the fallback is real: the turn ends, and
    // `settle` then refuses the candidate that arrives too late.
    const { store, turnId } = running();
    html(<Workbench store={store} onPrompt={noop} />);

    const stopped = store.requestAbort();
    expect(stopped).toBe(turnId);
    store.abort(turnId);

    expect(store.getState().busy).toBe(false);
    expect(store.settle(turnId, candidate())).toBeNull();
  });

  it("shows an edit's aggregate in the tab strip once it is saved", () => {
    const store = createStore();
    store.settle(store.prompt("build it") ?? "", candidate());
    const manifest = "server/subapps/wc-clock/manifest.ts";
    store.editFile(manifest, "// mine\n");

    expect(html(<Workbench store={store} onPrompt={noop} />)).toContain("1 unsaved");
    store.saveFile(manifest);
    const saved = html(<Workbench store={store} onPrompt={noop} />);
    expect(saved).toContain("1 edited");
    // One authoritative model: the saved text is what the file pane shows.
    expect(saved).toContain("// mine");
  });

  // ⭐ Owner ruling 2026-09-22 (9): "Download candidate", browser-only, and
  // enabled only when the conformance gate passes on the EDITED files.
  describe("Download candidate", () => {
    const button = (out: string) => /<button[^>]*>Download candidate<\/button>/.exec(out)?.[0] ?? null;
    const passing = () => ({ ok: true, findings: [], rulesRun: ["FD-M001"] });
    const failingOnEdits = (files: readonly { contents: string }[]) =>
      files.some((f) => f.contents.includes("BROKEN"))
        ? { ok: false, findings: [finding("FD-G001", "server/subapps/wc-clock/manifest.ts", 1, "x")], rulesRun: ["FD-G001"] }
        : passing();

    it("is not drawn when the driver supplies no gate — no dead buttons", () => {
      const store = createStore();
      store.settle(store.prompt("build it") ?? "", candidate());
      expect(button(html(<Workbench store={store} onPrompt={noop} />))).toBeNull();
    });

    it("is enabled when the gate passes on the round's files", () => {
      const store = createStore();
      store.settle(store.prompt("build it") ?? "", candidate());
      const drawn = button(html(<Workbench store={store} onPrompt={noop} checkFiles={passing} />));
      expect(drawn).not.toBeNull();
      expect(drawn).not.toContain("disabled");
      expect(drawn).toMatch(/title="[^"]*nothing is sent to the server[^"]*"/i);
    });

    it("⭐ is disabled, saying why, when a saved edit makes the gate fail", () => {
      const store = createStore();
      store.settle(store.prompt("build it") ?? "", candidate());
      store.editFile("server/subapps/wc-clock/manifest.ts", "// BROKEN\n");
      store.saveFile("server/subapps/wc-clock/manifest.ts");
      const drawn = button(html(<Workbench store={store} onPrompt={noop} checkFiles={failingOnEdits} />));
      expect(drawn).toContain("disabled");
      expect(drawn).toMatch(/title="[^"]*conformance gate fails on the edited files/i);
    });

    it("is disabled while an edit is unsaved", () => {
      const store = createStore();
      store.settle(store.prompt("build it") ?? "", candidate());
      store.editFile("server/subapps/wc-clock/manifest.ts", "// typing\n");
      const drawn = button(html(<Workbench store={store} onPrompt={noop} checkFiles={passing} />));
      expect(drawn).toContain("disabled");
    });

    it("is disabled before any round has landed", () => {
      const drawn = button(html(<Workbench store={createStore()} onPrompt={noop} checkFiles={passing} />));
      expect(drawn).toContain("disabled");
    });
  });
});
