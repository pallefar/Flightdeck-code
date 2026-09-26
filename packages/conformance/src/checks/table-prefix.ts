/** Check 6 — every table this app touches is its own.
 *
 * ⛔ WHY THE PREFIX IS NOT A CONVENTION. `subapp_<id_underscored>_` is how
 * the host FINDS a sub-app's tables at all: `missingSubappTables` derives
 * the prefix from the id and looks for what is missing. A table outside it
 * is invisible to that check, survives an uninstall, and — if the name
 * collides with a host table or another sub-app's — is a generated app
 * quietly writing into somebody else's data. Index names are global in
 * SQLite, so they carry the id too.
 *
 * ⭐ CHECKED ON THE SQL, NOT ON THE SPEC. The DDL is read out of the
 * string literals in the file, which is where it will be when it runs.
 * Checking the spec's table list would prove the generator computed the
 * right name and say nothing about what the emitter wrote. A literal that
 * does not look like SQL is skipped, so an English sentence containing the
 * word "from" is not interrogated for a table name. */
import type { Check } from "../check";
import { indexPrefix, tablePrefix } from "../derive";
import { finding, type Finding } from "../finding";
import { mountedServerFiles } from "../analyze";
import { offsetInLiteral, type StringLiteral } from "../scan";

const LOOKS_LIKE_SQL = /\b(SELECT|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE|DROP\s+TABLE)\b/i;

const CREATE_TABLE = /\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_.]*)/gi;
const ALTER_OR_DROP = /\b(ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_.]*)/gi;
const CREATE_INDEX = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_.]*)/gi;
const TABLE_REFERENCE = /\b(FROM|JOIN|INTO|UPDATE)\s+([A-Za-z_][A-Za-z0-9_.]*)/gi;

/** A literal that STOPS where the table name should be: the name is being
 * concatenated on from somewhere this check cannot read. */
const DANGLING_CLAUSE = /\b(FROM|JOIN|INTO|UPDATE|TABLE|INDEX)\s*$/i;

