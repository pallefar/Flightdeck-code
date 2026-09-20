/**
 * The four gates: each one refuses a real cat 3/4 sample and allows a clean
 * one, and each one's approval behaviour is exactly the row it has in
 * `GATE_POLICY` — no more, no less.
 *
 * All fixtures fictional. See the header of `classify.test.ts` for why that is
 * a rule here and not a style preference.
 */

import { describe, expect, it } from "vitest";
import {
  GATE_POLICY,
  gateGeneratedArtifacts,
  gateModelRequest,
  gateRegistration,
  gateWorkflowIntake,
} from "../gates";
import { contentHash } from "../approval";
import type { Approval } from "../approval";

const ACTOR = { actor: "karsten.haldan" };

const CLEAN_SPEC = {
  id: "wc-clock",
  label: "Works Council Clock",
  tables: [{ name: "deadlines", columns: [{ name: "contractId" }, { name: "dueAt" }] }],
};

const DIRTY_SPEC = {
  id: "offer-tracker",
  label: "Offer Tracker",
  tables: [{ name: "offers", columns: [{ name: "contractId" }, { name: "salaryEur" }] }],
};

function approvalFor(proposal: unknown, scope: Approval["scope"], approver = "Karsten Haldan"): Approval {
  return { approver, contentHash: contentHash(proposal), at: "2026-09-20T10:00:00Z", scope };
}

// ─────────────────────────────────────────────────────────────────────────

