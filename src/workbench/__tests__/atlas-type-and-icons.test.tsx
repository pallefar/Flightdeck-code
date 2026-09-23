/** The six things that still said "not Atlas" after the colour reskin.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM theme.test.ts ──────────────
 * `theme.test.ts` fences the PALETTE: two themes, the same token names,
 * no hand-typed hexes. The reskin it guards succeeded — a blind reviewer
 * comparing Studio with Flightdeck Atlas found the colours, borders, radii
 * and shadows matching almost pixel for pixel. What still gave Studio away
 * was TYPE and ICONS, which that file deliberately says nothing about.
 *
 * ── EVERY NUMBER BELOW WAS MEASURED, NOT COPIED ─────────────────────
 * Each assertion cites the Atlas element it came from, read off the
 * running Atlas on :5173 at a 1440px viewport in light theme with
 * `.shots/probe-atlas.mjs` (getComputedStyle, not the stylesheet — so
 * later cascade overrides are included, which matters: Atlas's `.eyebrow`
 * is declared 10px at `globals.css:272` and then reset to 12px by the
 * unconditional "Readable working-surface typography" block at
 * `globals.css:1519-1541`, and 12px is what a person actually sees).
 *
 *   .page-heading .eyebrow   12px / 600 / letter-spacing 2px / #5a7383
 *   .page-heading h1         36.72px / 500 / letter-spacing -1.5px / 1.25
 *                            (`clamp(29px, 2.55vw, 43px)` at 1440px)
 *   .metric-label            12px / 600 / letter-spacing 0.85px, flex with
 *                            `justify-content: space-between`
 *   .metric-label svg        15px, stroke-width 2, viewBox 0 0 24 24
 *   .metric > strong         35px / 500 / -1px, colour INHERITED (#253d4b)
 *                            on every tile, margin 10px 0 6px
 *   .metric > span           12px caption under the number
 *   .nav-item svg            18px      .view-tabs button svg   17px
 *   .add-button svg          16px      (all `stroke="currentColor"`)
 *   .view-tabs               white track, radius 12px, padding 4px
 *   .view-tab-indicator      #fff0d9, radius 8px, 0 2px 6px #b9731420
 *   .filter-tabs             #edf3f6 track, radius 7px, padding 3px, gap 3px
 *   .filter-tabs .chosen     #fff, radius 4px, 0 1px 4px #17384c16
 *
 * Nowhere in Atlas's chrome is there a monospace font: `--font-mono` is
 * declared and used by code samples only. Studio leaked it into the
 * topbar metadata, the file-path header, "54 lines", the route prefix,
 * the rule id and the "(candidate)" scope line. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPane } from "../components/ChatPane";
import { DiffPane } from "../components/DiffPane";
import { EditorPane } from "../components/EditorPane";
import { FileTreePane } from "../components/FileTreePane";
import { GatePane } from "../components/GatePane";
import { ICON_NAMES, LineIcon } from "../components/LineIcon";
import { PreviewPane } from "../components/PreviewPane";
import { RunPane } from "../components/RunPane";
import { PAGE_HEADS, Workbench } from "../Workbench";
import { diffFileSets } from "../diff";
import { createStep, endStep, pushOutput, startStep, type Run } from "../run";
import { buildPreview } from "../preview/state";
import { changeByPath, findingsByPath, gateSummary } from "../selectors";
import { createStore } from "../store";
import { buildTree } from "../tree";
import { TOKENS, WORKBENCH_CSS } from "../theme";
import { ALL_ENABLED, type WorkbenchView } from "../types";
import { candidate, finding, wcClockFiles } from "./fixtures";

const noop = () => {};
const layers = () => ALL_ENABLED;

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

/** The body of one CSS rule in `WORKBENCH_CSS`, by exact selector text.
 * Matching the selector exactly (rather than `toContain`) is what makes a
 * changed declaration a failure rather than a second rule that silently
 * loses the cascade. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[},/])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(WORKBENCH_CSS);
  expect(match, `no rule for \`${selector}\` in WORKBENCH_CSS`).not.toBeNull();
  return match![1]!;
}

/** Every selector in `WORKBENCH_CSS` that sets the monospace stack. */
function monoSelectors(): string[] {
  const out: string[] = [];
  for (const match of WORKBENCH_CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/font-family:\s*var\(--mono\)|font:[^;]*var\(--mono\)/.test(match[2]!)) {
      out.push(match[1]!.replace(/\s+/g, " ").trim());
    }
  }
  return out;
}

