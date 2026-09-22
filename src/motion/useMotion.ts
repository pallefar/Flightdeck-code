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
import { MOTION, arrive, motionSupported, reenter, swapIn, type MotionHandle, type MotionTargets } from "./motion";

export type Play = (targets: MotionTargets) => MotionHandle;

/** What usePanelSwap last showed: the view, the context, and what it played for them. */
export interface PanelShown {
  readonly view: unknown;
  readonly context: unknown;
  readonly play: Play | null;
}

/** The motion usePanelSwap plays for a commit that shows `view` in
 * `context`, after `prev`: swapIn on mount or a new view (even when the
 * context changed with it), reenter for a new context alone. When neither
 * changed the effect is StrictMode's dev re-run, straight after its cleanup
 * cancelled the motion, so the same one plays again. Exported for the tests. */
export function panelPlay(prev: PanelShown | null, view: unknown, context: unknown): Play | null {
  if (prev === null || !Object.is(prev.view, view)) return swapIn;
  if (!Object.is(prev.context, context)) return reenter;
  return prev.play;
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
 * Atlas keys its `.studio-panel` by the tab (work-studio.tsx:318), so the
 * first render and every tab change mount a panel that plays `studio-enter`
 * (swapIn: rise 6px, fade in, 250ms). Atlas also re-keys a surface when its
 * context changes under it, a project switch, which plays
 * `work-surface-enter` (reenter: opacity 0.5 to 1, rise 5px, 220ms).
 *
 * Studio's panel host keeps its element, so this plays both on the
 * children of `ref`: swapIn on mount and whenever `view` changes; reenter
 * when only `context` changes (another round, same view). When both change
 * in one commit the swap plays, never both. A change mid-motion restarts it;
 * unmount settles it. */
export function usePanelSwap(ref: RefObject<Element | null>, view: unknown, context: unknown): void {
  const shown = useRef<PanelShown | null>(null);
  useLayoutEffect(() => {
    const play = panelPlay(shown.current, view, context);
    shown.current = { view, context, play };
    const root = ref.current;
    if (root === null || play === null) return;
    const handle = play(root.children);
    return () => handle.cancel();
  }, [view, context]); // eslint-disable-line react-hooks/exhaustive-deps
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
