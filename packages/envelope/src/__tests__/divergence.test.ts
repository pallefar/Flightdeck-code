/**
 * ⭐ THE ANTI-DIVERGENCE GATE — the reason the copies in `../allowlists.ts`
 * and `../host-scan.ts` are allowed to exist at all.
 *
 * It reads `flightdeck/server/services/ai/envelope.ts` OFF DISK and compares
 * Studio's transcription of every shared list to it, IN BOTH DIRECTIONS. The
 * host wrote the bargain down itself
 * (`flightdeck/tests/aiProxyEdgeFunction.test.ts:12`):
 *
 *     "Two copies of a security list that can silently diverge is worse than
 *      one. These cases are the mechanism that makes the duplication safe —
 *      they FAIL on divergence, in either direction."
 *
 * Both directions matter and for different reasons. `host ⊆ studio` alone
 * passes forever while the host tightens a ceiling Studio never learns, and
 * Studio then ALLOWS what the host refuses — the incident. `studio ⊆ host`
 * alone passes while Studio accumulates rules the host does not have, and
 * Studio refuses what the host allows — merely annoying. Both are asserted
 * separately below and the message names the direction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SKIPPING IS A FAILURE, NOT A PASS
 * ─────────────────────────────────────────────────────────────────────────
 * `hostAvailability()` is imported from `packages/guardrails` rather than
 * rewritten, including its rule: an absent host checkout FAILS unless a human
 * sets an exact, non-obvious acknowledgement string that then appears in the
 * test's own name. "A warning is read by a human who is watching; an exit
 * code is read by the machine that merges."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT COMPARED
 * ─────────────────────────────────────────────────────────────────────────
 * Everything named `STUDIO_*`. Those lists are authored here for work the
 * host has no equivalent of, and they are excluded BY CONSTRUCTION — separate
 * constants, not a filter over a merged list, so a Studio entry can never be
 * mistaken for a host one or silently mask its disappearance. What IS
 * asserted about them is that they cannot collide with the host's.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HOST_ABSENCE_ACK_ENV,
  HOST_ABSENCE_ACK_VALUE,
  HOST_ENVELOPE,
  HOST_ROOT,
  hostAvailability,
  readNumberConst,
  readStringArray,
} from "../../../guardrails/src/host-source";
import { balancedObject, readHostFactKeyPolicy, readHostRecordOfStringArrays } from "../host-policy";
import {
  HOST_AI_TASKS,
  HOST_FACT_KEY_POLICY,
  HOST_FIELD_NAME_ALLOWLIST,
  HOST_VOCABULARIES,
  MAX_COUNT,
  MAX_REQUEST_BYTES,
  MAX_TEXT_CHARS,
  MAX_TEXT_FACTS,
  STUDIO_AI_TASKS,
  STUDIO_FACT_KEY_POLICY,
  STUDIO_FIELD_NAMES,
  STUDIO_VOCABULARIES,
} from "../allowlists";

const host = hostAvailability();
const MIRROR = fileURLToPath(new URL("../host-scan.ts", import.meta.url));

/** Both directions, named. Returns a human-readable report or null. */
function diff(label: string, studio: readonly string[], hostList: readonly string[]): string | null {
  const missingInStudio = hostList.filter((x) => !studio.includes(x));
  const extraInStudio = studio.filter((x) => !hostList.includes(x));
  if (missingInStudio.length === 0 && extraInStudio.length === 0) return null;
  const lines = [`${label} has DIVERGED from the host:`];
  if (missingInStudio.length > 0) {
    lines.push(
      `  HOST HAS, STUDIO DOES NOT (Studio will ALLOW what the host refuses — the dangerous direction): ${missingInStudio.join(", ")}`,
    );
  }
  if (extraInStudio.length > 0) {
    lines.push(`  STUDIO HAS, HOST DOES NOT (Studio will refuse what the host allows): ${extraInStudio.join(", ")}`);
  }
  lines.push(`  Host source: ${HOST_ENVELOPE}`);
  lines.push(`  Studio copy: packages/envelope/src/allowlists.ts`);
  return lines.join("\n");
}

