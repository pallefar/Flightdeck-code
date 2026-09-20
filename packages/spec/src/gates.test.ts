/**
 * The gates in isolation: no model, no planner, just draft in / outcome out.
 *
 * These are the rules that decide what Studio may settle by itself (anything that narrows
 * what the generated app can do) and what it must ask about (anything that widens it).
 */

import { describe, expect, it } from "vitest";
import { defaultGateContext, evaluateDraft, readConsentAnswers } from "./gates";
import type { GateContext } from "./gates";
import { consentQuestionId } from "./questions";
import type { PlanOutcome } from "./outcome";
import { makeDraft } from "./test-support";

const PROMPT = "Flag contracts missing a works-council date for hr_reviewer.";

const baseBody = {
  id: "works-council-gaps",
  label: "Works council gaps",
  icon: "🗓️",
  navSection: "Contract pipeline",
  purpose: "Lists contracts with no works-council consultation date.",
  visibleToRoles: { roles: ["hr_reviewer"], evidence: "for hr_reviewer" },
  capabilities: [{ capability: "read:contracts", evidence: "contracts missing a works-council date" }],
  routes: [
    {
      method: "GET",
      path: "/gaps",
      summary: "Contracts with no works-council date",
      kind: "read",
      capabilities: ["read:contracts"],
    },
  ],
};

const body = (overrides: Record<string, unknown> = {}) => ({ ...baseBody, ...overrides });

const run = (overrides: Record<string, unknown> = {}, context?: Partial<GateContext>): PlanOutcome =>
  evaluateDraft(makeDraft(body(overrides)), { ...defaultGateContext(PROMPT), ...context });

const warningCodes = (outcome: PlanOutcome): string[] =>
  outcome.status === "planned" || outcome.status === "needs_input"
    ? outcome.warnings.map((warning) => warning.code)
    : [];

const questionIds = (outcome: PlanOutcome): string[] =>
  outcome.status === "needs_input" ? outcome.questions.map((question) => question.id) : [];

describe("least privilege", () => {
  it("drops a consented scope no route actually uses", () => {
    const outcome = run(
      {
        capabilities: [
          ...baseBody.capabilities,
          { capability: "write:inbox-proposal", evidence: "file a proposal in the inbox" },
        ],
      },
      { prompt: `${PROMPT} It should also file a proposal in the inbox later.` },
    );

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    expect(outcome.spec.capabilities).toEqual(["read:contracts"]);
    expect(warningCodes(outcome)).toContain("capability-unused");
  });

  it("strips a write scope from a route that only reads", () => {
    const outcome = run({
      routes: [{ ...baseBody.routes[0], capabilities: ["read:contracts", "write:inbox-proposal"] }],
    });

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    expect(outcome.spec.capabilities).toEqual(["read:contracts"]);
    expect(outcome.spec.routes[0]?.capabilities).toEqual(["read:contracts"]);
    expect(warningCodes(outcome)).toContain("route-write-scope-stripped");
  });

  it("asks when a route implies a scope the draft never even claimed", () => {
    const outcome = run({
      capabilities: baseBody.capabilities,
      routes: [
        ...baseBody.routes,
        {
          method: "POST",
          path: "/followups",
          summary: "File a follow-up",
          kind: "propose",
          capabilities: [],
        },
      ],
    });

    expect(questionIds(outcome)).toContain(consentQuestionId("write:inbox-proposal"));
    expect(outcome).not.toHaveProperty("spec");
  });

  it("asks about a scope name the host does not grant", () => {
    const outcome = run({
      capabilities: [{ capability: "read:payroll", evidence: "contracts missing a works-council date" }],
    });

    expect(questionIds(outcome)).toContain("capabilities:unknown:read:payroll");
  });

  it("will not let a refusal be quoted back as consent", () => {
    const outcome = run(
      {
        capabilities: [
          ...baseBody.capabilities,
          { capability: "write:inbox-proposal", evidence: "write proposals to the inbox" },
        ],
        routes: [
          ...baseBody.routes,
          {
            method: "POST",
            path: "/followups",
            summary: "File a follow-up",
            kind: "propose",
            capabilities: ["write:inbox-proposal"],
          },
        ],
      },
      {
        answers: { [consentQuestionId("write:inbox-proposal")]: "no, it must not write proposals to the inbox" },
      },
    );

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    expect(outcome.spec.capabilities).toEqual(["read:contracts"]);
    expect(outcome.spec.routes).toHaveLength(1);
    expect(warningCodes(outcome)).toContain("route-dropped");
  });
});

describe("host literals", () => {
  it("accepts a nav section that differs only in spelling", () => {
    const outcome = run({ navSection: "contract pipeline" });

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    expect(outcome.spec.navSection).toBe("Contract pipeline");
    expect(warningCodes(outcome)).toContain("nav-section-normalized");
  });

  it("asks about a nav section that differs in meaning", () => {
    const outcome = run({ navSection: "Contracts" });

    expect(questionIds(outcome)).toContain("navSection");
    if (outcome.status !== "needs_input") {
      return;
    }
    const question = outcome.questions.find((entry) => entry.id === "navSection");
    expect(question?.severity).toBe("ambiguity");
    expect(question?.options).toHaveLength(5);
  });

  it("asks about a role the shell cannot enforce", () => {
    const outcome = run({ visibleToRoles: { roles: ["hr_reviewer", "payroll"], evidence: "for hr_reviewer" } });

    expect(questionIds(outcome)).toContain("visibleToRoles");
    if (outcome.status !== "needs_input") {
      return;
    }
    expect(outcome.questions.find((entry) => entry.id === "visibleToRoles")?.question).toContain("payroll");
  });

  it("rejects a label that is an i18n key and an icon that is prose", () => {
    expect(questionIds(run({ label: "app.contracts.title" }))).toContain("label");
    expect(questionIds(run({ icon: "calendar" }))).toContain("icon");
  });
});

