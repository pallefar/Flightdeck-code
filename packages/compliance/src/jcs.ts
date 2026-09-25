/**
 * RFC 8785 — the JSON Canonicalization Scheme (JCS), implemented here.
 *
 * ⭐ WHY THIS AND NOT `guardrails/src/hash.ts#canonicalJson`. That one is a
 * sort plus `JSON.stringify`, defined by this repo for this repo. A digest
 * that the OS admission side (upd-studio-admission) must RE-DERIVE from a
 * record Python wrote needs a canonical form both sides can implement from a
 * published spec, and JCS is that spec. It is small enough to own, and the
 * RFC's own vectors pin it (`__tests__/recordDigest.test.ts`), so no
 * dependency is added.
 *
 * The RFC's three rules, and where each lives:
 * - numbers are serialised as ECMAScript's Number::toString does, which is
 *   what `JSON.stringify` does for a finite number (-0 becomes "0");
 * - strings are serialised as `JSON.stringify` does (the short escapes,
 *   `\u00xx` lowercase for other controls, nothing else escaped), and a
 *   lone surrogate is REFUSED rather than escaped — it is not I-JSON;
 * - object members are sorted by their names' UTF-16 code units, which is
 *   the default `Array.prototype.sort` comparison on strings.
 *
 * ⛔ FAILS CLOSED. Anything JSON cannot carry — NaN, Infinity, undefined, a
 * bigint, a function, a Date or any other non-plain object — throws. The
 * alternative (`JSON.stringify` quietly writing `null` or dropping a key) is
 * a digest over something other than the value the caller holds.
 */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(`JCS: ${message}`);
    this.name = "CanonicalizationError";
  }
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function serialiseString(value: string): string {
  if (LONE_SURROGATE.test(value)) throw new CanonicalizationError("a string holds a lone surrogate, which is not I-JSON");
  return JSON.stringify(value);
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function serialise(value: unknown, where: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError(`${where} is ${String(value)}, which JSON cannot represent`);
      return JSON.stringify(value);
    case "string":
      return serialiseString(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => serialise(item, `${where}[${i}]`)).join(",")}]`;
      }
      if (!isPlainObject(value)) throw new CanonicalizationError(`${where} is not a plain object`);
      const keys = Object.keys(value).sort();
      const members = keys.map((key) => {
        const member = (value as Record<string, unknown>)[key];
        return `${serialiseString(key)}:${serialise(member, `${where}.${key}`)}`;
      });
      return `{${members.join(",")}}`;
    }
    default:
      throw new CanonicalizationError(`${where} is a ${typeof value}, which JSON cannot represent`);
  }
}

/** The RFC 8785 canonical text of `value`. Hash its UTF-8 bytes. */
export function canonicalize(value: unknown): string {
  return serialise(value, "$");
}
