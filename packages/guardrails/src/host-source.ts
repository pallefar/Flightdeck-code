/**
 * Reading the HOST'S security lists off disk, as source text.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY SOURCE TEXT RATHER THAN AN IMPORT
 * ─────────────────────────────────────────────────────────────────────────
 * `flightdeck/server/widgets/types.ts` imports zod and a dozen sibling
 * modules; `flightdeck/server/services/ai/envelope.ts` imports
 * `./providers.js`. Neither resolves from this checkout's module graph, and
 * the host may not be on disk at all in CI. The host solved the identical
 * problem for its own Deno edge function and wrote down the reasoning
 * (`flightdeck/tests/aiProxyEdgeFunction.test.ts`): the edge function "is
 * outside tsconfig.json, Deno is not typed in this project, and there is no
 * Deno runtime to execute it against… so the properties that matter are
 * asserted against the text."
 *
 * Same problem, same answer, same deliberately dumb parsing: no TypeScript
 * compiler, no dependency, just a balanced-bracket scan. The one place this
 * parser is NOT dumb is `readRegexLiteral`, which tracks character classes —
 * because the host's `digits` pattern is `/\b\d[\d /.-]{5,}\d\b/g` and a
 * scanner that stops at the first `/` would silently read it as `\b\d[\d `
 * and then happily report that Studio's copy diverges. A parser that is wrong
 * in a way that produces a plausible wrong answer is worse than one that
 * throws.
 */

import fs from "node:fs";
import path from "node:path";

/** Overridable so the test can run against a checkout somewhere else, and so
 * a fixture can be substituted to test the comparator itself. */
export const HOST_ROOT = process.env["FLIGHTDECK_HOST_ROOT"] ?? "/home/user/project-contract";

export const HOST_ENVELOPE = path.join(HOST_ROOT, "flightdeck", "server", "services", "ai", "envelope.ts");
export const HOST_WIDGET_TYPES = path.join(HOST_ROOT, "flightdeck", "server", "widgets", "types.ts");

/**
 * ⚠ A CONSOLE.WARN IS NOT A FAILURE, AND CI READS EXIT CODES.
 *
 * This is the runner-up defect of the same round as the rest of this package's
 * hardening, and it is the SEC-V5-02 shape wearing its third costume: the
 * control that reports green because it never ran.
 *
 * `HOST_ROOT` defaults to a hardcoded absolute path that nothing in this repo
 * sets and no CI workflow provides. With the host checkout absent, the
 * divergence suite skipped, printed a warning, and reported
 *
 *     Test Files 5 passed, Tests 90 passed | 8 skipped     exit 0
 *
 * Eight skipped cases are the ONLY thing standing between two copies of a
 * security list and a silent fork, and they were skipping behind a zero exit
 * code — which is to say the thing that made "the 25 piiGitBoundary tests
 * passed the whole time" true, re-shipped in this package. A warning is read
 * by a human who is watching; an exit code is read by the machine that merges.
 *
 * So an absent host checkout is a FAILING test, not a skipped one, unless a
 * human explicitly and specifically says otherwise:
 *
 *     FLIGHTDECK_HOST_ROOT=/path/to/project-contract   — verify (the normal way)
 *     FLIGHTDECK_HOST_ABSENT_ACKNOWLEDGED=unverified-lists-accepted
 *                                                      — proceed UNVERIFIED
 *
 * The acknowledgement is an exact non-obvious string on purpose. `=1` is
 * something a person sets by reflex to make red go away; this one has to be
 * copied out of a file that says what it means, and it appears in the test
 * name so every run that uses it says so out loud.
 */
export const HOST_ABSENCE_ACK_ENV = "FLIGHTDECK_HOST_ABSENT_ACKNOWLEDGED";
export const HOST_ABSENCE_ACK_VALUE = "unverified-lists-accepted";

export interface HostAvailability {
  readonly available: boolean;
  /** A NAMED reason, never a bare false. A divergence test that skips without
   * saying why is indistinguishable from one that passed. */
  readonly reason: string;
  /** True only when a human set `FLIGHTDECK_HOST_ABSENT_ACKNOWLEDGED` to the
   * exact value above. Absent host + no acknowledgement = the suite FAILS. */
  readonly acknowledged: boolean;
}

export function hostAvailability(): HostAvailability {
  const acknowledged = process.env[HOST_ABSENCE_ACK_ENV] === HOST_ABSENCE_ACK_VALUE;
  const missing: string[] = [];
  if (!fs.existsSync(HOST_ENVELOPE)) missing.push(HOST_ENVELOPE);
  if (!fs.existsSync(HOST_WIDGET_TYPES)) missing.push(HOST_WIDGET_TYPES);
  if (missing.length === 0) {
    return { available: true, reason: `host checkout present at ${HOST_ROOT}`, acknowledged };
  }
  return {
    available: false,
    acknowledged,
    reason:
      `HOST CHECKOUT NOT READABLE — cannot verify Studio's copies of the host security lists. ` +
      `Missing: ${missing.join(", ")}. Set FLIGHTDECK_HOST_ROOT to the pallefar/project-contract checkout, ` +
      `or, to run KNOWINGLY UNVERIFIED, set ${HOST_ABSENCE_ACK_ENV}=${HOST_ABSENCE_ACK_VALUE}.`,
  };
}

