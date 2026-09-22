/** Owner ruling 2026-09-22 (8), enforced where every path meets: @codegen's plan step.
 *
 * ⭐ WHY HERE. The catalogue used to be checked only where Studio PRODUCES a spec — the
 * prompt path (`pipeline/translate-spec.ts`) and the workflow conversion. The way into the
 * host is neither: `scripts/promote.sh` runs `codegen/src/cli.ts --spec <file>` on any
 * @codegen spec (`--spec -` exists "for piping a model's output straight in"), and the
 * workbench's `candidateFrom(spec)` takes any spec too. A review took `contractRunSpec`,
 * rewrote its `/flag` route to file a `salary-change` proposal with `salary` and
 * `employeeName`, and got a clean plan, a conformance gate with `ok: true`, and a route
 * that wrote both fields into the review inbox. `planSubApp` is the one function all four
 * paths go through, so the refusal lives there, and these cases are that probe and its
 * neighbours. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runConformanceGate } from "../../../conformance/src/gate";
import { contractRunSpec, minimalSpec, wcClockSpec } from "../fixtures/specs";
import { generateSubApp, type GenerateOptions } from "../generate";
import { stripComments } from "../invariants";
import { SpecRejectedError } from "../plan";
import { PROPOSAL_TEMPLATES, proposeOperation, templateContentHash, type ProposalTemplate } from "../proposal-templates";

const RULING = "owner ruling 2026-09-22 (8)";

const template = (id: string): ProposalTemplate => {
  const found = PROPOSAL_TEMPLATES.find((t) => t.id === id);
  if (found === undefined) throw new Error(`the ${id} template is missing`);
  return found;
};

type Json = Record<string, unknown>;

/** `contractRunSpec` with the operation of one of its two proposing routes replaced. */
function withOperation(routePath: "/flag" | "/handoff", operation: unknown): Json {
  const spec = structuredClone(contractRunSpec) as unknown as { domains: Array<{ name: string; routes: Json[] }> };
  const route = spec.domains.find((d) => d.name === "handoffs")?.routes.find((r) => r["path"] === routePath);
  if (route === undefined) throw new Error(`contractRunSpec has no ${routePath} route`);
  route["operation"] = operation;
  return spec as unknown as Json;
}

/** The issues `generateSubApp` refused with. Fails the test if it generated instead. */
function refusal(spec: unknown, options: GenerateOptions = {}): string[] {
  try {
    generateSubApp(spec, options);
  } catch (err) {
    if (err instanceof SpecRejectedError) return [...err.issues];
    throw err;
  }
  throw new Error("generateSubApp generated a spec it should have refused");
}

/** The review's probe, as it was run: invented fields on contract-run's `/flag`. */
const SALARY_CHANGE = {
  kind: "propose",
  proposalKind: "salary-change",
  ticketField: "ticket",
  auditEvent: "contract-run.salary-change-proposed",
  fields: [
    { name: "ticket", type: "string" },
    { name: "salary", type: "number" },
    { name: "employeeName", type: "string", maxLength: 120 },
  ],
};

/** The same catalogue with `step` approved — TEST ONLY, as `conversion.test.ts` does. */
function approvedStepCatalogue(): ProposalTemplate[] {
  return PROPOSAL_TEMPLATES.map((t) => {
    if (t.id !== "step") return t;
    const unsigned: ProposalTemplate = { ...t, approval: null };
    return { ...unsigned, approval: { approvedBy: "Test Approver", approvedAt: "2026-09-22", contentHash: templateContentHash(unsigned) } };
  });
}

