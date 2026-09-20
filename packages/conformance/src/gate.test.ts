/** The baseline, the API surface, and the false positives.
 *
 * ⭐ THE MOST IMPORTANT TEST IN THIS PACKAGE IS THE FIRST ONE. A gate that
 * refuses correct code is worse than no gate: people route around it, and
 * then nothing is checked at all. So the conforming fixture — a whole
 * sub-app, banners and all — has to come back clean, and the "does not
 * fire on" block below pins the specific ways a naive implementation of
 * each rule would trip over ordinary, correct source. */
import { describe, expect, it } from "vitest";
import { ConformanceError, assertShippable, runConformanceGate } from "./gate";
import { formatReport, formatRuleCatalog } from "./report";
import { RULE_IDS } from "./finding";
import { MANIFEST_PATH, ROUTES_PATH, conformingSubApp, editFile, withFile } from "./fixtures/subapp";

describe("the conforming baseline", () => {
  it("passes, with no findings at all", () => {
    const report = runConformanceGate(conformingSubApp());
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.id).toBe("wc-clock");
  });

  it("reports which checks ran, so a clean report cannot mean a skipped one", () => {
    const report = runConformanceGate(conformingSubApp());
    expect(report.checks).toEqual([
      "manifest",
      "import-closure",
      "capability-escape",
      "guard-first",
      "no-cached-boolean",
      "table-prefix",
      "mount",
    ]);
    expect(report.rules).toEqual(RULE_IDS);
    expect(report.filesChecked).toBe(7);
  });

  it("is judged against the contract's host version by default", () => {
    expect(runConformanceGate(conformingSubApp(), { hostVersion: "5.0.0" }).ok).toBe(true);
    // A host OLDER than the manifest's floor refuses to boot it.
    const older = runConformanceGate(conformingSubApp(), { hostVersion: "4.9.0" });
    expect(older.ok).toBe(false);
    expect(older.errors[0]?.rule).toBe("FD-M004");
  });
});

