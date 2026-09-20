/**
 * ⭐ THE CHANNEL THE ALLOWLIST LEFT OPEN, CLOSED — and pinned here so it
 * cannot quietly reopen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE RED TEAM FOUND
 * ─────────────────────────────────────────────────────────────────────────
 * `allowlists.ts` closed `facts`, and its header says so: "THERE IS NO
 * FREE-FORM PAYLOAD, SO THERE IS NOTHING TO NEST JSON INTO". That was true of
 * `facts` and false of the thing travelling beside it. `text[].assessment` —
 * the pseudonymiser's coverage report — was checked for SHAPE and then copied
 * VERBATIM into `TextProvenance`, which is inside `facts`, which is inside
 * `envelope.wire`. So:
 *
 *   - the five-times-nested `JSON.stringify` record built `ok: true` and
 *     appeared on the wire, through `coverage.unchecked`;
 *   - a 20,000-character `statement` built `ok: true` at 20,320 bytes — ten
 *     times the `MAX_TEXT_CHARS` the channel advertises;
 *   - regex-evading German prose naming a person, an address and a disability
 *     rode it untouched, defended by nothing but `assertNoResidualPii`;
 *   - and on a REFUSAL, the same caller strings landed in `assurance.
 *     notChecked` and `assurance.statement`, documented as "compiled-in words
 *     and counts only" and as naming keys and codes "never by value".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE EVERY CASE BELOW IS AN INSTANCE OF
 * ─────────────────────────────────────────────────────────────────────────
 *     IF A CALLER CAN AUTHOR THE BYTES, THEY DO NOT GO ON THE WIRE UNLESS
 *     THEY ARE A MEMBER OF A COMPILED-IN SET.
 *
 * "We scan it afterwards" is the thing this package exists to stop relying
 * on. The last case in this file is the general form: it walks the whole
 * serialised envelope and asserts every string in the provenance is a member
 * of a compiled-in vocabulary — so an encoding nobody has thought of is
 * refused for the same reason `"hello"` is.
 *
 * All fixtures fictional.
 */

import { describe, expect, it } from "vitest";
import { buildEnvelope } from "../build";
import { COUNT_CHANNEL_BITS, SELECTION_CHANNEL_BITS } from "../build";
import {
  COUNT_LADDER,
  FACT_KEY_POLICY,
  MAX_COUNT_FACTS,
  MAX_ENUM_FACTS,
  MAX_TEXT_CHARS,
  VOCABULARIES,
} from "../allowlists";
import {
  COVERAGE_CLASS_VOCABULARY,
  COVERAGE_DETECTOR_VOCABULARY,
  COVERAGE_REPRESENTATION_VOCABULARY,
  MAX_COVERAGE_ENTRIES,
  MAX_PROVENANCE_CHARS,
  PROVENANCE_STATEMENT_CODES,
} from "../coverage";
import { gateModelRequest } from "../../../guardrails/src/gates";
import type { CoverageReportLike } from "../types";

const TOKENISED = "Step one: <person:1> opens the ticket and notifies <org:1>.";

/** A well-formed report: every string in it is a compiled-in constant of
 * `packages/pseudonym`, which is now the only kind this channel admits. */
const REPORT: CoverageReportLike = {
  payloadTier: 3,
  vaultTier: 4,
  reduced: true,
  coverage: {
    checked: ["quasi-identifier-signal-words", "name-shaped-span", "vault-entry-classes"],
    unchecked: ["undeclared-personal-name", "postal-address"],
    representations: ["as-written", "percent-decoded", "html-entity-decoded"],
  },
  statement: "payload may be treated as tier three (from four); vault stays restricted",
};

function workflow(assessment: unknown, text: string = TOKENISED): unknown {
  return { task: "studio.workflow.summarise", text: [{ key: "workflow", text, assessment }] };
}

/** The whole result, serialised — wire, assurance, failures and all. The
 * refusals are as much of the blast radius as the successes: an audit body
 * and a 422 body are built from these. */
function everything(result: unknown): string {
  return JSON.stringify(result);
}

// ─────────────────────────────────────────────────────────────────────────

