/** The generator's own gate, tested by breaking things.
 *
 * `generateSubApp` runs these checks on its output and throws rather than
 * return source that breaks the contract. A gate nobody has seen FAIL is a
 * gate nobody knows works — so every rule below is given a file that
 * violates it, built by corrupting real emitted output rather than by
 * hand-writing a strawman. */
import { describe, expect, it } from "vitest";
import { generateSubApp } from "../generate";
import { CodegenInvariantError, checkEmittedInvariants, type GeneratedFile } from "../invariants";
import { planSubApp } from "../plan";
import { wcClockSpec } from "../fixtures/specs";

const plan = planSubApp(wcClockSpec);
const clean = generateSubApp(wcClockSpec).files;

function corrupt(path: string, edit: (source: string) => string): GeneratedFile[] {
  return clean.map((file) => (file.path === path ? { ...file, contents: edit(file.contents) } : file));
}

function rules(files: GeneratedFile[]): string[] {
  return [...new Set(checkEmittedInvariants(files, plan).map((v) => v.rule))].sort();
}

const CLOCKS = "server/subapps/wc-clock/routes/clocks.ts";
const REVIEW = "server/subapps/wc-clock/routes/review.ts";
const GUARD = "server/subapps/wc-clock/guard.ts";
const SCHEMA = "server/subapps/wc-clock/schema.ts";
const MANIFEST = "server/subapps/wc-clock/manifest.ts";

describe("clean output", () => {
  it("passes every rule", () => {
    expect(checkEmittedInvariants(clean, plan)).toEqual([]);
  });

  it("is what generateSubApp guarantees — it throws rather than return a violation", () => {
    expect(() => generateSubApp(wcClockSpec)).not.toThrow();
    expect(new CodegenInvariantError([{ file: "f", rule: "r", detail: "d" }]).message).toMatch(/\[r\] f: d/);
  });
});

describe("rule 1 — guard first", () => {
  it("catches a handler that never calls the guard", () => {
    const files = corrupt(CLOCKS, (s) =>
      s.replace("      rt = await requireWcClockEnabled(req);", "      rt = req.workspace as WorkspaceRuntime;"),
    );
    expect(rules(files)).toContain("guard-first");
  });

  it("catches a body parsed above the guard", () => {
    const files = corrupt(CLOCKS, (s) =>
      s.replace(
        "    let rt: WorkspaceRuntime;\n    try {\n      rt = await requireWcClockEnabled(req);",
        "    const early = postClocksBody.safeParse(req.body);\n    let rt: WorkspaceRuntime;\n    try {\n      rt = await requireWcClockEnabled(req);",
      ),
    );
    expect(rules(files)).toContain("guard-first");
  });

  it("catches a db read above the guard", () => {
    const files = corrupt(CLOCKS, (s) =>
      s.replace("    let rt: WorkspaceRuntime;", "    const peek = rt.db;\n    let rt: WorkspaceRuntime;"),
    );
    expect(rules(files)).toContain("guard-first");
  });

  it("does not accept a guard mentioned only in a comment", () => {
    const files = corrupt(CLOCKS, (s) =>
      s.replace(
        "      rt = await requireWcClockEnabled(req);",
        "      // requireWcClockEnabled(req) goes here\n      rt = req.workspace as WorkspaceRuntime;",
      ),
    );
    expect(rules(files)).toContain("guard-first");
  });
});

describe("rule 2 — never cache a boolean", () => {
  it("catches a direct process.env read", () => {
    const files = corrupt(GUARD, (s) => s.replace("const rt = req.workspace;", 'const rt = process.env.X ? req.workspace : null;'));
    expect(rules(files)).toContain("no-cached-boolean");
  });

  it("catches an enable-state cached at module scope", () => {
    const files = corrupt(GUARD, (s) => s.replace("export class", "const wcClockEnabled = true;\nexport class"));
    expect(rules(files)).toContain("no-cached-boolean");
  });
});

describe("rules 3 and 4 — no capability escape, no sibling imports", () => {
  it.each([
    ['import fs from "node:fs";', "node builtin"],
    ['import Database from "better-sqlite3";', "db driver"],
    ['import { getContract } from "../../../readers/contracts.js";', "host reader module"],
    ['import { docusignManifest } from "../../docusign/manifest.js";', "sibling sub-app"],
    ['import { SUBAPP_MANIFESTS } from "../../registry.js";', "the registry"],
  ])("catches %s (%s)", (line) => {
    const files = corrupt(CLOCKS, (s) => s.replace('import { z } from "zod";', `${line}\nimport { z } from "zod";`));
    expect(rules(files)).toContain("import-allowlist");
  });

  it("allows exactly the six modules a route file needs", () => {
    expect(checkEmittedInvariants(clean, plan)).toEqual([]);
  });
});

describe("rule 5 and 8 — audit through the adapter, naming fields not values", () => {
  it("catches a route reaching for appendFlightdeckAudit", () => {
    const files = corrupt(CLOCKS, (s) => s.replace("caps.auditAppend({", "appendFlightdeckAudit(rt.root, {"));
    expect(rules(files)).toContain("audit-via-capability");
  });

  it("catches an audit event carrying a body VALUE", () => {
    const files = corrupt(CLOCKS, (s) =>
      s.replace("fields: Object.keys(parsed.data).sort(),", "ticket: parsed.data.ticket,"),
    );
    expect(rules(files)).toContain("audit-names-not-values");
  });
});

