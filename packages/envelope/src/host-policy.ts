/**
 * READING THE HOST'S OBJECT-LITERAL TABLES OFF DISK, as source text.
 *
 * `packages/guardrails/src/host-source.ts` already does this for the host's
 * ARRAY lists and its `PII_PATTERNS`, and it is imported here rather than
 * re-implemented — including its `hostAvailability()`, whose rule this
 * package adopts unchanged: AN ABSENT HOST CHECKOUT IS A FAILING TEST, NOT A
 * SKIPPED ONE, unless a human sets an exact acknowledgement string. "A
 * warning is read by a human who is watching; an exit code is read by the
 * machine that merges."
 *
 * What is added here is the two tables that are OBJECT literals rather than
 * arrays — `VOCABULARIES` and `FACT_KEY_POLICY` — because those are where the
 * host keeps the parts of the allowlist Studio's copy is most likely to drift
 * from: a vocabulary gaining a member, a count key's ceiling being raised.
 *
 * ⚠ THE SAME DELIBERATELY DUMB PARSING, AND THE SAME TRAP. The host writes
 *
 *     export const FACT_KEY_POLICY: Readonly<Record<string, { kind: … }>> = { … }
 *
 * so "the first `{` after the const name" is the TYPE ANNOTATION's brace. A
 * parser that took it would read a balanced fragment of a type and compare it
 * against nothing — the exact failure `guardrails`' `balancedArray` header
 * records ("would have reported a clean pass against an empty list"). So this
 * anchors on the `=`, and `assertSubstantial` refuses any extraction small
 * enough to be that mistake.
 */

import { readNumberConst, stripCommentLines } from "../../guardrails/src/host-source";

/** The balanced `{...}` that is the VALUE of `const <name>`. Anchored on the
 * `=`, never on the name — see the header. */
export function balancedObject(src: string, name: string): string {
  const start = src.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`const ${name} not found in host source`);
  const eq = src.indexOf("=", start);
  if (eq < 0) throw new Error(`const ${name} has no initialiser`);
  const open = src.indexOf("{", eq);
  if (open < 0) throw new Error(`no object literal after const ${name}`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced object literal for ${name}`);
}

function assertSubstantial(what: string, block: string): string {
  if (block.replace(/\s/g, "").length < 40) {
    throw new Error(`extraction for ${what} is ${block.length} chars — the extractor found the wrong span`);
  }
  return block;
}

/** `{ name: ["a", "b"], … }` → `{ name: ["a","b"] }`. Used for the host's
 * `VOCABULARIES`, where a silently added MEMBER is the drift that matters. */
export function readHostRecordOfStringArrays(src: string, name: string): Record<string, string[]> {
  const inner = assertSubstantial(name, balancedObject(stripCommentLines(src), name));
  const out: Record<string, string[]> = {};
  for (const m of inner.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\[([^\]]*)\]/g)) {
    const key = m[1];
    const body = m[2];
    if (key === undefined || body === undefined) continue;
    out[key] = [...body.matchAll(/["']([^"']*)["']/g)].map((s) => s[1] ?? "");
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`${name} parsed to zero entries — the parser or the host changed shape`);
  }
  return out;
}

export interface HostKeyPolicy {
  readonly kind: string;
  readonly max?: number;
}

/**
 * `{ nodeCount: { kind: "count", max: 1000 }, docCount: { kind: "count", max:
 * MAX_COUNT }, … }`.
 *
 * A `max` that is an IDENTIFIER is resolved against the host file's own
 * numeric consts, because `docCount`'s ceiling IS `MAX_COUNT` there. Reading
 * it as "no ceiling" would let Studio's copy carry any number at all for that
 * key and still compare equal.
 */
export function readHostFactKeyPolicy(src: string): Record<string, HostKeyPolicy> {
  const clean = stripCommentLines(src);
  const inner = assertSubstantial("FACT_KEY_POLICY", balancedObject(clean, "FACT_KEY_POLICY"));
  const out: Record<string, HostKeyPolicy> = {};
  for (const m of inner.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*\{([^}]*)\}/g)) {
    const key = m[1];
    const body = m[2];
    if (key === undefined || body === undefined) continue;
    const kind = /kind:\s*["']([^"']+)["']/.exec(body)?.[1];
    if (kind === undefined) throw new Error(`FACT_KEY_POLICY: entry "${key}" has no kind`);
    const rawMax = /max:\s*([A-Za-z_$][A-Za-z0-9_$]*|[0-9_]+)/.exec(body)?.[1];
    if (rawMax === undefined) {
      out[key] = { kind };
      continue;
    }
    const max = /^[0-9_]+$/.test(rawMax) ? Number(rawMax.replace(/_/g, "")) : readNumberConst(clean, rawMax);
    out[key] = { kind, max };
  }
  if (Object.keys(out).length === 0) {
    throw new Error("FACT_KEY_POLICY parsed to zero entries — the parser or the host changed shape");
  }
  return out;
}
