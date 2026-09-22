/**
 * Intake behaviour, end to end, with the model call injected.
 *
 * The three cases the brief names are `plans a clear prompt`, `asks rather than guesses`
 * and `refuses a capability the user never consented to`; the rest guard the seams around
 * them (repair round-trip, blocked requests, dead models).
 */

import { describe, expect, it } from "vitest";
import { planFromPrompt } from "./planner";
import type { PlanOutcome, PlannedOutcome, NeedsInputOutcome } from "./outcome";
import { fakeLlm, makeDraft } from "./test-support";
import { consentQuestionId } from "./questions";

const CLEAR_PROMPT =
  "A mini app that flags contracts missing a works-council date, visible to hr_reviewer and wc_liaison.";

const clearDraft = makeDraft(
  {
    id: "works-council-gaps",
    label: "Works council gaps",
    icon: "🗓️",
    navSection: "Contract pipeline",
    purpose: "Lists contracts with no works-council consultation date.",
    visibleToRoles: {
      roles: ["hr_reviewer", "wc_liaison"],
      evidence: "visible to hr_reviewer and wc_liaison",
    },
    capabilities: [
      { capability: "read:contracts", evidence: "contracts missing a works-council date" },
    ],
    routes: [
      {
        id: "list-gaps",
        method: "GET",
        path: "/gaps",
        summary: "Contracts with no works-council date",
        kind: "read",
        capabilities: ["read:contracts"],
      },
    ],
    tables: [
      {
        name: "gap_snapshot",
        purpose: "Last computed gap list.",
        columns: [
          { name: "contract_id", type: "text", nullable: false, pii: false },
          { name: "checked_at", type: "timestamp", nullable: false, pii: false },
        ],
      },
    ],
  },
  { understanding: "Flag contracts with no works-council date." },
);

/** The same request, but the model helpfully adds a write route nobody asked for. */
const overreachingDraft = makeDraft({
  ...(clearDraft.spec as Record<string, unknown>),
  capabilities: [
    { capability: "read:contracts", evidence: "contracts missing a works-council date" },
    { capability: "write:inbox-proposal", evidence: "file a follow-up proposal for each gap" },
  ],
  routes: [
    ...clearDraft.spec.routes,
    {
      id: "file-followup",
      method: "POST",
      path: "/followups",
      summary: "File a follow-up proposal",
      kind: "propose",
      capabilities: ["write:inbox-proposal"],
      template: "divergence",
    },
  ],
});

/** The approved-template menu @pipeline would pass (owner ruling 2026-09-22 (8)). A propose
 * route is admitted only when its template is on it, so the consent tests below that expect
 * a PLANNED proposing spec have to offer one — consent to write is necessary, not sufficient. */
const MENU = [{ id: "divergence", summary: "Flag a divergence for review.", fields: ["ticket", "note"] }];

function expectPlanned(outcome: PlanOutcome): PlannedOutcome {
  if (outcome.status !== "planned") {
    throw new Error(`expected a planned spec, got ${outcome.status}: ${JSON.stringify(outcome, null, 2)}`);
  }
  return outcome;
}

function expectNeedsInput(outcome: PlanOutcome): NeedsInputOutcome {
  if (outcome.status !== "needs_input") {
    throw new Error(`expected questions, got ${outcome.status}: ${JSON.stringify(outcome, null, 2)}`);
  }
  return outcome;
}

describe("planFromPrompt: a clear prompt", () => {
  it("produces a spec codegen can consume without interpreting anything", async () => {
    const { llm, calls } = fakeLlm(clearDraft);

    const { spec, warnings } = expectPlanned(await planFromPrompt({ prompt: CLEAR_PROMPT }, llm));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.purpose).toBe("draft");

    expect(spec.id).toBe("works-council-gaps");
    expect(spec.label).toBe("Works council gaps");
    expect(spec.navSection).toBe("Contract pipeline");
    expect(spec.visibleToRoles).toEqual(["hr_reviewer", "wc_liaison"]);
    expect(spec.capabilities).toEqual(["read:contracts"]);
    expect(spec.minHostVersion).toBe("5.0.0");
    expect(spec.sourcePrompt).toBe(CLEAR_PROMPT);

    // Everything the host derives from id is derived, never model-authored.
    expect(spec.derived).toEqual({
      routePrefix: "/api/apps/works-council-gaps",
      webModuleId: "works-council-gaps",
      navPath: "/console/apps/works-council-gaps",
      enableEnvVar: "SUBAPP_WORKS_COUNCIL_GAPS_ENABLED",
      tablePrefix: "subapp_works_council_gaps_",
    });
    expect(spec.tables[0]?.fullName).toBe("subapp_works_council_gaps_gap_snapshot");
    // "timestamp" is a spelling of a type we emit, so it is mapped rather than queried.
    expect(spec.tables[0]?.columns[1]?.type).toBe("timestamptz");

    expect(spec.routes).toEqual([
      {
        id: "list-gaps",
        method: "GET",
        path: "/gaps",
        summary: "Contracts with no works-council date",
        kind: "read",
        capabilities: ["read:contracts"],
      },
    ]);
    expect(warnings.map((warning) => warning.code)).not.toContain("capability-unused");
  });

  it("puts the prompt, the whole host vocabulary and the reply format in the system prompt", async () => {
    const { llm, calls } = fakeLlm(clearDraft);
    await planFromPrompt({ prompt: CLEAR_PROMPT, existingSubAppIds: ["docusign"] }, llm);

    const system = calls[0]?.system ?? "";
    const user = calls[0]?.user ?? "";
    for (const section of ["Overview", "Contract pipeline", "Ops & insight", "Admin", "System apps"]) {
      expect(system).toContain(section);
    }
    expect(system).toContain("read:contracts");
    expect(system).toContain("write:inbox-proposal");
    expect(system).toContain("wc_liaison");
    expect(user).toContain(CLEAR_PROMPT);
    expect(user).toContain("docusign");
  });
});

