/** `migrations/` — a table-backed sub-app's Postgres migrations, and the
 * record that lets the next generation EVOLVE them (mig-studio-emitted-migrations).
 *
 * ⛔ WHY THIS EXISTS. `schema.ts` is `CREATE TABLE IF NOT EXISTS`, which never
 * adds a column to a table that already exists, and Postgres never runs
 * `initSchema` at all (host `workspace/runtime.ts`). So on the tier the product
 * ships on, a spec that gained a column produced an app whose table lacked it,
 * and nothing in the manifest told the host's ONE migration catalogue (sdk-63)
 * what to run. Now:
 *
 *   - the first generation writes `subapp_<id>_0001_base.sql`: every table and
 *     index, Postgres-typed and schema-qualified (`:"schema"."…"`, the host's
 *     per-workspace psql variable);
 *   - every later generation diffs the spec's tables against what it emitted
 *     last (`.fd/emitted-spec.json`) and, when they changed AND the version was
 *     bumped, writes `subapp_<id>_000N_evolve.sql` — additive only: a new table,
 *     `ADD COLUMN IF NOT EXISTS` for a new nullable column, a new index;
 *   - dropping or retyping a column or table, dropping an index, adding a NOT
 *     NULL column (an existing row has no value for it) or changing the schema
 *     without a version bump is REFUSED by name. That is a manual contract step
 *     (expand → backfill → contract) a person writes, never a generator.
 *
 * Each migration is declared in `manifest.migrations` in the host's sdk-63 shape
 * (`class: "immutable"`, `phase: "expand"`, `after` the previous node). Every
 * earlier migration is re-emitted BYTE FOR BYTE from the record — a catalogued
 * migration is immutable (the host checks its sha256), so a later change to
 * this emitter's formatting must never rewrite one.
 *
 * ⭐ WHERE THE FILES LAND. Inside the sub-app's own directory
 * (`server/subapps/<id>/migrations/`), because that is the only place a
 * generated app may write (ship.ts's allowed roots, the host's ADM-020). The
 * manifest's `file` is the name the migration takes under the host's
 * `db/migrations/`: moving it there and adding its catalogue entry
 * (owner `subapp:<id>`) is the human mount step, and until it happens the host
 * kit's `migrations-cataloged` fails — closed, not open.
 *
 * Pure: no `node:` import (this is in `pure.ts`'s closure). */
import { z } from "zod";
import { assertSafeSqlIdentifier, sqlStringLiteral } from "../emit";
import { isVersionNewer, subAppMigrationSchema, type SubAppMigration } from "../manifest-rules";
import { serverDir } from "../naming";
import { SpecRejectedError, type PlannedColumn, type PlannedTable, type SubAppPlan } from "../plan";
import type { GeneratedFile } from "../invariants";

export const EMITTED_RECORD_SCHEMA = "studio-emitted-spec/1" as const;

/** Where the record of the last generation lives, relative to the host root. */
export function emittedRecordPath(id: string): string {
  return `${serverDir(id)}/.fd/emitted-spec.json`;
}

export function migrationsDir(id: string): string {
  return `${serverDir(id)}/migrations`;
}

/** `subapp_<id>_0001_base`, `subapp_<id>_0002_evolve`, … — carries
 * `subapp_<id>` so the host's `tables-migrated` finds it by name. */
export function migrationNodeId(id: string, n: number): string {
  return `subapp_${id}_${String(n).padStart(4, "0")}_${n === 1 ? "base" : "evolve"}`;
}

const PG_TYPE: Record<PlannedColumn["sqlType"], string> = { TEXT: "text", INTEGER: "bigint", REAL: "double precision" };

const IDENT = z.string().regex(/^[a-z][a-z0-9_]*$/);
const columnRecordSchema = z
  .object({
    name: IDENT,
    sqlType: z.enum(["TEXT", "INTEGER", "REAL"]),
    notNull: z.boolean(),
    values: z.array(z.string().regex(/^[A-Za-z0-9_.-]+$/)).nullable(),
  })
  .strict();
const tableRecordSchema = z
  .object({
    name: IDENT,
    columns: z.array(columnRecordSchema).min(1),
    indexes: z.array(z.object({ name: IDENT, columns: z.array(IDENT).min(1) }).strict()),
  })
  .strict();
