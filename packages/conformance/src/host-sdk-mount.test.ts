/** Executes only the independent recorder, never the real host deployment. */
import { describe, expect, it } from "vitest";
import { mountProbe, type MountOptions } from "./verify/mount";
import { FLIGHTDECK_HOST_SURFACE } from "./verify/host-surface";

const context = { id: "sdk-probe", manifestPath: "server/subapps/sdk-probe/manifest.ts", routePrefix: "/api/apps/sdk-probe", tablePrefix: "subapp_sdk_probe_", indexPrefix: "idx_sdk_probe_", locate: () => null };
async function probe(body: string, scopes = ["read:contracts", "write:inbox-proposal"], options: Partial<MountOptions> = {}) {
  const source = `export const manifest = { id: "sdk-probe", capabilities: ${JSON.stringify(scopes)}, initSchema() {}, registerRoutes(app, ctx) {
    app.post("/api/apps/sdk-probe/x", async (req, reply) => {
      if (!globalThis.__fdProbe.killSwitch("sdk-probe")) return reply.code(403).send({});
      await globalThis.__fdProbe.installRow(req.project.id, "sdk-probe");
      ${body}
    });
  } };`;
  return mountProbe(new Map([["server/subapps/sdk-probe/manifest.js", source]]), context, { repoRoot: process.cwd(), hostRuntime: FLIGHTDECK_HOST_SURFACE.runtime, ...options });
}
const enabled = (result: Awaited<ReturnType<typeof probe>>) => result.probe?.routes[0]?.enabled;

describe("request-bound asynchronous SDK recorder", () => {
  it("does not trust a probe result printed before a detached process failure", async () => {
    const result = await probe(`setTimeout(() => process.exit(7), 30); return reply.send({});`);
    expect(result.run?.exitCode).toBe(7);
    expect(result.ran).toBe(false);
    expect(result.findings.map((f) => f.rule)).toEqual(["FD-R009"]);
  });

  it("refuses a modeled grant revocation at effect time before returning a path or success audit", async () => {
    const result = await probe(`const caps = await ctx.capabilitiesFor(req.workspace.id, req);
      try {
        const path = await caps.writeInboxProposal("sdk-probe-file.json", {});
        caps.auditAppend({ event: "write.success" });
        return reply.send({ path });
      } catch (err) {
        if (err.name !== "CapabilityDeniedError") throw err;
        return reply.code(403).send({});
      }`, undefined, { capabilityScenario: "revoked-before-write" });
    expect(enabled(result)?.status, result.output).toBe(403);
    expect(enabled(result)?.events).toContain("capability:reauthorize");
    expect(enabled(result)?.events).toContain("audit:subapp.capability-denied");
    expect(enabled(result)?.events).not.toContain("capability:write:settled");
    expect(enabled(result)?.events).not.toContain("audit:write.success");
  });

  it.each([`caps.auditAppend({ event: "write.success" }); return reply.send({ path });`, `return reply.send({ path });`, `return { path };`])("rejects premature path/audit without awaiting a write: %s", async (finish) => {
    const result = await probe(`const caps = await ctx.capabilitiesFor(req.workspace.id, req);
      const path = caps.writeInboxProposal("sdk-probe-file.json", {});
      ${finish}`);
    expect(result.findings.map((f) => f.rule), result.output).toContain("FD-R008");
    expect(enabled(result)?.threw?.name).toBe("TypeError");
    expect(enabled(result)?.events).not.toContain("audit:write.success");
  });

  it("acquires asynchronously with the same request/workspace/project and uses synchronous reads", async () => {
    const result = await probe(`const pending = ctx.capabilitiesFor(req.workspace.id, req);
      if (!(pending instanceof Promise)) throw new TypeError("adapter was synchronous");
      const caps = await pending;
      if (!Array.isArray(caps.readContracts()) || !Array.isArray(caps.listOwnInboxProposals())) throw new TypeError("reads were promises");
      const receipt = caps.auditAppend({ event: "read.success" });
      if (typeof receipt.hash !== "string") throw new TypeError("missing audit receipt");
      return reply.send({});`);
    expect(result.findings, result.output).toEqual([]);
    expect(enabled(result)?.events).toContain("capability:context:probe-request:probe-workspace:default:probe");
  });

  it.each(["ctx.capabilitiesFor('foreign', req)", "ctx.capabilitiesFor(req.workspace.id)", "ctx.capabilitiesFor(req.workspace.id, {...req})"])("refuses an unbound acquisition: %s", async (call) => {
    const result = await probe(`try { await ${call}; throw new TypeError("accepted foreign context"); }
      catch (err) { if (err.name !== "CapabilityDeniedError") throw err; return reply.code(403).send({}); }`);
    expect(enabled(result)?.status, result.output).toBe(403);
    expect(enabled(result)?.events).toContain("audit:subapp.capability-denied");
    expect(enabled(result)?.events).not.toContain("capability:readContracts");
  });

  it("settles async writes before successful audit or path return", async () => {
    const result = await probe(`const caps = await ctx.capabilitiesFor(req.workspace.id, req);
      const pending = caps.writeInboxProposal("sdk-probe-file.json", {});
      if (!(pending instanceof Promise)) throw new TypeError("write was synchronous");
      const path = await pending;
      if (path !== "memory/proposals/sdk-probe-file.json") throw new TypeError("wrong path");
      caps.auditAppend({ event: "write.success" });
      return reply.send({ path });`);
    expect(result.findings, result.output).toEqual([]);
    expect(enabled(result)?.events).toEqual(["guard:killSwitch", "guard:installRow", "capability:acquire", "capability:context:probe-request:probe-workspace:default:probe", "capability:writeInboxProposal", "capability:reauthorize", "capability:write:settled", "audit:write.success"]);
  });

  it("retains grant failure and denial audit without write effects", async () => {
    const result = await probe(`const caps = await ctx.capabilitiesFor(req.workspace.id, req);
      try { await caps.writeInboxProposal("sdk-probe-file.json", {}); throw new TypeError("ungranted write accepted"); }
      catch (err) { if (err.name !== "CapabilityDeniedError") throw err; return reply.code(403).send({}); }`, []);
    expect(enabled(result)?.status, result.output).toBe(403);
    expect(enabled(result)?.events).toContain("audit:subapp.capability-denied");
    expect(enabled(result)?.events).not.toContain("capability:write:settled");
    expect(enabled(result)?.events).not.toContain("audit:write.success");
  });
});
