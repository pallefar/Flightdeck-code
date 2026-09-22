/* STUDIO'S COPY: mirrored byte-for-byte from pallefar/project-contract,
 * flightdeck/web/src/motion/TabIndicator.tsx at commit 54064a53
 * (feat/anime-motion-os). Only this header is Studio's. In Studio it sits in
 * the workbench's view tablist (Workbench.tsx), Atlas's `.view-tabs`. */
/** Atlas's sliding pill-tab indicator (`.view-tab-indicator`, motion.css:
 * 62-77: 450ms on cubic-bezier(.22,1,.36,1)) for the OS's existing segmented
 * controls: the topbar surface switch and every `.tbseg` / `.devswitch`.
 * Render it as the FIRST child of the control:
 *
 *   <span className="surfaceswitch" ...>
 *     <TabIndicator activeKey={active} />
 *     {buttons}
 *   </span>
 *
 * AT REST IT IS NOT THERE. The element is `hidden` and the control's own
 * `.active` styling (theme.css) marks the active tab, with motion on or off,
 * so the stylesheet owns every resting pixel and a theme switch needs nothing
 * from here. Only while a change of tab plays does it show:
 *   1. it copies the new tab's computed fill (background, shadow, border,
 *      radius) and the tabs' own fills are switched off inline;
 *   2. it slides from the old tab to the new one (slideIndicator);
 *   3. at the end the new tab's own fill comes back in the same frame, exactly
 *      where the indicator stopped, and the indicator hides again.
 * Nothing is written with motion off, including in every test.
 *
 * Paint order: while it shows, the control gets `isolation: isolate` (and
 * `position: relative` when it has none), and the indicator `z-index: -1`, so
 * it paints over the control's background and under the buttons. */
import { useLayoutEffect, useRef } from "react";
import { motionAllowed, slideIndicator, type MotionHandle } from "./motion";

/** What marks the active tab, among the control's direct children. The same
 * list useIndicator uses. */
const ACTIVE_TAB = '[aria-selected="true"], [aria-current="page"], [aria-pressed="true"], .active';

/** The fill the indicator copies from the new tab. */
const FILL = [
  "background-color",
  "background-image",
  "box-shadow",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  ...["top", "right", "bottom", "left"].flatMap((side) => [`border-${side}-width`, `border-${side}-style`, `border-${side}-color`]),
];

/** What the tabs get while the indicator stands in for their fill. Borders go
 * transparent rather than away, so no tab changes size. Longhands only: a
 * shorthand's removal is not guaranteed to take its longhands with it. */
const TAB_OFF: ReadonlyArray<readonly [string, string]> = [
  ["background-color", "transparent"],
  ["background-image", "none"],
  ["box-shadow", "none"],
  ...["top", "right", "bottom", "left"].map((side) => [`border-${side}-color`, "transparent"] as const),
];
/** Colour keeps transitioning; the fill must not, or the old tab's fill would
 * fade out beside the leaving indicator and the new one fade in after it. */
const TAB_TRANSITION: readonly [string, string] = ["transition-property", "color"];

type Saved = Array<[HTMLElement, string, string, string]>;

/** Set inline, !important so no stylesheet specificity can beat it, and keep
 * the element's own inline value to put back. */
function setAll(saved: Saved, el: HTMLElement, pairs: ReadonlyArray<readonly [string, string]>): void {
  for (const [prop, value] of pairs) {
    saved.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, "important");
  }
}

function restoreAll(saved: Saved): void {
  for (let i = saved.length - 1; i >= 0; i--) {
    const [el, prop, value, priority] = saved[i]!;
    if (value) el.style.setProperty(prop, value, priority);
    else el.style.removeProperty(prop);
    if (el.getAttribute("style") === "") el.removeAttribute("style");
  }
  saved.length = 0;
}

export interface TabGhost {
  /** The active tab changed from `prev` to `next`: play the slide, or do nothing when motion may not run. */
  move(prev: HTMLElement | null, next: HTMLElement | null): void;
  /** Settle now: everything written is taken back. Idempotent. */
  stop(): void;
}