describe("the host checkout, or a named reason it is absent", () => {
  it(`FAILS when the host lists could not be verified [ack=${host.acknowledged ? HOST_ABSENCE_ACK_VALUE : "not given"}]`, () => {
    expect(
      host.available || host.acknowledged,
      `${host.reason}\n\n` +
        `Studio's copies of the host ENVELOPE lists were NOT verified on this run.\n` +
        `A skipped divergence check is not a passing one: packages/envelope/src/allowlists.ts is the\n` +
        `whole of what may leave this process, and it could have forked from ${HOST_ROOT} in either\n` +
        `direction with nothing here to notice.\n` +
        `Point FLIGHTDECK_HOST_ROOT at a pallefar/project-contract checkout, or set\n` +
        `${HOST_ABSENCE_ACK_ENV}=${HOST_ABSENCE_ACK_VALUE} to proceed knowingly unverified.`,
    ).toBe(true);
  });

  it("has a transcription to check", () => {
    // If `host-scan.ts` were deleted, every comparison below would vacuously
    // skip and the suite would read as coverage.
    expect(fs.existsSync(MIRROR)).toBe(true);
  });
});

describe.skipIf(!host.available)(`Studio's envelope copies vs the host at ${HOST_ROOT}`, () => {
  const src = host.available ? fs.readFileSync(HOST_ENVELOPE, "utf8") : "";

  it("AI_TASKS matches, in both directions", () => {
    const hostList = readStringArray(src, "AI_TASKS");
    expect(hostList.length).toBeGreaterThan(0);
    expect(diff("AI_TASKS", [...HOST_AI_TASKS], hostList)).toBeNull();
  });

  it("FIELD_NAME_ALLOWLIST matches, in both directions", () => {
    const hostList = readStringArray(src, "FIELD_NAME_ALLOWLIST");
    expect(hostList.length).toBeGreaterThan(0);
    expect(diff("FIELD_NAME_ALLOWLIST", HOST_FIELD_NAME_ALLOWLIST, hostList)).toBeNull();
  });

  it("VOCABULARIES matches by NAME and, for each one, MEMBER FOR MEMBER", () => {
    // Names alone are not enough: a vocabulary that quietly gains a member has
    // widened what may leave the process without gaining a name.
    const hostVocab = readHostRecordOfStringArrays(src, "VOCABULARIES");
    expect(diff("VOCABULARIES (names)", Object.keys(HOST_VOCABULARIES), Object.keys(hostVocab))).toBeNull();
    for (const [name, members] of Object.entries(hostVocab)) {
      expect(diff(`VOCABULARIES.${name}`, HOST_VOCABULARIES[name] ?? [], members)).toBeNull();
    }
  });

  it("FACT_KEY_POLICY matches by KEY, by KIND and by CEILING", () => {
    const hostPolicy = readHostFactKeyPolicy(src);
    expect(diff("FACT_KEY_POLICY (keys)", Object.keys(HOST_FACT_KEY_POLICY), Object.keys(hostPolicy))).toBeNull();
    const problems: string[] = [];
    for (const [key, policy] of Object.entries(hostPolicy)) {
      const studio = HOST_FACT_KEY_POLICY[key];
      if (studio === undefined) continue; // reported by the key diff above
      if (studio.kind !== policy.kind) {
        problems.push(`  ${key}: kind differs — host "${policy.kind}", studio "${studio.kind}"`);
      }
      // ⚠ A CEILING IS THE SEMANTIC BOUND, and a raised one is exactly the
      // drift a key-name comparison cannot see: "a ceiling alone cannot tell
      // 4,200 documents from a €4,200 monthly gross, but a ceiling attached to
      // `gatewayCount` can."
      if ((studio.max ?? null) !== (policy.max ?? null)) {
        problems.push(`  ${key}: max differs — host ${String(policy.max)}, studio ${String(studio.max)}`);
      }
    }
    expect(problems.join("\n"), `FACT_KEY_POLICY entries DIVERGED:\n${problems.join("\n")}`).toBe("");
  });

  it("the four LIMITS match the host's numbers", () => {
    expect(MAX_TEXT_CHARS).toBe(readNumberConst(src, "MAX_TEXT_CHARS"));
    expect(MAX_TEXT_FACTS).toBe(readNumberConst(src, "MAX_TEXT_FACTS"));
    expect(MAX_REQUEST_BYTES).toBe(readNumberConst(src, "MAX_REQUEST_BYTES"));
    expect(MAX_COUNT).toBe(readNumberConst(src, "MAX_COUNT"));
  });

  it("the host's FACT_KEY_POLICY is still its single declaration", () => {
    // If a second one appears, this parser reads the first and would compare
    // against the wrong table.
    expect((src.match(/const FACT_KEY_POLICY/g) ?? []).length).toBe(1);
    expect((src.match(/const VOCABULARIES/g) ?? []).length).toBe(1);
  });

  it("would FAIL if the host raised one ceiling — the gate detects divergence", () => {
    // A divergence gate has to be SHOWN to go red, not merely observed green.
    const mutated = src.replace('nodeCount: { kind: "count", max: 1000 }', 'nodeCount: { kind: "count", max: 9000 }');
    expect(mutated, "the mutation did not apply — the host's nodeCount policy moved").not.toBe(src);
    const parsed = readHostFactKeyPolicy(mutated);
    expect(parsed["nodeCount"]?.max).toBe(9000);
    expect(HOST_FACT_KEY_POLICY["nodeCount"]?.max).not.toBe(9000);
  });

  it("would FAIL if the host added a vocabulary member — in the dangerous direction", () => {
    const mutated = src.replace('country: ["DE"]', 'country: ["DE", "AT"]');
    expect(mutated).not.toBe(src);
    const parsed = readHostRecordOfStringArrays(mutated, "VOCABULARIES");
    const report = diff("VOCABULARIES.country", HOST_VOCABULARIES["country"] ?? [], parsed["country"] ?? []);
    expect(report).toContain("AT");
    expect(report).toContain("the dangerous direction");
  });
});