const migrationRecordSchema = subAppMigrationSchema.extend({ sql: z.string().min(1) }).strict();
export const emittedRecordSchema = z
  .object({
    schema: z.literal(EMITTED_RECORD_SCHEMA),
    id: z.string(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    tables: z.array(tableRecordSchema),
    migrations: z.array(migrationRecordSchema).min(1),
  })
  .strict();
export type EmittedRecord = z.infer<typeof emittedRecordSchema>;
type TableRecord = z.infer<typeof tableRecordSchema>;
type ColumnRecord = z.infer<typeof columnRecordSchema>;

export interface EmittedMigrations {
  /** The migration SQL files (every one, oldest first) plus the record. */
  files: GeneratedFile[];
  /** `manifest.migrations`, or undefined for an app with no tables. */
  migrations: SubAppMigration[] | undefined;
}

export function emitMigrations(plan: SubAppPlan, previousEmitted: unknown): EmittedMigrations {
  const tables = plan.profile === "table-backed" ? plan.tables.map(toRecord) : [];
  const previous = previousEmitted === undefined ? null : readRecord(plan, previousEmitted);
  if (previous === null && tables.length === 0) return { files: [], migrations: undefined };

  const chain = previous === null ? [] : previous.migrations.map((m) => ({ ...m }));
  if (previous === null) {
    chain.push(declare(plan.id, 1, baseSql(plan.id, tables)));
  } else {
    const issues: string[] = [];
    const statements = evolve(previous.tables, tables, issues);
    if (isVersionNewer(previous.version, plan.version)) {
      issues.push(
        `the spec's version ${plan.version} is older than the ${previous.version} codegen last emitted — regenerate from the newer spec`,
      );
    } else if (statements.length > 0 && !isVersionNewer(plan.version, previous.version)) {
      issues.push(
        `the tables changed but the version is still ${previous.version} — bump the spec's version so the change gets its own evolve migration`,
      );
    }
    if (issues.length > 0) {
      throw new SpecRejectedError(`MiniAppSpec "${plan.id}" cannot evolve the schema codegen emitted before`, issues);
    }
    if (statements.length > 0) chain.push(declare(plan.id, chain.length + 1, evolveSql(plan.id, chain.length + 1, statements)));
  }

  const migrations: SubAppMigration[] = chain.map(({ sql: _sql, ...declared }) => declared);
  const record: EmittedRecord = { schema: EMITTED_RECORD_SCHEMA, id: plan.id, version: plan.version, tables, migrations: chain };
  const files: GeneratedFile[] = chain.map((m) => ({ path: `${migrationsDir(plan.id)}/${m.file}`, contents: m.sql, kind: "migration" }));
  files.push({ path: emittedRecordPath(plan.id), contents: `${JSON.stringify(record, null, 2)}\n`, kind: "emitted-record" });
  return { files, migrations };
}

function declare(id: string, n: number, sql: string): SubAppMigration & { sql: string } {
  const nodeId = migrationNodeId(id, n);
  return {
    node_id: nodeId,
    file: `${nodeId}.sql`,
    class: "immutable",
    phase: "expand",
    ...(n > 1 ? { after: [migrationNodeId(id, n - 1)] } : {}),
    sql,
  };
}

/** Fail closed: a record codegen cannot trust is refused, never treated as
 * "no record" — that would re-emit a base migration over a live chain. */
function readRecord(plan: SubAppPlan, raw: unknown): EmittedRecord {
  const where = emittedRecordPath(plan.id);
  const parsed = emittedRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SpecRejectedError(`${where} is not a record codegen wrote`, [
      ...parsed.error.issues.map((i) => `${where}: ${i.path.join(".") || "(root)"}: ${i.message}`),
    ]);
  }
  const record = parsed.data;
  const issues: string[] = [];
  if (record.id !== plan.id) issues.push(`${where} records sub-app "${record.id}", not "${plan.id}"`);
  record.migrations.forEach((m, i) => {
    const expected = migrationNodeId(plan.id, i + 1);
    const after = i === 0 ? undefined : [migrationNodeId(plan.id, i)];
    if (
      m.node_id !== expected ||
      m.file !== `${expected}.sql` ||
      m.class !== "immutable" ||
      m.phase !== "expand" ||
      JSON.stringify(m.after) !== JSON.stringify(after)
    ) {
      issues.push(`${where}: migration ${i + 1} is not the chain codegen writes (expected node "${expected}")`);
    }
  });
  if (issues.length > 0) throw new SpecRejectedError(`${where} is not a record codegen wrote`, issues);
  return record;
}

function toRecord(table: PlannedTable): TableRecord {
  return {
    name: table.full,
    columns: table.columns.map((c) => ({ name: c.name, sqlType: c.sqlType, notNull: c.notNull, values: c.values === null ? null : [...c.values] })),
    indexes: table.indexes.map((i) => ({ name: i.name, columns: [...i.columns] })),
  };
}

