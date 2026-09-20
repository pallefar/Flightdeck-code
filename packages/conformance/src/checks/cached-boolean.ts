/** Check 5 — never cache a boolean.
 *
 * ⛔ WHAT GOES WRONG. Enablement is a three-layer AND, re-read on every
 * call: the `SUBAPP_<ID>_ENABLED` env var, the ceiling install row, and
 * this project's row. A module-level `const ENABLED = process.env.X ===
 * "true"` turns the first layer into a value captured once at import time
 * — which means the kill switch stops being a kill switch and becomes a
 * restart request. Someone turns the app off during an incident and the
 * routes keep answering. The same is true of a cached install row or a
 * cached scope list, which additionally go stale against a database that
 * other people are editing.
 *
 * ⭐ WHY "MODULE LEVEL" IS COMPUTED AND NOT GREPPED. The evasion writes
 * itself: `const CONFIG = { enabled: process.env.X === "true" }` is still
 * module scope, and a check anchored to a line start misses it. So the
 * scanner tracks FUNCTION depth — not brace depth — and the rule is "this
 * read is not inside any function", which is the property that actually
 * matters: code at function depth zero runs once, when the host imports
 * the file.
 *
 * FD-B003 is the softer sibling: a per-call `process.env` read is not a
 * cached boolean, so it does not block, but a sub-app has no business
 * reading the environment at all — `subAppKillSwitchEnabled` is the leaf
 * that does it, and it is layer one of three. */
import type { Check } from "../check";
import { killSwitchEnvVar } from "../derive";
import { finding, type Finding } from "../finding";
import { mountedFiles } from "../analyze";
import { findTokens } from "../scan";

const ENV_ACCESSORS = ["process.env", "import.meta.env"];

/** Module-level bindings whose NAME says they hold enable-state. */
const STATE_NAME_RE = /enabled|installed|granted|killswitch/i;

/** Module-level bindings whose INITIALIZER says so, whatever they are
 * called. */
const STATE_CALL_RE = /subAppKillSwitchEnabled|effectiveSubAppEnabled|capabilitiesFor|process\.env|import\.meta\.env/;

const DECLARATION_RE = /(?:^|[;{}])\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*(?::[^=;]*)?=([^;]*)/g;

export const cachedBooleanCheck: Check = {
  name: "no-cached-boolean",
  run({ app }) {
    const out: Finding[] = [];
    const envVar = killSwitchEnvVar(app.id);

    for (const file of mountedFiles(app)) {
      if (file.role === "test" || file.role === "patch") continue;
      const { scan } = file;

      for (const accessor of ENV_ACCESSORS) {
        for (const at of findTokens(scan.skeleton, accessor)) {
          const moduleLevel = scan.functionDepthAt(at) === 0;
          out.push(
            moduleLevel
              ? finding(
                  "FD-B001",
                  file.path,
                  scan.positionAt(at),
                  `reads \`${accessor}\` at module level, where it runs once when the host imports this file — ${envVar} is layer one of a three-layer AND that must be re-read on every call, so a value captured here makes the kill switch a restart-only control`,
                  scan.lineTextAt(at),
                )
              : finding(
                  "FD-B003",
                  file.path,
                  scan.positionAt(at),
                  `reads \`${accessor}\` directly — not cached, but a sub-app reaches enablement through subAppKillSwitchEnabled and the install row, which are the other two layers this read skips`,
                  scan.lineTextAt(at),
                ),
          );
        }
      }

      for (const match of scan.skeleton.matchAll(DECLARATION_RE)) {
        const at = match.index ?? 0;
        if (scan.functionDepthAt(at) !== 0) continue;
        const name = match[1] ?? "";
        const initializer = match[2] ?? "";
        const byName = STATE_NAME_RE.test(name);
        const byCall = STATE_CALL_RE.test(initializer);
        if (!byName && !byCall) continue;
        // Already reported, more precisely, by FD-B001.
        if (!byName && ENV_ACCESSORS.some((accessor) => initializer.includes(accessor))) continue;
        const offset = at + (match[0] ?? "").indexOf(name);
        out.push(
          finding(
            "FD-B002",
            file.path,
            scan.positionAt(offset),
            `module-level \`${name}\` holds enable-state that must be re-read on every call — the kill switch, the ceiling row and this project's row are all live values, and a binding evaluated at import time answers with whatever was true at boot`,
            scan.lineTextAt(offset),
          ),
        );
      }
    }

    return out;
  },
};
