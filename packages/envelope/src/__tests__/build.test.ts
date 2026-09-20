/**
 * WHAT CAN AND CANNOT BE EXPRESSED.
 *
 * Every case here is the same question asked about a different input: can
 * this be BUILT from the compiled-in lists? Not one of them asks whether a
 * scanner recognised anything, and that is the property under test — the
 * refusals below hold for payloads no scanner would object to, which is
 * exactly why they hold for payloads it would miss.
 *
 * All fixtures fictional.
 */

import { describe, expect, it } from "vitest";
import { buildEnvelope, describeEnvelope } from "../build";
import { FACT_KEY_ALLOWLIST, MAX_COUNT } from "../allowlists";
import type { ExpressionFailure } from "../types";

const EXPRESSIBLE = {
  task: "intake.fieldmap",
  facts: {
    field: { kind: "fieldName", value: "startDate" },
    fieldCount: { kind: "count", value: 12 },
    confidence: { kind: "enum", vocabulary: "confidence", value: "high" },
  },
};

function codes(failures: readonly ExpressionFailure[] | undefined): string[] {
  return (failures ?? []).map((f) => f.code);
}

describe("an expressible request becomes an envelope", () => {
  it("builds, and the wire form is the three validated headers plus the facts", () => {
    const result = buildEnvelope(EXPRESSIBLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disposition).toBe("ready");
    expect(result.approvalReasons).toEqual([]);
    const parsed = JSON.parse(result.wire) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["facts", "model", "provider", "task"]);
    expect(parsed["task"]).toBe("intake.fieldmap");
    expect(result.bytes).toBe(Buffer.byteLength(result.wire, "utf8"));
  });

  it("orders facts by key, so the same request is the same bytes", () => {
    const a = buildEnvelope(EXPRESSIBLE);
    const b = buildEnvelope({
      task: "intake.fieldmap",
      facts: {
        confidence: { kind: "enum", vocabulary: "confidence", value: "high" },
        fieldCount: { kind: "count", value: 12 },
        field: { kind: "fieldName", value: "startDate" },
      },
    });
    expect(a.ok && b.ok && a.wire).toBe(b.ok ? b.wire : "");
  });

  it("describes itself with keys and counts only — never a value", () => {
    const result = buildEnvelope(EXPRESSIBLE);
    if (!result.ok) throw new Error("expected an envelope");
    const described = describeEnvelope(result);
    expect(described.factKeys).toEqual(["confidence", "field", "fieldCount"]);
    expect(described.kindCounts).toEqual({ enum: 1, count: 1, fieldName: 1 });
    expect(JSON.stringify(described)).not.toContain("startDate");
  });
});

describe("the task, the provider and the model are compiled-in on both sides", () => {
  it("refuses an unknown task WITHOUT echoing it", () => {
    const result = buildEnvelope({ task: "summarise-the-attached-record-for-jane-doe", facts: {} });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.failures)).toContain("unknown-task");
    expect(JSON.stringify(result)).not.toContain("jane-doe");
  });

  it("refuses a provider or model that is not compiled in", () => {
    expect(codes((buildEnvelope(EXPRESSIBLE, { provider: "some-proxy" }) as { failures?: readonly ExpressionFailure[] }).failures)).toContain(
      "provider-not-selectable",
    );
    expect(codes((buildEnvelope(EXPRESSIBLE, { model: "gpt-9" }) as { failures?: readonly ExpressionFailure[] }).failures)).toContain(
      "model-not-known",
    );
  });
});

