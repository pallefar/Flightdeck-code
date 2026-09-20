/**
 * ⭐ SEC-V5-02, THE THIRD TELLING: THE SECOND PATH IS AN ENCODING.
 *
 * `second-path.test.ts` restated the host incident as "the data is in two
 * PLACES and the guard's scope only looked at one". This file restates the
 * same defect one level up, where it actually shipped in this package: the
 * data is in two REPRESENTATIONS and the scanner only understood one.
 *
 *     classify({ employeeSalary, personName, dateOfBirth })        tier 4
 *     classify({ payload: JSON.stringify(same) })                  tier 1  ← zero findings
 *     classifyMarkdown(JSON.stringify(same))                       tier 4
 *     classifyCode(JSON.stringify(same))                           tier 4
 *
 * Same bytes. Same person. Three scanners, two verdicts, and the blind one was
 * the only scanner behind `gateRegistration` and `gateModelRequest` — the
 * outbound gate. The suite was green throughout, which is the part of
 * SEC-V5-02 that matters: passing tests were the evidence that persuaded
 * everyone the boundary was closed.
 *
 * So, as in `second-path.test.ts`, the assertions here are EQUIVALENCE
 * assertions rather than "this sample is refused". A scanner that has been
 * taught one more sample passes a sample test; only an equivalence test says
 * the sample was not the point. Every case below asks the same question:
 *
 *     does the answer depend on which way the caller wrote it down?
 *
 * The last describe block asks the opposite question, and it is not decoration
 * — a gate that fires on everything gets rubber-stamped, which is the same end
 * state as no gate. Every widening in this round has to survive it.
 *
 * All fixtures fictional; see `classify.test.ts` for why that is a rule here.
 */

import { describe, expect, it } from "vitest";
import { classify } from "../classify";
import { classifyCode, classifyMarkdown, classifyProseAndCode } from "../markdown";
import { FINDING_CLASSES } from "../classify";
import { type Tier, tierOf } from "../findings";
import { gateModelRequest, gateRegistration, gateWorkflowIntake } from "../gates";

const ACTOR = { actor: "karsten.haldan" };

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");
const classesOf = (f: readonly { class: string }[]): string[] => [...new Set(f.map((x) => x.class))].sort();

/** Three unrelated category-4 records. Nothing about the fix may depend on
 * which one is used. */
const RESTRICTED_RECORDS: readonly Record<string, unknown>[] = [
  { employeeSalary: 82000, personName: "Erika Musterfrau", dateOfBirth: "1987-04-12" },
  { offer: { salaryEur: 4200 }, applicant: { email: "e.musterfrau@example.de" } },
  { payroll: { kirchensteuer: 9 }, employee: { bankaccount: { iban: "DE89370400440532013000" } } },
];

/** Every way the same record can reach the same place. */
function tiersOfEveryRepresentation(record: Record<string, unknown>): Record<string, Tier> {
  const json = JSON.stringify(record);
  const carrier: Record<string, unknown> = { note: "nothing to see here" };
  Object.defineProperty(carrier, "hidden", { value: record, enumerable: false, configurable: true });
  return {
    structured: classify(record).tier,
    "json string in a field": classify({ payload: json }).tier,
    "json string as the whole input": classify(json).tier,
    "base64 of the json": classify({ blob: b64(json) }).tier,
    map: classify({ payload: new Map(Object.entries(record)) }).tier,
    "non-enumerable property": classify(carrier).tier,
    "prose scanner": tierOf(classifyMarkdown(json)),
    "code scanner": tierOf(classifyCode(json)),
    "both scanners": tierOf(classifyProseAndCode(json)),
  };
}

