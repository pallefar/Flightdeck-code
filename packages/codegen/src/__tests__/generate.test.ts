/** Generate a sub-app from a fixture spec, then check the FILES.
 *
 * Every assertion below reads emitted text. None of them reads the plan the
 * emitters were given — a generator that agreed with its own intentions
 * while writing something else would pass a plan-shaped test and fail in
 * the host. */
import { describe, expect, it } from "vitest";
import { generateSubApp } from "../generate";
import { extractHandlers, stripComments } from "../invariants";
import { assertManifestWouldBoot } from "../manifest-rules";
import { readEmittedManifest } from "../testing/readEmittedManifest";
import { minimalSpec, registryFixture, wcClockSpec } from "../fixtures/specs";

const full = generateSubApp(wcClockSpec, { registrySource: registryFixture });
const minimal = generateSubApp(minimalSpec);
const fileAt = (app: typeof full, path: string) => {
  const file = app.files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`no emitted file at ${path} (have: ${app.files.map((f) => f.path).join(", ")})`);
  return file.contents;
};

describe("the emitted file set", () => {
  it("emits the ceiling shape: manifest, guard, routes/ split, schema, web module, host test, patch", () => {
    // The HOST half. The standalone harness rides along in `files` and is
    // pinned by `standalone.test.ts`; this list is what a Flightdeck checkout
    // receives, and it has not changed.
    expect(full.files.filter((f) => f.kind !== "standalone").map((f) => f.path)).toEqual([
      "server/subapps/registry.ts.patch",
      "server/subapps/wc-clock/guard.ts",
      "server/subapps/wc-clock/manifest.ts",
      "server/subapps/wc-clock/routes/clocks.ts",
      "server/subapps/wc-clock/routes/index.ts",
      "server/subapps/wc-clock/routes/review.ts",
      "server/subapps/wc-clock/schema.ts",
      "tests/subapps/wc-clock/wcClockConformance.test.ts",
      "web/src/subapps/wc-clock/index.tsx",
    ]);
  });

  it("emits the floor shape: no schema.ts at all when the spec declares no tables", () => {
    expect(minimal.files.some((f) => f.kind === "schema")).toBe(false);
    expect(fileAt(minimal, "server/subapps/shift-notes/manifest.ts")).toContain("initSchema: () => {}");
    expect(fileAt(minimal, "server/subapps/shift-notes/manifest.ts")).not.toContain('from "./schema.js"');
  });

  it("is byte-deterministic for one spec", () => {
    const again = generateSubApp(wcClockSpec, { registrySource: registryFixture });
    expect(again.files).toEqual(full.files);
  });
});

describe("the emitted manifest", () => {
  it("parses, as TEXT, against a local copy of subAppManifestSchema's rules", () => {
    const data = readEmittedManifest(fileAt(full, "server/subapps/wc-clock/manifest.ts"));
    const parsed = assertManifestWouldBoot(data);
    expect(parsed).toEqual({
      id: "wc-clock",
      label: "Works Council Clock",
      version: "0.1.0",
      minHostVersion: "5.0.0",
      icon: "⏱️",
      navSection: "Contract pipeline",
      routePrefix: "/api/apps/wc-clock",
      webModuleId: "wc-clock",
      capabilities: ["read:contracts", "write:inbox-proposal"],
      visibleToRoles: ["hr_preparer", "hr_reviewer", "wc_liaison", "admin"],
      settingsPanel: { tier: "workspace-admin", webComponentId: "wc-clock", label: "Clock defaults" },
      generatedBy: "flightdeck-studio",
    });
  });

  it("pins minHostVersion to 5.0.0 — above it, the host refuses to boot", () => {
    for (const app of [full, minimal]) {
      const manifest = app.files.find((f) => f.kind === "manifest");
      expect(manifest?.contents).toContain('minHostVersion: "5.0.0"');
    }
  });

  it("derives settingsPanel.webComponentId from webModuleId, never from the spec", () => {
    // A decorative value would fail closed: the loader globs
    // web/src/subapps/<webComponentId>/SettingsPanel.tsx.
    const data = readEmittedManifest(fileAt(full, "server/subapps/wc-clock/manifest.ts"));
    expect((data.settingsPanel as { webComponentId: string }).webComponentId).toBe(data.webModuleId);
  });

  it("names only the two files whose exports it calls", () => {
    const source = fileAt(full, "server/subapps/wc-clock/manifest.ts");
    expect(source).toContain('import { applyWcClockSchema } from "./schema.js";');
    expect(source).toContain('import { registerWcClockRoutes } from "./routes/index.js";');
    expect(source).toContain("initSchema: (db) => applyWcClockSchema(db)");
    expect(source).toContain("registerRoutes: (app, ctx) => registerWcClockRoutes(app, ctx)");
  });
});

