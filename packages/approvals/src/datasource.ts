/**
 * What a datasource IS, and — more important — what naming one does NOT imply.
 *
 * Two families live behind one shape, because the grant table has to hold both:
 *
 *   connector  — `boot.json#connectors`. Today one entry, `microsoft-365`,
 *                whose `scope` array is `["SharePoint","Teams","Outlook","Entra"]`.
 *                A connector is therefore NOT an atom: it is a bundle of
 *                sub-scopes with very different blast radii.
 *   repo-path  — the on-disk roots the OS reads: `contracts/`, `memory/`,
 *                `packs/`, `obsidian-vault/`, `activity-logs/`, `audit/`.
 *                Also not of one sensitivity: `contracts/` is the person-bearing
 *                root the whole PII boundary exists for, `packs/` is templates.
 *   database   — a named store.
 *
 * ⛔ THE RULE: A GRANT NAMES WHAT IT GRANTS. There is no prefix rule, no
 * wildcard, no parent-implies-child and no "scope omitted means all scopes".
 * Matching is EXACT EQUALITY of the canonical key below, and that is the whole
 * matching algorithm — there is no second, looser path for a caller to find.
 *
 * Why exact and not prefix: `check-contracts-boundary.sh` (SEC-V5-02) recorded
 * what a prefix-anchored guard costs — 1101 rows of person data stayed reachable
 * at a second path while 25 tests passed. A prefix is a guess about a namespace
 * somebody else owns. `microsoft-365` granted as a prefix would hand over
 * Outlook the day a connector adds it; `obsidian-vault` as a prefix would reach
 * a `contracts/` symlink under it. So: granting `{connector, microsoft-365}`
 * grants the connector ITSELF and no sub-scope, and granting
 * `{connector, microsoft-365, SharePoint}` grants SharePoint and NOT Outlook.
 * Widening is an act, and an act is a row somebody wrote.
 */

import type { DataTier } from "./tiers";

export const DATASOURCE_KINDS = ["connector", "repo-path", "database"] as const;
export type DatasourceKind = (typeof DATASOURCE_KINDS)[number];

export interface DatasourceRef {
  readonly kind: DatasourceKind;
  /** The connector id, the data root, or the database name. */
  readonly id: string;
  /**
   * The connector SUB-SCOPE (`SharePoint`) or the path root beneath `id`
   * (`input`, `proposals`). Absent is its own distinct value — it means "the
   * datasource itself", never "all of its scopes".
   */
  readonly scope?: string | undefined;
}

/** Same slug shape the host demands of project/sub-app/workspace ids. */
const DATASOURCE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * A scope may carry capitals (`SharePoint`, straight out of `boot.json`) and
 * `/` (a path root). It may not carry `..`, a leading `/`, or whitespace — a
 * scope is a NAME, and anything that could be read as traversal is refused
 * rather than normalized, because normalizing is where a widening hides.
 */
const DATASOURCE_SCOPE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const MAX_ID_LENGTH = 128;
const MAX_SCOPE_LENGTH = 256;

export function isValidDatasourceKind(value: unknown): value is DatasourceKind {
  return typeof value === "string" && (DATASOURCE_KINDS as readonly string[]).includes(value);
}

/** `null` when the ref is well-formed; otherwise the structural reason it is not. */
export function datasourceDefect(
  ref: DatasourceRef | null | undefined,
): "kind" | "id" | "scope" | "absent" | null {
  if (!ref || typeof ref !== "object") return "absent";
  if (!isValidDatasourceKind(ref.kind)) return "kind";
  if (typeof ref.id !== "string" || ref.id.length > MAX_ID_LENGTH || !DATASOURCE_ID_RE.test(ref.id)) {
    return "id";
  }
  if (ref.scope !== undefined) {
    if (
      typeof ref.scope !== "string" ||
      ref.scope.length > MAX_SCOPE_LENGTH ||
      !DATASOURCE_SCOPE_RE.test(ref.scope) ||
      ref.scope.includes("..")
    ) {
      return "scope";
    }
  }
  return null;
}

/**
 * The canonical identity of a datasource, and the ONLY thing grant lookup
 * compares.
 *
 * `\u0000` separates the parts because it cannot occur in either regex above,
 * so no `id`/`scope` pair can be re-parsed into a different pair (the classic
 * `"a:b" + ":" + "c"` vs `"a" + ":" + "b:c"` collision). An ABSENT scope
 * contributes the empty string, which no valid scope can equal — that is what
 * makes "the datasource itself" a distinct key from every sub-scope of it,
 * structurally, rather than by a `scope === undefined` branch someone could
 * later "helpfully" relax.
 */
export function datasourceKey(ref: DatasourceRef): string {
  return `${ref.kind}\u0000${ref.id}\u0000${ref.scope ?? ""}`;
}

export function sameDatasource(a: DatasourceRef, b: DatasourceRef): boolean {
  return datasourceKey(a) === datasourceKey(b);
}

/** The audit-safe projection: three identifiers, no optionality to fumble. */
export interface AuditDatasource {
  readonly kind: DatasourceKind;
  readonly id: string;
  readonly scope: string | null;
}

export function auditDatasource(ref: DatasourceRef): AuditDatasource {
  return { kind: ref.kind, id: ref.id, scope: ref.scope ?? null };
}

/** One datasource a grant row names, with the highest tier it reaches there. */
export interface DatasourceGrantEntry {
  readonly datasource: DatasourceRef;
  readonly maxTier: DataTier;
}
