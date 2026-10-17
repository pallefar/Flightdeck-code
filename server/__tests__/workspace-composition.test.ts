import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createServer } from "../index";
import { createMemoryGrantStore } from "../../packages/approvals/src/store";
import { createFileWorkflowWorkspaceStore } from "../workflow-workspace-store";
import { createWorkflowTemplate } from "../../src/workflow/WorkflowEditor";

it("mounts authenticated durable draft and real execution routes in the actual Studio composition root", async () => {
  const base = await realpath(process.env.TMPDIR!);
  const dir = await mkdtemp(join(base, "studio-workspace-mount-"));
  const operator = { actor: "Maren Keller", token: "integration-test-operator-token-only" };
  const workspaceStore = createFileWorkflowWorkspaceStore(join(dir, "workspace.json"));
  const options = { operator, store: createMemoryGrantStore(), workflowWorkspaceStore: workspaceStore };
  const app = createServer(options);
  const url = "/api/studio/workspaces/local-demo/workflows";
  const headers = { authorization: `Bearer ${operator.token}` };
  try {
    const unauthorized = await app.inject({ method: "POST", url, payload: { graph: createWorkflowTemplate("branch") } });
    expect(unauthorized.statusCode).toBe(401);
    const created = await app.inject({ method: "POST", url, headers, payload: { graph: createWorkflowTemplate("branch") } });
    expect(created.statusCode).toBe(201);
    const draft = created.json().draft;
    const loaded = await app.inject({ method: "GET", url: `${url}/${draft.id}`, headers });
    expect(loaded.json().draft.graph).toEqual(draft.graph);
    const runResponse = await app.inject({ method: "POST", url: `${url}/${draft.id}/runs`, headers, payload: { revision: draft.revision, input: { approved: true } } });
    expect(runResponse.statusCode).toBe(201);
    const run = runResponse.json().run;
    expect(run.result.status).toBe("completed");
    expect(run.result.output).toEqual({ approved: true });
    const readBack = await app.inject({ method: "GET", url: `${url}/${draft.id}/runs/${run.id}`, headers });
    expect(readBack.json().run).toEqual(run);
    await app.close();
    const restarted = createServer({ ...options, workflowWorkspaceStore: createFileWorkflowWorkspaceStore(join(dir, "workspace.json")) });
    try {
      const restored = await restarted.inject({ method: "GET", url: `${url}/${draft.id}/runs/${run.id}`, headers });
      expect(restored.json().run.result.output).toEqual({ approved: true });
      const wrongProject = await restarted.inject({ method: "GET", url: `/api/studio/workspaces/another-project/workflows/${draft.id}`, headers });
      expect(wrongProject.statusCode).toBe(404);
    } finally { await restarted.close(); }
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
