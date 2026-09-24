/** The mini-app profile: what a converted Cowork workflow turns into.
 *
 * ⭐ WHAT THESE TESTS ARE FOR. `generate.test.ts` proves the emitted files
 * keep the sub-app contract. These prove the thing one layer up — that the
 * DEFAULT shape of this generator is the database-free one, that a spec
 * which would put a migration in somebody's workspace is refused by name,
 * and that the page a person actually looks at carries the workflow rather
 * than a stack of anonymous forms.
 *
 * Like every other test here, they read the emitted TEXT. A generator that
 * agreed with its own intentions while writing something else would pass a
 * plan-shaped test and fail in the host. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { generateSubApp } from "../generate";
import { planSubApp, SpecRejectedError } from "../plan";
import { DEFAULT_PROFILE } from "../profile";
import { contractRunSpec, minimalSpec, wcClockSpec } from "../fixtures/specs";

const app = generateSubApp(contractRunSpec);
const fileAt = (path: string) => {
  const file = app.files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`no emitted file at ${path} (have: ${app.files.map((f) => f.path).join(", ")})`);
  return file.contents;
};
const web = fileAt("web/src/subapps/contract-run/index.tsx");
const manifest = fileAt("server/subapps/contract-run/manifest.ts");

function rejection(spec: unknown): SpecRejectedError {
  try {
    generateSubApp(spec);
  } catch (error) {
    if (error instanceof SpecRejectedError) return error;
    throw error;
  }
  throw new Error("expected the spec to be refused, but it generated");
}

describe("the mini-app is the default", () => {
  it("is what a spec that says nothing about a profile gets", () => {
    expect(DEFAULT_PROFILE).toBe("mini-app");
    expect(contractRunSpec).not.toHaveProperty("profile");
    expect(planSubApp(contractRunSpec).profile).toBe("mini-app");
    expect(planSubApp(minimalSpec).profile).toBe("mini-app");
  });

  it("emits exactly the floor: manifest, guard, routes/, the web module and its conformance test", () => {
    // ⭐ THE HOST HALF. The standalone harness is emitted too and is asserted
    // separately in `standalone.test.ts`; what this pins is that mounting a
    // mini-app in Flightdeck OS still lands these eight files and no others.
    expect(app.files.filter((f) => f.kind !== "standalone").map((f) => f.path)).toEqual([
      "server/subapps/contract-run/guard.ts",
      "server/subapps/contract-run/manifest.ts",
      "server/subapps/contract-run/routes/folders.ts",
      "server/subapps/contract-run/routes/handoffs.ts",
      "server/subapps/contract-run/routes/index.ts",
      "server/subapps/contract-run/routes/ledger.ts",
      "tests/subapps/contract-run/contractRunConformance.test.ts",
      "web/src/subapps/contract-run/index.tsx",
    ]);
  });

  it("emits no schema.ts, no DDL and no migration — anywhere in the set", () => {
    expect(app.files.some((f) => f.kind === "schema")).toBe(false);
    expect(app.files.some((f) => f.path.endsWith("schema.ts"))).toBe(false);
    for (const file of app.files) {
      expect(file.contents, `${file.path} contains DDL`).not.toMatch(/CREATE\s+(TABLE|INDEX)/i);
    }
  });

  it("carries `initSchema: () => {}` and imports no schema module, exactly like shell-reference", () => {
    expect(manifest).toContain("initSchema: () => {}");
    expect(manifest).not.toContain('from "./schema.js"');
  });

  it("never reaches a database from a route — only the capability adapter", () => {
    for (const file of app.files.filter((f) => f.kind === "routes-domain")) {
      expect(file.contents, file.path).not.toContain("rt.db");
      expect(file.contents, file.path).toContain("ctx.capabilitiesFor(rt.id)");
    }
  });

  it("ships the database-free property as a test the host will run after a hand-edit", () => {
    const hostTest = fileAt("tests/subapps/contract-run/contractRunConformance.test.ts");
    expect(hostTest).toContain('expect(fs.existsSync(path.join(SUBAPP_DIR, "schema.ts"))).toBe(false);');
    expect(hostTest).toContain('expect(read("manifest.ts").includes("initSchema: () => {}")).toBe(true);');
    // No tables means nothing to prefix — the const would be unused in the
    // host's repo, and an unused const is how a generated file trips
    // somebody else's lint.
    expect(hostTest).not.toContain("TABLE_PREFIX");
  });
});

describe("a spec carrying tables is refused, with a reason a person can act on", () => {
  const withTables = {
    ...contractRunSpec,
    tables: [{ name: "runs", columns: [{ name: "ticket", type: "text", notNull: true }] }],
  };

  it("names the profile, the tables, the reference sub-app and the way out", () => {
    const error = rejection(withTables);
    const text = error.issues.join("\n");
    expect(text).toContain('profile "mini-app" refuses tables');
    expect(text).toContain('table "runs"');
    expect(text).toContain("shell-reference");
    expect(text).toContain("initSchema: () => {}");
    expect(text).toContain('profile: "table-backed"');
    // Not a stack trace and not a Zod dump: the sentence says what to do.
    expect(text).toMatch(/migration a human must review/);
  });

  it("refuses the table-backed fixture too, when it does not name the profile", () => {
    const { profile: _profile, ...noProfile } = wcClockSpec;
    expect(rejection(noProfile).issues.join("\n")).toContain('profile "mini-app" refuses tables');
  });

  it("refuses a table-backed OPERATION by naming the profile, not by saying the table is unknown", () => {
    const readsRows = {
      ...minimalSpec,
      id: "row-reader",
      capabilities: [],
      domains: [
        {
          name: "rows",
          routes: [{ method: "GET", path: "/rows", operation: { kind: "list-rows", table: "rows" } }],
        },
      ],
    };
    const text = rejection(readsRows).issues.join("\n");
    expect(text).toContain('profile "mini-app" has none of');
    expect(text).not.toContain("unknown table");
  });

  it("still generates the table path when the spec asks for it by name", () => {
    const tableBacked = generateSubApp(wcClockSpec);
    expect(tableBacked.plan.profile).toBe("table-backed");
    expect(tableBacked.files.some((f) => f.path === "server/subapps/wc-clock/schema.ts")).toBe(true);
    expect(tableBacked.files.find((f) => f.kind === "manifest")?.contents).toContain("initSchema: (db) => applyWcClockSchema(db)");
  });
});

describe("the workflow, resolved", () => {
  it("refuses a step whose action names a route the spec does not declare", () => {
    const wrong = {
      ...contractRunSpec,
      workflow: {
        ...contractRunSpec.workflow,
        steps: [{ n: 1, title: "Read state", action: { domain: "folders", method: "GET", path: "/nope" } }],
      },
    };
    const text = rejection(wrong).issues.join("\n");
    expect(text).toContain('action names "GET /nope" in domain "folders"');
    expect(text).toContain('"GET /contracts"');
  });

  it("refuses a statutory step bound to something that writes state directly (contract rule 7)", () => {
    const statutoryInsert = {
      ...wcClockSpec,
      workflow: {
        name: "wc",
        steps: [{ n: 1, title: "Start the clock", gate: "statutory", action: { domain: "clocks", method: "POST", path: "/clocks" } }],
      },
    };
    const text = rejection(statutoryInsert).issues.join("\n");
    expect(text).toContain("statutory gate bound to an \"insert-row\" route");
    expect(text).toContain("propose, don't mutate");
  });

  it("refuses steps that do not ascend — the Procedure's numbering is the order a person reads", () => {
    const backwards = {
      ...contractRunSpec,
      workflow: { ...contractRunSpec.workflow, steps: [{ n: 4, title: "Later" }, { n: 2, title: "Earlier" }] },
    };
    expect(rejection(backwards).issues.join("\n")).toContain("numbered below the step before it");
  });

  it("warns when nothing can tell the page which steps are already proposed", () => {
    const noListing = {
      ...contractRunSpec,
      domains: contractRunSpec.domains.filter((d) => d.name !== "ledger"),
      workflow: { ...contractRunSpec.workflow, steps: contractRunSpec.workflow.steps.slice(0, 2) },
    };
    expect(generateSubApp(noListing).warnings.join(" ")).toMatch(/cannot show which steps already have one/);
  });

  it("generates the real fixture with no warnings at all", () => {
    expect(app.warnings).toEqual([]);
  });
});

describe("the page a person actually looks at", () => {
  it("is syntactically valid TSX", () => {
    const result = ts.transpileModule(web, {
      fileName: "web/src/subapps/contract-run/index.tsx",
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
      },
    });
    expect((result.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))).toEqual([]);
  });

  it("carries every Procedure step as data — number, title, gate, needs and produces", () => {
    expect(web).toContain('name: "orchestrate-workflow"');
    expect(web).toContain('source: "skills/orchestrate-workflow/SKILL.md"');
    for (const step of contractRunSpec.workflow.steps) {
      expect(web, `step ${step.n} is missing`).toContain(`n: ${String(step.n)}`);
      expect(web).toContain(`title: ${JSON.stringify(step.title)}`);
      expect(web).toContain(`gate: ${JSON.stringify(step.gate)}`);
      for (const need of step.needs ?? []) expect(web).toContain(JSON.stringify(need));
      for (const made of step.produces ?? []) expect(web).toContain(JSON.stringify(made));
    }
  });

  it("binds the three performable steps to routes and leaves the other three as checklist lines", () => {
    expect(web).toContain('formId: "get-/contracts"');
    expect(web).toContain('formId: "post-/flag"');
    expect(web).toContain('formId: "post-/handoff"');
    expect((web.match(/action: null,/g) ?? []).length).toBe(3);
  });

  it("derives a step's state from the proposals this app itself wrote, and stops at 'proposed'", () => {
    expect(web).toContain('proposalPrefix: "contract-run-divergence-"');
    expect(web).toContain("proposals.find((name) => name.startsWith(prefix))");
    expect(web).toContain('proposalsPath: "/proposals"');
    expect(web).toContain('label: "Proposed — with a human"');
    expect(web).toContain("A person resolves it in the Inbox; this");
    // Nothing on this page claims a step is finished or approved.
    expect(web).not.toMatch(/label: "(Done|Complete|Approved)"/);
  });

  it("shows the order without enforcing it — a waiting step keeps its control", () => {
    expect(web).toContain('label: "Waiting on step "');
    expect(web).toContain("has no proposal from this app yet. If it was done elsewhere, carry on.");
  });

  it("uses the host's visual language: its classes, its CSS variables, its Atlas dark values as fallbacks", () => {
    for (const className of ["page", "pagehead", "eyebrow", "card", "chip", "progress", "mono", "muted", "errorbox", "okbox"]) {
      expect(web, `no use of the host class "${className}"`).toMatch(new RegExp(`className=(\\{?)"[^"]*\\b${className}\\b`));
    }
    for (const token of [
      'var(--bg, #0e1720)',
      'var(--surface, #17242f)',
      'var(--ink, #eef2f7)',
      'var(--muted, #a7b6c3)',
      'var(--line, #304553)',
      'var(--te, #e98300)',
      'var(--green, #87c3a7)',
      'var(--amber, #c9b687)',
      'var(--red, #ff807d)',
    ]) {
      expect(web, `missing token ${token}`).toContain(token);
    }
    // Numbers are monospaced, per the host's own .mono convention.
    expect(web).toContain('<span className="mono" style={badgeStyle(status.state)}>');
    // Radii stay in the host's 14-18px band for cards and step rows.
    expect(web).toContain("borderRadius: 16");
  });

  it("ships no stylesheet and no i18n key — registry.ts stays the only host edit", () => {
    // ⭐ SHARPER THAN IT WAS, NOT LOOSER. The harness has a theme.css, so the
    // old blanket "no .css anywhere" would have had to be deleted or scoped.
    // Scoped, and then tightened: the HOST half still ships none, and the ONLY
    // .css in the whole set is the standalone one. A stylesheet appearing in a
    // host-bound file still fails this, which is what the rule was for.
    const hostFiles = app.files.filter((f) => f.kind !== "standalone");
    expect(hostFiles.some((f) => f.path.endsWith(".css"))).toBe(false);
    expect(hostFiles.some((f) => f.path.includes("i18n"))).toBe(false);
    expect(app.files.filter((f) => f.path.endsWith(".css")).map((f) => f.path)).toEqual([
      "standalone/theme.css",
    ]);
    expect(web).not.toMatch(/\bt\(\s*"/);
  });

  it("keeps the runtime markers Studio's own preview fingerprints", () => {
    // src/workbench/preview/descriptor.ts refuses to render a preview when
    // any of these is missing, rather than mirroring a page it no longer
    // resembles. Changing the emitter without changing the mirror is the
    // failure this pins.
    for (const needle of [
      "fetch(ROUTE_PREFIX + path",
      'credentials: "same-origin"',
      "class ApiRefusal",
      'r.status === 403 && r.code === "subapp_disabled"',
      'r.status === 403 && r.code === "capability_denied"',
      "r.status === 400",
      "const rows = (payload as { rows?: unknown } | null)?.rows",
      "const subAppModule: SubAppModule = { Page: GeneratedPage };",
      "const PANELS: PanelDescriptor[] =",
      "const ROUTE_PREFIX =",
      "const APP_TITLE =",
      "const APP_BLURB =",
    ]) {
      expect(web, `the preview's fingerprint "${needle}" is gone`).toContain(needle);
    }
  });

  it("shows a route once: a step's control does not reappear under Other actions", () => {
    expect(web).toContain("const BOUND_ROUTES = boundRouteKeys();");
    expect(web).toContain("panel.forms.filter((form) => !BOUND_ROUTES.has(form.id))");
    expect(web).toContain("BOUND_ROUTES.has(routeKey(\"GET\", list.path))");
  });
});

describe("the route behind the step rail's state", () => {
  const ledger = fileAt("server/subapps/contract-run/routes/ledger.ts");

  it("reads its own proposals through the adapter, and nothing else", () => {
    expect(ledger).toContain("caps.listOwnInboxProposals()");
    expect(ledger).not.toContain("node:fs");
    expect(ledger).toContain("requireContractRunEnabled(req)");
  });

  it("needs the write scope, because that is what gates the listing in the host", () => {
    expect(manifest).toContain('capabilities: ["read:contracts", "write:inbox-proposal"]');
  });
});
