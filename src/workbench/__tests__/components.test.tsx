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
import { ThemeToggle } from "../components/ThemeToggle";
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
import wcClockSpec from "../../../fixtures/wc-clock.spec.json";
import { drive } from "../../drive";

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

  // unseen#88: the scripted session streamed `for **Works Council Clock**`
  // and the pane printed the asterisks. Chat text is plain text: the Studio
  // turn quotes the person's prompt and can carry error text, so markup in
  // it cannot be told apart from what somebody typed. The real driver, the
  // real store.
  async function driven(text: string): Promise<string> {
    const store = createStore();
    const turnId = store.prompt(text) ?? "";
    await drive(store, turnId, text, wcClockSpec, { tickMs: 0 });
    const state = store.getState();
    return html(
      <ChatPane
        turns={state.turns}
        rounds={state.rounds}
        selectedRoundId={state.selectedRoundId}
        busy={false}
        onSubmit={noop}
        onSelectRound={noop}
      />,
    );
  }

  it("names the driver's label without literal asterisks", async () => {
    const out = await driven("Track the statutory consultation window for a contract folder.");
    expect(out).not.toContain("**");
    expect(out).toContain("files for Works Council Clock.");
  });

  it("quotes a prompt with one ** verbatim, and the label stays clean", async () => {
    const out = await driven("Track 2**3 windows for a folder");
    expect(out).toContain("Reading &quot;Track 2**3 windows for a folder&quot; as a mini-app spec.");
    expect(out).toContain("files for Works Council Clock.");
    expect(out).not.toContain("Works Council Clock**");
    expect(out).not.toContain("<strong>");
  });

  it("quotes a prompt with paired ** verbatim, never restyled", async () => {
    const out = await driven("make it **loud** please");
    expect(out).toContain("Reading &quot;make it **loud** please&quot; as a mini-app spec.");
    expect(out).not.toContain("<strong>");
  });

  it("Studio text is never parsed as markup: globs and HTML stay as written", () => {
    const store = createStore();
    const turnId = store.prompt("x") ?? "";
    store.stream(turnId, "tsc failed on src/**/*.ts and **<img src=x onerror=alert(1)>**");
    const state = store.getState();
    const out = html(
      <ChatPane turns={state.turns} rounds={[]} selectedRoundId={null} busy onSubmit={noop} onSelectRound={noop} />,
    );
    expect(out).toContain("tsc failed on src/**/*.ts and **&lt;img src=x onerror=alert(1)&gt;**");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<strong>");
  });

  it("what a person typed is shown exactly as typed", () => {
    const store = createStore();
    store.prompt("make it **loud**");
    const state = store.getState();
    const out = html(
      <ChatPane turns={state.turns} rounds={[]} selectedRoundId={null} busy onSubmit={noop} onSelectRound={noop} />,
    );
    expect(out).toContain("make it **loud**");
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
    // The label is no longer the button's whole content — Atlas puts a
    // line icon before it (components/LineIcon.tsx) — so this matches an
    // opening tag and everything up to the label WITHOUT crossing into
    // another button.
    const button = (out: string) =>
      /<button(?:(?!<button)[\s\S])*?Download candidate<\/button>/.exec(out)?.[0] ?? null;
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
      // The reason names the rule and the place, so the tooltip is enough on
      // its own, without switching to the Gate tab.
      expect(drawn).toMatch(/title="[^"]*FD-G001 server\/subapps\/wc-clock\/manifest\.ts:1 — x[^"]*"/);
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

  // ⭐ The Gate tab used to render `gateSummary(candidate)` — Studio's own
  // verdict on Studio's text, from before the person touched anything —
  // while the verdict over the EDITED files fed only the Download button.
  // A saved edit that breaks the host's schema left the Gate tab clean and
  // the button disabled, with the only explanation in a tooltip.
  describe("the Gate tab after a saved edit", () => {
    const MANIFEST = "server/subapps/wc-clock/manifest.ts";
    const UNKNOWN_SECTION = `navSection: "Mini apps"`;
    const fd003 = finding("FD-M003", MANIFEST, 36, "navSection is not one of the host's five sections");
    /** Stands in for the real gate (`src/wiring.ts`, run for real in
     * `src/__tests__/wiring.test.ts`): FD-M003 when the manifest names a
     * section the host does not have. */
    const gate = (files: readonly { path: string; contents: string }[]) =>
      files.some((f) => f.path === MANIFEST && f.contents.includes(UNKNOWN_SECTION))
        ? { ok: false, findings: [fd003], rulesRun: ["FD-M001", "FD-M003"] }
        : { ok: true, findings: [], rulesRun: ["FD-M001", "FD-M003"] };
    const button = (out: string) =>
      /<button(?:(?!<button)[\s\S])*?Download candidate<\/button>/.exec(out)?.[0] ?? null;
    const gatePane = (out: string) => out.slice(Math.max(0, out.indexOf('class="fd-gate"')));
    const gateTab = (out: string) =>
      /<button[^>]*role="tab"(?:(?!<button)[\s\S])*?Gate(?:(?!<button)[\s\S])*?<\/button>/.exec(out)?.[0] ?? null;

    function onGate() {
      const store = createStore();
      store.settle(store.prompt("build it") ?? "", candidate());
      store.setView("gate");
      return store;
    }

    function saveNavSection(store: ReturnType<typeof createStore>) {
      const text = wcClockFiles().find((f) => f.path === MANIFEST)?.contents ?? "";
      const edited = text.replace(`navSection: "Contract pipeline"`, UNKNOWN_SECTION);
      expect(edited).not.toBe(text);
      store.editFile(MANIFEST, edited);
      store.saveFile(MANIFEST);
    }

    it("⭐ shows FD-M003 from the edited files, blocking, as the Download button is", () => {
      const store = onGate();
      saveNavSection(store);
      const out = html(<Workbench store={store} onPrompt={noop} checkFiles={gate} />);

      // The Download button is disabled by the edited-files verdict …
      expect(button(out)).toContain("disabled");
      // … and the Gate pane now says the same thing, first, under its own
      // name. (Scoped to the pane: the button's tooltip names FD-M003 too.)
      const pane = gatePane(out);
      expect(pane).toContain("FD-M003");
      expect(pane).toContain("Your edited files");
      expect(pane).toContain("navSection is not one of the host&#x27;s five sections");
      const yours = pane.slice(pane.indexOf("Your edited files"), pane.indexOf("Studio&#x27;s generation"));
      expect(yours).toContain("FD-M003");
      expect(yours).toContain("would refuse the download");
      // Studio's own verdict is still there, second, and still clean.
      expect(pane.indexOf("Studio&#x27;s generation")).toBeGreaterThan(pane.indexOf("Your edited files"));
      // The Gate tab's badge follows the verdict the pane leads with.
      expect(gateTab(out)).toContain("fd-tab__count--error");
    });

    it("says the edited files are clean when the gate passes on them, and the button is ready", () => {
      const store = onGate();
      store.editFile(MANIFEST, "// mine, still conformant\n");
      store.saveFile(MANIFEST);
      const out = html(<Workbench store={store} onPrompt={noop} checkFiles={gate} />);
      expect(button(out)).not.toContain("disabled");
      expect(out).toContain("Your edited files");
      expect(out).not.toContain("would refuse the download");
      expect(gateTab(out)).not.toContain("fd-tab__count");
    });

    it("fails closed in the pane when the gate cannot run on the edited files", () => {
      const store = onGate();
      saveNavSection(store);
      const throwing = () => {
        throw new Error("gate crashed");
      };
      const out = html(<Workbench store={store} onPrompt={noop} checkFiles={throwing} />);
      expect(button(out)).toContain("disabled");
      expect(out).toContain("Your edited files");
      expect(out).toContain("could not run on your edited files");
    });

    it("shows the single verdict, as before, when nothing is edited", () => {
      const store = onGate();
      const out = html(<Workbench store={store} onPrompt={noop} checkFiles={gate} />);
      expect(out).not.toContain("Your edited files");
      expect(out).not.toContain("Studio&#x27;s generation");
      expect(out).toContain("rules ran and found nothing");
    });
  });
});

