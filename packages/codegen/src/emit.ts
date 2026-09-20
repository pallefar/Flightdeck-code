/** Source-text primitives. Deliberately tiny and deliberately paranoid.
 *
 * ⛔ THE RULE THIS FILE EXISTS TO ENFORCE: nothing that came from a spec
 * reaches emitted source except through `str()` (JSON-escaped into a string
 * literal) or through an `assertSafe*` gate that REFUSES rather than
 * escapes. `spec-contract.ts` already validates every one of these values;
 * these checks are the second lock, because the cost of being wrong is a
 * generated file that runs inside a Fastify host with a workspace database
 * handle. Two cheap locks beat one clever one. */

/** A JSON-escaped double-quoted string literal. Correct for TS source
 * because every JSON escape is a valid TS escape. */
export function str(value: string): string {
  return JSON.stringify(value);
}

export function joinLines(lines: readonly (string | null)[]): string {
  return lines.filter((line): line is string => line !== null).join("\n");
}

export function indentLines(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : pad + line))
    .join("\n");
}

/** A JSDoc banner block. Paragraphs are wrapped at 76 columns so emitted
 * headers read like the hand-written ones they sit beside, and a blank
 * string becomes a bare ` *` separator line. */
export function banner(paragraphs: readonly string[]): string {
  const body: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      body.push(" *");
      continue;
    }
    for (const line of wrap(paragraph, 76)) body.push(` * ${line}`);
  }
  const first = body.shift() ?? " *";
  return joinLines(["/**" + first.slice(2), ...body, " */"]);
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line.length > 0) out.push(line);
  return out.length > 0 ? out : [""];
}

export class UnsafeIdentifierError extends Error {}

const SQL_IDENT_RE = /^[a-z][a-z0-9_]*$/;
const TS_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** SQL identifiers are concatenated into DDL and into query text, where no
 * parameter placeholder exists to hide behind. Refuse anything that is not
 * a plain lower-snake word. */
export function assertSafeSqlIdentifier(value: string, what: string): string {
  if (!SQL_IDENT_RE.test(value)) {
    throw new UnsafeIdentifierError(`${what} ${str(value)} is not a safe SQL identifier (expected /^[a-z][a-z0-9_]*$/)`);
  }
  return value;
}

export function assertSafeTsIdentifier(value: string, what: string): string {
  if (!TS_IDENT_RE.test(value)) {
    throw new UnsafeIdentifierError(`${what} ${str(value)} is not a safe TypeScript identifier`);
  }
  return value;
}

/** A single-quoted SQL string literal, for CHECK(...) value lists. Refuses
 * anything needing an escape rather than doubling the quote — a CHECK list
 * has no business containing one. */
export function sqlStringLiteral(value: string, what: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new UnsafeIdentifierError(`${what} ${str(value)} is not a safe SQL string literal`);
  }
  return `'${value}'`;
}

/** Renders a TS object literal with UNQUOTED keys, one field per line.
 * Values arrive as already-rendered source text; `comment` (if given) is
 * emitted as `//` lines above the field, matching how the host's own
 * hand-written manifests annotate theirs. */
export interface ObjectField {
  key: string;
  value: string;
  comment?: readonly string[];
}

export function tsObject(fields: readonly ObjectField[], indent = 0): string {
  const out: string[] = ["{"];
  for (const field of fields) {
    assertSafeTsIdentifier(field.key, "object key");
    for (const comment of field.comment ?? []) {
      for (const line of wrap(comment, 72)) out.push(`  // ${line}`);
    }
    out.push(`  ${field.key}: ${field.value},`);
  }
  out.push("}");
  return indent === 0 ? out.join("\n") : indentLines(out.join("\n"), indent).trimStart();
}

/** `["a", "b"]` on one line — every array a manifest carries is short. */
export function tsStringArray(values: readonly string[]): string {
  return `[${values.map(str).join(", ")}]`;
}
