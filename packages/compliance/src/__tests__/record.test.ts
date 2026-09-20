/**
 * The host's verdict, admitted rather than read.
 *
 * `scripts/promote.sh` writes a `studio-compliance-record/1` file and
 * nothing opened it — the same shape as `effectiveGrant` having no call
 * site. These cases are about what a record has to prove before it is
 * allowed to authorise a write into the host repo.
 */
import { describe, expect, it } from "vitest";

import { MAX_RECORD_AGE_MS, admitComplianceRecord } from "../record";

const SPEC = "46927a342179b43c2a00a53ea848068fc8d2c168ba2dc825649a661316fca2de";
const NOW = Date.parse("2026-09-20T10:00:00Z");

const record = (over: Record<string, unknown> = {}) => ({
  schema: "studio-compliance-record/1",
  at: "2026-09-20T09:00:00Z",
  specSha256: SPEC,
  passed: ["studio-suite", "conformance-redteam", "generate-and-mount", "build-web", "host-gate"],
  failed: [],
  skipped: [],
  readyForProduction: true,
  verdict: "ready",
  ...over,
});

const admit = (value: unknown, over: { specSha256?: string; now?: number } = {}) =>
  admitComplianceRecord(value, { specSha256: over.specSha256 ?? SPEC, now: over.now ?? NOW });

describe("a record that certifies", () => {
  it("⭐ passes when every stack passed, none skipped, bound to this spec, and recent", () => {
    const result = admit(record());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.specSha256).toBe(SPEC);
    expect(result.record.passed).toContain("host-gate");
  });
});

describe("what it refuses", () => {
  it("⭐ a record whose verdict contradicts its own evidence", () => {
    // THE ONE THAT MATTERS. `readyForProduction` is a boolean the PRODUCER
    // wrote, in a JSON file anyone who can edit JSON can edit. Reading it is
    // the same mistake `envelope/src/tier-claim.ts` exists to fix.
    expect(admit(record({ failed: ["host-gate"], readyForProduction: true })).ok).toBe(false);
    const lying = admit(record({ failed: ["host-gate"], readyForProduction: true }));
    if (lying.ok) return;
    expect(lying.code).toBe("verdict-contradicts-its-own-evidence");
  });

  it("⭐ and it refuses a contradiction in the SAFE direction too", () => {
    // A record claiming NOT ready while its lists are clean is equally
    // evidence the file did not come from the gate. Believing it "because it
    // is cautious" would mean the boolean is still what decides.
    const result = admit(record({ readyForProduction: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("verdict-contradicts-its-own-evidence");
  });

  it("a failed stack", () => {
    const result = admit(record({ failed: ["host-gate"], readyForProduction: false }));
    expect(result.ok && false).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("stacks-failed");
  });

  it("⭐ a SKIPPED stack — a skip is never green", () => {
    // `promote.sh` quoting `gate.sh`: "a green gate that quietly exercised
    // one engine fewer than it looks like it did is the thing this file was
    // just changed to stop being possible."
    const result = admit(record({ skipped: ["host-gate-partial"], readyForProduction: false }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("stacks-skipped");
  });

  it("⭐ a run in which NOTHING passed — empty is not clean", () => {
    // Nothing failed and nothing was skipped is also true of a gate that
    // executed no stacks at all. This repo has already been caught once by
    // arithmetic that made "7 of 7 clean" guaranteed.
    const result = admit(record({ passed: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no-stack-passed");
  });

  it("⭐ a record for a DIFFERENT spec — it certifies one input, not a licence", () => {
    const result = admit(record(), { specSha256: `${"0".repeat(63)}1` });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("spec-hash-mismatch");
  });

  it("an expired record, and one from the future", () => {
    const old = admit(record(), { now: NOW + MAX_RECORD_AGE_MS + 1 });
    expect(old.ok).toBe(false);
    if (!old.ok) expect(old.code).toBe("record-expired");
    // A clock nobody set is the likeliest way to get a record from ahead.
    const ahead = admit(record({ at: "2027-01-01T00:00:00Z" }));
    expect(ahead.ok).toBe(false);
    if (!ahead.ok) expect(ahead.code).toBe("record-expired");
  });

  it("a record just inside the window still certifies — this is a check, not a wall", () => {
    const result = admit(record(), { now: Date.parse("2026-09-20T09:00:00Z") + MAX_RECORD_AGE_MS - 1000 });
    expect(result.ok).toBe(true);
  });

  it("a wrong schema, a non-object, and missing lists", () => {
    for (const [value, code] of [
      [null, "not-an-object"],
      ["ready", "not-an-object"],
      [record({ schema: "studio-compliance-record/2" }), "unknown-schema"],
      [record({ passed: "all" }), "missing-stack-lists"],
      [record({ failed: [1] }), "missing-stack-lists"],
    ] as const) {
      const result = admit(value);
      expect(result.ok, JSON.stringify(value)).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });

  it("a missing or unparseable timestamp and spec hash", () => {
    for (const [over, code] of [
      [{ specSha256: "" }, "spec-hash-missing"],
      [{ specSha256: 42 }, "spec-hash-missing"],
      [{ at: "not a date" }, "timestamp-missing"],
      [{ at: 17 }, "timestamp-missing"],
    ] as const) {
      const result = admit(record(over as Record<string, unknown>));
      expect(result.ok, JSON.stringify(over)).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });
});
