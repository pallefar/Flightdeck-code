/**
 * The closed catalogue of proposal templates — owner ruling 2026-09-22 (8).
 *
 * A proposing mini-app writes into the host's review inbox on someone's behalf, and what it
 * writes is decided HERE, by a template the owner approved, never by the model. Each case
 * below is one way an unapproved shape could otherwise reach generation.
 */
import { describe, expect, it } from "vitest";

import { contractRunSpec } from "../fixtures/specs";
import { fieldSpecSchema, type MiniAppSpec as CodegenSpec } from "../spec-contract";
import { isNamedHuman } from "../../../guardrails/src/approval-pure";
import {
  PROPOSAL_TEMPLATES,
  approvedTemplateMenu,
  checkTemplateApproval,
  resolveProposalTemplate,
  templateContentHash,
  type ProposalTemplate,
} from "../proposal-templates";

const divergence = (): ProposalTemplate => {
  const found = PROPOSAL_TEMPLATES.find((t) => t.id === "divergence");
  if (found === undefined) throw new Error("the divergence template is missing");
  return found;
};

/** The two templates the owner approved seeding (ruling 8). */
const SEEDS = ["divergence", "handoff"];
const seeds = () => PROPOSAL_TEMPLATES.filter((t) => SEEDS.includes(t.id));

describe("the seeded catalogue", () => {
  it("⭐ holds the two approved seeds, and the conversion's `step` shape unapproved", () => {
    expect(PROPOSAL_TEMPLATES.map((t) => t.id)).toEqual(["divergence", "handoff", "step"]);
    expect(PROPOSAL_TEMPLATES.filter((t) => checkTemplateApproval(t) === null).map((t) => t.id)).toEqual(SEEDS);
  });

  it("⭐ is contract-run's existing divergence and handoff shapes, field for field", () => {
    // "Derived from" is checked, not claimed: if either side moves, this goes red and a
    // person decides whether the approved template or the fixture is the one that is wrong.
    // Widened to @codegen's own type: the fixture's literal types differ per domain.
    const domains: readonly CodegenSpec["domains"][number][] = contractRunSpec.domains;
    const proposals = domains
      .flatMap((d) => d.routes)
      .flatMap((r) => (r.operation.kind === "propose" ? [r.operation] : []));
    for (const template of seeds()) {
      const source = proposals.find((op) => op.proposalKind === template.proposalKind);
      expect(source, template.id).toBeDefined();
      expect(template.ticketField).toBe(source?.ticketField);
      expect(template.fields).toEqual(source?.fields);
      expect(`contract-run.${template.auditEventSuffix}`).toBe(source?.auditEvent);
    }
  });

  it("carries an approval record on every seed, by a named human, on the ruling's date", () => {
    for (const template of seeds()) {
      expect(template.approval, template.id).not.toBeNull();
      expect(isNamedHuman(template.approval?.approvedBy)).toBe(true);
      expect(template.approval?.approvedAt).toBe("2026-09-22");
      expect(checkTemplateApproval(template)).toBeNull();
    }
  });

  it("writes only fields @codegen can emit, with a required string ticket", () => {
    for (const template of PROPOSAL_TEMPLATES) {
      for (const field of template.fields) expect(fieldSpecSchema.safeParse(field).success).toBe(true);
      const ticket = template.fields.find((f) => f.name === template.ticketField);
      expect(ticket?.type).toBe("string");
      expect(ticket?.optional).not.toBe(true);
    }
  });

  it("is closed — frozen all the way down, so nothing at runtime can add or widen a template", () => {
    expect(Object.isFrozen(PROPOSAL_TEMPLATES)).toBe(true);
    for (const template of PROPOSAL_TEMPLATES) {
      expect(Object.isFrozen(template)).toBe(true);
      expect(Object.isFrozen(template.fields)).toBe(true);
      expect(Object.isFrozen(template.approval)).toBe(true);
      for (const field of template.fields) expect(Object.isFrozen(field)).toBe(true);
    }
  });
});

