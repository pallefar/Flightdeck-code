/**
 * ⭐ THE APPEND-ONLY CHAIN IS A CHANNEL TOO.
 *
 * Found by the red team after the envelope's wire was closed, and reproduced
 * here before it was fixed. `packages/envelope` refuses an unlisted fact key
 * POSITIONALLY (`facts.#0`) so the caller's string is never written down —
 * and `gateModelRequest` then classified the RAW request, so `auditBody` wrote
 * the key verbatim into `locations`. The control that closed the 64-character
 * `subject` channel left a 25x larger one beside it.
 *
 * The second half is worse than the first: `sanitizePathSegment` ended in
 * `return raw`. A bare IBAN was replaced by `<iban>`; the same IBAN with
 * `notes_iban` glued in front went through INTACT, because the pattern's `\b`
 * cannot match against a prefix. The redactor caught the naked case and missed
 * the disguised one.
 */
import { describe, expect, it } from "vitest";
import { sanitizePathSegment } from "../findings";
import { gateModelRequest } from "../gates";
import { FACT_KEY_ALLOWLIST } from "../../../envelope/src/allowlists";

const CTX = { actor: "karsten.haldan" } as never;
const IBAN = "DE02120300000000202051";

describe("a refused fact key does not reach the audit chain", () => {
  it("⭐ reports the ORDINAL, not the caller's key — the reproduction, verbatim", () => {
    const decision = gateModelRequest(
      { task: "kb.question", facts: { salary_of_AnnaMueller_92000: { kind: "count", value: 3 } } },
      CTX,
    );
    expect(decision.decision).toBe("refuse");
    const serialised = JSON.stringify(decision);
    // Measured before the fix: locations: ["facts.salary_of_AnnaMueller_92000"]
    expect(serialised).not.toContain("AnnaMueller");
    expect(serialised).not.toContain("92000");
  });

  it("⭐ a full IBAN glued to a label does not ride in on `locations`", () => {
    const decision = gateModelRequest(
      { task: "kb.question", facts: { [`notes_iban${IBAN}`]: { kind: "count", value: 1 } } },
      CTX,
    );
    expect(decision.decision).toBe("refuse");
    expect(JSON.stringify(decision)).not.toContain(IBAN);
  });

  it("the bulk version: 40 caller-chosen keys put no caller text in the event", () => {
    const facts: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) {
      facts[`salary_leak_chunk${i}_${IBAN.slice(0, 8)}`] = { kind: "count", value: i };
    }
    const decision = gateModelRequest({ task: "kb.question", facts }, CTX);
    expect(decision.decision).toBe("refuse");
    expect(JSON.stringify(decision)).not.toContain("salary_leak_chunk");
  });

  it("an ALLOWLISTED key is still named, because that is the point of a path", () => {
    // Redaction that hides the legitimate case too is not a fix, it is a
    // regression dressed as one.
    const key = FACT_KEY_ALLOWLIST.find((k) => k === "docCount");
    expect(key).toBeDefined();
    expect(sanitizePathSegment(key!, 0, [], FACT_KEY_ALLOWLIST)).toBe(key);
  });
});

describe("sanitizePathSegment no longer ends in `return raw` when given a set", () => {
  it("a non-member becomes its ordinal", () => {
    expect(sanitizePathSegment("whatever_the_caller_wrote", 7, [], ["a", "b"])).toBe("<key#7>");
  });

  it("⭐ and the denylist path now sees a value glued to a label", () => {
    // Before: the bare form was caught, the disguised one was echoed.
    expect(sanitizePathSegment(IBAN, 0, [])).toBe("<iban>");
    expect(sanitizePathSegment(`notes_iban${IBAN}`, 0, [])).not.toContain(IBAN);
  });

  it("does not mangle an ordinary key when no set is given", () => {
    expect(sanitizePathSegment("docCount", 0, [])).toBe("docCount");
    expect(sanitizePathSegment("lifecycleStage", 0, [])).toBe("lifecycleStage");
  });
});
