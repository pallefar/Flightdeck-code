/**
 * ⭐ THE ANTI-DIVERGENCE TEST — the reason the copies in `../lists.ts` are
 * allowed to exist.
 *
 * The host states the principle in its own gateway test
 * (`flightdeck/tests/aiProxyEdgeFunction.test.ts:12-14):
 *
 *     "Two copies of a security list that can silently diverge is worse than
 *      one. These cases are the mechanism that makes the duplication safe —
 *      they FAIL on divergence, in either direction."
 *
 * "In either direction" is the load-bearing half and the half that is easy to
 * skip. A test that only checks `host ⊆ studio` passes forever while Studio
 * quietly accumulates rules the host does not have — Studio then refuses
 * things the host allows, which is annoying. A test that only checks
 * `studio ⊆ host` passes while the host adds a pattern Studio never learns —
 * Studio then ALLOWS things the host would refuse, which is the incident. Both
 * directions are asserted below, separately, and the failure message names the
 * entries and which side is missing them.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SKIPPING IS LOUD
 * ─────────────────────────────────────────────────────────────────────────
 * When the host checkout is not on disk this cannot run. It then SKIPS with
 * the reason in the suite name, and a separate always-on case asserts that the
 * reason is a real named reason rather than an accident. A security test that
 * silently passes because it found no files is the same failure as the 25
 * `piiGitBoundary` tests that "passed the whole time" while a duplicate copy
 * of 921 people's data sat tracked at a second path.
 */

import { describe, expect, it } from "vitest";
import {
  PII_DENIED_SEGMENTS,
  PII_DENIED_SUBSTRINGS,
  PII_PATTERNS,
} from "../lists";
import { MAX_TEXT_CHARS } from "../scrub";
import {
  HOST_ABSENCE_ACK_ENV,
  HOST_ABSENCE_ACK_VALUE,
  HOST_ENVELOPE,
  HOST_ROOT,
  HOST_WIDGET_TYPES,
  hostAvailability,
  readHostPiiPatterns,
  readHostSource,
  readNumberConst,
  readRegexLiteral,
  readStringArray,
  stripCommentLines,
} from "../host-source";

const host = hostAvailability();

/** Both directions, named. Returns a human-readable report or null. */
function diff(label: string, studio: readonly string[], hostList: readonly string[]): string | null {
  const missingInStudio = hostList.filter((x) => !studio.includes(x));
  const extraInStudio = studio.filter((x) => !hostList.includes(x));
  if (missingInStudio.length === 0 && extraInStudio.length === 0) return null;
  const lines = [`${label} has DIVERGED from the host:`];
  if (missingInStudio.length > 0) {
    lines.push(
      `  HOST HAS, STUDIO DOES NOT (Studio will ALLOW what the host refuses — this is the dangerous direction): ${missingInStudio.join(", ")}`,
    );
  }
  if (extraInStudio.length > 0) {
    lines.push(
      `  STUDIO HAS, HOST DOES NOT (Studio will refuse what the host allows): ${extraInStudio.join(", ")}`,
    );
  }
  lines.push(`  Host source: ${HOST_WIDGET_TYPES} / ${HOST_ENVELOPE}`);
  lines.push(`  Studio copy: packages/guardrails/src/lists.ts`);
  return lines.join("\n");
}

