import { describe, expect, it, vi } from "vitest";
import { createDraft, proposeBlock } from "../client";
import { subapp, workflow } from "./fixtures";

describe("Studio authenticated transport", () => {
  it('explains a native-only server refusal without a JSON fallback or raw error disclosure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider detail', { status: 409 }));
    await expect(createDraft({ connectionId: 'anthropic', authoringEngine: 'native-v1', prompt: 'Prepare a draft.' }, 'development-only', new AbortController().signal, fetcher)).rejects.toThrow('Native authoring is unavailable for this server or connection. No fallback is attempted.');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toHaveProperty('authoringEngine', 'native-v1');
  });
  it.each([['local', 'native-v1'], ['anthropic', 'native-v2']])('refuses an unsupported explicit engine or destination before transport: %s / %s', async (connectionId, authoringEngine) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createDraft({ prompt: 'Prepare a draft.', connectionId, authoringEngine } as never, 'development-only', new AbortController().signal, fetcher)).rejects.toThrow('Native authoring requires the supported native-v1 engine and Anthropic connection. No fallback is attempted.');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('binds block proposals to the exact selected ID and suppresses cancelled results', async () => {
    let resolve!: (r: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Promise(r => { resolve = r; }));
    const abort = new AbortController();
    const request = proposeBlock('set a field', 'anthropic', 'secret', abort.signal, fetcher);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ prompt: 'set a field', connectionId: 'anthropic' });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ signal: abort.signal, credentials: 'same-origin', headers: { Authorization: 'Bearer secret' } });
    abort.abort(); resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('refuses an absent or unknown connection before transport', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const connectionId of [undefined, 'unknown']) {
      await expect(createDraft({ prompt: 'plan', connectionId } as never, 'secret', new AbortController().signal, fetcher)).rejects.toThrow('Select a model connection');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('handles unavailable selection without exposing response errors', async () => {
    await expect(createDraft({ prompt: 'plan', connectionId: 'local' }, 'secret', new AbortController().signal, async () => new Response('sk-secret', { status: 409 }))).rejects.toThrow('Selected model connection unavailable');
  });
  it("sends an explicit same-origin create request with bearer auth and project answers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(workflow)));
    const signal = new AbortController().signal;
    const result = await createDraft({ connectionId: "local", prompt: "Plan consultation", projectId: "project-a", answers: { country: "DE" } }, "operator-secret", signal, fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/studio/create", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer operator-secret" }, body: JSON.stringify({ connectionId: "local", prompt: "Plan consultation", projectId: "project-a", answers: { country: "DE" } }), signal, credentials: "same-origin" });
    expect(result).toEqual(workflow);
  });
  it.each([{ status: "workflow-proposed" }, { ...workflow, determination: { target: "subapp", reason: "bad" } }, { ...workflow, pages: [{ ...workflow.pages[0], navSection: "admin" }] }, { ...workflow, workflow: { ...workflow.workflow, steps: [42] } }, { ...workflow, projectId: "https://attacker.invalid" }, { status: "surprise" }])("rejects malformed or inconsistent results %#", async (body) => {
    await expect(createDraft({ connectionId: "local", prompt: "plan" }, "secret", new AbortController().signal, async () => new Response(JSON.stringify(body)))).rejects.toThrow("Invalid Studio response");
  });
  it.each([401, 404, 500, 503])("explains HTTP %s without echoing server secrets", async (status) => {
    await expect(createDraft({ connectionId: "local", prompt: "plan" }, "secret", new AbortController().signal, async () => new Response('{"error":"sk-secret"}', { status }))).rejects.toThrow(/operator token|dev:server|server-side|ANTHROPIC_API_KEY/);
  });
  it("explains an unavailable server", async () => {
    await expect(createDraft({ connectionId: "local", prompt: "plan" }, "secret", new AbortController().signal, async () => { throw new TypeError("fetch failed"); })).rejects.toThrow("npm run dev:server");
  });
  it("accepts needs-input with stable question ids for the next request", async () => {
    const body = { status: "needs_input", understanding: "Need a jurisdiction", questions: [{ id: "country", field: "country", severity: "required", question: "Which country?", because: "Statutory rules differ", options: ["DE", "DK"] }] };
    expect(await createDraft({ connectionId: "local", prompt: "plan" }, "secret", new AbortController().signal, async () => new Response(JSON.stringify(body)))).toEqual(body);
  });
  it("accepts a generated subapp and retains server gate evidence", async () => {
    const body = subapp();
    expect(await createDraft({ connectionId: "local", prompt: "build" }, "secret", new AbortController().signal, async () => new Response(JSON.stringify(body)))).toEqual(body);
  });
  it("accepts workflow-specific needs-input without subapp question metadata", async () => {
    const body = { status: "needs_input", questions: [{ id: "projectSkills", question: "Which project skills?" }] };
    expect(await createDraft({ connectionId: "local", prompt: "plan" }, "secret", new AbortController().signal, async () => new Response(JSON.stringify(body)))).toEqual(body);
  });
  it.each([{ status: "invalid_workflow", issues: ["ungrounded"] }, { status: "invalid_determination", issues: ["ambiguous"] }, { status: "blocked", rule: "APP-F02", explanation: "No hot install", evidence: "install" }, { status: "model-request-refused", decision: { decision: "approval-required", reason: "Human approval required", contentHash: "abc" } }])("preserves explicit refusal outcomes %#", async (body) => {
    expect(await createDraft({ connectionId: "local", prompt: "plan" }, "secret", new AbortController().signal, async () => new Response(JSON.stringify(body)))).toMatchObject(body);
  });
  it("rejects an unrelated project instead of accepting pages for a different scope", async () => {
    await expect(createDraft({ connectionId: "local", prompt: "plan", projectId: "project-b" }, "secret", new AbortController().signal, async () => new Response(JSON.stringify(workflow)))).rejects.toThrow("project");
  });
  it.each([ { ...workflow, pages: [{ ...workflow.pages[0], sourceSkillIds: ["invented"] }] }, { ...workflow, pages: [{ ...workflow.pages[0], stepIds: ["invented"] }] }, { ...workflow, workflow: { ...workflow.workflow, statutorySteps: ["invented"] } } ])("rejects broken page and statutory references %#", async (body) => {
    await expect(createDraft({ connectionId: "local", prompt: "plan" }, "secret", new AbortController().signal, async () => new Response(JSON.stringify(body)))).rejects.toThrow("Invalid Studio response");
  });
  it("accepts translation refusals with the pipeline's actual at/needs shape", async () => {
    const body = { status: "subapp-result", target: "subapp", determination: { target: "subapp", reason: "Application" }, outcome: { status: "translation-refused", refusals: [{ at: "routes", needs: "declared operation" }] }, skillSourceState: "empty" };
    expect(await createDraft({ connectionId: "local", prompt: "build" }, "secret", new AbortController().signal, async () => new Response(JSON.stringify(body)))).toEqual(body);
  });
  it("passes through cancellation instead of reporting a server failure", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(createDraft({ connectionId: "local", prompt: "plan" }, "secret", controller.signal, async () => { throw new DOMException("Aborted", "AbortError"); })).rejects.toMatchObject({ name: "AbortError" });
  });
});
