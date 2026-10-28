import { createHash } from "node:crypto";

import { fileURLToPath } from "node:url";
import { runtimeImportClosure } from "../../../../test-helpers/runtime-import-closure";
import { expect, it, vi } from "vitest";
import { buildSubAppFromSpec } from "../build-subapp-spec";
import * as codegen from "../../../codegen/src/pure";
import { generateSubApp } from "../../../codegen/src/pure";
import { runConformanceGate } from "../../../conformance/src/gate";
import { gateGeneratedArtifacts } from "../../../guardrails/src/pure";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const deps = { ctx: { actor: "Karsten Haldan" }, digest, authorship: "first-party-operator" as const };
const spec = () => ({ profile: "mini-app", id: "review-form", label: "Review form", icon: "📋", navSection: "Contract pipeline", summary: "Prepare a review proposal.", capabilities: ["read:contracts", "write:inbox-proposal"], visibleToRoles: ["legal"], domains: [
  { name: "folders", routes: [{ method: "GET", path: "/contracts", operation: { kind: "list-contracts" } }] },
  { name: "reviews", routes: [{ method: "POST", path: "/propose", operation: { kind: "propose", proposalKind: "review", ticketField: "ticket", fields: [{ name: "ticket", type: "string", maxLength: 100 }, { name: "note", type: "string", optional: true, maxLength: 200 }], auditEvent: "review-form.proposed" } }] },
] });
const answers = { "consent:read:contracts": "yes", "consent:write:inbox-proposal": "yes", visibleToRoles: "legal", navSection: "Contract pipeline", icon: "📋" };
const input = () => ({ prompt: "Prepare a proposal form.", answers, spec: spec(), understanding: "A proposal form for review." });

it("generates a real SDK proposal-form candidate with exact conformance and privacy receipts and inert wire metadata", async () => {
  const result = await buildSubAppFromSpec(input(), deps);
  expect(result.status, JSON.stringify(result)).toBe("proposed");
  if (result.status !== "proposed") return;
  const expected = generateSubApp(spec());
  const hostFiles = expected.files.filter(f => f.kind !== "standalone");
  expect(result.generated.files).toEqual(expected.files);
  expect(result.conformance).toEqual(runConformanceGate({ files: hostFiles.map(f => ({ path: f.path, contents: f.contents })) }));
  expect(result.conformance.ok).toBe(true);
  expect(result.conformance.checks).toHaveLength(7);
  expect(result.artifacts).toEqual(gateGeneratedArtifacts(hostFiles.map(f => ({ path: f.path, content: f.contents })), { ...deps.ctx, digest }));
  expect(result.artifacts.decision).toBe("allow");
  expect(result.generated.warnings).toContain("Draft manifest ceiling only: host installation, project consent and effect-time capability grants are still required. Nothing has been written, mounted or executed.");
  expect(result.generated.registryPatch).toEqual({ file: expected.registryPatch.file, importLine: expected.registryPatch.importLine, entryLines: expected.registryPatch.entryLines });
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  const source = result.generated.files.find((f: { path: string }) => f.path.endsWith("routes/reviews.ts"))?.contents;
  expect(source).toContain("await ctx.capabilitiesFor(rt.id, req)");
  expect(source).toContain("await caps.writeInboxProposal(");
  expect(result.generated.files.some((f: { kind: string }) => f.kind === "standalone")).toBe(true);
});

it("refuses accessor-bearing native objects without invoking getters or sourcegen", async () => {
  let reads = 0;
  const unsafe = Object.defineProperty(spec(), "label", { enumerable: true, get() { reads++; return "Review form"; } });
  const generate = vi.spyOn(codegen, "generateSubApp");
  try {
    const result = await buildSubAppFromSpec({ ...input(), spec: unsafe }, deps);
    expect(result).toEqual({ status: "generation-refused", issues: ["native subapp spec invalid"] });
    expect(reads).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  } finally { generate.mockRestore(); }
});

