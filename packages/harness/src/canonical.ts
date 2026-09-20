/** Canonical JSON — one byte sequence per value, so a hash of it is an identity.
 *
 * Every other file here leans on this. A fixture is found by hashing a request,
 * so `{model, system}` and `{system, model}` MUST produce the same bytes, or a
 * test that reorders two object literals silently re-records the world.
 *
 * ⛔ THE RULE THIS FILE EXISTS TO ENFORCE: a value this serializer cannot
 * represent is an error, never a silent substitution. `JSON.stringify` turns a
 * function into `undefined`, `NaN` into `null`, and drops a key it dislikes — so
 * two different requests can serialize to the same string and collide on one
 * fixture. Here they throw, naming the path, because a key collision surfaces as
 * "the model returned the wrong thing" hours later and nobody looks at the hash.
 */
import { createHash } from "node:crypto";

const PLAIN_OBJECT_PROTO: unknown = Object.getPrototypeOf({}) as unknown;

/** Guards against a pathological nest blowing the stack before the cycle check sees it. */
const MAX_DEPTH = 64;

export class CanonicalizeError extends Error {
  /** JSON-path-ish location of the offending value, e.g. `$.messages[2].send`. */
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} (at ${path})`);
    this.name = "CanonicalizeError";
    this.path = path;
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type !== "object") return type;
  const proto: unknown = Object.getPrototypeOf(value as object) as unknown;
  if (proto === null) return "null-prototype object";
  const name = (value as { constructor?: { name?: string } }).constructor?.name;
  return name === undefined || name === "" ? "class instance" : `${name} instance`;
}

function writeValue(
  value: unknown,
  path: string,
  out: string[],
  indent: number,
  depth: number,
  seen: Set<object>,
): void {
  if (depth > MAX_DEPTH) {
    throw new CanonicalizeError(`nested deeper than ${MAX_DEPTH} levels`, path);
  }
  if (value === null) {
    out.push("null");
    return;
  }

  const type = typeof value;
  if (type === "boolean") {
    out.push(value === true ? "true" : "false");
    return;
  }
  if (type === "string") {
    out.push(JSON.stringify(value));
    return;
  }
  if (type === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new CanonicalizeError(`${String(n)} has no JSON representation`, path);
    }
    // -0 and 0 are the same request. Without this they hash differently.
    out.push(JSON.stringify(Object.is(n, -0) ? 0 : n));
    return;
  }
  if (type === "undefined" || type === "function" || type === "symbol" || type === "bigint") {
    throw new CanonicalizeError(`${type} has no JSON representation`, path);
  }

  const object = value as object;
  if (seen.has(object)) {
    throw new CanonicalizeError("circular reference", path);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new CanonicalizeError("Invalid Date has no JSON representation", path);
    }
    out.push(JSON.stringify(value.toISOString()));
    return;
  }

  seen.add(object);
  try {
    // `toJSON` first, on any object, exactly as JSON.stringify honours it — a
    // value that knows how to represent itself is asked before it is judged.
    const toJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJson === "function") {
      writeValue((toJson as () => unknown).call(value), path, out, indent, depth, seen);
      return;
    }

    if (Array.isArray(value)) {
      writeArray(value, path, out, indent, depth, seen);
      return;
    }

    const proto: unknown = Object.getPrototypeOf(object) as unknown;
    if (proto !== PLAIN_OBJECT_PROTO && proto !== null) {
      throw new CanonicalizeError(
        `${describe(value)} has no JSON representation — give it a toJSON(), or keep it out of the keyed request`,
        path,
      );
    }

    writeObject(value as Record<string, unknown>, path, out, indent, depth, seen);
  } finally {
    seen.delete(object);
  }
}

function pad(indent: number, depth: number): string {
  return indent <= 0 ? "" : `\n${" ".repeat(indent * depth)}`;
}

function writeArray(
  value: readonly unknown[],
  path: string,
  out: string[],
  indent: number,
  depth: number,
  seen: Set<object>,
): void {
  if (value.length === 0) {
    out.push("[]");
    return;
  }
  out.push("[");
  for (let i = 0; i < value.length; i += 1) {
    if (i > 0) out.push(",");
    out.push(pad(indent, depth + 1));
    // A hole or an explicit `undefined` in an array is `null` in JSON; keep that,
    // because dropping it would shift every later element.
    const element = value[i];
    if (element === undefined) {
      out.push("null");
    } else {
      writeValue(element, `${path}[${String(i)}]`, out, indent, depth + 1, seen);
    }
  }
  out.push(pad(indent, depth), "]");
}

function writeObject(
  value: Record<string, unknown>,
  path: string,
  out: string[],
  indent: number,
  depth: number,
  seen: Set<object>,
): void {
  // Sorted, so insertion order cannot change the hash. `undefined` members are
  // dropped exactly as JSON.stringify drops them: `{a: undefined}` and `{}` are
  // the same request, and callers write the former all the time.
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  if (keys.length === 0) {
    out.push("{}");
    return;
  }
  out.push("{");
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i] as string;
    if (i > 0) out.push(",");
    out.push(pad(indent, depth + 1));
    out.push(JSON.stringify(key), indent > 0 ? ": " : ":");
    writeValue(value[key], `${path}.${key}`, out, indent, depth + 1, seen);
  }
  out.push(pad(indent, depth), "}");
}

/** Deterministic JSON text. `indent > 0` pretty-prints for a readable fixture file. */
export function canonicalStringify(value: unknown, indent = 0): string {
  const out: string[] = [];
  writeValue(value, "$", out, indent, 0, new Set<object>());
  return out.join("");
}

/** Full-width sha256 of the canonical bytes, hex. */
export function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}
