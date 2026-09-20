/**
 * The Cowork-workflow input path, end to end.
 *
 * The fixture under `__fixtures__/` is a byte-for-byte copy of a real skill from the host
 * repo (`skills/orchestrate-workflow/SKILL.md`), so these tests fail if the shape of a real
 * workflow drifts away from what the parser expects. It is read from disk *here*, in a test -
 * never in the module under test. A sub-app route reaches the host only through the injected
 * capability adapter, which grants no filesystem read, so the markdown always arrives in the
 * request body (contract §5.3).
 *
 * The three cases the brief names are `converts a real skill file end to end`,
 * `refuses a workflow that would auto-advance a statutory step` and
 * `asks which nav section rather than guessing one`. The rest hold the edges around them -
 * most importantly the negative twin of the refusal: the real skill's own step 3 says
 * "never self-approve", and a converter that refused on the keyword would refuse it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWorkflowMarkdown } from "./workflow";
import { autoAdvanceSentence, planFromWorkflow } from "./workflowPlan";
import { miniAppSpecSchema, formatIssues } from "./schema";
import type { MiniAppSpec } from "./schema";
import { consentQuestionId } from "./questions";
import { NAV_SECTIONS } from "./vocabulary";
import type { PlanOutcome } from "./outcome";

const fixture = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

/** `skills/orchestrate-workflow/SKILL.md`, verbatim. */
const ORCHESTRATE = fixture("orchestrate-workflow.SKILL.md");
/** `skills/quality-check/SKILL.md`, verbatim - a real skill with no `## Procedure` heading. */
const QUALITY_CHECK = fixture("quality-check.SKILL.md");

/** What a person answers once, for the three things no workflow carries. */
const ANSWERS = {
  navSection: "Contract pipeline",
  visibleToRoles: "hr_preparer, hr_reviewer, legal",
  icon: "🧭",
};

const AUTO_ADVANCE = `---
name: close-works-council-clock
description: >
  Close the German works-council consultation clock once the statutory seven days have run and
  move the contract on to the offer letter.
---

# close-works-council-clock

## Procedure
1. **Watch the clock** — read \`manifest.json\` and work out when the seven-day works-council window opened.
2. **Close the clock** — when the deadline expires, automatically mark the statutory works-council step approved and advance the contract to the offer letter.
3. **Tell the liaison** — post a Teams card to the works-council liaison saying it is done.
`;

const CHECKLIST = `---
name: de-clause-checklist
description: >
  Walk a preparer through the four mandatory clauses a German employment contract must carry,
  in the order the pack lists them.
---

# de-clause-checklist

## Procedure
1. **Show the four mandatory clauses** — list them in the pack's order with the statute each one comes from.
2. **Explain the seven-day clock** — describe what the works-council window means for the preparer.
3. **Point at the template** — name the approved template each clause is drawn from.
`;

const VAGUE = `---
name: tidy-things
description: >
  Tidy things up a bit.
---

# tidy-things

## Procedure
1. Look at the list.
2. Sort it out.
`;

const TWO_NUMBERED_SECTIONS = `---
name: two-lists
description: >
  A workflow that never says which of its two numbered lists is the procedure.
---

# two-lists

## Setup
1. Open the folder.
2. Read the manifest.

## Teardown
1. Close the folder.
2. Say goodbye.
`;

const plan = (workflow: string, answers: Record<string, string> = {}): PlanOutcome =>
  planFromWorkflow({ workflow, answers });

function expectPlanned(outcome: PlanOutcome): MiniAppSpec {
  if (outcome.status !== "planned") {
    throw new Error(`expected a planned spec, got ${outcome.status}: ${JSON.stringify(outcome, null, 2)}`);
  }
  return outcome.spec;
}

const questionIds = (outcome: PlanOutcome): string[] =>
  outcome.status === "needs_input" ? outcome.questions.map((question) => question.id) : [];

