/**
 * Does the workbench fit the window it is drawn in — at every width, in
 * every view, in both themes?
 *
 * ⚠ WHY THIS IS A BROWSER CHECK AND NOT A UNIT TEST. The defect it pins was
 * invisible to every assertion over markup and CSS text: between Atlas's
 * 540px phone tier and roughly 1180px the topbar (five view tabs, Download
 * candidate, the round line and the theme switch) is wider than the main
 * pane, so `.fd-wb` — `overflow: hidden`, but still a scroll container —
 * was 1128px wide in a 768px window and 1158px in a 1100px one, and the theme
 * switch sat off the right edge where nobody could reach it. Files and Diff
 * spilled the same way through `.fd-source__head`. Only layout can say
 * whether something fits, so this asks a real layout engine, and asks about
 * BEHAVIOUR (does the workbench scroll sideways, can the toggle be reached)
 * rather than about which grid string or media query produced it.
 *
 * It serves the workbench itself (Vite, on a port the OS picks — never one
 * of the machine's live apps) and drives it headless. Playwright and Chrome
 * come from the machine, as for `npm run standalone`: PLAYWRIGHT_MODULE and
 * PW_CHROMIUM_PATH — see ./playwright-resolve.mjs.
 *
 * ⚠ AND IT FITS DOWNWARDS TOO. The first cut of the tablet tier stacked the
 * file tree and the change list above the code, as the phone tier does, and
 * checked only the sideways fit — so it shipped a `.fd-source` that grew to
 * its content: `.fd-code` never got a bounded height, never scrolled, and a
 * file's last lines sat at y = 1601 in a 700px window, clipped by `.fd-wb`'s
 * overflow:hidden, out of reach. Typing in the editor then scrolled `.fd-wb`
 * itself 58px up, the view tabs with it. So each step also asks: is `.fd-wb`
 * unscrolled, does `.fd-main` hold its content, and — in Files and Diff —
 * can the code be scrolled until its last line is on screen? And once per
 * width the editor is opened and typed in, and asked the same.
 *
 * Exit 0: every width fits. Exit 1: something does not; each failure names
 * the width, the theme, the view and the numbers. Exit 2: could not run.
 */
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { launchOptions, loadChromium } from "./playwright-resolve.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

/** Between the phone tier (<= 540) and the desktop layout. 768 and 1100 are
 * the widths the defect was measured at; the rest cover the whole band,
 * including both edges of every tier. 1440 is the desktop reference width and
 * has to keep fitting too. */
const WIDTHS = [541, 600, 700, 768, 800, 899, 900, 913, 959, 960, 1024, 1100, 1180, 1181, 1279, 1280, 1440];
const THEMES = ["light", "dark"];
/** The tablist's tabs, by the label each starts with. */
const VIEWS = ["Run", "Files", "Diff", "Preview", "Gate"];
/** From here up every view tab must be in full view without scrolling the
 * pill: an iPad held upright is 768px. Below it the pill may scroll inside
 * itself (never the workbench), as the phone tier's topbar does. */
const ALL_TABS_VISIBLE_FROM = 768;
/** A laptop-short window, where the stacked tiers have the least room; the
 * defect above was measured at 700. */
const HEIGHT = 700;
const THEME_STORAGE_KEY = "flightdeck-studio-theme"; // theme.ts THEME_STORAGE_KEY

let chromium;
try {
  chromium = await loadChromium();
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}

const server = await createServer({
  root: REPO,
  configFile: `${REPO}/vite.config.ts`,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
});
await server.listen();
const address = server.httpServer?.address();
if (address === null || address === undefined || typeof address === "string") {
  process.stderr.write("vite did not report a TCP port\n");
  await server.close();
  process.exit(2);
}
const url = `http://127.0.0.1:${address.port}/`;

/** Runs in the page. */
function measure() {
  const wb = document.querySelector(".fd-wb");
  const main = document.querySelector(".fd-main");
  const tabs = document.querySelector(".fd-tabs")?.getBoundingClientRect();
  // Scroll the code pane — only the code pane — to its end, and see where
  // its last row lands. A pane that cannot scroll leaves the row where it is.
  const code = document.querySelector(".fd-code");
  let lastRowBottom = null;
  let codeBottom = null;
  if (code !== null) {
    code.scrollTop = code.scrollHeight;
    const rows = code.querySelectorAll("tr");
    lastRowBottom = rows.length > 0 ? rows[rows.length - 1].getBoundingClientRect().bottom : null;
    codeBottom = code.getBoundingClientRect().bottom;
  }
  const toggle = document.querySelector(".fd-themetoggle");
  const r = toggle?.getBoundingClientRect();
  return {
    view: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
    scrollWidth: wb?.scrollWidth ?? -1,
    clientWidth: wb?.clientWidth ?? -1,
    scrollLeft: wb?.scrollLeft ?? -1,
    scrollTop: wb?.scrollTop ?? -1,
    mainScrollHeight: main?.scrollHeight ?? -1,
    mainClientHeight: main?.clientHeight ?? -1,
    tabsTop: tabs === undefined ? null : tabs.top,
    lastRowBottom,
    codeBottom,
    viewportHeight: window.innerHeight,
    toggleLeft: r === undefined ? null : r.left,
    toggleRight: r === undefined ? null : r.right,
    viewport: window.innerWidth,
    hiddenTabs: (() => {
      const group = document.querySelector(".fd-tabs__group")?.getBoundingClientRect();
      if (group === undefined) return ["(no tablist)"];
      return [...document.querySelectorAll('.fd-tabs__group [role="tab"]')]
        .filter((t) => {
          const r = t.getBoundingClientRect();
          return r.left < group.left - 0.5 || r.right > group.right + 0.5 || r.right > window.innerWidth + 0.5;
        })
        .map((t) => t.textContent?.trim() ?? "?");
    })(),
  };
}

