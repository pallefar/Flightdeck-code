import { hasHostSdk, typecheckSdk } from "./sdk-test-support";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterAll, expect, it } from "vitest";
import { generateSubApp } from "../generate";
import { contractRunSpec, wcClockSpec } from "../fixtures/specs";

const repo = resolve(import.meta.dirname, "../../../..");
const scratch = process.env.TMPDIR ?? join(process.env.HOME!, ".hermes/cache/scratch");
const root = mkdtempSync(join(scratch, "sdk-emitted-"));
const generated = generateSubApp(contractRunSpec);
for (const file of generated.files.filter((f) => f.kind !== "patch")) {
  const target = join(root, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.contents);
}
writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function exercise(body: string): unknown {
  writeFileSync(join(root, "probe.ts"), `import Fastify from "fastify";
import { registerContractRunRoutes } from "./server/subapps/contract-run/routes/index.js";
import { CapabilityDeniedError } from "./server/subapps/capabilities.js";
process.env.SUBAPP_CONTRACT_RUN_ENABLED = "true";
const app = Fastify();
app.addHook("onRequest", async (req) => {
  Object.assign(req, { workspace: { id: "permissive", db: null, root: ${JSON.stringify(root)} }, project: { id: "general" }, principal: { username: "denied-actor", displayName: "Request actor" } });
});
const events: unknown[] = [];
const caps = { readContracts: () => [{ ticket: "DE-1", folderName: "DE-1", dir: "/private" }], listOwnInboxProposals: () => [], writeInboxProposal: async () => "memory/proposals/actual.json", auditAppend: (event: unknown) => { events.push(event); return { hash: "test" }; } };
${body}
await app.close();
`);
  return JSON.parse(execFileSync(join(repo, "node_modules/.bin/tsx"), [join(root, "probe.ts")], { cwd: root, encoding: "utf8" }));
}

it("generated insert audit resolves capabilities with the same request", () => {
  for (const file of generateSubApp(wcClockSpec).files.filter((f) => f.kind === "routes-index" || f.kind === "routes-domain" || f.path === "server/subapps/wc-clock/guard.ts")) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents);
  }
  const result = exercise(`
import { registerWcClockRoutes } from "./server/subapps/wc-clock/routes/index.js";
process.env.SUBAPP_WC_CLOCK_ENABLED = "true";
let actor = null;
app.addHook("onRequest", async (req) => { req.workspace.db = { prepare: () => ({ run: async () => ({ changes: 1 }) }) }; });
registerWcClockRoutes(app, { capabilitiesFor: async (id, req) => { actor = req?.principal?.username ?? null; return caps; } });
const res = await app.inject({ method: "POST", url: "/api/apps/wc-clock/clocks", payload: { ticket: "DE-1", startedAt: "2026-10-13", state: "running", days: 1, statutory: false } });
console.log(JSON.stringify({ actor, status: res.statusCode, events }));
`);
  expect(result).toMatchObject({ actor: "denied-actor", status: 201, events: [{ event: "wc-clock.clock-started" }] });
});

it("standalone resolution refuses foreign request context rather than granting its local workspace", () => {
  const result = exercise(`
import { buildStandaloneServer } from "./standalone/server.js";
const local = buildStandaloneServer({ allowAnonymous: true, dataRoot: ${JSON.stringify(join(root, "local-data"))} });
local.addHook("onRequest", async (req) => { req.workspace = { id: "foreign", db: null, root: ${JSON.stringify(root)} }; });
const res = await local.inject({ method: "GET", url: "/api/apps/contract-run/proposals" });
console.log(JSON.stringify({ status: res.statusCode, body: res.json() }));
await local.close();
`);
  expect(result).toMatchObject({ status: 403, body: { code: "capability_denied" } });
});

it("typechecks the unmodified emitted standalone tree with request-bound routes", () => {
  expect(typecheckSdk(root, "standalone/server.ts")).toBe("");
});

it.skipIf(!hasHostSdk)("typechecks emitted routes and standalone adapter against the live host SDK method declarations", () => {
  expect(typecheckSdk(root, "standalone/server.ts", true)).toBe("");
});

