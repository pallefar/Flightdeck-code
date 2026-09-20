/**
 * ⭐ A REPLACEMENT IS A CLAIM ABOUT THE THING IT REPLACED.
 *
 * `utf8ByteLength` exists because `Buffer.byteLength` is a global and so
 * reaches the `buffer` builtin without an import line — invisible to the
 * purity fence, and absent altogether in a mounted sub-app. Swapping it out
 * silently changes a BOUND if the two disagree anywhere, and the last time
 * this repo hand-rolled a UTF-8 routine (`guardrails/src/sha256.ts`) it
 * diverged from Node on lone surrogates — which no hand-written case would
 * have caught, because the generator could not produce one.
 *
 * So this compares against Node directly, over the whole BMP.
 */
import { describe, expect, it } from "vitest";

import { utf8ByteLength } from "../utf8";

describe("utf8ByteLength agrees with the encoder it replaced", () => {
  it("⭐ over every code unit in the BMP, one at a time", () => {
    const diverged: string[] = [];
    for (let c = 0; c <= 0xffff; c += 1) {
      const s = String.fromCharCode(c);
      if (utf8ByteLength(s) !== Buffer.byteLength(s, "utf8")) diverged.push(`U+${c.toString(16)}`);
    }
    expect(diverged).toEqual([]);
  });

  it("⭐ on surrogates — paired, lone, and reversed", () => {
    // The case that broke sha256: a lone surrogate encodes as U+FFFD, three
    // bytes, and a REVERSED pair is two lone surrogates rather than one
    // code point.
    const cases: string[] = [];
    for (const hi of [0xd800, 0xdbff]) {
      for (const lo of [0xdc00, 0xdfff, 0x41, 0xd800]) {
        cases.push(
          String.fromCharCode(hi, lo),
          String.fromCharCode(lo, hi),
          `a${String.fromCharCode(hi)}b${String.fromCharCode(lo)}`,
        );
      }
    }
    for (const s of cases) expect(utf8ByteLength(s), JSON.stringify(s)).toBe(Buffer.byteLength(s, "utf8"));
  });

  it("on multi-byte text, emoji and flag sequences", () => {
    for (const s of ["", "a", "ä", "€", "😀", "Anna Sørensen", "\u{10FFFF}", "🇩🇰🇩🇪", "日本語"]) {
      expect(utf8ByteLength(s), JSON.stringify(s)).toBe(Buffer.byteLength(s, "utf8"));
    }
  });

  it("on random strings across the full code-unit range", () => {
    for (let n = 0; n < 3000; n += 1) {
      let s = "";
      const len = 1 + Math.floor(Math.random() * 12);
      for (let i = 0; i < len; i += 1) s += String.fromCharCode(Math.floor(Math.random() * 0x11000));
      expect(utf8ByteLength(s), JSON.stringify(s)).toBe(Buffer.byteLength(s, "utf8"));
    }
  });
});
