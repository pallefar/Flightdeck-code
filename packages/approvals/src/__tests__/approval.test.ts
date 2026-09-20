/**
 * Guardrail 4, in tests: "Security, access, and connector permissions require
 * explicit human approval." Tiers 3 and 4 are where that binds.
 */
import { describe, expect, it } from "vitest";
import { effectiveGrant } from "../decision";
import {
  APPROVER,
  CONTRACTS_INPUT,
  HASH_V1,
  HASH_V2,
  PROJECT,
  TOOL,
  approval,
  ask,
  ceiling,
  row,
  store,
} from "./support";

const rows = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];

describe("tier 1 and 2 need no approval, but are still recorded", () => {
  for (const tier of [1, 2] as const) {
    it(`allows tier ${tier} with no approval on record`, async () => {
      const decision = await effectiveGrant({ store: store(rows), ...ask({ datasource: CONTRACTS_INPUT, tier }) });
      expect(decision.allowed).toBe(true);
      expect(decision.requiresNamedApproval).toBe(false);
      expect(decision.approval).toBeNull();
      // recorded all the same
      expect(decision.audit.decision).toBe("allow");
      expect(decision.audit.tier).toBe(tier);
    });
  }
});

describe("tier 3 and 4 are refused without a named human", () => {
  for (const tier of [3, 4] as const) {
    it(`refuses tier ${tier} when nothing is on record`, async () => {
      const decision = await effectiveGrant({ store: store(rows), ...ask({ datasource: CONTRACTS_INPUT, tier }) });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("approval_required");
      expect(decision.requiresNamedApproval).toBe(true);
      // the grant itself was fine — it is the signature that is missing
      expect(decision.effectiveTiers).toEqual([1, 2, 3, 4]);
    });

    it(`refuses tier ${tier} when an AGENT signed`, async () => {
      const decision = await effectiveGrant({
        store: store(rows, [approval({ approvedBy: { kind: "agent", id: "crew.contract-auditor" } })]),
        ...ask({ datasource: CONTRACTS_INPUT, tier }),
      });
      expect(decision.reason).toBe("approval_actor_not_human");
    });

    it(`refuses tier ${tier} when the SYSTEM signed`, async () => {
      const decision = await effectiveGrant({
        store: store(rows, [approval({ approvedBy: { kind: "system", id: "scheduler" } })]),
        ...ask({ datasource: CONTRACTS_INPUT, tier }),
      });
      expect(decision.reason).toBe("approval_actor_not_human");
    });

    it(`refuses tier ${tier} when the human has no name`, async () => {
      const decision = await effectiveGrant({
        store: store(rows, [approval({ approvedBy: { kind: "human", id: "u_81f3" } })]),
        ...ask({ datasource: CONTRACTS_INPUT, tier }),
      });
      // an opaque subject id is not a NAMED human
      expect(decision.reason).toBe("approval_actor_missing");
    });
  }

  it("allows tier 4 once a named human signed, and names them back", async () => {
    const decision = await effectiveGrant({
      store: store(rows, [approval({ tier: 4 })]),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.approval).toEqual({
      approverId: "m.keller",
      approverName: "Maren Keller",
      approvedAt: "2026-09-20T09:00:00Z",
      tier: 4,
    });
  });

  it("refuses when the signature does not reach the tier being asked for", async () => {
    const decision = await effectiveGrant({
      store: store(rows, [approval({ tier: 3 })]),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }),
    });
    expect(decision.reason).toBe("approval_tier_insufficient");
  });

  it("an approval for another datasource is not a near-miss, it is absent", async () => {
    const decision = await effectiveGrant({
      store: store(rows, [approval({ datasource: { kind: "repo-path", id: "memory" } })]),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 3 }),
    });
    expect(decision.reason).toBe("approval_required");
  });

  it("an approval in another project does not carry over", async () => {
    const decision = await effectiveGrant({
      store: store([ceiling([[CONTRACTS_INPUT, 4]]), row("general", [[CONTRACTS_INPUT, 4]])], [approval()]),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 3, projectId: "general" }),
    });
    expect(decision.reason).toBe("approval_required");
  });
});

describe("nothing self-approves", () => {
  it("refuses a human actor whose subject id IS the tool", async () => {
    const decision = await effectiveGrant({
      store: store(rows, [approval({ approvedBy: { kind: "human", id: TOOL, displayName: "WC Gap Report" } })]),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 3 }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("approval_self_approved");
  });

  it("refuses the same thing spelled in different case", async () => {
    const decision = await effectiveGrant({
      store: store(rows, [approval({ approvedBy: { kind: "human", id: TOOL.toUpperCase(), displayName: "WC" } })]),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }),
    });
    expect(decision.reason).toBe("approval_self_approved");
  });

  it("refuses a TOOL actor outright, before the self question is even asked", async () => {
    const decision = await effectiveGrant({
      store: store(rows, [approval({ approvedBy: { kind: "tool", id: TOOL } })]),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 3 }),
    });
    expect(decision.reason).toBe("approval_actor_not_human");
  });

  it("reports the self-approval even with a merely-stale record sitting next to it", async () => {
    const decision = await effectiveGrant({
      store: store(rows, [
        approval({ contentHash: HASH_V2 }),
        approval({ approvedBy: { kind: "human", id: TOOL, displayName: "WC Gap Report" } }),
      ]),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 3 }),
    });
    expect(decision.reason).toBe("approval_self_approved");
  });
});

describe("changing the tool's content invalidates the approval", () => {
  const signed = store(rows, [approval({ contentHash: HASH_V1, tier: 4 })]);

  it("allows the content that was approved", async () => {
    const decision = await effectiveGrant({
      store: signed,
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4, contentHash: HASH_V1 }),
    });
    expect(decision.allowed).toBe(true);
  });

  it("refuses the edited content — it does not ride the old approval", async () => {
    const decision = await effectiveGrant({
      store: signed,
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4, contentHash: HASH_V2 }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("approval_content_hash_mismatch");
    // and the audit entry records the NEW hash, so the trail shows which
    // version was refused
    expect(decision.audit.contentHash).toBe(HASH_V2);
  });

  it("comes back as a new request: a fresh signature on the new content allows it", async () => {
    const reSigned = store(rows, [
      approval({ contentHash: HASH_V1, tier: 4 }),
      approval({ contentHash: HASH_V2, tier: 4, approvedBy: APPROVER, approvedAt: "2026-09-21T08:00:00Z" }),
    ]);
    const after = await effectiveGrant({
      store: reSigned,
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4, contentHash: HASH_V2 }),
    });
    expect(after.allowed).toBe(true);
    expect(after.approval?.approvedAt).toBe("2026-09-21T08:00:00Z");

    // and the old approval is still exactly as narrow as it was
    const old = await effectiveGrant({
      store: reSigned,
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4, contentHash: HASH_V1 }),
    });
    expect(old.approval?.approvedAt).toBe("2026-09-20T09:00:00Z");
  });
});
