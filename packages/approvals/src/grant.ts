/**
 * THE CEILING-AND-NARROW SHAPE, second dimension.
 *
 * The host already solved this for sub-apps, and the semantics are not obvious,
 * so they are repeated here in its own words (`subapps/installRow.ts`):
 *
 *     enablement is a three-layer AND — the env kill switch, the '*' ceiling
 *     row, and that project's row — and grantedScopes come ONLY from the
 *     ceiling row; a project may turn a sub-app OFF, never widen consent.
 *
 * This package adds a SECOND dimension — per DATASOURCE — with the same shape.
 * A grant answers exactly one question:
 *
 *     may THIS tool, in THIS project, touch THIS datasource, up to THIS tier?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOW NARROWING IS STRUCTURAL RATHER THAN CHECKED
 * ─────────────────────────────────────────────────────────────────────────
 * The brief was explicit: a project row claiming more than the ceiling must not
 * produce a wider result EVEN IF SOMEONE WRITES ONE INTO THE STORE. A validating
 * check ("refuse if project.maxTier > ceiling.maxTier") is the wrong instrument
 * — it is one `if` away from being forgotten, and it makes a bad row an ERROR
 * rather than a no-op. Four properties do it structurally instead:
 *
 *  1. PROVENANCE. Every field of an `EffectiveGrant` is taken from the CEILING
 *     object. The project row is consulted only through a boolean predicate; no
 *     value on it is ever copied into the result. `datasource` is the ceiling
 *     entry's own `DatasourceRef` — literally the same object reference.
 *
 *  2. THE TIER SET IS A FILTER OF THE CEILING'S TIER SET.
 *     `ceilingTiers.filter(t => projectTiers.includes(t))`. `Array.filter`
 *     cannot introduce an element that was not in the receiver, so
 *     `effective ⊆ ceilingTiers` holds by the method's own contract, for every
 *     input, including a project row claiming tier 4 under a tier-2 ceiling.
 *     This is why `tiersUpTo()` returns a SET and not a `maxTier` number: a
 *     `Math.min` of two numbers is an assertion about arithmetic I would have to
 *     get right, a filter is a subset by construction.
 *
 *  3. THE ITERATION IS OVER THE CEILING. Datasource lookup starts at the ceiling
 *     row and short-circuits; `intersectGrantRows` MAPS the ceiling's entries.
 *     A datasource the ceiling does not name has no seat to be filtered into, so
 *     a project row naming `Outlook` under a SharePoint-only ceiling contributes
 *     nothing — there is no code path that reads the project's entry list to
 *     decide WHAT exists, only to decide whether a ceiling entry SURVIVES.
 *
 *  4. NO OTHER PRODUCER EXISTS. `EffectiveGrant` carries a brand keyed by a
 *     `unique symbol` that this module declares and does not export, so no other
 *     module can write an object literal of that type. The single `as` cast in
 *     this file is the only mint in the package, and `effectiveGrant()` takes no
 *     `EffectiveGrant` parameter — there is nowhere to inject one.
 */

import { datasourceKey, type DatasourceGrantEntry, type DatasourceRef } from "./datasource";
import { tiersUpTo, type DataTier } from "./tiers";

/**
 * The brand. A REAL symbol, not an ambient `declare const`, and not exported.
 *
 * That choice is the whole of property 4 above. A `declare const` brand has no
 * runtime value, so minting one needs an `as` cast — and a cast is an assertion
 * a future edit can copy elsewhere. A real, module-private `Symbol()` needs no
 * cast at all: `mint` writes the property, and no other module can write it
 * because no other module can name the key. The nominality is enforced by
 * JavaScript scoping rather than by TypeScript's goodwill, and there is
 * consequently not a single type assertion in this file.
 *
 * (Symbol keys are skipped by `JSON.stringify` and by `Object.keys`, so the
 * brand never reaches a wire format or an audit body.)
 */