/** ⛔ D-036 (option b, fail-closed): a generated mini-app is OFF by default at
 * the launcher layer. The host's `launcherSubappDefaults.test.ts` keys on
 * the manifest's `generatedBy: "flightdeck-studio"` marker and then holds the
 * sub-app to a STRICTER rule — `scripts/start-postgres.sh` may not name its
 * kill switch at all. So codegen owes the host two things: the marker, on
 * every manifest, as a literal the host's schema reads; and no launcher
 * edit, ever. Both are read off the emitted FILES. */
describe("the launcher layer — a generated mini-app is off by default (D-036)", () => {
  const apps = [full, minimal];

  it('stamps generatedBy: "flightdeck-studio" on every generated manifest, as a data literal', () => {
    for (const app of apps) {
      const source = fileAt(app, `server/subapps/${app.plan.id}/manifest.ts`);
      // Code, not a comment: the host's schema reads the field, not the prose.
      expect(stripComments(source)).toContain('  generatedBy: "flightdeck-studio",\n');
      const data = readEmittedManifest(source);
      expect(data["generatedBy"]).toBe("flightdeck-studio");
      expect(assertManifestWouldBoot(data).generatedBy).toBe("flightdeck-studio");
    }
  });

  it("never emits a start-postgres.sh file or patch, in any write target", () => {
    for (const app of apps) {
      expect(app.files.map((f) => f.path).filter((p) => /start-postgres/.test(p))).toEqual([]);
    }
  });

  it("never names its own kill switch in code bound for the host — so never switches it on, in any form", () => {
    for (const app of apps) {
      const named = new RegExp(`(?<![A-Za-z0-9_])${app.plan.envVar}(?![A-Za-z0-9_])`);
      for (const file of app.files.filter((f) => f.kind !== "standalone")) {
        expect({ path: file.path, names: named.test(stripComments(file.contents)) }).toEqual({ path: file.path, names: false });
      }
    }
  });
});

describe("guard first, in every handler", () => {
  const routeFiles = full.files.filter((f) => f.kind === "routes-domain");

  it("covers every route the spec declared", () => {
    const registered = routeFiles.flatMap((f) => extractHandlers(stripComments(f.contents)).map((h) => h.route));
    expect(registered.sort()).toEqual(
      [
        "GET /api/apps/wc-clock/clocks",
        "GET /api/apps/wc-clock/clocks/:clockId",
        "POST /api/apps/wc-clock/clocks",
        "GET /api/apps/wc-clock/contracts",
        "POST /api/apps/wc-clock/flag",
      ].sort(),
    );
  });

  it("calls the guard before parsing a body, reading params, touching the db or resolving a capability", () => {
    for (const file of routeFiles) {
      const handlers = extractHandlers(stripComments(file.contents));
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) {
        const guardAt = handler.body.indexOf("requireWcClockEnabled");
        expect(guardAt, `${file.path} ${handler.route}`).toBeGreaterThan(-1);
        for (const token of ["safeParse", "rt.db", "capabilitiesFor", "req.body", "req.params"]) {
          const at = handler.body.indexOf(token);
          expect(at === -1 || at > guardAt, `${file.path} ${handler.route} reaches ${token} before the guard`).toBe(true);
        }
      }
    }
  });

  it("maps the guard's refusal to a 403", () => {
    for (const file of routeFiles) {
      expect(file.contents).toContain("if (err instanceof WcClockDisabledError)");
      expect(file.contents).toContain('return reply.code(403).send({ error: err.message, code: "subapp_disabled" });');
    }
  });
});

