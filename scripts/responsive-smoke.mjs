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
  const toggle = document.querySelector(".fd-themetoggle");
  const r = toggle?.getBoundingClientRect();
  return {
    view: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? null,
    scrollWidth: wb?.scrollWidth ?? -1,
    clientWidth: wb?.clientWidth ?? -1,
    scrollLeft: wb?.scrollLeft ?? -1,
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
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
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
process.stdout.write(`RESPONSIVE OK — ${checks} checks: ${WIDTHS.length} widths × ${THEMES.length} themes × load + ${VIEWS.length} views\n`);