const warningCodes = (outcome: PlanOutcome): string[] =>
  outcome.status === "planned" || outcome.status === "needs_input"
    ? outcome.warnings.map((warning) => warning.code)
    : [];

describe("reading a real Cowork workflow", () => {
  it("reads the frontmatter, the sections and the numbered procedure", () => {
    const parsed = parseWorkflowMarkdown(ORCHESTRATE);
    if (!parsed.ok) {
      throw new Error(`expected a parse, got: ${parsed.issues.join(" | ")}`);
    }

    expect(parsed.doc.frontmatter.name).toBe("orchestrate-workflow");
    // The folded `>` scalar is rejoined into one paragraph, not left as ragged lines.
    expect(parsed.doc.frontmatter.description).toContain(
      "Drive an employment contract through its country-specific workflow step-graph",
    );
    expect(parsed.doc.frontmatter.description).not.toContain("\n");
    expect(parsed.doc.sections.map((section) => section.heading)).toEqual([
      "Why",
      "Inputs",
      "Procedure",
      "Operating modes (the autonomy slider)",
      "RPA boundary",
      "Guardrails",
      "Honors the per-step review policy + audit (always)",
    ]);
    expect(parsed.doc.stepsSection).toEqual({ heading: "Procedure", inferred: false });
    expect(parsed.doc.steps.map((step) => step.ordinal)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(parsed.doc.steps.map((step) => step.title)).toEqual([
      "Read state",
      "Validate consistency",
      "Enforce the step-graph as gates",
      "Run the next step",
      "At every hand-off that needs a human",
      "Update state",
    ]);
    // A wrapped continuation line belongs to its step; inline markdown is flattened.
    expect(parsed.doc.steps[0]?.detail).toBe(
      "load manifest.json; see which artifacts exist in input/ works-council/ offer-letter/ contract/ audit/ and which steps are done / audited / approved.",
    );
  });

  it("keeps the document's own numbering, including 2b", () => {
    const parsed = parseWorkflowMarkdown(`## Procedure
1. First thing.
2. Second thing.
2b. **Crew log** — the bit that was squeezed in later.
3. Third thing.
`);
    if (!parsed.ok) {
      throw new Error(parsed.issues.join(" | "));
    }
    expect(parsed.doc.steps.map((step) => step.ordinal)).toEqual(["1", "2", "2b", "3"]);
    expect(parsed.doc.steps[2]?.title).toBe("Crew log");
  });

  it("refuses markdown that carries no numbered steps at all", () => {
    const parsed = parseWorkflowMarkdown("# notes\n\nJust some prose, no procedure.\n");
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.issues.join(" ")).toContain("Procedure");
  });

  it("refuses an empty body rather than inventing a document", () => {
    expect(parseWorkflowMarkdown("   ").ok).toBe(false);
  });
});

