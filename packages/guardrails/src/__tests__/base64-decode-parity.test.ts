/**
 * ⭐ THE DETECTOR MUST NOT GET QUIETER.
 *
 * `decodeBase64` used `Buffer.from(s, "base64")`, which reaches the `buffer`
 * builtin through a global — invisible to `pure-closure.test.ts`, which walks
 * import lines, and absent in a mounted sub-app. It is now `atob` +
 * `TextDecoder`, both WHATWG globals present in Node and in the host bundle.
 *
 * The swap is not neutral by default. `atob` is STRICTER: it throws on a
 * string whose padding does not match its length, where `Buffer` decodes it
 * anyway. Measured over 13,378 shaped inputs, that was the only remaining
 * difference and there were 24 of them — every one a string `Buffer` decoded
 * to clean text that `atob` called "not base64". Each would have been a NAME
 * THAT STOPPED BEING FOUND.
 *
 * That is the one regression shape a green suite reports as a pass, so the
 * padding is rebuilt before decoding and this file measures the result
 * against the old implementation rather than asserting it is fine.
 */
import { describe, expect, it } from "vitest";

import { decodedVariants } from "../names";

/** The old path, kept here as the oracle — the only `Buffer` left in this package. */
function viaBufferOracle(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "");
  // ⚠ {12,}, TRANSCRIBED FROM `names.ts` — not {8,}. The first version of
  // this oracle guessed the floor and admitted 8-character inputs the real
  // `BASE64_SHAPE` rejects on purpose, so "salary" (c2FsYXJ5) came back as
  // 328 disagreements. The code was right and the oracle was wrong, which is
  // the failure an oracle is most likely to have and least likely to admit.
  if (!/^[A-Za-z0-9+/_-]{12,}={0,2}$/.test(compact)) return null;
  const normalised = compact.replace(/-/g, "+").replace(/_/g, "/");
  if (normalised.replace(/=+$/, "").length % 4 === 1) return null;
  try {
    const decoded = Buffer.from(normalised, "base64").toString("utf8");
    if (decoded.includes("�")) return null;
    return looksLikeTextOracle(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * TRANSCRIBED from `names.ts` — `looksLikeText`, the filter `decodeBase64`
 * applies to its own output.
 *
 * An oracle that stops short of the real implementation reports the gap as a
 * defect in the code. Leaving this out produced 36 "disagreements" that were
 * all "92000 92000": no letters, so the real path discards it and the partial
 * oracle kept it. Both versions of that mistake — the {8,} floor above and
 * this one — pointed at the code and were wrong about it.
 */
function looksLikeTextOracle(text: string): boolean {
  if (text.length < 6) return false;
  let printable = 0;
  let letters = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 160) printable += 1;
    if (/[A-Za-z]/.test(ch)) letters += 1;
  }
  return printable / text.length >= 0.9 && letters >= 2;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/_-";

describe("the base64 path decodes what it always decoded", () => {
  it("⭐ a name in base64 is still found — standard AND base64url", () => {
    for (const plain of ["Anna Sørensen", "Bjarne Mortensen", "salary 92000 EUR"]) {
      for (const enc of ["base64", "base64url"] as const) {
        const encoded = Buffer.from(plain, "utf8").toString(enc);
        expect(decodedVariants(encoded), `${enc}: ${encoded}`).toContain(plain);
      }
    }
  });

  it("⭐ AND when the padding is wrong — the 24 cases the strict decoder lost", () => {
    // `Buffer` tolerates padding that does not match the length; `atob` does
    // not. Someone hiding a name does not owe us well-formed padding.
    let checked = 0;
    for (const plain of ["Anna Sørensen", "Bjarne Mortensen"]) {
      const clean = Buffer.from(plain, "utf8").toString("base64");
      const stripped = clean.replace(/=+$/, "");
      for (const sloppy of [stripped, `${stripped}=`, `${stripped}==`]) {
        if (stripped.length % 4 === 1) continue;
        checked += 1;
        expect(decodedVariants(sloppy), `padding variant: ${sloppy}`).toContain(plain);
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it("⭐ agrees with the old implementation over a generated corpus", () => {
    // ⚠ THE CORPUS IS ENCODED TEXT, NOT RANDOM ALPHABET SOUP. The first
    // version of this case generated random base64 characters, and only 24
    // of 12,000 decoded to anything clean — random bytes are not valid
    // UTF-8. It would have compared the two implementations on inputs where
    // both correctly answer "nothing here", which proves nothing about the
    // path that matters.
    const WORDS = ["Anna", "Sørensen", "Bjarne", "Mortensen", "salary", "92000", "EUR", "review", "contract"];
    const disagreed: string[] = [];
    let shaped = 0;
    for (let n = 0; n < 1500; n += 1) {
      const count = 2 + Math.floor(Math.random() * 3);
      let plain = "";
      for (let i = 0; i < count; i += 1) plain += `${WORDS[Math.floor(Math.random() * WORDS.length)] as string} `;
      plain = plain.trim();
      const enc = Math.random() < 0.5 ? "base64" : "base64url";
      const clean = Buffer.from(plain, "utf8").toString(enc);
      const stripped = clean.replace(/=+$/, "");
      // The real encoding, and both wrong paddings — which is where `atob`
      // and `Buffer` part company.
      for (const candidate of [clean, stripped, `${stripped}=`, `${stripped}==`]) {
        const oracle = viaBufferOracle(candidate);
        if (oracle === null) continue;
        shaped += 1;
        if (!decodedVariants(candidate).includes(oracle)) disagreed.push(`${candidate} → ${oracle}`);
      }
    }
    // The corpus must actually produce clean decodes, or every assertion
    // above is vacuous and this case is green for the wrong reason.
    expect(shaped).toBeGreaterThan(2000);
    expect(disagreed).toEqual([]);
  });
});