describe("the host checkout, or a named reason it is absent", () => {
  it("states availability with a reason either way", () => {
    expect(host.reason).toBeTruthy();
    expect(host.reason.length).toBeGreaterThan(20);
    if (!host.available) {
      expect(host.reason).toContain("HOST CHECKOUT NOT READABLE");
      expect(host.reason).toContain("FLIGHTDECK_HOST_ROOT");
      expect(host.reason).toContain(HOST_ABSENCE_ACK_ENV);
    }
  });

  /**
   * ⭐ THE CASE THAT FAILS INSTEAD OF SKIPPING.
   *
   * Everything below this describe block is `describe.skipIf(!host.available)`,
   * and skipping is the right behaviour for a comparison that has nothing to
   * compare against — you cannot diff a file that is not there. What is NOT
   * right is the exit code that came with it. Before this case,
   *
   *     FLIGHTDECK_HOST_ROOT=/nonexistent npx vitest run packages/guardrails
   *
   * printed "Test Files 5 passed, Tests 90 passed | 8 skipped" and exited 0,
   * with a console.warn in the middle that no CI system reads. The eight
   * skipped cases are the entire mechanism that makes two copies of a security
   * list safe to have; a run in which they did not execute is a run in which
   * the copies were not checked, and it must not be reported as a pass.
   *
   * This case is deliberately NOT skipIf'd. It is the one that turns "could
   * not verify" into a red suite and a non-zero exit, and it is why
   * `hostAvailability` has an `acknowledged` field: the only way past it is a
   * human setting an exact string that then appears in this test's own name.
   */
  it(`FAILS when the host lists could not be verified [ack=${host.acknowledged ? HOST_ABSENCE_ACK_VALUE : "not given"}]`, () => {
    expect(
      host.available || host.acknowledged,
      `${host.reason}\n\n` +
        `Studio's copies of the host security lists were NOT verified against the host on this run.\n` +
        `A skipped divergence check is not a passing one: the copies in packages/guardrails/src/lists.ts\n` +
        `could have forked from ${HOST_ROOT} in either direction and nothing here would know.\n` +
        `Point FLIGHTDECK_HOST_ROOT at a pallefar/project-contract checkout, or set\n` +
        `${HOST_ABSENCE_ACK_ENV}=${HOST_ABSENCE_ACK_VALUE} to proceed knowingly unverified.`,
    ).toBe(true);
  });

  it("only an EXACT acknowledgement counts — `=1` does not", () => {
    // The point of the acknowledgement is that it cannot be set by reflex to
    // make red go away. If it could, it would be the console.warn again.
    expect(HOST_ABSENCE_ACK_VALUE).not.toBe("1");
    expect(HOST_ABSENCE_ACK_VALUE.length).toBeGreaterThan(8);
    const saved = process.env[HOST_ABSENCE_ACK_ENV];
    try {
      process.env[HOST_ABSENCE_ACK_ENV] = "1";
      expect(hostAvailability().acknowledged).toBe(false);
      process.env[HOST_ABSENCE_ACK_ENV] = HOST_ABSENCE_ACK_VALUE;
      expect(hostAvailability().acknowledged).toBe(true);
    } finally {
      if (saved === undefined) delete process.env[HOST_ABSENCE_ACK_ENV];
      else process.env[HOST_ABSENCE_ACK_ENV] = saved;
    }
  });
});

