/** One deliberately violating fixture per rule, and a meta-test that the
 * table below covers every rule the gate claims to enforce.
 *
 * ⭐ WHY THE TABLE IS THE TEST. A conformance gate's real failure mode is
 * not a wrong message — it is a rule that quietly stopped firing. A
 * refactor tightens a regex, one check starts returning nothing, and the
 * gate keeps saying PASS on everything forever. Only a fixture that
 * actually breaks the rule can notice, so there is one for each, every one
 * built by taking the conforming app and changing exactly one thing.
 *
 * The last test in this file is the one that keeps the others honest: it
 * asserts that every id in the catalog appears here. Adding a rule without
 * a violating fixture fails the suite. */
import { describe, expect, it } from "vitest";
import { RULES, RULE_IDS, type RuleId } from "./finding";
import { runConformanceGate, type GateOptions } from "./gate";
import type { CandidateSubApp } from "./analyze";
import {
  GUARD_PATH,
  MANIFEST_PATH,
  PATCH_PATH,
  ROUTES_INDEX_PATH,
  ROUTES_PATH,
  SCHEMA_PATH,
  WEB_PATH,
  conformingSubApp,
  editFile,
  withFile,
  withoutFile,
} from "./fixtures/subapp";

interface Violation {
  readonly rule: RuleId;
  /** Reads as the sentence after the rule id in the test name. */
  readonly what: string;
  /** Where the finding must land. */
  readonly file: string;
  readonly build: () => CandidateSubApp;
  readonly options?: GateOptions;
  /** False for findings about the candidate as a whole. */
  readonly anchored?: boolean;
}

const CANDIDATE = "(candidate)";

/** Adds a line at the top of a route file's module scope. */
const atModuleScope = (line: string) =>
  editFile(
    conformingSubApp(),
    ROUTES_PATH,
    `const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;`,
    `const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;\n${line}`,
  );

/** Adds an import to the route file. */
const withImport = (line: string) =>
  editFile(conformingSubApp(), ROUTES_PATH, `import { z } from "zod";`, `import { z } from "zod";\n${line}`);

