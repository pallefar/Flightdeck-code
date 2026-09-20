/** `guard.ts` — the per-request enable check every handler calls FIRST.
 *
 * A direct port of `docusign/guard.ts` and `advantage/guard.ts`, which are
 * themselves the same file with the names changed. Three things about it
 * are not stylistic:
 *
 * 1. The shell's manifest-derived RBAC rule (`deriveSubAppExtraRules`)
 *    enforces ROLES ONLY. Nothing in the host checks enable-state for a
 *    sub-app's own routes, so if this call is missing from a handler, that
 *    handler works with the kill switch off.
 * 2. Nothing is cached. The env var, the ceiling row and the project row
 *    are all re-read per call. A module-level `process.env` capture would
 *    make the kill switch a restart-only control.
 * 3. The imports are LEAVES — `../installRow.js`, `../killSwitch.js` —
 *    never `../registry.js`. Importing the registry would drag every
 *    sibling sub-app into this file's import closure, which is exactly
 *    what `tests/subapps/subappImportClosure.test.ts` fails on.
 *
 * ⚠ `appendFlightdeckAudit` appears here and NOWHERE ELSE in a generated
 * sub-app. Contract rule 5 admits it by name alongside `caps.auditAppend`,
 * and it is the only option available at this point: the guard runs before
 * any handler has resolved a capability adapter, and `RegisterRoutesCtx`
 * does not reach it. Generated ROUTES audit exclusively through
 * `caps.auditAppend`, and `invariants.ts` fails the build if one of them
 * reaches for this function instead. */
import { banner, joinLines, str } from "../emit";
import type { SubAppPlan } from "../plan";

export function emitGuard(plan: SubAppPlan): string {
  const { guardFn, disabledError, subAppIdConst } = plan.names;
  return joinLines([
    banner([
      `${guardFn} — GENERATED. Re-reads the kill switch AND this project's own live install row on EVERY call (never a cached boolean).`,
      "",
      `The three-layer AND: \`${plan.envVar}\` === "true", the Function's '*' ceiling row, and this project's row. Fail-closed, default OFF. The kill switch is read separately from \`effectiveSubAppEnabled\` purely so the audited refusal reason stays specific.`,
      "",
      "⛔ Imports only LEAF modules (`../installRow.js`, `../killSwitch.js`). Reaching `../registry.js` for the same data would pull every sibling sub-app into this file's import closure.",
    ]),
    `import type { FastifyRequest } from "fastify";`,
    `import { appendFlightdeckAudit } from "../../lib/flightdeckAudit.js";`,
    `import { effectiveSubAppEnabled } from "../installRow.js";`,
    `import { subAppKillSwitchEnabled } from "../killSwitch.js";`,
    `import { DEFAULT_PROJECT_ID } from "../../project/types.js";`,
    `import type { WorkspaceRuntime } from "../../workspace/types.js";`,
    "",
    `export const ${subAppIdConst} = ${str(plan.id)};`,
    "",
    `export class ${disabledError} extends Error {}`,
    "",
    `export async function ${guardFn}(req: FastifyRequest): Promise<WorkspaceRuntime> {`,
    "  const rt = req.workspace;",
    `  const killSwitchOn = subAppKillSwitchEnabled(${subAppIdConst});`,
    "  const state = rt",
    `    ? await effectiveSubAppEnabled(rt.db, req.project?.id ?? DEFAULT_PROJECT_ID, ${subAppIdConst})`,
    "    : null;",
    "  const enabled = killSwitchOn && state?.enabled === true;",
    "",
    "  if (!enabled) {",
    "    if (rt) {",
    "      appendFlightdeckAudit(rt.root, {",
    `        event: ${str(`${plan.id}.access.refused`)},`,
    `        actor: req.principal?.username ?? "anonymous",`,
    `        reason: !killSwitchOn ? "kill-switch-off" : "not-installed-or-disabled",`,
    "      });",
    "    }",
    `    throw new ${disabledError}(${str(`${plan.label} sub-app is not enabled for this workspace`)});`,
    "  }",
    "",
    "  return rt as WorkspaceRuntime;",
    "}",
    "",
  ]);
}
