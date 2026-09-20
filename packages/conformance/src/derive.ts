/** Everything the host computes from a sub-app's `id`, recomputed here.
 *
 * ⛔ WHY THIS IS A COPY AND NOT AN IMPORT. The gate's job is to judge text
 * it did not produce — a file a model wrote, a file a human hand-edited
 * after generation, a file from an older version of the generator. If it
 * asked the generator for the expected table prefix, a generator bug would
 * be invisible to it: both sides would be wrong in the same direction and
 * the gate would pass the app. Two independent derivations of the same
 * rule catch a drift that one shared derivation cannot.
 *
 * The authority for all of it is the host repo (`killSwitch.ts`,
 * `installRoutes.ts`, `types.ts#ROUTE_PREFIX_RE`), restated in
 * `docs/FLIGHTDECK-SUBAPP-CONTRACT.md` §3. */

/** The host's `subAppManifestSchema` id rule, verbatim. */
export const SUBAPP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** The host's `ROUTE_PREFIX_RE`: one segment, no sub-path. */
export const ROUTE_PREFIX_RE = /^\/api\/apps\/[a-z0-9-]+$/;

export const NAV_SECTIONS = ["Overview", "Contract pipeline", "Ops & insight", "Admin", "System apps"] as const;

export const CAPABILITIES = ["read:contracts", "write:inbox-proposal"] as const;

export const ROLES = ["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"] as const;

/** The version `assertHostVersionCompatible` compares a manifest against. */
export const HOST_VERSION = "5.0.0";

/** `wc-clock` -> `wc_clock`. */
export function underscored(id: string): string {
  return id.replace(/-/g, "_");
}

/** `wc-clock` -> `WcClock`. An id may legally start with a digit, which
 * would derive an identifier no parser accepts, so those are prefixed —
 * the same answer `codegen/naming.ts` reaches independently. */
export function pascalCase(id: string): string {
  const raw = id
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[0-9]/.test(raw) ? `App${raw}` : raw;
}

/** `wc-clock` -> `subapp_wc_clock_`. Every table the sub-app creates. */
export function tablePrefix(id: string): string {
  return `subapp_${underscored(id)}_`;
}

/** `wc-clock` -> `idx_wc_clock_`. Index names are global in SQLite, so
 * they carry the id too. */
export function indexPrefix(id: string): string {
  return `idx_${underscored(id)}_`;
}

/** `wc-clock` -> `SUBAPP_WC_CLOCK_ENABLED`. */
export function killSwitchEnvVar(id: string): string {
  return `SUBAPP_${id.toUpperCase().replace(/-/g, "_")}_ENABLED`;
}

export function routePrefix(id: string): string {
  return `/api/apps/${id}`;
}

export function navPath(id: string): string {
  return `/console/apps/${id}`;
}

/** The per-request enable check every handler must call first. */
export function guardFunctionName(id: string): string {
  return `require${pascalCase(id)}Enabled`;
}

export function serverDir(id: string): string {
  return `server/subapps/${id}`;
}

export function webDir(webModuleId: string): string {
  return `web/src/subapps/${webModuleId}`;
}

/** Numeric-segment compare, ported from `registry.ts#isVersionNewer`. A
 * lexical compare would call "5.9.0" newer than "5.10.0". */
export function isVersionNewer(version: string, baseline: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = baseline.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}