describe("planFromPrompt: a vague prompt", () => {
  const VAGUE_PROMPT = "Build me something for the contracts stuff, the usual thing we do.";

  it("asks targeted questions instead of inventing a manifest", async () => {
    const vagueDraft = makeDraft(
      {},
      {
        understanding: "Something to do with contracts, but the goal was not stated.",
        clarifications: [
          {
            field: "purpose",
            question: "What should this mini app show or decide?",
            options: null,
          },
        ],
      },
    );
    const { llm } = fakeLlm(vagueDraft);

    const outcome = expectNeedsInput(await planFromPrompt({ prompt: VAGUE_PROMPT }, llm));
    const fields = outcome.questions.map((question) => question.field);

    expect(fields).toContain("id");
    expect(fields).toContain("navSection");
    expect(fields).toContain("visibleToRoles");
    expect(fields).toContain("routes");
    expect(outcome).not.toHaveProperty("spec");

    for (const question of outcome.questions) {
      expect(question.question.trim().endsWith("?"), question.question).toBe(true);
      expect(question.because.length).toBeGreaterThan(10);
    }

    // The two closed-set questions offer the exact host literals, not free text.
    const navQuestion = outcome.questions.find((question) => question.field === "navSection");
    expect(navQuestion?.options).toEqual([
      "Overview",
      "Contract pipeline",
      "Ops & insight",
      "Admin",
      "System apps",
    ]);
    expect(outcome.questions.find((question) => question.field === "visibleToRoles")?.options).toEqual([
      "hr_preparer",
      "hr_reviewer",
      "wc_liaison",
      "legal",
      "admin",
    ]);
  });

  it("asks without spending a model call when there is nothing to plan from", async () => {
    const { llm, calls } = fakeLlm(clearDraft);

    const outcome = expectNeedsInput(await planFromPrompt({ prompt: "contracts?" }, llm));

    expect(calls).toHaveLength(0);
    expect(outcome.questions).toHaveLength(1);
    expect(outcome.questions[0]?.field).toBe("purpose");
  });

  it("does not accept an audience the user never named", async () => {
    const guessedAudience = makeDraft({
      ...(clearDraft.spec as Record<string, unknown>),
      visibleToRoles: { roles: ["admin", "legal"], evidence: "should be visible to admins and legal" },
    });
    const { llm } = fakeLlm(guessedAudience);

    const outcome = expectNeedsInput(
      await planFromPrompt({ prompt: "Flag contracts that are missing a works-council date." }, llm),
    );

    expect(outcome.questions.map((question) => question.id)).toContain("visibleToRoles");
  });
});