describe("converting a real skill file", () => {
  const planned = expectPlanned(plan(ORCHESTRATE, ANSWERS));

  it("derives the identity the frontmatter really carries", () => {
    expect(planned.id).toBe("orchestrate-workflow");
    expect(planned.label).toBe("Orchestrate workflow");
    expect(planned.purpose).toBe(
      "Drive an employment contract through its country-specific workflow step-graph by reading and updating its on-disk folder and manifest.json; idempotent and resumable across human and RPA hand-offs.",
    );
    expect(planned.derived.routePrefix).toBe("/api/apps/orchestrate-workflow");
    expect(planned.derived.enableEnvVar).toBe("SUBAPP_ORCHESTRATE_WORKFLOW_ENABLED");
    // Provenance: the generated files quote the document they came from.
    expect(planned.sourcePrompt).toContain("## Procedure");
  });

  it("turns every procedure step into a step of the mini app, in order", () => {
    expect(planned.steps?.map((step) => step.ordinal)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(planned.steps?.map((step) => step.key)).toEqual([
      "read-state",
      "validate-consistency",
      "enforce-the-step-graph-as-gates",
      "run-the-next-step",
      "at-every-hand-off-that-needs-a-human",
      "update-state",
    ]);
    expect(planned.steps?.map((step) => step.kind)).toEqual([
      "read",
      "read",
      "display",
      "read",
      "propose",
      "propose",
    ]);
    // "never advance out of order, never self-approve" is a step a person decides.
    expect(planned.steps?.[2]?.gated).toBe(true);
  });

  it("shortens a step that runs past what a page can render, and says so", () => {
    const long = `---
name: long-step
description: >
  One step with far too much in it.
---

## Procedure
1. **Do the thing** — ${"detail that keeps going and going. ".repeat(40)}
`;
    const outcome = plan(long, ANSWERS);
    const spec = expectPlanned(outcome);
    expect(spec.steps?.[0]?.detail.length).toBeLessThanOrEqual(600);
    expect(warningCodes(outcome)).toContain("step-detail-truncated");
  });

  it("declares no table, ever", () => {
    expect(planned.tables).toEqual([]);
  });

  it("holds only the scopes its steps use, and one route per scope", () => {
    expect(planned.capabilities).toEqual(["read:contracts", "write:inbox-proposal"]);
    expect(planned.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /steps",
      "GET /contracts",
      "POST /proposals",
    ]);
    // The step list itself costs nothing: it is the sub-app's own text.
    expect(planned.routes[0]?.capabilities).toEqual([]);
  });

  it("says out loud that it narrowed the state-writing step to a proposal", () => {
    const outcome = plan(ORCHESTRATE, ANSWERS);
    expect(warningCodes(outcome)).toContain("step-narrowed");
    expect(warningCodes(outcome)).toContain("tables-omitted");
    const narrowed =
      outcome.status === "planned"
        ? outcome.warnings.find((warning) => warning.code === "step-narrowed")?.message ?? ""
        : "";
    expect(narrowed).toContain("step 6");
    expect(narrowed).toContain("proposal");
  });
});

describe("the refusal", () => {
  it("refuses a workflow whose step auto-advances a statutory gate", () => {
    const outcome = plan(AUTO_ADVANCE, ANSWERS);
    if (outcome.status !== "blocked") {
      throw new Error(`expected a refusal, got ${outcome.status}`);
    }
    expect(outcome.rule).toBe("propose-not-mutate");
    expect(outcome.contractRule).toContain("§5.7");
    // The reason is named: the offending sentence, quoted from the workflow itself.
    expect(outcome.evidence).toContain("automatically mark the statutory works-council step approved");
    expect(outcome.evidenceGrounded).toBe(true);
    expect(outcome.explanation).toContain("Step 2");
    expect(outcome.explanation).toContain("Close the clock");
  });

  it("refuses before asking anything, so no answer can buy the auto-advance", () => {
    expect(plan(AUTO_ADVANCE).status).toBe("blocked");
    expect(
      plan(AUTO_ADVANCE, { ...ANSWERS, [consentQuestionId("write:inbox-proposal")]: "yes" }).status,
    ).toBe("blocked");
  });

  it("reads the whole sentence, not a keyword", () => {
    // The prohibition is what separates a rule from a request. Without it the real skill's
    // own step 3 would be refused, and this is the line that would silently go wrong.
    expect(
      autoAdvanceSentence("Never advance out of order, never self-approve, never skip a statutory step."),
    ).toBeNull();
    expect(
      autoAdvanceSentence("Only an authenticated human may approve; the app never advances a gate."),
    ).toBeNull();
    expect(
      autoAdvanceSentence("When the clock expires, automatically approve the works-council step."),
    ).not.toBeNull();
    // A bare "not" somewhere else in the sentence must not launder an auto-advance.
    expect(
      autoAdvanceSentence("Automatically approve the works-council step when the reviewer has not replied."),
    ).not.toBeNull();
    // Nothing gated, nothing to refuse.
    expect(autoAdvanceSentence("Automatically refresh the list every minute.")).toBeNull();
  });

  it("does not refuse the real skill, whose own step forbids the same thing", () => {
    // orchestrate-workflow step 3: "Never advance out of order, never self-approve, never skip
    // a statutory step". A converter matching on keywords would refuse this file.
    expect(plan(ORCHESTRATE, ANSWERS).status).toBe("planned");
  });
});