describe("does not fire on correct code that looks suspicious", () => {
  const rulesFor = (source: string, path: string) => {
    const report = runConformanceGate(withFile(conformingSubApp(), path, source));
    return report.findings.map((f) => f.rule);
  };

  it("a banner explaining the process.env rule is prose, not a cached boolean", () => {
    // The real emitted guard says exactly this in its header.
    expect(runConformanceGate(conformingSubApp()).findings.filter((f) => f.rule.startsWith("FD-B"))).toEqual([]);
  });

  it("an error message containing req.body is a string, not a body read", () => {
    const app = editFile(
      conformingSubApp(),
      ROUTES_PATH,
      `      const rt: WorkspaceRuntime = await requireWcClockEnabled(req);
      const rows = await rt.db.all(`,
      `      const failure = "req.body must be an object";
      const rt: WorkspaceRuntime = await requireWcClockEnabled(req);
      const rows = await rt.db.all(`,
    );
    const report = runConformanceGate(app);
    expect(report.findings.filter((f) => f.rule === "FD-G002")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("a regex literal's braces do not confuse the scope tracker", () => {
    // TICKET_RE carries `{0,63}`. If those braces counted, every later
    // token in the file would read as module scope or as function scope at
    // random, and the guard-first check would be nonsense.
    expect(runConformanceGate(conformingSubApp()).findings).toEqual([]);
  });

  it("an English sentence containing the word from is not a SQL query", () => {
    const app = editFile(
      conformingSubApp(),
      ROUTES_PATH,
      `{ error: "invalid body", code: "invalid_body" }`,
      `{ error: "one entry from each ticket is allowed", code: "invalid_body" }`,
    );
    expect(runConformanceGate(app).findings.filter((f) => f.rule.startsWith("FD-S"))).toEqual([]);
  });

  it("a comment naming ../registry.js is not an import of it", () => {
    expect(runConformanceGate(conformingSubApp()).findings.filter((f) => f.rule === "FD-I002")).toEqual([]);
  });

  it("a test file may import node:fs and the host registry, because nothing mounts it", () => {
    const app = withFile(
      conformingSubApp(),
      "tests/subapps/wc-clock/wcClockConformance.test.ts",
      `import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUBAPP_MANIFESTS } from "../../../server/subapps/registry.js";
import { wcClockManifest } from "../../../server/subapps/wc-clock/manifest.js";

describe("wc-clock", () => {
  it("is registered", () => {
    expect(SUBAPP_MANIFESTS).toContain(wcClockManifest);
    expect(readFileSync("server/subapps/wc-clock/guard.ts", "utf8")).toContain("requireWcClockEnabled");
  });
});
`,
    );
    const report = runConformanceGate(app);
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("does not invent findings for a file it cannot classify", () => {
    expect(rulesFor("# notes\n", "docs/wc-clock.md")).toEqual(["FD-I005"]);
  });
});

describe("the report", () => {
  it("carries file, line, rule and a sentence on every finding", () => {
    const app = editFile(conformingSubApp(), MANIFEST_PATH, `minHostVersion: "5.0.0"`, `minHostVersion: "9.9.9"`);
    const report = runConformanceGate(app);
    const item = report.errors[0];
    expect(item?.rule).toBe("FD-M004");
    expect(item?.file).toBe(MANIFEST_PATH);
    expect(item?.line).toBeGreaterThan(0);
    expect(item?.message).toContain("9.9.9");
    expect(item?.evidence).toContain("minHostVersion");
  });

  it("is deterministic, so two runs diff cleanly", () => {
    const app = editFile(conformingSubApp(), MANIFEST_PATH, `icon: "🕐"`, `icon: ""`);
    expect(runConformanceGate(app).findings).toEqual(runConformanceGate(app).findings);
  });

  it("separates what blocks from what does not", () => {
    const app = editFile(conformingSubApp(), "server/subapps/registry.ts.patch", "SUBAPP_MANIFESTS", "MANIFESTS");
    const report = runConformanceGate(app);
    expect(report.warnings.map((f) => f.rule)).toContain("FD-X001");
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("renders for a human", () => {
    const app = editFile(conformingSubApp(), MANIFEST_PATH, `navSection: "Contract pipeline"`, `navSection: "Contracts"`);
    const text = formatReport(runConformanceGate(app));
    expect(text).toContain("REFUSED");
    expect(text).toContain("FD-M003");
    expect(text).toContain(MANIFEST_PATH);
    expect(formatReport(runConformanceGate(conformingSubApp()))).toContain("PASS");
  });

  it("can list its own rules", () => {
    const catalog = formatRuleCatalog();
    for (const id of RULE_IDS) expect(catalog).toContain(id);
  });
});

describe("assertShippable", () => {
  it("returns the report when the app conforms", () => {
    expect(assertShippable(conformingSubApp()).ok).toBe(true);
  });

  it("throws a ConformanceError naming every error", () => {
    const app = editFile(conformingSubApp(), MANIFEST_PATH, `visibleToRoles: ["hr_reviewer", "wc_liaison"]`, `visibleToRoles: []`);
    expect(() => assertShippable(app)).toThrow(ConformanceError);
    try {
      assertShippable(app);
    } catch (error) {
      expect((error as ConformanceError).message).toContain("FD-M003");
      expect((error as ConformanceError).report.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("malformed input", () => {
  /** The gate's input is a language model's output. It has to survive a
   * half-written file without throwing, because a thrown gate is a gate a
   * caller might catch and treat as a pass. */
  const survives = (contents: string) => {
    const report = runConformanceGate(withFile(conformingSubApp(), ROUTES_PATH, contents));
    expect(typeof report.ok).toBe("boolean");
    expect(report.checks.length).toBe(7);
    return report;
  };

  it("an unterminated string", () => {
    survives(`const broken = "SELECT id FROM subapp_wc_clock_entries
const next = 1;
`);
  });

  it("an unterminated block comment", () => {
    survives(`/* everything from here is a comment
const x = 1;
`);
  });

  it("unbalanced braces", () => {
    survives(`export function register(app) {
  app.get("/x", async (req, reply) => {
`);
  });

  it("an empty file", () => {
    survives("");
  });

  it("a file with no newline and no code", () => {
    survives("\u0000\u0001binary-ish");
  });

  it("an empty candidate", () => {
    const report = runConformanceGate({ files: [] });
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.rule).toBe("FD-M001");
  });

  it("two manifests, which is two sub-apps", () => {
    const report = runConformanceGate(
      withFile(conformingSubApp(), "server/subapps/other/manifest.ts", `export const otherManifest: SubAppManifest = { id: "other" };
`),
    );
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.message).toContain("2 manifests");
  });
});

describe("a check that crashes", () => {
  it("fails the app closed instead of reporting a clean run", () => {
    const report = runConformanceGate(conformingSubApp(), {
      checks: [
        {
          name: "explodes",
          run() {
            throw new Error("boom");
          },
        },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.rule).toBe("FD-Z001");
    expect(report.errors[0]?.message).toContain("boom");
    expect(report.checks).toEqual([]);
  });
});
