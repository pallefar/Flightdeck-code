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
 * frame here is painted). The hooks' decisions are pure functions and are
 * tested as such. Both hooks are also run for real, mounted by
 * react-dom/client on a small fake document: useArriveInserted inside
 * GatePane, because which cards count as inserted depends on React keeping
 * their elements, and only a real reconciler shows that; and usePanelSwap
 * under StrictMode, because which play a commit gets depends on React's
 * effect order, dev re-run included. The curves, the hand-back and
 * interruption were checked on frames recorded in real Chrome against Atlas
 * (.shots/studio-motion/). */
import { StrictMode, act, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidate, finding } from "../../workbench/__tests__/fixtures";
import { GatePane, shownFindings } from "../../workbench/components/GatePane";
import { gateSummary } from "../../workbench/selectors";
import { createStore } from "../../workbench/store";
import type { Candidate, Severity } from "../../workbench/types";
import { Workbench } from "../../workbench/Workbench";
import { MOTION, arrive, closePanel, motionAllowed, motionSupported, reenter, slideIndicator, swapIn } from "../motion";
import { tabGhost } from "../TabIndicator";
import { insertedByDelay, panelPlay, playPanel, usePanelSwap } from "../useMotion";

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

  it("playPanel writes nothing on the host or its panel, for either play", async () => {
    for (const play of ["nested", "swap"] as const) {
      const panel = new FakeElement();
      const host = new FakeElement().append(panel);
      const played = playPanel(asEl(host), play);
      expect([host.getAttribute("style"), panel.getAttribute("style")]).toEqual([null, null]);
      expect(played.surface === null).toBe(play === "swap");
      for (const handle of [played.surface, played.panel]) {
        if (handle === null) continue;
        handle.cancel();
        await expect(handle.finished).resolves.toBeUndefined();
      }
      expect([host.getAttribute("style"), panel.getAttribute("style")]).toEqual([null, null]);
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

  it("playPanel nested: work-surface-enter on the host, studio-enter on the panel, each with its own handle", async () => {
    const frameOf = (el: FakeElement) => [el.style.getPropertyValue("opacity"), el.style.getPropertyValue("translate")];
    const panel = new FakeElement();
    const host = new FakeElement().append(panel);
    const played = playPanel(asEl(host), "nested");
    // Two elements, so the rises add up as Atlas's nested CSS does: the
    // panel paints 5 + 6 = 11px down, at opacity 0.5 x 0.
    expect(frameOf(host)).toEqual(["0.5", "0px 5px"]);
    expect(frameOf(panel)).toEqual(["0", "0px 6px"]);
    await sleep(30); // mid-flight: each handle hands back only its own element
    played.panel.cancel();
    expect(panel.getAttribute("style")).toBeNull();
    expect(host.getAttribute("style")).not.toBeNull();
    played.surface!.cancel();
    expect(host.getAttribute("style")).toBeNull();

    const done = new FakeElement();
    const doneHost = new FakeElement().append(done);
    const both = playPanel(asEl(doneHost), "nested");
    await Promise.all([both.surface!.finished, both.panel.finished]);
    expect([doneHost.getAttribute("style"), done.getAttribute("style")]).toEqual([null, null]);
  });

  it("playPanel swap: studio-enter on the panel, the host never touched", () => {
    const panel = new FakeElement();
    const host = new FakeElement().append(panel);
    const played = playPanel(asEl(host), "swap");
    expect(played.surface).toBeNull();
    expect(host.getAttribute("style")).toBeNull();
    expect([panel.style.getPropertyValue("opacity"), panel.style.getPropertyValue("translate")]).toEqual(["0", "0px 6px"]);
    played.panel.cancel();
    expect(panel.getAttribute("style")).toBeNull();
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
  it("usePanelSwap: the nested pair on mount and whenever the round changed, with or without a new view", () => {
    // Atlas re-keys .management-surface on those, and .studio-panel inside it.
    expect(panelPlay(null, "files", null)).toBe("nested");
    expect(panelPlay({ view: "files", context: "r2", play: "swap" }, "files", "r1")).toBe("nested");
    expect(panelPlay({ view: "run", context: null, play: "nested" }, "files", "r1")).toBe("nested");
  });

  it("usePanelSwap: the swap alone for a new view in the same round (Atlas re-keys only the panel)", () => {
    expect(panelPlay({ view: "run", context: "r1", play: "nested" }, "files", "r1")).toBe("swap");
  });

  it("usePanelSwap: StrictMode's re-run (nothing changed) replays what its cleanup cancelled", () => {
    expect(panelPlay({ view: "files", context: "r1", play: "swap" }, "files", "r1")).toBe("swap");
    expect(panelPlay({ view: "files", context: "r1", play: "nested" }, "files", "r1")).toBe("nested");
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

// ---------------------------------------------------------------------------
// Just enough DOM for react-dom/client to mount ONE pane, effects and all.
//
// useArriveInserted decides what arrives by element identity: a card is
// "inserted" when its element was not there in the last commit. Which
// elements survive a filter change is React's decision, made from the
// cards' keys, so this is the one place the pure-function tests above
// cannot reach: a card keyed by its list position is remounted when a filter
// moves it, and then arrives although it never left. These classes are what
// react-dom touches to mount and update GatePane, and no more.

class DomStyle extends FakeStyle {
  readonly #onWrite: () => void;
  constructor(onWrite: () => void) {
    super();
    this.#onWrite = onWrite;
  }
  override setProperty(name: string, value: string | null, priority = ""): void {
    this.#onWrite();
    super.setProperty(name, value, priority);
  }
  override removeProperty(name: string): string {
    this.#onWrite();
    return super.removeProperty(name);
  }
}

class DomNode {
  parentNode: DomNode | null = null;
  childNodes: DomNode[] = [];
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: DomDocument | null,
  ) {}
  get firstChild(): DomNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): DomNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): DomNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get parentElement(): DomNode | null {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }
  get isConnected(): boolean {
    let node: DomNode = this;
    while (node.parentNode) node = node.parentNode;
    return node.nodeType === 9;
  }
  appendChild(child: DomNode): DomNode {
    return this.insertBefore(child, null);
  }
  insertBefore(child: DomNode, ref: DomNode | null): DomNode {
    child.parentNode?.removeChild(child);
    const at = ref === null ? this.childNodes.length : this.childNodes.indexOf(ref);
    this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: DomNode): DomNode {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  set textContent(text: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (text && this.ownerDocument) this.appendChild(this.ownerDocument.createTextNode(text));
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

class DomText extends DomNode {
  constructor(
    public nodeValue: string,
    doc: DomDocument,
  ) {
    super(3, "#text", doc);
  }
  override get textContent(): string {
    return this.nodeValue;
  }
  override set textContent(text: string) {
    this.nodeValue = text;
  }
}

class DomElement extends DomNode {
  /** Every write to this element's inline style, including ones later taken back. */
  styleWrites = 0;
  style: FakeStyle = new DomStyle(() => this.styleWrites++);
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly sheet: Record<string, string> = {};
  readonly #attrs = new Map<string, string>();
  constructor(tag: string, doc: DomDocument) {
    super(1, tag.toUpperCase(), doc);
  }
  get tagName(): string {
    return this.nodeName;
  }
  get children(): DomElement[] {
    return this.childNodes.filter((c): c is DomElement => c instanceof DomElement);
  }
  setAttribute(name: string, value: string): void {
    this.#attrs.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    if (name === "style") return this.style.touched ? this.style.cssText : null;
    return this.#attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }
  removeAttribute(name: string): void {
    if (name === "style") this.style = new DomStyle(() => this.styleWrites++);
    this.#attrs.delete(name);
  }
  /** `.class` selectors only, which is all the hooks use. */
  querySelectorAll(selector: string): DomElement[] {
    const cls = selector.replace(/^\./, "");
    const found: DomElement[] = [];
    const walk = (el: DomElement) => {
      for (const kid of el.children) {
        if ((kid.getAttribute("class") ?? "").split(/\s+/).includes(cls)) found.push(kid);
        walk(kid);
      }
    };
    walk(this);
    return found;
  }
}

class DomDocument extends DomNode {
  readonly body: DomElement;
  readonly activeElement = null;
  readonly visibilityState = "visible";
  defaultView: unknown = null;
  constructor() {
    super(9, "#document", null);
    this.body = this.createElement("body");
    this.appendChild(this.body);
  }
  createElement(tag: string): DomElement {
    return new DomElement(tag, this);
  }
  /** react-dom calls this the moment a component renders an `<svg>`, and
   * since the Atlas icon pass every pane does (components/LineIcon.tsx).
   * Nothing here measures or paints, so an SVG element is the same
   * DomElement an HTML one is — the namespace buys these tests nothing. */
  createElementNS(_ns: string, tag: string): DomElement {
    return new DomElement(tag, this);
  }
  createTextNode(text: string): DomText {
    return new DomText(text, this);
  }
}

/** Holds the thread for `ms` in its layout effect, which runs after the
 * layout effects of the siblings before it. It stands in for a loaded
 * machine: anime's engine and an awaited act() both tick on setImmediate,
 * and anime's tick is queued first, so this much time passes before the
 * first one. */
function CommitWork({ ms }: { ms: number }) {
  useLayoutEffect(() => {
    const until = performance.now() + ms;
    while (performance.now() < until) {
      // busy: the point is the elapsed time
    }
  });
  return null;
}

/** asBrowser(), plus a document react-dom can mount into. */
function asBrowserWithDom(): DomElement {
  asBrowser();
  const doc = new DomDocument();
  const win = { ...(globalThis.window as object), document: doc, HTMLIFrameElement: class FakeIframe {} };
  doc.defaultView = win;
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("Element", DomElement);
  vi.stubGlobal("HTMLElement", DomElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  return container;
}

describe("GatePane's filter, mounted by react-dom with motion on", () => {
  // Three blocking findings and three warnings, as the review recorded them:
  // in "All" the warnings sit at places 3-5, under "Warnings" at 0-2.
  const sixFindings = candidate({
    findings: [
      finding("FD-X001", "(candidate)", 0, "no registry edit", "warning"),
      finding("FD-E901", "server/e1.ts", 1, "blocking 1"),
      finding("FD-W901", "server/w1.ts", 1, "warning 1", "warning"),
      finding("FD-E902", "server/e2.ts", 2, "blocking 2"),
      finding("FD-W902", "server/w2.ts", 2, "warning 2", "warning"),
      finding("FD-E903", "server/e3.ts", 3, "blocking 3"),
    ],
  });

  it("All -> Warnings -> All: a card that stays is the same element and is never written to; only inserted cards arrive", async () => {
    const container = asBrowserWithDom();
    const root = createRoot(container as unknown as HTMLElement);
    const show = (filter: Severity | "all") =>
      act(() =>
        root.render(
          <>
            <GatePane
              candidate={sixFindings}
              summary={gateSummary(sixFindings)}
              filter={filter}
              focusedRule={null}
              onFilter={() => {}}
              onFocusRule={() => {}}
              onReveal={() => {}}
            />
            <CommitWork ms={20} />
          </>,
        ),
      );
    const cards = () => container.querySelectorAll(".fd-finding");
    const rule = (el: DomElement) => el.children[0]!.textContent;

    await show("all");
    const all = cards();
    expect(all.map(rule)).toEqual(["FD-E901", "FD-E902", "FD-E903", "FD-X001", "FD-W901", "FD-W902"]);
    expect(all.map((el) => el.styleWrites)).toEqual([0, 0, 0, 0, 0, 0]); // the panel's entrance plays on mount, not this

    await show("warning");
    const warnings = cards();
    expect(warnings.map(rule)).toEqual(["FD-X001", "FD-W901", "FD-W902"]);
    // Kept, not remounted, and left alone. (Booleans and counts, because
    // vitest cannot print these fake elements.)
    expect(warnings.map((el) => all.includes(el))).toEqual([true, true, true]);
    expect(warnings.map((el) => el.styleWrites)).toEqual([0, 0, 0]);

    // Read before awaiting. A synchronous act() has rendered and run every
    // layout effect by the time it returns, so arrive() has painted its
    // start frame and anime has not ticked. Awaited first, the reads would
    // come after anime's first tick, which moves the delay-0 card off its
    // start frame by however long the commit took.
    const returned = show("all");
    const again = cards();
    expect(again.map(rule)).toEqual(["FD-E901", "FD-E902", "FD-E903", "FD-X001", "FD-W901", "FD-W902"]);
    const [inserted, kept] = [again.slice(0, 3), again.slice(3)];
    expect(kept.map((el, i) => el === warnings[i])).toEqual([true, true, true]); // the same elements, in place
    expect(kept.map((el) => el.styleWrites)).toEqual([0, 0, 0]);
    // The blocking cards came back: new elements, at atlas-arrive's start
    // frame. This is what makes the "never written to" above mean something.
    expect(inserted.map((el) => all.includes(el))).toEqual([false, false, false]);
    for (const el of inserted) {
      expect([el.style.getPropertyValue("opacity"), el.style.getPropertyValue("translate")]).toEqual(["0", `0px ${MOTION.distance.arrive}px`]);
    }
    await returned;

    // Unmounting mid-arrival hands every card back with no inline residue.
    await act(() => root.unmount());
    expect(again.map((el) => el.getAttribute("style"))).toEqual([null, null, null, null, null, null]);
  });

  it("a filter change mid-arrival: a card that stays keeps arriving, a card it removes is settled", async () => {
    const container = asBrowserWithDom();
    const root = createRoot(container as unknown as HTMLElement);
    const show = (filter: Severity | "all") =>
      act(() =>
        root.render(
          <GatePane
            candidate={sixFindings}
            summary={gateSummary(sixFindings)}
            filter={filter}
            focusedRule={null}
            onFilter={() => {}}
            onFocusRule={() => {}}
            onReveal={() => {}}
          />,
        ),
      );
    const cards = () => container.querySelectorAll(".fd-finding");
    const styles = (els: DomElement[]) => els.map((el) => el.getAttribute("style"));

    await show("all");
    await show("warning");
    // From here each change is read synchronously with its act(), for the
    // reason given in the test above: no anime tick comes in between, so no
    // arrival can finish early on a loaded machine and turn "still
    // arriving" into a race.
    void show("all");
    const blocking = cards().slice(0, 3); // arriving: they came back
    expect(styles(blocking).every((s) => s !== null)).toBe(true);

    // Blocking only: the blocking cards stay, so their arrivals run on. Had
    // they been cancelled, each would be handed back (no style) at once,
    // which on screen is a snap from half faded to opaque.
    void show("error");
    expect(cards().map((el, i) => el === blocking[i])).toEqual([true, true, true]);
    expect(styles(blocking).every((s) => s !== null && s.includes("opacity"))).toBe(true);

    // All, then Blocking again at once: the warnings arrive, then are removed
    // mid-arrival, and each one's arrival is settled, not left running.
    void show("all");
    const warnings = cards().slice(3);
    expect(styles(warnings).every((s) => s !== null)).toBe(true);
    void show("error");
    expect(warnings.map((el) => el.isConnected)).toEqual([false, false, false]);
    expect(styles(warnings)).toEqual([null, null, null]);

    // The blocking cards finish by themselves, with no inline residue. Waited
    // for, not slept on: a fixed sleep's timer can fire before the anime tick
    // that completes them when the worker was held up.
    await vi.waitFor(() => expect(styles(blocking)).toEqual([null, null, null]), { timeout: 3000, interval: 25 });
    await act(() => root.unmount());
  });

  it("shownFindings: a finding keeps its key under every filter, exact duplicates included", () => {
    const dup = finding("FD-W901", "server/w1.ts", 1, "warning 1", "warning");
    const findings = [...sixFindings.findings, dup, { ...dup, column: 7 }];
    const keysOf = (filter: Severity | "all") => new Map(shownFindings(findings, filter).map(({ key, finding: f }) => [f, key]));
    const all = keysOf("all");
    expect(new Set(all.values()).size).toBe(findings.length); // unique, so React never sees a clash
    for (const filter of ["error", "warning"] as const) {
      const shown = keysOf(filter);
      expect(shown.size).toBe(findings.filter((f) => f.severity === filter).length);
      for (const [f, key] of shown) expect(key).toBe(all.get(f));
    }
    // The duplicate is told apart by its place among ALL findings, and a
    // different column is a different finding, not a duplicate.
    expect([all.get(sixFindings.findings[2]!), all.get(dup), all.get(findings[7]!)]).toEqual([
      "FD-W901-server/w1.ts-1-1",
      "FD-W901-server/w1.ts-1-1#1",
      "FD-W901-server/w1.ts-1-7",
    ]);
  });
});

describe("usePanelSwap, mounted by react-dom with motion on", () => {
  /** Studio's `.fd-body`: a host that keeps its element, holding the pane
   * for the view. */
  function Panel({ view, round }: { view: string; round: string }) {
    const ref = useRef<HTMLDivElement>(null);
    usePanelSwap(ref, view, round);
    return (
      <div className="fd-body" ref={ref}>
        <div className="pane" key={view}>
          {view}
        </div>
      </div>
    );
  }

  it("plays the nested pair on mount and on another round, the swap alone on another view, and unmount leaves nothing", async () => {
    const container = asBrowserWithDom();
    const root = createRoot(container as unknown as HTMLElement);
    // StrictMode, as main.tsx mounts it: the mount effect runs, is cleaned
    // up and runs again, and the second run must replay the nested pair.
    const show = (view: string, round: string) =>
      act(() =>
        root.render(
          <StrictMode>
            <Panel view={view} round={round} />
          </StrictMode>,
        ),
      );
    const host = () => container.children[0]!;
    const pane = () => host().children[0]!;
    const frameOf = (el: DomElement) => [el.style.getPropertyValue("opacity"), el.style.getPropertyValue("translate")];
    const settled = () => vi.waitFor(() => expect([host().getAttribute("style"), pane().getAttribute("style")]).toEqual([null, null]), { timeout: 3000, interval: 25 });

    // Each change is read synchronously with its act(): every layout effect
    // has run and anime has not ticked (the GatePane test says why).
    let returned = show("files", "r1");
    expect(frameOf(host())).toEqual(["0.5", "0px 5px"]);
    expect(frameOf(pane())).toEqual(["0", "0px 6px"]);
    await returned;
    await settled();

    // Another view, same round: only the new pane moves.
    const writes = host().styleWrites;
    returned = show("diff", "r1");
    expect(host().styleWrites).toBe(writes);
    expect(frameOf(pane())).toEqual(["0", "0px 6px"]);
    await returned;
    await settled();

    // Another round, same view: the pane is the same element, and both play.
    const same = pane();
    returned = show("diff", "r2");
    expect(pane()).toBe(same);
    expect(frameOf(host())).toEqual(["0.5", "0px 5px"]);
    expect(frameOf(pane())).toEqual(["0", "0px 6px"]);
    await returned;

    // Unmounted mid-motion: the cleanups settle both.
    const [h, p] = [host(), pane()];
    await act(() => root.unmount());
    expect([h.getAttribute("style"), p.getAttribute("style")]).toEqual([null, null]);
  });

  it("a view change while the surface is still entering swaps the pane and leaves the surface entering", async () => {
    // Atlas re-keys only .studio-panel on a tab change, so a surface still
    // playing work-surface-enter (after a mount or a project switch) keeps
    // playing it around the new panel. Studio's demo does exactly this on
    // load: it switches to the Run view one frame after the first render.
    const container = asBrowserWithDom();
    const root = createRoot(container as unknown as HTMLElement);
    const show = (view: string, round: string) => act(() => root.render(<Panel view={view} round={round} />));
    const host = () => container.children[0]!;
    const pane = () => host().children[0]!;

    await show("files", "r1");
    const entering = host().getAttribute("style");
    expect(entering).toMatch(/opacity/); // still mid-flight, 220ms long
    const writes = host().styleWrites;
    const returned = show("run", "r1");
    // The commit wrote nothing on the host: not cancelled, not restarted.
    expect(host().styleWrites).toBe(writes);
    expect(host().getAttribute("style")).toBe(entering);
    expect([pane().textContent, pane().style.getPropertyValue("opacity"), pane().style.getPropertyValue("translate")]).toEqual(["run", "0", "0px 6px"]);
    await returned;
    await vi.waitFor(() => expect(host().styleWrites).toBeGreaterThan(writes), { timeout: 1000, interval: 10 }); // still driven
    await vi.waitFor(() => expect([host().getAttribute("style"), pane().getAttribute("style")]).toEqual([null, null]), { timeout: 3000, interval: 25 });
    await act(() => root.unmount());
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
