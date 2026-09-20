/**
 * The browser half of `standalone-smoke.sh`.
 *
 * Asserting that a bundle BUILDS is not asserting that a page RENDERS. This
 * loads the built app in Chromium, fails on any console error or page error,
 * and checks three things a build cannot tell you: the sub-app's own data
 * reached the DOM, the stylesheet the harness emits is actually applied, and
 * the "this is not the host" banner is visible to whoever is looking at it.
 *
 * Playwright and Chromium are preinstalled in this environment; the paths are
 * explicit so nothing is downloaded at check time.
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const url = process.argv[2];
if (url === undefined) {
  process.stderr.write("usage: node standalone-smoke.mjs <url>\n");
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

const failures = [];
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(1500);

  const text = await page.locator("body").innerText();
  const title = await page.title();

  // 1. The page rendered something, not a white screen with a mount node.
  if (text.trim().length < 50) failures.push(`page rendered ${text.trim().length} chars — effectively blank`);

  // 2. The sub-app's OWN route supplied data that reached the DOM. This is
  //    the whole claim: the page fetched through ROUTE_PREFIX, unchanged,
  //    and a standalone adapter answered it.
  const tickets = ["TE-4711", "TE-4712"].filter((t) => text.includes(t));
  if (tickets.length !== 2) failures.push(`expected both seeded tickets in the DOM, found ${JSON.stringify(tickets)}`);

  // 3. The harness's stylesheet is applied — the page ships none of its own,
  //    so an unstyled render means theme.css did not load or does not match.
  const card = await page.evaluate(() => {
    const el = document.querySelector(".card");
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return { radius: cs.borderRadius, padding: cs.paddingTop };
  });
  if (card === null) failures.push("no .card in the DOM — the page did not render its panels");
  else if (card.radius === "0px") failures.push(`.card has no border-radius — theme.css is not applied (${JSON.stringify(card)})`);

  // 4. Nobody should be able to look at this and think the host's gates ran.
  if (!text.includes("standalone")) failures.push("the standalone banner is not visible on the page");

  // 5. A console error is a failure, not a warning.
  if (consoleErrors.length > 0) failures.push(`console errors: ${JSON.stringify(consoleErrors.slice(0, 4))}`);

  process.stdout.write(
    JSON.stringify({ title, chars: text.trim().length, tickets, card, consoleErrors }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}

if (failures.length > 0) {
  for (const f of failures) process.stderr.write(`  browser: ${f}\n`);
  process.exit(1);
}
