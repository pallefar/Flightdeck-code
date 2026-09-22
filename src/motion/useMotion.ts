/** React bindings for Studio's copy of the motion layer (motion.ts).
 *
 * ── WHY THESE ARE NOT THE OS'S HOOKS ────────────────────────────────
 * The OS's useMotion.ts (pallefar/project-contract, flightdeck/web/src/
 * motion/useMotion.ts at 54064a53) binds the helpers to the OS's own shape:
 * routed pages (useEntrances), drawers and dialogs (usePanelMotion),
 * sidebar groups (useDisclosure) and stat tiles (useCountUp). Studio has
 * none of those: it is one screen with no routes, no drawer, dialog or
 * sidebar group, and Atlas has no count-up for its stat tiles. So none of
 * them is copied. The two hooks below are Studio's, for the two things
 * Studio's screen does that Atlas animates.
 *
 * They keep the OS hooks' rules. Each runs in a LAYOUT effect, so the start
 * frame is written before the browser paints and no frame of the end state
 * flashes first. Each cancels on unmount. With motion off (reduced motion,
 * the kill switch, webdriver, a test) each one writes nothing: the committed
 * render is the whole story. */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { MOTION, arrive, motionSupported, reenter, swapIn, type MotionHandle } from "./motion";

/** What usePanelSwap plays for a commit. "swap" is Atlas's `studio-enter`
 * on the panel alone. "nested" is the pair Atlas plays when it re-keys the
 * surface around the panel: `work-surface-enter` on the host with
 * `studio-enter` on the panel inside it. */
export type PanelPlay = "swap" | "nested";

/** What usePanelSwap last showed: the view, the context, and what it played for them. */
export interface PanelShown {
  readonly view: unknown;
  readonly context: unknown;
  readonly play: PanelPlay;
}

/** The motion usePanelSwap plays for a commit that shows `view` in
 * `context`, after `prev`. "nested" on mount and whenever the context
 * changed, whether or not the view changed with it, because that is when
 * Atlas re-keys the surface as well as the panel. "swap" for a new view in
 * the same context, where Atlas re-keys only the panel. When neither
 * changed, the effect is StrictMode's dev re-run, straight after its
 * cleanups cancelled both motions, so the same one plays again. Exported
 * for the tests. */
export function panelPlay(prev: PanelShown | null, view: unknown, context: unknown): PanelPlay {
  if (prev === null || !Object.is(prev.context, context)) return "nested";
  if (!Object.is(prev.view, view)) return "swap";
  return prev.play;
}

/** What one commit plays on the panel host and the panel(s) it holds. The
 * panel always swaps in (`studio-enter`). "nested" also starts the host's
 * `work-surface-enter` and returns its handle as `surface`; "swap" leaves
 * the host alone and returns null there, so a surface motion still running
 * from the last mount or round keeps running around the new panel. They are
 * two different elements, so their translates and opacities compose as
 * Atlas's nested CSS animations do, and neither motion cancels the other.
 * Exported for the tests. */
export function playPanel(host: Element, play: PanelPlay): { readonly surface: MotionHandle | null; readonly panel: MotionHandle } {
  return { surface: play === "nested" ? reenter(host) : null, panel: swapIn(host.children) };
}

/** The items of `items` that are not in `before`, grouped by the delay each
 * waits: min(n, 3) x 45ms for its place n among ALL of `items`, as Atlas's
 * nth-child delays count every card, not only the new ones. Exported for the
 * tests. */
export function insertedByDelay<T>(before: ReadonlySet<T>, items: readonly T[]): Map<number, T[]> {
  const byDelay = new Map<number, T[]>();
  items.forEach((item, n) => {
    if (before.has(item)) return;
    const delay = Math.min(n, MOTION.stagger.maxSteps) * MOTION.stagger.step;
    byDelay.set(delay, [...(byDelay.get(delay) ?? []), item]);
  });
  return byDelay;
}

