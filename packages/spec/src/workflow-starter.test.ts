import { describe, expect, it } from "vitest";

import { parseWorkflowDefinition, workflowDefinitionSchema } from "./process-definition";
import { finishWorkflowDraft, workflowDraftFromRequest } from "./workflow-starter";

describe("workflowDraftFromRequest — a described workflow becomes a draft without a model", () => {
  it("names it from `called \"X\"`, derives the slug, and leaves every human decision open", () => {
    const d = workflowDraftFromRequest('A workflow called "Equipment Request" where staff ask for a laptop by a date');
    expect(d.name).toBe("Equipment Request");
    expect(d.slug).toBe("equipment-request");
    expect(d.by).toBeNull();
    expect(d.statutoryConfirmedBy).toBeNull();
    expect(d.statutorySteps).toEqual([]);
    expect(d.steps[0]).toBe("intake_received");
    expect(d.steps.at(-1)).toBe("complete");
    expect(d.steps).not.toContain("statutory");
    expect(workflowDefinitionSchema.safeParse(d).success).toBe(true);
  });

  it("the request text is never copied into the file — only an explicit name is", () => {
    const d = workflowDraftFromRequest("Anna Kowalski needs a reference letter workflow");
    expect(JSON.stringify(d)).not.toMatch(/Kowalski|Anna/);
    expect(d.name).toBe("Reference Letter");
  });

  it("picks intake fields from the words used, always with a required request id", () => {
    const d = workflowDraftFromRequest("track purchase approvals with an amount, a deadline, a category and an urgent flag");
    const byName = Object.fromEntries(d.intakeFields.map((f) => [f.name, f]));
    expect(byName["request_id"]).toEqual({ name: "request_id", type: "string", required: true });
    expect(byName["amount"]?.type).toBe("number");
    expect(byName["due_date"]?.type).toBe("date");
    expect(byName["category"]?.type).toBe("enum");
    expect(byName["urgent"]?.type).toBe("boolean");
  });

  it("no match at all is still a valid draft (a generic request)", () => {
    const d = workflowDraftFromRequest("something");
    expect(d.name).toBe("New Request");
    expect(workflowDefinitionSchema.safeParse(d).success).toBe(true);
  });
});

describe("finishWorkflowDraft — the person's decisions make it a file", () => {
  const draft = workflowDraftFromRequest('a workflow called "Equipment Request"');

  it("with no statutory step: the named author and confirmer, and a file the OS import reads", () => {
    const r = finishWorkflowDraft(draft, { by: "Jane Admin", statutoryConfirmedBy: "Jane Admin", statutory: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = parseWorkflowDefinition(r.text);
    expect(back.ok).toBe(true);
    expect(back.ok && back.definition.statutorySteps).toEqual([]);
  });

  it("a statutory step the person ticked is inserted before approve and locked", () => {
    const r = finishWorkflowDraft(draft, { by: "Jane Admin", statutoryConfirmedBy: "Max Legal", statutory: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = parseWorkflowDefinition(r.text);
    if (!back.ok) throw new Error(back.error);
    expect(back.definition.statutorySteps).toEqual(["statutory"]);
    expect(back.definition.steps.indexOf("statutory")).toBe(back.definition.steps.indexOf("approve") - 1);
    expect(back.definition.statutoryConfirmedBy).toBe("Max Legal");
  });

  it("refuses without a named human — a placeholder is not a name", () => {
    const r = finishWorkflowDraft(draft, { by: "agent", statutoryConfirmedBy: "Jane Admin", statutory: false });
    expect(r.ok).toBe(false);
    const r2 = finishWorkflowDraft(draft, { by: "Jane Admin", statutoryConfirmedBy: "", statutory: false });
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.error).toMatch(/statutoryConfirmedBy/);
  });
});
