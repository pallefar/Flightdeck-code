/** Ways around the gate, and whether they work.
 *
 * ⭐ WHY THIS FILE EXISTS SEPARATELY. `rules.test.ts` breaks each rule the
 * obvious way, which proves the rule fires. It does not prove the rule is
 * hard to step around, and a gate that is easy to step around is worse
 * than none: it produces a PASS that someone will quote. Each case below
 * is a real way a model or a hurried human would write the same violation
 * without tripping a naive implementation — a path built by concatenation,
 * a dynamic import, SQL hoisted into a constant.
 *
 * Where the gate genuinely cannot see through something, the case is
 * still here, asserting what it DOES do — which is refuse (FD-G003)
 * rather than pass. The bounds are tested, not just described. */
import { describe, expect, it } from "vitest";
import { runConformanceGate } from "./gate";
import { ROUTES_PATH, SCHEMA_PATH, conformingSubApp, editFile, withFile } from "./fixtures/subapp";

const rulesOf = (app: ReturnType<typeof conformingSubApp>) =>
  runConformanceGate(app).findings.map((item) => item.rule);

const inRoutes = (find: string, replacement: string) => editFile(conformingSubApp(), ROUTES_PATH, find, replacement);

const GUARDED_GET = `  app.get("/api/apps/wc-clock/entries", async (req, reply) => {
    try {
      const rt: WorkspaceRuntime = await requireWcClockEnabled(req);`;

describe("a route path built by concatenation", () => {
  it("is still a route, and its handler is still checked", () => {
    const app = inRoutes(
      GUARDED_GET,
      `  app.get(ROUTE_PREFIX + "/entries", async (req, reply) => {
    try {
      const parsed = logEntryBody.safeParse(req.body);`,
    );
    // No guard call at all in that handler — the concatenated path must
    // not buy it an exemption.
    expect(rulesOf(app)).toContain("FD-G001");
  });

  it("does not turn every Map lookup into a route", () => {
    const app = inRoutes(
      `      const rows = await rt.db.all(`,
      `      const cached = memo.get("entries");
      const rows = await rt.db.all(`,
    );
    expect(rulesOf(app)).toEqual([]);
  });
});

describe("imports that are not written as imports", () => {
  it("a dynamic import of the registry is still an import of the registry", () => {
    const app = inRoutes(
      `      const rows = await rt.db.all(`,
      `      const { SUBAPP_MANIFESTS } = await import("../../registry.js");
      const rows = await rt.db.all(`,
    );
    expect(rulesOf(app)).toContain("FD-I002");
  });

  it("a require() of node:fs is still a filesystem escape", () => {
    const app = inRoutes(
      `      const rows = await rt.db.all(`,
      `      const fs = require("node:fs");
      const rows = await rt.db.all(`,
    );
    expect(rulesOf(app)).toContain("FD-C001");
  });

  it("a sibling reached the long way round is still a sibling", () => {
    const app = inRoutes(
      `import { z } from "zod";`,
      `import { z } from "zod";\nimport { fields } from "../../../subapps/docusign/fields.js";`,
    );
    expect(rulesOf(app)).toContain("FD-I001");
  });
});

describe("SQL that is not written inline", () => {
  it("is checked wherever in the file it is written", () => {
    const app = inRoutes(
      `const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;`,
      `const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;\nconst ALL_CONTRACTS = "SELECT id FROM contracts";`,
    );
    expect(rulesOf(app)).toContain("FD-S002");
  });

  it("cannot hide a table name behind an interpolation", () => {
    const app = editFile(
      conformingSubApp(),
      SCHEMA_PATH,
      "CREATE TABLE IF NOT EXISTS subapp_wc_clock_entries(",
      "CREATE TABLE IF NOT EXISTS ${TABLE}(",
    );
    expect(rulesOf(app)).toContain("FD-S004");
  });

  it("refuses a DDL name it cannot parse rather than reading past it", () => {
    // `CREATE TABLE IF NOT EXISTS " + TABLE + "(` inside a template: the
    // name is gone, and the gate says so instead of finding nothing.
    const app = editFile(
      conformingSubApp(),
      SCHEMA_PATH,
      "CREATE TABLE IF NOT EXISTS subapp_wc_clock_entries(",
      'CREATE TABLE IF NOT EXISTS " + TABLE + "(',
    );
    const report = runConformanceGate(app);
    expect(report.ok).toBe(false);
    expect(report.errors.map((item) => item.rule)).toContain("FD-S001");
  });
});

describe("what the gate cannot see through, it refuses", () => {
  it("a handler passed by reference is reported, not assumed guarded", () => {
    const app = inRoutes(
      `  app.get("/api/apps/wc-clock/entries", async (req, reply) => {`,
      `  app.get("/api/apps/wc-clock/summary", listSummary);\n  app.get("/api/apps/wc-clock/entries", async (req, reply) => {`,
    );
    const report = runConformanceGate(app);
    expect(report.findings.map((item) => item.rule)).toContain("FD-G003");
    expect(report.ok).toBe(false);
  });

  it("a sub-app with no readable handler anywhere does not pass by default", () => {
    const app = withFile(
      conformingSubApp(),
      ROUTES_PATH,
      `import type { FastifyInstance } from "fastify";
import type { RegisterRoutesCtx } from "../../types.js";

export function registerWcClockEntriesRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void {
  buildRoutesSomehow(app, ctx);
}
`,
    );
    const report = runConformanceGate(app);
    expect(report.ok).toBe(false);
    expect(report.errors.map((item) => item.rule)).toContain("FD-G003");
  });
});