/** The panel under a tab strip, turning over in place.
 *
 * Atlas nests two keyed elements here. `.management-surface` is keyed by
 * the project (project-management.tsx:245) and plays `work-surface-enter`
 * (reenter: opacity 0.5 to 1, rise 5px, 220ms ease-out). Inside it,
 * `.studio-panel` is keyed by the tab (work-studio.tsx:318) and plays
 * `studio-enter` (swapIn: opacity 0 to 1, rise 6px, 250ms ease). So a first
 * render and a project switch play both, one inside the other: the panel
 * starts at opacity 0, 11px down. A tab change re-keys only the panel, and
 * a surface still entering keeps entering around the new one.
 *
 * Studio's panel host keeps its element, so this plays the same on `ref`
 * and its children: the nested pair on mount and whenever `context` changes
 * (another round), with or without a new `view`; swapIn on the children
 * alone when only `view` changes. The host's motion is held apart from the
 * panel's for that reason: a view change restarts the panel's motion and
 * leaves the host's running, as Atlas's surface is not re-keyed by a tab.
 * Another context restarts both. Unmount settles both. */
export function usePanelSwap(ref: RefObject<Element | null>, view: unknown, context: unknown): void {
  const shown = useRef<PanelShown | null>(null);
  /** The host's work-surface-enter, which outlives a view change. */
  const surface = useRef<MotionHandle | null>(null);
  useLayoutEffect(() => {
    const play = panelPlay(shown.current, view, context);
    shown.current = { view, context, play };
    const host = ref.current;
    if (host === null) return;
    const played = playPanel(host, play);
    // A new surface motion replaced the old one (drive() cancelled it first).
    if (played.surface !== null) surface.current = played.surface;
    return () => played.panel.cancel();
  }, [view, context]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(
    () => () => {
      surface.current?.cancel();
      surface.current = null;
    },
    [],
  );
}

/** Cards a filter brings in, arriving.
 *
 * Atlas's CSS plays `atlas-arrive` on every project card that is INSERTED,
 * with its nth-child delay (motion.css:129-140). So a filter tab that brings
 * other cards brings them arriving, and a card that stays does not move.
 *
 * This is that for the items matching `selector` inside `ref`, whenever
 * `key` (the filter) changes. An item that was not there in the previous
 * commit rises 9px and fades in over 450ms, waiting min(n, 3) x 45ms for
 * its place n among the items. Nothing plays on mount, because the panel's
 * own entrance plays then.
 *
 * A change while items are still arriving leaves alone every item that
 * stays: its arrival runs to its end, as Atlas's CSS animation does on a
 * card that stays in the DOM. Cancelling it would snap the card from half
 * faded to opaque in one frame. An item the change removes has its arrival
 * settled. Unmount settles them all.
 *
 * "Not there" means its ELEMENT is new, so the caller must give each item a
 * React key that survives the filter, never its place in the filtered list:
 * a positional key remounts every card a filter moves, and each one arrives
 * although it never left (GatePane.tsx, shownFindings, says more). */
export function useArriveInserted(ref: RefObject<Element | null>, selector: string, key: unknown): void {
  const seen = useRef<{ key: unknown; items: ReadonlySet<Element> } | null>(null);
  /** The arrivals still running, one per item. */
  const arriving = useRef(new Map<Element, MotionHandle>());
  // Every commit, so the items a change is compared against are the ones the
  // person last saw. Where motion can never run, nothing is even queried.
  useLayoutEffect(() => {
    const root = ref.current;
    const items = root !== null && motionSupported() ? Array.from(root.querySelectorAll(selector)) : [];
    const prev = seen.current;
    const now = new Set(items);
    seen.current = { key, items: now };
    for (const [el, h] of arriving.current) {
      if (now.has(el)) continue;
      h.cancel();
      arriving.current.delete(el);
    }
    if (prev === null || Object.is(prev.key, key)) return;
    for (const [delay, els] of insertedByDelay(prev.items, items)) {
      for (const el of els) {
        const h = arrive(el, { delay, stagger: 0 });
        arriving.current.set(el, h);
        void h.finished.then(() => {
          if (arriving.current.get(el) === h) arriving.current.delete(el);
        });
      }
    }
  });
  useLayoutEffect(() => {
    const running = arriving.current;
    return () => {
      for (const h of running.values()) h.cancel();
      running.clear();
    };
  }, []);
}
