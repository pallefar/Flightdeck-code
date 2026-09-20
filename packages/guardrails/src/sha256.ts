/**
 * SHA-256, synchronous, with no import — so a mounted sub-app can hash.
 *
 * ── ⚠ "NEVER HAND-ROLL CRYPTO" — WHY THIS IS THE EXCEPTION AND HOW IT IS
 *    KEPT HONEST ────────────────────────────────────────────────────
 * The rule exists because bespoke crypto fails in ways nobody notices: a
 * subtly wrong constant, a timing leak, a weak parameter. Two things make this
 * case different, and neither is "it is probably fine".
 *
 * 1. IT IS NOT A SECRET OPERATION. This hash is a CONTENT IDENTIFIER — the
 *    value a named human's approval is bound to, so an approval for one
 *    proposal cannot be replayed against another. It encrypts nothing, signs
 *    nothing, and derives no key. There is no timing channel to leak, because
 *    everything it hashes is already known to the caller.
 * 2. IT IS DIFFERENTIALLY TESTED AGAINST THE REAL ONE. `sha256.test.ts` runs
 *    the NIST vectors AND compares this implementation against `node:crypto`
 *    over thousands of generated inputs, including every length around the
 *    block and padding boundaries where an implementation like this actually
 *    goes wrong. A divergence of one byte fails the suite.
 *
 * ── WHY IT HAD TO EXIST ─────────────────────────────────────────────
 * `packages/conformance` lists "crypto" in NODE_BUILTINS and FD-C001 refuses a
 * mounted sub-app module that imports one, so a Studio route cannot reach
 * `node:crypto`. `SubAppCapabilities` exposes no digest. Web Crypto
 * (`globalThis.crypto.subtle`) needs no import but is ASYNC, and the gates are
 * synchronous all the way down.
 *
 * So the options were: make every gate async (a large change to working code,
 * for a hash), invent a host capability (not mine to add to someone else's
 * contract), or supply the 60 lines of a fully specified public algorithm and
 * prove them against the real one. This is the third.
 *
 * ⛔ DO NOT USE THIS FOR ANYTHING THAT NEEDS A SECRET. For an HMAC, a
 * signature or a KDF, use `node:crypto` from the Node side — `nodeDigest` in
 * `approval.ts` — or Web Crypto's async API.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** UTF-8 bytes of a JS string, without TextEncoder (absent in some sandboxes
 * and trivial to write correctly for a well-formed string). */
function utf8Bytes(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    // ⭐ A LONE SURROGATE BECOMES U+FFFD, because that is what Node and the
    // WHATWG encoder do, and this function's whole justification is matching
    // them byte for byte. Without it, "\uD800" hashed to something node:crypto
    // has never produced — and the differential test COULD NOT SEE IT: its
    // generator drew from `String.fromCharCode(32 + n % 200)`, which cannot
    // emit a surrogate. A differential test is only as wide as its inputs, and
    // mine was narrower than the domain it claimed to cover.
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** FIPS 180-4 SHA-256. Returns lowercase hex. */
export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;

  // Pad: 0x80, then zeros to 56 mod 64, then the 64-bit big-endian length.
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const lenOffset = withPad.length - 8;
  // Lengths beyond 2^32 bits (512MB) cannot occur for a proposal, but the high
  // word is written properly rather than assumed zero.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  withPad[lenOffset] = (hi >>> 24) & 0xff;
  withPad[lenOffset + 1] = (hi >>> 16) & 0xff;
  withPad[lenOffset + 2] = (hi >>> 8) & 0xff;
  withPad[lenOffset + 3] = hi & 0xff;
  withPad[lenOffset + 4] = (lo >>> 24) & 0xff;
  withPad[lenOffset + 5] = (lo >>> 16) & 0xff;
  withPad[lenOffset + 6] = (lo >>> 8) & 0xff;
  withPad[lenOffset + 7] = lo & 0xff;

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] =
        ((withPad[j] as number) << 24) |
        ((withPad[j + 1] as number) << 16) |
        ((withPad[j + 2] as number) << 8) |
        (withPad[j + 3] as number);
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = [
      h[0] as number, h[1] as number, h[2] as number, h[3] as number,
      h[4] as number, h[5] as number, h[6] as number, h[7] as number,
    ];

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i += 1) hex += (h[i] as number).toString(16).padStart(8, "0");
  return hex;
}

/** The route-safe `Digest`. Same signature as `nodeDigest`, same output. */
export const pureDigest = sha256Hex;