describe("⭐ one scanner, one answer, whatever the representation", () => {
  for (const [i, record] of RESTRICTED_RECORDS.entries()) {
    it(`record ${i + 1} classifies tier 4 in EVERY representation, not just the structured one`, () => {
      const tiers = tiersOfEveryRepresentation(record);
      const disagreements = Object.entries(tiers).filter(([, t]) => t !== 4);
      expect(
        disagreements,
        `these representations of the same record did not reach tier 4: ${disagreements
          .map(([k, t]) => `${k}=${t}`)
          .join(", ")}`,
      ).toEqual([]);
    });
  }

  it("⭐ reports the same CLASSES through the record and through its serialisation", () => {
    // Not just the same tier — the same disclosure, named the same way. A
    // refusal that says `salary` one way and `date` the other sends a human
    // to fix the wrong field.
    const record = RESTRICTED_RECORDS[0] as Record<string, unknown>;
    const direct = classesOf(classify(record).findings);
    const serialised = classesOf(classify({ payload: JSON.stringify(record) }).findings);
    for (const klass of direct) {
      expect(serialised, `class "${klass}" is reported for the record but not for its JSON string`).toContain(klass);
    }
  });

  it("⭐ the outbound gate refuses the serialised record, which is how a caller would actually send it", () => {
    // `gateModelRequest` is the only gate on the outbound path, and the
    // natural way to put a record in a prompt is to stringify it.
    for (const record of RESTRICTED_RECORDS) {
      expect(gateModelRequest({ task: "draft", context: JSON.stringify(record) }, ACTOR).decision).toBe("refuse");
    }
  });

  it("⭐ a record hidden behind a container Object.entries returns [] for is still walked", () => {
    // The walker's header promised "no early exit: every node of the input is
    // visited". A Map was a silent early exit; so was a non-enumerable
    // property. Both are second paths to the same data.
    const record = { employeeSalary: 82000 };
    expect(classify({ payload: new Map(Object.entries(record)) }).tier).toBe(4);
    expect(classify(new Map([["row", record]])).tier).toBe(4);
    expect(classify(new Set([record])).tier).toBe(4);
    const carrier = {};
    Object.defineProperty(carrier, "row", { value: record, enumerable: false });
    expect(classify(carrier).tier).toBe(4);
  });

  it("does not INVOKE a getter, and says so in the findings rather than silently skipping", () => {
    // Calling an arbitrary accessor inside a scanner is a side effect nobody
    // asked for. Not reading it and not saying so would be the silent skip
    // this whole round is about, so the unreadable node is a finding.
    const withGetter = {
      get secret() {
        throw new Error("a getter must not be invoked by the scanner");
      },
    };
    const r = classify({ wrap: withGetter });
    expect(r.findings.map((f) => f.class)).toContain("unscanned-accessor");
    expect(r.tier).toBeGreaterThanOrEqual(3);
  });

  it("classifies a Date and a byte array, which carry values as surely as a string does", () => {
    expect(classify({ when: new Date("1987-04-12T00:00:00Z") }).tier).toBe(3);
    expect(classify({ blob: Buffer.from("iban DE89370400440532013000", "utf8") }).tier).toBe(3);
  });
});

describe("⭐ decoding — bounded, and honest about the bound", () => {
  it("reads a percent-encoded and a base64 value as the value it is", () => {
    expect(classesOf(classify({ note: "e.musterfrau%40example.de" }).findings)).toContain("email");
    expect(classesOf(classify({ note: b64("e.musterfrau@example.de") }).findings)).toContain("email");
    expect(classesOf(classify({ blob: b64("DE89370400440532013000") }).findings)).toContain("iban");
  });

  it("reads a base64url value too — the alphabet is a spelling, not a defence", () => {
    const encoded = Buffer.from("e.musterfrau@example.de", "utf8").toString("base64url");
    expect(classesOf(classify({ q: encoded }).findings)).toContain("email");
  });

  it("⭐ STATED LIMIT: an encoding nobody implemented is NOT caught, and the test says so", () => {
    // This is the residual the brief asked to be stated rather than claimed
    // away. You cannot decode everything; a caller who reverses, compresses
    // or encrypts a record defeats every decoder this package could carry.
    // Asserting the CURRENT behaviour means the day someone believes
    // otherwise, this case is where they find out.
    const reversed = [..."DE89370400440532013000"].reverse().join("");
    expect(classify({ blob: reversed }).tier).toBe(1);
    const gzipped = require("node:zlib").gzipSync("iban DE89370400440532013000").toString("base64");
    expect(classify({ blob: gzipped }).tier).toBe(1);
  });

  it("does not turn an ordinary opaque identifier into a finding", () => {
    // The cost of a decoder is false positives on anything base64-shaped.
    for (const id of [
      "3f2a9c8b7e6d5f4a3b2c1d0e9f8a7b6c5d4e3f2a",
      "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
      "sk-proj-not-a-real-key-000000",
    ]) {
      expect(classify({ token: id }).tier, `${id} became a finding`).toBe(1);
    }
  });
});