describe.skipIf(!host.available)(`Studio's copies vs the host at ${HOST_ROOT} [${host.reason}]`, () => {
  const widgetSrc = host.available ? readHostSource(HOST_WIDGET_TYPES) : "";
  const envelopeSrc = host.available ? readHostSource(HOST_ENVELOPE) : "";

  it("PII_DENIED_SUBSTRINGS matches, in both directions", () => {
    const hostList = readStringArray(widgetSrc, "PII_DENIED_SUBSTRINGS");
    expect(hostList.length).toBeGreaterThan(0);
    expect(diff("PII_DENIED_SUBSTRINGS", PII_DENIED_SUBSTRINGS, hostList)).toBeNull();
  });

  it("PII_DENIED_SEGMENTS matches, in both directions", () => {
    const hostList = readStringArray(widgetSrc, "PII_DENIED_SEGMENTS");
    expect(hostList.length).toBeGreaterThan(0);
    expect(diff("PII_DENIED_SEGMENTS", PII_DENIED_SEGMENTS, hostList)).toBeNull();
  });

  it("PII_PATTERNS matches by class name, in both directions", () => {
    const hostList = readHostPiiPatterns(envelopeSrc).map((p) => p.name);
    expect(diff("PII_PATTERNS (class names)", PII_PATTERNS.map((p) => p.name), hostList)).toBeNull();
  });

  it("PII_PATTERNS matches ENTRY FOR ENTRY — regex source, flags and placeholder", () => {
    // Names alone are not enough. A host that tightens `digits` from 7 digits
    // to 5, or loses the `g` flag, has changed what is caught without changing
    // a single name.
    const hostList = readHostPiiPatterns(envelopeSrc);
    const studio = PII_PATTERNS.map((p) => ({
      name: p.name,
      source: p.re.source,
      flags: p.re.flags,
      placeholder: p.placeholder,
    }));
    const problems: string[] = [];
    for (const h of hostList) {
      const s = studio.find((x) => x.name === h.name);
      if (!s) continue; // reported by the class-name case above
      if (s.source !== h.source) {
        problems.push(`  ${h.name}: regex source differs\n    host:   ${h.source}\n    studio: ${s.source}`);
      }
      if (s.flags !== h.flags) {
        problems.push(`  ${h.name}: flags differ — host "${h.flags}", studio "${s.flags}"`);
      }
      if (s.placeholder !== h.placeholder) {
        problems.push(
          `  ${h.name}: placeholder differs — host "${h.placeholder}", studio "${s.placeholder}"`,
        );
      }
    }
    expect(problems.join("\n"), `PII_PATTERNS entries DIVERGED:\n${problems.join("\n")}`).toBe("");
  });

  it("PII_PATTERNS is in the host's ORDER — email before digits", () => {
    // The host's header: "Ordering matters for scrub(): email runs before
    // digits, otherwise a numeric local-part would be partly eaten and the
    // address would survive as a recognisable fragment." `scrub()` walks
    // Studio's array in array order, so the order IS part of the copy.
    const hostNames = readHostPiiPatterns(envelopeSrc).map((p) => p.name);
    expect(PII_PATTERNS.map((p) => p.name)).toEqual(hostNames);
    expect(hostNames.indexOf("email")).toBeLessThan(hostNames.indexOf("digits"));
  });

  it("MAX_TEXT_CHARS matches the host's", () => {
    expect(MAX_TEXT_CHARS).toBe(readNumberConst(envelopeSrc, "MAX_TEXT_CHARS"));
  });

  it("the host's deniedPiiField still applies SUBSTRINGS before SEGMENTS", () => {
    // A list-only comparison cannot see a reordering of the host's two tiers,
    // and a reordering changes what tier 4 means here without changing an
    // entry. Asserted against the text, the same way the host asserts
    // properties of its Deno edge function.
    const clean = stripCommentLines(widgetSrc);
    const fn = clean.slice(clean.indexOf("function deniedPiiField"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    const subAt = body.indexOf("PII_DENIED_SUBSTRINGS");
    const segAt = body.indexOf("PII_DENIED_SEGMENTS");
    expect(subAt, "deniedPiiField no longer mentions PII_DENIED_SUBSTRINGS").toBeGreaterThan(-1);
    expect(segAt, "deniedPiiField no longer mentions PII_DENIED_SEGMENTS").toBeGreaterThan(-1);
    expect(subAt, "the host reordered its two PII tiers — re-derive Studio's tier mapping").toBeLessThan(segAt);
  });

  it("the host's PII_PATTERNS is still the envelope's single declaration", () => {
    // If a second `PII_PATTERNS` appears in the host, this parser reads the
    // first and would compare against the wrong one.
    const occurrences = (envelopeSrc.match(/const PII_PATTERNS/g) ?? []).length;
    expect(occurrences, "more than one PII_PATTERNS declaration in the host envelope").toBe(1);
  });
});

describe("the source parser itself", () => {
  // The parser is the only thing standing between "the lists agree" and "the
  // lists appear to agree". These cases are what stop it producing a plausible
  // wrong answer, which is the failure mode that would make the whole suite
  // decorative.
  it("reads a regex literal containing a slash inside a character class", () => {
    const src = String.raw`{ name: "digits", re: /\b\d[\d /.-]{5,}\d\b/g, placeholder: "<number>" },`;
    const at = src.indexOf("/", src.indexOf("re:"));
    const { source, flags } = readRegexLiteral(src, at);
    expect(source).toBe(String.raw`\b\d[\d /.-]{5,}\d\b`);
    expect(flags).toBe("g");
  });

  it("parses a synthetic PII_PATTERNS and notices an added entry", () => {
    const synthetic = [
      "export const PII_PATTERNS = [",
      '  // a comment with a / slash in it',
      '  { name: "email", re: /a@b/g, placeholder: "<email>" },',
      '  { name: "newclass", re: /x/g, placeholder: "<x>" },',
      "];",
    ].join("\n");
    const parsed = readHostPiiPatterns(synthetic).map((p) => p.name);
    expect(parsed).toEqual(["email", "newclass"]);
    const report = diff("PII_PATTERNS (class names)", ["email"], parsed);
    expect(report).toContain("newclass");
    expect(report).toContain("this is the dangerous direction");
  });

  it("skips the TYPE ANNOTATION's brackets and reads the initialiser", () => {
    // The real bug this parser shipped with for ten minutes. The host writes
    // `readonly string[] = [...]`; a scanner anchored on the const name reads
    // the annotation's empty `[]`, reports a zero-entry host list, and a
    // laxer comparator would then have called that agreement.
    const src = 'export const PII_DENIED_SEGMENTS: readonly string[] = ["person", "name"];';
    expect(readStringArray(src, "PII_DENIED_SEGMENTS")).toEqual(["person", "name"]);
    const annotated = 'export const PII_PATTERNS: readonly { name: string; re: RegExp }[] = [\n' +
      '  { name: "email", re: /a@b/g, placeholder: "<email>" },\n];';
    expect(readHostPiiPatterns(annotated).map((p) => p.name)).toEqual(["email"]);
  });

  it("throws rather than guessing when the host changes shape", () => {
    expect(() => readHostPiiPatterns("export const SOMETHING_ELSE = [];")).toThrow(/PII_PATTERNS/);
    expect(() => readStringArray("const X = 1;", "PII_DENIED_SEGMENTS")).toThrow(/not found/);
  });
});
