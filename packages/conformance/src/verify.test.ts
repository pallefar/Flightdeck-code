/** The tests that matter here are the ones where the STATIC GATE IS HAPPY.
 *
 * Every other test file in this package proves a rule fires on code that
 * breaks it. These prove the opposite thing: that there is a class of
 * generated sub-app the contract checks pass with zero findings and that
 * is still broken — and that the compiler and the sandboxed mount catch
 * it. Each case below therefore asserts BOTH halves, because a test that
 * only asserted the refusal would not show that the refusal was new. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runConformanceGate } from "./gate";
import { verifySubApp, assertVerified } from "./verify";
import { isolationAvailable, redactSecrets, runSandboxed, stage } from "./verify/sandbox";
import { typecheckCandidate } from "./verify/typecheck";
import { FLIGHTDECK_HOST_SURFACE } from "./verify/host-surface";
import { mountProbe, type MountContext } from "./verify/mount";
import {
  ROUTES_PATH,
  SCHEMA_PATH,
  conformingSubApp,
  editFile,
} from "./fixtures/subapp";

const REPO_ROOT = process.cwd();
const verify = (app: Parameters<typeof verifySubApp>[0]) => verifySubApp(app, { repoRoot: REPO_ROOT });
const SLOW = 90_000;

describe("the conforming baseline", () => {
  it("compiles against the host and survives being mounted", async () => {
    const report = await verify(conformingSubApp());
    expect(report.findings).toEqual([]);
    expect(report.verified).toBe(true);
    expect(report.stages.map((s) => [s.name, s.ran, s.ok])).toEqual([
      ["static", true, true],
      ["typecheck", true, true],
      ["mount", true, true],
    ]);
  }, SLOW);

  it("keeps the evidence after the verdict is taken", async () => {
    const report = await verify(conformingSubApp());
    const mount = report.stages.find((s) => s.name === "mount");
    // The transcript is what a repair loop is handed, so it has to say
    // what actually happened, not that everything was fine.
    expect(mount?.output).toContain("GET /api/apps/wc-clock/entries");
    expect(mount?.output).toContain("CREATE TABLE IF NOT EXISTS subapp_wc_clock_entries");
    expect(mount?.output).toContain("guard:killSwitch");
    expect(report.stages.find((s) => s.name === "typecheck")?.output).toBe("tsc: no errors");
  }, SLOW);
});

describe("defects the contract checks are structurally unable to see", () => {
  it("a type error: the contract gate passes it, the compiler does not", async () => {
    // `reply.code` takes a number. Nothing in the sub-app contract has an
    // opinion about that, and the host build has a very strong one.
    const app = editFile(conformingSubApp(), ROUTES_PATH, "return reply.code(201).send({ ok: true });", 'return reply.code("201").send({ ok: true });');

    expect(runConformanceGate(app).findings).toEqual([]);

    const report = await verify(app);
    expect(report.verified).toBe(false);
    const compile = report.findings.filter((f) => f.rule.startsWith("FD-T"));
    expect(compile.length).toBeGreaterThan(0);
    expect(compile[0]?.file).toBe(ROUTES_PATH);
    expect(compile[0]?.line).toBeGreaterThan(0);
    expect(compile[0]?.message).toContain("not assignable");
    // And nothing was executed, because it does not compile.
    expect(report.stages.find((s) => s.name === "mount")?.ran).toBe(false);
  }, SLOW);

  it("a null-deref: it conforms, it compiles, and it 500s on the first request", async () => {
    const app = editFile(
      conformingSubApp(),
      ROUTES_PATH,
      "      return reply.send({ entries: rows });",
      "      const newest = rows[0];\n      return reply.send({ entries: rows, latestTicket: newest.ticket });",
    );

    expect(runConformanceGate(app).findings).toEqual([]);

    const report = await verify(app);
    expect(report.stages.find((s) => s.name === "typecheck")?.ok).toBe(true);
    expect(report.verified).toBe(false);
    const crash = report.findings.find((f) => f.rule === "FD-R008");
    expect(crash?.message).toContain("TypeError");
    expect(crash?.message).toContain("GET /api/apps/wc-clock/entries");
  }, SLOW);

  it("a prefix derived with the wrong transform: the name never appears as text", async () => {
    // The classic generator bug `derive.ts` exists to prevent — `wc-clock`
    // underscored wrongly — assembled from pieces, so the offending table
    // name is in no string literal and FD-S001 has nothing to read. It is
    // in the statement that reaches `db.exec`.
    const app = editFile(
      conformingSubApp(),
      SCHEMA_PATH,
      "  await db.exec(WC_CLOCK_SCHEMA);",
      [
        "  await db.exec(WC_CLOCK_SCHEMA);",
        '  const derived = "subapp_" + "wc-clock".replace("-", "") + "_audit";',
        '  await db.exec(["CREATE", "TABLE", "IF", "NOT", "EXISTS", derived + "(id TEXT PRIMARY KEY)"].join(" "));',
      ].join("\n"),
    );

    expect(runConformanceGate(app).findings.filter((f) => f.rule.startsWith("FD-S"))).toEqual([]);

    const report = await verify(app);
    const ddl = report.findings.find((f) => f.rule === "FD-R004");
    expect(ddl?.message).toContain("subapp_wcclock_audit");
    expect(ddl?.message).toContain("subapp_wc_clock_");
    expect(report.verified).toBe(false);
  }, SLOW);

  it("a guard that is present but not reached: order is a runtime property", async () => {
    // The guard call is textually first in the handler body, so the
    // positional check is satisfied. It is inside a branch this handler
    // never takes.
    const app = editFile(
      conformingSubApp(),
      ROUTES_PATH,
      "      const rt: WorkspaceRuntime = await requireWcClockEnabled(req);\n      const rows = await rt.db.all(",
      '      if (req.method !== "GET") await requireWcClockEnabled(req);\n      const rt = req.workspace as WorkspaceRuntime;\n      const rows = await rt.db.all(',
    );

    expect(runConformanceGate(app).findings.filter((f) => f.rule.startsWith("FD-G"))).toEqual([]);

    const report = await verify(app);
    const guard = report.findings.find((f) => f.rule === "FD-R007");
    expect(guard?.message).toContain("never called the enable guard");
    expect(guard?.message).toContain("GET /api/apps/wc-clock/entries");
    expect(report.verified).toBe(false);
  }, SLOW);
});

describe("what the report says about stages that did not run", () => {
  it("a candidate the contract refused is never compiled and never executed", async () => {
    const app = editFile(
      conformingSubApp(),
      ROUTES_PATH,
      'import { z } from "zod";',
      'import { z } from "zod";\nimport { readFileSync } from "node:fs";',
    );

    const report = await verify(app);
    expect(report.errors.some((f) => f.rule === "FD-C001")).toBe(true);
    expect(report.verified).toBe(false);
    const mount = report.stages.find((s) => s.name === "mount");
    expect(mount?.ran).toBe(false);
    expect(mount?.skipped).toContain("never executed");
  }, SLOW);

  it("skipMount is on the record, and is not a pass", async () => {
    const report = await verifySubApp(conformingSubApp(), { repoRoot: REPO_ROOT, skipMount: true });
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    // No error findings, and still not verified: a stage that did not run
    // never counts as one that passed.
    expect(report.verified).toBe(false);
    expect(report.stages.find((s) => s.name === "mount")?.skipped).toContain("has NOT been run");
  }, SLOW);

  it("cancellation refuses rather than half-passing", async () => {
    const controller = new AbortController();
    controller.abort();
    const report = await verifySubApp(conformingSubApp(), { repoRoot: REPO_ROOT, signal: controller.signal });
    expect(report.verified).toBe(false);
    expect(report.errors.some((f) => f.rule === "FD-Z001")).toBe(true);
    expect(report.stages.find((s) => s.name === "mount")?.skipped).toBe("cancelled by the caller");
  }, SLOW);

  it("assertVerified throws with every finding in the message", async () => {
    const app = editFile(conformingSubApp(), ROUTES_PATH, "return reply.code(201).send({ ok: true });", 'return reply.code("201").send({ ok: true });');
    await expect(assertVerified(app, { repoRoot: REPO_ROOT })).rejects.toThrow(/wc-clock/);
  }, SLOW);
});

/** The rules above are raised from a whole sub-app, because that is how
 * they are met in practice. The two blocks below drive the compiler and
 * the probe DIRECTLY, for the verdicts that are backstops: a manifest that
 * throws on import, or an import of a package the host does not have, is
 * refused by a static rule long before it gets this far. Those rules are
 * still worth having and still have to be proven — a backstop nobody
 * tested is a backstop nobody has. */
