/**
 * UTF-8 byte length, without `Buffer`.
 *
 * ⭐ WHY THIS EXISTS. `Buffer.byteLength` is a GLOBAL, so it reaches the
 * `buffer` builtin without an import line — and the purity fence that guards
 * this closure walks import lines. `pure-closure.test.ts` was green while
 * three files in the closure used `Buffer` and one used `process`: the check
 * was not wrong, it was looking at the wrong thing. A sub-app mounted in the
 * host has no `Buffer`, so this bound was computed by code that would have
 * thrown `ReferenceError` in the one process the contract says this runs in.
 *
 * Matches `Buffer.byteLength(s, "utf8")` exactly, including WHATWG's
 * substitution of U+FFFD (three bytes) for an unpaired surrogate — the same
 * rule `guardrails/src/sha256.ts` follows, and for the same reason: a bound
 * that disagrees with the encoder it is bounding is not a bound.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        // A real pair: one code point, four bytes, and the low half is
        // consumed here rather than counted again as a lone surrogate.
        bytes += 4;
        i += 1;
      } else {
        bytes += 3; // lone high surrogate → U+FFFD
      }
    } else {
      // Includes a lone LOW surrogate, which also encodes as U+FFFD.
      bytes += 3;
    }
  }
  return bytes;
}
