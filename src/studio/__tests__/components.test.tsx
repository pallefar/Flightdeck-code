import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { StudioApp, WorkflowReview, reviewedHandoff } from "../StudioApp";
import { StudioController } from "../controller";
import { parseStudioResult } from "../result";
import { workflow } from "./fixtures";
import {hasClass,semanticBlockers,ssrTags} from './ordinary-ssr-contract';

it('shows four explicit destinations without credentials and refuses creation until checked and selected', () => {
  const html = renderToStaticMarkup(<StudioApp />);
  expect(html).toContain('aria-label="Model connection"');
  for (const id of ['codex-chatgpt', 'flightdeck', 'local', 'anthropic']) expect(html).toContain(`value="${id}" disabled`);
  expect(html).toContain('configured does not mean connected');
  expect(html).toContain('No backend credentials supplied');
  // Keep the no-generation security oracle, independent of attribute order.
  // The separate reachable setup action must not be disabled to satisfy it.
  const tags=ssrTags(html),create=tags.find(n=>n.tag==='button'&&n.attrs.type==='submit'&&n.ancestors.some(a=>hasClass(a,'studio-send-row')));
  expect(create).toBeDefined();
  expect(create!.attrs).toHaveProperty('disabled');
  expect(create!.attrs).toHaveProperty('hidden');
  const setup=tags.find(n=>n.tag==='button'&&n.attrs['data-primary-action']==='true'&&n.ancestors.some(a=>hasClass(a,'studio-send-row')));
  expect(setup).toBeDefined();expect(setup!.attrs.type).toBe('button');
  expect(setup!.attrs).not.toHaveProperty('disabled');
  expect(semanticBlockers(setup!)).toEqual([]);
});

it("mounts an idle authenticated composer without fixture generation or model calls", () => {
  const fetcher = vi.fn<typeof fetch>();
  const html = renderToStaticMarkup(<StudioApp controller={new StudioController(fetcher)} />);
  expect(html).toContain('type="password"');
  expect(html).toContain("Operator token");
  expect(html).toContain("Project ID");
  expect(html).toContain("Create draft");
  expect(html).toContain("Check connection &amp; project skills");
  expect(html).toContain("Project skills: not checked");
  expect(html).toContain("ANTHROPIC_API_KEY");
  expect(html).toContain("Draft — not deployed");
  expect(html).not.toContain("Works Council Clock");
  expect(fetcher).not.toHaveBeenCalled();
});
it("renders ordered workflow steps, human gates and skill-grounded pages distinct from the workbench", () => {
  const result = parseStudioResult(workflow);
  if (result.status !== "workflow-proposed") throw new Error("wrong test result");
  const html = renderToStaticMarkup(<WorkflowReview result={result} />);
  expect(html).toContain("Workflow draft");
  expect(html).toContain("<ol");
  expect(html.indexOf("prepare")).toBeLessThan(html.indexOf("human-review"));
  expect(html).toContain("Human gate");
  expect(html).toContain("Suggested project pages");
  expect(html).toContain("consultation-skill");
  expect(html).toContain("Review open cases");
  expect(html).toContain("Download reviewed handoff");
  expect(html).toContain("disabled");
  expect(html).not.toContain("Workbench views");
});
it("exports only an undeployed handoff with trusted endpoint constants and no model/operator identity", () => {
  const result = parseStudioResult({ ...workflow, workflow: { ...workflow.workflow, by: "model" }, pages: [{ ...workflow.pages[0], url: "https://evil.invalid" }] });
  if (result.status !== "workflow-proposed") throw new Error("wrong test result");
  const handoff = reviewedHandoff(result);
  expect(handoff).toMatchObject({ status: "draft-not-deployed", suggestedProjectId: "project-a", targets: { workflow: "/api/workflows", pages: "/api/ui/pages" } });
  expect(JSON.stringify(handoff)).not.toContain("evil.invalid");
  expect(JSON.stringify(handoff)).not.toContain('"by"');
  expect(handoff.requiresHumanReview).toContain("Verify the active host project before scoping pages.");
});
it("renders an explicit model refusal as a refusal, not generic invalid JSON", async () => {
  const controller = new StudioController(async () => new Response(JSON.stringify({ status: "model-request-refused", decision: { decision: "approval-required", reason: "Human approval required", contentHash: "abc" } })));
  await controller.submit({ connectionId: "local", prompt: "plan" }, "secret");
  const html = renderToStaticMarkup(<StudioApp controller={controller} />);
  expect(html).toContain("Studio declined this draft");
  expect(html).toContain("Human approval required");
});
it("renders needs-input questions with answer controls and no invented result", async () => {
  const controller = new StudioController(async () => new Response(JSON.stringify({ status: "needs_input", understanding: "Choose jurisdiction", questions: [{ id: "country", field: "country", severity: "required", question: "Which country?", because: "Law differs", options: ["DE", "DK"] }] })));
  await controller.submit({ connectionId: "local", prompt: "plan" }, "secret");
  const html = renderToStaticMarkup(<StudioApp controller={controller} />);
  expect(html).toContain("Which country?");
  expect(html).toContain("Law differs");
  expect(html).toContain("Submit answers");
  expect(html).not.toContain("Workflow draft");
});
