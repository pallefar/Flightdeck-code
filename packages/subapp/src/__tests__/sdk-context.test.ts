import { afterEach, expect, it } from "vitest";
import { CapabilityDeniedError } from "../server/subapps/capabilities.js";
import { buildHarness, fakeCapabilities, studioBundle, type Harness } from "./support.js";

it("waits for a delayed proposal path before auditing or answering success", async () => {
  const caps = fakeCapabilities();
  let finish!: (path: string) => void;
  let started!: () => void;
  const pending = new Promise<string>((resolve) => { finish = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  Object.assign(caps, { writeInboxProposal: () => { started(); return pending; } });
  harness = await buildHarness({ caps });
  let answered = false;
  const response = harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: studioBundle() }).then((r) => { answered = true; return r; });
  await entered;
  await new Promise((resolve) => setImmediate(resolve));
  const prematureAudit = caps.calls.some((c) => c.method === "auditAppend");
  const prematureAnswer = answered;
  finish("memory/proposals/actual-host-file.json");
  const result = await response;
  expect(prematureAudit).toBe(false);
  expect(prematureAnswer).toBe(false);
  expect(result.json().proposalPath).toBe("memory/proposals/actual-host-file.json");
  expect(caps.calls.find((c) => c.method === "auditAppend")?.args[0]).toMatchObject({ proposalPath: "memory/proposals/actual-host-file.json" });
});

it.each(["denied", "failed"])("does not audit or report success after an async proposal write is %s", async (mode) => {
  const caps = fakeCapabilities();
  caps.writeInboxProposal = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (mode === "denied") throw new CapabilityDeniedError("grant revoked at effect time", "write:inbox-proposal");
    throw new Error("write failed");
  };
  harness = await buildHarness({ caps });
  const response = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: studioBundle() });
  expect(response.statusCode).toBe(mode === "denied" ? 403 : 500);
  expect(response.json()).not.toHaveProperty("proposalPath");
  expect(response.json()).not.toHaveProperty("status", "proposed");
  expect(caps.written.size).toBe(0);
  expect(caps.calls.some((c) => c.method === "auditAppend")).toBe(false);
});

let harness: Harness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

it.each(["GET", "POST"] as const)("passes the actual %s request to capability resolution despite workspace grants", async (method) => {
  const caps = fakeCapabilities();
  let actor: unknown;
  harness = await buildHarness({ caps, resolveCapabilities: async (id, req) => {
    expect(id).toBe("te-ops");
    actor = req?.principal?.username;
    if (actor === "ada") throw new CapabilityDeniedError("actor denied", "write:inbox-proposal");
    return caps;
  } });
  const response = await harness.app.inject({ method, url: "/api/apps/studio/proposals", ...(method === "POST" ? { payload: studioBundle() } : {}) });
  expect(actor).toBe("ada");
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe("capability_denied");
  expect(caps.calls).toEqual([]);
});
