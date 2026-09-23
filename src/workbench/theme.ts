/** Styles as strings, not as a `.css` import.
 *
 * ⭐ WHY. Two reasons, and the second is not stylistic.
 *
 * 1. The preview renders the generated page inside an IFRAME, which has
 *    its own document and therefore its own stylesheet. It needs CSS
 *    delivered as text no matter what, so a build-tool `import "./x.css"`
 *    would only cover half the surface and the frame would still need the
 *    string. One mechanism beats two.
 * 2. `HOST_FRAME_CSS` is a different thing from `WORKBENCH_CSS` and the
 *    difference is the honest part. The generated page uses the HOST's
 *    class names — `page`, `card`, `muted`, `mono`, `errorbox`, `okbox` —
 *    because contract §9 says every sub-app's CSS lives in a
 *    banner-delimited region of the shared `web/src/theme.css` and
 *    `web/src/subapps` contains zero stylesheets. Studio does not have
 *    that file. So the frame gets an APPROXIMATION of it, kept deliberately
 *    plain, and the fidelity ledger says in as many words that this is not
 *    the host's stylesheet. Giving the frame Studio's own chrome — its
 *    elevation, its hover motion, its dark mode — would be the prettiest
 *    lie on the screen.
 *
 * Keeping them apart in one file makes that contrast legible: the
 * workbench chrome is Flightdeck's visual language, the frame is a sober
 * stand-in for somebody else's.
 *
 * ── THE DESIGN IS ATLAS'S (2026-09-22) ─────────────────────────────
 * Every Flightdeck app now matches Flightdeck Atlas, light AND dark, and
 * Atlas defaults to light. The values below are Atlas's own
 * (`flightdeck-atlas/app/te-theme.css`, `globals.css`, `motion.css`), not
 * invented here; the few that are derived say so. The only Studio-specific
 * departures are density ones — a workbench shows source code, so its
 * body text is 14px rather than Atlas's 16px, and code keeps a real
 * monospace stack while everything else uses Atlas's Arial stack. */

/** The two themes. Light is the default, as it is in Atlas. */
export type StudioTheme = "light" | "dark";

export const DEFAULT_THEME: StudioTheme = "light";

/** Where the driver remembers a person's choice, on Studio's own origin.
 * `index.html` repeats this key literally in its pre-paint script (it runs
 * before any module loads), so a rename has to happen in both places. */
export const THEME_STORAGE_KEY = "flightdeck-studio-theme";

export function isStudioTheme(value: unknown): value is StudioTheme {
  return value === "light" || value === "dark";
}

/** Atlas light (`te-theme.css:89-139, 238-253`). */
const LIGHT = {
  bg: "#f3f6f7",
  /** Demo-banner / filter-tab background. */
  bg2: "#edf3f6",
  surface: "#ffffff",
  /** Form fields and inset cards. */
  surface2: "#f8fafb",
  /** Sidebar and topbar. */
  shell: "#ffffff",
  ink: "#253d4b",
  muted: "#586e7c",
  /** Derived: line numbers only — never prose. */
  faint: "#6f8390",
  eyebrow: "#5a7383",
  brand: "#2e4957",
  line: "#d5dfe5",
  /** Atlas's input border. */
  lineStrong: "#bdcdd6",
  hover: "#f0f4f6",
  /** The chosen option of a FILTER (`.filter-tabs .chosen`). */
  segActive: "#ffffff",
  /** `.filter-tabs`: its track, its border, its resting and chosen ink
   * (`te-theme.css:203-214`). */
  segTrack: "#edf3f6",
  segLine: "#d0dde5",
  segInk: "#5c7281",
  segChosenInk: "#2e4957",
  /** The chosen option of a MODE switch — `.project-layout-switch`'s
   * `var(--accent)`, measured rgb(229,238,243) (`productivity.css:212-216`). */
  modeActive: "#e5eef3",
  /** `.metric-label` and its corner icon, measured. */
  metricLabel: "#5e7482",
  metricIcon: "#6a8494",
  accent: "#e98300",
  /** Dark text on orange. */
  accentInk: "#21180d",
  /** Orange as TEXT: #e98300 on white is 2.7:1, so text uses the active-nav
   * colour instead (5.4:1 on the tint). */
  accentText: "#985000",
  tint: "#fff0d9",
  tabBg: "#fff0d9",
  tabInk: "#713f00",
  green: "#367956",
  greenBg: "#e5f3e8",
  amber: "#806620",
  amberBg: "#f8f0d9",
  red: "#aa3122",
  /** Derived: Atlas names no destructive tint. */
  redBg: "#f9e7e4",
  blue: "#30648f",
  blueBg: "#e7f0f8",
  logInk: "#3a5361",
  shadow: "0 4px 16px #233e4d09, 0 1px 3px #233e4d08",
  shadowHover: "0 12px 28px #243f5018, 0 2px 5px #243f500c",
  /** The chosen segment of `.filter-tabs` (`te-theme.css:210-214`). */
  shadowSeg: "0 1px 4px #17384c16",
  /** `.project-layout-switch button[aria-pressed="true"]`, both themes. */
  shadowMode: "0 2px 6px #0001",
  /** `.view-tab-indicator` — the selected VIEW tab's lift (`motion.css:62-73`). */
  shadowTab: "0 2px 6px #b9731420",
  shadowXs: "0 1px 2px #233e4d0d",
} as const;

type Palette = { readonly [K in keyof typeof LIGHT]: string };

