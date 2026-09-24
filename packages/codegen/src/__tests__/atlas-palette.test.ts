/** A generated sub-app paints Atlas, so the host's palette fence stays green.
 *
 * ⭐ THE FAILURE THIS PINS. The host gate, run on a mounted candidate, failed
 * `atlasCategoricalPalette.test.ts` because of the candidate: codegen's web
 * module inlined `var(--te, #ff8200)`, `var(--green, #2fd472)`,
 * `var(--amber, #ffc24b)` and `var(--red, #ff5b4d)` — pre-Atlas values the
 * host fences out of every file under `web/src` and `server/`. Every
 * generated app carried them, whatever its spec, because they live in the
 * fixed runtime rather than in anything the spec controls.
 *
 * `npm run mount` runs the host's `tests/subapps/` only, so it never saw this.
 * These tests read the emitted TEXT, as every test in this package does. */
import { describe, expect, it } from "vitest";
import { generateSubApp } from "../generate";
import { contractRunSpec, minimalSpec, wcClockSpec } from "../fixtures/specs";
import {
  ATLAS_DARK,
  RETIRED_HEX,
  hexFallbacksIn,
  hostPaletteAvailable,
  readHostDarkTokens,
  readHostRetiredHex,
  retiredHexIn,
} from "../testing/atlasPalette";

const SPECS = { contractRunSpec, minimalSpec, wcClockSpec } as const;

describe("generated host files carry no colour the host's palette fence rejects", () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    it(`${name}: no retired pre-Atlas hex in any file that lands in the host`, () => {
      const hostFiles = generateSubApp(spec).files.filter((f) => f.kind !== "standalone");
      expect(hostFiles.length).toBeGreaterThan(0);
      const hits = hostFiles.flatMap((f) => retiredHexIn(f.contents).map((hex) => `${f.path} → ${hex}`));
      expect(hits).toEqual([]);
    });

    it(`${name}: every var(--token, #hex) fallback is Atlas's dark value for that token`, () => {
      const page = generateSubApp(spec).files.find((f) => f.kind === "web-module");
      expect(page).toBeDefined();
      const fallbacks = hexFallbacksIn(page!.contents);
      // Nine tokens: the check is not vacuous if the page stops inlining them.
      expect(new Set(fallbacks.map(([token]) => token)).size).toBeGreaterThanOrEqual(9);
      const wrong = fallbacks
        .filter(([token, hex]) => ATLAS_DARK[token] !== hex)
        .map(([token, hex]) => `${token}: ${hex}, Atlas dark is ${ATLAS_DARK[token] ?? "(not pinned)"}`);
      expect(wrong).toEqual([]);
    });
  }
});

// Skipped without a host checkout, like manifest-rules.test.ts; on the Mac set
// FLIGHTDECK_HOST_ROOT to the project-contract checkout.
describe.skipIf(!hostPaletteAvailable())("the pinned palette agrees with the host's own files", () => {
  it("RETIRED_HEX is the host fence's FOREIGN_HEX", () => {
    expect([...RETIRED_HEX].sort()).toEqual(readHostRetiredHex().sort());
  });

  it("ATLAS_DARK is what the host theme.css computes under [data-theme=\"dark\"]", () => {
    const host = readHostDarkTokens();
    const drift = Object.entries(ATLAS_DARK)
      .filter(([token, hex]) => host[token]?.toLowerCase() !== hex)
      .map(([token, hex]) => `${token}: pinned ${hex}, host ${host[token] ?? "(undefined)"}`);
    expect(drift).toEqual([]);
  });
});