/** The whole workbench, one round in, on `view`. */
function workbench(view: WorkbenchView): string {
  const store = createStore();
  const turnId = store.prompt("build a clock") ?? "";
  store.stream(turnId, "Planning…");
  store.settle(
    turnId,
    candidate({
      findings: [
        finding("FD-X001", "(candidate)", 0, "no registry edit", "warning"),
        finding("FD-G001", "server/subapps/wc-clock/routes/clocks.ts", 4, "no guard"),
      ],
    }),
  );
  store.setView(view);
  return html(<Workbench store={store} onPrompt={noop} onStop={noop} onThemeChange={noop} />);
}

/** Every `<svg …>` open tag in a rendered pane. */
function svgs(markup: string): string[] {
  return markup.match(/<svg[^>]*>/g) ?? [];
}

// ── 1. ICONS ────────────────────────────────────────────────────────
// Atlas puts a lucide stroke icon beside nearly every label. Studio had
// exactly one SVG in the whole workbench — the theme toggle.

describe("1. line icons, the way the OS solved the same problem", () => {
  it("draws a lucide node inline: 24-grid, currentColor, 2px stroke, decorative", () => {
    const out = html(<LineIcon name="shield-check" />);
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('stroke-linecap="round"');
    expect(out).toContain('fill="none"');
    expect(out).toContain('aria-hidden="true"');
    // shield-check is two paths in lucide v1.31.0 — the shield and the tick.
    expect((out.match(/<path/g) ?? []).length).toBe(2);
  });

  it("takes a size, and defaults to the 17px Atlas uses on a view tab", () => {
    expect(html(<LineIcon name="play" />)).toContain('width="17"');
    expect(html(<LineIcon name="folder" size={15} />)).toContain('width="15"');
  });

  it("adds no npm dependency — the path data is inline, as web/src/components/LineIcon.tsx does", async () => {
    const pkg = await import("../../../package.json");
    const deps = { ...pkg.default.dependencies, ...pkg.default.devDependencies } as Record<string, string>;
    expect(Object.keys(deps)).not.toContain("lucide-react");
    expect(Object.keys(deps).filter((name) => /lucide|icon|heroicon|feather/i.test(name))).toEqual([]);
  });

  it("gives every view tab a leading icon, as Atlas's `.view-tabs button` has", () => {
    const out = workbench("gate");
    const tabs = out.match(/<button[^>]*role="tab"[\s\S]*?<\/button>/g) ?? [];
    expect(tabs.length).toBe(5);
    for (const tab of tabs) expect(svgs(tab).length).toBeGreaterThan(0);
  });

  it("gives every sidebar row an icon, as Atlas's `.nav-item` has", () => {
    const out = html(
      <FileTreePane
        nodes={buildTree(wcClockFiles(), new Set())}
        selectedPath={null}
        changes={new Map()}
        findings={new Map()}
        collapsedDirs={new Set()}
        focusedRule={null}
        file={null}
        onSelect={noop}
        onToggle={noop}
      />,
    );
    const rows = out.match(/<button[^>]*class="fd-tree[\s\S]*?<\/button>/g) ?? [];
    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows) expect(svgs(row).length).toBeGreaterThan(0);
  });

  it("gives Build, Reset mock and Lock an icon — they were text only", () => {
    const build = html(
      <ChatPane turns={[]} rounds={[]} selectedRoundId={null} busy={false} onSubmit={noop} onSelectRound={noop} />,
    );
    const send = /<button[^>]*class="fd-composer__send"[\s\S]*?<\/button>/.exec(build)?.[0] ?? "";
    expect(svgs(send).length).toBe(1);

    const cand = candidate();
    const preview = html(
      <PreviewPane
        state={buildPreview({ candidate: cand, layers })}
        enable={ALL_ENABLED}
        onEnable={noop}
        onRevealFile={noop}
      />,
    );
    const reset = /<button[^>]*class="fd-tab"[\s\S]*?<\/button>/.exec(preview)?.[0] ?? "";
    expect(reset).toContain("Reset mock");
    expect(svgs(reset).length).toBe(1);

    const editor = html(
      <EditorPane file={cand.files[0]!} findings={[]} onEdit={() => null} onToggleLock={noop} />,
    );
    const lock = /<button[^>]*class="fd-lockbtn"[\s\S]*?<\/button>/.exec(editor)?.[0] ?? "";
    expect(lock).toContain("Lock");
    expect(svgs(lock).length).toBe(1);
  });

  it("uses chevron-right / chevron-down for disclosure, never a Unicode triangle", () => {
    const step = endStep(
      pushOutput(startStep(createStep({ id: "gate", label: "conformance gate" }), 0), "2 rules ran\n"),
      "succeeded",
      1,
    );
    const run: Run = { turnId: "t1", steps: [step], startedAt: 0, endedAt: 1, abortRequested: false };
    const panes = [workbench("files"), workbench("diff"), html(<RunPane run={run} busy={false} />)].join("");

    // lucide chevron-right is `m9 18 6-6-6-6`; chevron-down is `m6 9 6 6 6-6`.
    expect(panes).toMatch(/m9 18 6-6-6-6|m6 9 6 6 6-6/);
    for (const glyph of ["▸", "▾", "▴", "◂", "●", "◆", "▲", "⌷", "◷", "⃠"]) {
      expect(panes, `Unicode glyph ${glyph} still in the chrome`).not.toContain(glyph);
    }
  });

  it("names every icon it ships, so a typo is a type error and not a blank square", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    for (const name of ICON_NAMES) expect(svgs(html(<LineIcon name={name} />)).length).toBe(1);
  });
});

