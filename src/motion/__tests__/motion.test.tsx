/** Studio's copy of the motion layer (src/motion/), owner decision
 * 2026-09-22: Anime.js, Atlas motion everywhere, reduced motion always
 * honoured.
 *
 * THE BEHAVIOUR THIS FILE EXISTS FOR: animation is decoration. With motion
 * off (a test, reduced motion, webdriver, the kill switch, a hidden tab)
 * every helper leaves the FINAL state and writes nothing, so no other test
 * in this package can see an in-between frame. With motion on, whatever a
 * helper writes is taken back: when it completes and when it is cancelled.
 *
 * ── WHY A FAKE ELEMENT AND NOT A DOM ────────────────────────────────
 * Studio has no jsdom or happy-dom, on purpose (components.test.tsx says
 * why), and these helpers need very little of a DOM: an element's inline
 * style, whether it is connected, and a few offsets. `FakeElement` below is
 * exactly that. Anime's real engine runs underneath: outside a browser it
 * ticks on `setImmediate`, so completion and cancellation are the real code
 * paths, not mocks. Motion is switched on by stubbing a `window` that looks
 * like Chrome with no reduced-motion preference.
 *
 * NOT covered here, and why: timing, easing and the stagger's spacing (no
 * frame here is painted), and the hooks' effects themselves (no renderer
 * runs effects without a DOM). The hooks' decisions are pure functions and
 * are tested as such; the curves, the hand-back and interruption were
 * checked on frames recorded in real Chrome against Atlas
 * (.shots/studio-motion/). */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatePane } from "../../workbench/components/GatePane";
import { gateSummary } from "../../workbench/selectors";
import { createStore } from "../../workbench/store";
import type { Candidate } from "../../workbench/types";
import { Workbench } from "../../workbench/Workbench";
import { MOTION, arrive, closePanel, motionAllowed, motionSupported, reenter, slideIndicator, swapIn } from "../motion";
import { tabGhost } from "../TabIndicator";
import { insertedByDelay, panelPlay } from "../useMotion";

// ---------------------------------------------------------------------------
// A fake element: inline style, connection, offsets. Nothing else.

class FakeStyle {
  readonly #props = new Map<string, { value: string; priority: string }>();
  /** A real element keeps an empty `style=""` once its style was written. */
  touched = false;
  setProperty(name: string, value: string | null, priority = ""): void {
    this.touched = true;
    if (value === null || value === "") this.#props.delete(name);
    else this.#props.set(name, { value: String(value), priority });
  }
  getPropertyValue(name: string): string {
    return this.#props.get(name)?.value ?? "";
  }
  getPropertyPriority(name: string): string {
    return this.#props.get(name)?.priority ?? "";
  }
  removeProperty(name: string): string {
    const value = this.getPropertyValue(name);
    this.touched = true;
    this.#props.delete(name);
    return value;
  }
  get width(): string {
    return this.getPropertyValue("width");
  }
  set width(value: string) {
    this.setProperty("width", value);
  }
  get cssText(): string {
    return [...this.#props].map(([k, { value, priority }]) => `${k}: ${value}${priority ? " !important" : ""};`).join(" ");
  }
}

class FakeElement {
  style = new FakeStyle();
  isConnected = true;
  hidden = false;
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  /** What the stylesheet would compute, for getComputedStyle. */
  readonly sheet: Record<string, string>;
  constructor(sheet: Record<string, string> = {}) {
    this.sheet = sheet;
  }
  getAttribute(name: string): string | null {
    return name === "style" && this.style.touched ? this.style.cssText : null;
  }
  removeAttribute(name: string): void {
    if (name === "style") this.style = new FakeStyle();
  }
  append(...kids: FakeElement[]): this {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
}

/** Inline wins, as it does for these properties, else the stylesheet's value. */
function fakeComputedStyle(el: FakeElement) {
  const get = (p: string) => el.style.getPropertyValue(p) || el.sheet[p] || "";
  return { getPropertyValue: get, position: get("position") || "static", backgroundColor: get("background-color"), transform: "none" };
}

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

interface BrowserOpts {
  reduce?: boolean;
  webdriver?: boolean;
  userAgent?: string;
  matchMedia?: boolean | "throws";
  hidden?: boolean;
  killSwitch?: boolean;
}

/** Make this node process look like real Chrome, so motion may run. anime
 * was imported before this ran, so it still ticks on setImmediate. */
function asBrowser(opts: BrowserOpts = {}): void {
  const matchMedia =
    opts.matchMedia === false
      ? undefined
      : opts.matchMedia === "throws"
        ? () => {
            throw new Error("no media queries here");
          }
        : (query: string) => ({ matches: opts.reduce === true && query.includes("prefers-reduced-motion: reduce") });
  vi.stubGlobal("window", {
    navigator: { userAgent: opts.userAgent ?? CHROME_UA, webdriver: opts.webdriver ?? false },
    ...(matchMedia ? { matchMedia } : {}),
    ...(opts.killSwitch ? { __FD_MOTION_OFF: true } : {}),
  });
  vi.stubGlobal("document", { visibilityState: opts.hidden ? "hidden" : "visible" });
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("SVGElement", class FakeSvg {});
  vi.stubGlobal("getComputedStyle", fakeComputedStyle);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 16));
}

