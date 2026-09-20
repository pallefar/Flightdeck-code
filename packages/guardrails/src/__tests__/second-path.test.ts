/**
 * ⭐ SEC-V5-02, RESTATED IN THIS PACKAGE'S OWN TERMS.
 *
 * From `scripts/check-contracts-boundary.sh`, the single implementation of the
 * host's PII-out-of-git rule:
 *
 *     "Phase 30 untracked contracts/INDEX.json. An identical-shape snapshot of
 *      the same data — 1101 rows, 921 distinct persons — stayed tracked at
 *      archive/snapshots-2026-06-24/contracts-INDEX.json, and this script could
 *      not see it, because Rule 1 is prefix-anchored on "contracts/" and the git
 *      pathspec below never even listed anything else. The 25 piiGitBoundary
 *      tests passed the whole time. An untrack that removes a file from ONE
 *      path while an identical copy lives at another is not a boundary
 *      closure — so the guard must name paths, not prefixes."
 *
 * Three things are worth separating out of that, because only the first one is
 * usually remembered:
 *
 *   1. The data was in two places.
 *   2. The GUARD'S SCOPE only ever looked at one of them.
 *   3. THE TESTS WENT GREEN THROUGHOUT. Twenty-five of them. Passing tests
 *      were the evidence that persuaded everyone the boundary was closed.
 *
 * (3) is why this file exists and why it is written the way it is. A test that
 * asserts "this sample is refused" is satisfied by a guard that looks in one
 * place, because the sample was put where the guard looks. So the assertions
 * below are REMOVAL assertions: take the obvious location away, and check the
 * gate still refuses because of the other one. A guard anchored on a single
 * field name, a single declaration site or a single directory prefix fails
 * every case in this file.
 */

import { describe, expect, it } from "vitest";
import { classify } from "../classify";
import { gateGeneratedArtifacts, gateModelRequest, gateRegistration } from "../index";

const ACTOR = { actor: "karsten.haldan" };

/**
 * The incident's shape, in one object: the live index and an archived snapshot
 * of the same rows. Fictional rows; the structure is the point.
 */
const BOTH_PATHS = {
  contracts: {
    index: { rows: [{ person: { surname: "Musterfrau" }, offer: { salaryEur: 82000 } }] },
  },
  archive: {
    "snapshots-2026-06-24": {
      contractsIndex: { rows: [{ person: { surname: "Musterfrau" }, offer: { salaryEur: 82000 } }] },
    },
  },
};

describe("the data is in two places", () => {
  it("classifies tier 4 with both present, and reports BOTH locations", () => {
    const r = classify(BOTH_PATHS, { declaredNames: ["Erika Musterfrau"] });
    expect(r.tier).toBe(4);
    const wheres = r.findings.map((f) => f.where);
    expect(wheres.some((w) => w.startsWith("contracts."))).toBe(true);
    expect(wheres.some((w) => w.startsWith("archive."))).toBe(true);
  });

  it("⭐ still classifies tier 4 when the FIRST path is removed", () => {
    // The Phase 30 untrack, exactly: one copy gone, an identical one left.
    const { archive } = BOTH_PATHS;
    const r = classify({ archive });
    expect(r.tier, "removing contracts/ made the record look clean — the guard is prefix-anchored").toBe(4);
    expect(r.findings.map((f) => f.class)).toContain("salary");
  });

  it("still classifies tier 4 when the SECOND path is removed", () => {
    const { contracts } = BOTH_PATHS;
    expect(classify({ contracts }).tier).toBe(4);
  });

  it("⭐ removing ANY single location never yields a clean result", () => {
    // Generative rather than illustrative: for every leaf path in the fixture,
    // delete just that one and assert the record is still caught. A guard that
    // depends on any single location fails at least one of these.
    const paths: string[][] = [];
    const collect = (v: unknown, at: string[]): void => {
      if (v === null || typeof v !== "object") {
        paths.push(at);
        return;
      }
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) collect(child, [...at, k]);
    };
    collect(BOTH_PATHS, []);
    expect(paths.length).toBeGreaterThan(3);

    for (const path of paths) {
      const copy = structuredClone(BOTH_PATHS) as Record<string, unknown>;
      let cursor: Record<string, unknown> = copy;
      for (const seg of path.slice(0, -1)) cursor = cursor[seg] as Record<string, unknown>;
      delete cursor[path[path.length - 1] as string];
      expect(
        classify(copy).tier,
        `deleting ${path.join(".")} alone made the record classify clean`,
      ).toBe(4);
    }
  });
});

