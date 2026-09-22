# Motion layer (`src/motion/`)

Studio's copy of the one motion layer shared by the OS, its sub-apps and Studio. Owner decision,
2026-09-22: *"also lets start using animate.js for animations in the app"*. Asked which library, the
owner chose **Anime.js** (animejs 4.x). The scope is **"Atlas motion, everywhere"**: reproduce
Flightdeck Atlas's motion language through one shared layer, and always honour reduced motion.

CSS hover, press and colour transitions are NOT here. They belong to the stylesheet
(`src/workbench/theme.ts`). This layer owns the panel swap, the sliding tab indicator and list
entrances.

## Where it comes from

Studio is a separate repo, so it carries a copy of the OS module instead of depending across repos.
The source is `pallefar/project-contract`, `flightdeck/web/src/motion/`, at commit **54064a53**
(`feat/anime-motion-os`).

| File | Relation to the OS file |
|---|---|
| `motion.ts` | Byte-identical, except for `swapIn` plus its `swap` tokens (Atlas's `studio-enter`), and type-only edits for Studio's stricter tsconfig. Each difference is listed in its header. |
| `TabIndicator.tsx` | Byte-identical. Only the header comment is Studio's. |
| `useMotion.ts` | Studio's own two hooks, built on the same helpers (see below). |

Re-sync by diffing against the OS files. The tokens (durations, easings, the 9px arrive rise, the
45ms stagger capped at 135ms, the indicator's 450ms `cubic-bezier(.22,1,.36,1)`) must stay identical.

## What is animated in Studio

These are the only places in Studio where Atlas has an equivalent motion.

| Where | Helper | Atlas source |
|---|---|---|
| The workbench view tabs (`Workbench.tsx`, `.fd-tabs__group`) | `<TabIndicator activeKey={view}>` | `.view-tab-indicator`, motion.css:62-77: a 450ms slide on the emphasized curve. At rest the indicator is `hidden` and the tab's own `aria-selected` style marks it. |
| The panel under the tabs (`.fd-body > *`), on a view change in the same round | `usePanelSwap` → `swapIn` on the pane | `.studio-panel` keyed by its tab (work-studio.tsx:318), `studio-enter`, work-studio.css:74, 415-423: rise 6px and fade in over 250ms `ease`. A tab or tool change re-keys only the panel, so the surface around it is not restarted: one still entering keeps entering around the new panel, and one at rest does not move. |
| The panel host and the panel together (`.fd-body` and its pane), on first render and whenever the round changes (a round chip, a new round), with or without a view change | `usePanelSwap` → `reenter` on `.fd-body` plus `swapIn` on its pane | Atlas's nested pair. `.management-surface` is keyed by the project (project-management.tsx:245) and plays `work-surface-enter` (navigation.css:677, 841-846: from opacity 0.5, rise 5px, over 220ms `ease-out`). The `.studio-panel` inside it re-keys with it and plays `studio-enter`. So a mount or a project switch paints the panel at opacity 0.5 × 0, 5 + 6 = 11px down. They are two elements, so the translates compose and neither motion cancels the other. The host's motion has its own handle, which only another round or an unmount cancels, so a view change right after (Studio's demo switches to Run one frame after the first render) swaps the pane inside a surface that is still entering, as in Atlas. |
| Finding cards that a Gate severity filter brings in (`GatePane.tsx`) | `useArriveInserted` → `arrive` | `atlas-arrive` on inserted `.project-grid > .project-card`, motion.css:129-150. Only inserted cards arrive, each waiting min(n, 3) × 45ms for its place among all the cards. A card still arriving when the filter changes again keeps arriving if it stays, as a CSS animation does. A card that stays does not move: each card's key is the finding itself (`shownFindings`), as Atlas keys its cards by id (atlas.tsx:1063), so a filter that moves a card keeps its element. |

What is deliberately **not** animated, and why:

- **No drawers, dialogs or popovers**: Studio has none, so `presence.ts` and `usePanelMotion` are not copied.
- **No sliding indicator on the Gate filter or the editor's read/edit switch**: those are Atlas's
  `.filter-tabs`, which have colour transitions only and no indicator.
- **No count-up on the Gate stat tiles**: Atlas has no count-up.
- **No page-entrance watcher or sidebar disclosure**: Studio has no routed pages and no sidebar
  groups, so `entrances.ts`, `disclosure.ts` and `CountUp.tsx` are not copied.

## The rules

These are the same hard rules as the OS module's.

1. **Animation is decoration.** Markup and CSS always render the final state. Never start an
   element at `opacity: 0` in markup or CSS. A helper pulls an already-rendered element back to its
   start frame, only when `motionAllowed()` says so. Hooks do this in a layout effect, so no frame
   of the end state paints first.
2. **Reduced motion means no movement.** With `prefers-reduced-motion: reduce`, nothing moves.
3. **Tests see the final state synchronously.** Every helper does nothing, or settles
   synchronously, in any of these cases:
   - there is no `window` (Studio's tests run in node);
   - `matchMedia` is missing;
   - the user agent is jsdom;
   - `navigator.webdriver` is true;
   - the tab is hidden;
   - `window.__FD_MOTION_OFF === true`;
   - the build ran with `VITE_FD_MOTION_OFF=1`.
4. **Only compositor properties.** Helpers write `opacity` and the individual `translate`/`scale`
   properties, never `transform`, so they compose with the theme's hover lift.
5. **Everything written is taken back** when a motion completes or is cancelled. A second motion
   on the same element cancels the first before it starts. Every hook cancels on unmount.

**Wiring notes:**
- Don't JS-animate an element that also has a CSS `animation`, because the CSS animation beats the
  inline frames.
- `TabIndicator` goes first in its control, and the control's tabs must be its direct children.
- `useArriveInserted` tells an inserted item by its element, so key each item by what it is, never
  by its place in the filtered list. A positional key remounts every item a filter moves, and each
  one fades out and arrives again although it never left.

## Opting out

| Who | How |
|---|---|
| The user | Their operating system's "reduce motion" setting (`prefers-reduced-motion`). |
| A developer or a screenshot script | Set `window.__FD_MOTION_OFF = true`, or build with `VITE_FD_MOTION_OFF=1`. |
| Automation | Nothing to do, because `navigator.webdriver` turns motion off. To *record* motion with Playwright, launch Chrome with `--disable-blink-features=AutomationControlled`. |

## Testing

`src/motion/__tests__/motion.test.tsx` covers:

- every switch in `motionAllowed()`;
- the motion-off paths (writes nothing, already settled);
- on anime's real engine, run under node: the start frames, the clean hand-back on completion and
  on cancel, cancel-first, and the tab indicator's hand-back;
- the hooks' decisions (`panelPlay`, `insertedByDelay`), and `playPanel`'s two plays: the nested
  pair's start frames on the host and the pane, each handle handing back only its own element, and
  the swap never touching the host;
- `usePanelSwap` run for real, mounted by `react-dom/client` on the small fake document: in
  StrictMode, the nested pair on mount and on another round, the swap alone on another view, and
  nothing left inline after an unmount mid-motion; and a view change while the surface is still
  entering, which swaps the pane and neither cancels nor restarts the surface;
- `useArriveInserted` run for real inside `GatePane`, mounted by `react-dom/client` on a small fake
  document: across All → Warnings → All a card that stays is the same element and is never written
  to, only the cards that come back arrive, and unmounting mid-arrival leaves no inline style; a
  filter change mid-arrival lets a card that stays finish arriving and settles a card it removes;
- `shownFindings`: every finding keeps its key under every filter, exact duplicates included;
- the rendered markup, which never carries a start frame.

It uses small fakes (an element, and for the GatePane test a document) rather than a DOM library,
which Studio does not have, and the file explains why. The curves, interruption and the absence of
any residue were checked on frames recorded in real Chrome against Atlas.

## Dependency record (rule 8)

- **Package:** `animejs` `^4.5.0` (4.5.0 installed), MIT, by Julian Garnier, https://animejs.com.
- **Why:** the owner's request quoted above. None of Studio's dependencies animates.
- **How it is used:** named imports only (`animate`, `cubicBezier`, the `EasingFunction` type),
  so Vite tree-shakes the rest.
- **Delivery:** bundled by Vite, never loaded from a CDN.
- **Size (Vite 6 production build, minified):** the one JS chunk grows from 562,773 to 605,174
  bytes (+42.4 KB raw) and from 171,667 to 187,685 bytes gzip -9 (+16.0 KB), for anime and this
  module together.
