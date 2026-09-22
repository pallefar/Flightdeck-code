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
 * generated manifest is a JSON-compatible literal. So: strip the comments,
 * take the object body, split it into its top-level members, set aside the
 * members that are not data, quote the keys, drop trailing commas, and the
 * result is JSON.
 *
 * ── WHAT "NOT DATA" MEANS, AND WHO DECIDES IT ───────────────────────
 * The host's `SubAppManifest` interface (`server/subapps/types.ts`) is
 * `SubAppManifestData` — the fields `subAppManifestSchema` validates at
 * boot — plus members Zod never sees: `initSchema`, `registerRoutes`, and
 * since OS-04 (host 42b0f308) an optional `contributions` bundle, which
 * docusign declares as `contributions: docusignContributions`. The host's
 * `loadValidatedManifests` runs the schema over the object; Zod's default
 * strips unknown keys, so none of the three is checked there, and a
 * function-bearing member CANNOT be — "a schema-level `z.any()` would buy
 * nothing while implying it had checked something" (the host's own words).
 *
 * So `NON_DATA_MEMBERS` is exactly that list, and a test reads it off the
 * host's interface in both directions (`manifest-rules.test.ts`). Nothing
 * else is set aside: a computed `widgets`, an unknown `hooks: x`, a spread
 * or a shorthand `id,` still throws, because each of those could be — or
 * could carry — a field the host's schema DOES validate.
 *
 * Members are split by bracket depth, not by line, so a non-data member
 * whose value spans lines (an inline arrow body, an inline contributions
 * object) is set aside whole rather than leaving its tail behind.
 *
 * ⚠ It is a reader for THIS shape — manifests whose data fields are
 * literals. That covers the hand-written manifests
 * `__tests__/manifest-rules.test.ts` runs through it, and a manifest that
 * computed a data field throws here rather than quietly validating.
 * Throwing is the right answer: a computed data field is exactly what must
 * not be shipped. */
export class ManifestReadError extends Error {}

/** The members the host's `SubAppManifest` declares beyond
 * `SubAppManifestData`. Transcribed from the host; drift-tested against it. */
export const NON_DATA_MEMBERS: readonly string[] = ["initSchema", "registerRoutes", "contributions"];

const KEY_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/;

export function readEmittedManifest(source: string): Record<string, unknown> {
  const body = extractObjectBody(stripComments(source));
  const kept: string[] = [];
  for (const member of topLevelMembers(body)) {
    const key = KEY_RE.exec(member)?.[1];
    // A `name(args) { ... }` method is a function member by construction.
    const method = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(member)?.[1];
    if (key === undefined && method !== undefined && NON_DATA_MEMBERS.includes(method)) continue;
    if (key !== undefined && NON_DATA_MEMBERS.includes(key)) continue;
    // Anything else must be `key: literal`. A spread, a shorthand, a
    // computed key or a method named after a data field falls through to
    // the parse below and fails it — a refusal, never a skip.
    kept.push(member);
  }

  const json = `{${quoteKeys(kept.join(",\n"))}}`.replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    throw new ManifestReadError(
      `manifest data fields are not all JSON literals — a generated manifest must not compute one (${(err as Error).message})`,
    );
  }
}

/** The object body's members, split at depth-0 commas and trimmed. Strings
 * and template literals are skipped whole, so a comma or a brace inside a
 * label does not split anything. */
function topLevelMembers(body: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipStringAny(body, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      members.push(body.slice(start, i));
      start = i + 1;
    }
  }
  members.push(body.slice(start));
  return members.map((m) => m.trim()).filter((m) => m.length > 0);
}

/** Quotes bare object keys — `id:` becomes `"id":` — outside string
 * literals only, so a label reading "Settings: all" is left alone. */
function quoteKeys(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipStringAny(text, i);
      out += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const key = /^[A-Za-z_$][A-Za-z0-9_$]*(?=\s*:)/.exec(text.slice(i));
    const before = out.trimEnd().slice(-1);
    if (key !== null && (before === "" || before === "{" || before === ",")) {
      out += `"${key[0]}"`;
      i += key[0].length;
      continue;
    }
    if (key !== null) {
      // An identifier that is not in key position (a computed value such as
      // `SECTIONS.ops`). Copied whole so it cannot be half-quoted into
      // something that parses.
      out += key[0];
      i += key[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
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
