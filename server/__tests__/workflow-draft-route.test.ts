/** POST /api/studio/workflow/draft — the MODEL path for a workflow draft.
 *
 * Its model-facing text is `workflow-draft`, which is human-owned: it loads
 * only from an approved, hash-pinned file (`@spec/approved-prompts`), and no
 * code writes it. Today there is none, so the route answers 409 and names
 * the non-LLM path a person can use right now (the workbench's New workflow
 * dialog, `@spec/workflow-starter`). With an approved text it still refuses
 * (501): the gated, pseudonymised workflow-draft pipeline is not built, and
 * sending a request to a model around the input gate is not a fallback. */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createMemoryGrantStore } from "../../packages/approvals/src/store";
import { createServer } from "../index";

const TOKEN = "t".repeat(40);
const OPERATOR = { actor: "Jane Operator", token: TOKEN };
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function promptsDir(approved: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-prompts-"));
  dirs.push(dir);
  if (approved) {
    const text = "An approved fixture text.\n";
    fs.writeFileSync(path.join(dir, "workflow-draft.md"), text);
    fs.writeFileSync(
      path.join(dir, "workflow-draft.approval.json"),
      JSON.stringify({
        id: "workflow-draft",
        approvedBy: "Karsten Haldan",
        approvedAt: "2026-09-25",
        sha256: crypto.createHash("sha256").update(text).digest("hex"),
      }),
    );
  }
  return dir;
}

const server = (dir: string) =>
  createServer({
    operator: OPERATOR,
    store: createMemoryGrantStore(),
    llm: async () => {
      throw new Error("no model call may happen on this route today");
    },
    approvedPromptsDir: dir,
  });

const draft = (app: ReturnType<typeof server>, auth?: string) =>
  app.inject({
    method: "POST",
    url: "/api/studio/workflow/draft",
    ...(auth === undefined ? {} : { headers: { authorization: auth } }),
    payload: { request: "an equipment request workflow" },
  });

describe("POST /api/studio/workflow/draft", () => {
  it("401 without the operator token", async () => {
    expect((await draft(server(promptsDir(false)))).statusCode).toBe(401);
  });

  it("409 while the human-owned workflow-draft text is not approved — and names the non-LLM path", async () => {
    const res = await draft(server(promptsDir(false)), `Bearer ${TOKEN}`);
    expect(res.statusCode).toBe(409);
    const body = res.json() as Record<string, unknown>;
    expect(body["code"]).toBe("approved_prompt_unavailable");
    expect(body["prompt"]).toBe("workflow-draft");
    expect(body["problem"]).toBe("missing");
    expect(String(body["fallback"])).toMatch(/New workflow/);
  });

  it("with an approved text it still refuses (501) rather than call a model around the input gate", async () => {
    const res = await draft(server(promptsDir(true)), `Bearer ${TOKEN}`);
    expect(res.statusCode).toBe(501);
    expect((res.json() as Record<string, unknown>)["code"]).toBe("workflow_draft_pipeline_not_built");
  });

  it("400 on a malformed body, naming paths only", async () => {
    const res = await server(promptsDir(false)).inject({
      method: "POST",
      url: "/api/studio/workflow/draft",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { request: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});