const VIOLATIONS: readonly Violation[] = [
  {
    rule: "FD-M001",
    what: "a candidate with no manifest declares no sub-app at all",
    file: CANDIDATE,
    anchored: false,
    build: () => withoutFile(conformingSubApp(), MANIFEST_PATH),
  },
  {
    rule: "FD-M002",
    what: "a manifest field computed instead of written",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `navSection: "Contract pipeline"`, `navSection: SECTIONS.pipeline`),
  },
  {
    rule: "FD-M003",
    what: "a navSection the host's UI_NAV_SECTIONS does not contain",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `navSection: "Contract pipeline"`, `navSection: "Contracts"`),
  },
  {
    rule: "FD-M003",
    what: "an empty visibleToRoles, which the host requires to be non-empty",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `visibleToRoles: ["hr_reviewer", "wc_liaison"]`, `visibleToRoles: []`),
  },
  {
    rule: "FD-M003",
    what: "a capability outside the host's two scopes",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `capabilities: ["read:contracts"]`, `capabilities: ["read:contracts", "write:payroll"]`),
  },
  {
    rule: "FD-M003",
    what: "an id that breaks the host's id regex",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `  id: "wc-clock",`, `  id: "WC_Clock",`),
  },
  {
    rule: "FD-M003",
    what: "a routePrefix with a sub-path, which ROUTE_PREFIX_RE rejects",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `routePrefix: "/api/apps/wc-clock"`, `routePrefix: "/api/apps/wc-clock/entries"`),
  },
  {
    rule: "FD-M004",
    what: "a minHostVersion newer than the host that would load it",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `minHostVersion: "5.0.0"`, `minHostVersion: "5.1.0"`),
  },
  {
    rule: "FD-M005",
    what: "a routePrefix that is not the one the id derives",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `routePrefix: "/api/apps/wc-clock"`, `routePrefix: "/api/apps/wcclock"`),
  },
  {
    rule: "FD-M006",
    what: "a manifest missing initSchema",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `  initSchema: (db) => applyWcClockSchema(db),\n`, ``),
  },
  {
    rule: "FD-M007",
    what: "an id that disagrees with the directory it sits in",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `  id: "wc-clock",`, `  id: "wc-clock-v2",`),
  },

  {
    rule: "FD-I001",
    what: "an import that reaches into a sibling sub-app",
    file: ROUTES_PATH,
    build: () => withImport(`import { envelopeFields } from "../../docusign/fields.js";`),
  },
  {
    rule: "FD-I002",
    what: "a guard that imports ../registry.js instead of the leaves",
    file: GUARD_PATH,
    build: () => editFile(conformingSubApp(), GUARD_PATH, `from "../installRow.js"`, `from "../registry.js"`),
  },
  {
    rule: "FD-I002",
    what: "an import of installRoutes.js, which the contract names beside the registry",
    file: ROUTES_PATH,
    build: () => withImport(`import { navPathFor } from "../../installRoutes.js";`),
  },
  {
    rule: "FD-I003",
    what: "an internal import of a file the candidate does not contain",
    file: ROUTES_INDEX_PATH,
    build: () => editFile(conformingSubApp(), ROUTES_INDEX_PATH, `from "./entries.js"`, `from "./timesheets.js"`),
  },
  {
    rule: "FD-I004",
    what: "server code importing this sub-app's own browser module",
    file: ROUTES_PATH,
    build: () => withImport(`import type { SubAppModule } from "../../../../web/src/subapps/wc-clock/index.js";`),
  },
  {
    rule: "FD-I005",
    what: "a file nothing in the sub-app imports",
    file: "server/subapps/wc-clock/helpers.ts",
    build: () => withFile(conformingSubApp(), "server/subapps/wc-clock/helpers.ts", `export const ROUNDING = 15;\n`),
  },

  {
    rule: "FD-C001",
    what: "a route module importing node:fs",
    file: ROUTES_PATH,
    build: () => withImport(`import { readFileSync } from "node:fs";`),
  },
  {
    rule: "FD-C001",
    what: "a route module importing a builtin by its bare name",
    file: ROUTES_PATH,
    build: () => withImport(`import { spawn } from "child_process";`),
  },
  {
    rule: "FD-C002",
    what: "a route module opening its own sqlite connection",
    file: ROUTES_PATH,
    build: () => withImport(`import Database from "better-sqlite3";`),
  },
  {
    rule: "FD-C002",
    what: "a route module importing a postgres driver",
    file: ROUTES_PATH,
    build: () => withImport(`import { Pool } from "pg";`),
  },
  {
    rule: "FD-C003",
    what: "a route module importing a host reader instead of using the capability adapter",
    file: ROUTES_PATH,
    build: () => withImport(`import { readContracts } from "../../../contracts/reader.js";`),
  },
  {
    rule: "FD-C004",
    what: "a route module reaching for the raw audit appender",
    file: ROUTES_PATH,
    build: () => withImport(`import { appendFlightdeckAudit } from "../../../lib/flightdeckAudit.js";`),
  },
  {
    rule: "FD-C005",
    what: "a package the host does not carry",
    file: ROUTES_PATH,
    build: () => withImport(`import axios from "axios";`),
  },

  {
    rule: "FD-G001",
    what: "a handler that never calls the enable guard",
    file: ROUTES_PATH,
    build: () =>
      editFile(
        conformingSubApp(),
        ROUTES_PATH,
        `      const rt: WorkspaceRuntime = await requireWcClockEnabled(req);
      const rows = await rt.db.all(`,
        `      const rt = req.workspace as WorkspaceRuntime;
      const rows = await rt.db.all(`,
      ),
  },
  {
    rule: "FD-G002",
    what: "a handler that parses the body before checking enable-state",
    file: ROUTES_PATH,
    build: () =>
      editFile(
        conformingSubApp(),
        ROUTES_PATH,
        `      const rt: WorkspaceRuntime = await requireWcClockEnabled(req);
      const parsed = logEntryBody.safeParse(req.body);`,
        `      const parsed = logEntryBody.safeParse(req.body);
      const rt: WorkspaceRuntime = await requireWcClockEnabled(req);`,
      ),
  },
  {
    rule: "FD-G003",
    what: "a route registered in a form the gate cannot read a handler out of",
    file: ROUTES_PATH,
    build: () =>
      editFile(
        conformingSubApp(),
        ROUTES_PATH,
        `export function registerWcClockEntriesRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void {`,
        `export function registerWcClockEntriesRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void {
  app.route({ method: "GET", url: "/api/apps/wc-clock/summary", handler: summarize });`,
      ),
  },
  {
    rule: "FD-G004",
    what: "a handler calling a guard it never imported",
    file: ROUTES_PATH,
    build: () =>
      editFile(
        conformingSubApp(),
        ROUTES_PATH,
        `import { WC_CLOCK_SUBAPP_ID, WcClockDisabledError, requireWcClockEnabled } from "../guard.js";`,
        `import { WC_CLOCK_SUBAPP_ID, WcClockDisabledError } from "../guard.js";`,
      ),
  },

  {
    rule: "FD-B001",
    what: "the kill switch captured once, at import time",
    file: ROUTES_PATH,
    build: () => atModuleScope(`const KILL_SWITCH = process.env.SUBAPP_WC_CLOCK_ENABLED === "true";`),
  },
  {
    rule: "FD-B001",
    what: "the same capture hidden inside a module-level object literal",
    file: ROUTES_PATH,
    build: () => atModuleScope(`const CONFIG = { enabled: process.env.SUBAPP_WC_CLOCK_ENABLED === "true" };`),
  },
  {
    rule: "FD-B002",
    what: "a module-level binding holding enable-state",
    file: ROUTES_PATH,
    build: () => atModuleScope(`const wcClockEnabledCache = loadEnableState();`),
  },
  {
    rule: "FD-B003",
    what: "a per-call environment read that skips two of the three layers",
    file: ROUTES_PATH,
    build: () =>
      editFile(
        conformingSubApp(),
        ROUTES_PATH,
        `      const rows = await rt.db.all(`,
        `      const verbose = process.env.WC_CLOCK_DEBUG === "1";
      const rows = await rt.db.all(`,
      ),
  },

  {
    rule: "FD-S001",
    what: "a CREATE TABLE outside the sub-app's prefix",
    file: SCHEMA_PATH,
    build: () => editFile(conformingSubApp(), SCHEMA_PATH, `CREATE TABLE IF NOT EXISTS subapp_wc_clock_entries(`, `CREATE TABLE IF NOT EXISTS wc_clock_entries(`),
  },
  {
    rule: "FD-S002",
    what: "a query against a table this sub-app does not own",
    file: ROUTES_PATH,
    build: () => editFile(conformingSubApp(), ROUTES_PATH, `FROM subapp_wc_clock_entries`, `FROM contracts`),
  },
  {
    rule: "FD-S002",
    what: "an INSERT into somebody else's table",
    file: ROUTES_PATH,
    build: () => editFile(conformingSubApp(), ROUTES_PATH, `INSERT INTO subapp_wc_clock_entries(`, `INSERT INTO audit_events(`),
  },
  {
    rule: "FD-S003",
    what: "an index name that could collide with another sub-app's",
    file: SCHEMA_PATH,
    build: () => editFile(conformingSubApp(), SCHEMA_PATH, `idx_wc_clock_entries_ticket`, `idx_entries_ticket`),
  },

  {
    rule: "FD-S004",
    what: "a table name concatenated on where the check cannot read it",
    file: ROUTES_PATH,
    build: () =>
      editFile(
        conformingSubApp(),
        ROUTES_PATH,
        `"SELECT id, ticket, minutes, created_at FROM subapp_wc_clock_entries ORDER BY created_at DESC LIMIT 200",`,
        `"SELECT id, ticket, minutes, created_at FROM " + TABLE + " ORDER BY created_at DESC LIMIT 200",`,
      ),
  },
  {
    rule: "FD-S004",
    what: "a template literal interpolating into SQL",
    file: ROUTES_PATH,
    build: () =>
      editFile(
        conformingSubApp(),
        ROUTES_PATH,
        `"SELECT id, ticket, minutes, created_at FROM subapp_wc_clock_entries ORDER BY created_at DESC LIMIT 200",`,
        "`SELECT id, ticket, minutes FROM subapp_wc_clock_entries ORDER BY ${sortColumn}`,",
      ),
  },
  {
    rule: "FD-X001",
    what: "an app that ships no registry edit, so nothing ever loads it",
    file: CANDIDATE,
    anchored: false,
    build: () => withoutFile(conformingSubApp(), PATCH_PATH),
  },
  {
    rule: "FD-X002",
    what: "a manifest naming a web module the candidate does not contain",
    file: CANDIDATE,
    anchored: false,
    build: () => withoutFile(conformingSubApp(), WEB_PATH),
  },
  {
    rule: "FD-X003",
    what: "a web module with no default export for the loader to mount",
    file: WEB_PATH,
    build: () => editFile(conformingSubApp(), WEB_PATH, `export default wcClockModule;`, `export { wcClockModule };`),
  },
  {
    rule: "FD-X004",
    what: "DDL that initSchema never runs",
    file: MANIFEST_PATH,
    build: () => editFile(conformingSubApp(), MANIFEST_PATH, `initSchema: (db) => applyWcClockSchema(db),`, `initSchema: () => {},`),
  },
  {
    rule: "FD-X005",
    what: "a dictionary that needs two host edits nobody made",
    file: "web/src/subapps/wc-clock/i18n.ts",
    build: () =>
      withFile(conformingSubApp(), "web/src/subapps/wc-clock/i18n.ts", `export const wcClockDict = { "wcClock.title": "Works council clock" };\n`),
  },

  {
    rule: "FD-Z001",
    what: "a check that throws instead of answering",
    file: CANDIDATE,
    anchored: false,
    build: () => conformingSubApp(),
    options: {
      checks: [
        {
          name: "explodes",
          run() {
            throw new Error("the scanner hit something it did not understand");
          },
        },
      ],
    },
  },
];