/** Atlas dark (`te-theme.css:49-88`, `globals.css:13-19, 552-567`). */
const DARK: Palette = {
  bg: "#0e1720",
  bg2: "#1c2e3a",
  surface: "#17242f",
  surface2: "#182833",
  shell: "#14222d",
  ink: "#eef2f7",
  muted: "#a7b6c3",
  faint: "#7f91a0",
  eyebrow: "#a7b6c3",
  brand: "#eef2f7",
  line: "#304553",
  lineStrong: "#405665",
  hover: "#1f3240",
  /** Atlas's dark `.filter-tabs` is its base rule (`globals.css:447-465`):
   * NO track fill, a neutral border, a neutral chosen option. */
  segActive: "#30363d",
  segTrack: "transparent",
  segLine: "#2b3037",
  segInk: "#949da8",
  segChosenInk: "#e3e7eb",
  modeActive: "#29404f",
  metricLabel: "#98a2ae",
  metricIcon: "#747f89",
  accent: "#e98300",
  accentInk: "#15100e",
  accentText: "#ffb34f",
  tint: "#44351f",
  tabBg: "#493720",
  tabInk: "#ffd19a",
  green: "#87c3a7",
  greenBg: "#22382f",
  amber: "#c9b687",
  amberBg: "#343026",
  red: "#ff807d",
  redBg: "#3b2529",
  blue: "#8eb6e6",
  blueBg: "#233142",
  logInk: "#c2cdd8",
  shadow: "0 8px 26px #00000025, 0 1px 2px #00000020",
  shadowHover: "0 14px 28px #0005",
  /** Atlas's own dark value for the same control (`globals.css:461-465`). */
  shadowSeg: "0 2px 4px #0003",
  shadowMode: "0 2px 6px #0001",
  /** `[data-theme="dark"] .view-tab-indicator` (`motion.css:74-77`). */
  shadowTab: "0 2px 8px #0004",
  shadowXs: "0 1px 2px #0003",
};

/** Flightdeck's palette — Atlas's, per theme. */
export const TOKENS: { readonly [T in StudioTheme]: Palette } = { light: LIGHT, dark: DARK };

/** `lineStrong` → `--line-strong`. */
export function tokenVar(name: string): string {
  return `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function declare(palette: Palette): string {
  return Object.entries(palette)
    .map(([name, value]) => `  ${tokenVar(name)}: ${value};`)
    .join("\n");
}

/** The frame's page background, shared with the frame element so the two
 * never show a seam while the frame's document is still loading. */
const FRAME_BG = "#f3f6f7";

export const WORKBENCH_CSS = `
.fd-wb {
${declare(TOKENS.light)}
  --r-lg: 12px;
  --r-md: 7px;
  --topbar-h: 83px;
  --sans: Arial, Helvetica, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;

  color-scheme: light;
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(300px, 30%) 1fr;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 var(--sans);
  scrollbar-color: var(--line-strong) transparent;
  overflow: hidden;
}
.fd-wb[data-theme="dark"] {
${declare(TOKENS.dark)}
  color-scheme: dark;
}
.fd-wb *, .fd-wb *::before, .fd-wb *::after { box-sizing: border-box; }

/* Code is monospace. NOTHING ELSE IS — Atlas has no monospace anywhere in
   its chrome, and Studio leaked it into six labels that are not code: the
   topbar's round metadata, the file-path header, "54 lines", the preview
   bar's route prefix, a finding's rule id and its "(candidate)" scope
   line. Those now sit in the sans stack with the counts. What stays
   monospace is what a person reads as SOURCE: the annotated read view,
   the editor, a diff hunk head, a finding's evidence, a process's output
   and the request log.

   Counts are quantities you compare against another quantity, so they get
   tabular digits — in Atlas's sans, because a count is not code. */
.fd-wb .mono, .fd-wb code, .fd-wb pre { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.fd-wb .fd-stat__n, .fd-wb .fd-run__count, .fd-wb .fd-run__failed, .fd-wb .fd-step__ms,
.fd-wb .fd-step__exit, .fd-wb .fd-ticker__n, .fd-wb .fd-tab__count, .fd-wb .fd-roundchip__n,
.fd-wb .fd-delta, .fd-wb .fd-conflict__stat, .fd-wb .fd-tabs__id {
  font-family: var(--sans); font-variant-numeric: tabular-nums;
}
/* Every icon is a lucide node at Atlas's 2px stroke on a 24 grid, tinted
   with its control's own colour (components/LineIcon.tsx). They never
   shrink when a flex row runs out of room — an icon at 11px is a smudge. */
.fd-wb svg { flex: 0 0 auto; }

/* ⚠ ZERO SPECIFICITY, ON PURPOSE. This used to read \`.fd-wb button\`
   (0,1,1), which beat every single-class rule below it (0,1,0): the Build
   button had no orange, Stop had no border, the round chip had no pill and
   a finding had no card — each of those rules was written and none of them
   ever applied. \`:where()\` makes this the reset it was meant to be. */
:where(.fd-wb) button {
  font: inherit; color: inherit; background: none; border: 0; cursor: pointer;
  border-radius: var(--r-md); padding: 6px 10px;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease,
    box-shadow .2s ease, transform .2s ease, filter .15s ease;
}
.fd-wb button:focus-visible, .fd-wb [tabindex]:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.fd-wb input:focus-visible, .fd-wb textarea:focus-visible, .fd-wb select:focus-visible {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 50%, transparent);
}

/* Atlas's button family. Outline: bordered, on the card colour. */
.fd-stop, .fd-lockbtn, .fd-revert, .fd-conflict__acts button, .fd-preview__bar .fd-tab, .fd-themetoggle {
  border: 1px solid var(--line); background: var(--surface); color: var(--ink);
  box-shadow: var(--shadow-xs);
}
.fd-lockbtn:hover, .fd-revert:hover, .fd-conflict__acts button:hover, .fd-preview__bar .fd-tab:hover {
  background: var(--hover);
}
/* Primary: solid orange, dark text. */
.fd-composer__send, .fd-save { background: var(--accent); color: var(--accent-ink); font-weight: 500; }
.fd-composer__send:hover:not(:disabled), .fd-save:hover { filter: brightness(1.06); opacity: .92; }

/* Atlas lifts buttons on hover and settles them on press. Only where the
   person has not asked for less motion, and never on dense list rows. */
@media (prefers-reduced-motion: no-preference) {
  .fd-composer__send:hover:not(:disabled), .fd-stop:hover:not(:disabled) { transform: translateY(-2px); }
  .fd-save:hover, .fd-lockbtn:hover, .fd-revert:hover, .fd-conflict__acts button:hover,
  .fd-preview__bar .fd-tab:hover, .fd-themetoggle:hover, .fd-roundchip:hover, .fd-finding:hover {
    transform: translateY(-1px);
  }
  .fd-composer__send:active:not(:disabled), .fd-stop:active:not(:disabled), .fd-save:active,
  .fd-lockbtn:active, .fd-revert:active, .fd-themetoggle:active { transform: scale(.98); }
}

/* ── chat ─────────────────────────────────────────────────────────── */
.fd-chat {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  border-right: 1px solid var(--line); background: var(--shell);
}
.fd-chat__head {
  height: var(--topbar-h); flex: 0 0 auto;
  display: flex; flex-direction: column; justify-content: center; gap: 5px;
  padding: 0 24px; border-bottom: 1px solid var(--line);
}
/* Atlas's wordmark: 600, 2px tracking, dark teal. */
.fd-chat__title {
  font-size: 16px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase;
  line-height: 1.2; color: var(--brand);
}
.fd-chat__sub { color: var(--muted); font-size: 12px; }
.fd-chat__log { flex: 1; overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; gap: 16px; }

.fd-turn { display: flex; flex-direction: column; gap: 7px; }
/* Atlas's eyebrow, measured on the running app: 12px/600/2px, NOT the
   10px that globals.css:272 declares — the unconditional "Readable
   working-surface typography" block at globals.css:1519-1541 resets
   every eyebrow to 12px, and 12px is what a person sees. */
.fd-turn__who {
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; color: var(--eyebrow);
}
.fd-turn__body {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  padding: 12px 14px; white-space: pre-wrap; word-break: break-word;
}
.fd-turn--you .fd-turn__body { background: var(--bg2); box-shadow: none; }
.fd-turn--refused .fd-turn__body { border-color: var(--amber); }
.fd-turn--failed .fd-turn__body { border-color: var(--red); }
.fd-turn__caret {
  display: inline-block; width: 7px; height: 1em; background: var(--accent);
  vertical-align: text-bottom; animation: fd-blink 1s steps(2) infinite;
}
@keyframes fd-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .fd-turn__caret { animation: none; } }

