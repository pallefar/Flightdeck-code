/** The two shapes this generator can emit — and which one it is FOR.
 *
 * ⭐ THE MINI-APP IS THE PRODUCT. Studio converts a Cowork workflow (a
 * skill: YAML frontmatter plus a `## Procedure` of numbered steps) into a
 * small Flightdeck sub-app with a front end. Measured in the host, of its
 * four hand-written sub-apps exactly one is database-free —
 * `shell-reference`, whose manifest carries `initSchema: () => {}` and
 * which ships three files: `manifest.ts`, `routes.ts` and
 * `web/src/subapps/<id>/index.tsx`. That is the floor a mini-app targets,
 * and it is the DEFAULT profile here. `docusign`, `maps` and `advantage`
 * all apply a schema; none of them is a mini-app.
 *
 * ── WHY A MINI-APP MAY NOT DECLARE TABLES ───────────────────────────
 * Not squeamishness about SQL. A table is a MIGRATION: `initSchema` runs
 * on every boot for every workspace, the host looks for the sub-app's
 * tables by the `subapp_<id>_` prefix, and a generated DDL that lands in
 * somebody's workspace database is a change no proposal can take back.
 * The whole architecture Studio runs inside says the opposite: a sub-app
 * route reaches the host ONLY through the injected capability adapter
 * (`readContracts` / `writeInboxProposal` / `listOwnInboxProposals` /
 * `auditAppend` / `resolveSigningAuthority`), and contract rule 7 is
 * "propose, don't mutate". A mini-app's durable trace is a file in
 * `memory/proposals/` that a human resolves — nothing else.
 *
 * ── WHY `table-backed` STILL EXISTS ─────────────────────────────────
 * It works, it is tested, and deleting a working path to make a point is
 * how a generator loses the case it already handles. It is kept, and it is
 * marked: it is NOT the mini-app path, a spec has to name it explicitly,
 * and every emitted artefact that only exists because of it (`schema.ts`,
 * the DDL, the table-prefix assertions in the shipped conformance test)
 * says so in its own banner. */

export const PROFILES = ["mini-app", "table-backed"] as const;
export type Profile = (typeof PROFILES)[number];

/** A spec that says nothing is a mini-app. This default is the whole point
 * of the re-centring: the DB-free shape is what you get unless you ask,
 * in writing, for the other one. */
export const DEFAULT_PROFILE: Profile = "mini-app";

/** The file set a mini-app emits, as prose — used in refusals and banners
 * so the reason a file is missing is never left to inference. */
export const MINI_APP_FLOOR = "manifest.ts, guard.ts, routes/, the web module and its conformance test — no schema.ts, no DDL, no migration";

/** The refusal a mini-app spec gets when it carries tables.
 *
 * Written out in full, once, here: a refusal that says "tables are not
 * allowed" tells the author nothing about what to do next. This one names
 * the profile, the tables, the reference sub-app the rule comes from, what
 * the table path would actually emit, and the exact field that opts into
 * it. */
export function tableRefusalReason(id: string, tableNames: readonly string[]): string {
  const named = tableNames.map((name) => `"${name}"`).join(", ");
  return (
    `profile "mini-app" refuses tables, and this spec declares ${tableNames.length === 1 ? "table" : "tables"} ${named}: ` +
    `a Flightdeck mini-app is database-free, like \`shell-reference\`, the host's documented floor, whose manifest is \`initSchema: () => {}\`. ` +
    `Tables are not the mini-app path — they emit a schema.ts whose CREATE TABLE runs on every boot in every workspace, ` +
    `which is a migration a human must review and which no inbox proposal can take back. ` +
    `A mini-app's durable trace is a proposal under memory/proposals/ (contract rule 7, propose don't mutate). ` +
    `If "${id}" genuinely needs its own storage, say so in the spec with profile: "table-backed" and take that path deliberately.`
  );
}

export function isMiniApp(profile: Profile): boolean {
  return profile === "mini-app";
}