it.each([
  { understanding: "Contact person@example.test about salary 98000 EUR." },
  { understanding: "Anna Mueller owns this form." },
])("refuses sensitive model prose before questions or sourcegen %#", async change => {
  const generate = vi.spyOn(codegen, "generateSubApp");
  try {
    const result = await buildSubAppFromSpec({ ...input(), ...change, answers: {} }, { ...deps, names: ["Anna Mueller"] });
    expect(result.status).toBe("generation-refused");
    expect(JSON.stringify(result)).not.toContain(change.understanding);
    expect(generate).not.toHaveBeenCalled();
  } finally { generate.mockRestore(); }
});

it.each([
  { prompt: "Track sick leave and union membership." },
  { answers: { ...answers, note: "Track salary 98000 EUR." } },
])("protects direct native-builder operator context before sourcegen %#", async change => {
  const generate = vi.spyOn(codegen, "generateSubApp");
  try {
    const result = await buildSubAppFromSpec({ ...input(), ...change }, deps);
    expect(result.status).toBe("model-request-refused");
    expect(generate).not.toHaveBeenCalled();
  } finally { generate.mockRestore(); }
});

it.each([
  { profile: "table-backed" },
  { settingsPanel: { tier: "workspace-admin", label: "Settings" } },
  { tables: [{ name: "rows", columns: [{ name: "note", type: "text" }] }] },
])("rejects unsupported native contributions before sourcegen %#", async contribution => {
  const generate = vi.spyOn(codegen, "generateSubApp");
  try {
    const result = await buildSubAppFromSpec({ ...input(), spec: { ...spec(), ...contribution } }, deps);
    expect(result.status).toBe("generation-refused");
    expect(generate).not.toHaveBeenCalled();
  } finally { generate.mockRestore(); }
});

it("accepts explicit prompt choice assignments as a draft ceiling without guessing from prose", async () => {
  const result = await buildSubAppFromSpec({ ...input(), answers: {}, prompt: "Prepare a proposal form.\nconsent:read:contracts: yes\nconsent:write:inbox-proposal: yes\nvisibleToRoles: legal\nnavSection: Contract pipeline\nicon: 📋" }, deps);
  expect(result.status).toBe("proposed");
});

it("asks for operation-required scopes even when a model omits its manifest declaration", async () => {
  const generate = vi.spyOn(codegen, "generateSubApp");
  try {
    const result = await buildSubAppFromSpec({ ...input(), spec: { ...spec(), capabilities: [] }, answers: { visibleToRoles: "legal", navSection: "Contract pipeline", icon: "📋" } }, deps);
    expect(result.status).toBe("needs_input");
    if (result.status !== "needs_input") return;
    expect(result.questions.map(q => q.id)).toEqual(["consent:read:contracts", "consent:write:inbox-proposal"]);
    expect(generate).not.toHaveBeenCalled();
  } finally { generate.mockRestore(); }
});

it.each([
  ["read scope denied", { "consent:read:contracts": "no" }, "consent:read:contracts"],
  ["write scope denied", { "consent:write:inbox-proposal": "no" }, "consent:write:inbox-proposal"],
  ["ambiguous scope", { "consent:read:contracts": "yes, but no" }, "consent:read:contracts"],
  ["audience mismatch", { visibleToRoles: "admin" }, "visibleToRoles"],
  ["extra audience", { visibleToRoles: "legal,admin" }, "visibleToRoles"],
  ["navigation mismatch", { navSection: "Admin" }, "navSection"],
  ["icon mismatch", { icon: "🔎" }, "icon"],
] as const)("never generates before resolving %s", async (_kind, changed, id) => {
  const generate = vi.spyOn(codegen, "generateSubApp");
  try {
    const result = await buildSubAppFromSpec({ ...input(), answers: { ...answers, ...changed } }, deps);
    expect(result.status).toBe("needs_input");
    if (result.status !== "needs_input") return;
    expect(result.questions.map(q => q.id)).toEqual([id]);
    expect(generate).not.toHaveBeenCalled();
  } finally { generate.mockRestore(); }
});

