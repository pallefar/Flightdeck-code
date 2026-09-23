/**
 * Where the standalone smoke gets its browser from — on whatever machine
 * `npm run standalone` runs on.
 *
 * ⚠ THIS USED TO BE TWO HARD-CODED `/opt/...` PATHS, true of one Linux
 * container and of nothing else: on a Mac the browser half died with
 * ERR_MODULE_NOT_FOUND before it rendered a page, so the "✅" for standalone
 * was never earned there. Playwright is not a dependency of this repo (adding
 * one is an owner call), so the machine says where it is:
 *
 *   PLAYWRIGHT_MODULE  path to playwright's index.mjs (or a package name).
 *                      Unset → a plain `import("playwright")`.
 *   PW_CHROMIUM_PATH   a Chromium executable to launch.
 *                      Unset → the installed Google Chrome (channel "chrome").
 *
 * Linux container: PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs
 *                  PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
 * Mac:             PLAYWRIGHT_MODULE=<any checkout's>/node_modules/playwright/index.mjs
 *
 * Nothing is downloaded at check time either way.
 */
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

/** @param {string | undefined} v */
const set = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {(specifier: string) => Promise<any>} [importer]
 */
export async function loadChromium(env = process.env, importer = (s) => import(s)) {
  const configured = set(env.PLAYWRIGHT_MODULE);
  const name = configured ?? "playwright";
  const specifier = isAbsolute(name) ? pathToFileURL(name).href : name;

  let mod;
  try {
    mod = await importer(specifier);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      (configured === undefined
        ? "Playwright is not importable here (it is not a dependency of this repo)."
        : `PLAYWRIGHT_MODULE=${configured} could not be imported.`) +
        " Set PLAYWRIGHT_MODULE to the path of an installed playwright's index.mjs," +
        " e.g. /opt/node22/lib/node_modules/playwright/index.mjs in the Linux container" +
        " or <checkout>/node_modules/playwright/index.mjs on a Mac." +
        ` (${why})`,
    );
  }

  const chromium = mod?.chromium ?? mod?.default?.chromium;
  if (chromium === undefined || typeof chromium.launch !== "function") {
    throw new Error(`${name} was imported but exports no chromium launcher — is it really playwright?`);
  }
  return chromium;
}

/** @param {Record<string, string | undefined>} [env] */
export function launchOptions(env = process.env) {
  const executablePath = set(env.PW_CHROMIUM_PATH);
  return executablePath !== undefined ? { executablePath, headless: true } : { channel: "chrome", headless: true };
}