describe("⭐ the nested-stringify record has nowhere to live in the METADATA either", () => {
  const RECORD = { employeeSalary: 92000, owner: "Anna Müller" };
  const nested = (() => {
    let s = JSON.stringify(RECORD);
    for (let i = 1; i < 5; i += 1) s = JSON.stringify(s);
    return s;
  })();
  const SECRETS = ["employeeSalary", "92000", "Anna", "Müller"] as const;

  const routes: ReadonlyArray<readonly [string, unknown]> = [
    ["through coverage.unchecked", workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: [nested] } })],
    ["through coverage.checked", workflow({ ...REPORT, coverage: { ...REPORT.coverage, checked: [nested] } })],
    [
      "through coverage.representations",
      workflow({ ...REPORT, coverage: { ...REPORT.coverage, representations: [nested] } }),
    ],
    ["appended to a legal class list", workflow({
      ...REPORT,
      coverage: { ...REPORT.coverage, unchecked: ["undeclared-personal-name", nested] },
    })],
  ];

  it.each(routes)("refuses it %s — by membership, not by recognition", (_route, input) => {
    const result = buildEnvelope(input);
    expect(result.ok, "an unallowlisted string reached the provenance").toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.code)).toEqual([
      expect.stringMatching(/^text-(coverage-(class|detector)|representation)-not-in-vocabulary$/) as unknown as string,
    ]);
  });

  it.each(routes)("and nothing of it survives anywhere in the result %s", (_route, input) => {
    const serialised = everything(buildEnvelope(input));
    for (const secret of SECRETS) {
      expect(serialised, `"${secret}" reached the envelope's own output`).not.toContain(secret);
    }
  });

  it("refuses the INNOCUOUS unlisted class identically — refusal is the default, not an alarm", () => {
    // The property that makes the cases above hold for encodings nobody has
    // thought of: nothing recognised the record, and nothing had to.
    const innocuous = buildEnvelope(workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: ["postcode"] } }));
    const dangerous = buildEnvelope(workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: [nested] } }));
    expect(innocuous.ok).toBe(false);
    expect(dangerous.ok).toBe(false);
    if (innocuous.ok || dangerous.ok) return;
    expect(innocuous.failures.map((f) => f.code)).toEqual(dangerous.failures.map((f) => f.code));
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("⭐ `statement` is not a channel any more, because it does not travel", () => {
  const LONG = "Anna Müller, Hauptstrasse 5, Berlin. ".repeat(600); // ~22,000 chars

  it("a 20,000-character statement does not put 20,000 characters on the wire", () => {
    const result = buildEnvelope(workflow({ ...REPORT, statement: LONG }));
    // The report is still well-formed, so this BUILDS — and it builds small.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wire).not.toContain("Hauptstrasse");
    expect(result.wire).not.toContain("Anna");
    // The bound the channel advertises now actually bounds it: text plus
    // provenance, not text alone. Before this, `bytes` was 20,320.
    expect(result.bytes).toBeLessThan(MAX_TEXT_CHARS + MAX_PROVENANCE_CHARS);
  });

  it("nor does a nested-stringify statement, nor a statement claiming the payload is clean", () => {
    for (const statement of [JSON.stringify(JSON.stringify({ iban: "DE02120300000000202051" })), "verified clean"]) {
      const result = buildEnvelope(workflow({ ...REPORT, statement }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(everything(result)).not.toContain("202051");
      expect(everything(result)).not.toContain("verified clean");
    }
  });

  it("what travels instead is one of four compiled-in codes, derived here", () => {
    const cases: ReadonlyArray<readonly [boolean, readonly string[], string]> = [
      [true, ["undeclared-personal-name"], "pseudonymised-reduced-coverage-partial"],
      [true, [], "pseudonymised-reduced-coverage-claimed-complete"],
      [false, ["undeclared-personal-name"], "pseudonymised-not-reduced-coverage-partial"],
      [false, [], "pseudonymised-not-reduced-coverage-claimed-complete"],
    ];
    for (const [reduced, unchecked, code] of cases) {
      const result = buildEnvelope(workflow({ ...REPORT, reduced, coverage: { ...REPORT.coverage, unchecked } }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const fact = result.facts["workflow"];
      expect(fact?.kind).toBe("text");
      if (fact?.kind !== "text") continue;
      expect(fact.provenance.statementCode).toBe(code);
      expect(PROVENANCE_STATEMENT_CODES).toContain(fact.provenance.statementCode);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("⭐ regex-evading prose is refused by membership, not by the scanner", () => {
  // Not one of the host's five classes matches this: no @, no IBAN shape, no
  // seven-digit run, no currency symbol, no ISO date. Under the old code its
  // ONLY guard was `assertNoResidualPii` over `JSON.stringify(facts)` — the
  // unbounded scanner this package exists to replace — and it passed.
  const PROSE = "Anna Mueller wohnt Hauptstrasse fuenf Berlin, schwerbehindert, Gehalt sechsstellig";

  it("refuses it through coverage.unchecked", () => {
    const result = buildEnvelope(workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: [PROSE] } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("text-coverage-class-not-in-vocabulary");
  });

  it("and the refusal does not quote it — not in a failure, not in the assurance", () => {
    const serialised = everything(
      buildEnvelope(workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: [PROSE] } })),
    );
    for (const word of ["Anna", "Mueller", "Hauptstrasse", "schwerbehindert", "sechsstellig"]) {
      expect(serialised, `"${word}" reached the refusal`).not.toContain(word);
    }
  });

  it("⭐ the host scanner is NOT what catches it — the membership check runs first and alone", () => {
    // Stated as a comparison rather than as prose: the scanner finds nothing
    // in this string, and the envelope refuses it anyway.
    const findings = PROSE.match(/[@€]/g) ?? [];
    expect(findings).toEqual([]);
    expect(buildEnvelope(workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: [PROSE] } })).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("⭐ the loggable Assurance is compiled-in words, on REFUSALS too", () => {
  const POISON = "Anna Müller salary 92000 EUR DE02120300000000202051";

  it("a request refused for an unrelated reason does not come back carrying caller strings", () => {
    // The exact shape found: `extraUnchecked` was pushed BEFORE the later
    // checks ran, so a request refused for `key-not-in-policy` still returned
    // the caller's prose in `assurance.notChecked` AND in
    // `assurance.statement` — "One line, safe to log".
    const result = buildEnvelope({
      task: "studio.workflow.summarise",
      facts: { salary_of_Anna_Mueller_92000: { kind: "count", value: 1 } },
      text: [{ key: "workflow", text: TOKENISED, assessment: { ...REPORT, coverage: { ...REPORT.coverage, unchecked: [POISON] } } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.assurance.notChecked.join(" ")).not.toContain("Müller");
    expect(result.assurance.statement).not.toContain("Müller");
    expect(result.assurance.statement).not.toContain("202051");
    expect(everything(result)).not.toContain("92000");
  });

  it("every class in `notChecked` is a member of a compiled-in vocabulary, on every outcome", () => {
    const results = [
      buildEnvelope(workflow(REPORT)),
      buildEnvelope({ task: "kb.question", facts: { docCount: { kind: "count", value: 3 } } }),
      buildEnvelope({ task: "draft", facts: {} }),
      buildEnvelope(workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: [POISON] } })),
    ];
    for (const result of results) {
      const assurance = "assurance" in result ? result.assurance : null;
      expect(assurance).not.toBeNull();
      for (const klass of assurance?.notChecked ?? []) {
        expect(COVERAGE_CLASS_VOCABULARY, `"${klass}" is not in the compiled-in class vocabulary`).toContain(klass);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("the rest of the report is constrained the same way", () => {
  it("refuses a vaultTier that is not 4 — the field is documented as always 4", () => {
    for (const vaultTier of [1, 3, 4.7, -5, 1e308, "4"]) {
      const result = buildEnvelope(workflow({ ...REPORT, vaultTier }));
      expect(result.ok, `vaultTier ${String(vaultTier)} was accepted`).toBe(false);
      if (!result.ok) expect(result.failures[0]?.code).toBe("text-coverage-report-malformed");
    }
  });

  it("refuses a representation name the pseudonymiser has never produced", () => {
    // "entity-decoded" is the near-miss: the real constant is
    // `html-entity-decoded`. A near-miss is admitted by a shape check and
    // refused by a membership check, which is the whole difference.
    const result = buildEnvelope(
      workflow({ ...REPORT, coverage: { ...REPORT.coverage, representations: ["entity-decoded"] } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("text-representation-not-in-vocabulary");
  });

  it("refuses a detector name that is not in the compiled-in list", () => {
    const result = buildEnvelope(
      workflow({ ...REPORT, coverage: { ...REPORT.coverage, checked: ["everything-obviously"] } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0]?.code).toBe("text-coverage-detector-not-in-vocabulary");
  });

  it("refuses a report that pads a legal list past MAX_COVERAGE_ENTRIES", () => {
    const padded = Array.from({ length: MAX_COVERAGE_ENTRIES + 1 }, () => "undeclared-personal-name");
    const result = buildEnvelope(workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: padded } }));
    expect(result.ok).toBe(false);
  });

  it("deduplicates what it admits, so a legal list cannot be a length channel", () => {
    const repeated = Array.from({ length: 20 }, () => "postal-address");
    const result = buildEnvelope(workflow({ ...REPORT, coverage: { ...REPORT.coverage, unchecked: repeated } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.facts["workflow"];
    if (fact?.kind !== "text") throw new Error("expected a text fact");
    expect(fact.provenance.unchecked).toEqual(["postal-address"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("⭐ THE GENERAL FORM: every string on the wire is a compiled-in constant", () => {
  it("walks the built provenance and finds nothing the caller could have authored", () => {
    const result = buildEnvelope(workflow(REPORT));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.facts["workflow"];
    if (fact?.kind !== "text") throw new Error("expected a text fact");
    const p = fact.provenance;

    expect(p.basis).toBe("pseudonymised");
    expect(p.by).toBe("packages/pseudonym");
    expect(p.vaultTier).toBe(4);
    expect([1, 2, 3, 4]).toContain(p.payloadTier);
    expect(PROVENANCE_STATEMENT_CODES).toContain(p.statementCode);
    for (const klass of p.unchecked) expect(COVERAGE_CLASS_VOCABULARY).toContain(klass);
    for (const detector of p.checked) expect(COVERAGE_DETECTOR_VOCABULARY).toContain(detector);
    for (const name of p.representations) expect(COVERAGE_REPRESENTATION_VOCABULARY).toContain(name);

    // The one string on the wire that is NOT compiled in is the bounded text
    // fact itself — which is the honest hard part this package has always
    // named, and it is why this envelope can never be `ready`.
    expect(result.disposition).toBe("requires-human-approval");
    const strings = [...JSON.stringify(p).matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? "");
    const vocabulary = new Set<string>([
      ...COVERAGE_CLASS_VOCABULARY,
      ...COVERAGE_DETECTOR_VOCABULARY,
      ...COVERAGE_REPRESENTATION_VOCABULARY,
      ...PROVENANCE_STATEMENT_CODES,
      "pseudonymised",
      "packages/pseudonym",
      "basis",
      "by",
      "payloadTier",
      "vaultTier",
      "checked",
      "unchecked",
      "representations",
      "statementCode",
    ]);
    for (const s of strings) {
      expect(vocabulary.has(s), `"${s}" is on the wire and is not a compiled-in constant`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("⭐ a count is not a value channel", () => {
  it("does not carry a birth year, a monthly gross or an IBAN tail intact", () => {
    // All three are under `docCount`'s ceiling of 10,000 and all three used to
    // arrive unchanged: "a ceiling alone cannot tell 4,200 documents from a
    // €4,200 monthly gross" is true of a ceiling and false of a rung.
    for (const smuggled of [1985, 4200, 2051, 1972, 9999]) {
      const result = buildEnvelope({ task: "kb.question", facts: { docCount: { kind: "count", value: smuggled } } });
      expect(result.ok, `docCount ${smuggled} was refused — the ladder must not narrow what the host allows`).toBe(true);
      if (!result.ok) continue;
      expect(result.wire, `${smuggled} survived onto the wire`).not.toContain(String(smuggled));
      const fact = result.facts["docCount"];
      if (fact?.kind !== "count") throw new Error("expected a count fact");
      expect(COUNT_LADDER).toContain(fact.value);
      // Snapped UP: the transmitted number is an upper bound on the caller's.
      expect(fact.value).toBeGreaterThanOrEqual(smuggled);
    }
  });

  it("leaves small counts exactly alone — a spec with 12 fields is 12", () => {
    for (const n of [0, 1, 3, 6, 12, 16]) {
      const result = buildEnvelope({ task: "kb.question", facts: { fieldCount: { kind: "count", value: n } } });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const fact = result.facts["fieldCount"];
      expect(fact?.kind === "count" && fact.value).toBe(n);
    }
  });

  it("snapping can never climb past the key's own ceiling", () => {
    // `gatewayCount` tops out at 500 and 480 snaps to 500, not past it. The
    // load-time check in `allowlists.ts` is what makes this true for every
    // key rather than for the one this case happens to try.
    const result = buildEnvelope({ task: "kb.question", facts: { gatewayCount: { kind: "count", value: 480 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.facts["gatewayCount"];
    expect(fact?.kind === "count" && fact.value).toBe(500);
  });

  it(`refuses more than ${MAX_COUNT_FACTS} counts in one request — the bound is on the REQUEST`, () => {
    const facts: Record<string, unknown> = {};
    for (const key of ["nodeCount", "edgeCount", "laneCount", "gatewayCount", "fieldCount"]) {
      facts[key] = { kind: "count", value: 7 };
    }
    const result = buildEnvelope({ task: "kb.question", facts });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.code)).toContain("too-many-count-facts");
  });

  it("states the residual capacity it did NOT close, measured from the tables", () => {
    const result = buildEnvelope({ task: "kb.question", facts: { docCount: { kind: "count", value: 3 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ⚠ A control may refuse; it may never certify. The choice of rung is
    // still a channel and the assurance says so with a number.
    //
    // ⭐ THE NUMBER MUST COVER THE WHOLE REQUEST, NOT ONE CHANNEL. This line
    // asserted `COUNT_CHANNEL_BITS` while the enum and fieldName channels rode
    // beside it unmeasured — the statement was quoting 21 while one `ready`
    // envelope carried ~107. Asserting the RELATIONSHIP rather than a constant
    // is what makes a future third channel fail this test instead of quietly
    // widening the gap between what is stated and what is carried.
    expect(result.assurance.statement).toContain(`about ${SELECTION_CHANNEL_BITS} bits per request`);
    expect(SELECTION_CHANNEL_BITS).toBeGreaterThanOrEqual(COUNT_CHANNEL_BITS);
    expect(result.assurance.notChecked).toContain("information-encoded-in-the-choice-of-bounded-integers");
    expect(result.assurance.notChecked).toContain("information-encoded-in-the-choice-of-vocabulary-members");
    expect(result.assurance.notChecked).toContain("information-encoded-in-the-choice-of-field-names");
    // The figure the red team measured before the ladder was ~146 bits.
    expect(COUNT_CHANNEL_BITS).toBeLessThan(40);
    expect(SELECTION_CHANNEL_BITS).toBeLessThan(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe("⭐ the audit subject is not a free-text channel one layer up", () => {
  const ACTOR = { actor: "karsten.haldan" };

  it("does not echo the caller's `id` into the append-only chain", () => {
    // `salary_of_Anna_Mueller_92000` matches `subjectOf`'s sanitiser
    // perfectly — it is identifier-shaped, and it is the exact case the
    // host's FACT_KEY_POLICY exists to close, one layer above the envelope.
    const d = gateModelRequest(
      { id: "salary_of_Anna_Mueller_92000", task: "kb.question", facts: {} },
      ACTOR,
    );
    expect(d.decision).toBe("refuse");
    expect(d.audit.subject).toBe("<model-request>");
    expect(JSON.stringify(d.audit)).not.toContain("Anna");
    expect(JSON.stringify(d.audit)).not.toContain("92000");
    expect(JSON.stringify(d)).not.toContain("Mueller");
  });

  it("does not echo it on the ALLOW path either", () => {
    const d = gateModelRequest(
      { task: "studio.spec.draft", facts: { field: { kind: "fieldName", value: "startDate" } } },
      ACTOR,
    );
    expect(d.decision).toBe("allow");
    expect(d.audit.subject).toBe("<model-request>");
  });

  it("still correlates: the content hash is on every decision", () => {
    const a = gateModelRequest({ task: "kb.question", facts: { docCount: { kind: "count", value: 1 } } }, ACTOR);
    const b = gateModelRequest({ task: "kb.question", facts: { docCount: { kind: "count", value: 2 } } }, ACTOR);
    expect(a.audit.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.audit.contentHash).not.toBe(b.audit.contentHash);
  });
});

// ─────────────────────────────────────────────────────────────────────────

/**
 * ⭐ THE SELECTION CHANNEL, found by the red team AFTER the count ladder went
 * in and reproduced here before it was fixed.
 *
 * `build.ts` resolved the vocabulary the CALLER declared, not the key's own,
 * while the refusal message already read `the vocabulary named "${key}"`. The
 * message had been made honest and the check had not — which is the same shape
 * as every other finding this session: a control that reads as though it ran.
 */
describe("⭐ an enum fact is pinned to ITS key's vocabulary", () => {
  it("refuses a member of a FOREIGN vocabulary — the reproduction, verbatim", () => {
    // Measured before the fix: ok=true, disposition "ready", no human.
    const result = buildEnvelope({
      task: "studio.spec.draft",
      facts: { country: { kind: "enum", vocabulary: "lifecycleStage", value: "progress" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.code)).toContain("unknown-vocabulary");
    // and the caller's declared name is not echoed back
    expect(JSON.stringify(result)).not.toContain("lifecycleStage");
  });

  it("refuses a foreign MEMBER even when the declared name is right", () => {
    const result = buildEnvelope({
      task: "studio.spec.draft",
      facts: { country: { kind: "enum", vocabulary: "country", value: "progress" } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.code)).toContain("value-not-in-vocabulary");
  });

  it("still builds the honest request, and writes the COMPILED-IN name on the wire", () => {
    const result = buildEnvelope({
      task: "studio.spec.draft",
      facts: { country: { kind: "enum", vocabulary: "country", value: "DE" } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fact = result.facts["country"];
    expect(fact).toEqual({ kind: "enum", vocabulary: "country", value: "DE" });
  });

  it("omitting `vocabulary` entirely is fine — the key already says which one", () => {
    const result = buildEnvelope({
      task: "studio.spec.draft",
      facts: { country: { kind: "enum", value: "DE" } },
    });
    expect(result.ok).toBe(true);
  });

  it("⭐ a key whose alphabet has one member carries ZERO bits, which is the point", () => {
    // `country` has exactly one member. Unpinned it was a choice among 49.
    expect(VOCABULARIES["country"]).toHaveLength(1);
    const perKeyBits = Object.entries(FACT_KEY_POLICY)
      .filter(([, p]) => p.kind === "enum")
      .map(([k]) => Math.log2(VOCABULARIES[k]?.length ?? 1));
    // No enum key may carry more than its own vocabulary allows.
    for (const bits of perKeyBits) expect(bits).toBeLessThanOrEqual(Math.log2(6));
  });

  it("caps how many selections travel together, as the count channel already did", () => {
    const enumKeys = Object.entries(FACT_KEY_POLICY)
      .filter(([, p]) => p.kind === "enum")
      .map(([k]) => k);
    expect(enumKeys.length).toBeGreaterThan(MAX_ENUM_FACTS); // else the cap is vacuous
    const facts: Record<string, unknown> = {};
    for (const key of enumKeys.slice(0, MAX_ENUM_FACTS + 1)) {
      facts[key] = { kind: "enum", value: VOCABULARIES[key]![0] };
    }
    const result = buildEnvelope({ task: "studio.spec.draft", facts });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.code)).toContain("too-many-enum-facts");
  });
});
