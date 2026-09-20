/**
 * The TE four-tier data classification, as this package consumes it.
 *
 *   1 Public · 2 Internal · 3 Confidential · 4 Restricted
 *
 * ⛔ THIS PACKAGE NEVER COMPUTES A TIER. Classification is `packages/guardrails`'
 * job (`classify()` walks a value and returns the MAXIMUM tier it finds). An
 * approval decision only ever RECEIVES a tier and asks whether the grants on
 * record reach that far. Two modules deciding what "confidential" means is the
 * divergent-second-opinion defect the host names in `installRow.ts`
 * ("never a second, divergent eligibility query").
 *
 * The import below is TYPE-ONLY and deliberately narrow: one type, from the
 * leaf module that defines it, so nothing in guardrails' runtime closure is
 * pulled into an approval check. `TierBridge` is a compile-time assertion that
 * the two spellings are the SAME four values — if guardrails ever grows a fifth
 * tier or renumbers, this file fails to compile instead of silently letting a
 * tier fall outside `DATA_TIERS` and read as "not granted".
 *
 * NOTE (integration): `packages/guardrails` has no `index.ts` yet — its public
 * surface is still being drawn. When it publishes one, change the specifier
 * below to that index. This is the only line in this package that names
 * guardrails at all.
 */

import type { Tier } from "../../guardrails/src/findings";

export type DataTier = 1 | 2 | 3 | 4;

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compile-time only: `DataTier` and guardrails' `Tier` are the same set. */
export type TierBridge = Exactly<DataTier, Tier> extends true ? true : never;

/** Ascending, and the ONLY list any tier arithmetic in this package walks. */
export const DATA_TIERS = [1, 2, 3, 4] as const satisfies readonly DataTier[];

/** Stable machine names. i18n keys for a UI to look up — never rendered prose. */
export const TIER_NAMES = {
  1: "public",
  2: "internal",
  3: "confidential",
  4: "restricted",
} as const satisfies Record<DataTier, string>;

export type TierName = (typeof TIER_NAMES)[DataTier];

/**
 * The line the user drew: "Categories 3 and 4 require explicit named-human
 * approval." Expressed as a threshold rather than a two-member set so a future
 * tier 5 lands on the strict side by arithmetic, not by someone remembering to
 * add it to a list.
 */
export const NAMED_APPROVAL_FROM_TIER = 3 satisfies DataTier;

export function requiresNamedApproval(tier: DataTier): boolean {
  return tier >= NAMED_APPROVAL_FROM_TIER;
}

export function isDataTier(value: unknown): value is DataTier {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * Every tier at or below `max`, as a FILTER of `DATA_TIERS`.
 *
 * Returning a filtered subset rather than a `maxTier` number is what lets the
 * intersection in `grant.ts` be a set operation (see `intersectGrant`): the
 * effective tier set is the ceiling's own array with elements REMOVED, and an
 * array filter has no way to add one back.
 */
export function tiersUpTo(max: DataTier): readonly DataTier[] {
  return DATA_TIERS.filter((tier) => tier <= max);
}
