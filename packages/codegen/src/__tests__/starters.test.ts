/** The starter catalogue — the non-LLM path from "what I want" to a spec.
 *
 * Ruling 8: generation comes from the approved catalogue, never free-form
 * code. A starter is a spec SHAPE built only from catalogue operations and
 * approved proposal templates; the prompt only picks one and names it. These
 * cases pin that every starter generates, passes the conformance gate, and
 * that the picker is deterministic and refuses nothing a person can type. */
import { describe, expect, it } from "vitest";
import { runConformanceGate } from "@conformance/gate";

import { generateSubApp } from "../generate";
import { RESERVED_SUBAPP_IDS, miniAppSpecSchema } from "../spec-contract";
import { STARTERS, pickStarter, specForPrompt, specFromStarter, starterLabelFromPrompt } from "../starters";

describe("every starter is a spec the generator accepts and the gate passes", () => {
  for (const starter of STARTERS) {
    it(`${starter.id} generates and the gate finds no error`, () => {
      const spec = specFromStarter(starter.id, { label: "Test Desk" });
      expect(miniAppSpecSchema.safeParse(spec).success).toBe(true);
      const generated = generateSubApp(spec);
      const host = generated.files.filter((f) => f.kind !== "standalone");
      const report = runConformanceGate({ files: host.map((f) => ({ path: f.path, contents: f.contents })) });
      expect(report.findings.filter((f) => f.severity === "error")).toEqual([]);
      // D-036: every generated manifest carries the marker that keeps it off by default.
      const manifest = host.find((f) => f.path.endsWith("/manifest.ts"));
      expect(manifest?.contents).toContain('generatedBy: "flightdeck-studio"');
    });
  }
});

describe("pickStarter reads the request, deterministically", () => {
  it("a log/track request picks the table-backed records starter", () => {
    expect(pickStarter("I want to log supplier visits and track their status").id).toBe("records-log");
  });
  it("a hand-off / flag request picks the proposal starter", () => {
    expect(pickStarter("Let reviewers propose a hand-off or flag a divergence on a contract").id).toBe("handoff-desk");
  });
  it("anything else falls back to the read-only contract list", () => {
    expect(pickStarter("Show me the contract folders").id).toBe("contract-list");
    expect(pickStarter("zzz").id).toBe("contract-list");
  });
});

describe("the label and id come from the request, never collide with the host", () => {
  it('reads a quoted or "called" name', () => {
    expect(starterLabelFromPrompt('an app called "Supplier Visits" to log visits')).toBe("Supplier Visits");
    expect(starterLabelFromPrompt("an app named Vendor Tracker that logs vendors")).toBe("Vendor Tracker");
    expect(starterLabelFromPrompt("log visits")).toBeNull();
  });
  it("derives a kebab id from the label", () => {
    const spec = specForPrompt('Build an app called "Supplier Visits" to log visits');
    expect(spec.id).toBe("supplier-visits");
    expect(spec.label).toBe("Supplier Visits");
  });
  it("never produces a reserved host id", () => {
    for (const reserved of RESERVED_SUBAPP_IDS) {
      const label = reserved.replace(/-/g, " ");
      const spec = specForPrompt(`an app called "${label}"`);
      expect(RESERVED_SUBAPP_IDS as readonly string[]).not.toContain(spec.id);
    }
  });
  it("a name with no usable letters falls back to the starter's own label", () => {
    const spec = specForPrompt('an app called "!!!" to log things');
    expect(spec.id).toBe("records-log");
  });
  it("the request text itself is never emitted (it may carry a person's name)", () => {
    const spec = specForPrompt("log the visits Anna Sorensen made");
    expect(JSON.stringify(spec)).not.toContain("Anna");
  });
});