describe("the rules a generated sub-app must never break", () => {
  const serverFiles = full.files.filter((f) => f.path.startsWith("server/subapps/wc-clock/"));

  it("imports no node builtin, db driver, host reader or sibling sub-app", () => {
    for (const file of serverFiles) {
      const code = stripComments(file.contents);
      for (const match of code.matchAll(/from "([^"]+)";/g)) {
        const specifier = match[1] as string;
        expect(specifier.startsWith("node:"), `${file.path} imports ${specifier}`).toBe(false);
        expect(/better-sqlite3|sqlite3|^pg$|mysql|knex|drizzle/.test(specifier), `${file.path} imports ${specifier}`).toBe(false);
        expect(/\.\.\/(registry|installRoutes)\.js$/.test(specifier), `${file.path} imports ${specifier}`).toBe(false);
        expect(/\.\.\/(docusign|maps|advantage|shell-reference)\//.test(specifier), `${file.path} imports ${specifier}`).toBe(false);
        expect(specifier.includes("/readers/"), `${file.path} imports ${specifier}`).toBe(false);
      }
    }
  });

  it("caches no boolean: the kill switch is read per call, never at module scope", () => {
    for (const file of serverFiles) expect(stripComments(file.contents)).not.toContain("process.env");
    expect(fileAt(full, "server/subapps/wc-clock/guard.ts")).toContain("subAppKillSwitchEnabled(WC_CLOCK_SUBAPP_ID)");
    expect(fileAt(full, "server/subapps/wc-clock/guard.ts")).toContain("await effectiveSubAppEnabled(rt.db,");
  });

  it("prefixes every table and index it creates with subapp_<id>_", () => {
    const schema = fileAt(full, "server/subapps/wc-clock/schema.ts");
    const tables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
    expect(tables).toEqual(["subapp_wc_clock_clocks"]);
    const indexes = [...schema.matchAll(/CREATE INDEX IF NOT EXISTS\s+([a-z_][a-z0-9_]*)\s+ON\s+([a-z_][a-z0-9_]*)/g)];
    expect(indexes.map((m) => [m[1], m[2]])).toEqual([["idx_wc_clock_clocks_ticket", "subapp_wc_clock_clocks"]]);
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS"); // idempotent on every boot
  });

  it("puts Zod at every HTTP boundary, strictly, including path params", () => {
    const clocks = fileAt(full, "server/subapps/wc-clock/routes/clocks.ts");
    expect(clocks).toContain("const postClocksBody = z");
    expect(clocks).toContain(".strict();");
    expect(clocks).toContain("const getClocksByClockIdParams = z");
    expect(clocks).toContain("getClocksByClockIdParams.safeParse(req.params)");
    const code = stripComments(clocks);
    expect((code.match(/\.object\(\{/g) ?? []).length).toBe((code.match(/\.strict\(\)/g) ?? []).length);
  });

  it("binds every request value through a ? placeholder and interpolates nothing", () => {
    for (const file of full.files.filter((f) => f.kind === "routes-domain")) {
      expect(stripComments(file.contents)).not.toContain("`");
    }
    const clocks = fileAt(full, "server/subapps/wc-clock/routes/clocks.ts");
    expect(clocks).toContain(
      'INSERT INTO subapp_wc_clock_clocks (id, created_at, created_by, ticket, started_at, state, days, statutory, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    expect(clocks).toContain("parsed.data.statutory ? 1 : 0"); // boolean -> SQLite 0/1
    expect(clocks).toContain("parsed.data.note ?? null"); // optional -> NULL
  });

  it("audits only through the injected adapter, and names fields rather than values", () => {
    const clocks = fileAt(full, "server/subapps/wc-clock/routes/clocks.ts");
    expect(clocks).not.toContain("appendFlightdeckAudit");
    expect(clocks).toContain("const caps = await ctx.capabilitiesFor(rt.id);");
    expect(clocks).toContain("fields: Object.keys(parsed.data).sort()");
    const auditBody = clocks.slice(clocks.indexOf("caps.auditAppend({"), clocks.indexOf("return reply.code(201)"));
    expect(auditBody).not.toContain("parsed.data.");
  });

  it("proposes without mutating, and is idempotent per ticket", () => {
    const review = fileAt(full, "server/subapps/wc-clock/routes/review.ts");
    expect(review).toContain("caps.writeInboxProposal(");
    expect(review).toContain(".listOwnInboxProposals()");
    // The already-filed match is the exact filename shape, not a bare
    // prefix — otherwise "DE-1-" reports "DE-1-x" as already flagged.
    expect(review).toContain('/^[0-9]+\\.json$/.test(f.slice(prefix.length))');
    expect(review).toContain("alreadyFiled: true");
    // The ticket charset is forced by codegen; a spec cannot widen it.
    expect(review).toContain("const TICKET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;");
    expect(review).toContain("ticket: z.string().regex(TICKET_RE,");
  });

  it("reaches contracts only through the capability adapter", () => {
    const review = fileAt(full, "server/subapps/wc-clock/routes/review.ts");
    expect(review).toContain("caps.readContracts()");
    expect(review).toContain('import { CapabilityDeniedError } from "../../capabilities.js";');
    expect(review).toContain('code: "capability_denied"');
  });

  it("bounds every list query, so a generated route cannot be an unbounded scan", () => {
    const clocks = fileAt(full, "server/subapps/wc-clock/routes/clocks.ts");
    expect(clocks).toContain("ORDER BY started_at DESC, id DESC LIMIT 100");
    expect(clocks).not.toContain("SELECT *");
  });
});

describe("the web module", () => {
  const web = fileAt(full, "web/src/subapps/wc-clock/index.tsx");

  it("default-exports a SubAppModule with a Page", () => {
    expect(web).toContain('import type { SubAppModule } from "../registry";');
    expect(web).toContain("const subAppModule: SubAppModule = { Page: GeneratedPage };");
    expect(web).toContain("export default subAppModule;");
  });

  it("lands at web/src/subapps/<webModuleId>/index.tsx, where the glob looks", () => {
    expect(full.files.some((f) => f.path === "web/src/subapps/wc-clock/index.tsx")).toBe(true);
  });

  it("ships no stylesheet and no i18n key — registry.ts stays the only host edit", () => {
    // Host half. The whole-set claim — that the ONLY stylesheet anywhere is
    // the standalone one — is pinned in mini-app.test.ts.
    const hostFiles = full.files.filter((f) => f.kind !== "standalone");
    expect(hostFiles.some((f) => f.path.endsWith(".css"))).toBe(false);
    expect(hostFiles.some((f) => f.path.includes("i18n"))).toBe(false);
    expect(web).not.toMatch(/\bt\(\s*"/);
  });

  it("routes refusals on status and code, never on the server's prose", () => {
    expect(web).toContain('if (r.status === 403 && r.code === "subapp_disabled")');
    expect(web).toContain('if (r.status === 403 && r.code === "capability_denied")');
    expect(web).toContain("if (r.status === 404)");
  });

  it("carries the spec's routes as data, one panel per domain", () => {
    expect(web).toContain('const ROUTE_PREFIX = "/api/apps/wc-clock";');
    expect(web).toContain('id: "clocks"');
    expect(web).toContain('id: "review"');
    expect(web).toContain('{ name: "state", label: "State", control: "select", options: ["running", "paused", "expired"], optional: false }');
  });
});

describe("the conformance gate that ships with the app", () => {
  const test = fileAt(full, "tests/subapps/wc-clock/wcClockConformance.test.ts");

  it("lives in tests/subapps/<id>/, per the host's G3 layout fence", () => {
    expect(full.files.some((f) => f.path.startsWith("tests/subapps/wc-clock/"))).toBe(true);
  });

  it("re-derives the guard-first and table-prefix rules from the files on disk", () => {
    expect(test).toContain('const guardAt = handler.indexOf("requireWcClockEnabled");');
    expect(test).toContain('const TABLE_PREFIX = "subapp_wc_clock_";');
    expect(test).toContain("subAppManifestSchema.safeParse(wcClockManifest)");
  });
});

describe("warnings", () => {
  it("says so when a spec proposes without the scope that would validate the ticket", () => {
    const noRead = {
      ...minimalSpec,
      id: "blind-flag",
      capabilities: ["write:inbox-proposal"],
      domains: [
        {
          name: "review",
          routes: [
            {
              method: "POST",
              path: "/flag",
              // The approved `divergence` template, exactly — ruling 8 refuses any other.
              operation: {
                kind: "propose",
                proposalKind: "divergence",
                ticketField: "ticket",
                auditEvent: "blind-flag.divergence-proposed",
                fields: [
                  { name: "ticket", type: "string" },
                  { name: "note", type: "string", maxLength: 500, optional: true },
                ],
              },
            },
          ],
        },
      ],
    };
    const app = generateSubApp(noRead);
    expect(app.warnings.join(" ")).toMatch(/proposes blind/);
    const review = app.files.find((f) => f.path === "server/subapps/blind-flag/routes/review.ts");
    expect(review?.contents).not.toContain("caps.readContracts()");
    expect(review?.contents).toContain("No `read:contracts` scope is declared");
  });
});
