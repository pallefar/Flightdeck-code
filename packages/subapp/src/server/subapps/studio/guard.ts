/** `requireStudioEnabled` — the per-request enable check every Studio handler
 * calls FIRST. Cloned from `maps/guard.ts`, which is `docusign/guard.ts` with
 * the names changed.
 *
 * Three things about it are not stylistic:
 *
 * 1. The shell's manifest-derived RBAC rule (`deriveSubAppExtraRules`) enforces
 *    ROLES ONLY. Nothing in the host checks enable-state for a sub-app's own
 *    routes, so a handler missing this call works with the kill switch off.
 * 2. Nothing is cached. The env var, the ceiling row and the project row are
 *    re-read on EVERY call. A module-level `process.env` capture would turn the
 *    kill switch into a restart-only control.
 * 3. The imports are LEAVES — `../installRow.js`, `../killSwitch.js` — never
 *    `../registry.js`. Reaching the registry for the same data would drag every
 *    sibling sub-app into this file's static import closure, which is exactly
 *    what `tests/subapps/subappImportClosure.test.ts` fails on.
 *
 * The kill switch is read separately from `effectiveSubAppEnabled` (which reads
 * it again internally) purely so the audited refusal reason stays specific:
 * "kill-switch-off" and "not-installed-or-disabled" are different operational
 * problems with different fixes.
 *
 * ⚠ `appendFlightdeckAudit` appears HERE and nowhere else in this sub-app.
 * Contract rule 5 admits it by name alongside `caps.auditAppend`, and it is the
 * only option at this point: the guard runs before any handler has resolved a
 * capability adapter, and `RegisterRoutesCtx` does not reach one. Studio's
 * ROUTES audit exclusively through `caps.auditAppend`. */
import type { FastifyRequest } from "fastify";
import { appendFlightdeckAudit } from "../../lib/flightdeckAudit.js";
import { effectiveSubAppEnabled } from "../installRow.js";
import { subAppKillSwitchEnabled } from "../killSwitch.js";
import { DEFAULT_PROJECT_ID } from "../../project/types.js";
import type { WorkspaceRuntime } from "../../workspace/types.js";

export const STUDIO_SUBAPP_ID = "studio";

export class StudioDisabledError extends Error {}

export async function requireStudioEnabled(req: FastifyRequest): Promise<WorkspaceRuntime> {
  const rt = req.workspace;
  const killSwitchOn = subAppKillSwitchEnabled(STUDIO_SUBAPP_ID);
  // The three-layer AND, scoped to this request's project:
  // SUBAPP_STUDIO_ENABLED === "true", the Function's '*' ceiling row, and this
  // project's own row. Fail-closed, default OFF.
  const state = rt
    ? await effectiveSubAppEnabled(rt.db, req.project?.id ?? DEFAULT_PROJECT_ID, STUDIO_SUBAPP_ID)
    : null;
  const enabled = killSwitchOn && state?.enabled === true;

  if (!enabled) {
    if (rt) {
      appendFlightdeckAudit(rt.root, {
        event: "studio.access.refused",
        actor: req.principal?.username ?? "anonymous",
        reason: !killSwitchOn ? "kill-switch-off" : "not-installed-or-disabled",
      });
    }
    throw new StudioDisabledError("Studio sub-app is not enabled for this workspace");
  }

  return rt as WorkspaceRuntime;
}