describe("identity", () => {
  it("slugifies an id the model spelled as a title", () => {
    const outcome = run({ id: "Works Council Gaps" });

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    expect(outcome.spec.id).toBe("works-council-gaps");
    expect(warningCodes(outcome)).toContain("id-normalized");
  });

  it("asks for another id when one is already shipped, because an id is locked", () => {
    const outcome = run({}, { existingSubAppIds: ["works-council-gaps"] });

    expect(questionIds(outcome)).toContain("id:collision");
  });
});

describe("routes", () => {
  it("normalizes a path the model wrote with the prefix and mixed case", () => {
    const outcome = run({
      routes: [{ ...baseBody.routes[0], path: "/api/apps/works-council-gaps/Open Gaps/" }],
    });

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    expect(outcome.spec.routes[0]?.path).toBe("/open-gaps");
    expect(outcome.spec.routes[0]?.id).toBe("contracts-with-no-works-council-date");
  });

  it("asks when a path cannot be salvaged", () => {
    const outcome = run({ routes: [{ ...baseBody.routes[0], path: "../../etc/passwd" }] });

    expect(questionIds(outcome)).toContain("routes");
  });

  it("asks what to build when the draft has no routes left", () => {
    const outcome = run({ routes: [] });

    expect(questionIds(outcome)).toContain("routes");
  });

  it("keeps route ids unique without asking", () => {
    const outcome = run({
      routes: [
        baseBody.routes[0],
        { ...baseBody.routes[0], path: "/gaps/:contractId", summary: "Contracts with no works-council date" },
      ],
    });

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    expect(outcome.spec.routes.map((route) => route.id)).toEqual([
      "contracts-with-no-works-council-date",
      "contracts-with-no-works-council-date-2",
    ]);
  });
});

describe("tables and widgets", () => {
  it("prefixes, shortens and type-maps tables", () => {
    const outcome = run({
      tables: [
        {
          name: "Snapshot of every contract we flagged during the nightly works council sweep",
          purpose: "Nightly snapshot.",
          columns: [
            { name: "Contract ID", type: "string", nullable: false, pii: false },
            { name: "employee_name", type: "text", nullable: true, pii: true },
          ],
        },
      ],
    });

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    const table = outcome.spec.tables[0];
    expect(table?.fullName.startsWith("subapp_works_council_gaps_")).toBe(true);
    expect(table?.fullName.length).toBeLessThanOrEqual(63);
    expect(table?.columns[0]).toEqual({ name: "contract_id", type: "text", nullable: false, pii: false });
    // PII columns stay marked so codegen never puts their values in an audit event.
    expect(table?.columns[1]?.pii).toBe(true);
    expect(warningCodes(outcome)).toContain("table-name-truncated");
  });

  it("drops a table with no usable columns and a widget it cannot render", () => {
    const outcome = run({
      tables: [{ name: "empty", purpose: "nothing", columns: [] }],
      widgets: [
        { id: null, title: "Open gaps", kind: "count" },
        { id: null, title: "Trend", kind: "sparkline" },
      ],
    });

    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") {
      return;
    }
    expect(outcome.spec.tables).toHaveLength(0);
    expect(outcome.spec.widgets).toEqual([{ id: "open-gaps", title: "Open gaps", kind: "count" }]);
    expect(warningCodes(outcome)).toEqual(expect.arrayContaining(["table-dropped", "widget-dropped"]));
  });
});

describe("readConsentAnswers", () => {
  it("reads yes and no, and treats anything else as unanswered", () => {
    const parsed = readConsentAnswers({
      [consentQuestionId("read:contracts")]: "Yes please",
      [consentQuestionId("write:inbox-proposal")]: "No - read only",
      navSection: "Ops & insight",
    });

    expect([...parsed.granted]).toEqual(["read:contracts"]);
    expect([...parsed.denied]).toEqual(["write:inbox-proposal"]);
    expect(parsed.quotableSources).toEqual(["Yes please", "Ops & insight"]);

    const ambiguous = readConsentAnswers({ [consentQuestionId("read:contracts")]: "depends" });
    expect([...ambiguous.granted]).toEqual([]);
    expect([...ambiguous.denied]).toEqual([]);
  });
});

describe("blocked requests", () => {
  it("refuses a mutation request and does not ask a question instead", () => {
    const outcome = evaluateDraft(
      makeDraft(body(), {
        blocked: {
          rule: "propose-not-mutate",
          evidence: "approve the step automatically",
          explanation: "A sub-app may not resolve a gated step.",
        },
      }),
      defaultGateContext("Please approve the step automatically once the date is filled in."),
    );

    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") {
      return;
    }
    expect(outcome.evidenceGrounded).toBe(true);
    expect(outcome.contractRule).toContain("propose");
  });
});
