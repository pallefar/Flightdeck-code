import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TIER_REASON_CODES, refuseAtPayloadTierCeiling } from "../gates";

/**
 * `TIER_REASON_CODES` is a copy of the pseudonymiser's `TierReasonCode`, kept
 * for the reason `envelope/coverage.ts` gives for its own copies: this
 * package must not be one import away from `assessTier`.
 *
 * A copy is a claim about someone else's file, so this reads that file and
 * checks the claim IN BOTH DIRECTIONS. The two failures are not the same:
 *
 *   - a code the producer ADDED and this set has not learned is dropped
 *     silently from an append-only audit record, so the most serious
 *     refusals would be recorded without their reason;
 *   - a code this set INVENTED never matches anything, which is dead weight
 *     pretending to be a vocabulary.
 */
const TIER_TS = fileURLToPath(new URL("../../../pseudonym/src/tier.ts", import.meta.url));

function unionFromDisk(): string[] {
  // ⚠ COMMENTS COME OUT FIRST, and the first attempt at this did not do it:
  // the union's own doc comments are prose, one arm is documented "NOT a
  // proof of absence; …", and the scan for the terminating `;` stopped
  // there — parsing four arms instead of thirteen. The same shape as the
  // tests in this repo that matched their own explanatory text: a parser
  // that reads comments is reading something nobody is maintaining as data.
  const src = readFileSync(TIER_TS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const start = src.indexOf("export type TierReasonCode =");
  expect(start, "TierReasonCode union not found — this test is reading the wrong file").toBeGreaterThan(-1);
  const end = src.indexOf(";", start);
  expect(end, "union has no terminator").toBeGreaterThan(start);
  const body = src.slice(start, end);
  return [...body.matchAll(/\|\s*"([a-z0-9-]+)"/g)].map((m) => m[1] as string).sort();
}

describe("the transcription in gates.ts still describes the pseudonymiser", () => {
  it("⭐ the tier reason codes agree, IN BOTH DIRECTIONS", () => {
    const onDisk = unionFromDisk();
    // A union that parsed to nothing would make the comparison below vacuous
    // and green. It has 13 arms today; the floor is what keeps the parse
    // honest without pinning the exact number.
    expect(onDisk.length).toBeGreaterThanOrEqual(10);
    expect([...TIER_REASON_CODES].sort()).toEqual(onDisk);
  });

  it("a code outside the vocabulary is dropped rather than written to the chain", () => {
    // `PayloadTierError.reasons` is `readonly string[]`, so the type system
    // is not what keeps caller prose out of an append-only record.
    const decision = refuseAtPayloadTierCeiling(
      {
        payloadTier: 4,
        ceiling: 3,
        reasonCodes: ["special-category-signal", "salary of Anna Sørensen is 92000 EUR"],
      },
      { actor: "Karsten Haldan", digest: (u: string) => `d${u.length}` },
    );
    expect(decision.tierReasonCodes).toEqual(["special-category-signal"]);
    expect(JSON.stringify(decision)).not.toContain("Anna");
  });

  it("the tier and ceiling are clamped, so a bad number cannot widen the record", () => {
    const decision = refuseAtPayloadTierCeiling(
      { payloadTier: 1e308, ceiling: -5, reasonCodes: [] },
      { actor: "Karsten Haldan", digest: (u: string) => `d${u.length}` },
    );
    expect(decision.tier).toBe(4);
    expect(decision.decision).toBe("refuse");
  });
});
