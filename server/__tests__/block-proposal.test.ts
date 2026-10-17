import { expect, it, vi } from "vitest";
import { createServer } from "../index";
import { createMemoryGrantStore } from "../../packages/approvals/src/store";
const operator = { actor: "Karsten Haldan", token: "a-sufficiently-long-operator-token" };
const headers = { authorization: `Bearer ${operator.token}` };
const block = { id: "reviewFields", label: "review fields", baseType: "set", defaults: { fields: { reviewNeeded: true } }, description: "Mark an incoming request for review." };
it("proposes a validated reusable block only through the authenticated model route", async () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify(block) }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm });
  try {
    const denied = await app.inject({ method: "POST", url: "/api/studio/blocks/propose", payload: { prompt: "Mark incoming requests for review." } });
    expect(denied.statusCode).toBe(401);
    expect(llm).not.toHaveBeenCalled();
    const response = await app.inject({ method: "POST", url: "/api/studio/blocks/propose", headers, payload: { prompt: "Mark incoming requests for review." } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "block-proposed", reviewRequired: true, block });
    expect(llm).toHaveBeenCalledTimes(1);
  } finally { await app.close(); }
});
it.each([
  { ...block, baseType: "approval" },
  { ...block, id: "http" },
  { ...block, code: "eval(userInput)" },
  { ...block, baseType: "http", defaults: { method: "GET", url: "https://user:pass@example.test" } },
])("refuses unsafe or reserved model blocks %#", async badBlock => {
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm: async () => ({ text: JSON.stringify(badBlock) }) });
  try {
    const response = await app.inject({ method: "POST", url: "/api/studio/blocks/propose", headers, payload: { prompt: "Mark incoming requests for review." } });
    expect(response.json().status).toBe("invalid_block");
    expect(response.json()).not.toHaveProperty("block");
  } finally { await app.close(); }
});
it("rejects confidential intake before spending a model call", async () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify(block) }));
  const app = createServer({ operator, llmBindingId: "explicit-fixture/model/policy-v1", store: createMemoryGrantStore(), llm });
  try {
    const response = await app.inject({ method: "POST", url: "/api/studio/blocks/propose", headers, payload: { prompt: "Track salary 98000 EUR and sick leave." } });
    expect(response.json().status).toBe("model-request-refused");
    expect(llm).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