describe("a gate anchored on one declaration site is not a closure", () => {
  it("⭐ catches a salary declared in a widget filter after `tables` was cleaned", () => {
    const cleanedTables = {
      id: "offer-tracker",
      // Somebody "fixed" the finding by renaming the column…
      tables: [{ name: "offers", columns: [{ name: "contractId" }, { name: "bandCode" }] }],
      // …while the same field is still selected from here.
      widgets: [{ kind: "table", filters: [{ field: "employee.salary_eur", op: "gt", value: 0 }] }],
    };
    const d = gateRegistration(cleanedTables, ACTOR);
    expect(d.decision, "a gate reading only spec.tables would have allowed this").not.toBe("allow");
    expect(d.tier).toBe(4);
  });

  it("catches it from a seed fixture embedded in the spec", () => {
    const withSeed = {
      id: "offer-tracker",
      tables: [{ name: "offers", columns: [{ name: "contractId" }] }],
      seed: [{ contractId: "C-1", employeeIban: "DE89370400440532013000" }],
    };
    expect(gateRegistration(withSeed, ACTOR).tier).toBe(4);
  });

  it("catches it from a settings panel default", () => {
    const withSettings = {
      id: "offer-tracker",
      tables: [{ name: "offers", columns: [{ name: "contractId" }] }],
      settings: { panels: [{ key: "notify", defaultTo: "e.musterfrau@example.de" }] },
    };
    expect(gateRegistration(withSettings, ACTOR).tier).toBeGreaterThanOrEqual(3);
  });
});

describe("generated artifacts — the incident's own file shape", () => {
  const LIVE = { path: "src/data/index.ts", content: 'export const rows = [{ salaryEur: 82000 }];' };
  const SNAPSHOT = {
    path: "fixtures/snapshots-2026-06-24/index.seed.json",
    content: '[{"salaryEur":82000}]',
  };

  it("refuses with both files present", () => {
    expect(gateGeneratedArtifacts([LIVE, SNAPSHOT], ACTOR).decision).toBe("refuse");
  });

  it("⭐ still refuses when only the archived copy is left", () => {
    // `contracts/INDEX.json` removed, `archive/snapshots-2026-06-24/` kept.
    const d = gateGeneratedArtifacts([SNAPSHOT], ACTOR);
    expect(d.decision, "removing the live file cleared the refusal — the gate is prefix-anchored").toBe(
      "refuse",
    );
  });

  it("⭐ still refuses when only the live copy is left", () => {
    expect(gateGeneratedArtifacts([LIVE], ACTOR).decision).toBe("refuse");
  });

  it("scopes no directory — every emitted file is walked, in any layout", () => {
    for (const path of [
      "deep/nested/vendor/generated/thing.json",
      "docs/EXAMPLES.md",
      ".storybook/preview-data.ts",
      "e2e/__snapshots__/app.snap",
    ]) {
      const d = gateGeneratedArtifacts([{ path, content: '{"salaryEur":82000}' }], ACTOR);
      expect(d.decision, `${path} was outside the gate's scope`).toBe("refuse");
    }
  });
});

describe("an outbound request cannot be cleaned by fixing the obvious field", () => {
  it("⭐ still refuses when the structured field is gone but a note carries it", () => {
    const tidied = {
      task: "draft",
      facts: { openCount: 3 },
      // The salary field was removed. The same figure rides along here.
      operatorNote: "offer is €82.000 gross, iban DE89 3704 0044 0532 0130 00",
    };
    const d = gateModelRequest(tidied, ACTOR);
    expect(d.decision).toBe("refuse");
    expect(d.audit.classes).toEqual(expect.arrayContaining(["amount", "iban"]));
  });

  it("refuses a second copy hiding under an innocuous key", () => {
    const disguised = { task: "draft", meta: { cacheKey: "e.musterfrau@example.de" } };
    expect(gateModelRequest(disguised, ACTOR).decision).toBe("refuse");
  });
});

describe("the lesson the guard must not relearn", () => {
  it("every gate's scope is the WHOLE input, stated as a property", () => {
    // If any gate ever grows an anchor — a root it starts at, a field it
    // trusts, a directory it skips — one of these goes red.
    const needle = { deeply: { nested: { and: { unexpected: { salaryEur: 1 } } } } };
    expect(gateRegistration(needle, ACTOR).tier).toBe(4);
    expect(gateModelRequest(needle, ACTOR).tier).toBe(4);
    expect(
      gateGeneratedArtifacts([{ path: "a/b/c/d/e.json", content: JSON.stringify(needle) }], ACTOR).tier,
    ).toBe(4);
  });
});
