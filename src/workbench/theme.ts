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
 *    the host's stylesheet. Giving the frame Studio's own polished styling
 *    would be the prettiest lie on the screen.
 *
 * Keeping them apart in one file makes that contrast legible: the
 * workbench chrome is Flightdeck's visual language, the frame is a sober
 * stand-in for somebody else's. */

/** Atlas fallbacks only. Embedded Workbench never redeclares host tokens. */
export const TOKENS = {
  bg: "#f3f6f7",
  surface: "#fff",
  ink: "#253d4b",
  muted: "#586e7c",
  line: "#d5dfe5",
  accent: "#e98300",
  green: "#367956",
  amber: "#806620",
  red: "#aa3122",
} as const;

export const WORKBENCH_CSS = `
.fd-wb {
  box-sizing: border-box;
  --wb-bg: var(--bg, #f3f6f7);
  --wb-surface: var(--surface, #fff);
  --wb-surface2: var(--surface2, #f8fafb);
  --wb-ink: var(--ink, #253d4b);
  --wb-muted: var(--muted, #586e7c);
  --wb-line: var(--line, #d5dfe5);
  --wb-green: var(--green, #367956);
  --wb-amber: var(--amber, #806620);
  --wb-red: var(--red, #aa3122);
  --wb-shadow: var(--shadow, 0 4px 16px #233e4d09, 0 1px 3px #233e4d08);
  --accent: var(--te, #e98300);
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  position: relative;
  width: 100%;
  height: var(--fd-workbench-height, 100%);
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 28%) minmax(0, 1fr);
  background: var(--bg, #f3f6f7);
  color: var(--wb-ink);
  font: 13px/1.5 Arial, Helvetica, "Segoe UI", sans-serif;
  border: 1px solid var(--wb-line);
  border-radius: 10px;
  box-shadow: var(--wb-shadow);
  overflow: hidden;
  container-type: inline-size;
}
.fd-wb[data-external-chat="true"] { grid-template-columns: minmax(0, 1fr); }
.fd-wb *, .fd-wb *::before, .fd-wb *::after { box-sizing: border-box; }
.fd-wb [hidden] { display: none !important; }
.fd-wb .mono, .fd-wb code, .fd-wb pre { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.fd-wb button { font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer; border-radius: 5px; padding: 6px 10px; min-height: 30px; }
.fd-wb button, .fd-wb input, .fd-wb textarea { transition: background-color 160ms ease, border-color 160ms ease; }
.fd-wb button:disabled { cursor: not-allowed; opacity: .6; }
.fd-wb button:hover:not(:disabled) { background: var(--wb-surface2); }
.fd-wb button:focus-visible, .fd-wb [tabindex]:focus-visible, .fd-wb input:focus-visible, .fd-wb textarea:focus-visible, .fd-wb select:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.fd-wb input, .fd-wb textarea, .fd-wb select { accent-color: var(--accent); color: var(--wb-ink); }
.fd-wb .fd-chat-slot { display: flex; min-width: 0; min-height: 0; }
.fd-wb .fd-chat { display: flex; flex: 1; flex-direction: column; border-right: 1px solid var(--wb-line); min-width: 0; min-height: 0; }
.fd-wb .fd-chat__head { display: flex; align-items: baseline; gap: 10px; padding: 15px 16px; border-bottom: 1px solid var(--wb-line); }
.fd-wb .fd-chat__title { font-weight: 600; letter-spacing: -.02em; }
.fd-wb .fd-chat__sub { color: var(--wb-muted); font-size: 11px; }
.fd-wb .fd-chat__log { flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.fd-wb .fd-turn { display: flex; flex-direction: column; gap: 5px; }
.fd-wb .fd-turn__who { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--wb-muted); }
.fd-wb .fd-turn__body { border: 1px solid var(--wb-line); border-radius: 8px; background: var(--wb-surface); padding: 11px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.fd-wb .fd-turn--you .fd-turn__body { background: var(--wb-surface2); }
.fd-wb .fd-turn--refused .fd-turn__body { border-color: var(--wb-amber); }
.fd-wb .fd-turn--failed .fd-turn__body { border-color: var(--wb-red); }
.fd-wb .fd-turn__caret { display: inline-block; width: 5px; height: 1em; margin-left: 3px; background: var(--accent); vertical-align: text-bottom; }
.fd-wb .fd-roundchip { align-self: flex-start; display: inline-flex; gap: 7px; align-items: center; border: 1px solid var(--wb-line); border-radius: 6px; background: var(--wb-surface); font-size: 11px; }
.fd-wb .fd-roundchip[aria-pressed="true"] { border-color: var(--accent); }
.fd-wb .fd-roundchip__n { font-family: var(--mono); color: var(--wb-muted); }
.fd-wb .fd-composer { border-top: 1px solid var(--wb-line); padding: 12px; display: flex; gap: 7px; align-items: flex-end; }
.fd-wb .fd-composer textarea { flex: 1; min-width: 0; resize: none; min-height: 72px; max-height: 190px; border: 1px solid var(--wb-line); border-radius: 8px; background: var(--wb-surface); padding: 10px; font: inherit; }
.fd-wb .fd-composer textarea::placeholder { color: var(--wb-muted); }
.fd-wb .fd-composer__send, .fd-wb .fd-save { background: var(--accent); color: #201000; font-weight: 600; }
.fd-wb .fd-composer__send:hover:not(:disabled), .fd-wb .fd-save:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 85%, var(--wb-surface)); }
.fd-wb .fd-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.fd-wb .fd-artifact { display: flex; gap: 9px; align-items: center; padding: 4px 10px; background: var(--wb-surface); border-bottom: 1px solid var(--wb-line); flex: 0 0 auto; }
.fd-wb .fd-artifact__mark { width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--wb-line)); border-radius: 5px; background: color-mix(in srgb, var(--accent) 7%, var(--wb-surface)); color: var(--accent); font: 600 12px var(--mono); flex-shrink: 0; box-shadow: inset 0 -3px 0 color-mix(in srgb, var(--accent) 12%, transparent); }
.fd-wb .fd-artifact__identity { min-width: 0; }
.fd-wb .fd-artifact__eyebrow { display: block; font-size: 9px; line-height: 1.25; letter-spacing: .12em; color: var(--wb-muted); font-weight: 600; }
.fd-wb .fd-artifact__name { font-size: 14px; letter-spacing: -.035em; font-weight: 600; line-height: 1.4; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-wb .fd-artifact__facts { margin-left: auto; min-width: 0; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 5px 12px; color: var(--wb-muted); font-size: 10px; }
.fd-wb .fd-artifact__draft { border: 1px solid var(--wb-line); padding: 2px 7px; border-radius: 4px; white-space: nowrap; color: var(--wb-ink); background: var(--wb-surface2); }
.fd-wb .fd-command-bar { display: flex; align-items: stretch; min-width: 0; flex: 0 0 auto; border-bottom: 1px solid var(--wb-line); background: var(--wb-surface2); padding-right: 8px; gap: 8px; }
.fd-wb .fd-focus-source { align-self: center; flex: 0 0 auto; font-size: 11px; border: 1px solid var(--wb-line); min-width: 58px; padding: 4px 9px; background: var(--wb-surface); }
.fd-wb .fd-focus-source[aria-pressed="true"] { border-color: var(--accent); color: var(--wb-ink); background: color-mix(in srgb, var(--accent) 8%, var(--wb-surface)); }
.fd-wb .fd-tabs { display: flex; align-items: stretch; gap: 0; padding: 0 10px; flex: 1; min-width: 0; overflow-x: auto; }
.fd-wb .fd-tab { color: var(--wb-muted); border-radius: 0; display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 7px 13px; white-space: nowrap; font-size: 12px; border-bottom: 2px solid transparent; }
.fd-wb .fd-tab[aria-selected="true"] { color: var(--wb-ink); background: var(--wb-surface); border-bottom-color: var(--accent); }
.fd-wb .fd-tab__count { font: 10px var(--mono); min-width: 17px; text-align: center; padding: 2px 4px; border: 1px solid var(--wb-line); border-radius: 3px; color: var(--wb-muted); }
.fd-wb .fd-tab__count--error { color: var(--wb-red); background: color-mix(in srgb, var(--wb-red) 10%, var(--wb-surface)); }
.fd-wb .fd-tab__count--warn { color: var(--wb-amber); background: color-mix(in srgb, var(--wb-amber) 10%, var(--wb-surface)); }
.fd-wb .fd-tabs__spacer { flex: 1; }
.fd-wb .fd-tabs__id { font: 11px var(--mono); color: var(--wb-muted); }
.fd-wb .fd-body { flex: 1; min-width: 0; min-height: 0; display: flex; }
.fd-wb .fd-view { flex: 1; min-width: 0; min-height: 0; display: flex; overflow: hidden; }
.fd-wb .fd-workspace-status { display: flex; gap: 12px; align-items: center; border-top: 1px solid var(--wb-line); padding: 5px 12px; background: var(--wb-surface2); color: var(--wb-muted); font-size: 10px; flex: 0 0 auto; min-width: 0; }
.fd-wb .fd-workspace-status > :last-child { margin-left: auto; }
.fd-wb .fd-workspace-limit { margin-left: auto; }
.fd-wb .fd-workspace-status > :last-child:not(:first-child) { padding-left: 10px; border-left: 1px solid var(--wb-line); }
.fd-wb .fd-status-edits { display: flex; gap: 10px; color: var(--accent); }
.fd-wb .fd-tabs__edits--conflict { color: var(--wb-amber); }
.fd-wb .fd-empty { margin: auto; max-width: 440px; text-align: center; color: var(--wb-muted); display: flex; flex-direction: column; gap: 10px; padding: 24px; }
.fd-wb .fd-empty strong { color: var(--wb-ink); font-size: 18px; font-weight: 600; }
.fd-wb .fd-empty__mark { color: var(--accent); font: 26px var(--mono); }
.fd-wb .fd-files { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.fd-wb .fd-source-tabs { display: flex; gap: 0; background: var(--wb-bg); border-bottom: 1px solid var(--wb-line); flex: 0 0 auto; min-width: 0; overflow-x: auto; }
.fd-wb .fd-source-tabs button { border-radius: 0; min-height: 34px; white-space: nowrap; font-size: 11px; border-right: 1px solid var(--wb-line); padding: 7px 12px; color: var(--wb-muted); }
.fd-wb .fd-explorer-toggle { flex-shrink: 0; color: var(--wb-muted); }
.fd-wb .fd-explorer-toggle span { margin-right: 5px; }
.fd-wb .fd-source-tab[aria-pressed="true"] { box-shadow: inset 0 2px 0 var(--accent); background: var(--wb-surface); color: var(--wb-ink); }
.fd-wb .fd-source-tab__dot { color: var(--accent); padding-left: 7px; }
.fd-wb .fd-files__workspace { display: flex; flex: 1; min-width: 0; min-height: 0; }
.fd-wb .fd-explorer { width: 224px; min-width: 0; flex: 0 0 auto; display: flex; flex-direction: column; background: var(--wb-surface2); border-right: 1px solid var(--wb-line); }
.fd-wb .fd-explorer__search { padding: 11px 10px; border-bottom: 1px solid var(--wb-line); }
.fd-wb .fd-explorer__caption { display: flex; justify-content: space-between; gap: 8px; font: 9px var(--mono); letter-spacing: .09em; color: var(--wb-muted); margin-bottom: 8px; }
.fd-wb .fd-explorer__caption span { font: 10px Arial; letter-spacing: 0; }
.fd-wb .fd-explorer input { width: 100%; padding: 7px 9px; min-height: 32px; font: 11px Arial; border: 1px solid var(--wb-line); border-radius: 5px; background: var(--wb-surface); }
.fd-wb .fd-explorer__search > button { font-size: 11px; margin-top: 5px; }
.fd-wb .fd-tree { flex: 1; min-height: 0; overflow: auto; padding: 6px 0; }
.fd-wb .fd-tree__row { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 10px; border-radius: 0; text-align: left; min-width: 0; font-size: 11px; }

.fd-wb .fd-tree__row[data-received-highlight="true"] { background: color-mix(in srgb, var(--accent) 6%, var(--wb-surface)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 25%, var(--wb-line)); }
.fd-wb .fd-tree__row:hover { background: color-mix(in srgb, var(--accent) 4%, var(--wb-surface)); }
.fd-wb .fd-tree__row[aria-current="true"] { background: color-mix(in srgb, var(--accent) 7%, var(--wb-surface)); box-shadow: inset 2px 0 0 var(--accent); }
.fd-wb .fd-tree__row--dim { opacity: .5; }
.fd-wb .fd-tree__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-wb .fd-tree__tier { display: block; padding: 11px 10px 7px; border-bottom: 1px solid color-mix(in srgb, var(--wb-line) 50%, transparent); }
.fd-wb .fd-tree__tierlabel { font-size: 9px; text-transform: uppercase; letter-spacing: .09em; color: var(--wb-muted); display: flex; gap: 7px; align-items: center; }
.fd-wb .fd-tree__tierblurb { display: block; font-size: 10px; color: var(--wb-muted); padding-top: 4px; line-height: 1.4; }
.fd-wb .fd-tree__tier--edit .fd-tree__tierlabel { color: var(--wb-amber); }
.fd-wb .fd-tree__twisty { width: 10px; flex: 0 0 auto; color: var(--wb-muted); font-size: 9px; }
.fd-wb .fd-tree__lock, .fd-wb .fd-tree__draft { flex: 0 0 auto; font-size: 9px; }
.fd-wb .fd-tree__draft--dirty, .fd-wb .fd-dirty { color: var(--accent); }
.fd-wb .fd-tree__draft--saved, .fd-wb .fd-edited { color: var(--wb-green); }
.fd-wb .fd-tree__draft--conflicted { color: var(--wb-amber); }
.fd-wb .fd-delta { font: 10px var(--mono); flex: 0 0 auto; }
.fd-wb .fd-delta__add { color: var(--wb-green); }
.fd-wb .fd-delta__del { color: var(--wb-red); }
.fd-wb .fd-dot { width: 5px; height: 5px; border-radius: 50%; flex: 0 0 auto; }
.fd-wb .fd-dot--error { background: var(--wb-red); }
.fd-wb .fd-dot--warning { background: var(--wb-amber); }
.fd-wb .fd-source-slot { flex: 1; display: flex; min-width: 0; min-height: 0; }
.fd-wb .fd-source { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--wb-surface); }
.fd-wb .fd-source__head { display: flex; align-items: center; gap: 4px 8px; padding: 3px 10px; border-bottom: 1px solid var(--wb-line); flex: 0 0 auto; min-width: 0; background: var(--wb-surface); }
.fd-wb .fd-source__identity { display: flex; flex: 1; min-width: 0; gap: 8px; align-items: center; }
.fd-wb .fd-source__actions { display: flex; flex: 0 1 auto; gap: 8px; align-items: center; min-width: 0; max-width: 75%; overflow-x: auto; white-space: nowrap; scrollbar-width: thin; }
.fd-wb .fd-source__actions > * { flex-shrink: 0; }
.fd-wb .fd-source__actions .fd-tabs__spacer { display: none; }
.fd-wb .fd-source__path { flex: 1; min-width: 0; font: 11px/1.7 var(--mono); color: var(--wb-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-wb .fd-source__path b { color: var(--wb-ink); font-weight: 600; }
.fd-wb .fd-source-kind { font-size: 10px; color: var(--wb-muted); }
.fd-wb .fd-dirty, .fd-wb .fd-edited, .fd-wb .fd-lockmark { font-size: 10px; }
.fd-wb .fd-modes { display: inline-flex; gap: 1px; border: 1px solid var(--wb-line); border-radius: 5px; padding: 1px; }
.fd-wb .fd-modes button { font-size: 11px; padding: 3px 9px; min-height: 26px; color: var(--wb-muted); }
.fd-wb .fd-modes button[aria-pressed="true"] { color: var(--wb-ink); background: var(--wb-surface2); }
.fd-wb .fd-lockbtn, .fd-wb .fd-revert { font-size: 11px; border: 1px solid var(--wb-line); padding: 3px 8px; }
.fd-wb .fd-lockbtn[aria-pressed="true"] { color: var(--wb-amber); border-color: var(--wb-amber); }
.fd-wb .fd-save { font-size: 11px; padding: 4px 10px; }
.fd-wb .fd-editor { flex: 1; min-height: 0; width: 100%; resize: none; background: var(--wb-surface); color: var(--wb-ink); border: 0; border-radius: 0; padding: 12px 16px; font: 12px/1.7 var(--mono); tab-size: 2; }
.fd-wb .fd-code { flex: 1; min-height: 0; min-width: 0; overflow: auto; padding-block: 10px; font: 12px/1.7 var(--mono); }
.fd-wb .fd-code table { border-collapse: collapse; width: 100%; }
.fd-wb .fd-code td { padding: 0 12px; vertical-align: top; white-space: pre; }
.fd-wb .fd-code .fd-ln { width: 1%; text-align: right; color: var(--wb-muted); user-select: none; position: sticky; left: 0; background: var(--wb-surface2); border-right: 1px solid var(--wb-line); }
.fd-wb .fd-code tr[data-finding="error"] { background: color-mix(in srgb, var(--wb-red) 8%, var(--wb-surface)); }
.fd-wb .fd-code tr[data-finding="warning"] { background: color-mix(in srgb, var(--wb-amber) 8%, var(--wb-surface)); }
.fd-wb .fd-source__delta { color: var(--wb-muted); font-size: 10px; padding-inline: 6px; border-inline-start: 1px solid var(--wb-line); }
.fd-wb .fd-changes { width: 260px; min-width: 0; flex: 0 0 auto; overflow: auto; border-right: 1px solid var(--wb-line); padding: 6px 0; background: var(--wb-surface2); }
.fd-wb .fd-hunk__head { font: 11px var(--mono); color: var(--wb-muted); padding: 6px 12px; background: var(--wb-surface2); border-top: 1px solid var(--wb-line); position: sticky; top: 0; z-index: 1; }
.fd-wb .fd-op--add { background: color-mix(in srgb, var(--wb-green) 9%, var(--wb-surface)); }
.fd-wb .fd-op--remove { background: color-mix(in srgb, var(--wb-red) 8%, var(--wb-surface)); }
.fd-wb .fd-op--add .fd-sign { color: var(--wb-green); }
.fd-wb .fd-op--remove .fd-sign { color: var(--wb-red); }
.fd-wb .fd-sign { width: 1%; padding-left: 8px !important; padding-right: 4px !important; user-select: none; }
.fd-wb .fd-seg { border-radius: 2px; }
.fd-wb .fd-op--add .fd-seg { background: color-mix(in srgb, var(--wb-green) 20%, transparent); }
.fd-wb .fd-op--remove .fd-seg { background: color-mix(in srgb, var(--wb-red) 20%, transparent); }
.fd-wb .fd-note { margin: 10px 0; padding: 10px 12px; border: 1px solid var(--wb-line); border-radius: 6px; background: var(--wb-surface2); color: var(--wb-muted); font-size: 12px; overflow-wrap: anywhere; }
.fd-wb .fd-source > .fd-note { margin: 8px 12px; }
.fd-wb .fd-note--warn { border-left: 3px solid var(--wb-amber); }
.fd-wb .fd-gate, .fd-wb .fd-run { flex: 1; min-width: 0; overflow: auto; padding: 18px 20px; }
.fd-wb .fd-gate__summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; margin-bottom: 12px; border: 1px solid var(--wb-line); border-radius: 5px; overflow: hidden; }
.fd-wb .fd-stat { border-right: 1px solid var(--wb-line); background: var(--wb-surface); padding: 10px 12px; }
.fd-wb .fd-stat:last-child { border-right: 0; }
.fd-wb .fd-stat__n { font: 18px/1.2 var(--mono); }
.fd-wb .fd-stat__k { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: var(--wb-muted); margin-top: 5px; }
.fd-wb .fd-stat--error .fd-stat__n { color: var(--wb-red); }
.fd-wb .fd-stat--warn .fd-stat__n { color: var(--wb-amber); }
.fd-wb .fd-stat--ok .fd-stat__n { color: var(--wb-green); }
.fd-wb .fd-finding { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 3px 12px; width: 100%; text-align: left; border: 1px solid var(--wb-line); border-left-width: 3px; border-radius: 6px; background: var(--wb-surface); padding: 11px 12px; margin-bottom: 8px; }
.fd-wb .fd-finding--error { border-left-color: var(--wb-red); }
.fd-wb .fd-finding--warning { border-left-color: var(--wb-amber); }
.fd-wb .fd-finding__rule { font: 11px var(--mono); color: var(--wb-muted); }
.fd-wb .fd-finding__msg, .fd-wb .fd-finding__where { grid-column: 2; overflow-wrap: anywhere; }
.fd-wb .fd-finding__where { font: 10px var(--mono); color: var(--accent); }
.fd-wb .fd-finding__ev { grid-column: 1/-1; font: 11px var(--mono); color: var(--wb-muted); background: var(--wb-surface2); border-radius: 4px; padding: 7px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.fd-wb .fd-filter { display: flex; gap: 6px; flex-wrap: wrap; margin: 14px 0; }
.fd-wb .fd-filter button { font-size: 11px; color: var(--wb-muted); border: 1px solid var(--wb-line); }
.fd-wb .fd-filter button[aria-pressed="true"] { border-color: var(--accent); color: var(--wb-ink); }
.fd-wb .fd-preview { display: flex; flex: 1; min-width: 0; min-height: 0; }
.fd-wb .fd-preview__stage { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: linear-gradient(color-mix(in srgb, var(--wb-line) 35%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--wb-line) 35%, transparent) 1px, transparent 1px); background-size: 24px 24px; }
.fd-wb .fd-preview__bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 9px 12px; border-bottom: 1px solid var(--wb-line); background: var(--wb-surface); flex: 0 0 auto; }
.fd-wb .fd-preview__scope { margin: 0; padding: 7px 12px; background: var(--wb-surface2); color: var(--wb-muted); font-size: 11px; border-bottom: 1px solid var(--wb-line); }
.fd-wb .fd-toggle { display: inline-flex; gap: 5px; align-items: center; color: var(--wb-muted); font-size: 11px; cursor: pointer; }
.fd-wb .fd-toggle--off { color: var(--wb-amber); }
.fd-wb .fd-preview__frame { flex: 1; min-height: 0; width: 100%; border: 0; background: var(--wb-surface2); }
.fd-wb .fd-preview__side { width: 300px; flex: 0 0 auto; border-left: 1px solid var(--wb-line); overflow: auto; padding: 14px; background: var(--wb-surface); }
.fd-wb .fd-side__h { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: var(--wb-muted); margin: 18px 0 9px; }
.fd-wb .fd-side__h:first-child { margin-top: 0; }
.fd-wb .fd-ledger { display: flex; flex-direction: column; gap: 10px; }
.fd-wb .fd-ledger__row { display: grid; grid-template-columns: 56px minmax(0,1fr); gap: 9px; align-items: start; }
.fd-wb .fd-ledger__tag { font-size: 9px; letter-spacing: .02em; text-transform: uppercase; border: 1px solid; border-radius: 4px; padding: 2px 4px; text-align: center; }
.fd-wb .fd-ledger__tag--real { color: var(--wb-green); }
.fd-wb .fd-ledger__tag--mocked { color: var(--wb-amber); }
.fd-wb .fd-ledger__tag--absent { color: var(--wb-muted); border-color: var(--wb-line); }
.fd-wb .fd-ledger__aspect { font-weight: 600; font-size: 11px; }
.fd-wb .fd-ledger__note { color: var(--wb-muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.fd-wb .fd-log { font: 10px/1.5 var(--mono); display: flex; flex-direction: column; gap: 7px; overflow-wrap: anywhere; }
.fd-wb .fd-log__row { display: grid; grid-template-columns: 30px minmax(0,1fr); gap: 7px; }
.fd-wb .fd-log__status--ok { color: var(--wb-green); }
.fd-wb .fd-log__status--refused { color: var(--wb-amber); }
.fd-wb .fd-log__status--error { color: var(--wb-red); }
.fd-wb .fd-log__why { grid-column: 2; color: var(--wb-muted); }
.fd-wb .fd-blocked { margin: auto; max-width: 540px; padding: 24px; display: flex; flex-direction: column; gap: 12px; overflow-wrap: anywhere; }
.fd-wb .fd-blocked p { margin: 0; }
.fd-wb .fd-blocked__icon { font-size: 24px; color: var(--wb-amber); }
.fd-wb .fd-blocked__title { font-size: 18px; letter-spacing: -.025em; font-weight: 600; }
.fd-wb .fd-blocked__why { color: var(--wb-muted); font-size: 12px; }
.fd-wb .fd-blocked__next { border: 1px solid var(--wb-line); border-left: 3px solid var(--accent); background: var(--wb-surface); border-radius: 6px; padding: 12px; font-size: 12px; }
.fd-wb .fd-blocked__list { font: 11px var(--mono); color: var(--wb-muted); padding-left: 18px; margin: 0; }
.fd-wb .fd-ticker { display: flex; gap: 8px; margin: 0; padding: 8px 12px; border-top: 1px solid var(--wb-line); color: var(--wb-muted); font-size: 11px; }
.fd-wb .fd-ticker__n { color: var(--accent); }
.fd-wb .fd-ticker__detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-wb .fd-stop { border: 1px solid var(--wb-red); color: var(--wb-red); font-weight: 600; }
.fd-wb .fd-run__head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.fd-wb .fd-runstatus, .fd-wb .fd-step__pill { font: 10px var(--mono); text-transform: uppercase; border: 1px solid var(--wb-line); border-radius: 4px; padding: 3px 7px; color: var(--wb-muted); }
.fd-wb .fd-runstatus--running, .fd-wb .fd-step__pill--running { color: var(--accent); border-color: var(--accent); }
.fd-wb .fd-runstatus--succeeded, .fd-wb .fd-step__pill--succeeded { color: var(--wb-green); }
.fd-wb .fd-runstatus--failed, .fd-wb .fd-step__pill--failed { color: var(--wb-red); border-color: var(--wb-red); }
.fd-wb .fd-runstatus--aborted, .fd-wb .fd-step__pill--aborted { color: var(--wb-amber); }
.fd-wb .fd-run__count { color: var(--wb-muted); font-size: 11px; }
.fd-wb .fd-run__failed { color: var(--wb-red); font-size: 11px; }
.fd-wb .fd-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.fd-wb .fd-step { border: 1px solid var(--wb-line); border-left-width: 3px; border-radius: 6px; background: var(--wb-surface); padding: 10px 12px; }
.fd-wb .fd-step--queued { color: var(--wb-muted); }
.fd-wb .fd-step--running { border-left-color: var(--accent); }
.fd-wb .fd-step--succeeded { border-left-color: var(--wb-green); }
.fd-wb .fd-step--failed { border-left-color: var(--wb-red); }
.fd-wb .fd-step--aborted { border-left-color: var(--wb-amber); }
.fd-wb .fd-step__head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
.fd-wb .fd-step__label { font-size: 12px; min-width: 0; overflow-wrap: anywhere; }
.fd-wb .fd-step__detail, .fd-wb .fd-step__exit, .fd-wb .fd-step__ms { color: var(--wb-muted); font-size: 10px; overflow-wrap: anywhere; }
.fd-wb .fd-step__toggle { font-size: 10px; color: var(--wb-muted); }
.fd-wb .fd-step__error { margin: 8px 0 0; color: var(--wb-red); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.fd-wb .fd-step__error--quiet { color: var(--wb-muted); }
.fd-wb .fd-step__log { margin-top: 8px; border-top: 1px solid var(--wb-line); padding-top: 8px; max-height: 340px; overflow: auto; }
.fd-wb .fd-step__log pre { margin: 0; font: 11px/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.fd-wb .fd-step__dropped { margin: 0 0 5px; color: var(--wb-amber); font-size: 11px; }
.fd-wb .fd-out--err { color: var(--wb-red); }
.fd-wb .fd-conflict { margin: 10px 12px; padding: 12px; display: flex; flex-direction: column; gap: 9px; border: 1px solid var(--wb-amber); border-left-width: 3px; border-radius: 6px; background: var(--wb-surface2); }
.fd-wb .fd-conflict__head { display: flex; flex-direction: column; gap: 4px; }
.fd-wb .fd-conflict__why, .fd-wb .fd-conflict__stat { color: var(--wb-muted); font-size: 11px; margin: 0; overflow-wrap: anywhere; }
.fd-wb .fd-conflict__acts { display: flex; flex-wrap: wrap; gap: 7px; }
.fd-wb .fd-conflict__acts button { border: 1px solid var(--wb-line); font-size: 11px; background: var(--wb-surface); }
.fd-wb .fd-conflict__acts button:first-child { border-color: var(--wb-amber); color: var(--wb-amber); }
.fd-wb .fd-tour-slot { flex: 0 0 auto; min-width: 0; }
.fd-wb .fd-tour { position: relative; min-width: 0; border-bottom: 1px solid var(--wb-line); background: var(--wb-surface); }
.fd-wb .fd-tour__actions { display: flex; gap: 1px; align-items: center; min-width: 0; }
.fd-wb .fd-tour__modules-toggle { white-space: nowrap; font-size: 10px; color: var(--wb-muted); }
.fd-wb .fd-tour__modules-toggle[aria-expanded="true"] { color: var(--wb-ink); background: var(--wb-surface2); }
.fd-wb .fd-tour__bar { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 3px 10px; min-width: 0; }
.fd-wb .fd-tour__opener { font-size: 11px; font-weight: 600; white-space: nowrap; }
.fd-wb .fd-tour__opener > span { color: var(--accent); margin-right: 5px; }
.fd-wb .fd-tour__identity { min-width: 0; line-height: 1.5; }
.fd-wb .fd-tour__scope, .fd-wb .fd-tour__counts { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.fd-wb .fd-tour__scope { color: var(--wb-muted); }
.fd-wb .fd-tour__counts { color: var(--wb-ink); font-variant-numeric: tabular-nums; }
.fd-wb .fd-tour__transport { display: flex; gap: 2px; align-items: center; white-space: nowrap; }
.fd-wb .fd-tour__transport button { min-width: 30px; font-size: 11px; padding: 5px 8px; }
.fd-wb .fd-tour__play { border: 1px solid var(--wb-line); background: var(--wb-surface2); }
.fd-wb .fd-tour__arrival { display: flex; gap: 10px; margin: 0; padding: 4px 12px 7px; font-size: 10px; color: var(--wb-muted); overflow: hidden; pointer-events: none; animation: fd-source-enter 200ms ease both; }
.fd-wb .fd-tour__arrival span:first-child { color: var(--accent); white-space: nowrap; }
.fd-wb .fd-tour__arrival code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-wb .fd-tour__presentation { position: absolute; top: 100%; right: 0; z-index: 8; width: min(620px,100%); max-height: 160px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--wb-line); border-radius: 0 0 6px 6px; box-shadow: var(--wb-shadow); background: var(--wb-surface2); }
.fd-wb .fd-tour__counts { margin: 0; padding: 6px 12px; }
/* Original real-group sockets share the fixed receipt bar. Only their
   pointer-transparent faces move; opening the full inspection is explicit. */
.fd-wb .fd-tour__receipt { display: flex; align-items: center; gap: 5px; min-width: 0; height: 18px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.fd-wb .fd-receipt-piece { position: relative; min-width: 0; border: 1px dashed var(--wb-line); border-radius: 3px; flex: 0 0 auto; }
.fd-wb .fd-receipt-piece .fd-module__face { display: flex; gap: 5px; align-items: center; padding: 0 5px; font-size: 9px; line-height: 13px; white-space: nowrap; box-shadow: 0 1px 0 var(--wb-line); }
.fd-wb .fd-receipt-piece .fd-module__face::before { display: none; }
.fd-wb .fd-receipt-piece .fd-module__face::after { top: 3px; right: -3px; width: 4px; height: 6px; }
.fd-wb .fd-receipt-piece[data-module-state="socket"] .fd-module__face { opacity: .5; border-style: dashed; box-shadow: none; background: transparent; }
.fd-wb .fd-receipt-piece[data-module-state="arriving"] .fd-module__face { animation: fd-module-snap 200ms cubic-bezier(.18,.8,.3,1) both; }
.fd-wb .fd-receipt-piece[data-module-state="placed"] .fd-module__face { border-color: color-mix(in srgb, var(--accent) 45%, var(--wb-line)); box-shadow: 0 1px 0 color-mix(in srgb, var(--accent) 24%, var(--wb-line)); }
.fd-wb .fd-modules { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(120px, 1fr); gap: 9px; padding: 10px 12px 7px; overflow-x: auto; max-width: 850px; }
.fd-wb .fd-module { position: relative; padding: 2px; border: 1px dashed var(--wb-line); border-radius: 3px; min-width: 0; min-height: 54px; text-align: left; background: var(--wb-bg); }
.fd-wb .fd-module__face { position: relative; display: grid; gap: 1px; padding: 5px 9px 6px; border: 1px solid var(--wb-line); border-radius: 3px; background: var(--wb-surface); box-shadow: 0 3px 0 var(--wb-line); transform-origin: center bottom; pointer-events: none; }
.fd-wb .fd-module__face::after { content: ''; position: absolute; right: -4px; top: 17px; width: 6px; height: 10px; border: 1px solid var(--wb-line); background: var(--wb-surface); }
.fd-wb .fd-module__face::before { content: ''; position: absolute; left: 4px; top: 5px; bottom: 5px; width: 2px; border-block: 2px solid var(--wb-line); }
.fd-wb .fd-module__type { font: 8px var(--mono); letter-spacing: .08em; color: var(--wb-muted); }
.fd-wb .fd-module__face strong { font-size: 11px; font-weight: 600; line-height: 1.4; }
.fd-wb .fd-module__count { font-size: 9px; color: var(--wb-muted); }
.fd-wb .fd-module[data-module-state="socket"] .fd-module__face { opacity: .5; border-style: dashed; box-shadow: none; background: transparent; }
.fd-wb .fd-module[data-module-state="arriving"] .fd-module__face { animation: fd-module-snap 200ms cubic-bezier(.18,.8,.3,1) both; }
.fd-wb .fd-module[data-module-state="placed"] .fd-module__face { border-color: color-mix(in srgb, var(--accent) 45%, var(--wb-line)); box-shadow: 0 3px 0 color-mix(in srgb, var(--accent) 24%, var(--wb-line)); }
.fd-wb .fd-module[data-module-state="placed"] .fd-module__face::after { border-color: color-mix(in srgb, var(--accent) 50%, var(--wb-line)); }
.fd-wb .fd-modules__scope { margin: 1px 12px 5px; color: var(--wb-muted); font-size: 9px; }
.fd-wb .fd-tour__details { overflow: visible; padding: 5px 12px 10px; border-top: 1px solid var(--wb-line); background: var(--wb-surface2); font-size: 11px; }
.fd-wb .fd-tour__heading { display: flex; gap: 12px; align-items: center; }
.fd-wb .fd-tour__heading strong { font-size: 12px; min-width: 0; }
.fd-wb .fd-tour__heading > button { margin-left: auto; }
.fd-wb .fd-tour__heading .mono { color: var(--wb-muted); white-space: nowrap; }
.fd-wb .fd-tour__facts { padding-left: 16px; margin: 5px 0; color: var(--wb-ink); overflow-wrap: anywhere; }
.fd-wb .fd-tour__tip, .fd-wb .fd-tour__caution { margin: 5px 0; color: var(--wb-muted); overflow-wrap: anywhere; }
.fd-wb .fd-tour__tip b { color: var(--accent); margin-right: 5px; }
.fd-wb .fd-tour__references { display: flex; gap: 3px; flex-wrap: wrap; }
.fd-wb .fd-tour__references button { padding: 3px 7px; text-align: left; font-size: 10px; border: 1px solid var(--wb-line); overflow-wrap: anywhere; min-width: 0; }
.fd-wb .fd-tour__references code { overflow-wrap: anywhere; }
.fd-wb .fd-tour__replay { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; border-top: 1px solid var(--wb-line); margin-top: 8px; padding-top: 5px; }
.fd-wb .fd-tour__replay > span { flex: 1; color: var(--wb-muted); font-size: 10px; }
.fd-wb[data-tour-step="manifest"] [data-view="files"] .fd-source__head, .fd-wb[data-tour-step="server"] [data-view="files"] .fd-source__head { box-shadow: inset 0 2px 0 var(--accent); }
.fd-wb[data-tour-step="page"] .fd-preview__scope, .fd-wb[data-tour-step="section"] .fd-preview__scope { box-shadow: inset 0 2px 0 var(--accent); }
.fd-wb[data-tour-step="checks"] .fd-gate__summary { outline: 1px solid var(--accent); outline-offset: 2px; }
@container (max-width: 650px) {
  .fd-wb .fd-tour__bar { grid-template-columns: minmax(0,1fr) auto; gap: 0 5px; padding: 2px 8px 5px; }
  .fd-wb .fd-tour__actions { grid-column: 1 / -1; justify-content: space-between; }
  .fd-wb .fd-tour__transport button, .fd-wb .fd-tour__opener, .fd-wb .fd-tour__modules-toggle { min-height: 44px; min-width: 44px; }
  .fd-wb .fd-tour__identity { grid-row: 2; grid-column: 1; }
  .fd-wb .fd-tour__transport { grid-row: 2; grid-column: 2; }
  .fd-wb .fd-tour__scope, .fd-wb .fd-tour__counts { font-size: 9px; }
  .fd-wb .fd-tour__counts { white-space: normal; }
  .fd-wb .fd-tour__arrival > span:last-child { display: none; }
  .fd-wb .fd-tour__presentation { max-height: 160px; }
  .fd-wb .fd-modules { grid-auto-columns: minmax(98px,1fr); padding: 7px 8px 5px; gap: 6px; }
  .fd-wb .fd-tour__references button, .fd-wb .fd-tour__replay button, .fd-wb .fd-tour__heading button { min-height: 44px; }
}
.fd-wb[data-motion="off"] *, .fd-wb[data-motion="off"] *::before, .fd-wb[data-motion="off"] *::after, [data-motion="off"] .fd-wb *, [data-motionoff] .fd-wb * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }

@keyframes fd-source-enter { from { opacity: .4; } to { opacity: 1; } }
@keyframes fd-module-snap { 0% { opacity: .4; transform: translate(9px,-5px) rotate(-1.5deg); } 72% { opacity: 1; transform: translate(-1px,1px) rotate(0); } 100% { opacity: 1; transform: none; } }
@container (max-width: 900px) {
  .fd-wb .fd-artifact__facts { max-width: 45%; }
  .fd-wb .fd-preview { flex-direction: column; overflow: auto; }
  .fd-wb .fd-preview__stage { flex: 1 0 360px; min-height: 360px; }
  .fd-wb .fd-preview__side { width: 100%; border-left: 0; border-top: 1px solid var(--wb-line); overflow: visible; }
}
@container (max-width: 540px) {
  .fd-wb .fd-artifact { gap: 6px; padding: 6px 10px; flex-wrap: wrap; }
  .fd-wb .fd-artifact__name { font-size: 15px; }
  .fd-wb .fd-artifact__facts { max-width: none; width: 100%; margin: 0; justify-content: space-between; flex-wrap: nowrap; gap: 4px; font-size: 9px; }
  .fd-wb .fd-artifact__facts > .mono { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fd-wb .fd-tabs { padding: 0 6px; gap: 0; }
  .fd-wb .fd-command-bar { gap: 2px; padding-right: 5px; }
  .fd-wb .fd-tab { min-height: 44px; padding: 8px 8px; font-size: 11px; gap: 4px; }
  .fd-wb .fd-focus-source { min-height: 44px; min-width: 54px; padding: 5px 7px; }
  .fd-wb .fd-source-tabs button { min-height: 44px; }
  .fd-wb .fd-explorer { width: min(220px, 70%); }
  .fd-wb .fd-source__head { padding: 3px 10px; flex-wrap: wrap; }
  .fd-wb .fd-source__identity { flex-basis: 100%; }
  .fd-wb .fd-source__actions { flex-basis: 100%; max-width: 100%; }
  .fd-wb .fd-source-kind { flex-basis: auto; }
  .fd-wb .fd-source__head .fd-tabs__spacer { display: none; }
  .fd-wb .fd-source__head .fd-tabs__id { margin-left: auto; }
  .fd-wb .fd-source__head button { min-height: 44px; min-width: 44px; }
  .fd-wb .fd-gate, .fd-wb .fd-run { padding: 14px 12px; }
  .fd-wb .fd-gate__summary { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .fd-wb .fd-finding { grid-template-columns: minmax(0,1fr); }
  .fd-wb .fd-finding__msg, .fd-wb .fd-finding__where { grid-column: 1; }
  .fd-wb .fd-files:has(.fd-changes) { flex-direction: column; }
  .fd-wb .fd-changes { width: 100%; max-height: 160px; border-right: 0; border-bottom: 1px solid var(--wb-line); }
  .fd-wb .fd-workspace-status { flex-wrap: wrap; gap: 4px 8px; }
  .fd-wb .fd-workspace-limit { order: 3; flex-basis: 100%; margin-left: 0; }
  .fd-wb .fd-workspace-status > :last-child:not(:first-child) { border-left: 0; padding-left: 0; }
  .fd-wb .fd-blocked { padding: 18px; }
}
@media (max-width: 680px) {
  .fd-wb:not([data-external-chat="true"]) { grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(150px,32%) minmax(0,1fr); }
  .fd-wb .fd-chat { border-right: 0; border-bottom: 1px solid var(--wb-line); }
  .fd-wb .fd-chat__head { padding: 8px 12px; }
  .fd-wb .fd-chat__log { padding: 10px; }
  .fd-wb .fd-composer { padding: 8px; }
  .fd-wb .fd-composer textarea { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .fd-wb *, .fd-wb *::before, .fd-wb *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;

/** A sober stand-in for the host's `web/src/theme.css`.
 *
 * Deliberately plain, and deliberately NOT Flightdeck's palette. The frame
 * is showing somebody else's page in somebody else's shell; dressing it in
 * Studio's own styling would make the preview look more finished than the
 * evidence supports. These are only the class names the generated page
 * actually uses — `emitters/web.ts` adds none of its own, because
 * `web/src/subapps` contains zero stylesheets (contract §9). */
export const HOST_FRAME_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 22px;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #1d2430; background: #f6f7f9;
  }
  .page { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .page > h2 { margin: 0; font-size: 20px; }
  .muted { color: #6b7686; margin: 0; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
  .card {
    background: #fff; border: 1px solid #dfe3e9; border-radius: 10px;
    padding: 15px 16px; display: flex; flex-direction: column; gap: 11px;
  }
  .card > h3 { margin: 0; font-size: 15px; }
  .card[data-tour-highlight="true"] { outline: 2px solid #e98300; outline-offset: 2px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 9px; border-bottom: 1px solid #e8ebef; }
  th { color: #6b7686; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  form { display: flex; flex-direction: column; gap: 9px; border-top: 1px solid #e8ebef; padding-top: 12px; }
  form > h4 { margin: 0; font-size: 13px; }
  label { display: grid; grid-template-columns: 170px 1fr; gap: 10px; align-items: center; font-size: 13px; }
  label > span { color: #47505f; }
  input[type="text"], input[type="number"], select {
    padding: 6px 9px; border: 1px solid #cfd5dd; border-radius: 7px; font: inherit; background: #fff;
  }
  input[type="checkbox"] { justify-self: start; width: 16px; height: 16px; }
  button {
    align-self: flex-start; padding: 7px 14px; border-radius: 7px;
    border: 1px solid #c3cad3; background: #fff; font: inherit; cursor: pointer;
  }
  button[disabled] { opacity: .55; cursor: not-allowed; }
  .errorbox {
    background: #fdecea; border: 1px solid #f3b7b0; border-radius: 8px;
    padding: 9px 11px; font-size: 13px; color: #7d2019;
  }
  .okbox {
    background: #e9f8ef; border: 1px solid #a9dfc0; border-radius: 8px;
    padding: 9px 11px; font-size: 13px; color: #165c33;
  }
  .errorbox code, .okbox code { display: block; margin-top: 4px; font-size: 11.5px; opacity: .85; word-break: break-all; }
  .fd-pin {
    display: flex; gap: 8px; align-items: flex-start;
    border-left: 3px solid #d9822b; background: #fff7ed;
    border-radius: 0 8px 8px 0; padding: 8px 11px; font-size: 12.5px; color: #7a4a12;
  }
  .fd-pin--error { border-left-color: #d64a3c; background: #fdecea; color: #7d2019; }
  .fd-pin__rule { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 600; }
`;