describe("gate 1 — registration", () => {
  it("allows a clean spec with no approval at all", () => {
    const d = gateRegistration(CLEAN_SPEC, ACTOR);
    expect(d.decision).toBe("allow");
    expect(d.tier).toBeLessThanOrEqual(2);
    expect(d.audit.event).toBe("guardrails.registration-allowed");
  });

  it("refuses to register a cat-4 spec without a named-human approval", () => {
    const d = gateRegistration(DIRTY_SPEC, ACTOR);
    expect(d.decision).toBe("approval-required");
    expect(d.tier).toBe(4);
    expect(d.audit.classes).toContain("salary");
    expect(d.approval?.problem).toBe("no-approval");
  });

  it("allows it once a named human approves THIS content hash", () => {
    const d = gateRegistration(DIRTY_SPEC, { ...ACTOR, approval: approvalFor(DIRTY_SPEC, "registration") });
    expect(d.decision).toBe("allow");
    expect(d.tier).toBe(4); // still tier 4 — approved, not reclassified
    expect(d.audit.approver).toBe("Karsten Haldan");
  });

  it("⭐ approving v1 does not bless v2", () => {
    const v1 = DIRTY_SPEC;
    const v2 = { ...DIRTY_SPEC, tables: [{ name: "offers", columns: [{ name: "salaryEur" }, { name: "iban" }] }] };
    const approval = approvalFor(v1, "registration");
    expect(gateRegistration(v1, { ...ACTOR, approval }).decision).toBe("allow");
    const d = gateRegistration(v2, { ...ACTOR, approval });
    expect(d.decision).toBe("approval-required");
    expect(d.approval?.problem).toBe("content-hash-mismatch");
    expect(d.contentHash).not.toBe(approval.contentHash);
  });

  it("is insensitive to key ORDER but not to content", () => {
    const a = { id: "x", tables: [{ name: "t" }], label: "L" };
    const b = { label: "L", id: "x", tables: [{ name: "t" }] };
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("refuses an approval that is not from a named human", () => {
    for (const approver of ["", "system", "the approver", "flightdeck-server", "  "]) {
      const d = gateRegistration(DIRTY_SPEC, {
        ...ACTOR,
        approval: approvalFor(DIRTY_SPEC, "registration", approver),
      });
      expect(d.decision, `"${approver}" was accepted as a named human`).toBe("approval-required");
      expect(d.approval?.problem).toBe("unnamed-approver");
    }
  });

  it("refuses an approval issued for a different gate", () => {
    const d = gateRegistration(DIRTY_SPEC, {
      ...ACTOR,
      approval: { ...approvalFor(DIRTY_SPEC, "registration"), scope: "workflow-intake" },
    });
    expect(d.approval?.problem).toBe("wrong-scope");
  });

  it("⭐ does not anchor on one declared location", () => {
    // Not `spec.tables`. A salary column reaches the same place from a widget
    // filter, and a gate that only reads the declaration it was told about is
    // the guard that watched `contracts/` while a copy sat in `archive/`.
    const sneaky = {
      id: "offer-tracker",
      tables: [{ name: "offers", columns: [{ name: "contractId" }] }],
      widgets: [{ kind: "table", filters: [{ field: "employee.salary_eur", op: "gt" }] }],
    };
    const d = gateRegistration(sneaky, ACTOR);
    expect(d.decision).toBe("approval-required");
    expect(d.tier).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("gate 2 — outbound model request", () => {
  const CLEAN_REQUEST = { task: "summarise", facts: { openCount: 12, entity: "bensheim" } };
  const DIRTY_REQUEST = {
    task: "draft",
    facts: { applicant: { email: "e.musterfrau@example.de" }, offer: { salaryEur: 82000 } },
    notes: "confirm with e.musterfrau@example.de before Friday",
  };

  it("allows a clean request", () => {
    const d = gateModelRequest(CLEAN_REQUEST, ACTOR);
    expect(d.decision).toBe("allow");
    expect(d.audit.event).toBe("guardrails.model-request-allowed");
  });

  it("refuses a cat 3/4 request by default — fail-closed", () => {
    const d = gateModelRequest(DIRTY_REQUEST, ACTOR);
    expect(d.decision).toBe("refuse");
    expect(d.tier).toBe(4);
    expect(d.audit.event).toBe("guardrails.model-request-refused");
  });

  it("names classes only, exactly like the gateway's 422", () => {
    const d = gateModelRequest(DIRTY_REQUEST, ACTOR);
    expect(d.audit.classes).toEqual(expect.arrayContaining(["email", "salary"]));
    expect(JSON.stringify(d.audit)).not.toContain("musterfrau");
    expect(JSON.stringify(d.audit)).not.toContain("82000");
  });

  it("⭐ has NO approval path — an approval cannot open a side channel round the 422", () => {
    const approval = approvalFor(DIRTY_REQUEST, "model-request");
    const d = gateModelRequest(DIRTY_REQUEST, { ...ACTOR, approval });
    expect(d.decision).toBe("refuse");
    expect(GATE_POLICY["model-request"]).toEqual({ tier3: "refuse", tier4: "refuse" });
  });

  it("redacts with the host recipe when configured to, and re-scans the result", () => {
    const d = gateModelRequest(DIRTY_REQUEST, ACTOR, { onTier3: "redact", onTier4: "redact" });
    expect(d.decision).toBe("allow");
    expect(d.audit.event).toBe("guardrails.model-request-redacted");
    // A field whose NAME is the disclosure is dropped key-and-value: blanking
    // the value would leave `{ salaryEur: null }`, which still says this record
    // has a salary.
    expect(d.droppedClasses).toEqual(expect.arrayContaining(["salary", "email"]));
    const sent = JSON.stringify(d.redactedPayload);
    expect(sent).not.toContain("musterfrau");
    expect(sent).not.toContain("82000");
    expect(sent).not.toContain("salaryEur");
    // A free-text field survives, scrubbed with the host's own placeholder.
    expect(sent).toContain("<email>");
  });

  it("⭐ refuses rather than send a payload that survived redaction", () => {
    // A cat-3 field name is not fixable by scrubbing a value, so a config that
    // redacts only tier 4 must not quietly ship a tier-3 residue.
    const d = gateModelRequest(DIRTY_REQUEST, ACTOR, { onTier3: "refuse", onTier4: "redact" });
    expect(d.decision).toBe("refuse");
    expect(d.reason).toContain("survived redaction");
    expect(d.redactedPayload).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("gate 3 — workflow intake", () => {
  const CLEAN_WORKFLOW = [
    "# Works council clock",
    "",
    "| Step | Owner role |",
    "| --- | --- |",
    "| Open ticket | hr_reviewer |",
    "| Notify works council | hr_reviewer |",
    "",
    "Contract status moves to `wc-pending` and the clock starts.",
  ].join("\n");

  const RECORDED_WORKFLOW = [
    "# Onboarding, captured from a screen recording",
    "",
    "**Start date:** 2026-10-01",
    "Reach the requester at hr.team@example.de.",
  ].join("\n");

  const RESTRICTED_WORKFLOW = [
    "# Offer approval",
    "",
    "**Salary:** €82.000",
    "**Union membership:** yes",
  ].join("\n");

  it("allows a clean pasted workflow", () => {
    const d = gateWorkflowIntake(CLEAN_WORKFLOW, ACTOR);
    expect(d.decision).toBe("allow");
    expect(d.tier).toBeLessThanOrEqual(2);
  });

  it("does not fire on `address the works-council question` in prose", () => {
    // The word that would make this gate useless if matched everywhere.
    const d = gateWorkflowIntake("We address the works-council question in step 3.", ACTOR);
    expect(d.decision).toBe("allow");
  });

  it("holds a recording-derived cat-3 intake for a named human", () => {
    const d = gateWorkflowIntake(RECORDED_WORKFLOW, ACTOR, { intakeId: "intake-7" });
    expect(d.decision).toBe("approval-required");
    expect(d.tier).toBe(3);
    expect(d.audit.classes).toEqual(expect.arrayContaining(["email", "date"]));
    expect(d.audit.classes.some((c) => c.startsWith("provenance:"))).toBe(true);
  });

  it("allows that intake once a named human approves the exact document", () => {
    const d = gateWorkflowIntake(RECORDED_WORKFLOW, {
      ...ACTOR,
      approval: approvalFor(RECORDED_WORKFLOW, "workflow-intake"),
    });
    expect(d.decision).toBe("allow");
  });

  it("stops approving as soon as the document is edited", () => {
    const approval = approvalFor(RECORDED_WORKFLOW, "workflow-intake");
    const edited = `${RECORDED_WORKFLOW}\n**Email:** e.musterfrau@example.de`;
    expect(gateWorkflowIntake(edited, { ...ACTOR, approval }).decision).not.toBe("allow");
  });

  it("⭐ refuses a cat-4 intake outright — no approval path", () => {
    const d = gateWorkflowIntake(RESTRICTED_WORKFLOW, {
      ...ACTOR,
      approval: approvalFor(RESTRICTED_WORKFLOW, "workflow-intake"),
    });
    expect(d.decision).toBe("refuse");
    expect(d.reason).toContain("clean the source");
    expect(d.audit.classes).toEqual(expect.arrayContaining(["salary", "unionmembership"]));
  });

  it("scans BEFORE generation — the decision needs nothing but the markdown", () => {
    expect(gateWorkflowIntake(RESTRICTED_WORKFLOW, ACTOR).decision).toBe("refuse");
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("gate 4 — generated artifacts", () => {
  const CLEAN_FILES = [
    { path: "src/routes.ts", content: "export const routes = [{ path: '/open', handler: openCount }];" },
    { path: "__tests__/routes.test.ts", content: "expect(openCount({ contractId: 'C-1' })).toBe(1);" },
    { path: "fixtures/seed.json", content: '[{"contractId":"C-1001","status":"draft"}]' },
  ];

  it("allows clean emitted code, tests and fixtures", () => {
    const d = gateGeneratedArtifacts(CLEAN_FILES, ACTOR);
    expect(d.decision).toBe("allow");
  });

  it("⭐ refuses a real name and salary lifted into a generated FIXTURE", () => {
    // The classic leak: the generator reaches for the most plausible example
    // available to it, which is the one in the source workflow.
    const files = [
      ...CLEAN_FILES,
      { path: "fixtures/offers.seed.json", content: '[{"employee":"Erika Musterfrau","salaryEur":82000}]' },
    ];
    const d = gateGeneratedArtifacts(files, ACTOR);
    expect(d.decision).toBe("refuse");
    expect(d.tier).toBe(4);
    expect(d.audit.classes).toContain("salary");
  });

  it("gives test files and fixtures NO exemption", () => {
    for (const path of ["src/x.ts", "__tests__/x.test.ts", "fixtures/x.json", "x.example.json"]) {
      const d = gateGeneratedArtifacts([{ path, content: '{"email":"e.musterfrau@example.de"}' }], ACTOR);
      expect(d.decision, `${path} was exempted`).toBe("refuse");
    }
  });

  it("refuses on the PATH alone, before the file is opened", () => {
    const d = gateGeneratedArtifacts([{ path: "fixtures/salary-bands.json", content: "[]" }], ACTOR);
    expect(d.decision).toBe("refuse");
    expect(d.findings.some((f) => f.via === "field-name")).toBe(true);
  });

  it("⭐ admits no approval path — PII here is a generation bug, not a decision", () => {
    const files = [{ path: "fixtures/x.json", content: '{"iban":"DE89370400440532013000"}' }];
    const d = gateGeneratedArtifacts(files, { ...ACTOR, approval: approvalFor(files, "generated-artifacts") });
    expect(d.decision).toBe("refuse");
    expect(GATE_POLICY["generated-artifacts"]).toEqual({ tier3: "refuse", tier4: "refuse" });
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("every refusal is auditable in the host's shape", () => {
  const decisions = [
    gateRegistration(DIRTY_SPEC, ACTOR),
    gateModelRequest({ offer: { salaryEur: 1 } }, ACTOR),
    gateWorkflowIntake("**Salary:** €1", ACTOR),
    gateGeneratedArtifacts([{ path: "fixtures/x.json", content: '{"salaryEur":1}' }], ACTOR),
  ];

  for (const d of decisions) {
    it(`${d.gate}: event name, classes, tier and a named actor — and no hash`, () => {
      expect(d.audit.event).toMatch(/^guardrails\./);
      expect(d.audit.actor).toBe("karsten.haldan");
      expect(d.audit.tier).toBeGreaterThanOrEqual(3);
      expect(d.audit.classes.length).toBeGreaterThan(0);
      expect(d.audit.findingCount).toBeGreaterThan(0);
      // ⭐ The chain hash is the caller's to compute through the capability
      // adapter: `sha256(prevHash + canonicalPyJson(body))` needs the real
      // tail of the real file, and a second hasher is how a chain forks.
      expect(Object.keys(d.audit)).not.toContain("hash");
      expect(Object.keys(d.audit)).not.toContain("prevHash");
      expect(Object.keys(d.audit)).not.toContain("at");
    });
  }

  it("caps the locations it writes into an append-only chain", () => {
    const wide = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`salary_band_${i}`, "x"]));
    const d = gateRegistration(wide, ACTOR);
    expect(d.findings.length).toBeGreaterThan(25);
    expect(d.audit.locations.length).toBe(25);
    expect(d.audit.findingCount).toBe(d.findings.length);
  });
});

describe("none of the gates performs the action it judges", () => {
  it("is a pure function of its inputs", () => {
    const spec = { id: "x", offer: { salaryEur: 1 } };
    const before = JSON.stringify(spec);
    gateRegistration(spec, ACTOR);
    gateModelRequest(spec, ACTOR, { onTier4: "redact" });
    expect(JSON.stringify(spec)).toBe(before); // not mutated
    expect(gateRegistration(spec, ACTOR)).toEqual(gateRegistration(spec, ACTOR)); // deterministic
  });
});
