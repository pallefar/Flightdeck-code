/**
 * THE GATE THAT MAKES THE COPY IN `host-mirror.ts` WORTH HAVING.
 *
 * It reads `flightdeck/server/services/ai/envelope.ts` OFF DISK, pulls out
 * the five things this package transcribed, and compares them to the
 * transcription. If the host edits a pattern, a boundary rule, a placeholder
 * or the order of the array, this goes red and names which one.
 *
 * That is the whole justification for carrying a copy. The host wrote the
 * bargain down itself (`flightdeck/tests/aiProxyEdgeFunction.test.ts:12`):
 *
 *     "Two copies of a security list that can silently diverge is worse than
 *      one. These cases are the mechanism that makes the duplication safe —
 *      they FAIL on divergence, in either direction."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW THE COMPARISON IS DONE, AND WHY IT IS SAFE TO DO IT ON SOURCE TEXT
 * ─────────────────────────────────────────────────────────────────────────
 * Both sides go through THE SAME extractor and THE SAME normaliser. The
 * extractor is a naive brace/bracket matcher — it would be fooled by an
 * unbalanced brace inside a string or a regex — but it is fooled IDENTICALLY
 * on both files, so a quirk cannot manufacture a pass. What it can do is
 * manufacture a FAILURE, and a failure here means a human reads both
 * functions, which is the correct outcome of "something moved".
 *
 * Normalisation strips block comments and whole-line `//` comments and
 * collapses whitespace. It deliberately does NOT strip TRAILING comments: a
 * host edit that adds one to a line inside these functions turns this red,
 * and re-reading a security function because someone annotated it is the
 * cheap half of the bargain.
 *
 * ⚠ EXACTLY ONE SUBSTITUTION IS PERMITTED: the host throws `PiiRefusalError`
 * and this package throws `ResidualPiiError` — same shape, same
 * class-names-only message, a name that says which module refused. It is
 * rewritten on the HOST side before comparing, so the rest of the body is
 * still compared character for character.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { HOST_ROOT } from "../../../guardrails/src/host-source";

// ⚠ DERIVED, NOT HARDCODED. This was the literal Linux path, so on any
// machine whose checkout lives elsewhere the file was simply absent and
// this whole file skipped — silently, and on a MAC that is every run.
// `HOST_ROOT` is the one place that reads FLIGHTDECK_HOST_ROOT.
const HOST = `${HOST_ROOT}/flightdeck/server/services/ai/envelope.ts`;
const MIRROR = new URL("../host-mirror.ts", import.meta.url).pathname;
const available = fs.existsSync(HOST);

/**
 * Balanced-delimiter slice starting at the first `open` after `marker` (or
 * after `from`, when the marker is followed by something that also uses the
 * delimiter).
 *
 * ⭐ `from` exists because the first version of this file DID NOT HAVE IT and
 * was therefore green for the wrong reason. The host declares
 *
 *     export const PII_PATTERNS: readonly { name: string; ... }[] = [ ... ]
 *
 * so "the first `[` after the marker" is the `[]` of the TYPE ANNOTATION.
 * Both files extracted `"[]"`, both normalised to `"[]"`, and the comparison
 * passed without ever looking at a single pattern. A divergence gate that
 * compares two empty strings is worse than no gate, so `assertSubstantial`
 * below now refuses any extraction small enough to be that mistake again.
 */
