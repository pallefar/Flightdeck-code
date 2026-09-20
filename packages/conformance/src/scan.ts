/** A single-pass lexer for the three views of a source file every check
 * below needs.
 *
 * ── WHY NOT JUST GREP THE SOURCE ─────────────────────────────────────
 * Every rule in this package is a statement about CODE, and the naive
 * `contents.includes("process.env")` version of each one is wrong in both
 * directions at once. It fires on a banner comment that explains why the
 * module does not read `process.env` (the generated files all carry one),
 * and it misses nothing — but its sibling, `includes("req.body")`, happily
 * matches the string `"req.body"` inside an error message. A gate that
 * cries wolf gets switched off, and a gate that can be evaded by quoting
 * is decoration. So the pass produces:
 *
 *   `code`      — comments blanked, string bodies intact. For reading
 *                 import specifiers, which live inside strings.
 *   `skeleton`  — comments, string bodies AND regex bodies blanked, same
 *                 length as the original. For every structural question:
 *                 where does this handler's body end, is this token inside
 *                 a function, does this file mention `req.body` as CODE.
 *   `strings`   — the literals themselves, with offsets. This is where SQL
 *                 lives, and it is the only place the SQL checks look.
 *
 * All three are byte-aligned with the original text, so any offset found
 * in any of them maps back to a real line number in the file a human will
 * open. That alignment is the reason blanking is done with spaces rather
 * than by deleting.
 *
 * ⚠ BOUNDS, STATED. This is a lexer, not a parser: it does not build an
 * AST and it does not know types. Two constructs it approximates are a
 * template literal containing a nested template literal inside `${...}`
 * (the scan ends at the inner backtick) and a regex literal that opens
 * where a division could also parse. Both are noted at the point of the
 * heuristic. Where a check cannot answer a question, it raises a finding
 * saying so (FD-G003) rather than passing the file. */

export interface Position {
  readonly line: number;
  readonly column: number;
}

export type ImportForm = "static" | "side-effect" | "re-export" | "dynamic" | "require";

export interface ImportRef {
  readonly specifier: string;
  /** Offset of the specifier's opening quote in the original text. */
  readonly offset: number;
  /** `import type ...` / `export type ... from ...`. Erased at compile
   * time under the host's `verbatimModuleSyntax`, so it creates no runtime
   * edge — which changes the severity of reaching a forbidden module, not
   * whether it is worth reporting. */
  readonly typeOnly: boolean;
  readonly form: ImportForm;
}

export interface StringLiteral {
  /** Escapes resolved, for quoted strings. */
  readonly value: string;
  /** Exactly as written, between the quotes. */
  readonly raw: string;
  /** Offset of the opening quote. */
  readonly offset: number;
  /** Offset of the first character inside the quotes. */
  readonly contentOffset: number;
  /** `raw === value`, so an index into `value` maps 1:1 onto the file. */
  readonly exact: boolean;
  readonly template: boolean;
}

export interface ScannedFile {
  readonly path: string;
  readonly text: string;
  readonly code: string;
  readonly skeleton: string;
  readonly strings: readonly StringLiteral[];
  readonly imports: readonly ImportRef[];
  positionAt(offset: number): Position;
  /** The raw source line containing `offset`, trimmed — finding evidence. */
  lineTextAt(offset: number): string;
  /** How many function bodies enclose this offset. `0` is module scope:
   * code that runs once, at import time, which is what "never cache a
   * boolean" is about. */
  functionDepthAt(offset: number): number;
}

export function scanFile(path: string, text: string): ScannedFile {
  const { code, skeleton, strings } = lexSource(text);
  const lineStarts = computeLineStarts(text);
  const fnDepths = computeFunctionDepths(skeleton);
  const imports = collectImports(code);

  const positionAt = (offset: number): Position => {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: clamped - (lineStarts[lo] ?? 0) + 1 };
  };

  return {
    path,
    text,
    code,
    skeleton,
    strings,
    imports,
    positionAt,
    lineTextAt(offset: number): string {
      const { line } = positionAt(offset);
      const start = lineStarts[line - 1] ?? 0;
      const end = lineStarts[line] ?? text.length;
      return text.slice(start, end).trim();
    },
    functionDepthAt(offset: number): number {
      const clamped = Math.max(0, Math.min(offset, fnDepths.length - 1));
      return fnDepths[clamped] ?? 0;
    },
  };
}

