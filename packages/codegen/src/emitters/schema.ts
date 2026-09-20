/** `schema.ts` — the sub-app's own DDL, emitted only when the spec declares
 * tables.
 *
 * Every table name carries the `subapp_<id_underscored>_` prefix, because
 * that prefix is how the host finds a sub-app's tables at all
 * (`missingSubappTables` derives it from the id). A spec declares the BARE
 * name and never writes the prefix, so it cannot forget it or get it wrong.
 *
 * `CREATE TABLE IF NOT EXISTS`, mirroring `server/db.ts`'s SCHEMA const
 * style: `initSchema` runs on every boot for every workspace, so it has to
 * be idempotent. Every table gets `id` / `created_at` / `created_by`
 * whether or not the spec asked — a generated row that cannot say who made
 * it and when is a row no audit trail can explain. */
import { assertSafeSqlIdentifier, banner, joinLines, sqlStringLiteral } from "../emit";
import type { PlannedTable, SubAppPlan } from "../plan";

export function emitSchema(plan: SubAppPlan): string {
  const ddl: string[] = [];
  for (const table of plan.tables) {
    ddl.push(emitTable(table));
    for (const index of table.indexes) {
      assertSafeSqlIdentifier(index.name, "index name");
      const columns = index.columns.map((c) => assertSafeSqlIdentifier(c, "index column")).join(", ");
      ddl.push(`CREATE INDEX IF NOT EXISTS ${index.name} ON ${table.full}(${columns});`);
    }
  }

  return joinLines([
    banner([
      `${plan.label} sub-app schema — GENERATED. The COMPLETE \`${plan.tablePrefix}*\` DDL, written once: regenerate from the spec rather than adding a migration beside it.`,
      "",
      "Idempotent `CREATE TABLE IF NOT EXISTS` — `initSchema` runs on every boot, for every workspace. Every table lives inside that workspace's OWN db (workspace-keyed by construction; no module-level handle).",
      "",
      "`id`, `created_at` and `created_by` are emitted on every table by codegen, not by the spec. They are what make a generated row attributable.",
    ]),
    `import type { Db } from "../../db.js";`,
    "",
    `export const ${plan.names.schemaConst} = \``,
    ddl.join("\n"),
    "`;",
    "",
    `export async function ${plan.names.applySchemaFn}(db: Db): Promise<void> {`,
    `  await db.exec(${plan.names.schemaConst});`,
    "}",
    "",
  ]);
}

function emitTable(table: PlannedTable): string {
  assertSafeSqlIdentifier(table.full, "table name");
  const lines = table.columns.map((column) => {
    assertSafeSqlIdentifier(column.name, "column name");
    if (column.name === "id") return "  id TEXT PRIMARY KEY";
    const parts = [`  ${column.name} ${column.sqlType}`];
    if (column.notNull) parts.push("NOT NULL");
    if (column.values !== null) {
      const list = column.values.map((v) => sqlStringLiteral(v, "CHECK value")).join(",");
      parts.push(`CHECK(${column.name} IN (${list}))`);
    }
    return parts.join(" ");
  });
  return `CREATE TABLE IF NOT EXISTS ${table.full}(\n${lines.join(",\n")}\n);`;
}