describe("⭐ folding — a homoglyph is the letter it looks like", () => {
  it("catches a denied field name spelled with a lookalike codepoint", () => {
    // `normalizeToken` strips `[^a-z0-9]`, so a fullwidth `s` was DELETED and
    // `salary` became `alary` — not just missed, actively turned into a token
    // that matches nothing.
    expect(classesOf(classify({ "ｓalary": 82000 }).findings)).toContain("salary");
    expect(classesOf(classify({ "ｓalary": 82000 }).findings)).not.toContain("alary");
  });

  it("⭐ keeps the TIER as well as the detection — a mis-tier is a quiet downgrade", () => {
    // The Cyrillic `а` in `iban` normalized to `ibn`, losing the tier-4
    // field-name hit and leaving only the value's tier-3 pattern. It was
    // refused by luck of the policy table, while the audit event recorded a
    // full IBAN as Confidential rather than Restricted.
    const r = classify({ "ibаn": "DE89370400440532013000" });
    expect(r.tier).toBe(4);
    expect(classesOf(r.findings)).toContain("iban");
  });

  it("folds accents and zero-width padding as well", () => {
    expect(classify({ "saláry": 1 }).tier).toBe(4);
    expect(classify({ "sal​ary": 1 }).tier).toBe(4);
  });

  it("leaves the host's own transcribed normalize alone", async () => {
    // `deniedPiiField` reproduces the host's behaviour INCLUDING its blind
    // spots, because the divergence test compares it to the host. Folding
    // belongs in `nameHits`, which is where Studio is allowed to be stricter.
    const { deniedPiiField, nameHits } = await import("../names");
    expect(deniedPiiField("ｓalary")).toBeNull();
    expect(nameHits("ｓalary").map((h) => h.token)).toContain("salary");
  });
});

describe("⭐ the vocabulary is not anchored on one spelling either", () => {
  it("catches pay data in the spellings the host list does not carry", () => {
    for (const record of [
      { remuneration: "eighty-two thousand euros per annum" },
      { annualRemuneration: 82000, currency: "EUR" },
      { monatsGehalt: 5000 },
      { payBand: "B" },
      { wage: 19 },
    ]) {
      const r = classify(record);
      expect(r.tier, `${JSON.stringify(record)} classified ${r.tier}`).toBe(4);
    }
  });

  it("⭐ a NUMBER under such a field name is caught by the name, since the value cannot be", () => {
    // The host measured this and wrote it down: "92000, 250000, 4200 and
    // 49.87 all scan clean". A number is never pattern-scanned here — the
    // only class that could fire on a bare integer is `digits`, which would
    // fire on every epoch-millisecond timestamp in the system. The field name
    // is the whole defence, which is why the vocabulary had to grow.
    expect(classify({ annualRemuneration: 82000 }).tier).toBe(4);
    expect(classify({ updatedAtMs: 1758000000000 }).tier).toBe(1);
  });

  it("catches an amount in a currency and a separator the host pattern misses", () => {
    expect(classesOf(classify({ note: "budget is CHF 82'000 this year" }).findings)).toContain("amount");
    expect(classesOf(classify({ note: "signed on 1 September 2026" }).findings)).toContain("date");
  });

  it("⭐ an age plus a reference date is a date of birth, and is named one", () => {
    // Scored as a generic `date`, this was tier 3 — APPROVABLE at
    // `gateWorkflowIntake`. A category-4 date of birth was rubber-stampable
    // because nothing ever called it a date of birth.
    const r = classify({ ageAtSigning: 34, referenceDate: "2026-09-01" });
    expect(r.tier).toBe(4);
    expect(classesOf(r.findings)).toContain("dateofbirth");
    expect(classify({ ageAtSigning: 34, referenceDate: "1 September 2026" }).tier).toBe(4);
  });

  it("⭐ an IBAN split across fields is an IBAN, in two pieces or in six", () => {
    expect(classesOf(classify({ accountPartA: "DE8937040044", accountPartB: "X05320130" }).findings)).toContain(
      "iban",
    );
    expect(
      classesOf(classify({ p1: "DE89", p2: "3704", p3: "0044", p4: "0532", p5: "0130", p6: "00" }).findings),
    ).toContain("iban");
  });

  it("reads a spaced string literal as the field name it is", () => {
    // `looksLikeFieldPointer` rejected anything with a space, so
    // `"employeeSalary"` was tier 4 and `"employee salary"` — one character
    // apart, the same column — was tier 1.
    expect(classesOf(classifyCode('const col = "employee salary";'))).toContain("salary");
    expect(classesOf(classifyCode('const col = "employeeSalary";'))).toContain("salary");
  });

  it("⭐ but a SENTENCE with a denied word in it is still a sentence", () => {
    // The word that would make the gate useless if matched everywhere, and
    // the reason `PROSE_AMBIGUOUS_TOKENS` exists.
    expect(classifyCode('const msg = "Please address this soon";')).toEqual([]);
    expect(gateWorkflowIntake("We address the works-council question in step 3.", ACTOR).decision).toBe("allow");
    expect(classify({ note: "we will address the works-council question" }).tier).toBe(1);
  });

  it("⭐ an Art. 9 category in a VALUE is tier 4, the same as in a key", () => {
    // `SPECIAL_CATEGORY_SUBSTRINGS` was applied whole-document by the prose
    // scanner and to key paths only by `classify()`. Health, religion and
    // union membership went to the model at tier 1.
    const note = "Mitarbeiterin ist schwerbehindert; Kirchensteuer applies; trade union membership confirmed";
    expect(classify({ note }).tier).toBe(4);
    expect(tierOf(classifyMarkdown(note))).toBe(4);
    expect(classify({ record: { health: "ok" } }).tier).toBe(4);
  });
});

