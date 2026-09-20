/**
 * NOTHING SELF-APPROVES — `boot.json` guardrail 4, measured.
 *
 * Four different things get called "self-approval" in a system like this, and
 * they are four different holes:
 *
 *   1. the generator signing its own output      (an agent)
 *   2. the tool signing for itself               (subject id == artifact id)
 *   3. a service account wearing a human's kind  (kind "human", tool's id)
 *   4. the proposer waving through their own submission  (one party, not two)
 *
 * A check that only covers (1) is the one most systems ship. Each case below
 * asserts its OWN reason code, because "approval refused" that cannot say which
 * of the four it was is an audit trail nobody can act on.
 *
 * Every case also asserts that the refusal LEFT NOTHING BEHIND: same ledger by
 * reference, no history row, and the revision still sitting in `proposed`. A
 * refusal that recorded a failed attempt as an approval-shaped row would be
 * worse than no check at all.
 */

import { describe, expect, it } from "vitest";

import { SELF_APPROVAL_REASONS } from "../reasons";
import { approve, createLedger, propose, register } from "../ledger";
import { approverDefect } from "../entry";
import {
  AGENT,
  ANON_HUMAN,
  APPROVER,
  HUMAN_NAMED_AFTER_TOOL,
  SYSTEM,
  T,
  TOOL_SELF,
  miniApp,
  mustOk,
} from "./support";
import type { Actor } from "../actor";

function proposedBy(by: Actor) {
  return mustOk(propose(createLedger(), { artifact: miniApp(), workflowId: "orchestrate-workflow", by, at: T.proposed }));
}

describe("who may not sign", () => {
  const cases: Array<{ name: string; approver: Actor; proposer: Actor; reason: string }> = [
    {
      name: "the agent that generated it",
      approver: AGENT,
      proposer: AGENT,
      reason: "approval_actor_not_human",
    },
    {
      name: "the system itself",
      approver: SYSTEM,
      proposer: AGENT,
      reason: "approval_actor_not_human",
    },
    {
      name: "a tool actor carrying the artifact's own id",
      approver: TOOL_SELF,
      proposer: AGENT,
      reason: "approval_actor_not_human",
    },
    {
      name: "a HUMAN account minted to carry the tool's id",
      approver: HUMAN_NAMED_AFTER_TOOL,
      proposer: AGENT,
      reason: "approval_self_approved",
    },
    {
      name: "a human with no name in the trail",
      approver: ANON_HUMAN,
      proposer: AGENT,
      reason: "approval_actor_missing",
    },
    {
      name: "the very person who proposed it",
      approver: APPROVER,
      proposer: APPROVER,
      reason: "approval_by_proposer",
    },
  ];

  for (const c of cases) {
    it(`refuses ${c.name} with \`${c.reason}\``, () => {
      const p = proposedBy(c.proposer);
      const result = approve(p.ledger, {
        artifactId: "wc-clock",
        contentHash: p.entry.contentHash,
        by: c.approver,
        at: T.approved,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe(c.reason);
      expect(SELF_APPROVAL_REASONS).toContain(result.reason);

      // Nothing happened.
      expect(result.ledger).toBe(p.ledger);
      expect(result.ledger.history).toHaveLength(1);
      expect(result.ledger.history[0]?.event).toBe("subapp.proposed");
      expect(result.ledger.entries[0]?.state).toBe("proposed");
      expect(result.ledger.entries[0]?.approval).toBeNull();
    });
  }
});

describe("a refused approval cannot be laundered into a registration", () => {
  it("the agent's attempt leaves the revision unregisterable", () => {
    const p = proposedBy(AGENT);
    approve(p.ledger, { artifactId: "wc-clock", contentHash: p.entry.contentHash, by: AGENT, at: T.approved });

    const result = register(p.ledger, {
      artifactId: "wc-clock",
      contentHash: p.entry.contentHash,
      by: AGENT,
      at: T.registered,
    });
    expect(result.reason).toBe("not_approved");
  });

  it("a hand-forged approval whose hash does not match its own entry is refused at registration", () => {
    const p = proposedBy(AGENT);
    const approved = mustOk(
      approve(p.ledger, { artifactId: "wc-clock", contentHash: p.entry.contentHash, by: APPROVER, at: T.approved }),
    );

    // Simulate a ledger round-tripped through JSON and edited on the way: the
    // signature now claims a different revision than the row it sits on.
    const tampered = {
      ...approved.ledger,
      entries: approved.ledger.entries.map((e) => ({
        ...e,
        approval: e.approval ? { ...e.approval, contentHash: "f".repeat(64) } : null,
      })),
    };

    const result = register(tampered, {
      artifactId: "wc-clock",
      contentHash: p.entry.contentHash,
      by: APPROVER,
      at: T.registered,
    });
    expect(result.reason).toBe("content_hash_mismatch");
  });
});

describe("approverDefect is the one implementation", () => {
  it("returns null only for a named human who is neither the tool nor the proposer", () => {
    expect(approverDefect(APPROVER, "wc-clock", AGENT)).toBeNull();
    expect(approverDefect(AGENT, "wc-clock", AGENT)).toBe("approval_actor_not_human");
    expect(approverDefect(HUMAN_NAMED_AFTER_TOOL, "wc-clock", AGENT)).toBe("approval_self_approved");
    expect(approverDefect(APPROVER, "wc-clock", APPROVER)).toBe("approval_by_proposer");
    expect(approverDefect({ kind: "human", id: "   ", displayName: "x" }, "wc-clock", AGENT)).toBe("invalid_actor");
  });

  it("matches ids case-insensitively — a casing difference is not a second person", () => {
    expect(approverDefect({ kind: "human", id: "WC-Clock", displayName: "Service" }, "wc-clock", AGENT)).toBe(
      "approval_self_approved",
    );
    expect(
      approverDefect({ kind: "human", id: "K.Haldan", displayName: "Karsten Haldan" }, "wc-clock", APPROVER),
    ).toBe("approval_by_proposer");
  });

  it("a DIFFERENT named human may sign what an agent proposed — the normal path", () => {
    const p = proposedBy(AGENT);
    const approved = mustOk(
      approve(p.ledger, { artifactId: "wc-clock", contentHash: p.entry.contentHash, by: APPROVER, at: T.approved }),
    );
    expect(approved.entry.approval?.approver.id).toBe("k.haldan");
  });
});
