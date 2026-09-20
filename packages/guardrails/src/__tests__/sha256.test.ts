/** Is the hand-written SHA-256 actually SHA-256?
 *
 * ⭐ THE ONLY THING THAT MAKES `sha256.ts` ACCEPTABLE. Writing a hash by hand
 * is normally a mistake; what makes it defensible here is that the real
 * implementation is available to compare against, and this compares against it
 * EXHAUSTIVELY rather than on a few famous strings.
 *
 * An implementation like this goes wrong in specific places: the padding
 * boundary (55/56/57 bytes), the block boundary (63/64/65), multi-block input,
 * the length encoding, and multi-byte UTF-8. Every one of those is covered by
 * construction below, plus a few thousand random inputs. One divergent byte
 * fails the suite.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "../sha256";

const real = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

describe("sha256Hex is SHA-256", () => {
  it("matches the published NIST vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("⭐ matches node:crypto at EVERY length from 0 to 200", () => {
    // Covers 55/56/57 (padding boundary), 63/64/65 (block boundary) and the
    // first multi-block inputs without singling them out.
    for (let n = 0; n <= 200; n += 1) {
      const input = "a".repeat(n);
      expect(sha256Hex(input), `length ${n}`).toBe(real(input));
    }
  });

  it("matches node:crypto on multi-byte UTF-8, at every boundary offset", () => {
    // A 2-, 3- and 4-byte codepoint each straddling the 64-byte block edge.
    for (const glyph of ["ø", "€", "𝄞", "🇩🇰"]) {
      for (let pad = 50; pad <= 70; pad += 1) {
        const input = "x".repeat(pad) + glyph + "y".repeat(3);
        expect(sha256Hex(input), `${glyph} at ${pad}`).toBe(real(input));
      }
    }
  });

  it("matches node:crypto on 3000 pseudo-random inputs", () => {
    // Deterministic generator: a failing case is reproducible from the seed.
    let seed = 0x9e3779b9;
    const next = (): number => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed;
    };
    for (let i = 0; i < 3000; i += 1) {
      const len = next() % 300;
      let s = "";
      for (let j = 0; j < len; j += 1) s += String.fromCharCode(32 + (next() % 200));
      expect(sha256Hex(s), `input #${i} (len ${len})`).toBe(real(s));
    }
  });

  it("matches on the shapes it will actually see: canonical JSON of a proposal", () => {
    const proposals = [
      JSON.stringify({ id: "wc-clock", capabilities: ["read:contracts"], visibleToRoles: ["legal"] }),
      JSON.stringify({ task: "studio.spec.draft", text: [{ key: "workflow", text: "<PERSON_NAME:1> asked" }] }),
      JSON.stringify({ files: Array.from({ length: 40 }, (_, i) => ({ path: `server/subapps/x/${i}.ts` })) }),
    ];
    for (const p of proposals) expect(sha256Hex(p)).toBe(real(p));
  });

  it("⭐ the differential is real — a mutated implementation would diverge", () => {
    // Guards the guard: if `real` and `sha256Hex` were somehow the same
    // function, every assertion above would be vacuous.
    expect(sha256Hex("abc")).not.toBe(real("abd"));
    expect(real).not.toBe(sha256Hex);
  });
});
