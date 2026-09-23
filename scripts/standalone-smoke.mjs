/**
 * The browser half of `standalone-smoke.sh`.
 *
 * Asserting that a bundle BUILDS is not asserting that a page RENDERS. This
 * loads the built app in Chromium, fails on any console error or page error,
 * and checks three things a build cannot tell you: the sub-app's own data
 * reached the DOM, the stylesheet the harness emits is actually applied, and
 * the "this is not the host" banner is visible to whoever is looking at it.
 *
 * Playwright and Chromium come from the machine, not from this repo:
 * PLAYWRIGHT_MODULE and PW_CHROMIUM_PATH — see ./playwright-resolve.mjs.
 * Nothing is downloaded at check time.
 */
import { launchOptions, loadChromium } from "./playwright-resolve.mjs";

const url = process.argv[2];
if (url === undefined) {
  process.stderr.write("usage: node standalone-smoke.mjs <url>\n");
  process.exit(2);
}

let chromium;
try {
  chromium = await loadChromium();
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
}
const browser = await chromium.launch(launchOptions());

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
  //
  //    ⚠ ONLY WHERE THE APP ACTUALLY LISTS CONTRACTS. The first version of
  //    this check required both seeded tickets from every app, which was true
  //    of the one spec it had been run against and false of a converted
  //    workflow whose rail files proposals and lists none. A check that
  //    encodes one fixture's shape fails correct apps — so ask the SERVER
  //    whether this app exposes the route, and require the DOM to agree only
  //    when it does.
  const health = await page.evaluate(async () => {
    const r = await fetch("/healthz");
    return r.ok ? await r.json() : null;
  });
  const prefix = health?.routePrefix ?? null;
  let tickets = [];
  let listed = null;
  if (prefix !== null) {
    listed = await page.evaluate(async (p) => {
      const r = await fetch(`${p}/contracts`);
      if (!r.ok) return null;
      const body = await r.json();
      return Array.isArray(body?.rows) ? body.rows.length : null;
    }, prefix);
  }
  let clicked = null;
  if (listed !== null && listed > 0) {
    tickets = ["TE-4711", "TE-4712"].filter((t) => text.includes(t));
    if (tickets.length !== 2) {
      // ⚠ NOT EVERY PAGE LOADS EAGERLY, and the second one tried does not.
      // A converted workflow renders a STEP RAIL whose steps are controls —
      // deliberately, because the emitted page "reports the order; it does
      // not enforce it" and never runs a step on your behalf. So the honest
      // end-to-end is to DO what a person would do: press the control and
      // check the data arrives. That exercises more of the path than an
      // eager fetch would, not less.
      const control = page
        .getByRole("button")
        .filter({ hasText: /load|contract folder/i })
        .first();
      if ((await control.count()) > 0) {
        clicked = (await control.textContent())?.trim() ?? "(unnamed control)";
        await control.click();
        await page.waitForTimeout(1500);
      }
      const after = await page.locator("body").innerText();
      tickets = ["TE-4711", "TE-4712"].filter((t) => after.includes(t));
      if (tickets.length !== 2) {
        failures.push(
          `the server lists ${listed} contract(s) but the DOM shows ${JSON.stringify(tickets)}` +
            (clicked === null
              ? " and no control offered to load them" 
              : ` even after pressing ${JSON.stringify(clicked)}`),
        );
      }
    }
  }

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
  //
  // ⚠ THIS ASSERTION USED TO READ `text.includes("standalone")` OVER THE WHOLE
  // BODY, AND IT NEVER ONCE TESTED THE BANNER. It passed on two of the three
  // apps because this script's own temp directory is named `standalone-tree`,
  // so the word appeared in the `dir` column of the DATA TABLE. The third app
  // loads its table on a click, so pre-click it had no path to accidentally
  // satisfy the check — and that is the only reason the hole ever surfaced.
  //
  // A check that a directory name can satisfy is not checking the page. So:
  // find the banner ELEMENT, and require the disclaimer it exists to carry.
  const banner = await page.evaluate(() => {
    const el = document.querySelector(".standalone-bar");
    return el === null ? null : el.textContent ?? "";
  });
  if (banner === null) {
    failures.push("no .standalone-bar element — nothing tells the viewer this is not the host");
  } else if (!/no RBAC/i.test(banner) || !/kill switch/i.test(banner)) {
    failures.push(`the banner does not carry the disclaimer: ${JSON.stringify(banner.slice(0, 120))}`);
  }

  // 5. A console error is a failure, not a warning.
  if (consoleErrors.length > 0) failures.push(`console errors: ${JSON.stringify(consoleErrors.slice(0, 4))}`);

  process.stdout.write(
    JSON.stringify({ title, banner, chars: text.trim().length, routePrefix: prefix, contractsListed: listed, tickets, loadedByPressing: clicked, card, consoleErrors }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}

if (failures.length > 0) {
  for (const f of failures) process.stderr.write(`  browser: ${f}\n`);
  process.exit(1);
}
