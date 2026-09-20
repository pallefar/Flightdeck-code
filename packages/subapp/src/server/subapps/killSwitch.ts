/** HOST STAND-IN — not emitted. See `src/server/db.ts`.
 *
 * Copied VERBATIM from `flightdeck/server/subapps/killSwitch.ts`, because it is
 * pure: a `process.env` read with no dependency of its own. A stand-in that
 * approximated it would make every enable-state test in this package prove
 * something about the approximation instead of about layer 1 of the AND. */
export function subAppKillSwitchEnabled(id: string): boolean {
  const envName = `SUBAPP_${id.toUpperCase().replace(/-/g, "_")}_ENABLED`;
  return process.env[envName] === "true";
}