it.each(["denied", "failed"])("generated proposals never audit or answer success on async write %s", (mode) => {
  const result = exercise(`
caps.writeInboxProposal = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  if (${JSON.stringify(mode)} === "denied") throw new CapabilityDeniedError("effect-time revocation", "write:inbox-proposal");
  throw new Error("write failed");
};
registerContractRunRoutes(app, { capabilitiesFor: async () => caps });
const res = await app.inject({ method: "POST", url: "/api/apps/contract-run/flag", payload: { ticket: "DE-1" } });
console.log(JSON.stringify({ status: res.statusCode, body: res.json(), events }));
`);
  expect(result).toMatchObject({ status: mode === "denied" ? 403 : 500, events: [] });
  expect(result).not.toHaveProperty("body.proposalPath");
  expect(result).not.toHaveProperty("body.alreadyFiled", false);
});

it("standalone async proposal writes real data and refuses escaping filenames", () => {
  const result = exercise(`
import fs from "node:fs";
import path from "node:path";
import { makeStandaloneCapabilities } from "./standalone/capabilities.js";
const data = ${JSON.stringify(join(root, "written-data"))};
const localCaps = makeStandaloneCapabilities({ root: data });
const pending = localCaps.writeInboxProposal("contract-run-real.json", { actor: "server" });
const isPromise = pending instanceof Promise;
const proposalPath = await pending;
const contents = JSON.parse(fs.readFileSync(path.join(data, proposalPath), "utf8"));
let refused = false;
try { await localCaps.writeInboxProposal("contract-run-../outside.json", {}); } catch { refused = true; }
console.log(JSON.stringify({ isPromise, proposalPath, contents, refused }));
`);
  expect(result).toEqual({ isPromise: true, proposalPath: "memory/proposals/contract-run-real.json", contents: { actor: "server" }, refused: true });
});

it("generated proposals await the actual delayed path before auditing or replying", () => {
  const result = exercise(`
let finish;
let started;
const entered = new Promise((resolve) => { started = resolve; });
const pending = new Promise((resolve) => { finish = resolve; });
caps.writeInboxProposal = () => { started(); return pending; };
registerContractRunRoutes(app, { capabilitiesFor: async () => caps });
let answered = false;
const response = app.inject({ method: "POST", url: "/api/apps/contract-run/flag", payload: { ticket: "DE-1" } }).then((r) => { answered = true; return r; });
await entered;
await new Promise((resolve) => setImmediate(resolve));
const before = { answered, auditCount: events.length };
finish("memory/proposals/host-chosen-name.json");
const res = await response;
console.log(JSON.stringify({ before, status: res.statusCode, body: res.json(), events }));
`);
  expect(result).toMatchObject({ before: { answered: false, auditCount: 0 }, status: 200, body: { proposalPath: "memory/proposals/host-chosen-name.json", alreadyFiled: false, proposedBy: { username: "denied-actor" } }, events: [{ proposalPath: "memory/proposals/host-chosen-name.json" }] });
});

it("generated capability routes receive the actual request and map request-bound denial", () => {
  const result = exercise(`
const actors: unknown[] = [];
registerContractRunRoutes(app, { capabilitiesFor: async (id, req) => {
  actors.push(req?.principal?.username ?? null);
  if (req?.principal?.username === "denied-actor") throw new CapabilityDeniedError("actor denied", "write:inbox-proposal");
  return caps;
} });
const responses = [];
for (const options of [
  { method: "GET", url: "/api/apps/contract-run/contracts" },
  { method: "GET", url: "/api/apps/contract-run/proposals" },
  { method: "POST", url: "/api/apps/contract-run/flag", payload: { ticket: "DE-1" } }
]) { const res = await app.inject(options); responses.push({ status: res.statusCode, body: res.json() }); }
console.log(JSON.stringify({ actors, responses, events }));
`);
  expect(result).toEqual({ actors: ["denied-actor", "denied-actor", "denied-actor"], responses: Array.from({ length: 3 }, () => ({ status: 403, body: { error: "actor denied", code: "capability_denied", scope: "write:inbox-proposal" } })), events: [] });
});