// ── The pass ─────────────────────────────────────────────────────────

interface LexResult {
  code: string;
  skeleton: string;
  strings: StringLiteral[];
}

/** Characters after which a `/` begins a regex literal rather than a
 * division. Checking only the previous significant character misses
 * `return /re/`, which no generated or hand-written sub-app file contains;
 * the cost of the miss is that a regex body is treated as code, which can
 * only produce a false POSITIVE on a rule, never a false pass. */
const REGEX_MAY_FOLLOW = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^", "<", ">"]);

function lexSource(text: string): LexResult {
  const code = text.split("");
  const skeleton = text.split("");
  const strings: StringLiteral[] = [];

  const blank = (target: string[], from: number, to: number): void => {
    for (let i = from; i < to && i < target.length; i++) {
      if (target[i] !== "\n") target[i] = " ";
    }
  };

  let prev = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";

    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      const stop = nl === -1 ? text.length : nl;
      blank(code, i, stop);
      blank(skeleton, i, stop);
      i = stop - 1;
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(code, i, stop);
      blank(skeleton, i, stop);
      i = stop - 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const end = endOfQuoted(text, i);
      strings.push(makeString(text, i, end, false));
      blank(skeleton, i + 1, end);
      prev = ch;
      i = end;
      continue;
    }

    if (ch === "`") {
      const end = endOfTemplate(text, i);
      strings.push(makeString(text, i, end, true));
      blank(skeleton, i + 1, end);
      prev = ch;
      i = end;
      continue;
    }

    if (ch === "/" && REGEX_MAY_FOLLOW.has(prev)) {
      const end = endOfRegex(text, i);
      if (end !== -1) {
        blank(skeleton, i + 1, end);
        prev = "/";
        i = end;
        continue;
      }
    }

    if (!/\s/.test(ch)) prev = ch;
  }

  return { code: code.join(""), skeleton: skeleton.join(""), strings };
}

/** Index of the closing quote, or of the newline/EOF that ends an
 * unterminated literal. */
function endOfQuoted(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "\n") return i - 1;
    if (ch === quote) return i;
  }
  return text.length - 1;
}

/** ⚠ A nested template literal inside `${...}` ends this scan early. The
 * consequence is a shorter literal and a run of code treated as text —
 * again a direction that can only over-report. */
function endOfTemplate(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "`") return i;
  }
  return text.length - 1;
}

/** Index of the closing `/`, or -1 if this was a division after all. */
function endOfRegex(text: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "\n") return -1;
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i;
  }
  return -1;
}

function makeString(text: string, open: number, close: number, template: boolean): StringLiteral {
  const raw = text.slice(open + 1, close);
  const value = template ? raw : unescape(raw);
  return { value, raw, offset: open, contentOffset: open + 1, exact: value === raw, template };
}

function unescape(raw: string): string {
  if (!raw.includes("\\")) return raw;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] ?? "";
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1] ?? "";
    i++;
    switch (next) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "0": out += "\0"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "u": {
        const hex = raw.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else out += next;
        break;
      }
      case "x": {
        const hex = raw.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 2;
        } else out += next;
        break;
      }
      default: out += next;
    }
  }
  return out;
}

/** Maps an index inside a literal's `value` back to a file offset. Exact
 * for template literals and for any string without an escape — which is
 * every literal the SQL checks care about — and falls back to the start of
 * the literal when escapes have shifted the indexes. */