const EFFECTIVE_GRANT_BRAND: unique symbol = Symbol("approvals.effectiveGrant");

/**
 * One row of the grant store. `projectId === CEILING_PROJECT_ID` ('*') makes it
 * the ceiling — "the maximum any project in this Function may have". Any other
 * id makes it a per-project row, which can only ever remove.
 *
 * A row is a CLAIM, not an authority. Nothing validates a project row against
 * the ceiling on write, by design: a project row claiming tier 4 is harmless
 * because `intersectGrant` cannot turn it into a tier-4 result, and refusing it
 * on write would mean a ceiling that is later RAISED leaves the project stuck at
 * a value it was forced to lower — exactly the host's "a closing ceiling is a
 * ceiling closing, not a revocation" idiom, read in the other direction.
 */
export interface GrantRow {
  readonly projectId: string;
  readonly toolId: string;
  readonly datasources: readonly DatasourceGrantEntry[];
  /** ISO timestamp. Set = this whole row is off. Revocation archives, never deletes. */
  readonly revokedAt?: string | null;
  /**
   * The row's version, ASSIGNED BY THE STORE on every write — a caller's value
   * is overwritten, never trusted. Absent counts as 0 (a row written before
   * the field existed). It exists so a write can say which version it was
   * based on and be refused when that is no longer current (`store.ts`,
   * `GrantRowConflictError`); without it two operators' writes were
   * last-write-wins and a narrowing could vanish under a widening.
   *
   * ⚠ Nothing in this file reads it. It is concurrency bookkeeping, not a
   * grant: the intersection's provenance rule above is unchanged, and a rev
   * cannot widen or narrow anything.
   */
  readonly rev?: number;
}

/**
 * The result of intersecting a project row with the ceiling. Obtainable ONLY
 * from `intersectGrant`/`intersectGrantRows` below.
 */
export interface EffectiveGrant {
  readonly [EFFECTIVE_GRANT_BRAND]: true;
  readonly toolId: string;
  readonly projectId: string;
  /** The CEILING entry's own ref — never the project row's copy of it. */
  readonly datasource: DatasourceRef;
  /** A subset of the ceiling's own tier set. Possibly empty. */
  readonly tiers: readonly DataTier[];
}

/**
 * Why an intersection produced nothing, kept separate from `GrantReason` so the
 * set algebra here has no opinion about how a UI phrases it. `decision.ts` maps
 * these onto reason codes.
 */
export type Intersection =
  | {
      readonly outcome: "granted";
      readonly grant: EffectiveGrant;
      readonly ceilingMaxTier: DataTier;
      readonly projectMaxTier: DataTier;
    }
  | { readonly outcome: "no-ceiling-row" }
  | { readonly outcome: "ceiling-revoked" }
  | { readonly outcome: "no-ceiling-entry" }
  | { readonly outcome: "no-project-row"; readonly ceilingMaxTier: DataTier }
  | { readonly outcome: "project-revoked"; readonly ceilingMaxTier: DataTier }
  | { readonly outcome: "no-project-entry"; readonly ceilingMaxTier: DataTier };

/**
 * Exact-key lookup. `datasourceKey` is the whole matching algorithm (see
 * `datasource.ts`): no prefix, no wildcard, no parent-implies-child. A linear
 * scan is deliberate — a grant row names a handful of datasources, and a Map
 * built once would be a cache, which is the thing this package refuses to keep.
 */
function entryFor(row: GrantRow, wanted: DatasourceRef): DatasourceGrantEntry | null {
  const key = datasourceKey(wanted);
  for (const entry of row.datasources) {
    if (datasourceKey(entry.datasource) === key) return entry;
  }
  return null;
}

function revoked(row: GrantRow): boolean {
  return typeof row.revokedAt === "string" && row.revokedAt.length > 0;
}