describe("least privilege", () => {
  it("gives a workflow whose steps only display things no capabilities at all", () => {
    const planned = expectPlanned(plan(CHECKLIST, ANSWERS));
    expect(planned.capabilities).toEqual([]);
    expect(planned.steps?.every((step) => step.kind === "display")).toBe(true);
    expect(planned.steps?.every((step) => step.capabilities.length === 0)).toBe(true);
    expect(planned.routes).toHaveLength(1);
    expect(planned.tables).toEqual([]);
  });

  it("narrows a step to a display rather than dropping the app when a scope is declined", () => {
    const outcome = plan(ORCHESTRATE, {
      ...ANSWERS,
      [consentQuestionId("write:inbox-proposal")]: "no",
    });
    const planned = expectPlanned(outcome);
    expect(planned.capabilities).toEqual(["read:contracts"]);
    expect(planned.steps?.map((step) => step.kind)).toEqual([
      "read",
      "read",
      "display",
      "read",
      "display",
      "display",
    ]);
    expect(planned.routes.some((route) => route.kind === "propose")).toBe(false);
    expect(warningCodes(outcome)).toContain("capability-denied");
  });
});

describe("asking rather than guessing", () => {
  it("asks which nav section, offering the host's five literals", () => {
    const outcome = plan(VAGUE);
    expect(outcome.status).toBe("needs_input");
    expect(questionIds(outcome)).toContain("navSection");
    const question =
      outcome.status === "needs_input"
        ? outcome.questions.find((candidate) => candidate.id === "navSection")
        : undefined;
    expect(question?.options).toEqual(NAV_SECTIONS);
    expect(question?.because).toContain("UI_NAV_SECTIONS");
  });

  it("never guesses a nav section, even for a workflow it otherwise understands", () => {
    const outcome = plan(ORCHESTRATE, { visibleToRoles: "legal", icon: "🧭" });
    expect(questionIds(outcome)).toEqual(["navSection"]);
    expect(outcome.status).toBe("needs_input");
  });

  it("asks who may see it, and for an icon, instead of picking either", () => {
    const outcome = plan(VAGUE);
    expect(questionIds(outcome)).toEqual(["icon", "navSection", "visibleToRoles"]);
    // A question outcome carries no spec - half a spec never reaches codegen.
    expect(outcome.status === "needs_input" && "spec" in outcome).toBe(false);
  });

  it("re-asks when an answer is not one of the host's literals", () => {
    const outcome = plan(ORCHESTRATE, { ...ANSWERS, navSection: "Contracts" });
    expect(questionIds(outcome)).toContain("navSection");
  });

  it("accepts a nav section whose spelling only differs in case", () => {
    const outcome = plan(ORCHESTRATE, { ...ANSWERS, navSection: "contract pipeline" });
    expect(expectPlanned(outcome).navSection).toBe("Contract pipeline");
    expect(warningCodes(outcome)).toContain("nav-section-normalized");
  });

  it("asks for an id when the workflow has no name to derive one from", () => {
    const outcome = plan(`## Procedure\n1. Read the contract folder.\n`, ANSWERS);
    expect(questionIds(outcome)).toContain("id");
  });

  it("asks for a different id when one is already shipped", () => {
    const outcome = planFromWorkflow({
      workflow: ORCHESTRATE,
      answers: ANSWERS,
      existingSubAppIds: ["orchestrate-workflow"],
    });
    expect(questionIds(outcome)).toContain("id:collision");
  });

  it("asks which section holds the steps when the document does not say", () => {
    const outcome = plan(TWO_NUMBERED_SECTIONS, ANSWERS);
    expect(questionIds(outcome)).toEqual(["steps:section"]);
    const question =
      outcome.status === "needs_input" ? outcome.questions[0] : undefined;
    expect(question?.options).toEqual(["Setup", "Teardown"]);

    const answered = plan(TWO_NUMBERED_SECTIONS, { ...ANSWERS, "steps:section": "Setup" });
    expect(expectPlanned(answered).steps?.map((step) => step.title)).toEqual([
      "Open the folder",
      "Read the manifest",
    ]);
  });

  it("reads the only numbered section of a real skill that has no Procedure heading, and says so", () => {
    const outcome = plan(QUALITY_CHECK, ANSWERS);
    const planned = expectPlanned(outcome);
    expect(planned.steps?.map((step) => step.title)).toEqual([
      "Completeness",
      "Mandatory content",
      "Template diff",
      "Translation parity",
    ]);
    expect(warningCodes(outcome)).toContain("steps-section-inferred");
  });
});