export function offsetInLiteral(literal: StringLiteral, indexInValue: number): number {
  return literal.exact ? literal.contentOffset + indexInValue : literal.offset;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

// ── Function-scope depth ─────────────────────────────────────────────

const NON_FUNCTION_HEADS = new Set(["if", "for", "while", "switch", "catch", "with"]);

/** Does the `{` at `brace` open a FUNCTION body (as opposed to a block, a
 * class body or an object literal)?
 *
 * Three shapes count: `=> {`, `) {` and `): T {`. The last two are only a
 * function when the `(` they close is a parameter list, so the keyword in
 * front of it is checked against the control-flow heads — `if (x) {` is a
 * block, `handler(x) {` is a method. This is a heuristic and it is aimed:
 * the only question asked of it is "is this offset inside SOME function",
 * and both of its failure modes report module scope for code that is
 * inside one, which raises a finding rather than hiding one. */
function opensFunctionBody(skeleton: string, brace: number): boolean {
  let j = brace - 1;
  while (j >= 0 && /\s/.test(skeleton[j] ?? "")) j--;
  if (j < 0) return false;
  if (skeleton[j] === ">" && skeleton[j - 1] === "=") return true;

  const from = Math.max(0, brace - 400);
  const window = skeleton.slice(from, brace);
  const match = /\)\s*(?::[^;{}()=]*)?\s*$/.exec(window);
  if (match === null) return false;

  const closeParen = from + match.index;
  const openParen = matchParenBackward(skeleton, closeParen);
  if (openParen === -1) return false;

  let k = openParen - 1;
  while (k >= 0 && /\s/.test(skeleton[k] ?? "")) k--;
  const end = k;
  while (k >= 0 && /[\w$]/.test(skeleton[k] ?? "")) k--;
  const word = skeleton.slice(k + 1, end + 1);
  return !NON_FUNCTION_HEADS.has(word);
}

function matchParenBackward(skeleton: string, closeIndex: number): number {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i--) {
    const ch = skeleton[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function computeFunctionDepths(skeleton: string): Int32Array {
  const depths = new Int32Array(skeleton.length + 1);
  const stack: boolean[] = [];
  let depth = 0;
  for (let i = 0; i < skeleton.length; i++) {
    depths[i] = depth;
    const ch = skeleton[i];
    if (ch === "{") {
      const isFunction = opensFunctionBody(skeleton, i);
      stack.push(isFunction);
      if (isFunction) depth++;
    } else if (ch === "}") {
      if (stack.pop() === true) depth = Math.max(0, depth - 1);
    }
  }
  depths[skeleton.length] = depth;
  return depths;
}

/** Index of the `}` matching the `{` at `openIndex`, or -1. Runs on the
 * skeleton, where no brace can hide inside a string, a comment or a regex
 * character class. */
export function matchBrace(skeleton: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < skeleton.length; i++) {
    const ch = skeleton[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the `)` matching the `(` at `openIndex`, or -1. */
export function matchParen(skeleton: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < skeleton.length; i++) {
    const ch = skeleton[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ── Imports ──────────────────────────────────────────────────────────

/** An import clause contains no quote and no semicolon, which is what
 * keeps these patterns from crossing a statement boundary and pairing an
 * `import` with some later file's `from`. */
const STATIC_IMPORT = /\b(import|export)\b(?![\w$])([^;'"`]*?)\bfrom\s*(['"])([^'"\n]*)\3/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*(['"])([^'"\n]*)\1/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])([^'"\n]*)\1/g;
const REQUIRE_CALL = /\brequire\s*\(\s*(['"])([^'"\n]*)\1/g;

function collectImports(code: string): ImportRef[] {
  const byOffset = new Map<number, ImportRef>();

  for (const match of code.matchAll(STATIC_IMPORT)) {
    const clause = match[2] ?? "";
    const specifier = match[4] ?? "";
    const offset = (match.index ?? 0) + match[0].length - specifier.length - 2;
    byOffset.set(offset, {
      specifier,
      offset,
      typeOnly: /^\s*type\b/.test(clause),
      form: match[1] === "export" ? "re-export" : "static",
    });
  }

  const simple: [RegExp, ImportForm][] = [
    [SIDE_EFFECT_IMPORT, "side-effect"],
    [DYNAMIC_IMPORT, "dynamic"],
    [REQUIRE_CALL, "require"],
  ];
  for (const [pattern, form] of simple) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[2] ?? "";
      const offset = (match.index ?? 0) + match[0].length - specifier.length - 2;
      if (byOffset.has(offset)) continue;
      byOffset.set(offset, { specifier, offset, typeOnly: false, form });
    }
  }

  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
}

/** Every occurrence of `token` in `skeleton` — i.e. in CODE, never inside
 * a string or a comment. */
export function findTokens(skeleton: string, token: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = skeleton.indexOf(token, from);
    if (at === -1) return out;
    out.push(at);
    from = at + token.length;
  }
}