// ── 2. THE PAGE-HEADER TIER ─────────────────────────────────────────
// Atlas's signature. Studio had no heading on any view.

describe("2. the page-header tier Atlas opens every view with", () => {
  it("carries Atlas's eyebrow: 12px, 600, 2px tracking, uppercase, on the eyebrow token", () => {
    const head = rule(".fd-pagehead__eyebrow");
    expect(head).toMatch(/font-size:\s*12px/);
    expect(head).toMatch(/font-weight:\s*600/);
    expect(head).toMatch(/letter-spacing:\s*2px/);
    expect(head).toMatch(/text-transform:\s*uppercase/);
    expect(head).toMatch(/color:\s*var\(--eyebrow\)/);
    expect(TOKENS.light.eyebrow).toBe("#5a7383");
  });

  it("carries Atlas's h1: clamp(29px, 2.55vw, 43px) — 36.72px at 1440 — 500, -1.5px, 1.25", () => {
    const head = rule(".fd-pagehead__h");
    expect(head).toMatch(/font-size:\s*clamp\(29px,\s*2\.55vw,\s*43px\)/);
    expect(head).toMatch(/font-weight:\s*500/);
    expect(head).toMatch(/letter-spacing:\s*-1\.5px/);
    expect(head).toMatch(/line-height:\s*1\.25/);
    expect(head).toMatch(/color:\s*var\(--ink\)/);
  });

  it("gives all five views an eyebrow and a heading", () => {
    const views: readonly WorkbenchView[] = ["run", "files", "diff", "preview", "gate"];
    expect(Object.keys(PAGE_HEADS).sort()).toEqual([...views].sort());
    for (const view of views) {
      const out = workbench(view);
      const head = PAGE_HEADS[view];
      expect(out, `${view} has no eyebrow`).toContain(`class="fd-pagehead__eyebrow"`);
      expect(out, `${view} has no heading`).toContain(`<h1 class="fd-pagehead__h">`);
      expect(out).toContain(head.eyebrow);
      expect(out).toContain(head.heading);
      expect(head.eyebrow).toBe(head.eyebrow.toUpperCase());
    }
  });
});