export const tablePrefixCheck: Check = {
  name: "table-prefix",
  run({ app }) {
    const out: Finding[] = [];
    const prefix = tablePrefix(app.id);
    const indexes = indexPrefix(app.id);

    for (const file of mountedServerFiles(app)) {
      const { scan } = file;
      for (const literal of scan.strings) {
        if (!LOOKS_LIKE_SQL.test(literal.value)) continue;

        const report = (rule: "FD-S001" | "FD-S002" | "FD-S003" | "FD-S004", index: number, message: string): void => {
          const offset = offsetInLiteral(literal, index);
          out.push(finding(rule, file.path, scan.positionAt(offset), message, scan.lineTextAt(offset)));
        };

        // ── The name has to be READABLE before it can be checked. ──
        const interpolation = literal.template ? literal.value.indexOf("${") : -1;
        if (interpolation !== -1) {
          report(
            "FD-S004",
            interpolation,
            "interpolates into SQL — a table name that arrives at runtime cannot be checked against \`" +
              prefix +
              "\` before it is written, and the same hole is how request data reaches a query; build SQL from literals and pass values through ? placeholders",
          );
        } else if (DANGLING_CLAUSE.test(literal.value.trimEnd())) {
          report(
            "FD-S004",
            Math.max(0, literal.value.trimEnd().length - 6),
            "ends where the table name should be, so the name is concatenated on from somewhere this check cannot read — a generated sub-app writes its table names as literals, because \`" +
              prefix +
              "\` is only enforceable on text that is actually in the file",
          );
        }

        for (const match of literal.value.matchAll(CREATE_TABLE)) {
          const table = match[1] ?? "";
          if (table.startsWith(prefix)) continue;
          report(
            "FD-S001",
            indexOfGroup(match, table),
            `creates table \`${table}\`, which is not under \`${prefix}\` — missingSubappTables derives that prefix from the id to find this sub-app's tables, so a table outside it is invisible to the host and survives an uninstall`,
          );
        }

        for (const match of literal.value.matchAll(ALTER_OR_DROP)) {
          const table = match[2] ?? "";
          if (table.startsWith(prefix)) continue;
          report(
            "FD-S001",
            indexOfGroup(match, table),
            `${(match[1] ?? "").toUpperCase()}s table \`${table}\`, which is not under \`${prefix}\` — a sub-app's DDL may only shape its own tables`,
          );
        }

        for (const match of literal.value.matchAll(CREATE_INDEX)) {
          const index = match[1] ?? "";
          const table = match[2] ?? "";
          if (!index.startsWith(indexes)) {
            report(
              "FD-S003",
              indexOfGroup(match, index),
              `creates index \`${index}\`, which is not under \`${indexes}\` — index names are global in SQLite, so two sub-apps choosing the same one is a boot-time collision`,
            );
          }
          if (!table.startsWith(prefix)) {
            report(
              "FD-S001",
              indexOfGroup(match, table, index.length),
              `indexes table \`${table}\`, which is not under \`${prefix}\``,
            );
          }
        }

        for (const match of literal.value.matchAll(TABLE_REFERENCE)) {
          const table = match[2] ?? "";
          if (table.startsWith(prefix)) continue;
          // `CREATE TABLE x` and `INSERT INTO x` overlap with this pattern
          // on the same offset; FD-S001 already named those.
          if (isDdlTarget(literal.value, match.index ?? 0)) continue;
          report(
            "FD-S002",
            indexOfGroup(match, table),
            `queries table \`${table}\`, which is not under \`${prefix}\` — a sub-app reads and writes only its own tables; host data is reached through ctx.capabilitiesFor(id)`,
          );
        }
      }
    }

    // ── FD-S005: an emitted Postgres migration (mig-studio-emitted-migrations).
    // It runs as supabase_admin in every workspace schema, so it is read
    // statement by statement and every one must be an additive DDL shape
    // codegen writes, on this app's prefix: CREATE TABLE / CREATE INDEX /
    // ALTER TABLE … ADD COLUMN, each IF NOT EXISTS. A GRANT, a DO block, a
    // DROP, another schema's or app's object — anything else — is refused.
    for (const file of app.files) {
      if (file.role !== "migration") continue;
      const text = file.scan.text;
      const body = text
        .split("\n")
        .map((line) => (line.trimStart().startsWith("--") ? " ".repeat(line.length) : line))
        .join("\n");
      let from = 0;
      const pieces = body.split(";");
      if (pieces.every((piece) => piece.trim().length === 0)) {
        out.push(finding("FD-S005", file.path, file.scan.positionAt(0), "a migration with no statement in it", file.scan.lineTextAt(0)));
      }
      for (const piece of pieces) {
        const offset = from + (piece.length - piece.trimStart().length);
        from += piece.length + 1;
        const statement = piece.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
        if (statement.length === 0 || isAdditiveMigrationStatement(statement, prefix, indexes)) continue;
        out.push(
          finding(
            "FD-S005",
            file.path,
            file.scan.positionAt(offset),
            `is not an additive DDL statement on \`${prefix}*\` (CREATE TABLE / CREATE INDEX / ALTER TABLE … ADD COLUMN, each IF NOT EXISTS) — a migration runs as the database owner in every workspace, so anything else is a manual, reviewed step, never a generated one`,
            file.scan.lineTextAt(offset),
          ),
        );
      }
    }

    return out;
  },
};

const PG_COLUMN = String.raw`"[a-z][a-z0-9_]*" (?:text|bigint|double precision)(?: PRIMARY KEY)?(?: NOT NULL)?(?: CHECK \("[a-z][a-z0-9_]*" IN \('[A-Za-z0-9_.-]+'(?:,'[A-Za-z0-9_.-]+')*\)\))?`;

function isAdditiveMigrationStatement(statement: string, prefix: string, indexes: string): boolean {
  if (!/^[a-z0-9_]+$/.test(prefix) || !/^[a-z0-9_]+$/.test(indexes)) return false;
  const table = String.raw`:"schema"\."${prefix}[a-z0-9_]*"`;
  return [
    new RegExp(String.raw`^CREATE TABLE IF NOT EXISTS ${table} \(${PG_COLUMN}(?:, ${PG_COLUMN})*\)$`),
    new RegExp(String.raw`^CREATE INDEX IF NOT EXISTS "${indexes}[a-z0-9_]*" ON ${table} \("[a-z][a-z0-9_]*"(?:, "[a-z][a-z0-9_]*")*\)$`),
    new RegExp(String.raw`^ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${PG_COLUMN}$`),
  ].some((re) => re.test(statement));
}

function indexOfGroup(match: RegExpMatchArray, group: string, skip = 0): number {
  const base = match.index ?? 0;
  const at = (match[0] ?? "").indexOf(group, skip);
  return at === -1 ? base : base + at;
}

/** True when this `FROM`/`INTO`/`UPDATE` is part of a CREATE/ALTER/DROP
 * that FD-S001 has already reported. */
function isDdlTarget(sql: string, at: number): boolean {
  const before = sql.slice(Math.max(0, at - 40), at);
  return /\b(?:CREATE|ALTER|DROP)\s+(?:TEMP\s+|TEMPORARY\s+|UNIQUE\s+)?(?:TABLE|INDEX)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?$/i.test(before);
}