export function readHostSource(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/** Drop comment-only lines so a `/` in prose cannot be mistaken for the start
 * of a regex literal. Only lines whose trimmed form begins a comment are
 * removed — a line of real code is never touched. */
export function stripCommentLines(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split(/\r?\n/)) {
    const t = line.trim();
    if (inBlock) {
      if (t.endsWith("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.endsWith("*/")) inBlock = true;
      continue;
    }
    if (t.startsWith("//")) continue;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * The balanced `[...]` that is the VALUE of `const <name>`.
 *
 * ⚠ Anchored on the `=`, not on the const name, and that is not a detail. The
 * host writes `export const PII_DENIED_SEGMENTS: readonly string[] = [...]`,
 * so the first `[` after the name belongs to the TYPE ANNOTATION. A scanner
 * that took it would read a balanced, empty `[]` and report that the host's
 * denylist has zero entries — which compares equal to nothing, diverges from
 * everything, and in a less strict version of this function would have
 * reported a clean pass against an empty list. That is the whole failure mode
 * this file's header warns about, and it was a real failure here, not a
 * hypothetical one.
 */
export function balancedArray(src: string, name: string): string {
  const start = src.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`const ${name} not found in host source`);
  const eq = src.indexOf("=", start);
  if (eq < 0) throw new Error(`const ${name} has no initialiser`);
  const open = src.indexOf("[", eq);
  if (open < 0) throw new Error(`no array literal after const ${name}`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "[") depth += 1;
    else if (src[i] === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced array literal for ${name}`);
}

export function readStringArray(src: string, name: string): string[] {
  const inner = balancedArray(stripCommentLines(src), name);
  return [...inner.matchAll(/["']([^"']*)["']/g)].map((m) => m[1] ?? "");
}

export function readNumberConst(src: string, name: string): number {
  const m = new RegExp(`const\\s+${name}\\s*(?::[^=]+)?=\\s*([0-9_]+(?:\\s*\\*\\s*[0-9_]+)*)`).exec(
    stripCommentLines(src),
  );
  if (!m?.[1]) throw new Error(`const ${name} not found (or not a numeric literal) in host source`);
  return m[1]
    .split("*")
    .map((part) => Number(part.replace(/_/g, "").trim()))
    .reduce((a, b) => a * b, 1);
}

/**
 * Scan one regex literal starting at `src[from] === "/"`. Tracks escapes and
 * character classes, because `[\d /.-]` contains a `/` that does NOT end the
 * literal.
 */
export function readRegexLiteral(src: string, from: number): { source: string; flags: string; end: number } {
  if (src[from] !== "/") throw new Error(`expected a regex literal at offset ${from}`);
  let i = from + 1;
  let escaped = false;
  let inClass = false;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) break;
    else if (ch === "\n") throw new Error("unterminated regex literal");
  }
  if (src[i] !== "/") throw new Error("unterminated regex literal");
  const source = src.slice(from + 1, i);
  let j = i + 1;
  while (j < src.length && /[dgimsuvy]/.test(src[j] ?? "")) j += 1;
  return { source, flags: src.slice(i + 1, j), end: j };
}

export interface HostPattern {
  readonly name: string;
  readonly source: string;
  readonly flags: string;
  readonly placeholder: string;
}

/** Parse the host's `PII_PATTERNS` array into comparable records. */
export function readHostPiiPatterns(src: string): HostPattern[] {
  const clean = stripCommentLines(src);
  const inner = balancedArray(clean, "PII_PATTERNS");
  const out: HostPattern[] = [];
  let cursor = 0;
  for (;;) {
    const nameAt = inner.indexOf("name:", cursor);
    if (nameAt < 0) break;
    const nameMatch = /name:\s*["']([^"']+)["']/.exec(inner.slice(nameAt));
    if (!nameMatch?.[1]) throw new Error("PII_PATTERNS: a `name:` without a string literal");
    const reAt = inner.indexOf("re:", nameAt);
    if (reAt < 0) throw new Error(`PII_PATTERNS: entry "${nameMatch[1]}" has no \`re:\``);
    const slash = inner.indexOf("/", reAt);
    const { source, flags, end } = readRegexLiteral(inner, slash);
    const placeholderMatch = /placeholder:\s*["']([^"']*)["']/.exec(inner.slice(end));
    if (!placeholderMatch?.[1]) throw new Error(`PII_PATTERNS: entry "${nameMatch[1]}" has no \`placeholder:\``);
    out.push({ name: nameMatch[1], source, flags, placeholder: placeholderMatch[1] });
    cursor = end;
  }
  if (out.length === 0) throw new Error("PII_PATTERNS parsed to zero entries — the parser or the host changed shape");
  return out;
}
