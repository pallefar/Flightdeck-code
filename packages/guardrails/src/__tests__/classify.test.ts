/**
 * The four tiers, derived from the OS's existing vocabulary.
 *
 * Every fixture here is FICTIONAL. The host checkout contains a real person's
 * name — `scripts/check-contracts-boundary.sh` enumerates five files that
 * carry it, and `.gitignore:67-77` records that the first `.docx` holds 32,201
 * characters of live body text including that person's salary and address. A
 * test suite for a privacy layer that lifted its samples from there would be
 * the SEC-V5-02 incident in miniature: the same person data, reachable by a
 * second path, this time a path called `packages/guardrails`. So: Musterfrau,
 * Doe, and numbers nobody is paid.
 */

import { describe, expect, it } from "vitest";
import { classify, classifyText, deniedPiiField, nameHits, requiresApproval } from "../classify";
import { maxTier } from "../findings";

describe("tier 1 — public", () => {
  it("gives a spec with no person vocabulary tier 1", () => {
    const r = classify({ widget: "counter", refreshSeconds: 30, label: "Open items" });
    expect(r.tier).toBe(1);
    expect(r.findings).toEqual([]);
  });

  it("does not fire on a business word that merely contains a denied one", () => {
    // The host's own worked example for why SEGMENTS is a separate tier:
    // "city must not block capacity".
    expect(classify({ capacity: 12 }).tier).toBe(1);
    expect(nameHits("capacity")).toEqual([]);
  });
});

describe("tier 2 — internal", () => {
  it("gives contract/ticket data with no person fields tier 2", () => {
    const r = classify({ contractId: "C-1001", status: "draft", templateRevision: "E" });
    expect(r.tier).toBe(2);
    expect(r.findings.map((f) => f.class)).toContain("contractid");
  });
});

describe("tier 3 — confidential", () => {
  it("fires on a PII_PATTERNS hit in a VALUE", () => {
    const r = classify({ note: "ping e.musterfrau@example.de before Friday" });
    expect(r.tier).toBe(3);
    expect(r.findings.map((f) => f.class)).toEqual(["email"]);
    expect(r.findings[0]?.via).toBe("value-pattern");
  });

  it("fires on a PII_DENIED_SEGMENTS field NAME even when the value is clean", () => {
    const r = classify({ person: { surname: "" } });
    expect(r.tier).toBe(3);
    expect(r.findings.map((f) => f.class).sort()).toEqual(["person", "surname"]);
    expect(r.findings.every((f) => f.via === "field-name")).toBe(true);
  });

  it("catches each of the host's five pattern classes", () => {
    const samples: Record<string, string> = {
      email: "e.musterfrau@example.de",
      iban: "DE89 3704 0044 0532 0130 00",
      digits: "0170 1234567",
      amount: "€4.200",
      date: "1987-04-12",
    };
    for (const [klass, value] of Object.entries(samples)) {
      const classes = classifyText(value, "<t>").map((f) => f.class);
      expect(classes, `${klass} not detected`).toContain(klass);
    }
  });
});

