/**
 * `npm run standalone` must be runnable on a machine that is not the Linux
 * container it was written in. The browser half used to import Playwright and
 * launch Chromium from two hard-coded `/opt/...` paths, so on a Mac it died
 * with ERR_MODULE_NOT_FOUND before it looked at a single page.
 *
 * These pin the replacement: Playwright comes from `PLAYWRIGHT_MODULE` (or a
 * plain `playwright` import), Chromium from `PW_CHROMIUM_PATH` when set and
 * otherwise the installed Chrome — and a missing Playwright is a clear,
 * actionable error rather than a resolver stack trace.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { launchOptions, loadChromium } from "./playwright-resolve.mjs";

const fakeChromium = { launch: async () => ({}) };

describe("loadChromium", () => {
  it("imports PLAYWRIGHT_MODULE when it is set, as a file URL for an absolute path", async () => {
    const seen: string[] = [];
    const chromium = await loadChromium({ PLAYWRIGHT_MODULE: "/some dir/playwright/index.mjs" }, async (spec: string) => {
      seen.push(spec);
      return { chromium: fakeChromium };
    });
    expect(chromium).toBe(fakeChromium);
    expect(seen).toEqual(["file:///some%20dir/playwright/index.mjs"]);
  });

  it("falls back to a plain `playwright` import when PLAYWRIGHT_MODULE is unset or empty", async () => {
    for (const env of [{}, { PLAYWRIGHT_MODULE: "" }]) {
      const seen: string[] = [];
      await loadChromium(env, async (spec: string) => {
        seen.push(spec);
        return { chromium: fakeChromium };
      });
      expect(seen).toEqual(["playwright"]);
    }
  });

  it("accepts a CommonJS-shaped module whose chromium sits on the default export", async () => {
    const chromium = await loadChromium({}, async () => ({ default: { chromium: fakeChromium } }));
    expect(chromium).toBe(fakeChromium);
  });

  it("fails with an actionable message naming PLAYWRIGHT_MODULE when nothing resolves", async () => {
    const missing = async () => {
      throw Object.assign(new Error("Cannot find package 'playwright'"), { code: "ERR_MODULE_NOT_FOUND" });
    };
    await expect(loadChromium({}, missing)).rejects.toThrow(/PLAYWRIGHT_MODULE/);
    await expect(loadChromium({ PLAYWRIGHT_MODULE: "/nope/index.mjs" }, missing)).rejects.toThrow(/\/nope\/index\.mjs/);
  });

  it("refuses a module that has no chromium export instead of crashing later", async () => {
    await expect(loadChromium({}, async () => ({}))).rejects.toThrow(/chromium/);
  });
});

describe("launchOptions", () => {
  it("uses PW_CHROMIUM_PATH as the executable when it is set", () => {
    expect(launchOptions({ PW_CHROMIUM_PATH: "/opt/pw/chrome" })).toEqual({ executablePath: "/opt/pw/chrome", headless: true });
  });

  it("otherwise launches the installed Chrome channel, headless, and downloads nothing", () => {
    expect(launchOptions({})).toEqual({ channel: "chrome", headless: true });
    expect(launchOptions({ PW_CHROMIUM_PATH: "" })).toEqual({ channel: "chrome", headless: true });
  });
});

describe("standalone-smoke.mjs", () => {
  const source = readFileSync(fileURLToPath(new URL("./standalone-smoke.mjs", import.meta.url)), "utf8");

  it("hard-codes no container path for Playwright or Chromium", () => {
    expect(source).not.toMatch(/["']\/opt\//);
  });

  it("gets its browser through the resolver", () => {
    expect(source).toMatch(/from "\.\/playwright-resolve\.mjs"/);
    expect(source).toMatch(/loadChromium\(/);
    expect(source).toMatch(/launchOptions\(/);
  });
});