/**
 * Mint an `EffectiveGrant`. THE ONLY PLACE IN THE PACKAGE THAT DOES.
 *
 * `ceilingEntry` supplies every value; `projectTiers` is consulted only by
 * `Array.prototype.includes`, i.e. as a predicate — read the two lines below and
 * note that no expression evaluates to a value taken off the project row.
 */
function mint(
  toolId: string,
  projectId: string,
  ceilingEntry: DatasourceGrantEntry,
  projectTiers: readonly DataTier[],
): EffectiveGrant {
  const ceilingTiers = tiersUpTo(ceilingEntry.maxTier);
  return {
    [EFFECTIVE_GRANT_BRAND]: true,
    toolId,
    projectId,
    datasource: ceilingEntry.datasource,
    tiers: ceilingTiers.filter((tier) => projectTiers.includes(tier)),
  };
}

/**
 * The intersection for ONE datasource: ceiling first, project as a filter.
 *
 * Pass the SAME row as both arguments for a request scoped to `'*'` itself —
 * that mirrors `effectiveSubAppEnabled`, where "the ceiling row IS the project
 * row" and the AND is satisfied by one row.
 */
export function intersectGrant(
  ceilingRow: GrantRow | null,
  projectRow: GrantRow | null,
  wanted: DatasourceRef,
): Intersection {
  // ── Layer 1: the ceiling. Nothing below can widen what is not here. ──
  if (!ceilingRow) return { outcome: "no-ceiling-row" };
  if (revoked(ceilingRow)) return { outcome: "ceiling-revoked" };
  const ceilingEntry = entryFor(ceilingRow, wanted);
  if (!ceilingEntry) return { outcome: "no-ceiling-entry" };
  const ceilingMaxTier = ceilingEntry.maxTier;

  // ── Layer 2: the project, which may only remove. ──
  if (!projectRow) return { outcome: "no-project-row", ceilingMaxTier };
  if (revoked(projectRow)) return { outcome: "project-revoked", ceilingMaxTier };
  const projectEntry = entryFor(projectRow, wanted);
  if (!projectEntry) return { outcome: "no-project-entry", ceilingMaxTier };

  return {
    outcome: "granted",
    grant: mint(ceilingRow.toolId, projectRow.projectId, ceilingEntry, tiersUpTo(projectEntry.maxTier)),
    ceilingMaxTier,
    projectMaxTier: projectEntry.maxTier,
  };
}

/**
 * The same intersection across EVERY datasource the ceiling names — the "what
 * may this project have" view a consent screen renders.
 *
 * Note what it iterates: `ceilingRow.datasources`. A project row naming a
 * datasource the ceiling does not is not merely filtered out, it is never
 * visited, so this function's output is a subset of the ceiling's entries by the
 * shape of the loop and not by a predicate anyone could weaken. Entries whose
 * intersection is empty are kept, carrying `tiers: []` — "named but reaching
 * nothing" is a state a UI must be able to show, and dropping it would make it
 * indistinguishable from "never granted" (the host's `projectConsented` lesson).
 */
export function intersectGrantRows(
  ceilingRow: GrantRow | null,
  projectRow: GrantRow | null,
): readonly EffectiveGrant[] {
  if (!ceilingRow || revoked(ceilingRow)) return [];
  const projectUsable = !!projectRow && !revoked(projectRow);
  return ceilingRow.datasources.map((ceilingEntry) => {
    const projectEntry = projectUsable && projectRow ? entryFor(projectRow, ceilingEntry.datasource) : null;
    const projectTiers = projectEntry ? tiersUpTo(projectEntry.maxTier) : [];
    return mint(ceilingRow.toolId, projectRow?.projectId ?? ceilingRow.projectId, ceilingEntry, projectTiers);
  });
}

/** Read-only view of a minted grant. Present so callers never re-derive one. */
export function grantAllows(grant: EffectiveGrant, tier: DataTier): boolean {
  return grant.tiers.includes(tier);
}
