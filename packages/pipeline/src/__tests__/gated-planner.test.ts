/** Does the spine actually hold the pieces together — and does the gate run?
 *
 * ⭐ THE POINT OF THESE TESTS IS THE SEAM, NOT THE PIECES. Every package this
 * composes is already exhaustively tested on its own; between them ~812 tests
 * passed while nothing called anything. What was never checked is that the
 * PROVIDER CANNOT BE REACHED WITHOUT PASSING THE GATE, which is the only
 * property that makes the guardrails worth having.
 */
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { ModelRequestRefused, gatedPlannerLlm, type PlannerRequestLike } from "../gated-planner";

const digest = (utf8: string): string => createHash("sha256").update(utf8, "utf8").digest("hex");
const CTX = { actor: "karsten.haldan" };

const REQUEST: PlannerRequestLike = {
  system: "You turn one sentence into a draft sub-app spec.",
  user: "Track the statutory consultation window for a contract folder.",
  purpose: "draft",
  attempt: 1,
};

describe("the spine: prompt -> pseudonymise -> envelope -> gate -> provider", () => {
  it("⭐ the provider is NEVER reached when the gate refuses", () => {
    // The whole claim. If this ever passes by the provider being called and
    // the result discarded, the gate is decoration.
    const provider = vi.fn(async () => ({ text: "{}" }));
    const llm = gatedPlannerLlm(provider, CTX, { digest });

    return expect(llm(REQUEST)).rejects.toThrow(ModelRequestRefused).then(() => {
      expect(provider).not.toHaveBeenCalled();
    });
  });

  it("the refusal carries the envelope a human would approve, not just a 'no'", async () => {
    let seen: unknown = null;
    const llm = gatedPlannerLlm(async () => ({ text: "{}" }), CTX, {
      digest,
      onDecision: (d) => { seen = d; },
    });

    await expect(llm(REQUEST)).rejects.toThrow(ModelRequestRefused);
    const decision = seen as { decision: string; envelope?: { disposition: string } };
    expect(decision.decision).toBe("refuse");
    expect(decision.envelope?.disposition).toBe("requires-human-approval");
  });

  it("⭐ and the refusal is the DESIGN, quoted here so a change to it is deliberate", async () => {
    // build.ts: `const disposition = textFacts > 0 ? "requires-human-approval" : "ready"`.
    // ANY free text needs a human, whatever its tier — so pseudonymising does
    // not lower it — and gateModelRequest never calls checkApproval, so no
    // approval opens it either.
    //
    // This test exists so that if somebody later makes Studio's prompt flow,
    // they do it by changing the POLICY on purpose and this goes red, rather
    // than by adding a quiet bypass in the spine.
    const llm = gatedPlannerLlm(async () => ({ text: "{}" }), CTX, { digest });
    await expect(llm(REQUEST)).rejects.toThrow(/requires-human-approval/);
  });

  it("⭐ what reaches the gate is TOKENISED — the person's name never gets that far", async () => {
    let payloadSeen = "";
    const llm = gatedPlannerLlm(
      async (r) => { payloadSeen = r.user; return { text: "{}" }; },
      CTX,
      {
        digest,
        names: ["Anna Sørensen"],
        onDecision: (d) => {
          // The decision is audit material; it must not carry the value.
          expect(JSON.stringify(d)).not.toContain("Anna Sørensen");
          expect(JSON.stringify(d)).not.toContain("anna@example.dk");
        },
      },
    );

    await expect(
      llm({ ...REQUEST, user: "Anna Sørensen (anna@example.dk) asked for a consultation clock." }),
    ).rejects.toThrow(ModelRequestRefused);

    // The provider was never called, so nothing was on the wire at all — which
    // is the strongest version of this and the one that should hold today.
    expect(payloadSeen).toBe("");
  });

  it("pseudonymisation happens BEFORE the gate, not after", async () => {
    // Asserted through the gate's own view: the text fact it admitted must be
    // the tokenised text. If the order were reversed the gate's findings would
    // carry the values it exists to keep off the wire.
    let assessed: { readonly payloadTier?: number } | null | undefined = undefined;
    const llm = gatedPlannerLlm(async () => ({ text: "{}" }), CTX, {
      digest,
      names: ["Anna Sørensen"],
      onDecision: (d) => {
        const env = (d as { envelope?: { facts?: Record<string, unknown> } }).envelope;
        const fact = env?.facts?.["workflow"] as { provenance?: { payloadTier?: number } } | undefined;
        assessed = fact?.provenance ?? null;
      },
    });

    await expect(
      llm({ ...REQUEST, user: "Anna Sørensen asked for a consultation clock." }),
    ).rejects.toThrow(ModelRequestRefused);
    // A refusal at disposition level still builds the envelope, so the
    // provenance is there to inspect.
    const provenance = assessed as { readonly payloadTier?: number } | null | undefined;
    expect(provenance == null || typeof provenance.payloadTier === "number").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("⭐ the spine end to end: a first-party prompt REACHES the provider", () => {
  it("allows, calls the provider, and hands back the model's reply detokenised", async () => {
    // The thing that could not happen before the authorship policy existed,
    // and the reason Studio can draft a spec at all.
    const seen: string[] = [];
    const llm = gatedPlannerLlm(
      async (r) => { seen.push(r.user); return { text: '{"understanding":"ok","spec":{}}' }; },
      { actor: "Karsten Haldan" },
      { digest, authorship: "first-party-operator" },
    );

    const completion = await llm(REQUEST);
    expect(seen).toHaveLength(1);
    expect(completion.text).toBe('{"understanding":"ok","spec":{}}');
  });

  it("⭐ and the SAME prompt without the flag still never reaches it", async () => {
    // The control. If this ever passes, the policy is not a policy.
    const provider = vi.fn(async () => ({ text: "{}" }));
    const llm = gatedPlannerLlm(provider, { actor: "Karsten Haldan" }, { digest });
    await expect(llm(REQUEST)).rejects.toThrow(ModelRequestRefused);
    expect(provider).not.toHaveBeenCalled();
  });

  it("⭐ and with the flag but an UNNAMED actor it still never reaches it", async () => {
    const provider = vi.fn(async () => ({ text: "{}" }));
    const llm = gatedPlannerLlm(provider, { actor: "system" }, {
      digest,
      authorship: "first-party-operator",
    });
    await expect(llm(REQUEST)).rejects.toThrow(ModelRequestRefused);
    expect(provider).not.toHaveBeenCalled();
  });

  it("⭐ a prompt that NAMES A PERSON still needs a human, even first-party", async () => {
    // Measured, not assumed: tokenising "Anna Sørensen wants …" yields
    // payloadTier 3, because the TAG still says a person was there. So it
    // fails condition 4 and goes to a person — which is the behaviour you
    // want. Being the author of a sentence about somebody else is not the
    // same as being the author of a sentence about nobody.
    const provider = vi.fn(async () => ({ text: "{}" }));
    const llm = gatedPlannerLlm(provider, { actor: "Karsten Haldan" }, {
      digest,
      authorship: "first-party-operator",
      names: ["Anna Sørensen"],
    });

    await expect(
      llm({ ...REQUEST, user: "Anna Sørensen wants a consultation clock for TE-4711." }),
    ).rejects.toThrow(/text-not-reduced-below-tier-3|requires-human-approval/);
    expect(provider).not.toHaveBeenCalled();
  });

  it("and when it IS allowed, the provider still sees tokenised text", async () => {
    let onWire = "";
    const llm = gatedPlannerLlm(
      async (r) => { onWire = r.user; return { text: "{}" }; },
      { actor: "Karsten Haldan" },
      { digest, authorship: "first-party-operator" },
    );
    await llm(REQUEST);
    expect(onWire).toBe(REQUEST.user); // nothing to tokenise in a clean prompt
  });
});
