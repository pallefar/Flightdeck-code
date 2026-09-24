/**
 * `studio-workflow-definition/1` — the file Studio hands the OS New-workflow wizard.
 *
 * The OS path for a described process is: Studio drafts this file → an OS admin imports it
 * in the New-workflow wizard and ticks the statutory steps AGAIN → the Workflow Builder
 * (`POST /api/workflows`) scaffolds the `teoa-process/1` manifest and a boot.json proposal.
 * So the file carries the Builder's body and nothing else: no prompts, no ladder, no gates,
 * no manifest. A model never decides a statutory step; a named human does, and the file
 * says who (`statutoryConfirmedBy`). A non-empty `statutorySteps` without that name is
 * refused, not defaulted.
 *
 * The golden fixture (`fixtures/studio-workflow-definition.golden.json`) is synthetic. It is
 * the byte-for-byte shape the OS import and its end-to-end test will copy, so it must
 * round-trip through `serializeWorkflowDefinition` byte-identically.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WORKFLOW_DEFINITION_SCHEMA_ID,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  workflowDefinitionSchema,
} from "./process-definition";
import * as spec from "./index";

const GOLDEN_URL = new URL("../../../fixtures/studio-workflow-definition.golden.json", import.meta.url);

/** A minimal valid definition; each case changes one thing. */
function valid(): Record<string, unknown> {
  return {
    schema: "studio-workflow-definition/1",
    by: "studio-test-author",
    name: "Synthetic onboarding",
    slug: "synthetic-onboarding",
    country: "DE",
    intakeFields: [{ name: "start_date", type: "date", required: true }],
    steps: ["intake_received", "validate", "statutory", "complete"],
    statutorySteps: [],
    statutoryConfirmedBy: null,
  };
}

const ok = (body: unknown) => workflowDefinitionSchema.safeParse(body).success;

describe("studio-workflow-definition/1 — what it accepts", () => {
  it("names its schema id", () => {
    expect(WORKFLOW_DEFINITION_SCHEMA_ID).toBe("studio-workflow-definition/1");
  });

  it("accepts the minimal valid definition", () => {
    const parsed = workflowDefinitionSchema.safeParse(valid());
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("accepts a draft whose author is not yet named (by: null)", () => {
    expect(ok({ ...valid(), by: null })).toBe(true);
  });

  it("accepts statutory steps once a named human has confirmed them", () => {
    expect(ok({ ...valid(), statutorySteps: ["statutory"], statutoryConfirmedBy: "studio-test-wc-reviewer" })).toBe(true);
  });

  it("accepts an optional entity and an optional intake-field source", () => {
    expect(
      ok({
        ...valid(),
        entity: "Synthetic GmbH",
        intakeFields: [{ name: "grade", type: "enum", required: false, source: "hris" }],
      }),
    ).toBe(true);
  });
});

describe("studio-workflow-definition/1 — what it refuses", () => {
  it.each(["prompts", "ladder", "gates", "manifest"])("refuses the unknown top-level key %s", (key) => {
    expect(ok({ ...valid(), [key]: key === "ladder" ? [] : {} })).toBe(false);
  });

  it("refuses an unknown key inside an intake field", () => {
    expect(ok({ ...valid(), intakeFields: [{ name: "x", type: "string", required: true, prompt: "…" }] })).toBe(false);
  });

  it("⭐ refuses non-empty statutorySteps while statutoryConfirmedBy is null — a model never decides a statutory step", () => {
    const parsed = workflowDefinitionSchema.safeParse({ ...valid(), statutorySteps: ["statutory"], statutoryConfirmedBy: null });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.path.join("."))).toContain("statutoryConfirmedBy");
  });

  it("refuses an empty statutoryConfirmedBy string (a name, not a blank)", () => {
    expect(ok({ ...valid(), statutorySteps: ["statutory"], statutoryConfirmedBy: "" })).toBe(false);
  });

  it("refuses a missing statutorySteps — the host's ['statutory'] default must never apply silently", () => {
    const { statutorySteps: _drop, ...rest } = valid();
    expect(ok(rest)).toBe(false);
  });

  it("refuses a statutory step that is not in steps", () => {
    expect(ok({ ...valid(), statutorySteps: ["works_council"], statutoryConfirmedBy: "studio-test-wc-reviewer" })).toBe(false);
  });

  it("refuses duplicate steps", () => {
    expect(ok({ ...valid(), steps: ["intake_received", "validate", "validate", "complete"] })).toBe(false);
  });

  it("refuses a ladder that does not start at intake_received or end at complete", () => {
    expect(ok({ ...valid(), steps: ["validate", "statutory", "complete"] })).toBe(false);
    expect(ok({ ...valid(), steps: ["intake_received", "validate", "statutory"] })).toBe(false);
  });

  it("refuses fewer than three steps", () => {
    expect(ok({ ...valid(), steps: ["intake_received", "complete"] })).toBe(false);
  });

  it("refuses a slug that is not kebab-case 3–40", () => {
    for (const slug of ["ab", "Synthetic", "has space", "x".repeat(41)]) expect(ok({ ...valid(), slug }), slug).toBe(false);
  });

  it("refuses an intake-field type outside the host's enum", () => {
    expect(ok({ ...valid(), intakeFields: [{ name: "x", type: "text", required: true }] })).toBe(false);
  });

  it("refuses no intake fields", () => {
    expect(ok({ ...valid(), intakeFields: [] })).toBe(false);
  });

  it("refuses a wrong schema id", () => {
    expect(ok({ ...valid(), schema: "teoa-process/1" })).toBe(false);
  });
});

