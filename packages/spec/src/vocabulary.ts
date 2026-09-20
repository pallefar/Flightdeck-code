/**
 * The exact host vocabulary a generated sub-app is measured against.
 *
 * Every literal in this file is a copy of a value the Flightdeck host compares by
 * string equality (`docs/FLIGHTDECK-SUBAPP-CONTRACT.md` §2, §3). Nothing in Studio may
 * re-spell them, fuzzy-match them or let a model invent a sixth one: `loadValidatedManifests`
 * is fail-loud, so one wrong literal takes the whole server down at boot.
 *
 * This module is the single source of truth for those literals and for everything the
 * host derives from `id`. It has no dependencies on purpose — schema, planner, codegen and
 * conformance all read the same constants.
 */

/** Host version Studio currently targets. A sub-app's `minHostVersion` must be <= this. */
export const HOST_VERSION = "5.0.0";

/** Exact `UI_NAV_SECTIONS` strings. Matched with `===`, never normalized by the host. */
export const NAV_SECTIONS = [
  "Overview",
  "Contract pipeline",
  "Ops & insight",
  "Admin",
  "System apps",
] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

/**
 * The only two scopes a sub-app may ever hold. The array *is* the human consent screen
 * (contract §5.9), which is why Studio treats adding one as a consent decision and removing
 * one as free.
 */
export const CAPABILITIES = ["read:contracts", "write:inbox-proposal"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Roles the shell can enforce. `visibleToRoles` must be a non-empty subset. */
export const ROLES = ["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** `/^[a-z0-9][a-z0-9-]*$/` — from `subAppManifestSchema`. */
export const SUBAPP_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** `/^\/api\/apps\/[a-z0-9-]+$/` — one segment, no sub-path. */
export const ROUTE_PREFIX_PATTERN = /^\/api\/apps\/[a-z0-9-]+$/;
/** Postgres identifier ceiling; a derived table name longer than this is truncated silently by PG. */
export const MAX_TABLE_NAME_LENGTH = 63;
/** Ceiling on the *logical* table name, before the id-derived prefix is added. */
export const MAX_LOGICAL_TABLE_NAME_LENGTH = 32;

/** Contract rules, quoted so a refusal can cite why Studio will not guess. */
export const CONTRACT_RULES = {
  leastPrivilege:
    "contract §5.9 - the capabilities array is the human consent screen, so it must be the narrowest set the routes actually need",
  proposeDontMutate:
    "contract §5.7 - a mini app may propose, never auto-advance or resolve a gated or statutory step",
  noCapabilityEscape:
    "contract §5.3 - a route may not reach contracts, proposals or audit except through ctx.capabilitiesFor(id)",
  auditNamesFields: "contract §5.8 - audit events name fields, never PII values",
  rolesRequired:
    "contract §2 - visibleToRoles is required and non-empty, and the shell enforces roles it cannot infer",
  navSectionExact:
    "contract §2 - navSection is matched exactly against the host's UI_NAV_SECTIONS",
  idLocked:
    "contract §2/§3 - id is locked once shipped and derives the env var, nav path and table prefix",
  failLoud:
    "contract §2 - loadValidatedManifests throws on the first violation, taking the server down at boot",
} as const;
export type ContractRule = keyof typeof CONTRACT_RULES;

/** Everything the host derives from `id` (contract §3). Never model-authored. */
export interface Derivations {
  /** `/api/apps/<id>` */
  readonly routePrefix: string;
  /** directory under `web/src/subapps/` */
  readonly webModuleId: string;
  /** `/console/apps/<id>` */
  readonly navPath: string;
  /** `SUBAPP_<ID>_ENABLED`, which must equal the string "true" */
  readonly enableEnvVar: string;
  /** `subapp_<id>_` - prefix of every table this sub-app creates */
  readonly tablePrefix: string;
}

const underscored = (id: string): string => id.replace(/-/g, "_");

export const routePrefixFor = (id: string): string => `/api/apps/${id}`;
export const navPathFor = (id: string): string => `/console/apps/${id}`;
export const enableEnvVarFor = (id: string): string => `SUBAPP_${underscored(id).toUpperCase()}_ENABLED`;
export const tablePrefixFor = (id: string): string => `subapp_${underscored(id)}_`;
export const webModuleIdFor = (id: string): string => id;

export function derivationsFor(id: string): Derivations {
  return {
    routePrefix: routePrefixFor(id),
    webModuleId: webModuleIdFor(id),
    navPath: navPathFor(id),
    enableEnvVar: enableEnvVarFor(id),
    tablePrefix: tablePrefixFor(id),
  };
}

export const isNavSection = (value: unknown): value is NavSection =>
  typeof value === "string" && (NAV_SECTIONS as readonly string[]).includes(value);

export const isCapability = (value: unknown): value is Capability =>
  typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);

export const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (ROLES as readonly string[]).includes(value);

/**
 * Accepts a nav section only when it is the same literal modulo case and whitespace
 * ("contract pipeline" -> "Contract pipeline"). That is a spelling fix, not a guess.
 * Anything semantic ("Contracts", "Pipeline") returns null so the caller asks the user.
 */
export function normalizeNavSection(raw: string): NavSection | null {
  const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
  return NAV_SECTIONS.find((section) => section.toLowerCase() === key) ?? null;
}

export type Semver = readonly [major: number, minor: number, patch: number];

export function parseSemver(value: string): Semver | null {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, major, minor, patch] = match;
  return [Number(major), Number(minor), Number(patch)] as const;
}

/** -1 if a < b, 0 if equal, 1 if a > b. Returns null when either side is not a semver. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) {
    return null;
  }
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/** True when `minHostVersion` is <= the host we target - the server refuses to boot otherwise. */
export function satisfiesHostCeiling(minHostVersion: string, hostVersion: string = HOST_VERSION): boolean {
  const ordering = compareSemver(minHostVersion, hostVersion);
  return ordering !== null && ordering <= 0;
}