/** The fake as the helpers' parameter type: they only touch what it has. */
const asEl = (el: FakeElement) => el as unknown as HTMLElement;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe("motionSupported / motionAllowed: every HARD-RULE switch", () => {
  it("is off in plain node, which is how every other test here runs", () => {
    expect(typeof window).toBe("undefined");
    expect(motionSupported()).toBe(false);
    expect(motionAllowed()).toBe(false);
  });

  it("is on only when the page looks like a real browser with no switch thrown", () => {
    asBrowser();
    expect(motionSupported()).toBe(true);
    expect(motionAllowed()).toBe(true);
  });

  it.each<[string, BrowserOpts, boolean]>([
    ["prefers-reduced-motion: reduce", { reduce: true }, true],
    ["navigator.webdriver (Playwright, Selenium)", { webdriver: true }, false],
    ["a jsdom user agent", { userAgent: "Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/25.0.1" }, false],
    ["no matchMedia", { matchMedia: false }, false],
    ["window.__FD_MOTION_OFF", { killSwitch: true }, true],
    ["a hidden tab (anime would pause, stuck on the start frame)", { hidden: true }, true],
    ["a matchMedia that throws", { matchMedia: "throws" }, true],
  ])("%s turns it off", (_label, opts, stillSupported) => {
    asBrowser(opts);
    expect(motionAllowed()).toBe(false);
    // Supported = can EVER run in this page; the rest can change while it is open.
    expect(motionSupported()).toBe(stillSupported);
  });
});

describe.each<[string, () => void]>([
  ["plain node", () => {}],
  ["reduced motion", () => asBrowser({ reduce: true })],
  ["the kill switch", () => asBrowser({ killSwitch: true })],
  ["webdriver", () => asBrowser({ webdriver: true })],
  ["a hidden tab", () => asBrowser({ hidden: true })],
])("motion off (%s): the final state, nothing written", (_label, setup) => {
  beforeEach(() => {
    // The fake elements need the globals the helpers test against, even in "plain node".
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("SVGElement", class FakeSvg {});
    setup();
  });

  it("arrive, swapIn and reenter write no inline style and are already settled", async () => {
    for (const play of [arrive, swapIn, reenter]) {
      const el = new FakeElement();
      const handle = play(asEl(el));
      expect(el.getAttribute("style")).toBeNull();
      handle.cancel(); // idempotent, and still writes nothing
      expect(el.getAttribute("style")).toBeNull();
      await expect(handle.finished).resolves.toBeUndefined();
    }
  });

  it("closePanel calls onDone synchronously, so a close is still instant", () => {
    const el = new FakeElement();
    const onDone = vi.fn();
    closePanel(asEl(el), { side: "center", onDone });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(el.getAttribute("style")).toBeNull();
  });

  it("the tab indicator never shows and no tab is touched", () => {
    const { host, indicator, tabs } = tabStrip();
    tabGhost(asEl(indicator)).move(asEl(tabs[0]!), asEl(tabs[2]!));
    expect(indicator.hidden).toBe(true);
    expect(indicator.getAttribute("style")).toBeNull();
    expect(host.getAttribute("style")).toBeNull();
    for (const tab of tabs) expect(tab.getAttribute("style")).toBeNull();
  });
});

