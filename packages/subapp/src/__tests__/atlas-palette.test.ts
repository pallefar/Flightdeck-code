/** Studio's own sub-app paints Atlas, like the apps it generates.
 *
 * The console page this package installs (`web/src/subapps/studio/index.tsx`)
 * inlined the same pre-Atlas fallbacks as codegen's web module —
 * `var(--te, #ff8200)` and three more — and it lands under the host's
 * `web/src`, which `flightdeck/tests/atlasCategoricalPalette.test.ts` scans
 * for exactly those values. Installing Studio would turn that host fence red.
 * The pinned lists are shared with codegen (`@codegen/testing/atlasPalette`),
 * which is also where they are checked against the host's own files. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ATLAS_DARK, hexFallbacksIn, retiredHexIn } from "@codegen/testing/atlasPalette";
import { EMIT_MANIFEST } from "../emit.js";

const PACKAGE_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (rel: string): string => readFileSync(join(PACKAGE_SRC, rel), "utf8");

describe("the Studio sub-app carries no colour the host's palette fence rejects", () => {
  it("no retired pre-Atlas hex in any file it installs into the host", () => {
    const hits = EMIT_MANIFEST.flatMap((f) => retiredHexIn(source(f.source)).map((hex) => `${f.source} → ${hex}`));
    expect(hits).toEqual([]);
  });

  it("every var(--token, #hex) fallback on the console page is Atlas's dark value", () => {
    const page = EMIT_MANIFEST.find((f) => f.role === "web-module");
    expect(page).toBeDefined();
    const fallbacks = hexFallbacksIn(source(page!.source));
    expect(new Set(fallbacks.map(([token]) => token)).size).toBeGreaterThanOrEqual(9);
    const wrong = fallbacks
      .filter(([token, hex]) => ATLAS_DARK[token] !== hex)
      .map(([token, hex]) => `${token}: ${hex}, Atlas dark is ${ATLAS_DARK[token] ?? "(not pinned)"}`);
    expect(wrong).toEqual([]);
  });
});