.fd-roundchip {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px 5px 10px;
  background: var(--surface); box-shadow: var(--shadow-xs); font-size: 12px; font-weight: 600;
}
.fd-roundchip:hover { border-color: color-mix(in srgb, var(--accent) 60%, var(--line)); }
.fd-roundchip[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
  background: var(--tint); color: var(--accent-text);
}
.fd-roundchip__n { color: var(--muted); }

.fd-composer {
  border-top: 1px solid var(--line); padding: 14px 16px;
  display: flex; gap: 8px; align-items: flex-end; background: var(--shell);
}
.fd-composer textarea {
  flex: 1; resize: none; min-height: 62px; max-height: 190px;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--line-strong); border-radius: var(--r-md); box-shadow: var(--shadow-xs);
  padding: 9px 12px; font: inherit;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.fd-composer textarea::placeholder { color: var(--muted); }
/* Atlas's primary button (.add-button): 37 high, 13px/500, a 16px icon
   8px before the label. */
.fd-composer__send { height: 36px; padding: 0 18px; display: inline-flex; align-items: center; gap: 8px; }
.fd-composer__send:disabled { background: var(--bg2); color: var(--muted); cursor: not-allowed; }
/* Atlas's secondary buttons carry the same icon, at the same gap. */
.fd-stop, .fd-lockbtn, .fd-revert, .fd-save, .fd-conflict__acts button {
  display: inline-flex; align-items: center; gap: 8px;
}

/* ── main pane ────────────────────────────────────────────────────── */
.fd-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
/* Atlas's topbar: the shell colour, a bottom rule, the pill view-tabs. */
.fd-tabs {
  height: var(--topbar-h); flex: 0 0 auto;
  display: flex; align-items: center; gap: 10px;
  padding: 0 28px; border-bottom: 1px solid var(--line); background: var(--shell);
}
.fd-tabs__group {
  display: inline-flex; gap: 2px; padding: 4px;
  border: 1px solid var(--line); border-radius: var(--r-lg);
  background: var(--surface); box-shadow: var(--shadow);
}
.fd-tab { color: var(--muted); display: inline-flex; align-items: center; gap: 7px; }
/* Atlas's .view-tabs button (motion.css:38-54): 36 high, 13px/600, 8px
   radius, 9px between the icon and the label. */
.fd-tabs .fd-tab {
  height: 36px; min-width: 100px; padding: 0 14px; justify-content: center; gap: 9px;
  font-size: 13px; font-weight: 600; border-radius: 8px;
}
.fd-tabs .fd-tab:hover { color: var(--ink); }
/* The chosen one, with .view-tab-indicator's own fill AND its lift
   (motion.css:62-73). The shadow is not decoration: it is what the sliding
   indicator copies off the new tab while it plays, so a tab without it
   would land flat and then gain a shadow a frame later. */
