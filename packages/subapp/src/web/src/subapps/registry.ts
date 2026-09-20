/** HOST STAND-IN — not emitted. See `src/server/db.ts`.
 *
 * `SubAppModule` only. The host's real file also holds the `import.meta.glob`
 * lazy-mount lookup, which is machinery a sub-app page is mounted BY and never
 * calls, so reproducing it here would model nothing the page uses. */
import type { ComponentType } from "react";

export interface SubAppModule {
  Page: ComponentType;
  Rail?: ComponentType;
  railHeading?: string;
}
