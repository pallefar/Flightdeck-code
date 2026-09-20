/** Reads the DATA fields back out of a `manifest.ts` source file.
 *
 * ⭐ WHY READ THE TEXT AND NOT THE OBJECT. `generateSubApp` already holds a
 * plain `manifestData` object, and validating that object would be easy and
 * would prove nothing about the file: the thing the host parses at boot is
 * the source, and a field emitted as a computed expression, or dropped by a
 * template edit, would still leave the object intact. This reader takes the
 * same path the reviewer does — it reads what is written.
 *
 * It works because the emitter holds up its end: every DATA field of a
 * generated manifest is a JSON-compatible literal on its own line, and the
 * only non-JSON members are the two function ones. So: strip the comments,
 * take the object body, drop the function members, quote the keys, drop
 * trailing commas, and the result is JSON.
 *
 * ⚠ It is a reader for THIS shape — manifests whose data fields are
 * literals. That covers every hand-written manifest in the host today
 * (`__tests__/manifest-rules.test.ts` runs all four through it), and a
 * manifest that computed a field would throw here rather than quietly
 * validate. Throwing is the right answer: a computed data field is exactly
 * what must not be shipped. */
export class ManifestReadError extends Error {}

const FUNCTION_MEMBERS = ["initSchema", "registerRoutes"];

export function readEmittedManifest(source: string): Record<string, unknown> {
  const body = extractObjectBody(stripComments(source));
  const kept = body
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return false;
      return !FUNCTION_MEMBERS.some((member) => trimmed.startsWith(`${member}:`));
    })
    .join("\n");

  const quoted = kept.replace(/(^|[{,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
  const json = `{${quoted}}`.replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    throw new ManifestReadError(
      `manifest data fields are not all JSON literals — a generated manifest must not compute one (${(err as Error).message})`,
    );
  }
}

/** The text between the braces of the single `... Manifest: SubAppManifest = {`
 * declaration. Brace-matched, so a nested object member survives. */
function extractObjectBody(source: string): string {
  const match = /(?:export\s+)?const\s+[A-Za-z0-9_]+\s*:\s*SubAppManifest\s*=\s*\{/.exec(source);
  if (match === null) {
    throw new ManifestReadError('no "const <name>: SubAppManifest = {" declaration found');
  }
  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      i = skipString(source, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new ManifestReadError("the manifest object literal is never closed");
}

function skipString(source: string, start: number): number {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === '"') return i;
  }
  return source.length;
}

/** Blanks `//` and block comments outside string literals. */
function stripComments(source: string): string {
  const out = source.split("");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      i = skipStringAny(source, i);
      continue;
    }
    if (ch === "`") {
      const end = source.indexOf("`", i + 1);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") out[j++] = " ";
      i = j - 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j++) if (source[j] !== "\n") out[j] = " ";
      i = stop - 1;
    }
  }
  return out.join("");
}

function skipStringAny(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return source.length;
}