.fd-tabs .fd-tab[aria-selected="true"] {
  background: var(--tab-bg); color: var(--tab-ink); box-shadow: var(--shadow-tab);
}
.fd-tab__count {
  font-size: 11px; font-weight: 600; min-width: 20px; text-align: center;
  padding: 1px 7px; border-radius: 999px; background: var(--bg2); color: var(--muted);
}
.fd-tab[aria-selected="true"] .fd-tab__count {
  background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--tab-ink);
}
.fd-tab .fd-tab__count.fd-tab__count--error { background: var(--red-bg); color: var(--red); }
.fd-tab .fd-tab__count.fd-tab__count--warn { background: var(--amber-bg); color: var(--amber); }
.fd-tabs__spacer { flex: 1; }
.fd-tabs__id { font-size: 12px; color: var(--muted); }
/* ⚠ WHO GIVES WAY WHEN THE TOPBAR RUNS OUT OF ROOM. Measured: five tabs
   with icons and an icon on "Download candidate" cost 81px, and at a
   1440px window the main pane is 1008px — the theme toggle ended 6px off
   the right edge. Every control keeps its size and the round's metadata
   line, the one item nobody acts on, truncates instead. Its full text
   stays on the element's title. */
.fd-tabs > .fd-tabs__group, .fd-tabs > .fd-save, .fd-tabs > .fd-lockbtn,
.fd-tabs > .fd-tabs__edits, .fd-tabs > .fd-themetoggle { flex: 0 0 auto; }
.fd-tabs > .fd-tabs__id {
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ── the page-header tier ─────────────────────────────────────────── */
/* Atlas opens every view with an uppercase tracked eyebrow over a large,
   loosely tracked heading (.page-heading, globals.css:277-306). It is
   the single most recognisable thing about the design and Studio had it
   on no view at all. The h1 is Atlas's own clamp, so it measures the same
   36.72px at a 1440px viewport that Atlas does, and scales with the
   window the same way. The block's padding is Studio's density
   departure — Atlas's .dashboard spends 42px on each side, which a
   workbench with a 30% chat column beside it cannot afford. */
.fd-pagehead {
  flex: 0 0 auto; padding: 22px 28px 16px; border-bottom: 1px solid var(--line); background: var(--bg);
}
.fd-pagehead__eyebrow {
  display: block;
  font-size: 12px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase;
  line-height: 1.5; color: var(--eyebrow);
}
.fd-pagehead__h {
  margin: 6px 0 0;
  font-size: clamp(29px, 2.55vw, 43px); font-weight: 500; letter-spacing: -1.5px;
  line-height: 1.25; color: var(--ink);
}
.fd-pagehead__lead { margin: 6px 0 0; color: var(--muted); font-size: 13px; }

/* Atlas's icon button: 36 square, 7px, bordered; the border turns orange on hover. */
.fd-themetoggle {
  width: 36px; height: 36px; padding: 0; flex: 0 0 auto;
  display: inline-grid; place-items: center;
}
.fd-themetoggle:hover { border-color: var(--accent); }
.fd-themetoggle svg { width: 17px; height: 17px; }

.fd-body { flex: 1; min-height: 0; display: flex; }
.fd-empty {
  margin: auto; max-width: 440px; text-align: center; color: var(--muted);
  display: flex; flex-direction: column; gap: 10px; padding: 24px;
}
.fd-empty strong { color: var(--ink); font-weight: 600; }

/* ── file tree ────────────────────────────────────────────────────── */
.fd-files { display: flex; flex: 1; min-width: 0; min-height: 0; }
.fd-tree {
  width: 300px; flex: 0 0 auto; overflow-y: auto;
  border-right: 1px solid var(--line); padding: 10px 8px; background: var(--shell);
}
/* Atlas's nav item: 7px, a hover wash with a 3px orange bar, and the tint
   with the deep orange for the current one. */
.fd-tree__row {
  display: flex; align-items: center; gap: 7px; width: 100%; min-height: 32px;
  padding: 6px 10px; border-radius: var(--r-md); text-align: left; min-width: 0; font-size: 13px;
}
.fd-tree__row:hover { background: var(--hover); box-shadow: inset 3px 0 0 var(--accent); }
.fd-tree__row:focus-visible { outline-offset: -2px; }
.fd-tree__row[aria-current="true"] { background: var(--tint); color: var(--accent-text); box-shadow: none; }
.fd-tree__row--dim { opacity: 0.45; }
.fd-tree__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-tree__tier { display: block; padding: 14px 10px 6px; }
.fd-tree__tier:hover { box-shadow: none; }
.fd-tree__tierlabel {
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;
  color: var(--eyebrow); display: flex; align-items: center; gap: 7px;
}
.fd-tree__tierblurb { font-size: 12px; color: var(--muted); padding-top: 3px; line-height: 1.4; }
.fd-tree__tier--edit .fd-tree__tierlabel { color: var(--amber); }
/* The disclosure chevron and the row's own icon, both lucide nodes now.
   The chevron keeps a fixed box so names stay aligned whichever way it
   points, exactly as the Unicode triangles did. */
.fd-tree__twisty { color: var(--muted); display: inline-flex; width: 14px; justify-content: center; }
.fd-tree__icon { color: var(--muted); display: inline-flex; }
.fd-tree__row[aria-current="true"] .fd-tree__icon { color: inherit; }
.fd-delta { font-size: 12px; flex: 0 0 auto; }
.fd-delta__add { color: var(--green); }
.fd-delta__del { color: var(--red); }
.fd-delta__mod { color: var(--accent-text); }
.fd-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.fd-dot--error { background: var(--red); }
.fd-dot--warning { background: var(--amber); }

/* ── source and diff ──────────────────────────────────────────────── */
.fd-source { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--surface); }
.fd-source__head {
  display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 16px;
  border-bottom: 1px solid var(--line); flex: 0 0 auto;
}
.fd-source__path { font-size: 12px; color: var(--muted); display: inline-flex; align-items: center; gap: 7px; }
.fd-source__path b { color: var(--ink); font-weight: 600; }
.fd-code { flex: 1; overflow: auto; font-family: var(--mono); font-size: 12.5px; line-height: 1.6; }
.fd-code table { border-collapse: collapse; width: 100%; }
.fd-code td { padding: 0 10px; vertical-align: top; white-space: pre; }
.fd-code .fd-ln {
  width: 1%; text-align: right; color: var(--faint); user-select: none;
  position: sticky; left: 0; background: var(--surface2);
}
.fd-code tr[data-finding] { background: color-mix(in srgb, var(--red) 9%, transparent); }
.fd-code tr[data-finding="warning"] { background: color-mix(in srgb, var(--amber) 12%, transparent); }