describe("the compiler stage, on its own", () => {
  const compile = (path: string, contents: string) => typecheckCandidate([{ path, contents }], { repoRoot: REPO_ROOT });

  it("reports source that does not parse", () => {
    const result = compile("server/subapps/wc-clock/broken.ts", "export const broken = (;\n");
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.rule)).toContain("FD-T001");
    expect(result.findings[0]?.line).toBe(1);
  });

  it("reports an import of a package the host does not carry", () => {
    const result = compile("server/subapps/wc-clock/ids.ts", 'import { v4 } from "uuid";\nexport const id = v4();\n');
    const unresolved = result.findings.find((f) => f.rule === "FD-T002");
    expect(unresolved?.message).toContain("uuid");
    expect(unresolved?.message).toContain("nine leaf modules");
  });

  it("keeps tsc's own words for the repair loop", () => {
    const result = compile("server/subapps/wc-clock/ids.ts", "export const n: number = \"two\";\n");
    expect(result.output).toContain("error TS2322");
    expect(result.diagnosticCount).toBe(1);
  });
});

describe("the mount probe's own verdicts", () => {
  const context: MountContext = {
    id: "wc-clock",
    manifestPath: "server/subapps/wc-clock/manifest.ts",
    routePrefix: "/api/apps/wc-clock",
    tablePrefix: "subapp_wc_clock_",
    indexPrefix: "idx_wc_clock_",
    locate: () => null,
  };
  const probe = (manifestJs: string) =>
    mountProbe(new Map([["server/subapps/wc-clock/manifest.js", manifestJs]]), context, {
      repoRoot: REPO_ROOT,
      hostRuntime: FLIGHTDECK_HOST_SURFACE.runtime,
    });

  it("a manifest that throws on import takes the host down at boot (FD-R001)", async () => {
    const result = await probe('throw new Error("bad module-level work");\n');
    expect(result.findings.map((f) => f.rule)).toEqual(["FD-R001"]);
    expect(result.findings[0]?.message).toContain("bad module-level work");
  }, SLOW);

  it("a manifest missing the members the host calls (FD-R002)", async () => {
    const result = await probe('export const m = { id: "wc-clock", registerRoutes: undefined };\n');
    const rules = result.findings.map((f) => f.rule);
    expect(rules).toContain("FD-R002");
    expect(result.findings.some((f) => f.message.includes("initSchema"))).toBe(true);
    expect(result.findings.some((f) => f.message.includes("registerRoutes"))).toBe(true);
  }, SLOW);

  it("initSchema that throws stops the server starting (FD-R003)", async () => {
    const result = await probe(
      'export const m = { id: "wc-clock", initSchema: () => { throw new RangeError("no db"); }, registerRoutes: (app) => { app.get("/api/apps/wc-clock/x", async () => ({})); } };\n',
    );
    const init = result.findings.find((f) => f.rule === "FD-R003");
    expect(init?.message).toContain("RangeError: no db");
  }, SLOW);

  it("a sub-app that registers nothing mounts and 404s (FD-R005)", async () => {
    const result = await probe('export const m = { id: "wc-clock", initSchema: () => {}, registerRoutes: () => {} };\n');
    expect(result.findings.map((f) => f.rule)).toContain("FD-R005");
  }, SLOW);

  it("a route registered outside its own prefix (FD-R006)", async () => {
    const result = await probe(
      'export const m = { id: "wc-clock", initSchema: () => {}, registerRoutes: (app) => { const base = "/api/apps/"; app.get(base + "docusign/envelopes", async () => ({})); } };\n',
    );
    const outside = result.findings.find((f) => f.rule === "FD-R006");
    expect(outside?.message).toContain("/api/apps/docusign/envelopes");
    expect(outside?.message).toContain("/api/apps/wc-clock");
  }, SLOW);

  it("a probe that dies produces a refusal, never a pass (FD-R009)", async () => {
    const result = await probe("process.exit(7);\n");
    expect(result.ran).toBe(false);
    expect(result.findings.map((f) => f.rule)).toEqual(["FD-R009"]);
    expect(result.findings[0]?.message).toContain("exited 7");
  }, SLOW);
});

