import { expect, it, vi } from "vitest";
import { parseStudioResult } from "../result";
import { StudioController } from "../controller";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioApp } from "../StudioApp";
const hash = "a".repeat(64);
const pending = { status: "model-request-refused", decision: { decision: "refuse", reason: "Human review required", contentHash: hash }, review: { hash, preview: "review context", unchecked: ["indirect-identifiers"] }, skillSourceState: "loaded" };
it("shows the masked context and scan limitations before offering a send action", async () => {
  const controller = new StudioController(async () => new Response(JSON.stringify(pending)));
  await controller.submit({ connectionId: "local", prompt: "review requests", projectId: "alpha" }, "test-token");
  const markup = renderToStaticMarkup(createElement(StudioApp, { controller }));
  expect(markup).toContain("Review skill context before sending");
  expect(markup).toContain("review context");
  expect(markup).toContain("indirect-identifiers");
  expect(markup).toContain("I reviewed this exact context");
});
it("retains a bounded review packet rather than silently stripping it", () => {
  expect(parseStudioResult(pending)).toHaveProperty("review.hash", hash);
});
it("accepts the server's not-loaded and grant refusal outcomes", () => {
  expect(parseStudioResult({ status: "invalid_determination", issues: ["unavailable"], skillSourceState: "not-loaded" }).skillSourceState).toBe("not-loaded");
  expect(parseStudioResult({ status: "grant-refused", decision: { allowed: false, reason: "no-grant", contentHash: hash }, skillSourceState: "not-loaded" }).status).toBe("grant-refused");
});
it("resubmits the original request only after the explicit review action", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(pending), { headers: { "content-type": "application/json" } }));
  const controller = new StudioController(fetcher);
  await controller.submit({ connectionId: "local", prompt: "review requests", projectId: "alpha" }, "test-token");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((controller as unknown as { approveSkillSend?: unknown }).approveSkillSend).toBeTypeOf("function");
  await (controller as unknown as { approveSkillSend(token: string): Promise<void> }).approveSkillSend("test-token");
  expect(fetcher).toHaveBeenCalledTimes(2);
  const init = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect(JSON.parse(init[1].body as string)).toEqual({ connectionId: "local", prompt: "review requests", projectId: "alpha", reviewedSkillHash: hash });
});