.fd-hunk__head {
  font-family: var(--mono); font-size: 11.5px; color: var(--muted);
  padding: 6px 12px; background: var(--bg2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
  position: sticky; top: 0;
}
.fd-op--add { background: color-mix(in srgb, var(--green) 11%, transparent); }
.fd-op--remove { background: color-mix(in srgb, var(--red) 10%, transparent); }
.fd-op--add .fd-sign { color: var(--green); }
.fd-op--remove .fd-sign { color: var(--red); }
.fd-sign { width: 1%; padding-left: 8px !important; padding-right: 4px !important; user-select: none; }
.fd-seg { border-radius: 3px; }
.fd-op--add .fd-seg { background: color-mix(in srgb, var(--green) 26%, transparent); }
.fd-op--remove .fd-seg { background: color-mix(in srgb, var(--red) 24%, transparent); }

.fd-changes {
  width: 320px; flex: 0 0 auto; overflow-y: auto; border-right: 1px solid var(--line);
  padding: 10px 8px; background: var(--shell);
}
/* Atlas's demo banner — which leads with a line icon (.demo-banner > svg,
   globals.css:350-352) and aligns it to the first line of the text. */
.fd-note {
  display: flex; align-items: flex-start; gap: 9px;
  margin: 10px 14px; padding: 10px 13px; border-radius: var(--r-md);
  border: 1px solid var(--line); background: var(--bg2); color: var(--muted); font-size: 12.5px;
}
.fd-note svg { margin-top: 2px; }
.fd-note--warn svg { color: var(--amber); }
/* Atlas's management notice: a 3px bar on a tinted field. */
.fd-note--warn {
  border-color: color-mix(in srgb, var(--amber) 30%, var(--line)); border-left: 3px solid var(--amber);
  border-radius: 0 var(--r-md) var(--r-md) 0; background: var(--amber-bg); color: var(--ink);
}

/* ── gate ─────────────────────────────────────────────────────────── */
.fd-gate { flex: 1; overflow-y: auto; padding: 24px 28px; }
/* Atlas's stat tiles: one bordered container, cells split by 1px rules. */
.fd-gate__summary {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px;
  background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
  box-shadow: var(--shadow); margin-bottom: 14px;
}
/* Atlas's .metric, exactly: label row, number, caption. Measured on the
   running Atlas — padding 21px 23px 20px, label 12px/600/0.85px with a
   15px icon pushed to the tile's far edge by space-between, number
   35px/500/-1px on line-height 1.3 with margin: 10px 0 6px, caption
   12px muted.

   ⭐ THE NUMBER IS NEVER COLOURED BY MEANING. Atlas's .metric > strong
   sets no colour at all, so every tile's number inherits the ink — a
   green 0, an amber 1 and a green 45 side by side is Studio's invention,
   not Atlas's. Severity did not go away with the colour: it moved into
   the corner icon's SHAPE (an octagon for blocking, a triangle for
   warnings, a tick for clean), which is where Atlas puts a tile's
   meaning, and the topbar's Gate badge and every finding's left border
   still carry red and amber. */
.fd-stat {
  display: flex; flex-direction: column; justify-content: flex-start;
  background: var(--surface); padding: 21px 23px 20px; min-width: 0;
}
.fd-wb .fd-stat__n {
  font-size: 35px; font-weight: 500; letter-spacing: -1px; line-height: 1.3;
  margin: 10px 0 6px; color: var(--ink);
}
.fd-stat__k {
  display: flex; justify-content: space-between; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: var(--metric-label); text-transform: uppercase; letter-spacing: 0.85px;
}
.fd-stat__k svg { color: var(--metric-icon); }
.fd-stat__cap { font-size: 12px; color: var(--muted); line-height: 1.5; }
.fd-gate .fd-note { margin: 10px 0; }

.fd-finding {
  display: grid; grid-template-columns: auto 1fr; gap: 4px 14px;
  border: 1px solid var(--line); border-left-width: 3px; border-radius: 10px;
  background: var(--surface); box-shadow: var(--shadow);
  padding: 13px 16px; margin-bottom: 8px; width: 100%; text-align: left;
}
.fd-finding:hover { box-shadow: var(--shadow-hover); }
.fd-finding--error { border-left-color: var(--red); }
.fd-finding--warning { border-left-color: var(--amber); }
.fd-finding__rule { font-size: 12px; font-weight: 600; color: var(--muted); display: inline-flex; align-items: center; gap: 6px; }
.fd-finding__msg { grid-column: 2; }
.fd-finding__where { grid-column: 2; font-size: 12px; color: var(--accent-text); }
.fd-finding__ev {
  grid-column: 1 / -1; font-family: var(--mono); font-size: 11.5px; color: var(--muted);
  background: var(--bg2); border-radius: var(--r-md); padding: 6px 9px; margin-top: 5px;
  overflow-x: auto; white-space: pre;
}
/* Atlas's .filter-tabs (globals.css:447-465, te-theme.css:203-214),
   measured in BOTH themes. Light: a tinted track, a blue-grey border, the
   chosen option raised onto white. Dark is Atlas's BASE rule, which the
   light theme overrides — NO track fill at all, a neutral grey border and
   a neutral grey chosen option — so Studio's tinted dark track was its
   own. The values are the --seg-* tokens. 3px padding, 3px gap, 14px
   options at 7px 9px. Atlas's MODE switch is a different control — see
   .fd-modes. */
.fd-filter {
  display: inline-flex; gap: 3px; padding: 3px; margin: 16px 0 14px;
  background: var(--seg-track); border: 1px solid var(--seg-line); border-radius: var(--r-md);
}
.fd-filter button { font-size: 14px; color: var(--seg-ink); padding: 7px 9px; border-radius: 4px; }
.fd-filter button:hover { color: var(--seg-chosen-ink); }
.fd-filter button[aria-pressed="true"] { color: var(--seg-chosen-ink); background: var(--seg-active); box-shadow: var(--shadow-seg); border-radius: 4px; }

/* ── preview ──────────────────────────────────────────────────────── */
.fd-preview { flex: 1; display: flex; min-width: 0; min-height: 0; }
.fd-preview__stage { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.fd-preview__bar {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap; min-height: 52px;
  padding: 8px 16px; border-bottom: 1px solid var(--line); background: var(--surface); flex: 0 0 auto;
}
.fd-preview__bar .fd-tab { height: 32px; padding: 0 12px; font-size: 13px; }
.fd-toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--muted); cursor: pointer; }
.fd-toggle input { accent-color: var(--accent); }
.fd-toggle--off { color: var(--amber); }
.fd-preview__frame { flex: 1; min-height: 0; border: 0; width: 100%; background: ${FRAME_BG}; }
.fd-preview__side {
  width: 340px; flex: 0 0 auto; border-left: 1px solid var(--line);
  overflow-y: auto; padding: 18px; background: var(--surface);
}
.fd-side__h {
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;
  line-height: 1.5; color: var(--eyebrow); margin: 22px 0 10px;
}
.fd-side__h:first-child { margin-top: 0; }
.fd-ledger { display: flex; flex-direction: column; gap: 9px; }
.fd-ledger__row { display: grid; grid-template-columns: 66px 1fr; gap: 10px; align-items: start; }
/* Atlas's status chip (.status): tinted field, no border, 12px / 400 in
   sentence case — the label is written that way, not shouted by CSS. */
