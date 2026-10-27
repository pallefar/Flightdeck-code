import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioApp, WorkflowReview } from "../StudioApp";
import { workflow } from "./fixtures";
import { workflowResultSchema } from "../result";
it("offers a visual workflow creator without requiring a model token", () => {
  const html = renderToStaticMarkup(<StudioApp />);
  expect(html).toContain("Workflow builder");
});
it("mounts durable workspace controls in the real Studio entry without inventing credentials", () => {
  const html = renderToStaticMarkup(<StudioApp />);
  expect(html).toContain('aria-label="Workflow workspace"');
  expect(html).toContain('aria-label="Save as new draft" disabled');
  expect(html).toContain('aria-label="Run saved revision" disabled');
  expect(html).toContain('Connect operator credential in AI builder');
});
it("offers to edit a generated workflow graph instead of only reading its ladder", () => {
  const html = renderToStaticMarkup(<WorkflowReview result={workflowResultSchema.parse(workflow)} onOpenGraph={() => {}} />);
  expect(html).toContain("Edit workflow graph");
});
