/**
 * `recordDigest` — the sha256 a provenance sidecar uses to name the
 * compliance record it rests on.
 *
 * A digest over a JSON value is only a digest if two parties who hold the
 * same value compute the same bytes. `promote.sh` writes the record with
 * Python's `json.dump(indent=2)`; the OS admission side (upd-studio-admission)
 * reads it with something else. So the bytes hashed are NOT the file's bytes
 * but the RFC 8785 (JCS) canonical form of the parsed value, implemented in
 * this repo (`jcs.ts`) and pinned here by the RFC's own vectors — an
 * implementation that drifts from the RFC fails these, not a production run.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { CanonicalizationError, canonicalize } from "../jcs";
import { recordDigest } from "../record";

/** An IEEE-754 double from its big-endian hex, as RFC 8785 Appendix B lists them. */
function double(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe("canonicalize — RFC 8785 vectors", () => {
  it("⭐ the RFC's §3.2.2 example serialises exactly as §3.2.3 prints it", () => {
    // The input as the RFC writes it, parsed (the literal is the point: 4.50,
    // 2e-3 and the escapes are what JCS has to normalise).
    const input = JSON.parse(
      String.raw`{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/","literals":[null,true,false]}`,
    );
    expect(canonicalize(input)).toBe(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
    );
  });

  it("sorts keys by UTF-16 code units, not by code point or locale (§3.2.3 sorting example)", () => {
    const input = JSON.parse(
      String.raw`{"\u20ac":"Euro Sign","\r":"Carriage Return","\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\ud83d\ude00":"Emoji: Grinning Face","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis"}`,
    );
    // Member order in the canonical TEXT (Object.keys would reorder "1" first — integer-like keys — so the text is read, not re-parsed).
    const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    expect(keys).toEqual(["\r", "1", "\u0080", "\u00f6", "\u20ac", "\ud83d\ude00", "\ufb33"]);
    expect(canonicalize(input).startsWith(String.raw`{"\r":"Carriage Return","1":"One",`)).toBe(true);
  });

  it.each([
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ])("number %s serialises as %s (Appendix B)", (hex, expected) => {
    expect(canonicalize(double(hex))).toBe(expected);
  });

  it.each([
    ["7fffffffffffffff", "NaN"],
    ["7ff0000000000000", "Infinity"],
  ])("number %s (%s) is refused, not written as null", (hex) => {
    expect(() => canonicalize(double(hex))).toThrow(CanonicalizationError);
  });

  it("refuses what JSON cannot carry instead of dropping it: undefined, a lone surrogate, a bigint, a Date", () => {
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize("\ud800")).toThrow(CanonicalizationError);
    expect(() => canonicalize({ n: 1n })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ at: new Date(0) })).toThrow(CanonicalizationError);
    expect(() => canonicalize([() => 1])).toThrow(CanonicalizationError);
  });

  it("keeps array order — order is meaning in an array", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("recordDigest", () => {
  // A studio-compliance-record/1 as promote.sh writes it.
  const record = {
    schema: "studio-compliance-record/1",
    at: "2026-09-20T09:00:00Z",
    specSha256: "46927a342179b43c2a00a53ea848068fc8d2c168ba2dc825649a661316fca2de",
    passed: ["studio-suite", "host-gate"],
    failed: [],
    skipped: [],
    readyForProduction: true,
    verdict: "ready",
    note: "Signed off by a human only after reading the stack list. A skipped stack is not a passed stack.",
  };
  // Written out by hand, and hashed with `printf '%s' … | shasum -a 256`
  // outside this code — so the pin does not depend on the function it pins.
  const CANONICAL =
    '{"at":"2026-09-20T09:00:00Z","failed":[],"note":"Signed off by a human only after reading the stack list. A skipped stack is not a passed stack.","passed":["studio-suite","host-gate"],"readyForProduction":true,"schema":"studio-compliance-record/1","skipped":[],"specSha256":"46927a342179b43c2a00a53ea848068fc8d2c168ba2dc825649a661316fca2de","verdict":"ready"}';
  const PINNED = "59732737c50f2d904c9c8455093ddacca58e0fba21ce2885c6c3a7e215315150";

  it("⭐ is the sha256 of the JCS bytes — pinned against a hash computed outside this code", () => {
    expect(canonicalize(record)).toBe(CANONICAL);
    expect(createHash("sha256").update(CANONICAL, "utf8").digest("hex")).toBe(PINNED);
    expect(recordDigest(record)).toBe(PINNED);
  });

  it("does not depend on how the file was formatted: Python's indent=2 and a reordered one hash the same", () => {
    const pythonish = JSON.parse(JSON.stringify(record, null, 2));
    const reordered = Object.fromEntries(Object.entries(record).reverse());
    expect(recordDigest(pythonish)).toBe(PINNED);
    expect(recordDigest(reordered)).toBe(PINNED);
  });

  it("changes when any field changes — a digest that ignores the verdict certifies nothing", () => {
    expect(recordDigest({ ...record, readyForProduction: false })).not.toBe(PINNED);
    expect(recordDigest({ ...record, skipped: ["host-gate-partial"] })).not.toBe(PINNED);
  });

  it("refuses a value that is not a record-shaped object", () => {
    expect(() => recordDigest(null)).toThrow();
    expect(() => recordDigest([record])).toThrow();
  });
});