// ── 3. SMALL LABELS ARE ONE SIZE TOO SMALL ──────────────────────────
// Atlas's eyebrows are 12px, not 10px, and its `.metric-label` is 12px
// with 0.85px tracking.

describe("3. the small-label scale", () => {
  it("puts every eyebrow at Atlas's 12px — YOU/STUDIO, SERVER/WEB and the side headings", () => {
    for (const selector of [".fd-turn__who", ".fd-tree__tierlabel", ".fd-side__h"]) {
      const body = rule(selector);
      expect(body, selector).toMatch(/font-size:\s*12px/);
      expect(body, selector).toMatch(/font-weight:\s*600/);
      expect(body, selector).toMatch(/letter-spacing:\s*2px/);
    }
  });

  it("puts the gate tile label at Atlas's `.metric-label`: 12px / 600 / 0.85px", () => {
    const body = rule(".fd-stat__k");
    expect(body).toMatch(/font-size:\s*12px/);
    expect(body).toMatch(/font-weight:\s*600/);
    expect(body).toMatch(/letter-spacing:\s*0\.85px/);
  });

  it("leaves no 10px eyebrow behind", () => {
    for (const selector of [".fd-turn__who", ".fd-tree__tierlabel", ".fd-side__h", ".fd-stat__k"]) {
      expect(rule(selector), selector).not.toMatch(/font-size:\s*10px/);
    }
  });
});

// ── 4. MONOSPACE LEAKING INTO THE CHROME ────────────────────────────
// Atlas never uses it outside code. Studio's topbar metadata, file-path
// header, "54 lines", route prefix, rule id and "(candidate)" line did.

describe("4. monospace stays in the code", () => {
  const CHROME = [".fd-tabs__id", ".fd-source__path", ".fd-finding__rule", ".fd-finding__where"];

  it("takes the monospace stack off the six chrome labels the reviewer named", () => {
    for (const selector of CHROME) {
      expect(rule(selector), selector).not.toMatch(/var\(--mono\)/);
    }
  });

  it("keeps it on the editor, the read view, the diff and process output — those ARE code", () => {
    const selectors = monoSelectors().join(" | ");
    for (const kept of [".fd-code", ".fd-editor", ".fd-step__log pre", ".fd-finding__ev"]) {
      expect(selectors, kept).toContain(kept);
    }
  });

  it("declares the monospace stack in no rule that styles the chrome labels", () => {
    const selectors = monoSelectors();
    for (const selector of CHROME) {
      const leaking = selectors.filter((s) => s.split(",").some((part) => part.trim() === selector));
      expect(leaking, `${selector} is still monospace`).toEqual([]);
    }
  });

  it("keeps counts on tabular digits in the sans stack, as Atlas does", () => {
    const tabular = WORKBENCH_CSS.match(/[^{}]+\{[^}]*font-variant-numeric:\s*tabular-nums[^}]*\}/g) ?? [];
    expect(tabular.join(" ")).toContain(".fd-tabs__id");
  });
});

// ── 5. THE GATE STAT TILES ──────────────────────────────────────────
// Atlas's `.metric` numbers are ALWAYS ink; the meaning lives in a
// corner icon and a caption under the number.

