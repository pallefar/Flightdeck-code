/**
 * ⭐ THE CASE THE LAST RED-TEAM ROUND WON, RE-RUN AGAINST THE ENVELOPE.
 *
 * The finding was: nested `JSON.stringify` defeats `classify()`, and
 * `classify()` was the only scanner behind all four gates. The fix that was
 * attempted then reproduced the same bug, because it was another scanner.
 *
 * This file is the argument that the envelope is a different KIND of answer.
 * It does not unwrap anything. It does not recognise anything. A nested
 * payload is refused because a string is expressible in a fact only as a
 * member of a compiled-in list, and a stringified record is not a member of
 * any list — WHICH IS ALSO WHY IT IS REFUSED AT EVERY DEPTH, including the
 * depths a scanner happens to win at and the encodings nobody has thought of
 * yet.
 *
 * The distinction worth keeping: a scanner's coverage is a list of things it
 * has been taught; an allowlist's coverage is a list of things it permits.
 * Only the second one is bounded.
 */

import { describe, expect, it } from "vitest";
import { classify } from "../../../guardrails/src/classify";
import { gateModelRequest } from "../../../guardrails/src/index";
import { buildEnvelope } from "../build";

const ACTOR = { actor: "karsten.haldan" };

/** A cat-4 disclosure whose whole content is a FIELD NAME plus a number.
 * Nothing in it matches a PII regex: "82000" is five digits and the host's
 * `digits` class needs a seven-character run. The disclosure is `salary`, and
 * the only thing that can see it is a scan of the KEY. */
const RECORD = { employeeSalary: 82000 };

function nested(depth: number): string {
  let s = JSON.stringify(RECORD);
  for (let i = 1; i < depth; i += 1) s = JSON.stringify(s);
  return s;
}

const DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8];

describe("the nested-stringify payload", () => {
  it("⭐ is refused by the envelope at EVERY depth, for the same reason each time", () => {
    for (const depth of DEPTHS) {
      // The natural way a caller would actually smuggle it: a text-shaped
      // field on an otherwise ordinary-looking request.
      const result = buildEnvelope({ task: "kb.question", facts: { context: { kind: "text", value: nested(depth) } } });
      expect(result.ok, `depth ${depth} was accepted`).toBe(false);
      if (result.ok) continue;
      expect(result.failures.map((f) => f.code)).toEqual(["text-must-use-the-pseudonymised-channel"]);
    }
  });

  it("⭐ is refused under an unlisted key at every depth, positionally", () => {
    for (const depth of DEPTHS) {
      const result = buildEnvelope({ task: "kb.question", facts: { payload: { kind: "text", value: nested(depth) } } });
      expect(result.ok, `depth ${depth} was accepted`).toBe(false);
      if (result.ok) continue;
      expect(result.failures.map((f) => f.code)).toEqual(["key-not-in-policy"]);
      expect(result.failures[0]?.at).toBe("facts.#0");
      // And the payload itself is not in the refusal.
      expect(JSON.stringify(result)).not.toContain("employeeSalary");
    }
  });

  it("⭐ and the outbound gate refuses it at every depth", () => {
    for (const depth of DEPTHS) {
      const d = gateModelRequest({ task: "draft", context: nested(depth) }, ACTOR);
      expect(d.decision, `depth ${depth} was allowed through the gate`).toBe("refuse");
      expect(d.envelope).toBeUndefined();
    }
  });
});

describe("why this is not just a better scanner", () => {
  it("⭐ THE DETECTOR STILL MISSES IT — and the refusal above does not depend on the detector", () => {
    // `classify()` is kept, DEMOTED: on the refusal path it annotates the
    // audit body so a human learns what was in there. It is not what refuses.
    // This case measures the gap rather than asserting it away.
    const missed = DEPTHS.filter((depth) => classify({ context: nested(depth) }).tier <= 2);
    const seen = DEPTHS.filter((depth) => classify({ context: nested(depth) }).tier >= 3);

    // Depth 1 is seen: `parseEmbeddedJson` unwraps one level and the key
    // `employeeSalary` is a tier-4 field name.
    expect(seen).toContain(1);
    // Everything past it is not. THIS IS THE LIVE MISS, asserted as current
    // behaviour so a future claim to the contrary has to come here and change
    // it — and so the "a sixth unwrapping pass would fix it" instinct has a
    // number to argue with.
    expect(missed, "the detector improved — good; move this case to a deeper or differently-encoded payload").not.toEqual(
      [],
    );
    expect(classify({ context: nested(2) }).tier).toBeLessThanOrEqual(2);

    // ⭐ AND YET the gate refused every one of them, including the ones the
    // detector scored tier 1. That is the whole claim of this package, stated
    // as a comparison rather than as prose.
    for (const depth of missed) {
      expect(gateModelRequest({ task: "draft", context: nested(depth) }, ACTOR).decision).toBe("refuse");
    }
  });

  it("refuses an innocuous unlisted payload identically — refusal is the default, not an alarm", () => {
    // Nothing objectionable is in this one. It is refused for exactly the same
    // reason, which is the property that makes the previous case hold for
    // encodings nobody has thought of.
    const innocuous = buildEnvelope({ task: "kb.question", facts: { payload: { kind: "text", value: "hello" } } });
    const dangerous = buildEnvelope({ task: "kb.question", facts: { payload: { kind: "text", value: nested(5) } } });
    expect(innocuous.ok).toBe(false);
    expect(dangerous.ok).toBe(false);
    if (innocuous.ok || dangerous.ok) return;
    expect(innocuous.failures.map((f) => f.code)).toEqual(dangerous.failures.map((f) => f.code));
  });
});
