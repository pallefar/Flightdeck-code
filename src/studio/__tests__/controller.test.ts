import { expect, it, vi } from "vitest";
import { StudioController } from "../controller";
import { subapp, workflow } from "./fixtures";

it('reset invalidates review, original answers and late in-flight results', async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Promise(r => { resolve = r; }));
  const studio = new StudioController(fetcher);
  const pending = studio.submit({ connectionId: 'local', prompt: 'old', answers: { country: 'DE' } }, 'old-token');
  studio.reset();
  resolve(new Response(JSON.stringify(workflow)));
  await pending;
  await studio.answer({ country: 'DK' }, 'new-token');
  await studio.approveSkillSend('new-token');
  expect(studio.getState()).toEqual({ phase: 'idle', result: null, error: null, transcript: [], acceptedRequestId: null });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('refuses clarification under changed operator credentials', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'needs_input', questions: [{ id: 'country', question: 'Country?' }] })));
  const studio = new StudioController(fetcher);
  await studio.submit({ connectionId: 'local', prompt: 'plan' }, 'old-token');
  await studio.answer({ country: 'DE' }, 'new-token');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(studio.getState().result).toBeNull();
});

it("starts idle with no model call or generated fixture", () => {
  const fetcher = vi.fn<typeof fetch>();
  const studio = new StudioController(fetcher);
  expect(studio.getState()).toMatchObject({ phase: "idle", result: null });
  expect(fetcher).not.toHaveBeenCalled();
  expect(studio.workbench.getState().rounds).toHaveLength(0);
});
it("routes a returned workflow to review rather than a subapp round", async () => {
  const studio = new StudioController(async () => new Response(JSON.stringify(workflow)));
  await studio.submit({ connectionId: "local", prompt: "plan", projectId: "project-a" }, "secret");
  expect(studio.getState()).toMatchObject({ phase: "result", result: workflow });
  expect(studio.workbench.getState().rounds).toHaveLength(0);
});
it("adopts only real server-generated subapp files and gate findings, never typecheck or mount success", async () => {
  const body = subapp();
  const studio = new StudioController(async () => new Response(JSON.stringify(body)));
  await studio.submit({ connectionId: "local", prompt: "build a clock" }, "secret");
  const state = studio.workbench.getState();
  expect(state.rounds[0]?.candidate).toMatchObject({ files: body.outcome.generated.files, findings: body.outcome.conformance.findings, rulesRun: ["FD-X001"], notes: ["not mounted"] });
  expect(state.rounds[0]?.candidate.manifest.label).toBe("Works Council Clock");
  expect(state.runs.flatMap((run) => run.steps)).toEqual([]);
  expect(state.turns.at(-1)?.text).toContain("not deployed");
});
it("cancel aborts the fetch and ignores a late response", async () => {
  let resolve!: (value: Response) => void;
  let signal: AbortSignal | undefined;
  const studio = new StudioController(async (_url, init) => { signal = init?.signal ?? undefined; return new Promise((r) => { resolve = r; }); });
  const pending = studio.submit({ connectionId: "local", prompt: "build" }, "secret");
  studio.cancel();
  expect(signal?.aborted).toBe(true);
  resolve(new Response(JSON.stringify(subapp())));
  await pending;
  expect(studio.getState()).toMatchObject({ phase: "cancelled", result: null });
  expect(studio.workbench.getState().rounds).toHaveLength(0);
});
it("displays needs-input and resubmits the original prompt with explicit answers", async () => {
  const needs = { status: "needs_input", understanding: "Choose country", questions: [{ id: "country", field: "country", severity: "required", question: "Which country?", because: "Law differs", options: null }] };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(needs))).mockResolvedValueOnce(new Response(JSON.stringify(workflow)));
  const studio = new StudioController(fetcher);
  await studio.submit({ connectionId: "local", prompt: "plan", projectId: "project-a" }, "secret");
  expect(studio.getState().result?.status).toBe("needs_input");
  await studio.answer({ country: "DE" }, "secret");
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ connectionId: "local", prompt: "plan", projectId: "project-a", answers: { country: "DE" } });
});
it("shows errors without accepting malformed results", async () => {
  const studio = new StudioController(async () => new Response('{"status":"workflow-proposed"}'));
  await studio.submit({ connectionId: "local", prompt: "plan" }, "secret");
  expect(studio.getState()).toMatchObject({ phase: "error", result: null, error: expect.stringContaining("Invalid Studio response") });
});
