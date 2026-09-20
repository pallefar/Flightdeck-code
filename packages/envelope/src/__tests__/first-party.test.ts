/**
 * ⭐ THE ONE PLACE FREE TEXT CAN BE `ready`, AND WHETHER IT IS A REAL
 * DISTINCTION OR A HOLE.
 *
 * `disposition` was `textFacts > 0 ? "requires-human-approval" : "ready"`, and
 * `gateModelRequest` never calls `checkApproval` — so no free text could ever
 * reach a model, by any route, which also meant a prompt-to-spec builder could
 * not exist. The distinction added is AUTHORSHIP, not content: a sentence the
 * operator typed here, under their own name, is not the same object as a
 * contract somebody uploaded, even when the bytes are identical.
 *
 * That is only defensible if it is NARROW. These tests are the narrowness:
 * each of the four conditions is removed in turn and must, on its own, put the
 * request back in front of a human. A policy that can be opened by setting one
 * string is not a policy.
 */
import { describe, expect, it } from "vitest";
import { buildEnvelope } from "../build";
import type { CoverageReportLike } from "../types";

/** Reduced to tier 2 — what pseudonymising an operator's sentence achieves. */
const REDUCED: CoverageReportLike = {
  payloadTier: 2,
  vaultTier: 4,
  reduced: true,
  coverage: {
    checked: ["quasi-identifier-signal-words", "name-shaped-span", "vault-entry-classes"],
    unchecked: ["undeclared-personal-name", "postal-address"],
    representations: ["as-written", "percent-decoded", "html-entity-decoded"],
  },
  statement: "payload may be treated as tier two (from four); vault stays restricted",
};

const TEXT = "Track the statutory consultation window for a contract folder.";

function request(overrides: {
  authorship?: unknown;
  assessment?: unknown;
  text?: string;
} = {}) {
  return {
    task: "studio.spec.draft",
    text: [
      {
        key: "workflow",
        text: overrides.text ?? TEXT,
        assessment: overrides.assessment ?? REDUCED,
        ...(overrides.authorship === undefined ? {} : { authorship: overrides.authorship }),
      },
    ],
  };
}

const OPERATOR = { actor: "Karsten Haldan" };

describe("a first-party operator instruction", () => {
  it("⭐ is READY — the operator IS the human, and asking them to approve themselves is ceremony", () => {
    const result = buildEnvelope(request({ authorship: "first-party-operator" }), OPERATOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disposition).toBe("ready");
    expect(result.approvalReasons).not.toContain("text-is-third-party-content");
  });

  it("still carries the pseudonymiser's limits — ready is not clean", () => {
    const result = buildEnvelope(request({ authorship: "first-party-operator" }), OPERATOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `ready` says a human need not stamp it. It does not say nothing was
    // missed, and the assurance still names everything nothing looked at.
    expect(result.assurance.notChecked.length).toBeGreaterThan(0);
    expect(result.assurance.statement).toContain("NOT a certificate of absence");
  });
});

describe("each condition, removed on its own, puts it back in front of a human", () => {
  it("1. no authorship flag at all → third-party, the safe default", () => {
    const result = buildEnvelope(request(), OPERATOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disposition).toBe("requires-human-approval");
    expect(result.approvalReasons).toContain("text-is-third-party-content");
  });

  it("2. declared third-party → human, exactly as before this existed", () => {
    const result = buildEnvelope(request({ authorship: "third-party-content" }), OPERATOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disposition).toBe("requires-human-approval");
  });

  it("3. ⭐ no NAMED operator → human. 'The operator typed it' needs an operator", () => {
    for (const actor of [undefined, "", " ", "system", "admin", "the approver", "x"]) {
      const result = buildEnvelope(
        request({ authorship: "first-party-operator" }),
        actor === undefined ? {} : { actor },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.disposition, `actor ${JSON.stringify(actor)}`).toBe("requires-human-approval");
      expect(result.approvalReasons).toContain("no-named-operator-for-a-first-party-instruction");
    }
  });

  it("4. ⭐ pseudonymisation did not reduce it below tier 3 → human", () => {
    // The whole point of tokenising is that the payload drops. If it did not,
    // the operator being first-party changes nothing: the text still carries
    // what it carried.
    const result = buildEnvelope(
      request({ authorship: "first-party-operator", assessment: { ...REDUCED, payloadTier: 3 } }),
      OPERATOR,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disposition).toBe("requires-human-approval");
    expect(result.approvalReasons).toContain("text-not-reduced-below-tier-3");
  });
});

describe("the flag cannot be used to launder content", () => {
  it("⭐ a first-party flag does NOT bypass the host's residual scanner", () => {
    // Pasting a contract into the prompt box makes the operator accountable
    // for having pasted it. It does not make the text clean, and the scanner
    // runs before any of this.
    const result = buildEnvelope(
      request({
        authorship: "first-party-operator",
        text: "Please summarise for anna.sorensen@example.dk on DE02120300000000202051",
      }),
      OPERATOR,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.code)).toContain("text-residual-pii");
  });

  it("an invented authorship value is refused, and never echoed", () => {
    const result = buildEnvelope(request({ authorship: "trusted-internal" }), OPERATOR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.code)).toContain("text-authorship-not-in-vocabulary");
    expect(JSON.stringify(result)).not.toContain("trusted-internal");
  });

  it("a non-string authorship is refused the same way", () => {
    for (const bad of [1, true, null, {}, ["first-party-operator"]]) {
      const result = buildEnvelope(request({ authorship: bad }), OPERATOR);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("⭐ ONE first-party entry does not carry a third-party one alongside it", () => {
    // `every` and not `some`: a request is only first-party if ALL of its text
    // is. Mixing is how a policy like this gets opened.
    const mixed = {
      task: "studio.spec.draft",
      text: [
        { key: "workflow", text: TEXT, assessment: REDUCED, authorship: "first-party-operator" },
        { key: "context", text: "A contract folder summary.", assessment: REDUCED, authorship: "third-party-content" },
      ],
    };
    const result = buildEnvelope(mixed, OPERATOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disposition).toBe("requires-human-approval");
  });
});