it.each([
  ["cycle", () => { const s: Record<string, unknown> = spec(); s.loop = s; return s; }],
  ["oversized", () => ({ ...spec(), summary: "x".repeat(120_001) })],
  ["prototype", () => Object.assign(Object.create({ label: "private" }), spec())],
  ["unknown contribution", () => ({ ...spec(), widgets: [{ kind: "arbitrary" }] })],
  ["unsupported operation", () => ({ ...spec(), domains: [{ name: "rows", routes: [{ method: "POST", path: "/rows", operation: { kind: "insert-row", table: "rows", fields: [{ name: "note", type: "string" }], auditEvent: "review-form.inserted" } }] }] })],
  ["missing ticket", () => { const s = spec(); s.domains[1]!.routes[0]!.operation = { kind: "propose" }; return s; }],
  ["arbitrary effect", () => ({ ...spec(), domains: [{ name: "commands", routes: [{ method: "POST", path: "/run", operation: { kind: "shell", command: "ignored" } }] }] })],
] as const)("refuses malformed native spec %s with fixed errors", async (_kind, value) => {
  const generate = vi.spyOn(codegen, "generateSubApp");
  try {
    const result = await buildSubAppFromSpec({ ...input(), spec: value() }, deps);
    expect(result.status).toBe("generation-refused");
    expect(generate).not.toHaveBeenCalled();
    expect(JSON.stringify(result).length).toBeLessThan(150);
  } finally { generate.mockRestore(); }
});

it("rejects a real emitted bundle if its enable guard is removed before conformance", async () => {
  const actualGenerate = codegen.generateSubApp;
  const generate = vi.spyOn(codegen, "generateSubApp").mockImplementation((...args) => {
    const output = actualGenerate(...args);
    const route = output.files.find(f => f.path.endsWith("routes/reviews.ts"))!;
    route.contents = route.contents.replace("rt = await requireReviewFormEnabled(req);", "rt = req.workspace;");
    return output;
  });
  try {
    const result = await buildSubAppFromSpec(input(), deps);
    expect(result).toEqual({ status: "generation-refused", issues: ["native subapp conformance refused"] });
    expect(generate).toHaveBeenCalledTimes(1);
  } finally { generate.mockRestore(); }
});

it("refuses sensitive bytes added to real generated output after the spec privacy proof", async () => {
  const actualGenerate = codegen.generateSubApp;
  const generate = vi.spyOn(codegen, "generateSubApp").mockImplementation((...args) => {
    const output = actualGenerate(...args);
    output.files.find(f => f.kind === "web-module")!.contents += '\n// person@example.test salary 98000 EUR\n';
    return output;
  });
  try {
    const result = await buildSubAppFromSpec(input(), deps);
    expect(result.status).toBe("artifacts-refused");
    expect(JSON.stringify(result)).not.toContain("person@example.test");
    expect(generate).toHaveBeenCalledTimes(1);
  } finally { generate.mockRestore(); }
});

it("asks stable targeted human choices before calling the generator", async () => {
  const generate = vi.spyOn(codegen, "generateSubApp");
  try {
    const result = await buildSubAppFromSpec({ ...input(), answers: {} }, deps);
    expect(result.status).toBe("needs_input");
    if (result.status !== "needs_input") return;
    expect(result.questions.map(q => q.id)).toEqual(["consent:read:contracts", "consent:write:inbox-proposal", "icon", "navSection", "visibleToRoles"]);
    expect(generate).not.toHaveBeenCalled();
  } finally { generate.mockRestore(); }
});

it("keeps the native builder import closure route-safe without loading CLI or IO modules", () => {
  const { seen, bare } = runtimeImportClosure(fileURLToPath(new URL("../../../../", import.meta.url)), [fileURLToPath(new URL("../build-subapp-spec.ts", import.meta.url))]);
  expect([...bare].sort()).toEqual(["zod"]);
  expect([...seen].some(file => /packages\/codegen\/src\/(?:cli|apply)\.ts$/.test(file))).toBe(false);
  expect([...seen].some(file => file.endsWith("/codegen/src/generate.ts"))).toBe(true);
  expect([...seen].some(file => file.endsWith("/conformance/src/gate.ts"))).toBe(true);
});