/** The DOM half of TabIndicator. `indicator` is the hidden element inside the control. */
export function tabGhost(indicator: HTMLElement): TabGhost {
  const tabsSaved: Saved = [];
  const fillsSaved: Saved = [];
  const hostSaved: Saved = [];
  let slide: MotionHandle | null = null;
  let target: HTMLElement | null = null;

  const host = () => indicator.parentElement;
  const tabs = () => Array.from(host()?.children ?? []).filter((c): c is HTMLElement => c instanceof HTMLElement && c !== indicator);

  /** Copy `tab`'s fill onto the indicator. Its own fill must be showing when
   * read, so a tab already switched off is switched back on for the read and
   * off again, all before the next paint. Transitions on the fill are off by
   * now, so the value read is the final one, not a frame of a transition. */
  const copyFill = (tab: HTMLElement) => {
    const off = fillsSaved.filter(([el]) => el === tab);
    for (const [, prop, value, priority] of off) {
      if (value) tab.style.setProperty(prop, value, priority);
      else tab.style.removeProperty(prop);
    }
    const cs = getComputedStyle(tab);
    const fill = FILL.map((p) => [p, cs.getPropertyValue(p)] as const); // every read before any write
    for (const [prop, value] of TAB_OFF) if (off.some(([, p]) => p === prop)) tab.style.setProperty(prop, value, "important");
    for (const [p, v] of fill) indicator.style.setProperty(p, v);
  };

  const finish = () => {
    const running = slide;
    slide = null;
    target = null;
    running?.cancel();
    // The tabs' fills come back while their fill transitions are still off,
    // and a style read commits that, so the new tab shows its own fill in the
    // very frame the indicator disappears. Only then do transitions come back.
    restoreAll(fillsSaved);
    for (const tab of tabs()) void getComputedStyle(tab).backgroundColor;
    restoreAll(tabsSaved);
    indicator.removeAttribute("style");
    indicator.hidden = true;
    restoreAll(hostSaved);
  };

  return {
    move(prev, next) {
      const el = host();
      const usable = (t: HTMLElement | null): t is HTMLElement => !!t && t.isConnected && t.parentElement === el && t.offsetWidth > 0;
      if (!el || !usable(next) || !motionAllowed()) {
        if (slide) finish();
        return;
      }
      if (!slide) {
        if (!usable(prev) || prev === next) return;
        const cs = getComputedStyle(el);
        setAll(hostSaved, el, cs.position === "static" ? [["position", "relative"], ["isolation", "isolate"]] : [["isolation", "isolate"]]);
        for (const tab of tabs()) setAll(tabsSaved, tab, [TAB_TRANSITION]);
        for (const tab of tabs()) setAll(fillsSaved, tab, TAB_OFF);
        indicator.hidden = false;
        for (const [p, v] of [
          ["position", "absolute"],
          ["left", "0px"],
          ["z-index", "-1"],
          ["pointer-events", "none"],
          ["box-sizing", "border-box"],
          ["margin", "0px"],
        ] as const)
          indicator.style.setProperty(p, v);
        indicator.style.setProperty("top", `${prev.offsetTop}px`);
        indicator.style.setProperty("height", `${prev.offsetHeight}px`);
        slideIndicator(indicator, prev, { instant: true });
      }
      copyFill(next);
      indicator.style.setProperty("top", `${next.offsetTop}px`);
      indicator.style.setProperty("height", `${next.offsetHeight}px`);
      target = next;
      const mine = slideIndicator(indicator, next);
      slide = mine;
      void mine.finished.then(() => {
        if (slide === mine) finish();
      });
      // A switch whose effect lands after this layout effect recolours the tab
      // only then: the theme's own data-theme is written in a passive effect.
      // For a click, React flushes that in the same task, so a microtask
      // copies the new colour before the first paint; the next frame catches
      // an effect that lands later still.
      const resync = () => {
        if (slide === mine && target) copyFill(target);
      };
      queueMicrotask(resync);
      requestAnimationFrame(resync);
    },
    stop() {
      if (slide) finish();
    },
  };
}

/** See the file comment. `activeKey` is whatever identifies the active tab
 * (the value the buttons compare against); `selector` picks the active tab
 * among the control's children, by default the first `[aria-selected=true]`,
 * `[aria-current=page]`, `[aria-pressed=true]` or `.active`. */
export function TabIndicator({ activeKey, selector = ACTIVE_TAB }: { activeKey: unknown; selector?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ghost = useRef<TabGhost | null>(null);
  const last = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const next = Array.from(host.children).find((c): c is HTMLElement => c instanceof HTMLElement && c !== el && c.matches(selector)) ?? null;
    const prev = last.current;
    last.current = next;
    if (prev && next && prev !== next) (ghost.current ??= tabGhost(el)).move(prev, next);
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => () => ghost.current?.stop(), []);

  return <span ref={ref} className="motion-tab-indicator" aria-hidden="true" hidden />;
}