describe("⭐ a person-referring field over a name-shaped value", () => {
  it("catches a person's name in a field whose NAME is not on any denylist", () => {
    for (const record of [{ owner: "Erika Musterfrau" }, { assignee: "Max Mustermann" }, { contact: "Jane Q. Doe" }]) {
      expect(classify(record).tier, `${JSON.stringify(record)}`).toBe(3);
    }
    expect(classesOf(classify({ owner: "Erika Musterfrau" }).findings)).toContain("personname");
  });

  it("needs BOTH halves — neither the field name nor the shape is enough alone", () => {
    expect(classify({ owner: "platform-team" }).tier).toBe(1);
    expect(classify({ owner: "Musterfrau GmbH" }).tier).toBe(1);
    expect(classify({ label: "Open Items" }).tier).toBe(1);
    expect(classify({ title: "Works Council Clock" }).tier).toBe(1);
  });

  it("⭐ STATED RESIDUAL: a name in free prose under an innocent key is still not detected", () => {
    // No regex recognises a person. `declaredNames` remains the caller's one
    // obligation, and this case is asserted as CURRENT BEHAVIOUR so that a
    // future claim to the contrary has to come here and change it.
    expect(classify({ note: "ask Erika Musterfrau before Friday" }).tier).toBe(1);
  });
});

describe("⭐ the redaction channel closes", () => {
  const PAYLOAD = {
    employeeSalary: 82000,
    owner: "Erika Musterfrau",
    memo: "Erika is schwerbehindert and her IBAN is DE89370400440532013000",
  };

  it("does not hand back a named person plus an Art. 9 disclosure and call it ALLOW", () => {
    // What this returned before: decision ALLOW at tier 4, payload
    // {"owner":"Erika Musterfrau","memo":"Erika is schwerbehindert and her
    // IBAN is <iban>"} — because "redaction is verified, not assumed"
    // verified with the one scanner that could see neither an Art. 9 word nor
    // a person in a value.
    const d = gateModelRequest(PAYLOAD, ACTOR, { onTier3: "redact", onTier4: "redact" });
    expect(d.decision).toBe("refuse");
    expect(d.reason).toContain("survived redaction");
    expect(d.redactedPayload).toBeUndefined();
  });

  it("the re-scan is the same scanner the first scan used", () => {
    // The property the redaction path actually rests on: whatever the gate
    // would refuse on the way in, it refuses on the way out.
    const scrubbedLooking = { owner: "Erika Musterfrau", memo: "Erika is schwerbehindert and her IBAN is <iban>" };
    expect(classify(scrubbedLooking).tier).toBe(4);
  });

  it("still redacts and allows when what is left really is clean", () => {
    // Redaction must remain a usable mode, or it becomes a slower refusal.
    const d = gateModelRequest(
      { task: "draft", facts: { openCount: 3 }, notes: "confirm with e.musterfrau@example.de before Friday" },
      ACTOR,
      { onTier3: "redact", onTier4: "redact" },
    );
    expect(d.decision).toBe("allow");
    expect(JSON.stringify(d.redactedPayload)).toContain("<email>");
  });
});