const MANUAL = "a manual contract step (expand, backfill, contract) written by a person, never a generated migration";

/** The additive statements from `before` to `after`; everything else is an issue. */
function evolve(before: readonly TableRecord[], after: readonly TableRecord[], issues: string[]): string[] {
  const out: string[] = [];
  const old = new Map(before.map((t) => [t.name, t]));
  const now = new Set(after.map((t) => t.name));
  for (const t of before) if (!now.has(t.name)) issues.push(`drops table "${t.name}" — ${MANUAL}`);
  for (const t of after) {
    const prev = old.get(t.name);
    if (prev === undefined) {
      out.push(createTable(t), ...t.indexes.map((i) => createIndex(t.name, i)));
      continue;
    }
    const prevCols = new Map(prev.columns.map((c) => [c.name, c]));
    const nowCols = new Set(t.columns.map((c) => c.name));
    for (const c of prev.columns) if (!nowCols.has(c.name)) issues.push(`drops column "${c.name}" of "${t.name}" — ${MANUAL}`);
    for (const c of t.columns) {
      const was = prevCols.get(c.name);
      if (was === undefined) {
        if (c.notNull) {
          issues.push(`adds NOT NULL column "${c.name}" to "${t.name}" — an existing row has no value for it; add it nullable, or as ${MANUAL}`);
        } else {
          out.push(`ALTER TABLE ${qualified(t.name)} ADD COLUMN IF NOT EXISTS ${columnDef(c)};`);
        }
      } else if (columnDef(was) !== columnDef(c)) {
        issues.push(`changes column "${c.name}" of "${t.name}" (${columnDef(was)} → ${columnDef(c)}) — ${MANUAL}`);
      }
    }
    const prevIdx = new Map(prev.indexes.map((i) => [i.name, i]));
    const nowIdx = new Set(t.indexes.map((i) => i.name));
    for (const i of prev.indexes) if (!nowIdx.has(i.name)) issues.push(`drops index "${i.name}" — ${MANUAL}`);
    for (const i of t.indexes) {
      const was = prevIdx.get(i.name);
      if (was === undefined) out.push(createIndex(t.name, i));
      else if (was.columns.join(",") !== i.columns.join(",")) issues.push(`changes index "${i.name}" — ${MANUAL}`);
    }
  }
  return out;
}

function qualified(table: string): string {
  return `:"schema"."${assertSafeSqlIdentifier(table, "table name")}"`;
}

function columnDef(c: ColumnRecord): string {
  const name = assertSafeSqlIdentifier(c.name, "column name");
  if (name === "id") return `"id" ${PG_TYPE[c.sqlType]} PRIMARY KEY`;
  const parts = [`"${name}" ${PG_TYPE[c.sqlType]}`];
  if (c.notNull) parts.push("NOT NULL");
  if (c.values !== null) parts.push(`CHECK ("${name}" IN (${c.values.map((v) => sqlStringLiteral(v, "CHECK value")).join(",")}))`);
  return parts.join(" ");
}

function createTable(t: TableRecord): string {
  return `CREATE TABLE IF NOT EXISTS ${qualified(t.name)} (\n${t.columns.map((c) => `  ${columnDef(c)}`).join(",\n")}\n);`;
}

function createIndex(table: string, i: TableRecord["indexes"][number]): string {
  const cols = i.columns.map((c) => `"${assertSafeSqlIdentifier(c, "index column")}"`).join(", ");
  return `CREATE INDEX IF NOT EXISTS "${assertSafeSqlIdentifier(i.name, "index name")}" ON ${qualified(table)} (${cols});`;
}

function header(id: string, nodeId: string, what: string): string[] {
  return [
    `-- GENERATED by Flightdeck Studio — sub-app ${id}, migration ${nodeId}. Class immutable, phase expand.`,
    `-- ${what}`,
    "-- Once catalogued this file never changes: the next spec change is the next evolve",
    "-- migration. Mount step: move it to db/migrations/ and add its catalogue entry",
    `-- (owner subapp:${id}). Applied per workspace schema (:"schema").`,
    "",
  ];
}

function baseSql(id: string, tables: readonly TableRecord[]): string {
  const body = tables.flatMap((t) => [createTable(t), ...t.indexes.map((i) => createIndex(t.name, i)), ""]);
  return [...header(id, migrationNodeId(id, 1), "Every table and index the spec declares, as first emitted."), ...body].join("\n");
}

function evolveSql(id: string, n: number, statements: readonly string[]): string {
  return [
    ...header(id, migrationNodeId(id, n), "Additive only: what the spec gained since the previous migration."),
    ...statements,
    "",
  ].join("\n");
}