describe("serializeWorkflowDefinition", () => {
  it("⭐ round-trips the golden fixture byte-identically", () => {
    const text = readFileSync(GOLDEN_URL, "utf8");
    const parsed = parseWorkflowDefinition(text);
    expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
    if (parsed.ok) expect(serializeWorkflowDefinition(parsed.definition)).toBe(text);
  });

  it("the golden fixture carries a confirmed statutory step, so the import path is exercised", () => {
    const parsed = parseWorkflowDefinition(readFileSync(GOLDEN_URL, "utf8"));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.definition.statutorySteps.length).toBeGreaterThan(0);
      expect(parsed.definition.statutoryConfirmedBy).not.toBeNull();
    }
  });

  it("writes keys in one canonical order whatever order they came in", () => {
    const reordered = Object.fromEntries(Object.entries(valid()).reverse());
    const a = serializeWorkflowDefinition(workflowDefinitionSchema.parse(valid()));
    const b = serializeWorkflowDefinition(workflowDefinitionSchema.parse(reordered));
    expect(b).toBe(a);
    expect(Object.keys(JSON.parse(a))[0]).toBe("schema");
    expect(a.endsWith("}\n")).toBe(true);
  });

  it("refuses to serialize an invalid definition — it never writes a file the import would reject", () => {
    const bad = { ...valid(), statutorySteps: ["statutory"], statutoryConfirmedBy: null };
    expect(() => serializeWorkflowDefinition(bad as never)).toThrow();
  });

  it("parseWorkflowDefinition names the error for non-JSON and for a schema failure", () => {
    const notJson = parseWorkflowDefinition("{");
    expect(notJson.ok).toBe(false);
    const wrong = parseWorkflowDefinition(JSON.stringify({ ...valid(), prompts: {} }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toMatch(/prompts/);
  });
});

describe("exported from @spec", () => {
  it("the index re-exports the schema, its id and the serializer", () => {
    expect(spec.workflowDefinitionSchema).toBe(workflowDefinitionSchema);
    expect(spec.WORKFLOW_DEFINITION_SCHEMA_ID).toBe(WORKFLOW_DEFINITION_SCHEMA_ID);
    expect(spec.serializeWorkflowDefinition).toBe(serializeWorkflowDefinition);
    expect(spec.parseWorkflowDefinition).toBe(parseWorkflowDefinition);
  });
});