describe("tier 4 — restricted", () => {
  it("fires on a PII_DENIED_SUBSTRINGS hit", () => {
    const r = classify({ employee: { salaryEur: 82000 } });
    expect(r.tier).toBe(4);
    expect(r.findings.map((f) => f.class)).toContain("salary");
  });

  it("catches the host's own documented evasion — a denied token inside a KEY", () => {
    // envelope.ts, the closed key policy: "A key like `salary_of_Jane_Doe_92000`
    // produces ZERO findings under this module's own PII_PATTERNS (the `digits`
    // class needs a 7-character run, and there is no word boundary before a
    // digit preceded by `_`), so nothing caught it."
    const key = "salary_of_Jane_Doe_92000";
    expect(classifyText(key, "<t>")).toEqual([]); // the host's measurement, reproduced
    const r = classify({ [key]: true }); // and caught anyway, by NAME
    expect(r.tier).toBe(4);
    expect(r.findings.map((f) => f.class)).toContain("salary");
  });

  it("does not depend on the value being recognisable — 82000 scans clean", () => {
    // envelope.ts, the count branch: "Measured against this module's own
    // PII_PATTERNS, 92000, 250000, 4200 and 49.87 all scan clean."
    for (const n of ["92000", "250000", "4200", "49.87"]) {
      expect(classifyText(n, "<t>"), `${n} unexpectedly matched a pattern`).toEqual([]);
    }
    expect(classify({ compensationBand: "B" }).tier).toBe(4);
  });

  it("fires on a GDPR Art. 9 special category", () => {
    expect(classify({ employee: { unionMembership: true } }).tier).toBe(4);
    expect(classify({ record: { health: "ok" } }).tier).toBe(4);
    expect(classify({ payroll: { kirchensteuer: 9 } }).tier).toBe(4);
  });

  it("requires an exact segment for the generic Art. 9 words", () => {
    // "health check" is in every ops doc in this repo. Blocking it would make
    // the gate something people route around.
    expect(classify({ healthCheckPassed: true }).tier).toBe(1);
    expect(classify({ unionized: false }).tier).toBe(1);
  });

  it("catches a denied token split across two keys", () => {
    // `date` and `ofBirth` are each innocent; `date.ofBirth` normalizes whole
    // to `dateofbirth`, which is on the host's substring list.
    const r = classify({ date: { ofBirth: "" } });
    expect(r.tier).toBe(4);
    expect(r.findings.map((f) => f.class)).toContain("dateofbirth");
  });
});

describe("higher tier wins — never the lower", () => {
  it("takes the maximum across a mixed record", () => {
    const r = classify({
      contractId: "C-1001", // 2
      applicant: { email: "e.musterfrau@example.de" }, // 3
      offer: { salaryEur: 82000 }, // 4
    });
    expect(r.tier).toBe(4);
    const tiers = new Set(r.findings.map((f) => f.tier));
    expect([...tiers].sort()).toEqual([2, 3, 4]); // all three still REPORTED
  });

  it("is the only place the rule lives", () => {
    expect(maxTier(1, 4)).toBe(4);
    expect(maxTier(4, 1)).toBe(4);
    expect(maxTier(3, 3)).toBe(3);
  });

  it("a tier-2 business field cannot pull a tier-4 record down", () => {
    expect(classify({ contract: { salary: 1 } }).tier).toBe(4);
    expect(classify({ salary: 1, contract: "x" }).tier).toBe(4);
  });

  it("cat 3 and cat 4 are exactly the tiers that require approval", () => {
    expect(requiresApproval(1)).toBe(false);
    expect(requiresApproval(2)).toBe(false);
    expect(requiresApproval(3)).toBe(true);
    expect(requiresApproval(4)).toBe(true);
  });
});

describe("the walk itself", () => {
  it("reaches into arrays and deep nesting", () => {
    const r = classify({ a: [{ b: [{ c: { iban: "x" } }] }] });
    expect(r.tier).toBe(4);
    expect(r.findings[0]?.where).toBe("a.[0].b.[0].c.iban");
  });

  it("does not re-report a token its parent already reported", () => {
    const r = classify({ salaryDetail: { band: "A", currency: "EUR", effective: "x" } });
    expect(r.findings.filter((f) => f.class === "salary")).toHaveLength(1);
  });

  it("terminates on a cycle instead of hanging", () => {
    const a: Record<string, unknown> = { person: {} };
    a["self"] = a;
    expect(classify(a).tier).toBe(3);
  });

  it("fails CLOSED when the walk is truncated", () => {
    // Same direction as the host's `.pii-boundary` switch: "Absent or
    // unreadable means CLOSED — fail-closed, so deleting the switch tightens
    // the guard rather than loosening it."
    const wide = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, i]));
    const r = classify(wide, { maxNodes: 10 });
    expect(r.tier).toBe(4);
    expect(r.findings.map((f) => f.class)).toContain("scan-truncated");
  });
});

describe("deniedPiiField — the host's function, transcribed", () => {
  it("returns the FIRST offending token, substrings before segments", () => {
    expect(deniedPiiField("person.salary")).toBe("salary");
    expect(deniedPiiField("employee.city")).toBe("city");
    expect(deniedPiiField("rows[0].capacity")).toBeNull();
    expect(deniedPiiField("salary_eur")).toBe("salary");
    expect(deniedPiiField("salaryEUR")).toBe("salary");
    expect(deniedPiiField("salary-eur")).toBe("salary");
  });
});