describe("5. the gate stat tiles follow Atlas's `.metric`", () => {
  const gate = () => {
    const cand = candidate({ findings: [finding("FD-X001", "(candidate)", 0, "no registry edit", "warning")] });
    return html(
      <GatePane
        candidate={cand}
        summary={gateSummary(cand)}
        filter="all"
        focusedRule={null}
        onFilter={noop}
        onFocusRule={noop}
        onReveal={noop}
      />,
    );
  };

  it("colours no number by meaning — Atlas's `.metric > strong` inherits the ink on every tile", () => {
    expect(rule(".fd-wb .fd-stat__n")).toMatch(/color:\s*var\(--ink\)/);
    for (const tone of ["error", "warn", "ok"]) {
      const stray = new RegExp(`\\.fd-stat--${tone}\\s+\\.fd-stat__n\\s*\\{[^}]*color`).test(WORKBENCH_CSS);
      expect(stray, `.fd-stat--${tone} still recolours the number`).toBe(false);
    }
  });

  it("keeps Atlas's number metrics: 35px / 500 / -1px, line-height 1.3, margin 10px 0 6px", () => {
    const body = rule(".fd-wb .fd-stat__n");
    expect(body).toMatch(/font-size:\s*35px/);
    expect(body).toMatch(/font-weight:\s*500/);
    expect(body).toMatch(/letter-spacing:\s*-1px/);
    expect(body).toMatch(/line-height:\s*1\.3/);
    expect(body).toMatch(/margin:\s*10px 0 6px/);
  });

  it("puts a 15px icon in the tile's corner, as `.metric-label svg` does", () => {
    const label = rule(".fd-stat__k");
    expect(label).toMatch(/display:\s*flex/);
    expect(label).toMatch(/justify-content:\s*space-between/);
    expect(label).toMatch(/gap:\s*6px/);
    const tiles = gate().match(/<div class="fd-stat[\s\S]*?<\/div><\/div>/g) ?? [];
    expect(tiles.length).toBe(4);
    for (const tile of tiles) expect(svgs(tile)[0]).toContain('width="15"');
  });

  it("puts a caption line under every number, as `.metric > span` does — 12px, muted", () => {
    const body = rule(".fd-stat__cap");
    expect(body).toMatch(/font-size:\s*12px/);
    expect(body).toMatch(/color:\s*var\(--muted\)/);
    const out = gate();
    expect((out.match(/class="fd-stat__cap"/g) ?? []).length).toBe(4);
  });

  it("still reads the tile top-to-bottom as label, number, caption", () => {
    const first = /<div class="fd-stat[\s\S]*?<\/div><\/div>/.exec(gate())?.[0] ?? "";
    expect(first.indexOf("fd-stat__k")).toBeLessThan(first.indexOf("fd-stat__n"));
    expect(first.indexOf("fd-stat__n")).toBeLessThan(first.indexOf("fd-stat__cap"));
    expect(rule(".fd-stat")).not.toMatch(/column-reverse/);
  });
});

// ── 6. THE SEGMENTED CONTROLS ───────────────────────────────────────
// Measured, because the reviewer's account of this one did not survive
// contact with Atlas: BOTH of Atlas's segmented controls are built the
// way Studio already built them (`.view-tabs` tints the selected option
// on a white track; `.filter-tabs` raises a white option on a tinted
// track). What was actually wrong was the selected option's radius and
// its shadow — the `0 2px 6px #b9731420` the reviewer quoted belongs to
// `.view-tab-indicator`, not to a `rgb(229,238,243)` fill that exists
// nowhere in Atlas.

describe("6. the selected option, measured against Atlas", () => {
  it("raises the selected view tab on Atlas's 8px radius, not 9px", () => {
    expect(rule(".fd-tabs .fd-tab")).toMatch(/border-radius:\s*8px/);
  });

  it("gives it `.view-tab-indicator`'s shadow — 0 2px 6px #b9731420 in light", () => {
    expect(rule('.fd-tabs .fd-tab[aria-selected="true"]')).toMatch(/box-shadow:\s*var\(--shadow-tab\)/);
    expect(TOKENS.light.shadowTab).toBe("0 2px 6px #b9731420");
    expect(TOKENS.dark.shadowTab).toBe("0 2px 8px #0004");
  });

  it("keeps the tinted track and the white chosen option `.filter-tabs` actually has", () => {
    expect(rule(".fd-filter")).toMatch(/background:\s*var\(--bg2\)/);
    expect(rule(".fd-filter")).toMatch(/border-radius:\s*var\(--r-md\)/);
    expect(rule(".fd-filter")).toMatch(/gap:\s*3px/);
    expect(rule(".fd-filter")).toMatch(/padding:\s*3px/);
    expect(rule('.fd-filter button[aria-pressed="true"]')).toMatch(/background:\s*var\(--seg-active\)/);
    expect(TOKENS.light.segActive).toBe("#ffffff");
  });

  it("puts the chosen option on Atlas's 4px radius and 0 1px 4px #17384c16", () => {
    for (const selector of ['.fd-filter button[aria-pressed="true"]', '.fd-modes button[aria-pressed="true"]']) {
      expect(rule(selector), selector).toMatch(/border-radius:\s*4px/);
      expect(rule(selector), selector).toMatch(/box-shadow:\s*var\(--shadow-seg\)/);
    }
    expect(TOKENS.light.shadowSeg).toBe("0 1px 4px #17384c16");
    // Atlas's own dark value for the same control (`globals.css:461-465`).
    expect(TOKENS.dark.shadowSeg).toBe("0 2px 4px #0003");
  });

  it("matches Atlas's 9px icon-to-label gap on a view tab", () => {
    expect(rule(".fd-tabs .fd-tab")).toMatch(/gap:\s*9px/);
  });
});

// ── THE WHOLE WORKBENCH ─────────────────────────────────────────────

describe("the reskin, end to end", () => {
  it("renders every view with icons, and never throws doing it", () => {
    for (const view of ["run", "files", "diff", "preview", "gate"] as const) {
      const out = workbench(view);
      expect(svgs(out).length, `${view} is still nearly icon-free`).toBeGreaterThan(8);
    }
  });

  it("makes the round metadata the one thing that gives way in the topbar", () => {
    // Icons cost the topbar 81px, and at 1440 the main pane is 1008: the
    // theme toggle ended 6px past the right edge until this rule. Measured
    // again after: the toggle ends at 1412, exactly the 28px padding, and
    // `.fd-tabs` scrollWidth equals its clientWidth.
    const id = rule(".fd-tabs > .fd-tabs__id");
    expect(id).toMatch(/flex:\s*0 1 auto/);
    expect(id).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(".fd-tabs > .fd-tabs__group, .fd-tabs > .fd-save, .fd-tabs > .fd-lockbtn,\n.fd-tabs > .fd-tabs__edits, .fd-tabs > .fd-themetoggle")).toMatch(/flex:\s*0 0 auto/);
    // Truncated on screen, whole on hover.
    expect(workbench("gate")).toMatch(/class="fd-tabs__id" title="round #1 · wc-clock · SUBAPP_WC_CLOCK_ENABLED"/);
  });

  it("still renders the diff pane's change markers as icons, not `+` and `~` text", () => {
    const set = diffFileSets(wcClockFiles().slice(0, 2), wcClockFiles());
    const out = html(<DiffPane set={set} selectedPath={null} onSelect={noop} />);
    const rows = out.match(/<button[^>]*class="fd-tree__row"[\s\S]*?<\/button>/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(svgs(row).length).toBeGreaterThan(0);
  });

  it("leaves the tree, the gate and the preview agreeing about one candidate", () => {
    const cand = candidate({ findings: [finding("FD-G001", "server/subapps/wc-clock/routes/clocks.ts", 4, "no guard")] });
    const set = diffFileSets([], cand.files);
    const out = html(
      <FileTreePane
        nodes={buildTree(cand.files, new Set())}
        selectedPath={cand.files[0]!.path}
        changes={changeByPath(set)}
        findings={findingsByPath(cand)}
        collapsedDirs={new Set()}
        focusedRule={null}
        file={cand.files[0]!}
        onSelect={noop}
        onToggle={noop}
      />,
    );
    expect(out).toContain("manifest.ts");
    expect(svgs(out).length).toBeGreaterThan(5);
  });
});