describe("the key policy", () => {
  it("refuses an unlisted key POSITIONALLY — the key itself is caller data", () => {
    // The host's own lesson: a fact key was "a free-text channel straight to
    // the wire, the audit event, the refusal messages and the edge function's
    // 400 bodies", and `salary_of_Jane_Doe_92000` "produces ZERO findings
    // under this module's own PII_PATTERNS".
    const result = buildEnvelope({
      task: "kb.question",
      facts: { salary_of_Jane_Doe_92000: { kind: "count", value: 1 } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.failures)).toEqual(["key-not-in-policy"]);
    expect(result.failures[0]?.at).toBe("facts.#0");
    expect(JSON.stringify(result)).not.toContain("Jane");
    expect(JSON.stringify(result)).not.toContain("92000");
  });

  it("refuses an INHERITED key — `__proto__` and friends are not policies", () => {
    // The host closed this one by own-property lookup: a key that merely NAMES
    // an Object.prototype member "resolved to a TRUTHY object that is not a
    // policy at all", and `JSON.parse` creates a real own `__proto__` data
    // property, which is how a request body arrives.
    for (const key of ["__proto__", "toString", "constructor", "valueOf", "hasOwnProperty"]) {
      const facts = JSON.parse(`{"${key}": {"kind": "count", "value": 1}}`) as Record<string, unknown>;
      const result = buildEnvelope({ task: "kb.question", facts });
      expect(result.ok, `${key} was accepted as a fact key`).toBe(false);
      if (!result.ok) expect(codes(result.failures)).toContain("key-not-in-policy");
    }
  });

  it("refuses a fact whose kind disagrees with its key, naming the expected kind", () => {
    const result = buildEnvelope({ task: "kb.question", facts: { fieldCount: { kind: "fieldName", value: "entity" } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]).toEqual({ code: "kind-mismatch", at: "facts.fieldCount", expected: "count" });
  });

  it("refuses a bare value — a fact must be TAGGED with its kind", () => {
    const result = buildEnvelope({ task: "kb.question", facts: { fieldCount: 3 } });
    expect(codes((result as { failures?: readonly ExpressionFailure[] }).failures)).toEqual(["fact-not-a-tagged-fact"]);
  });

  it("every allowlisted key is identifier-shaped, so naming one in a refusal is safe", () => {
    for (const key of FACT_KEY_ALLOWLIST) expect(key).toMatch(/^[A-Za-z][A-Za-z0-9]{0,39}$/);
  });
});

describe("values can only be drawn from the lists", () => {
  it("refuses an enum value that is not a member, without echoing the value", () => {
    const result = buildEnvelope({
      task: "kb.question",
      facts: { qcStatus: { kind: "enum", vocabulary: "qcStatus", value: "Erika Musterfrau" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("value-not-in-vocabulary");
    expect(JSON.stringify(result)).not.toContain("Musterfrau");
  });

  it("refuses an unknown vocabulary, including an INHERITED one", () => {
    for (const vocabulary of ["invented", "__proto__", "toString"]) {
      const facts = JSON.parse(`{"qcStatus": {"kind":"enum","vocabulary":"${vocabulary}","value":"done"}}`) as Record<
        string,
        unknown
      >;
      const result = buildEnvelope({ task: "kb.question", facts });
      expect(result.ok, `vocabulary "${vocabulary}" was accepted`).toBe(false);
      if (!result.ok) expect(codes(result.failures)).toContain("unknown-vocabulary");
    }
  });

  it("refuses a field NAME that is not on the allowlist", () => {
    const result = buildEnvelope({ task: "kb.question", facts: { field: { kind: "fieldName", value: "salaryEur" } } });
    expect(codes((result as { failures?: readonly ExpressionFailure[] }).failures)).toEqual([
      "field-name-not-allowlisted",
    ]);
  });

  it("⭐ a fieldName fact carries the NAME and can never carry the CONTENTS", () => {
    // `lastName` is an allowlisted field name and `"Musterfrau"` is not, which
    // is the whole distinction: "tell the model WHICH field to look at without
    // telling it what is in the field".
    expect(buildEnvelope({ task: "kb.question", facts: { field: { kind: "fieldName", value: "lastName" } } }).ok).toBe(
      true,
    );
    expect(
      buildEnvelope({ task: "kb.question", facts: { field: { kind: "fieldName", value: "Musterfrau" } } }).ok,
    ).toBe(false);
  });
});

describe("a count is a bounded integer, not a numeric channel", () => {
  const cases: readonly { what: string; value: unknown; code: string }[] = [
    { what: "a decimal (a geo coordinate)", value: 49.87, code: "count-not-a-safe-integer" },
    { what: "exponential notation", value: 1e21, code: "count-not-a-safe-integer" },
    { what: "a negative", value: -1, code: "count-negative" },
    { what: "over the key's own ceiling", value: 101, code: "count-over-ceiling" },
    { what: "a string", value: "82000", code: "count-not-a-safe-integer" },
  ];
  for (const { what, value, code } of cases) {
    it(`refuses ${what}`, () => {
      const result = buildEnvelope({ task: "kb.question", facts: { fieldCount: { kind: "count", value } } });
      expect(codes((result as { failures?: readonly ExpressionFailure[] }).failures)).toEqual([code]);
    });
  }

  it("⭐ the ceiling is SEMANTIC — it comes from the key, not from one global guess", () => {
    // "A ceiling alone cannot tell 4,200 documents from a €4,200 monthly
    // gross, but a ceiling attached to `gatewayCount` can."
    expect(buildEnvelope({ task: "kb.question", facts: { fieldCount: { kind: "count", value: 4200 } } }).ok).toBe(false);
    expect(buildEnvelope({ task: "kb.question", facts: { docCount: { kind: "count", value: 4200 } } }).ok).toBe(true);
    expect(buildEnvelope({ task: "kb.question", facts: { docCount: { kind: "count", value: MAX_COUNT + 1 } } }).ok).toBe(
      false,
    );
  });

  it("names the ceiling it applied, which is compiled-in, and never the value", () => {
    const result = buildEnvelope({ task: "kb.question", facts: { laneCount: { kind: "count", value: 92000 } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]).toEqual({ code: "count-over-ceiling", at: "facts.laneCount", expected: "100" });
    expect(JSON.stringify(result)).not.toContain("92000");
  });
});

describe("there is no free-form region at all", () => {
  it("refuses an unrecognised TOP-LEVEL field — `notes:` is a free-text channel", () => {
    const result = buildEnvelope({
      task: "kb.question",
      facts: {},
      notes: "confirm with e.musterfrau@example.de before Friday",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.failures)).toContain("unknown-top-level-field");
    // Positional, like any caller-authored key.
    expect(JSON.stringify(result)).not.toContain("notes");
    expect(JSON.stringify(result)).not.toContain("musterfrau");
  });

  it("refuses a text fact written into `facts` — the one door is the other one", () => {
    const result = buildEnvelope({
      task: "kb.question",
      facts: { question: { kind: "text", value: "anything at all" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]).toEqual({
      code: "text-must-use-the-pseudonymised-channel",
      at: "facts.question",
      expected: "input.text[]",
    });
  });

  it("refuses a non-object, an array and a string outright", () => {
    for (const input of ["a prompt", 42, null, undefined, ["task"], new Map()]) {
      const result = buildEnvelope(input);
      expect(result.ok, `${String(input)} was accepted`).toBe(false);
    }
  });

  it("reports EVERY part that could not be expressed, not just the first", () => {
    const result = buildEnvelope({
      task: "draft",
      facts: { openCount: { kind: "count", value: 1 }, field: { kind: "fieldName", value: "salaryEur" } },
      notes: "x",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codes(result.failures).sort()).toEqual([
      "field-name-not-allowlisted",
      "key-not-in-policy",
      "unknown-task",
      "unknown-top-level-field",
    ]);
  });
});
