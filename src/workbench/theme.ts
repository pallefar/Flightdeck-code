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

/** Flightdeck's palette. The numbers are the product's, not invented here. */
export const TOKENS = {
  bg: "#07090d",
  surface: "#11161f",
  ink: "#eef2f7",
  muted: "#8b96a5",
  line: "#1f2733",
  accent: "#ff8200",
  green: "#2fd472",
  amber: "#ffc24b",
  red: "#ff5b4d",
} as const;

export const WORKBENCH_CSS = `
.fd-wb {
  --bg: ${TOKENS.bg};
  --surface: ${TOKENS.surface};
  --ink: ${TOKENS.ink};
  --muted: ${TOKENS.muted};
  --line: ${TOKENS.line};
  --accent: ${TOKENS.accent};
  --green: ${TOKENS.green};
  --amber: ${TOKENS.amber};
  --red: ${TOKENS.red};
  --r-lg: 18px;
  --r-md: 14px;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;

  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(300px, 30%) 1fr;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  overflow: hidden;
}
.fd-wb *, .fd-wb *::before, .fd-wb *::after { box-sizing: border-box; }

/* Every number in this UI is a quantity you compare against another
   quantity — line counts, findings, statuses. Proportional digits make
   columns of them jitter. */
.fd-wb .mono, .fd-wb code, .fd-wb pre { font-family: var(--mono); font-variant-numeric: tabular-nums; }

.fd-wb button {
  font: inherit; color: inherit; background: none; border: 0; cursor: pointer;
  border-radius: 9px; padding: 6px 10px;
}
.fd-wb button:focus-visible, .fd-wb [tabindex]:focus-visible, .fd-wb input:focus-visible,
.fd-wb textarea:focus-visible, .fd-wb select:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}

/* ── chat ─────────────────────────────────────────────────────────── */
.fd-chat { display: flex; flex-direction: column; border-right: 1px solid var(--line); min-width: 0; }
.fd-chat__head {
  display: flex; align-items: baseline; gap: 10px;
  padding: 16px 18px; border-bottom: 1px solid var(--line);
}
.fd-chat__title { font-weight: 640; letter-spacing: -0.01em; }
.fd-chat__sub { color: var(--muted); font-size: 12px; }
.fd-chat__log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }

.fd-turn { display: flex; flex-direction: column; gap: 6px; }
.fd-turn__who { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.fd-turn__body {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md);
  padding: 11px 13px; white-space: pre-wrap; word-break: break-word;
}
.fd-turn--you .fd-turn__body { background: #161d28; }
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
  border: 1px solid var(--line); border-radius: 999px; padding: 4px 11px 4px 9px;
  background: var(--surface); font-size: 12px;
}
.fd-roundchip[aria-pressed="true"] { border-color: var(--accent); }
.fd-roundchip__n { font-family: var(--mono); color: var(--muted); }

.fd-composer { border-top: 1px solid var(--line); padding: 12px; display: flex; gap: 8px; align-items: flex-end; }
.fd-composer textarea {
  flex: 1; resize: none; min-height: 62px; max-height: 190px;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px 12px; font: inherit;
}
.fd-composer textarea::placeholder { color: var(--muted); }
.fd-composer__send { background: var(--accent); color: #140a00; font-weight: 640; padding: 9px 15px; }
.fd-composer__send:disabled { background: var(--line); color: var(--muted); cursor: not-allowed; }

/* ── main pane ────────────────────────────────────────────────────── */
.fd-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.fd-tabs {
  display: flex; align-items: center; gap: 4px;
  padding: 10px 14px; border-bottom: 1px solid var(--line); flex: 0 0 auto;
}
.fd-tab { color: var(--muted); display: inline-flex; align-items: center; gap: 7px; }
.fd-tab[aria-selected="true"] { color: var(--ink); background: var(--surface); }
.fd-tab__count {
  font-family: var(--mono); font-size: 11px; padding: 1px 6px; border-radius: 999px;
  background: var(--line); color: var(--ink);
}
.fd-tab__count--error { background: var(--red); color: #260603; }
.fd-tab__count--warn { background: var(--amber); color: #2a1d00; }
.fd-tabs__spacer { flex: 1; }
.fd-tabs__id { font-family: var(--mono); font-size: 12px; color: var(--muted); }

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
  border-right: 1px solid var(--line); padding: 8px 0;
}
.fd-tree__row {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 4px 12px; border-radius: 0; text-align: left; min-width: 0;
}
.fd-tree__row:hover { background: #151c27; }
.fd-tree__row[aria-current="true"] { background: #1a2331; box-shadow: inset 2px 0 0 var(--accent); }
.fd-tree__row--dim { opacity: 0.38; }
.fd-tree__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-tree__tier { display: block; padding: 12px 12px 5px; }
.fd-tree__tierlabel {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); display: flex; align-items: center; gap: 7px;
}
.fd-tree__tierblurb { font-size: 11px; color: #5f6a79; padding-top: 3px; line-height: 1.4; }
.fd-tree__tier--edit .fd-tree__tierlabel { color: var(--amber); }
.fd-tree__twisty { color: var(--muted); width: 10px; flex: 0 0 auto; font-size: 10px; }
.fd-delta { font-family: var(--mono); font-size: 11px; flex: 0 0 auto; }
.fd-delta__add { color: var(--green); }
.fd-delta__del { color: var(--red); }
.fd-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.fd-dot--error { background: var(--red); }
.fd-dot--warning { background: var(--amber); }

/* ── source and diff ──────────────────────────────────────────────── */
.fd-source { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.fd-source__head {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  border-bottom: 1px solid var(--line); flex: 0 0 auto;
}
.fd-source__path { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.fd-source__path b { color: var(--ink); font-weight: 600; }
.fd-code { flex: 1; overflow: auto; font-family: var(--mono); font-size: 12.5px; line-height: 1.6; }
.fd-code table { border-collapse: collapse; width: 100%; }
.fd-code td { padding: 0 10px; vertical-align: top; white-space: pre; }
.fd-code .fd-ln {
  width: 1%; text-align: right; color: #4d5766; user-select: none;
  position: sticky; left: 0; background: var(--bg);
}
.fd-code tr[data-finding] { background: rgba(255, 91, 77, 0.09); }
.fd-code tr[data-finding="warning"] { background: rgba(255, 194, 75, 0.09); }

.fd-hunk__head {
  font-family: var(--mono); font-size: 11.5px; color: var(--muted);
  padding: 6px 12px; background: #0d1119; border-top: 1px solid var(--line);
  position: sticky; top: 0;
}
.fd-op--add { background: rgba(47, 212, 114, 0.1); }
.fd-op--remove { background: rgba(255, 91, 77, 0.1); }
.fd-op--add .fd-sign { color: var(--green); }
.fd-op--remove .fd-sign { color: var(--red); }
.fd-sign { width: 1%; padding-left: 8px !important; padding-right: 4px !important; user-select: none; }
.fd-seg { border-radius: 3px; }
.fd-op--add .fd-seg { background: rgba(47, 212, 114, 0.26); }
.fd-op--remove .fd-seg { background: rgba(255, 91, 77, 0.26); }

.fd-changes { width: 320px; flex: 0 0 auto; overflow-y: auto; border-right: 1px solid var(--line); padding: 8px 0; }
.fd-note {
  margin: 10px 14px; padding: 9px 12px; border-radius: var(--r-md);
  border: 1px solid var(--line); background: var(--surface); color: var(--muted); font-size: 12.5px;
}
.fd-note--warn { border-color: var(--amber); }

/* ── gate ─────────────────────────────────────────────────────────── */
.fd-gate { flex: 1; overflow-y: auto; padding: 18px 20px; }
.fd-gate__summary { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.fd-stat {
  border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface);
  padding: 10px 14px; min-width: 116px;
}
.fd-stat__n { font-family: var(--mono); font-size: 22px; line-height: 1.15; }
.fd-stat__k { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.fd-stat--error .fd-stat__n { color: var(--red); }
.fd-stat--warn .fd-stat__n { color: var(--amber); }
.fd-stat--ok .fd-stat__n { color: var(--green); }

.fd-finding {
  display: grid; grid-template-columns: auto 1fr; gap: 3px 12px;
  border: 1px solid var(--line); border-left-width: 3px; border-radius: var(--r-md);
  background: var(--surface); padding: 11px 13px; margin-bottom: 8px; width: 100%; text-align: left;
}
.fd-finding--error { border-left-color: var(--red); }
.fd-finding--warning { border-left-color: var(--amber); }
.fd-finding__rule { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.fd-finding__msg { grid-column: 2; }
.fd-finding__where { grid-column: 2; font-family: var(--mono); font-size: 11.5px; color: var(--accent); }
.fd-finding__ev {
  grid-column: 1 / -1; font-family: var(--mono); font-size: 11.5px; color: var(--muted);
  background: #0c1017; border-radius: 8px; padding: 6px 9px; margin-top: 5px;
  overflow-x: auto; white-space: pre;
}
.fd-filter { display: flex; gap: 4px; margin: 14px 0 12px; }
.fd-filter button { font-size: 12px; color: var(--muted); border: 1px solid var(--line); }
.fd-filter button[aria-pressed="true"] { color: var(--ink); border-color: var(--accent); }

/* ── preview ──────────────────────────────────────────────────────── */
.fd-preview { flex: 1; display: flex; min-width: 0; min-height: 0; }
.fd-preview__stage { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.fd-preview__bar {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--line); flex: 0 0 auto;
}
.fd-toggle { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); cursor: pointer; }
.fd-toggle input { accent-color: var(--accent); }
.fd-toggle--off { color: var(--amber); }
.fd-preview__frame { flex: 1; min-height: 0; border: 0; width: 100%; background: #f6f7f9; }
.fd-preview__side {
  width: 340px; flex: 0 0 auto; border-left: 1px solid var(--line);
  overflow-y: auto; padding: 14px;
}
.fd-side__h {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); margin: 16px 0 8px;
}
.fd-side__h:first-child { margin-top: 0; }
.fd-ledger { display: flex; flex-direction: column; gap: 7px; }
.fd-ledger__row { display: grid; grid-template-columns: 62px 1fr; gap: 10px; align-items: start; }
.fd-ledger__tag {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  border-radius: 999px; padding: 2px 7px; text-align: center; border: 1px solid;
}
.fd-ledger__tag--real { color: var(--green); border-color: rgba(47, 212, 114, 0.4); }
.fd-ledger__tag--mocked { color: var(--amber); border-color: rgba(255, 194, 75, 0.4); }
.fd-ledger__tag--absent { color: var(--muted); border-color: var(--line); }
.fd-ledger__aspect { font-weight: 560; }
.fd-ledger__note { color: var(--muted); font-size: 12px; line-height: 1.45; }

.fd-log { font-family: var(--mono); font-size: 11.5px; display: flex; flex-direction: column; gap: 6px; }
.fd-log__row { display: grid; grid-template-columns: 36px 1fr; gap: 8px; }
.fd-log__status--ok { color: var(--green); }
.fd-log__status--refused { color: var(--amber); }
.fd-log__status--error { color: var(--red); }
.fd-log__why { grid-column: 2; color: var(--muted); font-family: inherit; font-size: 11px; }

.fd-blocked {
  margin: auto; max-width: 520px; padding: 26px;
  display: flex; flex-direction: column; gap: 12px; text-align: left;
}
.fd-blocked__icon { font-size: 26px; }
.fd-blocked__title { font-size: 17px; font-weight: 640; }
.fd-blocked__why { color: var(--muted); line-height: 1.55; }
.fd-blocked__next {
  border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: var(--r-md); background: var(--surface); padding: 11px 13px; color: var(--ink);
}
.fd-blocked__list { font-family: var(--mono); font-size: 12px; color: var(--muted); margin: 0; padding-left: 18px; }

/* ── the run ──────────────────────────────────────────────────────── */
.fd-ticker {
  display: flex; align-items: baseline; gap: 9px; margin: 0;
  padding: 8px 14px; border-top: 1px solid var(--line);
  color: var(--muted); font-size: 12.5px;
}
.fd-ticker__n { color: var(--accent); }
.fd-ticker__detail { color: #5f6a79; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.fd-stop {
  background: transparent; color: var(--red); border: 1px solid var(--red);
  font-weight: 600; padding: 9px 15px;
}
.fd-stop:disabled { color: var(--muted); border-color: var(--line); cursor: progress; }

.fd-run { flex: 1; overflow-y: auto; padding: 16px 20px; min-width: 0; }
.fd-run__head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.fd-runstatus {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em;
  border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; color: var(--muted);
}
.fd-runstatus--running { color: var(--accent); border-color: rgba(255, 130, 0, 0.45); }
.fd-runstatus--succeeded { color: var(--green); border-color: rgba(47, 212, 114, 0.4); }
.fd-runstatus--failed { color: var(--red); border-color: rgba(255, 91, 77, 0.45); }
.fd-runstatus--aborted { color: var(--amber); border-color: rgba(255, 194, 75, 0.4); }
.fd-run__count { color: var(--muted); font-size: 12px; }
.fd-run__failed { color: var(--red); font-size: 12px; }

.fd-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.fd-step {
  border: 1px solid var(--line); border-left-width: 3px; border-radius: var(--r-md);
  background: var(--surface); padding: 9px 12px;
}
.fd-step--queued { opacity: 0.55; }
.fd-step--running { border-left-color: var(--accent); }
.fd-step--succeeded { border-left-color: rgba(47, 212, 114, 0.55); }
.fd-step--failed { border-left-color: var(--red); }
.fd-step--aborted { border-left-color: var(--amber); }
.fd-step__head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.fd-step__pill {
  font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em;
  border-radius: 999px; padding: 2px 8px; border: 1px solid var(--line); color: var(--muted);
  flex: 0 0 auto; min-width: 66px; text-align: center;
}
.fd-step__pill--running { color: var(--accent); border-color: rgba(255, 130, 0, 0.45); }
.fd-step__pill--succeeded { color: var(--green); border-color: rgba(47, 212, 114, 0.4); }
.fd-step__pill--failed { background: var(--red); color: #260603; border-color: var(--red); }
.fd-step__pill--aborted { color: var(--amber); border-color: rgba(255, 194, 75, 0.4); }
.fd-step__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-step__detail { color: var(--muted); font-size: 11.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-step__exit, .fd-step__ms { color: var(--muted); font-size: 11px; flex: 0 0 auto; }
.fd-step__toggle { color: var(--muted); font-size: 11.5px; padding: 2px 7px; flex: 0 0 auto; }
.fd-step__error { margin: 7px 0 0; color: var(--red); font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; }
.fd-step__error--quiet { color: var(--muted); }
.fd-step__log {
  margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px;
  max-height: 340px; overflow: auto;
}
.fd-step__log pre {
  margin: 0; font-family: var(--mono); font-size: 11.5px; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word; color: #b9c3d0;
}
.fd-step__dropped { margin: 0 0 6px; color: var(--amber); font-size: 11.5px; }
.fd-out--err { color: var(--red); }

/* ── editing ──────────────────────────────────────────────────────── */
.fd-tabs__edits {
  font-size: 11px; color: var(--muted); border: 1px solid var(--line);
  border-radius: 999px; padding: 2px 9px; flex: 0 0 auto;
}
.fd-tabs__edits--conflict { color: var(--amber); border-color: rgba(255, 194, 75, 0.45); }
.fd-tree__lock { color: var(--muted); font-size: 10px; flex: 0 0 auto; }
.fd-tree__draft { font-size: 9px; flex: 0 0 auto; }
.fd-tree__draft--dirty { color: var(--accent); }
.fd-tree__draft--saved { color: var(--green); }
.fd-tree__draft--conflicted { color: var(--amber); }

.fd-dirty { color: var(--accent); font-size: 11.5px; flex: 0 0 auto; }
.fd-edited { color: var(--green); font-size: 11.5px; flex: 0 0 auto; }
.fd-lockmark { color: var(--muted); font-size: 11.5px; flex: 0 0 auto; }
.fd-modes { display: inline-flex; gap: 2px; border: 1px solid var(--line); border-radius: 9px; padding: 1px; }
.fd-modes button { font-size: 11.5px; padding: 3px 9px; color: var(--muted); border-radius: 7px; }
.fd-modes button[aria-pressed="true"] { color: var(--ink); background: #1a2331; }
.fd-lockbtn { font-size: 11.5px; color: var(--muted); border: 1px solid var(--line); padding: 3px 9px; }
.fd-lockbtn[aria-pressed="true"] { color: var(--amber); border-color: rgba(255, 194, 75, 0.45); }
.fd-save { font-size: 11.5px; background: var(--accent); color: #140a00; font-weight: 640; padding: 4px 11px; }
.fd-revert { font-size: 11.5px; color: var(--muted); border: 1px solid var(--line); padding: 3px 9px; }

.fd-editor {
  flex: 1; min-height: 0; width: 100%; resize: none;
  background: var(--bg); color: var(--ink); border: 0; border-top: 1px solid var(--line);
  padding: 10px 14px; font-family: var(--mono); font-size: 12.5px; line-height: 1.6;
  tab-size: 2;
}
.fd-source__foot {
  border-top: 1px solid var(--line); padding: 8px 16px; flex: 0 0 auto;
}

.fd-conflict {
  margin: 12px 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 9px;
  border: 1px solid var(--amber); border-left-width: 3px; border-radius: var(--r-md);
  background: rgba(255, 194, 75, 0.06);
}
.fd-conflict__head { display: flex; flex-direction: column; gap: 4px; }
.fd-conflict__why { color: var(--muted); font-size: 12.5px; }
.fd-conflict__stat { margin: 0; font-size: 12px; color: var(--muted); }
.fd-conflict__acts { display: flex; gap: 8px; flex-wrap: wrap; }
.fd-conflict__acts button { border: 1px solid var(--line); font-size: 12.5px; background: var(--surface); }
.fd-conflict__acts button:first-child { border-color: var(--amber); color: var(--amber); }
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
