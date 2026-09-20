/**
 * Revocation takes effect on the NEXT CALL, because there is no boolean
 * anywhere for it to be stale in.
 *
 * Ph27 Pitfall 5, in the host's own research: "Never let a route handler read
 * 'is this sub-app enabled' from a stale in-memory flag; check the live registry
 * state on each mount-seam request." Sub-app contract §5 rule 2 says the same
 * about this package's three inputs. Below: first the behaviour, then a source
 * scan, because behaviour alone cannot prove the absence of a cache that simply
 * has not been warmed yet.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { effectiveGrant } from "../decision";
import { CEILING_PROJECT_ID } from "../identity";
import { CONTRACTS_INPUT, PROJECT, TOOL, approval, ask, ceiling, row, store } from "./support";

const rows = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];
const request = ask({ datasource: CONTRACTS_INPUT, tier: 4 });

describe("a revocation is visible to the very next call", () => {
  it("revoking the APPROVAL flips the answer", async () => {
    const s = store(rows, [approval({ tier: 4 })]);
    expect((await effectiveGrant({ store: s, ...request })).allowed).toBe(true);
    s.revokeApproval(0, "2026-09-20T11:00:00Z");
    const after = await effectiveGrant({ store: s, ...request });
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe("approval_revoked");
  });

  it("revoking the PROJECT row flips the answer", async () => {
    const s = store(rows, [approval({ tier: 4 })]);
    expect((await effectiveGrant({ store: s, ...request })).allowed).toBe(true);
    s.revokeGrantRow(PROJECT, TOOL, "2026-09-20T11:00:00Z");
    const after = await effectiveGrant({ store: s, ...request });
    expect(after.reason).toBe("project_revoked");
    // the Function's consent is untouched — a project revocation is not a
    // Function revocation
    expect(after.ceilingGranted).toBe(true);
  });

  it("revoking the CEILING row flips the answer for every project", async () => {
    const s = store(rows, [approval({ tier: 4 })]);
    expect((await effectiveGrant({ store: s, ...request })).allowed).toBe(true);
    s.revokeGrantRow(CEILING_PROJECT_ID, TOOL, "2026-09-20T11:00:00Z");
    const after = await effectiveGrant({ store: s, ...request });
    expect(after.reason).toBe("ceiling_revoked");
  });

  it("narrowing the ceiling mid-flight narrows the answer, with no restart", async () => {
    const s = store(rows, [approval({ tier: 4 })]);
    expect((await effectiveGrant({ store: s, ...request })).allowed).toBe(true);
    s.putGrantRow(ceiling([[CONTRACTS_INPUT, 2]]));
    const after = await effectiveGrant({ store: s, ...request });
    expect(after.reason).toBe("tier_above_ceiling");
    expect(after.effectiveTiers).toEqual([1, 2]);
  });

  it("re-granting brings it back, also on the next call", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]])], [approval({ tier: 4 })]);
    expect((await effectiveGrant({ store: s, ...request })).reason).toBe("no_project_row");
    s.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 4]]));
    expect((await effectiveGrant({ store: s, ...request })).allowed).toBe(true);
  });
});

describe("every call re-reads the store", () => {
  it("reads both rows on every call, and the approvals whenever the tier demands one", async () => {
    const s = store(rows, [approval({ tier: 4 })]);
    for (let call = 1; call <= 3; call += 1) {
      await effectiveGrant({ store: s, ...request });
      expect(s.counts.grantRows).toBe(call * 2);
      expect(s.counts.approvals).toBe(call);
    }
  });

  it("reads the project row even when the ceiling turns out to be shut", async () => {
    // The masked third state is only describable if this read happens.
    const s = store([row(PROJECT, [[CONTRACTS_INPUT, 4]])]);
    const decision = await effectiveGrant({ store: s, ...request });
    expect(s.counts.grantRows).toBe(2);
    expect(decision.projectGranted).toBe(true);
    expect(decision.ceilingGranted).toBe(false);
  });

  it("does not read approvals for a tier that needs none", async () => {
    const s = store(rows);
    await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    expect(s.counts.approvals).toBe(0);
  });

  it("refuses a malformed request before touching the store at all", async () => {
    const s = store(rows);
    const decision = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }), toolId: "Not A Tool Id" });
    expect(decision.reason).toBe("invalid_tool_id");
    expect(s.counts.grantRows).toBe(0);
  });
});

describe("there is no cache to go stale", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const DECIDING_MODULES = ["decision.ts", "grant.ts", "approval.ts", "audit.ts", "datasource.ts", "tiers.ts", "identity.ts", "reasons.ts"];

  /** Things that can only be module-level mutable state or a captured environment. */
  const FORBIDDEN = [/\bnew Map\(/, /\bnew WeakMap\(/, /\bnew WeakSet\(/, /\bglobalThis\b/, /\bprocess\.env\b/];

  /** Comments in these files DISCUSS caches at length; the scan is about code. */
  const code = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const file of DECIDING_MODULES) {
    it(`${file} holds no module-level mutable state`, () => {
      const source = code(readFileSync(join(here, "..", file), "utf8"));
      for (const pattern of FORBIDDEN) expect(source).not.toMatch(pattern);
      // no top-level `let`/`var` — a module-level binding that can be reassigned
      // is the shape every stale-flag defect takes
      const topLevel = source.split("\n").filter((line) => /^(let|var)\s/.test(line));
      expect(topLevel).toEqual([]);
    });
  }

  it("effectiveGrant takes no pre-computed grant — there is nowhere to inject one", () => {
    const source = code(readFileSync(join(here, "..", "decision.ts"), "utf8"));
    expect(source).not.toMatch(/grant\s*:\s*EffectiveGrant/);
  });
});