describe("a finding still names only a class and a place", () => {
  it("every class the widened scanner can emit is in the compiled-in vocabulary", () => {
    const payloads: unknown[] = [
      { owner: "Erika Musterfrau", remuneration: 82000, ageAtSigning: 34, referenceDate: "2026-09-01" },
      { payload: JSON.stringify(RESTRICTED_RECORDS[0]) },
      { blob: b64("iban DE89370400440532013000") },
      { p1: "DE89", p2: "3704", p3: "0044", p4: "0532", p5: "0130", p6: "00" },
      {
        wrap: {
          get x() {
            return 1;
          },
        },
      },
    ];
    const known = new Set(FINDING_CLASSES);
    for (const payload of payloads) {
      for (const f of classify(payload).findings) {
        expect(known.has(f.class), `"${f.class}" is not in FINDING_CLASSES`).toBe(true);
      }
    }
  });

  it("does not echo a decoded value into the finding it produced", () => {
    const secret = "e.musterfrau@example.de";
    const serialised = JSON.stringify(classify({ blob: b64(secret), q: encodeURIComponent(secret) }).findings);
    expect(serialised).not.toContain("musterfrau");
    expect(serialised).not.toContain(b64(secret));
  });
});

describe("⛔ AND IT STILL DOES NOT FIRE ON EVERYTHING", () => {
  // The counter-property, and the reason every widening above is scoped the
  // way it is. A gate that refuses ordinary work gets switched off in week
  // one, and a switched-off gate protects nobody. If a future widening breaks
  // these, it has not made the system safer — it has made the gate a
  // formality.
  const ORDINARY = {
    capacity: 12,
    packageName: "@guardrails",
    storageBytes: 4096,
    averageLatencyMs: 9,
    messageText: "queue drained",
    imageUrl: "/assets/logo.png",
    updatedAt: 1758000000000,
    pageSize: 50,
    usage: 3,
    manager: "platform-team",
    label: "Open Items",
    ratio: 49.87,
    payment: { provider: "stub", status: "ok" },
  };

  it("classifies an ordinary application record no higher than INTERNAL", () => {
    // Tier 2 is the floor for business vocabulary (`status`, `contract`) and
    // is a refusal nowhere: no row in `GATE_POLICY` does anything below tier
    // 3. What must not appear is a tier-3 or tier-4 finding.
    const r = classify(ORDINARY);
    expect(r.tier, `unexpected findings: ${classesOf(r.findings).join(", ")}`).toBeLessThanOrEqual(2);
    expect(r.findings.filter((f) => f.tier >= 3)).toEqual([]);
  });

  it("registers an ordinary mini-app spec with no approval at all", () => {
    const spec = {
      id: "wc-clock",
      label: "Works Council Clock",
      tables: [{ name: "deadlines", columns: [{ name: "contractId" }, { name: "dueAt" }, { name: "ownerRole" }] }],
      routes: ["/api/deadlines"],
    };
    expect(gateRegistration(spec, ACTOR).decision).toBe("allow");
  });

  it("lets an ordinary outbound request through", () => {
    expect(gateModelRequest({ task: "summarise", facts: ORDINARY }, ACTOR).decision).toBe("allow");
  });

  it("lets an ordinary pasted workflow through", () => {
    const workflow = [
      "# Works council clock",
      "",
      "| Step | Owner role |",
      "| --- | --- |",
      "| Open ticket | hr_reviewer |",
      "",
      "Contract status moves to `wc-pending` and the clock starts.",
      "We address the works-council question in step 3.",
      "",
      "```ts",
      "const rows = [{ contractId: 'C-1', status: 'draft' }];",
      "```",
    ].join("\n");
    expect(gateWorkflowIntake(workflow, ACTOR).decision).toBe("allow");
  });

  it("does not refuse emitted code for containing ordinary English", () => {
    const source = [
      "// Address the review comments before merging.",
      "export const HELP = 'Please address this in the next sprint';",
      "export const rows = [{ contractId: 'C-1', openCount: 2 }];",
    ].join("\n");
    expect(classifyProseAndCode(source, "<artifact>")).toEqual([]);
  });
});