.fd-ledger__tag {
  font-size: 12px; font-weight: 400;
  border-radius: 5px; padding: 4px 8px; text-align: center;
}
.fd-ledger__tag--real { color: var(--green); background: var(--green-bg); }
.fd-ledger__tag--mocked { color: var(--amber); background: var(--amber-bg); }
.fd-ledger__tag--absent { color: var(--muted); background: var(--bg2); }
.fd-ledger__aspect { font-weight: 600; }
.fd-ledger__note { color: var(--muted); font-size: 12px; line-height: 1.45; }

/* The request log reads as a list of events, not as source: Atlas sets
   nothing outside code in monospace, and the preview bar's route prefix
   already left it. Sans, with tabular digits so the status codes align. */
.fd-log { font-size: 12px; font-variant-numeric: tabular-nums; display: flex; flex-direction: column; gap: 6px; }
.fd-log__row { display: grid; grid-template-columns: 36px 1fr; gap: 8px; }
.fd-log__status--ok { color: var(--green); }
.fd-log__status--refused { color: var(--amber); }
.fd-log__status--error { color: var(--red); }
.fd-log__why { grid-column: 2; color: var(--muted); font-size: 12px; }

.fd-blocked {
  margin: auto; max-width: 520px; padding: 26px;
  display: flex; flex-direction: column; gap: 12px; text-align: left;
}
.fd-blocked__icon { color: var(--muted); display: inline-flex; }
.fd-blocked__title { font-size: 18px; font-weight: 600; }
.fd-blocked__why { color: var(--muted); line-height: 1.55; }
.fd-blocked__next {
  border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: 0 10px 10px 0; background: var(--surface); box-shadow: var(--shadow);
  padding: 12px 14px; color: var(--ink);
}
.fd-blocked__list { font-family: var(--mono); font-size: 12px; color: var(--muted); margin: 0; padding-left: 18px; }

