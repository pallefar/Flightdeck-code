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

/** Why a spec cannot be taken through `scripts/promote.sh` or
 * `scripts/mount-in-host.sh` into the host. */
export type CertifiableRefusal = "table_backed_needs_migration" | "profile_unrecognised";

export type CertifiableVerdict =
  | { readonly ok: true; readonly profile: "mini-app" }
  | { readonly ok: false; readonly code: CertifiableRefusal; readonly reason: string };

/** ⛔ WHICH PROFILES THE HOST'S GATE CAN CERTIFY: only the mini-app.
 *
 * On Postgres the host skips every sub-app `initSchema`
 * (flightdeck/server/workspace/runtime.ts: under POSTGRES_ENABLED the
 * migration files are the single source of schema truth and the application
 * role holds no DDL rights), and the host's
 * `tests/subapps/schemaMigrationParity.test.ts` fails a runtime CREATE TABLE
 * that has no migration. This generator emits a `schema.ts` for
 * "table-backed" and NO migration, so a table-backed sub-app's tables would
 * exist on SQLite and not on the tier the product ships on. Mounting or
 * promoting one would certify a sub-app that is broken where it matters.
 *
 * Reads the RAW spec, before any parsing, and fails closed: anything other
 * than an absent profile or exactly "mini-app" is refused. Generating the
 * table-backed shape (`cli.ts --out`, `--dry-run`, `--standalone`) is not
 * affected — generating is not certifying. */
export function certifiableProfile(spec: unknown): CertifiableVerdict {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    return { ok: false, code: "profile_unrecognised", reason: "the spec is not a JSON object, so it has no profile that could be certified." };
  }
  const record = spec as Record<string, unknown>;
  const profile = record["profile"];
  if (profile === undefined || profile === "mini-app") return { ok: true, profile: "mini-app" };
  const id = typeof record["id"] === "string" ? record["id"] : "(no id)";
  if (profile === "table-backed") {
    return {
      ok: false,
      code: "table_backed_needs_migration",
      reason:
        `"${id}" declares profile "table-backed". On Postgres the host skips every sub-app initSchema and takes its tables from migrations only, ` +
        `and codegen emits a schema.ts but no migration, so this sub-app's tables would not exist on the tier the product ships on ` +
        `(the host's schemaMigrationParity fence fails it for the same reason). It cannot be mounted or promoted. ` +
        `Generate it as a mini-app (${MINI_APP_FLOOR}), or have a human write and review the SQLite + Postgres migration pair in the host first.`,
    };
  }
  return {
    ok: false,
    code: "profile_unrecognised",
    reason: `"${id}" has profile ${JSON.stringify(profile)}, which is neither absent nor "mini-app"; only a mini-app can be certified, so this spec is refused rather than guessed at.`,
  };
}