describe("motion on: the start frame at once, everything taken back", () => {
  beforeEach(() => asBrowser());

  it("arrive paints atlas-arrive's start frame synchronously, before any tick", () => {
    const el = new FakeElement();
    const handle = arrive(asEl(el));
    expect(el.style.getPropertyValue("opacity")).toBe("0");
    expect(el.style.getPropertyValue("translate")).toBe(`0px ${MOTION.distance.arrive}px`);
    handle.cancel();
  });

  it("swapIn is studio-enter (6px from 0) and reenter is work-surface-enter (5px from 0.5)", () => {
    const a = new FakeElement();
    const b = new FakeElement();
    const swap = swapIn(asEl(a));
    const back = reenter(asEl(b));
    expect([a.style.getPropertyValue("opacity"), a.style.getPropertyValue("translate")]).toEqual(["0", "0px 6px"]);
    expect([b.style.getPropertyValue("opacity"), b.style.getPropertyValue("translate")]).toEqual(["0.5", "0px 5px"]);
    swap.cancel();
    back.cancel();
  });

  it("hands the element back with no inline residue when it completes", async () => {
    const el = new FakeElement();
    await arrive(asEl(el), { duration: 20 }).finished;
    expect(el.getAttribute("style")).toBeNull();
  });

  it("puts the element's own inline values back, exactly, on completion and on cancel", async () => {
    const own = () => {
      const el = new FakeElement();
      el.style.setProperty("opacity", "0.8");
      el.style.setProperty("color", "red");
      return el;
    };
    const done = own();
    await arrive(asEl(done), { duration: 20 }).finished;
    expect(done.getAttribute("style")).toBe("opacity: 0.8; color: red;");

    const cancelled = own();
    const handle = swapIn(asEl(cancelled));
    await sleep(30); // mid-flight
    expect(cancelled.style.getPropertyValue("opacity")).not.toBe("0.8");
    handle.cancel();
    expect(cancelled.getAttribute("style")).toBe("opacity: 0.8; color: red;");
    await expect(handle.finished).resolves.toBeUndefined();
  });

  it("a second motion on the same element cancels the first before it records anything", async () => {
    const el = new FakeElement();
    arrive(asEl(el), { duration: 400 });
    await sleep(40); // the first is half-way: its inline values are NOT the element's own
    await reenter(asEl(el)).finished;
    // Had the second saved the first's half-way values as "original", the
    // element would be left half-faded here.
    expect(el.getAttribute("style")).toBeNull();
  });

  it("a staggered list is at its start frame at once, every item, and all of it is handed back", async () => {
    const items = Array.from({ length: 5 }, () => new FakeElement());
    const handle = arrive(items.map(asEl), { duration: 20 });
    for (const item of items) expect(item.style.getPropertyValue("opacity")).toBe("0");
    await handle.finished;
    for (const item of items) expect(item.getAttribute("style")).toBeNull();
  });

  it("leaves an element that is no longer in the document alone", () => {
    const el = new FakeElement();
    el.isConnected = false;
    arrive(asEl(el));
    expect(el.getAttribute("style")).toBeNull();
  });

  it("slideIndicator places at once the first time, slides after, and cancel jumps to the target", () => {
    const indicator = new FakeElement();
    const a = Object.assign(new FakeElement(), { offsetLeft: 4, offsetWidth: 100 });
    const b = Object.assign(new FakeElement(), { offsetLeft: 206, offsetWidth: 100 });
    slideIndicator(asEl(indicator), asEl(a));
    expect(indicator.style.getPropertyValue("translate")).toBe("4px 0px");
    const slide = slideIndicator(asEl(indicator), asEl(b));
    expect(indicator.style.getPropertyValue("translate")).toBe("4px 0px"); // the start frame
    slide.cancel();
    expect(indicator.style.getPropertyValue("translate")).toBe("206px 0px");
    expect(indicator.style.width).toBe("100px");
  });
});

/** A segmented control as TabIndicator finds it: the indicator first, then
 * three 100px tabs, the last one active with the theme's tint. */
function tabStrip() {
  const host = new FakeElement({ position: "static" });
  const indicator = new FakeElement();
  indicator.hidden = true;
  const tabs = [4, 106, 208].map((left, i) =>
    Object.assign(new FakeElement(i === 2 ? { "background-color": "rgb(255, 240, 217)" } : { "background-color": "rgba(0, 0, 0, 0)" }), {
      offsetLeft: left,
      offsetTop: 4,
      offsetWidth: 100,
      offsetHeight: 36,
    }),
  );
  host.append(indicator, ...tabs);
  return { host, indicator, tabs };
}

