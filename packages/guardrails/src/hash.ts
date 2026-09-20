/**
 * The part of hashing that was always pure, split out so the gates can run
 * inside a mounted sub-app.
 *
 * ⭐ WHY THIS FILE EXISTS. `packages/conformance`'s `NODE_BUILTINS` contains
 * "crypto", and FD-C001 refuses any mounted sub-app module that imports a node
 * builtin. `gates.ts` imported `contentHash`, `contentHash` imports
 * `node:crypto`, and therefore NO GATE IN THIS PACKAGE COULD BE CALLED FROM A
 * STUDIO ROUTE — the one process the contract says this work happens in.
 *
 * Nothing said so, because every test imports the gates from Node, where the
 * builtin is simply present. A package can be exhaustively tested and still be
 * unreachable from the place it was written for; the tests measure the code,
 * not the seam it has to fit through.
 *
 * So the digest becomes a PARAMETER. `canonicalJson` never needed crypto at
 * all — it is a sort and a `JSON.stringify` — and the one line that did is now
 * supplied by the caller: `node:crypto` from the CLI and host halves,
 * whatever the route has from inside the host. Same split codegen already
 * makes between `pure.ts` and `apply.ts`, for the same reason.
 */

/** A sha256-over-utf8 implementation. Hex, lowercase. */
export type Digest = (utf8: string) => string;

/**
 * Deterministic JSON: object keys sorted at every depth, so two structurally
 * equal proposals hash equal regardless of key insertion order. Arrays keep
 * their order — order is meaning in an array.
 *
 * Deliberately NOT the host's `canonicalPyJson`: that one exists to reproduce
 * a Python-side byte layout for the engine's chain, and reusing it here would
 * imply a compatibility this hash does not have and does not need.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, val] of entries) out[k] = walk(val);
    return out;
  };
  return JSON.stringify(walk(value));
}

/** The hash a human approves, given a digest to compute it with. */
export function contentHashWith(digest: Digest, value: unknown): string {
  return digest(canonicalJson(value));
}