function extractBlock(
  source: string,
  marker: string,
  open: "{" | "[",
  close: "}" | "]",
  from?: string,
): string {
  const at = source.indexOf(marker);
  if (at === -1) throw new Error(`marker not found: ${marker}`);
  const fromAt = from === undefined ? at : source.indexOf(from, at);
  if (fromAt === -1) throw new Error(`"${from}" not found after marker: ${marker}`);
  const start = source.indexOf(open, fromAt);
  if (start === -1) throw new Error(`no "${open}" after marker: ${marker}`);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced "${open}" after marker: ${marker}`);
}

/** No extraction this gate makes is a handful of characters. If one is, the
 * extractor found the wrong span and the comparison would be meaningless. */
function assertSubstantial(what: string, block: string): string {
  if (block.replace(/\s/g, "").length < 40) {
    throw new Error(`extraction for ${what} is ${block.length} chars — the extractor found the wrong span`);
  }
  return block;
}

function normalise(block: string): string {
  return block
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

/** The five transcribed things, by the marker that finds each one. */
const TRANSCRIBED: readonly {
  what: string;
  marker: string;
  open: "{" | "[";
  close: "}" | "]";
  from?: string;
}[] = [
  { what: "PII_PATTERNS", marker: "export const PII_PATTERNS", open: "[", close: "]", from: "= [" },
  { what: "initials()", marker: "function initials(name: string): string", open: "{", close: "}" },
  { what: "escapeRegExpLiteral()", marker: "function escapeRegExpLiteral(s: string): string", open: "{", close: "}" },
  {
    what: "residualPiiFindings()",
    marker: "function residualPiiFindings(text: string, opts: RedactOptions = {}): string[]",
    open: "{",
    close: "}",
    // The signature's own `= {}` is the first brace after the marker, so the
    // body has to be anchored past it. Same mistake as the type annotation
    // above, caught by the same guard.
    from: "): string[]",
  },
  {
    what: "assertNoResidualPii()",
    marker: "function assertNoResidualPii(json: string, opts: RedactOptions = {}): void",
    open: "{",
    close: "}",
    from: "): void",
  },
];

describe.skipIf(!available)("the transcription in host-mirror.ts still matches the host", () => {
  const hostSource = available ? fs.readFileSync(HOST, "utf8") : "";
  const mirrorSource = fs.readFileSync(MIRROR, "utf8");

  for (const { what, marker, open, close, from } of TRANSCRIBED) {
    it(`${what} is character-for-character the host's`, () => {
      // Both files are searched with the SAME marker, so a host signature
      // change fails loudly rather than silently matching another function.
      const hostBlock = assertSubstantial(`host ${what}`, extractBlock(hostSource, marker, open, close, from));
      const mirrorBlock = assertSubstantial(`mirror ${what}`, extractBlock(mirrorSource, marker, open, close, from));
      const host = normalise(hostBlock).replaceAll("PiiRefusalError", "ResidualPiiError");
      expect(normalise(mirrorBlock)).toBe(host);
    });
  }

  it("would FAIL if the host changed one character — the gate detects divergence", () => {
    // A divergence gate has to be shown to go red, not just observed to be
    // green. This mutates ONE character of the host's `digits` pattern (the
    // 5-character run becomes 6) and asserts the comparison rejects it. If
    // this ever passes, the comparison has stopped comparing.
    const block = extractBlock(hostSource, "export const PII_PATTERNS", "[", "]", "= [");
    const mutated = block.replace("[\\d /.-]{5,}", "[\\d /.-]{6,}");
    expect(mutated, "the mutation did not apply — the host's digits pattern moved").not.toBe(block);
    const mirror = normalise(extractBlock(mirrorSource, "export const PII_PATTERNS", "[", "]", "= ["));
    expect(mirror).not.toBe(normalise(mutated));
    expect(mirror).toBe(normalise(block));
  });

  it("names every PII class the host defines — a new host class cannot be ignored", () => {
    const block = extractBlock(hostSource, "export const PII_PATTERNS", "[", "]", "= [");
    const hostNames = [...block.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(hostNames).toEqual(["email", "iban", "digits", "amount", "date"]);
    return import("../host-mirror").then(({ PII_PATTERNS }) => {
      // Same names, SAME ORDER — the host's header makes the order part of
      // the contract ("email runs before digits").
      expect(PII_PATTERNS.map((p) => p.name)).toEqual(hostNames);
    });
  });

  it("maps every host class to a tag class, and every tag class to the host's placeholder", async () => {
    const { PII_PATTERNS } = await import("../host-mirror");
    const { HOST_CLASS_TO_TAG_CLASS } = await import("../tags");
    for (const { name, placeholder } of PII_PATTERNS) {
      const mapped = HOST_CLASS_TO_TAG_CLASS[name];
      expect(mapped, `host class "${name}" has no tag class`).toBeDefined();
      // This is the "extends the host's vocabulary" claim, checked: the tag
      // class is the word the host already puts in the payload.
      expect(placeholder).toBe(`<${mapped}>`);
    }
  });
});

it("has a transcription to check, and says so loudly when the host is not there to check it against", () => {
  // A divergence gate that silently passes because it found no file is worse
  // than no gate, so the skip is REPORTED rather than left as an empty
  // describe block that reads like coverage. The one thing asserted
  // unconditionally is that the transcription itself is present — if that
  // file is gone, every test above would vacuously skip.
  expect(fs.existsSync(MIRROR)).toBe(true);
  if (!available) {
    console.warn(`[pseudonym] divergence gate SKIPPED: ${HOST} is not on disk. The transcription is UNVERIFIED.`);
  }
});
