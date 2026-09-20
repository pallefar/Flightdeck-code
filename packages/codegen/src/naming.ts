/** Every name a generated sub-app uses, derived from its id in ONE place.
 *
 * ⭐ Why one module. The contract calls the id "locked once shipped" because
 * four separate things are computed from it — the kill-switch env var, the
 * nav path, the table prefix and the route prefix — in four separate host
 * files. A generator that recomputed any of them inline would be a fifth
 * copy of a derivation that must agree with the host's, with nothing making
 * it agree. These functions are byte-compatible with
 * `killSwitch.ts#subAppKillSwitchEnabled`, `installRoutes.ts`'s nav path and
 * `types.ts#ROUTE_PREFIX_RE`, and `naming.test.ts` pins each one. */

/** `wc-clock` -> `wc_clock`. The table-prefix and env-var spelling. */
export function underscored(id: string): string {
  return id.replace(/-/g, "_");
}

/** `wc-clock` -> `WcClock`, used for type and function names.
 *
 * An id may legally START WITH A DIGIT (`/^[a-z0-9][a-z0-9-]*$/`), which
 * would derive an identifier no JavaScript parser accepts. Prefixing is the
 * only correct answer — silently dropping the digit would make `3d-maps`
 * and `d-maps` generate the same symbol names. */
export function pascalCase(id: string): string {
  const raw = id
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[0-9]/.test(raw) ? `App${raw}` : raw;
}

/** `wc-clock` -> `wcClock`, used for the exported manifest const. */
export function camelCase(id: string): string {
  const pascal = pascalCase(id);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** `wc-clock` -> `SUBAPP_WC_CLOCK_ENABLED`. Exactly
 * `killSwitch.ts`'s `SUBAPP_${id.toUpperCase().replace(/-/g,"_")}_ENABLED`. */
export function killSwitchEnvVar(id: string): string {
  return `SUBAPP_${id.toUpperCase().replace(/-/g, "_")}_ENABLED`;
}

/** `wc-clock` -> `subapp_wc_clock_`. Every table the sub-app creates starts
 * with this; `missingSubappTables` derives the same prefix to find them. */
export function tablePrefix(id: string): string {
  return `subapp_${underscored(id)}_`;
}

export function tableName(id: string, bare: string): string {
  return `${tablePrefix(id)}${bare}`;
}

/** Index names are global in SQLite, so they carry the sub-app id too —
 * `idx_wc_clock_entries_ticket`. Mirrors docusign's
 * `idx_docusign_fields_envelope` spelling. */
export function indexName(id: string, bareTable: string, columns: readonly string[]): string {
  return `idx_${underscored(id)}_${bareTable}_${columns.join("_")}`;
}

/** Must satisfy the host's ROUTE_PREFIX_RE: `/^\/api\/apps\/[a-z0-9-]+$/` —
 * one segment, no sub-path. */
export function routePrefix(id: string): string {
  return `/api/apps/${id}`;
}

/** The console nav path `installRoutes.ts` builds for an enabled sub-app. */
export function navPath(id: string): string {
  return `/console/apps/${id}`;
}

export function manifestConstName(id: string): string {
  return `${camelCase(id)}Manifest`;
}

export function guardFunctionName(id: string): string {
  return `require${pascalCase(id)}Enabled`;
}

export function disabledErrorName(id: string): string {
  return `${pascalCase(id)}DisabledError`;
}

export function subAppIdConstName(id: string): string {
  return `${id.toUpperCase().replace(/-/g, "_")}_SUBAPP_ID`;
}

export function schemaConstName(id: string): string {
  return `${id.toUpperCase().replace(/-/g, "_")}_SCHEMA`;
}

export function applySchemaFunctionName(id: string): string {
  return `apply${pascalCase(id)}Schema`;
}

export function registerRoutesFunctionName(id: string): string {
  return `register${pascalCase(id)}Routes`;
}

export function registerDomainRoutesFunctionName(id: string, domain: string): string {
  return `register${pascalCase(id)}${pascalCase(domain)}Routes`;
}

/** Where each emitted file lands, relative to the host repo root. */
export function serverDir(id: string): string {
  return `server/subapps/${id}`;
}

export function webDir(webModuleId: string): string {
  return `web/src/subapps/${webModuleId}`;
}

/** camelCase body key -> snake_case column, for the default mapping when a
 * `FieldSpec` does not name its column explicitly. */
export function snakeCase(camel: string): string {
  return camel.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
