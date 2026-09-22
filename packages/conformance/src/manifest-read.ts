/** Reads the manifest's DATA fields back out of `manifest.ts` SOURCE.
 *
 * ⭐ WHY THE TEXT AND NOT AN OBJECT. Studio holds a perfectly good
 * manifest object in memory, and validating that object would prove
 * nothing about the file it is about to write: the thing the host parses
 * at boot is the source. A field emitted as a computed expression, a field
 * lost to a template edit, a field a human "fixed" after generation —
 * every one of those leaves the in-memory object intact and the file
 * wrong. This reader takes the same path a reviewer does. It reads what is
 * written.
 *
 * ⛔ A COMPUTED FIELD IS A REFUSAL, NOT A PUZZLE. The reader understands
 * JSON-compatible literals and nothing else. `navSection: SECTIONS.ops` is
 * reported as unreadable rather than evaluated, because a manifest field
 * the gate cannot read statically is a manifest field nobody can review
 * statically — and `loadValidatedManifests` is fail-loud, so being wrong
 * about one takes the host down at boot. Every hand-written manifest in
 * the host is literal; so is every generated one.
 *
 * The two function members (`initSchema`, `registerRoutes`) are read as
 * presence plus their source text, never evaluated. A member with no key
 * this reader can name — a spread, a computed key — is not skipped silently:
 * it is listed in `unreadable`, because it could carry any member at all. */
import { matchBrace, type ScannedFile } from "./scan";

export interface ManifestMember {
  readonly key: string;
  readonly keyOffset: number;
  readonly valueOffset: number;
  /** The value exactly as written, trimmed. */
  readonly valueText: string;
  /** `null` when the value is not a JSON-compatible literal. */
  readonly literal: { readonly value: unknown } | null;
}

/** A member at member position with no key this reader can name. */
export interface UnreadableMember {
  readonly kind: "spread" | "computed-key";
  readonly offset: number;
  /** The member exactly as written, trimmed. */
  readonly text: string;
}

export interface ManifestSource {
  readonly constName: string;
  readonly declOffset: number;
  readonly members: readonly ManifestMember[];
  /** Spreads and computed keys — members whose name, and so whose meaning,
   * cannot be read without evaluating the file. */
  readonly unreadable: readonly UnreadableMember[];
  /** The literal members only — what the schema is run against. */
  readonly data: Record<string, unknown>;
  memberAt(key: string): ManifestMember | null;
}

export type ManifestReadResult =
  | { readonly ok: true; readonly manifest: ManifestSource }
  | { readonly ok: false; readonly offset: number; readonly reason: string };

