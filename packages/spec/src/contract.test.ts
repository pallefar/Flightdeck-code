/**
 * Guards on the seams: the prompt cannot drift from the wire format, JSON extraction handles
 * what models actually emit, and everything derived from `id` matches the host's derivations.
 */

import { describe, expect, it } from "vitest";
import { EXAMPLE_DRAFT, EXAMPLE_DRAFT_JSON, buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt";
import { draftSchema } from "./draft";
import { evaluateDraft, defaultGateContext } from "./gates";
import { extractJsonObject } from "./json";
import {
  HOST_VERSION,
  compareSemver,
  derivationsFor,
  normalizeNavSection,
  parseSemver,
  satisfiesHostCeiling,
} from "./vocabulary";
import { isLikelyEmoji, looksLikeI18nKey, quoteIsGrounded, slugify, snakeify } from "./text";

const promptInput = {
  prompt: "List contracts missing a works-council date for HR reviewers and the works council liaison.",
  answers: [],
  existingSubAppIds: [],
  hostVersion: HOST_VERSION,
};

describe("the example in the prompt", () => {
  it("still parses as a draft - if the wire format changes, this fails before a model sees it", () => {
    const parsed = draftSchema.safeParse(JSON.parse(EXAMPLE_DRAFT_JSON));
    expect(parsed.success).toBe(true);
  });

  it("survives the gates, so we never show a model an example our own rules would reject", () => {
    const outcome = evaluateDraft(EXAMPLE_DRAFT, defaultGateContext(promptInput.prompt));
    expect(outcome.status).toBe("planned");
  });
});

describe("prompts", () => {
  it("states the three rules the model may not bend", () => {
    const system = buildSystemPrompt(promptInput);
    expect(system).toContain("evidence");
    expect(system).toContain("never mutates");
    expect(system).toContain(`minHostVersion must be <= ${HOST_VERSION}`);
    expect(system).toContain(EXAMPLE_DRAFT_JSON);
  });

  it("passes earlier answers through as quotable user words", () => {
    const user = buildUserPrompt({
      ...promptInput,
      answers: [{ question: "Who should see this?", answer: "hr_reviewer only" }],
    });
    expect(user).toContain("hr_reviewer only");
    expect(user).toContain("count as their words");
  });

  it("shows the model its own reply and the exact problems on a repair", () => {
    const repair = buildRepairPrompt('{"understanding":', ["spec: Required", "(root): Unrecognized key"]);
    expect(repair).toContain('{"understanding":');
    expect(repair).toContain("Unrecognized key");
    expect(repair).toContain("not invent values");
  });
});

describe("extractJsonObject", () => {
  it("reads a bare object, a fenced object and one buried in prose", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractJsonObject('Sure thing!\n{"a":1}\nHope that helps.')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("does not get lost in braces inside strings", () => {
    const result = extractJsonObject('prose {"summary":"uses { and } and \\" inside","n":2} trailing');
    expect(result).toEqual({ ok: true, value: { summary: 'uses { and } and " inside', n: 2 } });
  });

  it("reports why a reply is unusable instead of throwing", () => {
    expect(extractJsonObject("")).toMatchObject({ ok: false });
    expect(extractJsonObject("no json here")).toMatchObject({ ok: false });
    expect(extractJsonObject('{"a": 1')).toMatchObject({ ok: false });
    expect(extractJsonObject("[1,2,3]")).toMatchObject({ ok: false });
    const broken = extractJsonObject('{"a": oops}');
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.reason).toContain("did not parse");
    }
  });
});

describe("host derivations", () => {
  it("derives every id-dependent value the way the host does", () => {
    expect(derivationsFor("works-council-gaps")).toEqual({
      routePrefix: "/api/apps/works-council-gaps",
      webModuleId: "works-council-gaps",
      navPath: "/console/apps/works-council-gaps",
      enableEnvVar: "SUBAPP_WORKS_COUNCIL_GAPS_ENABLED",
      tablePrefix: "subapp_works_council_gaps_",
    });
    expect(derivationsFor("audit").enableEnvVar).toBe("SUBAPP_AUDIT_ENABLED");
  });

  it("compares versions and holds the boot ceiling", () => {
    expect(parseSemver("5.0.0")).toEqual([5, 0, 0]);
    expect(parseSemver("5.0")).toBeNull();
    expect(compareSemver("4.9.9", "5.0.0")).toBe(-1);
    expect(compareSemver("5.0.0", "5.0.0")).toBe(0);
    expect(compareSemver("5.0.1", "5.0.0")).toBe(1);
    expect(compareSemver("five", "5.0.0")).toBeNull();
    expect(satisfiesHostCeiling("5.0.0")).toBe(true);
    expect(satisfiesHostCeiling("5.0.1")).toBe(false);
    expect(satisfiesHostCeiling("not-a-version")).toBe(false);
  });

  it("fixes a nav section's spelling but never its meaning", () => {
    expect(normalizeNavSection("ops & insight")).toBe("Ops & insight");
    expect(normalizeNavSection("  Contract   Pipeline ")).toBe("Contract pipeline");
    expect(normalizeNavSection("Contracts")).toBeNull();
    expect(normalizeNavSection("Ops and insight")).toBeNull();
  });
});

describe("text helpers", () => {
  it("slugs mechanically", () => {
    expect(slugify("Works Council Gaps")).toBe("works-council-gaps");
    expect(slugify("Übersicht -- 2")).toBe("ubersicht-2");
    expect(snakeify("Works council date")).toBe("works_council_date");
  });

  it("only counts a quote as evidence when the user really wrote it", () => {
    const sources = ["Flag contracts missing a works-council date for hr_reviewer."];
    expect(quoteIsGrounded("contracts missing a works-council date", sources)).toBe(true);
    expect(quoteIsGrounded("Contracts Missing A Works Council Date", sources)).toBe(true);
    expect(quoteIsGrounded("file a proposal in the inbox", sources)).toBe(false);
    // Too short to mean anything - "a" would otherwise match every prompt.
    expect(quoteIsGrounded("a", sources)).toBe(false);
  });

  it("knows an emoji from prose and a label from an i18n key", () => {
    expect(isLikelyEmoji("🗓️")).toBe(true);
    expect(isLikelyEmoji("📄")).toBe(true);
    expect(isLikelyEmoji("calendar")).toBe(false);
    expect(isLikelyEmoji("")).toBe(false);
    expect(looksLikeI18nKey("app.contracts.title")).toBe(true);
    expect(looksLikeI18nKey("Works council gaps")).toBe(false);
  });
});
