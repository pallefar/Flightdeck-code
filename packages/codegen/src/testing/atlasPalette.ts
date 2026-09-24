/** The host's Atlas palette, as the host's own palette fence sees it.
 *
 * ⭐ WHY THIS EXISTS. Flightdeck OS moved its console to the Atlas palette and
 * fenced the old one out: `flightdeck/tests/atlasCategoricalPalette.test.ts`
 * scans every file under `web/src` and `server/` and fails on any of its
 * `FOREIGN_HEX` values. A generated sub-app lands in exactly those two trees,
 * and codegen's web module inlined four of them as `var(--token, #hex)`
 * fallbacks (`#ff8200 #2fd472 #ffc24b #ff5b4d`, the pre-Atlas dark palette).
 * `npm run mount` could not see it — it runs `tests/subapps/` only — so the
 * first place it showed was the host gate, on the promoted candidate.
 *
 * ⚠ PINNED HERE, CHECKED AGAINST THE HOST THERE. Studio's suite has to run
 * without a host checkout, so both lists are literals. When the host IS on
 * disk (`FLIGHTDECK_HOST_ROOT`), `atlas-palette.test.ts` re-reads them from
 * the host's own fence and theme.css and fails if either has moved. */
import fs from "node:fs";
import path from "node:path";
import { HOST_ROOT } from "../../../guardrails/src/host-source";

export const HOST_PALETTE_FENCE = path.join(HOST_ROOT, "flightdeck", "tests", "atlasCategoricalPalette.test.ts");
export const HOST_THEME_CSS = path.join(HOST_ROOT, "flightdeck", "web", "src", "theme.css");

/** `FOREIGN_HEX` from the host fence: Material-Palenight, the ad-hoc
 * ConfidenceTrend trio, and the neon pre-Atlas set. */
export const RETIRED_HEX: readonly string[] = [
  "#c792ea", "#64d8cb", "#f78c6c", "#82aaff", "#89ddff", "#ffcb6b",
  "#3f7fe0", "#1fae63", "#9aa3b5",
  "#ff8200", "#5aa7ff", "#2fd472", "#ffc24b", "#ff5b4d",
];

/** Atlas's DARK value for every host token a Studio page reads with a
 * literal fallback — what `[data-theme="dark"]` computes on <html> in the
 * host's theme.css. Dark, because the fallbacks always were the host's dark
 * values (web.ts says why); only the palette they are taken from moved. */
export const ATLAS_DARK: Readonly<Record<string, string>> = {
  "--bg": "#0e1720",
  "--surface": "#17242f",
  "--ink": "#eef2f7",
  "--muted": "#a7b6c3",
  "--line": "#304553",
  "--te": "#e98300",
  "--green": "#87c3a7",
  "--amber": "#c9b687",
  "--red": "#ff807d",
};

/** Retired hex values present in `src`, case-folded as the host fence folds. */
export function retiredHexIn(src: string): string[] {
  const lower = src.toLowerCase();
  return RETIRED_HEX.filter((hex) => lower.includes(hex));
}

/** Every `var(--token, #hex)` in `src`, as [token, hex]. */
export function hexFallbacksIn(src: string): Array<readonly [string, string]> {
  return [...src.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g)].map(
    (m) => [m[1]!, m[2]!.toLowerCase()] as const,
  );
}

export const hostPaletteAvailable = (): boolean => fs.existsSync(HOST_PALETTE_FENCE) && fs.existsSync(HOST_THEME_CSS);

/** The host fence's `FOREIGN_HEX`, read as source text. */
export function readHostRetiredHex(): string[] {
  const src = fs.readFileSync(HOST_PALETTE_FENCE, "utf8");
  const block = /const FOREIGN_HEX = \[([\s\S]*?)\];/.exec(src);
  if (block === null) throw new Error(`no FOREIGN_HEX in ${HOST_PALETTE_FENCE}`);
  return [...block[1]!.matchAll(/"(#[0-9a-fA-F]+)"/g)].map((m) => m[1]!.toLowerCase());
}

/** Effective dark-theme custom properties, read the way the host fence reads
 * them: later `:root` blocks win, and `[data-theme="dark"]` overlays them. */
export function readHostDarkTokens(): Record<string, string> {
  const css = fs.readFileSync(HOST_THEME_CSS, "utf8");
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  const collect = (selector: RegExp, into: Record<string, string>): void => {
    for (const block of css.matchAll(selector)) {
      for (const decl of block[1]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) into[decl[1]!] = decl[2]!.trim();
    }
  };
  collect(/^:root\s*\{([^}]*)\}/gm, light);
  collect(/^\[data-theme="dark"\]\s*\{([^}]*)\}/gm, dark);
  return { ...light, ...dark };
}