const failures = [];
let checks = 0;
let failed = 0;
const browser = await chromium.launch(launchOptions());
try {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, colorScheme: theme });
      await ctx.addInitScript(([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {}
      }, [THEME_STORAGE_KEY, theme]);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      await page.waitForFunction(() => document.querySelectorAll(".fd-roundchip").length > 0, null, { timeout: 60_000 });
      await page.waitForTimeout(400);

      const steps = [["load", await page.evaluate(measure)]];
      for (const view of VIEWS) {
        await page.getByRole("tab", { name: new RegExp(`^${view}`) }).click();
        await page.waitForTimeout(600); // the tab indicator's 450ms slide
        steps.push([`after ${view}`, await page.evaluate(measure)]);
      }
      // The editor: Files, Edit, one character typed at the end of the text
      // (the caret there is what asked the browser to scroll into view).
      await page.getByRole("tab", { name: /^Files/ }).click();
      await page.waitForTimeout(600);
      await page.getByRole("group", { name: "Editor mode" }).getByRole("button", { name: "Edit" }).click();
      const editor = page.locator(".fd-editor");
      await editor.focus();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type("x");
      await page.waitForTimeout(200);
      steps.push(["editing in Files", await page.evaluate(measure)]);

      for (const [when, m] of steps) {
        checks += 1;
        const before = failures.length;
        const where = `${width}px ${theme} ${when}`;
        if (m.scrollWidth !== m.clientWidth || m.scrollLeft !== 0) {
          failures.push(`${where}: .fd-wb scrolls sideways — scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}, scrollLeft ${m.scrollLeft}`);
        }
        if (m.toggleRight === null) {
          failures.push(`${where}: no theme toggle rendered`);
        } else if (m.toggleRight > m.viewport + 0.5 || m.toggleLeft < -0.5) {
          failures.push(`${where}: theme toggle off-screen — ${Math.round(m.toggleLeft)}..${Math.round(m.toggleRight)} in a ${m.viewport}px window`);
        }
        if (m.scrollTop !== 0 || (m.tabsTop !== null && m.tabsTop < -0.5)) {
          failures.push(`${where}: .fd-wb scrolled vertically — scrollTop ${m.scrollTop}, view tabs at top ${m.tabsTop === null ? "?" : Math.round(m.tabsTop)}`);
        }
        if (m.mainScrollHeight > m.mainClientHeight) {
          failures.push(`${where}: .fd-main spills downwards — scrollHeight ${m.mainScrollHeight} vs clientHeight ${m.mainClientHeight}`);
        }
        // 1px, not 0.5: scrollTop is a whole number and the pane's top is
        // not (the heading's size is a vw clamp), so a row scrolled fully to
        // the end can still sit up to a pixel under the pane's edge.
        if (m.lastRowBottom !== null && (m.lastRowBottom > m.viewportHeight + 1 || m.lastRowBottom > m.codeBottom + 1)) {
          failures.push(`${where}: the code's last line cannot be scrolled into view — bottom ${Math.round(m.lastRowBottom)}, code pane ends ${Math.round(m.codeBottom)}, window ${m.viewportHeight}px`);
        }
        if (width >= ALL_TABS_VISIBLE_FROM && m.hiddenTabs.length > 0) {
          failures.push(`${where}: view tabs cut off by the pill — ${m.hiddenTabs.join(", ")}`);
        }
        if (failures.length > before) failed += 1;
      }
      for (const e of errors) failures.push(`${width}px ${theme}: pageerror ${e}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  process.stdout.write(`RESPONSIVE FAILS — ${failed} of ${checks} checks\n${failures.map((f) => `  ✗ ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`RESPONSIVE OK — ${checks} checks: ${WIDTHS.length} widths × ${THEMES.length} themes × (load + ${VIEWS.length} views + editing) at ${HEIGHT}px tall\n`);
