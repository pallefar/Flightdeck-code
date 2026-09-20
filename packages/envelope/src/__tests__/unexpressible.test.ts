/** The claim this package exists to make: the representation attacks that beat
 * the scanner are not merely REFUSED here, they cannot be EXPRESSED.
 *
 * ⚠ WHY THIS FILE, AND NOT THE PROBES IT REPLACES. The build left
 * `src/__probe__/{attack,surface}.test.ts` behind: two files vitest collects,
 * 12 console.log calls between them, ZERO expect() calls. They print the right
 * answers and assert none of them, so they pass whatever the code does. That is
 * the sixth instance of this shape in this project, and one of the earlier ones
 * was printing a live plaintext leak while reporting 7 tests passing.
 *
 * The distinction being pinned here is the one that matters and is easy to lose:
 *   "the scan refused it"      — a scanner looked and found something
 *   "it cannot be expressed"   — there is no shape in the envelope that holds it
 * Only the second survives an encoding nobody thought of. */
import { describe, expect, it } from "vitest";
import { buildEnvelope } from "../build";

/** The payload that defeated classify() five rounds in: a cat-4 record wrapped
 * in JSON.stringify until the walker ran out of depth and failed OPEN. */
const NESTED = (() => {
  let s: string = JSON.stringify({ employeeSalary: 82000, owner: "Erika Musterfrau" });
  for (let i = 0; i < 4; i++) s = JSON.stringify({ wrapped: s });
  return s;
})();

const SECRETS = ["82000", "Erika", "Musterfrau", "employeeSalary"] as const;

function wireOf(result: unknown): string {
  return JSON.stringify(result ?? {});
}

describe("the nested-JSON payload has nowhere to live", () => {
  // Every route a caller could try to smuggle it through, named by the route.
  const routes: ReadonlyArray<readonly [string, unknown]> = [
    ["as a fact value", { task: "kb.question", facts: { context: NESTED } }],
    ["as an unknown key", { task: "kb.question", facts: { [NESTED.slice(0, 20)]: { kind: "count", value: 1 } } }],
    ["as a top-level field", { task: "kb.question", facts: {}, smuggled: NESTED }],
    ["as a field name", { task: "kb.question", facts: { field: { kind: "fieldName", value: NESTED } } }],
    ["as an enum value", { task: "kb.question", facts: { country: { kind: "enum", vocabulary: "country", value: NESTED } } }],
  ];

  it.each(routes)("refuses it %s, by shape", (_route, input) => {
    const r = buildEnvelope(input as never) as { ok: boolean };
    expect(r.ok, "an allowlist must refuse what it cannot express").toBe(false);
  });

  it.each(routes)("and never puts it on the wire %s", (_route, input) => {
    const wire = wireOf(buildEnvelope(input as never));
    for (const secret of SECRETS) {
      expect(wire, `"${secret}" reached the serialised envelope`).not.toContain(secret);
    }
  });
});

describe("a carrier that cannot be expressed is dropped, never carried", () => {
  // Map, toJSON and symbol keys were three of the attacks that beat classify().
  // Here they may BUILD, because the carrier itself is inert — what must hold is
  // that the smuggled payload is absent from the wire.
  const carriers: ReadonlyArray<readonly [string, unknown]> = [
    ["a Map of facts", { task: "kb.question", facts: new Map([["context", NESTED]]) }],
    ["a toJSON carrier", { task: "kb.question", facts: { docCount: { kind: "count", value: 1 }, evil: { toJSON: () => NESTED } } }],
    ["a symbol-keyed fact", (() => {
      const facts: Record<string, unknown> = { docCount: { kind: "count", value: 1 } };
      (facts as Record<symbol, unknown>)[Symbol.for("context")] = NESTED;
      return { task: "kb.question", facts };
    })()],
  ];

  it.each(carriers)("drops %s without carrying its payload", (_name, input) => {
    const wire = wireOf(buildEnvelope(input as never));
    for (const secret of SECRETS) {
      expect(wire, `"${secret}" survived via the carrier`).not.toContain(secret);
    }
  });
});

describe("it refuses, and it never certifies", () => {
  it("reports what it did NOT check, on a refusal", () => {
    const r = buildEnvelope({ task: "kb.question", facts: { context: NESTED } } as never) as {
      assurance?: { notChecked?: readonly string[] };
    };
    expect(r.assurance?.notChecked ?? [], "a control may refuse but must never certify clean")
      .not.toHaveLength(0);
  });

  it("reports what it did NOT check on a SUCCESS too — the dangerous case", () => {
    // The failure this rule exists to prevent is a clean bill on a happy path.
    const r = buildEnvelope({ task: "kb.question", facts: { docCount: { kind: "count", value: 1 } } } as never) as {
      ok: boolean; assurance?: { notChecked?: readonly string[] };
    };
    expect(r.ok).toBe(true);
    expect(r.assurance?.notChecked ?? [], "a successful build is not a statement that the payload is clean")
      .not.toHaveLength(0);
  });
});
