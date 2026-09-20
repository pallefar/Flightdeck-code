/**
 * Sub-app contract §5 rule 8: "Audit names fields, never PII values. No address,
 * DOB or salary value in an event." And rule 5: "Never construct an audit hash."
 *
 * The fixture below is deliberately hostile: a real approval note, of the kind a
 * human would actually type, carrying a salary, a name and an IBAN. It is stored
 * on the approval, it is available to the decision that reads it — and there is
 * no field on the event body for it to land in. That is the property under test,
 * and the key-set assertion is what keeps it true after the next edit.
 */
import { describe, expect, it } from "vitest";
import { effectiveGrant } from "../decision";
import { AUDIT_BODY_FIELDS } from "../audit";
import { GRANT_REASONS } from "../reasons";
import { CONTRACTS_INPUT, HASH_V1, HASH_V2, PROJECT, TOOL, approval, ask, ceiling, row, store } from "./support";

const NOTE = "Salary 84,000 EUR for Anna Becker, IBAN DE89370400440532013000, DOB 1984-03-02";
const VALUES = ["84,000", "Anna Becker", "DE89370400440532013000", "1984-03-02", "Salary"];

const rows = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];
const signed = () => store(rows, [approval({ tier: 4, note: NOTE })]);

describe("the audit body names the actor, the project, the datasource and the tier", () => {
  it("carries exactly the frozen field set and nothing else", async () => {
    const { audit } = await effectiveGrant({ store: signed(), ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    expect(Object.keys(audit).sort()).toEqual([...AUDIT_BODY_FIELDS].sort());
  });

  it("has no free-form field a value could arrive in", async () => {
    const { audit } = await effectiveGrant({ store: signed(), ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    for (const loose of ["message", "note", "detail", "details", "metadata", "payload", "value", "content", "body"]) {
      expect(Object.keys(audit)).not.toContain(loose);
    }
  });

  it("constructs no hash and no chain — that is the capability adapter's job", async () => {
    const { audit } = await effectiveGrant({ store: signed(), ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    for (const chain of ["hash", "prev_hash", "prevHash", "idx", "chain", "signature"]) {
      expect(Object.keys(audit)).not.toContain(chain);
    }
  });

  it("names what was touched", async () => {
    const { audit } = await effectiveGrant({ store: signed(), ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    expect(audit).toMatchObject({
      event: "grant.decision",
      at: "2026-09-20T09:00:00Z",
      actor: "crew.contract-auditor",
      actorKind: "agent",
      toolId: TOOL,
      contentHash: HASH_V1,
      projectId: PROJECT,
      datasource: { kind: "repo-path", id: "contracts", scope: "input" },
      tier: 4,
      decision: "allow",
      reason: "allowed",
    });
  });
});

describe("no data value reaches an audit entry", () => {
  it("an ALLOWED tier-4 decision carries none of the approval note", async () => {
    const { audit } = await effectiveGrant({ store: signed(), ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    const serialized = JSON.stringify(audit);
    for (const value of VALUES) expect(serialized).not.toContain(value);
  });

  it("a REFUSED decision carries none of it either", async () => {
    const { audit, allowed } = await effectiveGrant({
      store: signed(),
      ...ask({ datasource: CONTRACTS_INPUT, tier: 4, toolContent: TOOL_V2 }),
    });
    expect(allowed).toBe(false);
    const serialized = JSON.stringify(audit);
    for (const value of VALUES) expect(serialized).not.toContain(value);
    expect(audit.decision).toBe("refuse");
    expect(audit.reason).toBe("approval_content_hash_mismatch");
  });

  it("every value in the body is an identifier, a code or a number", async () => {
    const { audit } = await effectiveGrant({ store: signed(), ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    const flat = Object.entries(audit).flatMap(([key, value]) =>
      key === "datasource" ? Object.values(value as Record<string, unknown>) : [value],
    );
    for (const value of flat) {
      if (value === null) continue;
      expect(["string", "number"]).toContain(typeof value);
      // nothing free-form: no spaces, no punctuation a sentence would need
      if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
        expect(value).not.toMatch(/\s/);
      }
    }
  });
});

describe("a refusal reason is a code a UI can render in any language", () => {
  it("every decision path returns a member of the closed set", async () => {
    const cases = [
      { store: store([]), request: ask({ datasource: CONTRACTS_INPUT, tier: 1 }) },
      { store: store(rows), request: ask({ datasource: CONTRACTS_INPUT, tier: 3 }) },
      { store: signed(), request: ask({ datasource: CONTRACTS_INPUT, tier: 4 }) },
      { store: store(rows), request: ask({ datasource: { kind: "connector", id: "slack" }, tier: 1 }) },
    ];
    for (const { store: s, request } of cases) {
      const decision = await effectiveGrant({ store: s, ...request });
      expect(GRANT_REASONS).toContain(decision.reason);
      // never a sentence
      expect(decision.reason).toMatch(/^[a-z][a-z_]*$/);
    }
  });
});