describe("⛔ a proposing route whose fields came from no approved template is not generated", () => {
  it("⛔ the review's salary-change probe — refused by the plan, so no file exists for a gate to pass", () => {
    const issues = refusal(withOperation("/flag", SALARY_CHANGE));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("handoffs POST /flag");
    expect(issues[0]).toContain(RULING);
    // Names what IS approved, so the author has somewhere to go…
    expect(issues[0]).toContain('"divergence"');
    expect(issues[0]).toContain('"handoff"');
    // …and echoes nothing invented: a proposal kind or a field name can be a person's name.
    expect(issues[0]).not.toMatch(/salary|employeeName/);
  });

  it("⛔ the first review's pay-change probe on the same route is refused the same way", () => {
    const issues = refusal(
      withOperation("/flag", {
        kind: "propose",
        proposalKind: "pay-change",
        ticketField: "ticket",
        auditEvent: "contract-run.pay-change-proposed",
        fields: [
          { name: "ticket", type: "string" },
          { name: "salary", type: "number" },
          { name: "reason", type: "string" },
        ],
      }),
    );
    expect(issues.join("\n")).toContain(RULING);
    expect(issues.join("\n")).not.toMatch(/pay-change|salary/);
  });

  it("⛔ an approved template's kind with ONE field added is refused, naming the template and what differs", () => {
    const widened = proposeOperation(template("divergence"), "contract-run");
    const issues = refusal(withOperation("/flag", { ...widened, fields: [...widened.fields, { name: "salary", type: "number" }] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('template "divergence"');
    expect(issues[0]).toMatch(/\bfields\b/);
    expect(issues[0]).not.toContain("salary");
  });

  it("⛔ the catalogue is exact, not a ceiling — a dropped field or a loosened bound is refused too", () => {
    const divergence = proposeOperation(template("divergence"), "contract-run");
    const [ticket, note] = divergence.fields;
    expect(refusal(withOperation("/flag", { ...divergence, fields: [ticket] })).join("\n")).toContain(RULING);
    expect(refusal(withOperation("/flag", { ...divergence, fields: [ticket, { ...note, maxLength: 5000 }] })).join("\n")).toContain(RULING);
  });

  it("⛔ the right fields under another audit event are refused, naming `auditEvent`", () => {
    const divergence = proposeOperation(template("divergence"), "contract-run");
    const issues = refusal(withOperation("/flag", { ...divergence, auditEvent: "contract-run.flagged" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('template "divergence"');
    expect(issues[0]).toContain("auditEvent");
  });

  it("⛔ a template in the catalogue WITHOUT an approval (`step`) is refused as unapproved", () => {
    const issues = refusal(withOperation("/flag", proposeOperation(template("step"), "contract-run")));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('template "step"');
    expect(issues[0]).toContain("no approval record");
  });

  it("⛔ two routes filing one template are refused — their proposals would share a filename prefix", () => {
    const issues = refusal(withOperation("/handoff", proposeOperation(template("divergence"), "contract-run")));
    expect(issues.join("\n")).toMatch(/one route per proposal template/);
  });
});

describe("⭐ what the catalogue does generate", () => {
  it("contract-run's two approved templates, exactly, generate and pass the gate", () => {
    const generated = generateSubApp(contractRunSpec);
    const host = generated.files.filter((f) => f.kind !== "standalone");
    expect(runConformanceGate({ files: host.map((f) => ({ path: f.path, contents: f.contents })) }).ok).toBe(true);
  });

  it("the table-backed wc-clock fixture files its review request through the approved `divergence` template", () => {
    const review = generateSubApp(wcClockSpec).files.find((f) => f.path === "server/subapps/wc-clock/routes/review.ts");
    expect(review?.contents).toContain("wc-clock-divergence-");
  });

  it("read-only specs are unaffected, even by an empty catalogue", () => {
    expect(() => generateSubApp(minimalSpec, { proposalCatalogue: [] })).not.toThrow();
  });

  it("the TEST-ONLY override: an approved `step` generates; widened after approval, it does not", () => {
    const stepSpec = withOperation("/flag", proposeOperation(template("step"), "contract-run"));
    expect(() => generateSubApp(stepSpec, { proposalCatalogue: approvedStepCatalogue() })).not.toThrow();

    const widened = approvedStepCatalogue().map((t) =>
      t.id === "step" ? { ...t, fields: [...t.fields, { name: "salary", type: "number" as const }] } : t,
    );
    const widenedStep = widened.find((t) => t.id === "step");
    if (widenedStep === undefined) throw new Error("no step template");
    const issues = refusal(withOperation("/flag", proposeOperation(widenedStep, "contract-run")), { proposalCatalogue: widened });
    expect(issues[0]).toContain("changed since it was approved");
  });
});

/** The override exists so the refusals and the approved-`step` path can be tested. A
 * production caller that passed one would choose its own catalogue, so the set of
 * non-test files that name it is pinned: the two that define it, and the conversion, which
 * forwards its own TESTS-ONLY `catalogue` option and nothing else. */
describe("⛔ no production path chooses its own catalogue", () => {
  const ROOT = path.resolve(__dirname, "../../../..");
  const SCANNED = ["packages", "src", "server", "scripts"];

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__" && entry.name !== "__fixtures__") out.push(...sources(full));
      } else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it("only generate.ts, plan.ts and the conversion's test-only pass-through name `proposalCatalogue`", () => {
    const naming = SCANNED.flatMap((dir) => sources(path.join(ROOT, dir)))
      // Code, not prose: a comment explaining the override is not a caller of it.
      .filter((file) => stripComments(fs.readFileSync(file, "utf8")).includes("proposalCatalogue"))
      .map((file) => path.relative(ROOT, file))
      .sort();
    expect(naming).toEqual(["packages/codegen/src/generate.ts", "packages/codegen/src/plan.ts", "packages/subapp/src/studio/conversion.ts"]);
  });
});
