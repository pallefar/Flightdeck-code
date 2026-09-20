/**
 * The ceiling narrows the project, and there is no input that makes it not.
 *
 * This is the property the whole package exists to hold: a project row is a
 * CLAIM, the ceiling is the authority, and a claim that exceeds the authority
 * produces the intersection rather than an error, a warning, or — the thing
 * being ruled out here — a wider grant.
 */
import { describe, expect, it } from "vitest";
import { effectiveGrant } from "../decision";
import { intersectGrant, intersectGrantRows } from "../grant";
import { DATA_TIERS, tiersUpTo, type DataTier } from "../tiers";
import { CEILING_PROJECT_ID } from "../identity";
import { datasourceKey } from "../datasource";
import { PROJECT, SHAREPOINT, OUTLOOK, ask, ceiling, row, store } from "./support";

describe("a project row claiming more than the ceiling yields the intersection", () => {
  // The ceiling grants SharePoint up to Internal (2). The project row claims
  // Restricted (4) on the same datasource — someone wrote it straight into the
  // store, which is exactly the case the brief names.
  const rows = [ceiling([[SHAREPOINT, 2]]), row(PROJECT, [[SHAREPOINT, 4]])];

  it("allows what the ceiling reaches", async () => {
    const decision = await effectiveGrant({ store: store(rows), ...ask({ datasource: SHAREPOINT, tier: 2 }) });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("allowed");
    expect(decision.effectiveTiers).toEqual([1, 2]);
    expect(decision.ceilingMaxTier).toBe(2);
    // The project's own claim is reported honestly...
    expect(decision.projectMaxTier).toBe(4);
    // ...and has no effect on what was granted.
  });

  it("refuses the tier the project row claimed but the ceiling never granted", async () => {
    for (const tier of [3, 4] as const) {
      const decision = await effectiveGrant({ store: store(rows), ...ask({ datasource: SHAREPOINT, tier }) });
      expect(decision.allowed).toBe(false);
      // Names WHICH side is short: an operator must raise the Function ceiling,
      // not edit this project.
      expect(decision.reason).toBe("tier_above_ceiling");
      expect(decision.effectiveTiers).toEqual([1, 2]);
    }
  });

  it("the other direction still narrows: a project below the ceiling wins", async () => {
    const narrow = [ceiling([[SHAREPOINT, 4]]), row(PROJECT, [[SHAREPOINT, 2]])];
    const decision = await effectiveGrant({ store: store(narrow), ...ask({ datasource: SHAREPOINT, tier: 3 }) });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("tier_above_project");
    expect(decision.effectiveTiers).toEqual([1, 2]);
  });

  it("holds for every (ceiling, project) tier pair — effective is always a subset of the ceiling", () => {
    for (const c of DATA_TIERS) {
      for (const p of DATA_TIERS) {
        const intersection = intersectGrant(ceiling([[SHAREPOINT, c]]), row(PROJECT, [[SHAREPOINT, p]]), SHAREPOINT);
        expect(intersection.outcome).toBe("granted");
        if (intersection.outcome !== "granted") return;
        const tiers = intersection.grant.tiers;
        const ceilingTiers = tiersUpTo(c);
        // subset of the ceiling, for all 16 pairs
        for (const tier of tiers) expect(ceilingTiers).toContain(tier);
        // and exactly the intersection, never the larger of the two
        expect(tiers).toEqual(tiersUpTo(Math.min(c, p) as DataTier));
      }
    }
  });
});

describe("a project enabling with no ceiling is refused", () => {
  it("refuses when no '*' row exists at all, and still reports the project's stored consent", async () => {
    const decision = await effectiveGrant({
      store: store([row(PROJECT, [[SHAREPOINT, 4]])]),
      ...ask({ datasource: SHAREPOINT, tier: 1 }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_ceiling_row");
    expect(decision.ceilingGranted).toBe(false);
    // ⭐ the third state: consent IS on record here, masked by a ceiling that
    // does not exist. Without this field "never granted" and "granted but
    // masked" are the same two booleans on the wire.
    expect(decision.projectGranted).toBe(true);
    expect(decision.effectiveTiers).toEqual([]);
  });

  it("refuses when the ceiling exists but never named this datasource", async () => {
    const decision = await effectiveGrant({
      store: store([ceiling([[OUTLOOK, 4]]), row(PROJECT, [[SHAREPOINT, 4]])]),
      ...ask({ datasource: SHAREPOINT, tier: 1 }),
    });
    expect(decision.reason).toBe("no_ceiling_grant_for_datasource");
    expect(decision.allowed).toBe(false);
  });

  it("refuses when the ceiling grants it but this project has no row", async () => {
    const decision = await effectiveGrant({
      store: store([ceiling([[SHAREPOINT, 4]])]),
      ...ask({ datasource: SHAREPOINT, tier: 1 }),
    });
    expect(decision.reason).toBe("no_project_row");
    expect(decision.ceilingGranted).toBe(true);
    expect(decision.projectGranted).toBe(false);
  });

  it("a request scoped to '*' itself is answered by the ceiling row alone", async () => {
    const decision = await effectiveGrant({
      store: store([ceiling([[SHAREPOINT, 2]])]),
      ...ask({ datasource: SHAREPOINT, tier: 2, projectId: CEILING_PROJECT_ID }),
    });
    expect(decision.allowed).toBe(true);
  });
});

describe("the per-project view is built from the ceiling, never from the project row", () => {
  it("never surfaces a datasource the ceiling does not name", () => {
    const grants = intersectGrantRows(
      ceiling([[SHAREPOINT, 2]]),
      row(PROJECT, [
        [SHAREPOINT, 4],
        [OUTLOOK, 4],
      ]),
    );
    expect(grants.map((g) => datasourceKey(g.datasource))).toEqual([datasourceKey(SHAREPOINT)]);
    expect(grants[0]?.tiers).toEqual([1, 2]);
  });

  it("keeps a ceiling entry the project has not consented to, reaching nothing", () => {
    const grants = intersectGrantRows(ceiling([[SHAREPOINT, 4]]), row(PROJECT, []));
    expect(grants).toHaveLength(1);
    // named, but empty — distinguishable from "never granted", by design
    expect(grants[0]?.tiers).toEqual([]);
  });
});