/**
 * THE TRANSCRIBED FUNCTIONS, character for character.
 *
 * ⚠ ZERO PERMITTED SUBSTITUTIONS. `packages/pseudonym`'s equivalent gate
 * allows exactly one (it renames the host's error class). This package does
 * not need even that: `host-scan.ts` keeps the host's own `PiiRefusalError`
 * name, so any difference at all is a difference.
 */
describe.skipIf(!host.available)("the residual scan is the host's, character for character", () => {
  const hostSrc = host.available ? fs.readFileSync(HOST_ENVELOPE, "utf8") : "";
  const mirrorSrc = fs.readFileSync(MIRROR, "utf8");

  function extractBlock(source: string, marker: string, from?: string): string {
    const at = source.indexOf(marker);
    if (at === -1) throw new Error(`marker not found: ${marker}`);
    const fromAt = from === undefined ? at : source.indexOf(from, at);
    if (fromAt === -1) throw new Error(`"${from}" not found after marker: ${marker}`);
    const start = source.indexOf("{", fromAt);
    if (start === -1) throw new Error(`no "{" after marker: ${marker}`);
    let depth = 0;
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          const block = source.slice(start, i + 1);
          if (block.replace(/\s/g, "").length < 40) {
            throw new Error(`extraction for ${marker} is ${block.length} chars — the extractor found the wrong span`);
          }
          return block;
        }
      }
    }
    throw new Error(`unbalanced "{" after marker: ${marker}`);
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

  const TRANSCRIBED: readonly { what: string; marker: string; from?: string }[] = [
    { what: "PiiRefusalError", marker: "class PiiRefusalError extends Error" },
    {
      what: "residualPiiFindings()",
      marker: "function residualPiiFindings(text: string, opts: RedactOptions = {}): string[]",
      // The signature's own `= {}` is the first brace after the marker, so the
      // body has to be anchored past it.
      from: "): string[]",
    },
    {
      what: "assertNoResidualPii()",
      marker: "function assertNoResidualPii(json: string, opts: RedactOptions = {}): void",
      from: "): void",
    },
  ];

  for (const { what, marker, from } of TRANSCRIBED) {
    it(`${what} is character-for-character the host's`, () => {
      const hostBlock = normalise(extractBlock(hostSrc, marker, from));
      const mirrorBlock = normalise(extractBlock(mirrorSrc, marker, from));
      expect(mirrorBlock).toBe(hostBlock);
    });
  }

  it("would FAIL if one character of the host's scan changed", () => {
    const hostBlock = extractBlock(hostSrc, "function residualPiiFindings(text: string, opts: RedactOptions = {}): string[]", "): string[]");
    const mutated = hostBlock.replace("trimmed.length < 2", "trimmed.length < 3");
    expect(mutated, "the mutation did not apply — the host's scan moved").not.toBe(hostBlock);
    const mirror = normalise(
      extractBlock(mirrorSrc, "function residualPiiFindings(text: string, opts: RedactOptions = {}): string[]", "): string[]"),
    );
    expect(mirror).not.toBe(normalise(mutated));
    expect(mirror).toBe(normalise(hostBlock));
  });
});

