/**
 * Owner ruling 2026-09-22 (8): a proposing route files only a proposal template the owner
 * approved. The model picks a template id; it never writes the fields a proposal carries into
 * the review inbox.
 *
 * @spec's half of that is three properties, each tested here:
 *
 *   1. The wire format cannot carry fields. A draft route has `template` and nothing that
 *      names a field, and the object is strict, so an invented `fields` key fails the parse.
 *   2. The gates admit a propose route only when its template is on the menu the caller
 *      offered (the approved catalogue, supplied by @pipeline). Anything else is a question,
 *      never a default.
 *   3. The prompt shows the model the menu, and says there is nothing to pick when it is
 *      empty.
 *
 * Read-only routes are unaffected: a template on one is narrowed away with a warning.
 */

import { describe, expect, it } from "vitest";
import { draftSchema } from "./draft";
import { defaultGateContext, evaluateDraft } from "./gates";
import type { GateContext } from "./gates";
import type { PlanOutcome } from "./outcome";
import { buildSystemPrompt } from "./prompt";
import { formatIssues, parseMiniAppSpec } from "./schema";
import type { MiniAppSpec } from "./schema";
import type { ProposalTemplateChoice } from "./templates";
import { makeDraft } from "./test-support";
import { HOST_VERSION, derivationsFor } from "./vocabulary";

const MENU: readonly ProposalTemplateChoice[] = [
  { id: "divergence", summary: "Flag a divergence for review.", fields: ["ticket", "note"] },
  { id: "handoff", summary: "Propose the hand-off ping.", fields: ["ticket", "step"] },
];

const PROMPT = "Show contracts for hr_reviewer and flag a divergence for review.";

const readRoute = {
  method: "GET",
  path: "/contracts",
  summary: "Contracts",
  kind: "read",
  capabilities: ["read:contracts"],
};

const proposeRoute = (template: string | null) => ({
  method: "POST",
  path: "/flag",
  summary: "Flag a divergence for review",
  kind: "propose",
  capabilities: ["write:inbox-proposal"],
  template,
});

const body = (routes: readonly unknown[]) => ({
  id: "divergence-desk",
  label: "Divergence desk",
  icon: "🧭",
  navSection: "Contract pipeline",
  purpose: "Flags a divergence on a contract folder for a person to review.",
  visibleToRoles: { roles: ["hr_reviewer"], evidence: "for hr_reviewer" },
  capabilities: [
    { capability: "read:contracts", evidence: "Show contracts" },
    { capability: "write:inbox-proposal", evidence: "flag a divergence for review" },
  ],
  routes,
});

const run = (routes: readonly unknown[], context: Partial<GateContext> = {}): PlanOutcome =>
  evaluateDraft(makeDraft(body(routes)), { ...defaultGateContext(PROMPT), proposalTemplates: MENU, ...context });

const questions = (outcome: PlanOutcome) => (outcome.status === "needs_input" ? outcome.questions : []);

