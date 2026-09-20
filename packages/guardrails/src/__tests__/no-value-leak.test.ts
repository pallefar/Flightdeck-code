/**
 * ⭐ THE FINDING NEVER CARRIES THE THING IT CAUGHT.
 *
 * The host's rule, from `envelope.ts` directly above `PII_PATTERNS`:
 *
 *     "Findings are reported by NAME only — never the matched text — so an
 *      audit event, a log line and a 422 body can all say what tripped without
 *      reproducing the thing that tripped it."
 *
 * A guardrail that logs the secret it caught has not protected the secret; it
 * has copied it into the most widely-read, most replicated, most append-only
 * artefact in the system. The audit chain is literally designed never to be
 * rewritten (`flightdeckAudit.ts`: "there is no code path that rewrites this
 * file"), so a value that reaches it cannot be taken back out.
 *
 * This file asserts the property against the SERIALISED output of every
 * public surface — not against the intent of the code. The distinction
 * matters: the leak that actually happens is a `where` path echoing an object
 * key, or a `reason` string helpfully interpolating what it found, and both of
 * those look fine in review.
 */

import { describe, expect, it } from "vitest";
import { FINDING_CLASSES, classify } from "../classify";
import { classifyMarkdown } from "../markdown";
import {
  gateGeneratedArtifacts,
  gateModelRequest,
  gateRegistration,
  gateWorkflowIntake,
} from "../gates";
import {
  BUSINESS_SEGMENTS,
  PII_DENIED_SEGMENTS,
  PII_DENIED_SUBSTRINGS,
  PII_PATTERN_NAMES,
  SPECIAL_CATEGORY_SEGMENTS,
  SPECIAL_CATEGORY_SUBSTRINGS,
  STUDIO_PERSONAL_TOKENS,
  STUDIO_RESTRICTED_SUBSTRINGS,
  STUDIO_RESTRICTED_TOKENS,
} from "../lists";
import { RECORDING_PROVENANCE_TOKENS } from "../markdown";

/** Fictional, and deliberately distinctive: if any of these survives into a
 * finding, an indexOf will find it. */
const SECRETS = {
  email: "e.musterfrau@example.de",
  iban: "DE89370400440532013000",
  phone: "0170 1234567",
  amount: "€82.000",
  dob: "12.04.1987",
  fullName: "Erika Musterfrau",
  surname: "Musterfrau",
  note: "diagnosed 2019-03-02, works reduced hours",
} as const;

const PAYLOAD = {
  // A person's name used as an OBJECT KEY — the shape that turns a path into
  // a disclosure.
  [SECRETS.fullName]: {
    person: { surname: SECRETS.surname, email: SECRETS.email },
    bankaccount: { iban: SECRETS.iban },
    contact: { phone: SECRETS.phone },
    offer: { salaryEur: SECRETS.amount, startDate: SECRETS.dob },
    health: { note: SECRETS.note },
  },
};

const MARKDOWN = [
  "# Onboarding workflow",
  "",
  `**Employee:** ${SECRETS.fullName}`,
  `**Email:** ${SECRETS.email}`,
  `**Salary:** ${SECRETS.amount}`,
  `**IBAN:** ${SECRETS.iban}`,
  `**Date of birth:** ${SECRETS.dob}`,
  "",
  `Notes from the screen recording: ${SECRETS.note}`,
].join("\n");

const FILES = [
  { path: `fixtures/${SECRETS.email}.seed.json`, content: JSON.stringify(PAYLOAD) },
  { path: "src/routes.ts", content: `const example = ${JSON.stringify(PAYLOAD)};` },
];

const CTX = { actor: "karsten.haldan", declaredNames: [SECRETS.fullName] };

function assertNoSecrets(label: string, serialised: string): void {
  for (const [name, value] of Object.entries(SECRETS)) {
    expect(
      serialised.includes(value),
      `${label} LEAKED the ${name} it caught. A finding names the class and the place, never the value.`,
    ).toBe(false);
  }
  // The initials the host's recipe reduces a declared name to are fine; the
  // name is not.
  expect(serialised.includes("Musterfrau")).toBe(false);
}