describe("the sandbox is a sandbox", () => {
  const stages: { dispose(): Promise<void> }[] = [];
  afterAll(async () => {
    for (const item of stages) await item.dispose();
  });

  it("is available, or the mount stage refuses instead of running unsandboxed", async () => {
    // Either the platform gives us isolation, or `mountProbe` reports
    // FD-R009. There is no third branch where generated code runs here.
    expect(await isolationAvailable()).toMatch(/^--(experimental-)?permission$/);
  });

  it("denies the probe process a filesystem write", async () => {
    const target = join(await mkdtemp(join(tmpdir(), "fd-sandbox-test-")), "escaped.txt");
    const staged = await stage({
      modules: new Map(),
      rootFiles: new Map([
        [
          "harness.mjs",
          `import { writeFileSync } from "node:fs";\n` +
            `try { writeFileSync(${JSON.stringify(target)}, "escaped"); console.log("WROTE"); }\n` +
            `catch (error) { console.log("DENIED:" + error.code); }\n`,
        ],
      ]),
      repoRoot: REPO_ROOT,
    });
    stages.push(staged);

    const run = await runSandboxed({ stage: staged, entry: "harness.mjs", timeoutMs: 15_000 });
    expect(run.stdout).toContain("DENIED:ERR_ACCESS_DENIED");
    expect(run.stdout).not.toContain("WROTE");
    await rm(target, { force: true });
  }, SLOW);

  it("kills a probe that will not finish, rather than waiting for it", async () => {
    const staged = await stage({
      modules: new Map(),
      rootFiles: new Map([["harness.mjs", "setInterval(() => {}, 1000);\nawait new Promise(() => {});\n"]]),
      repoRoot: REPO_ROOT,
    });
    stages.push(staged);

    const run = await runSandboxed({ stage: staged, entry: "harness.mjs", timeoutMs: 1_200 });
    expect(run.timedOut).toBe(true);
    expect(run.ok).toBe(false);
    expect(run.killedBy).toBe("SIGKILL");
  }, SLOW);

  it("an abort stops the process, not just the caller's view of it", async () => {
    const staged = await stage({
      modules: new Map(),
      rootFiles: new Map([["harness.mjs", "setInterval(() => {}, 1000);\nawait new Promise(() => {});\n"]]),
      repoRoot: REPO_ROOT,
    });
    stages.push(staged);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const run = await runSandboxed({ stage: staged, entry: "harness.mjs", timeoutMs: 30_000, signal: controller.signal });
    expect(run.aborted).toBe(true);
    expect(run.killedBy).toBe("SIGKILL");
    expect(run.durationMs).toBeLessThan(15_000);
  }, SLOW);

  it("hands the probe no environment to leak", async () => {
    const staged = await stage({
      modules: new Map(),
      rootFiles: new Map([["harness.mjs", 'console.log("ENV:" + Object.keys(process.env).sort().join(","));\n']]),
      repoRoot: REPO_ROOT,
    });
    stages.push(staged);

    const run = await runSandboxed({ stage: staged, entry: "harness.mjs", timeoutMs: 15_000 });
    expect(run.stdout.trim()).toBe("ENV:PATH");
  }, SLOW);

  it("keeps credentials out of retained output", () => {
    expect(redactSecrets('token: "ghp_abcdefghijklmnopqrstuvwxyz0123"')).toBe('token: "[redacted]"');
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop.qrst")).toContain("[redacted]");
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
  });
});