describe("the wire format cannot carry fields", () => {
  it("⭐ refuses a draft route that writes its own fields", () => {
    const parsed = draftSchema.safeParse({
      understanding: "x",
      spec: { routes: [{ ...proposeRoute("divergence"), fields: [{ name: "salary", type: "number" }] }] },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : formatIssues(parsed.error).join(" | ")).toMatch(/Unrecognized key/);
  });

  it("defaults template to null, so a read-only draft needs no change", () => {
    const parsed = draftSchema.parse({ understanding: "x", spec: { routes: [readRoute] } });
    expect(parsed.spec.routes[0]?.template).toBeNull();
  });
});

describe("the gates admit only an offered template", () => {
  it("⭐ plans a propose route that names a template on the menu", () => {
    const outcome = run([readRoute, proposeRoute("divergence")]);
    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") return;
    expect(outcome.spec.routes.find((r) => r.kind === "propose")?.template).toBe("divergence");
    expect(outcome.spec.capabilities).toEqual(["read:contracts", "write:inbox-proposal"]);
  });

  it("asks which template when a propose route names none — and offers exactly the menu", () => {
    const asked = questions(run([readRoute, proposeRoute(null)]));
    const question = asked.find((q) => q.id.startsWith("routes:template:"));
    expect(question?.field).toBe("routes");
    expect(question?.options).toEqual(["divergence", "handoff"]);
    expect(question?.because).toMatch(/owner/);
  });

  it("asks rather than guesses when the template is not on the menu", () => {
    const outcome = run([readRoute, proposeRoute("salary-change")]);
    expect(outcome.status).toBe("needs_input");
    expect(questions(outcome).find((q) => q.id.startsWith("routes:template:"))?.options).toEqual(["divergence", "handoff"]);
  });

  it("says so, with nothing to pick, when no template has been approved", () => {
    const outcome = run([readRoute, proposeRoute("divergence")], { proposalTemplates: [] });
    expect(outcome.status).toBe("needs_input");
    const question = questions(outcome).find((q) => q.id.startsWith("routes:template:"));
    expect(question?.options).toBeNull();
    expect(question?.question).toMatch(/no proposal template has been approved/i);
  });

  it("offers no templates when the caller passes none — the default is the empty menu", () => {
    const outcome = evaluateDraft(makeDraft(body([readRoute, proposeRoute("divergence")])), defaultGateContext(PROMPT));
    expect(outcome.status).toBe("needs_input");
  });

  it("does not ask about a propose route whose write consent was declined — it is dropped", () => {
    const outcome = run([readRoute, proposeRoute(null)], {
      answers: { "consent:write:inbox-proposal": "no" },
    });
    expect(outcome.status).toBe("planned");
    expect(questions(outcome)).toEqual([]);
  });

  it("strips a template from a read-only route, with a warning — narrowing is free", () => {
    const outcome = run([{ ...readRoute, template: "divergence" }]);
    expect(outcome.status).toBe("planned");
    if (outcome.status !== "planned") return;
    expect(outcome.spec.routes[0]).not.toHaveProperty("template");
    expect(outcome.warnings.map((w) => w.code)).toContain("route-template-stripped");
  });
});

describe("the schema", () => {
  const spec = (routes: MiniAppSpec["routes"], capabilities: MiniAppSpec["capabilities"]): unknown => ({
    specVersion: 1,
    id: "divergence-desk",
    label: "Divergence desk",
    version: "0.1.0",
    minHostVersion: "5.0.0",
    icon: "🧭",
    navSection: "Contract pipeline",
    purpose: "p",
    sourcePrompt: "s",
    capabilities,
    visibleToRoles: ["hr_reviewer"],
    derived: derivationsFor("divergence-desk"),
    routes,
    tables: [],
    widgets: [],
    settingsPanel: null,
  });

  it("carries a template on a propose route", () => {
    const result = parseMiniAppSpec(
      spec(
        [{ id: "flag", method: "POST", path: "/flag", summary: "s", kind: "propose", capabilities: ["write:inbox-proposal"], template: "divergence" }],
        ["write:inbox-proposal"],
      ),
    );
    expect(result.success).toBe(true);
  });

  it("refuses a template on a read route", () => {
    const result = parseMiniAppSpec(
      spec(
        [{ id: "list", method: "GET", path: "/list", summary: "s", kind: "read", capabilities: ["read:contracts"], template: "divergence" }],
        ["read:contracts"],
      ),
    );
    expect(result.success).toBe(false);
    expect(result.success ? "" : formatIssues(result.error).join(" | ")).toMatch(/read-only.*template/);
  });
});

describe("the prompt", () => {
  const input = { prompt: PROMPT, answers: [], existingSubAppIds: [], hostVersion: HOST_VERSION };

  it("⭐ lists the approved templates the model may pick, and what each writes", () => {
    const system = buildSystemPrompt({ ...input, proposalTemplates: MENU });
    expect(system).toContain("divergence");
    expect(system).toContain("ticket, note");
    expect(system).toMatch(/never write.*fields/i);
  });

  it("says there is nothing to pick when no template is approved", () => {
    const system = buildSystemPrompt(input);
    expect(system).toMatch(/no proposal template has been approved/i);
  });
});
