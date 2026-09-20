/** HOST STAND-IN — not emitted. See `src/server/db.ts`.
 *
 * `effectiveSubAppEnabled` is layers 2 and 3 of the enablement AND: the
 * Function-wide ceiling row ('*') and this project's own row. The host reads
 * both from SQLite on every call. The stand-in keeps them in memory, keyed by
 * the `Db` object identity a test passes in, and — faithfully — refuses at
 * LAYER 1 before reading anything, exactly as the host's own
 * refuse-before-scan discipline does.
 *
 * That layer-1 fidelity is the point. A stand-in that ignored the kill switch
 * would let `__tests__/guard-first.test.ts` pass with a guard that ignored it
 * too. */
import { subAppKillSwitchEnabled } from "./killSwitch.js";
import type { Db } from "../db.js";
import type { CapabilityScope } from "./types.js";

export interface EffectiveSubAppState {
  /** The three-layer AND. */
  enabled: boolean;
  /** ONLY ever the ceiling row's scopes — a project can never widen consent. */
  grantedScopes: CapabilityScope[];
  ceilingEnabled: boolean;
  projectConsented: boolean;
  version: string | null;
}

interface StandInRow {
  ceilingEnabled: boolean;
  projectConsented: boolean;
  grantedScopes: CapabilityScope[];
  version: string | null;
}

const store = new WeakMap<object, Map<string, StandInRow>>();

function key(projectId: string, id: string): string {
  return `${projectId}\u0000${id}`;
}

/** Test seam — the stand-in's equivalent of an admin enabling the sub-app for a
 * project. Absent from the host, so nothing in the emitted tree may call it
 * (`__tests__/emit-manifest.test.ts` checks that). */
export function standInSetInstallRow(
  db: Db,
  projectId: string,
  id: string,
  row: Partial<StandInRow> & { ceilingEnabled: boolean },
): void {
  const rows = store.get(db as object) ?? new Map<string, StandInRow>();
  rows.set(key(projectId, id), {
    ceilingEnabled: row.ceilingEnabled,
    projectConsented: row.projectConsented ?? row.ceilingEnabled,
    grantedScopes: row.grantedScopes ?? [],
    version: row.version ?? null,
  });
  store.set(db as object, rows);
}

export function standInClearInstallRows(db: Db): void {
  store.delete(db as object);
}

export async function effectiveSubAppEnabled(db: Db, projectId: string, id: string): Promise<EffectiveSubAppState> {
  const base: EffectiveSubAppState = {
    enabled: false,
    grantedScopes: [],
    ceilingEnabled: false,
    projectConsented: false,
    version: null,
  };
  // Layer 1 first, before any per-project read — the host's own ordering.
  if (!subAppKillSwitchEnabled(id)) return base;
  const row = store.get(db as object)?.get(key(projectId, id));
  if (row === undefined) return base;
  return {
    enabled: row.ceilingEnabled && row.projectConsented,
    grantedScopes: row.ceilingEnabled ? row.grantedScopes : [],
    ceilingEnabled: row.ceilingEnabled,
    projectConsented: row.projectConsented,
    version: row.version,
  };
}
