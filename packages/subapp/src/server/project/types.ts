/** HOST STAND-IN — not emitted. See `src/server/db.ts`. */

/** `server/project/types.ts:43` in the host, verbatim. */
export const DEFAULT_PROJECT_ID = "general";

/** What `req.project` carries. The host's type has more fields; the guard
 * reads `id` and nothing else. */
export interface RequestProject {
  readonly id: string;
}