describe("TabIndicator (tabGhost), motion on", () => {
  beforeEach(() => asBrowser());

  it("while it slides it stands in for the tabs' fill; stop() takes every write back", () => {
    const { host, indicator, tabs } = tabStrip();
    tabs[0]!.style.setProperty("color", "blue"); // a tab's own inline style must survive
    const ghost = tabGhost(asEl(indicator));
    ghost.move(asEl(tabs[0]!), asEl(tabs[2]!));

    expect(indicator.hidden).toBe(false);
    expect(indicator.style.getPropertyValue("background-color")).toBe("rgb(255, 240, 217)");
    expect(indicator.style.getPropertyValue("translate")).toBe("4px 0px"); // starts on the old tab
    expect(tabs[2]!.style.getPropertyValue("background-color")).toBe("transparent");
    expect(tabs[2]!.style.getPropertyPriority("background-color")).toBe("important");
    expect(host.style.getPropertyValue("isolation")).toBe("isolate");
    expect(host.style.getPropertyValue("position")).toBe("relative");

    ghost.stop();
    expect(indicator.hidden).toBe(true);
    expect(indicator.getAttribute("style")).toBeNull();
    expect(host.getAttribute("style")).toBeNull();
    expect(tabs[0]!.getAttribute("style")).toBe("color: blue;");
    expect(tabs[1]!.getAttribute("style")).toBeNull();
    expect(tabs[2]!.getAttribute("style")).toBeNull();
    ghost.stop(); // idempotent
  });

  it("hands everything back by itself when the slide ends", async () => {
    const { host, indicator, tabs } = tabStrip();
    tabGhost(asEl(indicator)).move(asEl(tabs[0]!), asEl(tabs[2]!));
    await sleep(MOTION.duration.indicator + 150);
    expect(indicator.hidden).toBe(true);
    expect(indicator.getAttribute("style")).toBeNull();
    expect(host.getAttribute("style")).toBeNull();
    for (const tab of tabs) expect(tab.getAttribute("style")).toBeNull();
  });
});

describe("Studio's hooks: what they decide to play", () => {
  it("usePanelSwap: swapIn on mount and on a new view, even when the round changed with it", () => {
    expect(panelPlay(null, "files", null)).toBe(swapIn);
    expect(panelPlay({ view: "run", context: null, play: swapIn }, "files", "r1")).toBe(swapIn);
  });

  it("usePanelSwap: reenter when only the round changed (another context, same view)", () => {
    expect(panelPlay({ view: "files", context: "r2", play: swapIn }, "files", "r1")).toBe(reenter);
  });

  it("usePanelSwap: StrictMode's re-run (nothing changed) replays what its cleanup cancelled", () => {
    expect(panelPlay({ view: "files", context: "r1", play: swapIn }, "files", "r1")).toBe(swapIn);
    expect(panelPlay({ view: "files", context: "r1", play: reenter }, "files", "r1")).toBe(reenter);
    expect(panelPlay({ view: "files", context: "r1", play: null }, "files", "r1")).toBeNull();
  });

  it("useArriveInserted: only new items arrive, each waiting for its place among ALL items", () => {
    // Atlas's nth-child delays: 0, 45, 90, then 135ms for the 4th onwards.
    const plan = insertedByDelay(new Set(["kept"]), ["kept", "b", "c", "d", "e", "f"]);
    expect([...plan]).toEqual([
      [45, ["b"]],
      [90, ["c"]],
      [135, ["d", "e", "f"]],
    ]);
    expect(insertedByDelay(new Set(["a", "b"]), ["b", "a"]).size).toBe(0); // reordered, nothing new
    expect([...insertedByDelay(new Set<string>(), ["x"])]).toEqual([[0, ["x"]]]);
  });
});

describe("markup: the final state, never a start frame", () => {
  const MOTION_STYLE = /style="[^"]*(opacity|translate|scale|rotate)/;

  it("the workbench renders the indicator hidden, first in the tablist, and no motion style anywhere", () => {
    const out = renderToStaticMarkup(<Workbench store={createStore()} onPrompt={() => {}} />);
    const start = out.indexOf('role="tablist"');
    expect(out.slice(start, out.indexOf('role="tab"', start))).toContain(
      '<span class="motion-tab-indicator" aria-hidden="true" hidden="">',
    );
    expect(out).not.toMatch(MOTION_STYLE);
  });

  it("the gate pane's finding cards render at rest", () => {
    const candidate = {
      manifest: { id: "x", label: "X", version: "0.1.0", summary: "", icon: "", navSection: "", routePrefix: "/x", webModuleId: "x", capabilities: [], visibleToRoles: [], envVar: "X", tablePrefix: "x_" },
      files: [],
      findings: [
        { rule: "FD-W001", severity: "warning", message: "w", file: "a.ts", line: 1, column: 1, evidence: null },
        { rule: "FD-E001", severity: "error", message: "e", file: "b.ts", line: 2, column: 1, evidence: null },
      ],
      rulesRun: ["FD-W001", "FD-E001"],
      notes: [],
    } as unknown as Candidate;
    const out = renderToStaticMarkup(
      <GatePane candidate={candidate} summary={gateSummary(candidate)} filter="all" focusedRule={null} onFilter={() => {}} onFocusRule={() => {}} onReveal={() => {}} />,
    );
    expect(out.match(/class="fd-finding /g)).toHaveLength(2);
    expect(out).not.toMatch(MOTION_STYLE);
  });
});