describe("classify", () => {
  it("serialises with no matched value in it", () => {
    const r = classify(PAYLOAD, { declaredNames: [SECRETS.fullName] });
    expect(r.tier).toBe(4);
    expect(r.findings.length).toBeGreaterThan(5);
    assertNoSecrets("classify().findings", JSON.stringify(r.findings));
  });

  it("does not echo a person's name used as an object key", () => {
    const r = classify(PAYLOAD, { declaredNames: [SECRETS.fullName] });
    const wheres = r.findings.map((f) => f.where).join(" ");
    expect(wheres).not.toContain("Erika");
    // Declared, so it is reduced by the host's own recipe rather than dropped.
    expect(wheres).toContain("E. M.");
  });

  it("reports an UNDECLARED name positionally rather than verbatim", () => {
    const r = classify(PAYLOAD); // no declaredNames this time
    const wheres = r.findings.map((f) => f.where).join(" ");
    expect(wheres).not.toContain("Erika");
    expect(wheres).not.toContain("Musterfrau");
    expect(wheres).toContain("<key#0>");
  });
});

describe("classifyMarkdown", () => {
  it("reports line numbers, not label text", () => {
    const findings = classifyMarkdown(MARKDOWN);
    expect(findings.length).toBeGreaterThan(3);
    assertNoSecrets("classifyMarkdown()", JSON.stringify(findings));
    expect(findings.some((f) => f.where.includes("line "))).toBe(true);
  });
});

describe("every gate — decision, reason and audit body", () => {
  const decisions = {
    registration: gateRegistration(PAYLOAD, CTX),
    modelRequest: gateModelRequest(PAYLOAD, CTX, { onTier4: "redact" }),
    workflowIntake: gateWorkflowIntake(MARKDOWN, CTX),
    generatedArtifacts: gateGeneratedArtifacts(FILES, CTX),
  };

  for (const [name, decision] of Object.entries(decisions)) {
    it(`${name}: the whole decision serialises clean`, () => {
      assertNoSecrets(`${name} decision`, JSON.stringify(decision));
    });

    it(`${name}: the audit body serialises clean`, () => {
      assertNoSecrets(`${name} audit body`, JSON.stringify(decision.audit));
    });

    it(`${name}: the reason is a constant phrase with nothing interpolated`, () => {
      assertNoSecrets(`${name} reason`, decision.reason);
      expect(decision.reason).not.toMatch(/[@€]/);
    });
  }

  it("a redacted payload is the ONLY place data may appear, and it is scrubbed", () => {
    const d = gateModelRequest(PAYLOAD, CTX, { onTier4: "redact", onTier3: "redact" });
    // Whether it allows or refuses, no raw secret may sit in the payload it
    // would hand back.
    const payload = JSON.stringify(d.redactedPayload ?? null);
    assertNoSecrets("redactedPayload", payload);
  });
});

describe("a finding's `class` is drawn from a compiled-in vocabulary", () => {
  it("FINDING_CLASSES is the whole vocabulary, not a hand-kept subset of it", () => {
    // The set used to be assembled here, by hand, from whichever lists this
    // file happened to import. A vocabulary that grows in `lists.ts` and not
    // here does not make this test fail — it makes it stop checking, quietly,
    // which is the shape of every defect in this package's history. So the
    // package exports ONE vocabulary and this case asserts it covers every
    // list rather than rebuilding it.
    const known = new Set(FINDING_CLASSES);
    for (const [label, list] of [
      ["PII_PATTERN_NAMES", PII_PATTERN_NAMES],
      ["PII_DENIED_SEGMENTS", PII_DENIED_SEGMENTS],
      ["PII_DENIED_SUBSTRINGS", PII_DENIED_SUBSTRINGS],
      ["SPECIAL_CATEGORY_SEGMENTS", SPECIAL_CATEGORY_SEGMENTS],
      ["SPECIAL_CATEGORY_SUBSTRINGS", SPECIAL_CATEGORY_SUBSTRINGS],
      ["BUSINESS_SEGMENTS", BUSINESS_SEGMENTS],
      ["STUDIO_RESTRICTED_SUBSTRINGS", STUDIO_RESTRICTED_SUBSTRINGS],
      ["STUDIO_RESTRICTED_TOKENS", STUDIO_RESTRICTED_TOKENS],
      ["STUDIO_PERSONAL_TOKENS", STUDIO_PERSONAL_TOKENS],
    ] as const) {
      for (const token of list) {
        expect(known.has(token), `${label} entry "${token}" is missing from FINDING_CLASSES`).toBe(true);
      }
    }
    for (const token of RECORDING_PROVENANCE_TOKENS) {
      expect(known.has(`provenance:${token}`)).toBe(true);
    }
  });

  it("never invents a class name from the data", () => {
    const known = new Set<string>(FINDING_CLASSES);
    const all = [
      ...classify(PAYLOAD).findings,
      ...classifyMarkdown(MARKDOWN),
      ...gateGeneratedArtifacts(FILES, CTX).findings,
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) {
      expect(known.has(f.class), `"${f.class}" is not in the compiled-in class vocabulary`).toBe(true);
    }
  });
});
