/**
 * THE CLASS, NOT THE INSTANCES.
 *
 * Every hole the red team walked through was the same defect wearing a
 * different costume: A CONTROL ANCHORED ON A CALLER'S CLAIM ABOUT SOMETHING THE
 * CODE CAN DETERMINE ITSELF. The declared tier, the supplied content hash, the
 * self-described approver kind, the self-chosen `projectId`, and the decision
 * object a caller could simply write down.
 *
 * `redteam-attacks.test.ts` records each instance being blocked. This file
 * asserts the PROPERTY that blocks all of them, in the form a future edit would
 * have to break on purpose:
 *
 *   1. no field on `GrantRequest` names a tier, a hash, or an approver's kind;
 *   2. the tier the decision acts on is a function of the PAYLOAD BYTES, equal
 *      across every representation of the same bytes;
 *   3. what reaches the append-only audit body is the computed value, never a
 *      claimed one;
 *   4. an answer is an object this package minted, and nothing else is.
 */
import { describe, expect, it } from "vitest";
import { effectiveGrant, verifyDecision, type GrantRequest } from "../decision";
import { classify } from "../../../guardrails/src/classify";
import { classifyEveryRepresentation } from "../../../guardrails/src/representations";
import { DATA_TIERS, type DataTier } from "../tiers";
import { CONTRACTS_INPUT, PAYLOADS, PROJECT, ask, ceiling, payloadFor, row, store } from "./support";

const rows = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];

/** Every way the same record can arrive, for a caller trying to pick a cheaper one. */
const representationsOf = (value: unknown): Array<[string, unknown]> => [
  ["as given", value],
  ["JSON string", JSON.stringify(value)],
  ["inside a field", { attachment: JSON.stringify(value) }],
  ["base64 of JSON", Buffer.from(JSON.stringify(value)).toString("base64")],
  ["inside an array", [value]],
  ["double-wrapped", { outer: { inner: JSON.stringify({ copy: value }) } }],
];

describe("1. there is no field to declare the answer in", () => {
  it("GrantRequest names no tier, no contentHash and no approver kind", () => {
    // A COMPILE-TIME assertion, and it really is one: re-add any of these
    // fields and `Overlap` stops being `never`, so `proof` stops being `true`
    // and `npx tsc --noEmit` fails. The tuple wrapping is what keeps the
    // conditional from distributing and quietly evaluating to `true`.
    const forbidden = ["tier", "contentHash", "approvedBy", "approverKind"] as const;
    type Forbidden = (typeof forbidden)[number];
    type Overlap = Extract<keyof GrantRequest, Forbidden>;
    const proof: [Overlap] extends [never] ? true : never = true;
    expect(proof).toBe(true);
    // and at runtime, the shape a caller actually builds
    const request = ask({ datasource: CONTRACTS_INPUT, tier: 4 });
    for (const field of forbidden) expect(Object.keys(request)).not.toContain(field);
  });
});

describe("2. the tier is a function of the payload, in every representation", () => {
  for (const tier of DATA_TIERS) {
    it(`tier ${tier} data is answered as tier ${tier} however it is wrapped`, async () => {
      const payload = payloadFor(tier);
      for (const [shape, form] of representationsOf(payload)) {
        const decision = await effectiveGrant({
          store: store(rows),
          // `tier: 1` here is only how the fixture picks a DEFAULT payload; the
          // explicit payload overrides it, and the decision ignores both.
          ...ask({ datasource: CONTRACTS_INPUT, tier: 1, payload: form }),
        });
        expect([shape, decision.tier]).toEqual([shape, tier]);
      }
    });
  }

  it("the union is never LOWER than the structure-only walk — it can only add", () => {
    for (const tier of DATA_TIERS) {
      for (const [, form] of representationsOf(payloadFor(tier))) {
        expect(classifyEveryRepresentation(form).tier).toBeGreaterThanOrEqual(classify(form).tier);
      }
    }
  });

  it("and it does not over-fire: innocent data stays tier 1 in every representation", () => {
    for (const [shape, form] of representationsOf(PAYLOADS[1])) {
      expect([shape, classifyEveryRepresentation(form).tier]).toEqual([shape, 1]);
    }
  });

  it("guardrail 4 binds on the COMPUTED tier, so tier 3/4 data always needs a human", async () => {
    for (const tier of DATA_TIERS) {
      for (const [shape, form] of representationsOf(payloadFor(tier))) {
        const decision = await effectiveGrant({
          store: store(rows),
          ...ask({ datasource: CONTRACTS_INPUT, tier: 1, payload: form }),
        });
        expect([shape, decision.requiresNamedApproval]).toEqual([shape, tier >= 3]);
        expect([shape, decision.allowed]).toEqual([shape, tier < 3]);
        if (tier >= 3) expect(decision.reason).toBe("approval_required");
      }
    }
  });
});

describe("3. the append-only body records what was computed", () => {
  it("audit.tier is the payload's tier and audit.contentHash is the tool's", async () => {
    for (const tier of DATA_TIERS) {
      const decision = await effectiveGrant({
        store: store(rows),
        ...ask({ datasource: CONTRACTS_INPUT, tier }),
      });
      expect(decision.audit.tier).toBe(tier as DataTier);
      expect(decision.audit.contentHash).toBe(decision.contentHash);
    }
  });

  it("audit.actorKind is the DIRECTORY's answer, not the requester's claim", async () => {
    const decision = await effectiveGrant({
      store: store(rows),
      // The requester calls itself a human. The directory has it as an agent.
      ...ask({
        datasource: CONTRACTS_INPUT,
        tier: 1,
        requestedBy: { kind: "human", id: "crew.contract-auditor", displayName: "Definitely A Person" },
      }),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.audit.actorKind).toBe("agent");
  });

  it("a requester the directory does not know cannot be named in an entry", async () => {
    const decision = await effectiveGrant({
      store: store(rows),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 1, requestedBy: { kind: "agent", id: "crew.ghost" } }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("requester_unknown");
  });

  it("the classification travels on the decision but never into the body", async () => {
    const decision = await effectiveGrant({
      store: store(rows),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }),
    });
    expect(decision.classification.length).toBeGreaterThan(0);
    // class names come from a compiled-in vocabulary; no scanned value rides along
    for (const finding of decision.classification) {
      expect(JSON.stringify(finding)).not.toContain("DE89370400440532013000");
      expect(JSON.stringify(finding)).not.toContain("Maren Keller");
    }
    expect(Object.keys(decision.audit)).not.toContain("classification");
    expect(Object.keys(decision.audit)).not.toContain("findings");
  });
});

describe("4. only this package mints an answer", () => {
  it("every decision it returns verifies, refusals included", async () => {
    const stores = [store([]), store(rows), store([ceiling([[CONTRACTS_INPUT, 1]])])];
    for (const s of stores) {
      for (const tier of DATA_TIERS) {
        const decision = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier }) });
        expect(verifyDecision(decision)).toBe(true);
      }
    }
  });

  it("nothing a caller can construct does", () => {
    for (const impostor of [
      {},
      { allowed: true },
      { allowed: true, reason: "allowed" },
      null,
      "allowed",
      Object.create({ allowed: true, reason: "allowed" }) as object,
    ]) {
      expect(verifyDecision(impostor)).toBe(false);
    }
  });
});