/* ── the run ──────────────────────────────────────────────────────── */
.fd-ticker {
  display: flex; align-items: baseline; gap: 9px; margin: 0;
  padding: 9px 16px; border-top: 1px solid var(--line); background: var(--surface2);
  color: var(--muted); font-size: 12.5px;
}
.fd-ticker__n { color: var(--accent-text); font-weight: 600; }
.fd-ticker__detail { color: var(--faint); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fd-stop {
  height: 36px; padding: 0 16px; color: var(--red); font-weight: 600;
  border-color: color-mix(in srgb, var(--red) 55%, var(--line));
}
.fd-stop:hover:not(:disabled) { background: var(--red-bg); }
.fd-stop:disabled { color: var(--muted); border-color: var(--line); cursor: progress; }

.fd-run { flex: 1; overflow-y: auto; padding: 24px 28px; min-width: 0; }
.fd-run__head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
/* Atlas's status chip, with its dot: 12px / 400, sentence case, 4px 8px. */
.fd-runstatus {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 400;
  border-radius: 5px; padding: 4px 8px; background: var(--bg2); color: var(--muted);
}
.fd-runstatus::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.fd-runstatus--running { color: var(--accent-text); background: var(--tint); }
.fd-runstatus--succeeded { color: var(--green); background: var(--green-bg); }
.fd-runstatus--failed { color: var(--red); background: var(--red-bg); }
.fd-runstatus--aborted { color: var(--amber); background: var(--amber-bg); }
.fd-run__count { color: var(--muted); font-size: 12px; }
.fd-run__failed { color: var(--red); font-size: 12px; }

.fd-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.fd-step {
  border: 1px solid var(--line); border-left-width: 3px; border-radius: 10px;
  background: var(--surface); box-shadow: var(--shadow); padding: 11px 14px;
}
.fd-step--queued { opacity: 0.55; box-shadow: none; }
.fd-step--running { border-left-color: var(--accent); }
.fd-step--succeeded { border-left-color: var(--green); }
.fd-step--failed { border-left-color: var(--red); }
.fd-step--aborted { border-left-color: var(--amber); }
.fd-step__head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.fd-step__pill {
  font-size: 12px; font-weight: 400;
  border-radius: 5px; padding: 4px 8px; background: var(--bg2); color: var(--muted);
  flex: 0 0 auto; min-width: 66px; text-align: center;
}
.fd-step__pill--running { color: var(--accent-text); background: var(--tint); }
.fd-step__pill--succeeded { color: var(--green); background: var(--green-bg); }
.fd-step__pill--failed { color: var(--red); background: var(--red-bg); }
.fd-step__pill--aborted { color: var(--amber); background: var(--amber-bg); }
.fd-step__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-step__detail { color: var(--muted); font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-step__exit, .fd-step__ms { color: var(--muted); font-size: 12px; flex: 0 0 auto; }
.fd-step__toggle {
  color: var(--muted); font-size: 12px; padding: 3px 8px; flex: 0 0 auto;
  display: inline-flex; align-items: center; gap: 5px;
}
.fd-step__toggle:hover { color: var(--ink); background: var(--hover); }
.fd-step__error { margin: 7px 0 0; color: var(--red); font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; }
.fd-step__error--quiet { color: var(--muted); }
.fd-step__log {
  margin-top: 9px; border-top: 1px solid var(--line); padding-top: 9px;
  max-height: 340px; overflow: auto;
}
.fd-step__log pre {
  margin: 0; font-family: var(--mono); font-size: 11.5px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word; color: var(--log-ink);
}
.fd-step__dropped { margin: 0 0 6px; color: var(--amber); font-size: 12px; }
.fd-out--err { color: var(--red); }

/* ── editing ──────────────────────────────────────────────────────── */
.fd-tabs__edits {
  font-size: 11px; font-weight: 600; color: var(--muted); background: var(--bg2);
  border-radius: 5px; padding: 4px 8px; flex: 0 0 auto;
}
.fd-tabs__edits--conflict { color: var(--amber); background: var(--amber-bg); }
.fd-tree__lock { color: var(--muted); display: inline-flex; }
.fd-tree__draft { display: inline-flex; }
.fd-tree__draft--dirty { color: var(--accent-text); }
.fd-tree__draft--saved { color: var(--green); }
.fd-tree__draft--conflicted { color: var(--amber); }

.fd-dirty { color: var(--accent-text); font-size: 12px; flex: 0 0 auto; }
.fd-edited { color: var(--green); font-size: 12px; flex: 0 0 auto; }
.fd-lockmark { color: var(--muted); font-size: 12px; flex: 0 0 auto; }
/* Read/Edit is a MODE switch, and Atlas's mode switch is
   .project-layout-switch (Cards/List/Board, productivity.css:197-216), not
   its filter: a TRANSPARENT track inside a 1px line, and the SELECTED
   option tinted (--mode-active, Atlas's --accent) under --shadow-mode.
   Every option is ink, 13px, 6px 11px: 31.5px tall. */
.fd-modes {
  display: inline-flex; gap: 3px; padding: 3px;
  background: transparent; border: 1px solid var(--line); border-radius: var(--r-md);
}
.fd-modes button { font-size: 13px; padding: 6px 11px; color: var(--ink); border-radius: 4px; }
.fd-modes button:hover { background: var(--hover); }
.fd-modes button[aria-pressed="true"] { color: var(--ink); background: var(--mode-active); box-shadow: var(--shadow-mode); border-radius: 4px; }
.fd-lockbtn, .fd-revert { font-size: 12px; color: var(--muted); padding: 4px 10px; }
.fd-lockbtn:hover, .fd-revert:hover { color: var(--ink); }
.fd-lockbtn[aria-pressed="true"] {
  color: var(--amber); background: var(--amber-bg); border-color: color-mix(in srgb, var(--amber) 45%, var(--line));
}
.fd-save { font-size: 12px; font-weight: 600; padding: 5px 12px; }

.fd-editor {
  flex: 1; min-height: 0; width: 100%; resize: none;
  background: var(--surface); color: var(--ink); border: 0; border-top: 1px solid var(--line);
  padding: 10px 14px; font-family: var(--mono); font-size: 12.5px; line-height: 1.6;
  tab-size: 2;
}
.fd-source__foot {
  border-top: 1px solid var(--line); padding: 8px 16px; flex: 0 0 auto; background: var(--surface2);
}

.fd-conflict {
  margin: 12px 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 9px;
  border: 1px solid color-mix(in srgb, var(--amber) 45%, var(--line)); border-left: 3px solid var(--amber);
  border-radius: 0 10px 10px 0; background: var(--amber-bg);
}
.fd-conflict__head { display: flex; flex-direction: column; gap: 4px; }
.fd-conflict__head strong { display: flex; align-items: flex-start; gap: 8px; }
.fd-conflict__head svg { color: var(--amber); margin-top: 2px; }
.fd-conflict__why { color: var(--muted); font-size: 12.5px; }
.fd-conflict__stat { margin: 0; font-size: 12px; color: var(--muted); }
.fd-conflict__acts { display: flex; gap: 8px; flex-wrap: wrap; }
.fd-conflict__acts button { font-size: 12.5px; padding: 5px 12px; }
.fd-conflict__acts button:first-child { border-color: var(--amber); color: var(--amber); }

/* ── a phone-width window ─────────────────────────────────────────── */
/* Measured at 390: the two columns collapsed to 300px of chat and 90px of
   workbench, the h1 wrapped to five lines and a tab click scrolled the
   overflow:hidden grid 631px sideways, so the heading sat at x = -303.
   Under Atlas's own 540px breakpoint the chat moves UNDER the work — the
   DOM order, and so the reading order, stays chat first — the topbar
   scrolls instead of pushing its controls off the edge, and the heading
   takes Atlas's mobile step (te-theme.css:474-481): 26px, -1px, the lead
   paragraph hidden, 17px side gutters as .dashboard's. Each view's
   fixed-width side column — the 300px tree, the 320px change list, the
   340px ledger — stacks above or below the work for the same reason.
   LAST in the sheet on purpose: at equal specificity it has to follow
   the rules it overrides. */
@media (max-width: 540px) {
  .fd-wb { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 38%); }
  .fd-main { grid-row: 1; }
  .fd-chat { grid-row: 2; border-right: 0; border-top: 1px solid var(--line); }
  .fd-tabs { padding: 0 17px; overflow-x: auto; }
  .fd-pagehead { padding: 18px 17px 14px; }
  .fd-pagehead__h { font-size: 26px; letter-spacing: -1px; }
  .fd-pagehead__lead { display: none; }
  .fd-files, .fd-preview { flex-direction: column; }
  .fd-tree, .fd-changes, .fd-preview__side { width: auto; max-height: 40%; border-right: 0; border-left: 0; border-bottom: 1px solid var(--line); }
  .fd-preview__side { border-bottom: 0; border-top: 1px solid var(--line); }
  .fd-source__head { flex-wrap: wrap; }
}
`;

/** A sober stand-in for the host's `web/src/theme.css`.
 *
 * Deliberately plain: no elevation, no hover motion, no dark mode — none
 * of Studio's own chrome. The frame is showing somebody else's page in
 * somebody else's shell, and dressing it up would make the preview look
 * more finished than the evidence supports.
 *
 * The VALUES are the host's default look, which is Atlas light (the host
 * matches Atlas and defaults to light, as Atlas does): its background,
 * ink, card, border, input border, 12px cards, 7px controls, status
 * colours and Arial stack — including for `.mono`, because the host keeps
 * tabular digits in its sans. They are copied by hand, which is exactly why
 * the fidelity ledger's "Host shell" row stays ABSENT: this is a
 * resemblance, not the host's stylesheet, and the host's real rules
 * (spacing, typography scale, the sub-app's own banner region) are not
 * here. These are only the class names the generated page actually uses —
 * `emitters/web.ts` adds none of its own, because `web/src/subapps`
 * contains zero stylesheets (contract §9). `.fd-pin` is Studio's own
 * annotation, drawn over the page, and is the one rule that is not the
 * host's at all. */
export const HOST_FRAME_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font: 14px/1.55 Arial, Helvetica, "Segoe UI", sans-serif;
    color: #253d4b; background: ${FRAME_BG};
  }
  .page { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .page > h2 { margin: 0; font-size: 24px; font-weight: 500; letter-spacing: -0.6px; }
  .muted { color: #586e7c; margin: 0; }
  .mono { font-family: Arial, Helvetica, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; }
  .card {
    background: #fff; border: 1px solid #d5dfe5; border-radius: 12px;
    padding: 18px 20px; display: flex; flex-direction: column; gap: 12px;
  }
  .card > h3 { margin: 0; font-size: 15px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #d5dfe5; }
  th {
    background: #e8eef1; color: #586e7c; font-weight: 600; font-size: 11px;
    text-transform: uppercase; letter-spacing: .6px;
  }
  form { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid #d5dfe5; padding-top: 14px; }
  form > h4 { margin: 0; font-size: 13px; font-weight: 600; }
  label { display: grid; grid-template-columns: 170px 1fr; gap: 10px; align-items: center; font-size: 13px; }
  label > span { color: #586e7c; }
  input[type="text"], input[type="number"], select {
    height: 36px; padding: 0 10px; border: 1px solid #bdcdd6; border-radius: 7px;
    font: inherit; color: inherit; background: #fff;
  }
  input:focus-visible, select:focus-visible { outline: none; border-color: #e98300; box-shadow: 0 0 0 3px #e9830080; }
  input[type="checkbox"] { justify-self: start; width: 16px; height: 16px; accent-color: #e98300; }
  button {
    align-self: flex-start; height: 36px; padding: 0 16px; border-radius: 7px;
    border: 1px solid #d5dfe5; background: #f3f6f7; color: inherit; font: inherit; font-weight: 500; cursor: pointer;
  }
  button:focus-visible { outline: 2px solid #e98300; outline-offset: 4px; }
  button[disabled] { opacity: .55; cursor: not-allowed; }
  .errorbox {
    background: #f9e7e4; border: 1px solid #e8bdb6; border-radius: 7px;
    padding: 10px 12px; font-size: 13px; color: #aa3122;
  }
  .okbox {
    background: #e5f3e8; border: 1px solid #b7dcc3; border-radius: 7px;
    padding: 10px 12px; font-size: 13px; color: #367956;
  }
  .errorbox code, .okbox code { display: block; margin-top: 4px; font-size: 11.5px; opacity: .85; word-break: break-all; }
  .fd-pin {
    display: flex; gap: 8px; align-items: flex-start;
    border-left: 3px solid #e98300; background: #fff0d9;
    border-radius: 0 7px 7px 0; padding: 8px 11px; font-size: 12.5px; color: #713f00;
  }
  .fd-pin--error { border-left-color: #aa3122; background: #f9e7e4; color: #8a2519; }
  .fd-pin__rule { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 600; }
`;