describe("the spec a conversion produces", () => {
  it("is a spec the schema already knew how to validate", () => {
    const planned = expectPlanned(plan(ORCHESTRATE, ANSWERS));
    expect(miniAppSpecSchema.safeParse(planned).success).toBe(true);
  });

  it("cannot carry a table beside its steps", () => {
    const planned = expectPlanned(plan(ORCHESTRATE, ANSWERS));
    const withTable = {
      ...planned,
      tables: [
        {
          name: "run_log",
          fullName: "subapp_orchestrate_workflow_run_log",
          purpose: "Rows nobody asked for.",
          columns: [{ name: "ticket", type: "text", nullable: false, pii: false }],
        },
      ],
    };
    const result = miniAppSpecSchema.safeParse(withTable);
    expect(result.success).toBe(false);
    expect(result.success ? "" : formatIssues(result.error).join(" | ")).toContain("database-free");
  });

  it("cannot let a step hold a scope the manifest does not declare", () => {
    const planned = expectPlanned(plan(CHECKLIST, ANSWERS));
    const widened = {
      ...planned,
      steps: (planned.steps ?? []).map((step, index) =>
        index === 0 ? { ...step, kind: "read" as const, capabilities: ["read:contracts" as const] } : step,
      ),
    };
    const result = miniAppSpecSchema.safeParse(widened);
    expect(result.success).toBe(false);
    expect(result.success ? "" : formatIssues(result.error).join(" | ")).toContain(
      "the manifest does not declare it",
    );
  });

  it("leaves the prompt path's spec shape untouched - steps are simply absent", () => {
    const fromPrompt = {
      specVersion: 1,
      id: "works-council-gaps",
      label: "Works council gaps",
      version: "0.1.0",
      minHostVersion: "5.0.0",
      icon: "🗓️",
      navSection: "Contract pipeline",
      purpose: "Lists contracts with no works-council consultation date.",
      sourcePrompt: "Flag contracts missing a works-council date.",
      capabilities: ["read:contracts"],
      visibleToRoles: ["hr_reviewer"],
      derived: {
        routePrefix: "/api/apps/works-council-gaps",
        webModuleId: "works-council-gaps",
        navPath: "/console/apps/works-council-gaps",
        enableEnvVar: "SUBAPP_WORKS_COUNCIL_GAPS_ENABLED",
        tablePrefix: "subapp_works_council_gaps_",
      },
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
          fullName: "subapp_works_council_gaps_gap_snapshot",
          purpose: "Last computed gap list.",
          columns: [{ name: "contract_id", type: "text", nullable: false, pii: false }],
        },
      ],
      widgets: [],
      settingsPanel: null,
    };
    const result = miniAppSpecSchema.safeParse(fromPrompt);
    expect(result.success).toBe(true);
    expect(result.success ? result.data.steps : "parsed").toBeUndefined();
  });
});
