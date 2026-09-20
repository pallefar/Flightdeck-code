/**
 * ⭐ SECTION D — THE PATH AN ALLOWLIST CANNOT CLOSE.
 *
 * A pasted Cowork workflow is arbitrary text and it IS the product. There is
 * no list of permitted workflows, so the structural answer that closes every
 * other path does not close this one, and this file is where that is said out
 * loud rather than papered over.
 *
 * What is asserted below, in order:
 *   1. A text fact CANNOT be written into `facts`. One door only.
 *   2. That door requires a coverage report from `packages/pseudonym`.
 *      Missing → refused. Malformed → refused. Unreadable → refused.
 *   3. The report's LIMITS travel with the envelope, on the fact itself.
 *   4. The text is re-proved independently with the host's own scanner.
 *   5. ⭐ AN ENVELOPE CARRYING A TEXT FACT IS NEVER `ready`. There is no
 *      coverage report, no tier and no option that makes one auto-sendable,
 *      and the last case in this file tries several and fails to find one.
 *
 * All fixtures fictional.
 */

import { describe, expect, it } from "vitest";
import { buildEnvelope } from "../build";
import { APPROVAL_REASON_CODES } from "../build";
import { MAX_TEXT_CHARS } from "../allowlists";
import { gateModelRequest } from "../../../guardrails/src/gates";
import type { CoverageReportLike } from "../types";
import type { TierAssessment } from "../../../pseudonym/src/tier";

/**
 * ⭐ THE COMPILE-TIME COUPLING. `packages/pseudonym` is not imported at
 * RUNTIME anywhere in this package — deliberately, so that this package can
 * never pseudonymise anything itself and hand back an envelope it decided was
 * fine. But its type must stay assignable to what the envelope demands, or
 * the two drift apart and a caller ends up hand-rolling a report.
 *
 * This line is the whole mechanism. If `TierAssessment` loses `coverage` or
 * changes `unchecked`'s type, `npx tsc --noEmit` goes red here.
 */
const _assignable: (a: TierAssessment) => CoverageReportLike = (a) => a;
void _assignable;

/** What `assessTier()` returns for a tokenised workflow, by hand: the shape
 * is checked by the line above, and hand-writing it keeps this suite green
 * while another agent is repairing that package. */
const REPORT: CoverageReportLike = {
  payloadTier: 3,
  vaultTier: 4,
  reduced: true,
  coverage: {
    checked: ["quasi-identifier-signal-words", "name-shaped-span", "vault-entry-classes"],
    unchecked: ["undeclared-personal-name", "postal-address", "free-text-detail-that-identifies-by-context"],
    representations: ["as-written", "percent-decoded", "entity-decoded"],
  },
  statement:
    "payload may be treated as tier three (from four); vault stays restricted; reasons: pseudonymised-natural-person, bounded-scan-coverage",
};

/** Tokenised prose: the direct identifiers are already tags. */
const TOKENISED = "Step one: <person:1> opens the ticket and notifies <org:1>. Step two: <person:2> approves.";

const WORKFLOW = {
  task: "studio.workflow.summarise",
  text: [{ key: "workflow", text: TOKENISED, assessment: REPORT }],
};

