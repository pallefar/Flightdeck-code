import { describe, expect, it } from "vitest";

import { PERSONAL_TAG_CLASSES as PRODUCER_PERSONAL, findTagCandidates } from "../../../pseudonym/src/tags";
import { assessTier } from "../../../pseudonym/src/tier";
import { Vault } from "../../../pseudonym/src/vault";
import { PERSONAL_TAG_CLASSES, PRODUCER_FLOOR, PSEUDONYMISED_FLOOR, admitTierClaim, textIsPseudonymised } from "../tier-claim";

/**
 * ⭐ WHY THIS FILE IMPORTS THE PRODUCER AND `tier-claim.ts` DOES NOT.
 *
 * `packages/envelope` must not depend on the pseudonymiser's runtime — the
 * header of `coverage.ts` gives the reason: one import away from `assessTier`
 * is a caller handing `buildEnvelope` raw text and getting an envelope back,
 * which is the job the package exists to refuse. So `tier-claim.ts`
 * TRANSCRIBES the two facts it needs about the producer.
 *
 * A transcription is a claim about someone else's code, and this repo has
 * been bitten more than once by a copy that quietly stopped matching its
 * original. A TEST may import freely, so this one does, and proves the claims
 * BY RUNNING THE PRODUCER rather than by comparing regex sources — a source
 * comparison passes whenever both sides are edited and fails whenever either
 * is reformatted, which is the wrong sensitivity in both directions.
 */
describe("the transcription in tier-claim.ts still describes the producer", () => {
  it("the personal tag classes agree, IN BOTH DIRECTIONS", () => {
    // A class the producer starts treating as personal and this file has not
    // learned is a tag the envelope would let through under a tier-2 claim.
    // A class this file invents is a refusal the producer never asked for.
    expect([...PERSONAL_TAG_CLASSES].sort()).toEqual([...PRODUCER_PERSONAL].sort());
  });

  // Every bracket form the producer's own candidate regex accepts, crossed
  // with the discriminator shapes and the whitespace it tolerates.
  const OPENS = ["<", "&lt;", "&#60;", "&#x3c;", "&#X3C;"];
  const CLOSES = [">", "&gt;", "&#62;", "&#x3e;"];
  const DISCRIMINATORS = ["", ":1", ": 1", ":a1", ":abc-def", ":A_9"];
  const PADS = ["", " "];

  function corpus(): string[] {
    const out: string[] = [];
    for (const cls of [...PRODUCER_PERSONAL, "literal", "PERSON", "Email", "notaclass"]) {
      for (const open of OPENS) {
        for (const close of CLOSES) {
          for (const disc of DISCRIMINATORS) {
            for (const pad of PADS) {
              out.push(`Step one: ${open}${pad}${cls}${pad}${disc}${pad}${close} approves.`);
            }
          }
        }
      }
    }
    return out;
  }

  it("⭐ fires wherever the producer sees a personal tag — the direction that matters", () => {
    // Asymmetric on purpose. MISSING one reopens the hole exactly: a forged
    // `payloadTier: 2` stands and the text goes out as `ready`. Firing where
    // the producer would not costs a human approval. So this asserts only the
    // superset direction, and the next case measures the overshoot rather
    // than pretending there is none.
    let covered = 0;
    for (const text of corpus()) {
      const producerSaysPersonal = findTagCandidates(text).some(
        ({ verdict }) =>
          (verdict.kind === "canonical" || verdict.kind === "mangled") && PRODUCER_PERSONAL.has(verdict.cls),
      );
      if (!producerSaysPersonal) continue;
      covered += 1;
      expect(textIsPseudonymised(text), `producer saw a personal tag and the envelope did not: ${text}`).toBe(true);
    }
    // The corpus must actually exercise the branch. Without this, a generator
    // that stopped producing real tags would leave every assertion above
    // vacuous and the case would still be green — the failure mode this repo
    // keeps finding.
    expect(covered).toBeGreaterThan(200);
  });

  it("the overshoot is bounded and is only ever in the refusing direction", () => {
    const overshoot = corpus().filter((text) => {
      const producerSaysPersonal = findTagCandidates(text).some(
        ({ verdict }) =>
          (verdict.kind === "canonical" || verdict.kind === "mangled") && PRODUCER_PERSONAL.has(verdict.cls),
      );
      return textIsPseudonymised(text) && !producerSaysPersonal;
    });
    // Whatever these are, each one is a request that stops for a human
    // instead of going out — never the reverse.
    for (const text of overshoot) expect(admitTierClaim(2, text).ok).toBe(false);
  });
});

describe("the two producer invariants tier-claim.ts relies on are true of the producer", () => {
  const SAMPLES = [
    "",
    "nothing personal here at all",
    "Step one: <person:1> opens the ticket.",
    "Kontakt: anna%40acme.de",
    "the quarterly total was 4 200 EUR",
    "<email:3> and <iban:2> and <literal:7>",
    "Anna Sørensen approves on Tuesday",
  ];

  it("⭐ assessTier CANNOT emit tier 1 — the floor tier-claim.ts refuses below", () => {
    // Two unconditional floor-2 reasons are pushed before `assessTier` reads
    // anything: `tier-1-not-claimable` and `bounded-scan-coverage`. If either
    // ever becomes conditional, `text-tier-below-producer-floor` starts
    // refusing honest reports and this case says so first.
    for (const text of SAMPLES) {
      const assessment = assessTier(text, new Vault());
      expect(assessment.payloadTier, `"${text}" assessed below the transcribed floor`).toBeGreaterThanOrEqual(
        PRODUCER_FLOOR,
      );
    }
  });

  it("⭐ a personal tag floors the producer at 3 — the claim the envelope checks against", () => {
    for (const text of SAMPLES) {
      const producerSaysPersonal = findTagCandidates(text).some(
        ({ verdict }) =>
          (verdict.kind === "canonical" || verdict.kind === "mangled") && PRODUCER_PERSONAL.has(verdict.cls),
      );
      if (!producerSaysPersonal) continue;
      const assessment = assessTier(text, new Vault());
      expect(assessment.payloadTier, `"${text}" carries a personal tag but assessed below 3`).toBeGreaterThanOrEqual(
        PSEUDONYMISED_FLOOR,
      );
      // And the envelope refuses exactly the claim the producer contradicts.
      expect(admitTierClaim(PSEUDONYMISED_FLOOR - 1, text).ok).toBe(false);
      expect(admitTierClaim(assessment.payloadTier, text).ok).toBe(true);
    }
  });

  it("an honest report over clean text is admitted — this is a check, not a wall", () => {
    // The failure mode opposite to the hole: a control that refuses
    // everything is not a control, and would have passed every case above.
    const clean = "the workflow moves a ticket from one folder to another";
    const assessment = assessTier(clean, new Vault());
    expect(admitTierClaim(assessment.payloadTier, clean).ok).toBe(true);
  });
});
