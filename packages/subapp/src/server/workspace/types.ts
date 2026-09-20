/** HOST STAND-IN — not emitted. See `src/server/db.ts`.
 *
 * The host's `WorkspaceRuntime` carries a dozen members (bus, watcher, indexer,
 * evalRunner, orchestrator, …). Studio's sub-app reads exactly three: `id` to
 * scope the capability adapter, `db` to hand to `effectiveSubAppEnabled`, and
 * `root` for the guard's audited refusal. Only those are declared. */
import type { Db } from "../db.js";

export interface WorkspaceRuntime {
  readonly id: string;
  readonly root: string;
  readonly db: Db;
}