describe.each(VIOLATIONS)("$rule: $what", ({ rule, file, build, options, anchored }) => {
  const report = runConformanceGate(build(), options ?? {});
  const hits = report.findings.filter((item) => item.rule === rule);

  it("is caught", () => {
    expect(hits.length).toBeGreaterThan(0);
  });

  it("names the file it is in", () => {
    expect(hits.map((item) => item.file)).toContain(file);
  });

  it("points at a line and quotes it", () => {
    if (anchored === false) return;
    const hit = hits.find((item) => item.file === file);
    expect(hit?.line).toBeGreaterThan(0);
    expect(hit?.column).toBeGreaterThan(0);
    expect(hit?.evidence ?? "").not.toBe("");
  });

  it("explains itself in a sentence", () => {
    const hit = hits[0];
    expect(hit?.message.length ?? 0).toBeGreaterThan(40);
    expect(hit?.message).not.toContain("undefined");
  });

  it(RULES[rule].severity === "error" ? "refuses the app" : "does not block the app on its own", () => {
    if (RULES[rule].severity === "error") expect(report.ok).toBe(false);
    else expect(hits.every((item) => item.severity === "warning")).toBe(true);
  });
});

describe("the catalog", () => {
  it("has a deliberately violating fixture for every rule", () => {
    const covered = new Set(VIOLATIONS.map((violation) => violation.rule));
    expect(RULE_IDS.filter((id) => !covered.has(id))).toEqual([]);
  });

  it("raises no rule that is not in the catalog", () => {
    for (const violation of VIOLATIONS) {
      const report = runConformanceGate(violation.build(), violation.options ?? {});
      for (const item of report.findings) expect(RULE_IDS).toContain(item.rule);
    }
  });
});