describe("rule 6 — Zod at every boundary, strictly", () => {
  it("catches a body schema that dropped .strict()", () => {
    const files = corrupt(CLOCKS, (s) => s.replace("  })\n  .strict();", "  });"));
    expect(rules(files)).toContain("zod-strict");
  });
});

describe("the table-prefix rule", () => {
  it("catches DDL creating a table outside the sub-app's prefix", () => {
    const files = corrupt(SCHEMA, (s) => s.replace("CREATE TABLE IF NOT EXISTS subapp_wc_clock_clocks(", "CREATE TABLE IF NOT EXISTS clocks("));
    expect(rules(files)).toContain("table-prefix");
  });

  it("catches a query reaching a table outside the prefix", () => {
    const files = corrupt(CLOCKS, (s) => s.replace("FROM subapp_wc_clock_clocks", "FROM workspace_contracts"));
    expect(rules(files)).toContain("table-prefix");
  });

  it("catches an index name that does not carry the sub-app id", () => {
    const files = corrupt(SCHEMA, (s) => s.replace("idx_wc_clock_clocks_ticket", "idx_clocks_ticket"));
    expect(rules(files)).toContain("table-prefix");
  });
});

describe("the emitter-shaped mistakes", () => {
  it("catches a template literal in a route file", () => {
    const files = corrupt(REVIEW, (s) => s.replace('"memory/proposals/" + already', "`memory/proposals/${already}`"));
    expect(rules(files)).toContain("no-template-literal");
  });

  it("catches SELECT *", () => {
    const files = corrupt(CLOCKS, (s) => s.replace(/SELECT id, [^"]+ FROM/g, "SELECT * FROM"));
    expect(rules(files)).toContain("explicit-columns");
  });

  it("catches a symbol used but never imported — the bug that shipped once", () => {
    // A domain whose routes are all capability-backed still binds
    // `rt: WorkspaceRuntime`; gating that import on the domain having a
    // TABLE emitted a file that read correctly and would not compile.
    const files = corrupt(REVIEW, (s) => s.replace('import type { WorkspaceRuntime } from "../../../workspace/types.js";\n', ""));
    expect(rules(files)).toContain("symbol-imported");
  });

  it("catches a manifest that asks for a host newer than 5.0.0", () => {
    const files = corrupt(MANIFEST, (s) => s.replace('minHostVersion: "5.0.0"', 'minHostVersion: "6.0.0"'));
    expect(rules(files)).toContain("min-host-version");
  });

  it("fails rather than passes when no handler can be found at all", () => {
    const files = corrupt(CLOCKS, (s) => s.replace(/app\.(get|post)\(/g, "register("));
    expect(rules(files)).toContain("guard-first");
  });
});

describe("the launcher layer — off by default (D-036)", () => {
  it("catches a manifest that lost its generatedBy marker", () => {
    const files = corrupt(MANIFEST, (s) => s.replace('  generatedBy: "flightdeck-studio",\n', ""));
    expect(rules(files)).toContain("generated-marker");
  });

  it("does not accept the marker mentioned only in a comment", () => {
    const files = corrupt(MANIFEST, (s) =>
      s.replace('  generatedBy: "flightdeck-studio",\n', '  // generatedBy: "flightdeck-studio",\n'),
    );
    expect(rules(files)).toContain("generated-marker");
  });

  it("catches a start-postgres.sh edit in the file set, whatever its kind", () => {
    for (const path of ["scripts/start-postgres.sh", "scripts/start-postgres.sh.patch"]) {
      const files = [...clean, { path, contents: "", kind: "patch" as const }];
      expect(rules(files)).toContain("launcher-off-by-default");
    }
  });

  it("catches a host-bound file that switches the kill switch on", () => {
    const files = corrupt(GUARD, (s) => `${s}\nprocess.env.SUBAPP_WC_CLOCK_ENABLED = "true";\n`);
    expect(rules(files)).toContain("launcher-off-by-default");
  });
});

describe("comments are prose, not code", () => {
  it("does not trip on a banner that quotes the very things the rules forbid", () => {
    // The emitted route header says the file contains no template literal,
    // in a sentence containing backticks. A checker reading raw text would
    // fail its own output.
    const routeFile = clean.find((f) => f.path === CLOCKS);
    expect(routeFile?.contents).toContain("`?` placeholder");
    expect(checkEmittedInvariants(clean, plan)).toEqual([]);
  });
});

describe("imports and body are computed from the same condition", () => {
  it("catches an import nothing uses", () => {
    const files = corrupt(CLOCKS, (s) =>
      s.replace('import { z } from "zod";', 'import { z } from "zod";\nimport { CapabilityDeniedError } from "../../capabilities.js";'),
    );
    expect(rules(files)).toContain("import-used");
  });

  it("emits no zod import for a domain that needs no schema", () => {
    const floor = generateSubApp({
      id: "read-only-app",
      label: "Read Only",
      icon: "📖",
      navSection: "Ops & insight",
      capabilities: ["read:contracts"],
      visibleToRoles: ["admin"],
      domains: [{ name: "contracts", routes: [{ method: "GET", path: "/contracts", operation: { kind: "list-contracts" } }] }],
    });
    const route = floor.files.find((f) => f.kind === "routes-domain");
    expect(route?.contents).not.toContain('from "zod"');
    expect(checkEmittedInvariants(floor.files, floor.plan)).toEqual([]);
  });
});