describe("the one door", () => {
  it("a text fact cannot be written into `facts` at all", () => {
    const result = buildEnvelope({ task: "kb.question", facts: { question: { kind: "text", value: TOKENISED } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("text-must-use-the-pseudonymised-channel");
  });

  it("the text channel only accepts keys whose policy kind is `text`", () => {
    const result = buildEnvelope({
      task: "studio.workflow.summarise",
      text: [{ key: "fieldCount", text: TOKENISED, assessment: REPORT }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("text-key-is-not-a-text-key");
  });
});

describe("the coverage report is REQUIRED, and it is evidence, not a formality", () => {
  it("refuses text with no report", () => {
    const result = buildEnvelope({ task: "studio.workflow.summarise", text: [{ key: "workflow", text: TOKENISED }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("text-missing-coverage-report");
    expect(result.failures[0]?.expected).toContain("assessTier");
  });

  it("refuses a report that cannot be read, field by field", () => {
    const broken: unknown[] = [
      { ...REPORT, coverage: { checked: [], unchecked: [] } }, // no representations
      { ...REPORT, coverage: { ...REPORT.coverage, unchecked: "none" } },
      { ...REPORT, payloadTier: "low" },
      { ...REPORT, payloadTier: 0 },
      { ...REPORT, reduced: "yes" },
      { ...REPORT, statement: 42 },
      "assessed, honestly",
    ];
    for (const assessment of broken) {
      const result = buildEnvelope({ task: "studio.workflow.summarise", text: [{ key: "workflow", text: TOKENISED, assessment }] });
      expect(result.ok, `${JSON.stringify(assessment)} was accepted as a report`).toBe(false);
      if (!result.ok) expect(result.failures[0]?.code).toBe("text-coverage-report-malformed");
    }
  });

  it("refuses RESTRICTED text outright — a human approval does not un-restrict it", () => {
    const result = buildEnvelope({
      task: "studio.workflow.summarise",
      text: [{ key: "workflow", text: TOKENISED, assessment: { ...REPORT, payloadTier: 4, reduced: false } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("text-payload-tier-restricted");
  });
});

describe("the envelope re-proves the text itself", () => {
  it("⭐ refuses text the pseudonymiser said was fine but the host's scanner still matches", () => {
    // Belt and braces, and this is the braces. The report says tier 3 and
    // `reduced: true`; the text has an IBAN and an email in it. "I scrubbed
    // it" is a lie a function can tell itself.
    const result = buildEnvelope({
      task: "studio.workflow.summarise",
      text: [
        {
          key: "workflow",
          text: "Step one: mail e.musterfrau@example.de, iban DE89370400440532013000.",
          assessment: REPORT,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("text-residual-pii");
    // Class NAMES are compiled-in and are the only thing a human can act on.
    expect(result.failures[0]?.expected).toBe("email+iban");
    expect(JSON.stringify(result)).not.toContain("musterfrau");
    expect(JSON.stringify(result)).not.toContain("DE89");
  });

  it("refuses text over the host's character cap, and counts text facts", () => {
    const long = buildEnvelope({
      task: "studio.workflow.summarise",
      text: [{ key: "workflow", text: "a".repeat(MAX_TEXT_CHARS + 1), assessment: REPORT }],
    });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.failures[0]?.expected).toBe(String(MAX_TEXT_CHARS));

    const three = buildEnvelope({
      task: "studio.workflow.summarise",
      text: [
        { key: "workflow", text: TOKENISED, assessment: REPORT },
        { key: "question", text: TOKENISED, assessment: REPORT },
        { key: "context", text: TOKENISED, assessment: REPORT },
      ],
    });
    expect(three.ok).toBe(false);
    if (!three.ok) expect(three.failures.map((f) => f.code)).toEqual(["too-many-text-facts"]);
  });
});

describe("⭐ a bounded text fact is NOT as safe as a fieldName fact, and says so", () => {
  it("builds — and is never `ready`", () => {
    const result = buildEnvelope(WORKFLOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disposition).toBe("requires-human-approval");
    expect(result.approvalReasons).toContain(APPROVAL_REASON_CODES.boundedText);
    expect(result.approvalReasons).toContain(APPROVAL_REASON_CODES.partialCoverage);
  });

  it("carries the pseudonymiser's LIMITS on the fact itself", () => {
    const result = buildEnvelope(WORKFLOW);
    if (!result.ok) throw new Error("expected an envelope");
    const fact = result.facts["workflow"];
    expect(fact?.kind).toBe("text");
    if (fact?.kind !== "text") return;
    expect(fact.provenance.basis).toBe("pseudonymised");
    expect(fact.provenance.by).toBe("packages/pseudonym");
    expect(fact.provenance.unchecked).toEqual(REPORT.coverage.unchecked);
    expect(fact.provenance.vaultTier).toBe(4);
    expect(fact.provenance.statement).toBe(REPORT.statement);
    // And the envelope's own assurance absorbed them: the limits of the
    // evidence are the limits of the envelope.
    for (const klass of REPORT.coverage.unchecked) expect(result.assurance.notChecked).toContain(klass);
  });

  it("⭐ NO REPORT MAKES IT SENDABLE — not a perfect one, not a reduced one", () => {
    // The temptation this case exists to refuse: "coverage was complete, tier
    // came down, so send it". There is no such thing as complete coverage of
    // free prose for personal names, and a control that accepts the claim has
    // certified rather than refused.
    const optimistic: CoverageReportLike[] = [
      { ...REPORT, payloadTier: 2 },
      { ...REPORT, payloadTier: 1, reduced: true },
      { ...REPORT, coverage: { ...REPORT.coverage, unchecked: [] } },
      { ...REPORT, payloadTier: 2, coverage: { ...REPORT.coverage, unchecked: [] }, statement: "clean" },
    ];
    for (const assessment of optimistic) {
      const result = buildEnvelope({ task: "studio.workflow.summarise", text: [{ key: "workflow", text: TOKENISED, assessment }] });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.disposition, `${JSON.stringify(assessment)} produced a sendable envelope`).toBe(
        "requires-human-approval",
      );
      expect(result.approvalReasons).toContain(APPROVAL_REASON_CODES.boundedText);
    }
  });

  it("a fieldName-only envelope IS ready — the two are not treated the same", () => {
    const structured = buildEnvelope({
      task: "studio.spec.draft",
      facts: { field: { kind: "fieldName", value: "startDate" } },
    });
    expect(structured.ok && structured.disposition).toBe("ready");
  });
});

describe("the outbound gate ends this path in a human, not in an allow", () => {
  const ACTOR = { actor: "karsten.haldan" };

  it("refuses to send it, and hands back the envelope the human would approve", () => {
    const d = gateModelRequest(WORKFLOW, ACTOR);
    expect(d.decision).toBe("refuse");
    expect(d.reason).toContain("named human");
    expect(d.envelope?.disposition).toBe("requires-human-approval");
    expect(d.tier).toBe(3);
  });

  it("⭐ and an approval object still cannot open the gate", () => {
    // `GATE_POLICY["model-request"]` admits no approval path, and the rewire
    // did not quietly add one: `checkApproval` is not called in this gate at
    // all, so there is no flag to set.
    const d = gateModelRequest(WORKFLOW, {
      ...ACTOR,
      approval: { approver: "Karsten Haldan", contentHash: "whatever", at: "2026-09-20T10:00:00Z", scope: "model-request" },
    });
    expect(d.decision).toBe("refuse");
    expect(d.approval).toBeUndefined();
  });
});