describe("planFromPrompt: a capability the user never consented to", () => {
  const READ_ONLY_PROMPT =
    "Flag contracts missing a works-council date for hr_reviewer and wc_liaison.";

  it("refuses to declare the scope and asks for consent instead", async () => {
    const { llm } = fakeLlm(overreachingDraft);

    const outcome = expectNeedsInput(await planFromPrompt({ prompt: READ_ONLY_PROMPT }, llm));

    const consentQuestions = outcome.questions.filter((question) => question.severity === "consent");
    expect(consentQuestions).toHaveLength(1);
    const question = consentQuestions[0];
    expect(question?.id).toBe(consentQuestionId("write:inbox-proposal"));
    expect(question?.field).toBe("capabilities");
    expect(question?.options).toEqual(["yes", "no"]);
    expect(question?.question).toContain("write:inbox-proposal");
    expect(question?.because).toContain("consent screen");

    // Nothing partial escapes: no spec, so codegen cannot pick up the scope by accident.
    expect(outcome).not.toHaveProperty("spec");
    // Consent is asked first, before cosmetic ambiguities.
    expect(outcome.questions[0]?.severity).toBe("consent");
  });

  it("grants the scope only once the user says yes", async () => {
    const { llm } = fakeLlm(overreachingDraft);

    const { spec } = expectPlanned(
      await planFromPrompt(
        {
          prompt: READ_ONLY_PROMPT,
          answers: { [consentQuestionId("write:inbox-proposal")]: "yes, it may file proposals" },
          proposalTemplates: MENU,
        },
        llm,
      ),
    );

    expect(spec.capabilities).toEqual(["read:contracts", "write:inbox-proposal"]);
    expect(spec.routes.map((route) => route.id)).toEqual(["list-gaps", "file-followup"]);
  });

  it("drops the route rather than the consent when the user says no", async () => {
    const { llm } = fakeLlm(overreachingDraft);

    const { spec, warnings } = expectPlanned(
      await planFromPrompt(
        {
          prompt: READ_ONLY_PROMPT,
          answers: { [consentQuestionId("write:inbox-proposal")]: "no, read only please" },
        },
        llm,
      ),
    );

    expect(spec.capabilities).toEqual(["read:contracts"]);
    expect(spec.routes.map((route) => route.id)).toEqual(["list-gaps"]);
    expect(warnings.map((warning) => warning.code)).toContain("route-dropped");
    expect(warnings.map((warning) => warning.code)).toContain("capability-denied");
  });

  it("treats an answer it cannot read as no answer at all", async () => {
    const { llm } = fakeLlm(overreachingDraft);

    const outcome = expectNeedsInput(
      await planFromPrompt(
        {
          prompt: READ_ONLY_PROMPT,
          answers: { [consentQuestionId("write:inbox-proposal")]: "hmm, depends what it writes" },
        },
        llm,
      ),
    );

    expect(outcome.questions.map((question) => question.id)).toContain(
      consentQuestionId("write:inbox-proposal"),
    );
  });
});

describe("planFromPrompt: requests the contract forbids", () => {
  it("blocks an auto-advance request and cites the rule", async () => {
    const blockedDraft = makeDraft(
      {},
      {
        understanding: "Auto-approve the works-council step when a date is missing.",
        blocked: {
          rule: "propose-not-mutate",
          evidence: "automatically approve the step",
          explanation: "Advancing a statutory step is the host's decision, never a sub-app's.",
        },
      },
    );
    const { llm } = fakeLlm(blockedDraft);

    const outcome = await planFromPrompt(
      {
        prompt:
          "When a contract is missing a works-council date, automatically approve the step so payroll is not held up.",
      },
      llm,
    );

    expect(outcome.status).toBe("blocked");
    if (outcome.status !== "blocked") {
      return;
    }
    expect(outcome.rule).toBe("propose-not-mutate");
    expect(outcome.evidenceGrounded).toBe(true);
    expect(outcome.contractRule).toContain("§5.7");
  });
});

describe("planFromPrompt: a model that misbehaves", () => {
  it("repairs one malformed reply and then succeeds", async () => {
    const { llm, calls } = fakeLlm("Sure! Here is the spec:\n```json\n{ \"understanding\":", clearDraft);

    const { spec } = expectPlanned(await planFromPrompt({ prompt: CLEAR_PROMPT }, llm));

    expect(spec.id).toBe("works-council-gaps");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.purpose).toBe("repair");
    expect(calls[1]?.user).toContain("PROBLEMS");
  });

  it("rejects an invented key and tells the model exactly which one", async () => {
    const withExtraKey = JSON.stringify({ ...clearDraft, confidence: 0.92 });
    const { llm, calls } = fakeLlm(withExtraKey, clearDraft);

    expectPlanned(await planFromPrompt({ prompt: CLEAR_PROMPT }, llm));

    expect(calls[1]?.user).toContain("confidence");
  });

  it("reports an unusable model instead of inventing a spec", async () => {
    const { llm, calls } = fakeLlm("I'd rather not answer in JSON.");

    const outcome = await planFromPrompt({ prompt: CLEAR_PROMPT }, llm);

    expect(outcome.status).toBe("invalid_draft");
    if (outcome.status !== "invalid_draft") {
      return;
    }
    expect(calls).toHaveLength(2);
    expect(outcome.attempts).toBe(2);
    expect(outcome.issues.join(" ")).toContain("JSON");
    expect(outcome.raw).toContain("rather not");
  });

  it("survives a thrown error and a truncated reply", async () => {
    const thrown = await planFromPrompt(
      { prompt: CLEAR_PROMPT, maxAttempts: 1 },
      fakeLlm(new Error("connection reset")).llm,
    );
    expect(thrown.status).toBe("invalid_draft");
    if (thrown.status === "invalid_draft") {
      expect(thrown.issues.join(" ")).toContain("connection reset");
    }

    const truncated = await planFromPrompt(
      { prompt: CLEAR_PROMPT, maxAttempts: 1 },
      fakeLlm({ text: JSON.stringify(clearDraft).slice(0, 40), truncated: true }).llm,
    );
    expect(truncated.status).toBe("invalid_draft");
    if (truncated.status === "invalid_draft") {
      expect(truncated.issues.join(" ")).toContain("cut off");
    }
  });
});