describe("theme", () => {
  it("defaults to Atlas light and draws no toggle when the driver cannot remember one", () => {
    const out = html(<Workbench store={createStore()} onPrompt={noop} />);
    expect(out).toContain('class="fd-wb" data-theme="light"');
    // A switch that does nothing would be worse than none. (Markup, not the
    // class name: the injected <style> names every class it styles.)
    expect(out).not.toContain('class="fd-themetoggle"');
  });

  it("offers the OTHER theme, and keeps it out of the tablist", () => {
    const out = html(<Workbench store={createStore()} onPrompt={noop} theme="dark" onThemeChange={noop} />);
    expect(out).toContain('data-theme="dark"');
    expect(out).toContain('aria-label="Switch to light theme"');
    // The tablist holds only tabs; the toggle sits after it, not inside it.
    const start = out.indexOf('role="tablist"');
    const tablist = out.slice(start, out.indexOf('class="fd-tabs__spacer"', start));
    expect(tablist.match(/role="tab"/g)).toHaveLength(5);
    expect(tablist).not.toContain('class="fd-themetoggle"');
    expect(out.slice(start)).toContain('class="fd-themetoggle"');
  });

  it("draws the moon in light and the sun in dark, as Atlas does", () => {
    const light = html(<ThemeToggle theme="light" onChange={noop} />);
    const dark = html(<ThemeToggle theme="dark" onChange={noop} />);
    expect(light).toContain('aria-label="Switch to dark theme"');
    expect(light).not.toContain("<circle");
    expect(dark).toContain("<circle");
  });
});
