/** The Workflow dialog's seam to `@spec/workflow-starter`, and the dialog
 * itself under react-dom/server: a described workflow becomes a
 * studio-workflow-definition/1 file only once a person has named themself
 * and the statutory decision. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseWorkflowDefinition } from "@spec/process-definition";
import { buildWorkflowFile } from "../wiring";
import { WorkflowDialog } from "../workbench/components/WorkflowDialog";

describe("buildWorkflowFile — the workbench's workflow wiring", () => {
  it("a described workflow plus the person's decisions is a file the OS import reads", () => {
    const r = buildWorkflowFile({
      request: 'a workflow called "Equipment Request" with a deadline and an amount',
      by: "Jane Admin",
      statutoryConfirmedBy: "Jane Admin",
      statutory: false,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filename).toBe("equipment-request.workflow.json");
    const back = parseWorkflowDefinition(r.text);
    expect(back.ok && back.definition.intakeFields.map((f) => f.name)).toEqual(["request_id", "due_date", "amount"]);
  });

  it("without the person's names it refuses and still shows the draft", () => {
    const r = buildWorkflowFile({ request: "leave requests", by: "", statutoryConfirmedBy: "", statutory: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/by|statutoryConfirmedBy/);
    expect(r.preview).toMatch(/"name": "Leave Request"/);
  });
});

describe("WorkflowDialog", () => {
  it("renders the request, the two names, the statutory choice and a disabled download until they are given", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowDialog, { build: buildWorkflowFile, onSave: () => {}, onClose: () => {} }),
    );
    expect(html).toMatch(/Describe the workflow/);
    expect(html).toMatch(/Your name/);
    expect(html).toMatch(/Statutory steps decided by/);
    expect(html).toMatch(/statutory step/i);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Download workflow file/);
  });
});