const DECLARATION = /(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*(?::\s*([A-Za-z0-9_$.]+)\s*)?=\s*\{/g;

export function readManifestSource(scan: ScannedFile): ManifestReadResult {
  const declarations = [...scan.skeleton.matchAll(DECLARATION)];
  const chosen =
    declarations.find((m) => m[2] === "SubAppManifest") ??
    declarations.find((m) => (m[1] ?? "").endsWith("Manifest"));

  if (chosen === undefined) {
    return {
      ok: false,
      offset: 0,
      reason:
        "no `const <name>: SubAppManifest = { ... }` declaration — a sub-app manifest is a single exported object literal, and registry.ts has nothing to import without one",
    };
  }

  const declOffset = chosen.index ?? 0;
  const open = declOffset + (chosen[0] ?? "").length - 1;
  const close = matchBrace(scan.skeleton, open);
  if (close === -1) {
    return { ok: false, offset: declOffset, reason: "the manifest object literal is never closed" };
  }

  const { members, unreadable } = readMembers(scan, open + 1, close);
  const data: Record<string, unknown> = {};
  for (const member of members) {
    if (member.literal !== null) data[member.key] = member.literal.value;
  }

  return {
    ok: true,
    manifest: {
      constName: chosen[1] ?? "(anonymous)",
      declOffset,
      members,
      unreadable,
      data,
      memberAt: (key: string) => members.find((m) => m.key === key) ?? null,
    },
  };
}

function readMembers(
  scan: ScannedFile,
  from: number,
  to: number,
): { members: ManifestMember[]; unreadable: UnreadableMember[] } {
  const { code, skeleton } = scan;
  const members: ManifestMember[] = [];
  const unreadable: UnreadableMember[] = [];
  let i = from;

  while (i < to) {
    i = skipTrivia(skeleton, i, to);
    if (i >= to) break;
    if (skeleton[i] === "," || skeleton[i] === ";") {
      i++;
      continue;
    }

    const keyStart = i;
    const key = readKey(code, skeleton, i, to);
    if (key === null) {
      // Something that is not `key:` at member position — a spread, a
      // computed key. It is not read as data (the schema check then reports
      // a field it should have carried as missing), and it is LISTED, because
      // what it carries cannot be known without evaluating it.
      const end = endOfMember(skeleton, i, to);
      unreadable.push({
        kind: skeleton.startsWith("...", i) ? "spread" : "computed-key",
        offset: i,
        text: code.slice(i, end).trim(),
      });
      i = end;
      continue;
    }
    i = key.end;
    i = skipTrivia(skeleton, i, to);
    if (skeleton[i] !== ":") {
      i = endOfMember(skeleton, i, to);
      continue;
    }
    i = skipTrivia(skeleton, i + 1, to);

    const valueStart = i;
    const valueEnd = endOfMember(skeleton, i, to);
    const valueText = code.slice(valueStart, valueEnd).trim();
    const parsed = parseLiteralText(valueText);
    members.push({
      key: key.name,
      keyOffset: keyStart,
      valueOffset: valueStart,
      valueText,
      literal: parsed.ok ? { value: parsed.value } : null,
    });
    i = valueEnd;
  }

  return { members, unreadable };
}

function skipTrivia(skeleton: string, i: number, to: number): number {
  let at = i;
  while (at < to && /\s/.test(skeleton[at] ?? "")) at++;
  return at;
}

function readKey(code: string, skeleton: string, i: number, to: number): { name: string; end: number } | null {
  const ch = skeleton[i];
  if (ch === '"' || ch === "'") {
    // The skeleton blanked the body, so read the name from `code`.
    let end = i + 1;
    while (end < to && skeleton[end] !== ch) end++;
    return { name: code.slice(i + 1, end), end: end + 1 };
  }
  let end = i;
  while (end < to && /[A-Za-z0-9_$]/.test(skeleton[end] ?? "")) end++;
  return end === i ? null : { name: code.slice(i, end), end };
}

/** The index just past this member's value: the next comma at nesting
 * depth zero, or the end of the object. */
function endOfMember(skeleton: string, i: number, to: number): number {
  let depth = 0;
  for (let at = i; at < to; at++) {
    const ch = skeleton[at];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) return at;
  }
  return to;
}

// ── The literal parser ───────────────────────────────────────────────

type ParseResult = { ok: true; value: unknown } | { ok: false };

/** JSON-compatible literals only: strings, numbers, booleans, null,
 * arrays and objects of the same. Anything else — an identifier, a call, a
 * template literal, a spread — is refused rather than guessed at. */
export function parseLiteralText(text: string): ParseResult {
  const parser = new LiteralParser(text);
  const value = parser.parseValue();
  if (value === FAILED) return { ok: false };
  parser.skipSpace();
  return parser.atEnd() ? { ok: true, value } : { ok: false };
}

const FAILED = Symbol("failed");

class LiteralParser {
  private i = 0;
  constructor(private readonly text: string) {}

  atEnd(): boolean {
    return this.i >= this.text.length;
  }

  skipSpace(): void {
    while (this.i < this.text.length && /\s/.test(this.text[this.i] ?? "")) this.i++;
  }

  parseValue(): unknown | typeof FAILED {
    this.skipSpace();
    const ch = this.text[this.i];
    if (ch === undefined) return FAILED;
    if (ch === '"' || ch === "'") return this.parseString(ch);
    if (ch === "[") return this.parseArray();
    if (ch === "{") return this.parseObject();
    if (this.consumeWord("true")) return true;
    if (this.consumeWord("false")) return false;
    if (this.consumeWord("null")) return null;
    return this.parseNumber();
  }

  private consumeWord(word: string): boolean {
    if (!this.text.startsWith(word, this.i)) return false;
    const after = this.text[this.i + word.length];
    if (after !== undefined && /[A-Za-z0-9_$]/.test(after)) return false;
    this.i += word.length;
    return true;
  }

  private parseNumber(): number | typeof FAILED {
    const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.i));
    if (match === null) return FAILED;
    this.i += match[0].length;
    return Number(match[0]);
  }

  private parseString(quote: string): string | typeof FAILED {
    let out = "";
    let at = this.i + 1;
    for (; at < this.text.length; at++) {
      const ch = this.text[at] ?? "";
      if (ch === "\\") {
        const next = this.text[at + 1] ?? "";
        out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
        at++;
        continue;
      }
      if (ch === quote) {
        this.i = at + 1;
        return out;
      }
      out += ch;
    }
    return FAILED;
  }

  private parseArray(): unknown[] | typeof FAILED {
    this.i++;
    const out: unknown[] = [];
    for (;;) {
      this.skipSpace();
      if (this.text[this.i] === "]") {
        this.i++;
        return out;
      }
      const value = this.parseValue();
      if (value === FAILED) return FAILED;
      out.push(value);
      this.skipSpace();
      if (this.text[this.i] === ",") {
        this.i++;
        continue;
      }
      if (this.text[this.i] === "]") {
        this.i++;
        return out;
      }
      return FAILED;
    }
  }

  private parseObject(): Record<string, unknown> | typeof FAILED {
    this.i++;
    const out: Record<string, unknown> = {};
    for (;;) {
      this.skipSpace();
      if (this.text[this.i] === "}") {
        this.i++;
        return out;
      }
      const quote = this.text[this.i];
      let key: string;
      if (quote === '"' || quote === "'") {
        const parsed = this.parseString(quote);
        if (parsed === FAILED) return FAILED;
        key = parsed;
      } else {
        const match = /^[A-Za-z0-9_$]+/.exec(this.text.slice(this.i));
        if (match === null) return FAILED;
        key = match[0];
        this.i += key.length;
      }
      this.skipSpace();
      if (this.text[this.i] !== ":") return FAILED;
      this.i++;
      const value = this.parseValue();
      if (value === FAILED) return FAILED;
      out[key] = value;
      this.skipSpace();
      if (this.text[this.i] === ",") {
        this.i++;
        continue;
      }
      if (this.text[this.i] === "}") {
        this.i++;
        return out;
      }
      return FAILED;
    }
  }
}