describe("the Studio-authored half cannot be confused with the host's", () => {
  it("no Studio task, vocabulary, field name or fact key collides with a host one", () => {
    for (const task of STUDIO_AI_TASKS) {
      expect(HOST_AI_TASKS as readonly string[]).not.toContain(task);
      // The prefix is the mechanism, not a convention: it makes collision
      // impossible rather than merely unobserved.
      expect(task.startsWith("studio.")).toBe(true);
    }
    for (const name of Object.keys(STUDIO_VOCABULARIES)) {
      expect(Object.keys(HOST_VOCABULARIES)).not.toContain(name);
    }
    for (const name of STUDIO_FIELD_NAMES) {
      expect(HOST_FIELD_NAME_ALLOWLIST).not.toContain(name);
    }
    for (const key of Object.keys(STUDIO_FACT_KEY_POLICY)) {
      expect(Object.keys(HOST_FACT_KEY_POLICY)).not.toContain(key);
    }
  });
});

describe("the object-literal parser itself", () => {
  // The parser is the only thing between "the tables agree" and "the tables
  // appear to agree".
  it("anchors on the `=` and skips a TYPE ANNOTATION's braces", () => {
    const src =
      'export const FACT_KEY_POLICY: Readonly<Record<string, { kind: AiFact["kind"]; max?: number }>> = {\n' +
      '  field: { kind: "fieldName" },\n  nodeCount: { kind: "count", max: 1000 },\n};';
    const parsed = readHostFactKeyPolicy(src);
    expect(parsed["field"]).toEqual({ kind: "fieldName" });
    expect(parsed["nodeCount"]).toEqual({ kind: "count", max: 1000 });
  });

  it("resolves a ceiling written as a CONST rather than a literal", () => {
    // `docCount: { kind: "count", max: MAX_COUNT }` must not read as "no
    // ceiling" — that would let Studio's copy carry any number for that key
    // and still compare equal.
    const src =
      "export const MAX_COUNT = 10_000;\n" +
      'export const FACT_KEY_POLICY = {\n  docCount: { kind: "count", max: MAX_COUNT },\n  hitCount: { kind: "count", max: 100 },\n};';
    expect(readHostFactKeyPolicy(src)["docCount"]).toEqual({ kind: "count", max: 10000 });
  });

  it("throws rather than guessing when the host changes shape", () => {
    expect(() => readHostFactKeyPolicy("export const SOMETHING_ELSE = {};")).toThrow(/FACT_KEY_POLICY/);
    expect(() => readHostRecordOfStringArrays("const X = 1;", "VOCABULARIES")).toThrow(/not found/);
    // An extraction small enough to be the type-annotation mistake is refused
    // rather than compared.
    expect(() => balancedObject("const VOCABULARIES = 1;", "VOCABULARIES")).toThrow(/no object literal/);
  });
});