describe("⛔ the conversion's `step` template — in the catalogue, never generated from", () => {
  const step = () => {
    const found = PROPOSAL_TEMPLATES.find((t) => t.id === "step");
    if (found === undefined) throw new Error("the step template is missing");
    return found;
  };

  it("carries no approval: the owner has not approved it", () => {
    expect(step().approval).toBeNull();
    expect(checkTemplateApproval(step())).toBe("unapproved");
    expect(resolveProposalTemplate("step")).toEqual({ ok: false, problem: "unapproved" });
  });

  it("is off the planner's menu", () => {
    expect(approvedTemplateMenu().map((t) => t.id)).not.toContain("step");
  });

  it("is the conversion's fixed step proposal, field for field — named, so an approval approves THAT", () => {
    expect(step().proposalKind).toBe("step");
    expect(step().ticketField).toBe("ticket");
    expect(step().fields).toEqual([
      { name: "ticket", type: "string", maxLength: 64 },
      { name: "step", type: "string", maxLength: 48 },
      { name: "note", type: "string", optional: true, maxLength: 500 },
    ]);
    expect(step().auditEventSuffix).toBe("step-proposed");
    expect(step().derivedFrom).toContain("conversion.ts");
  });
});

describe("what makes a template unapproved", () => {
  it("⛔ no approval record at all", () => {
    expect(checkTemplateApproval({ ...divergence(), approval: null })).toBe("unapproved");
  });

  it("⛔ an approver who is not a named human — the ONE rule, imported", () => {
    const approval = { ...divergence().approval!, approvedBy: "system" };
    expect(checkTemplateApproval({ ...divergence(), approval })).toBe("unnamed-approver");
  });

  it("⛔ an approval with no real date", () => {
    for (const approvedAt of ["", "yesterday", "2026-13-40", "22/09/2026"]) {
      const approval = { ...divergence().approval!, approvedAt };
      expect(checkTemplateApproval({ ...divergence(), approval }), approvedAt).toBe("undated-approval");
    }
  });

  it("⭐ a template edited after it was approved — the approval binds to the content", () => {
    const widened: ProposalTemplate = {
      ...divergence(),
      fields: [...divergence().fields, { name: "salary", type: "number" }],
    };
    expect(checkTemplateApproval(widened)).toBe("content-changed-since-approval");
    expect(templateContentHash(widened)).not.toBe(divergence().approval?.contentHash);
  });

  it("the hash covers everything but the approval itself", () => {
    const relabelled = { ...divergence(), summary: "Something else entirely." };
    expect(templateContentHash(relabelled)).not.toBe(templateContentHash(divergence()));
    const reapproved = { ...divergence(), approval: { ...divergence().approval!, approvedBy: "Someone Else" } };
    expect(templateContentHash(reapproved)).toBe(templateContentHash(divergence()));
  });
});

describe("resolving a template the model named", () => {
  it("resolves an approved id", () => {
    const resolved = resolveProposalTemplate("handoff");
    expect(resolved.ok && resolved.template.proposalKind).toBe("handoff");
  });

  it("⛔ refuses an id that is not in the catalogue", () => {
    expect(resolveProposalTemplate("salary-change")).toEqual({ ok: false, problem: "unknown-template" });
  });

  it("⛔ refuses an unapproved template even when it IS in the catalogue", () => {
    const catalogue = [{ ...divergence(), approval: null }];
    expect(resolveProposalTemplate("divergence", catalogue)).toEqual({ ok: false, problem: "unapproved" });
  });
});

describe("the menu the planner is shown", () => {
  it("lists every approved template with its field names — never the field specs", () => {
    expect(approvedTemplateMenu()).toEqual([
      { id: "divergence", summary: divergence().summary, fields: ["ticket", "note"] },
      { id: "handoff", summary: PROPOSAL_TEMPLATES[1]?.summary, fields: ["ticket", "step"] },
    ]);
  });

  it("⛔ leaves an unapproved template off the menu", () => {
    const catalogue = [{ ...divergence(), approval: null }, PROPOSAL_TEMPLATES[1]!];
    expect(approvedTemplateMenu(catalogue).map((t) => t.id)).toEqual(["handoff"]);
  });
});
