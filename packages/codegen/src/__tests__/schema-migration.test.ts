/** mig-studio-emitted-migrations: a table-backed sub-app ships its Postgres
 * migrations, and they EVOLVE with the spec.
 *
 * ⭐ WHY. `schema.ts` is `CREATE TABLE IF NOT EXISTS`, which never adds a
 * column to a table that already exists, and Postgres never runs `initSchema`
 * at all (host workspace/runtime.ts). So a spec that gains a column produced
 * an app whose Postgres tables silently lacked it (42703 on the first read),
 * and a table-backed generated app declared no `migrations` for the host's
 * catalogue (sdk-63) to run. Now codegen reads what it emitted last
 * (`.fd/emitted-spec.json`), writes a base migration once and, per version
 * bump, an additive evolve migration — and refuses a drop or retype, which is
 * a manual contract step, never something a generator writes.
 *
 * Like every other test here, these read the emitted TEXT. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSubApp, type GeneratedSubApp } from "../generate";
import { subAppManifestSchema as codegenManifestSchema, subAppMigrationSchema as codegenMigrationSchema } from "../manifest-rules";
import { SpecRejectedError } from "../plan";
import { contractRunSpec, wcClockSpec } from "../fixtures/specs";
import { readEmittedManifest } from "../testing/readEmittedManifest";
import type { MiniAppSpec, TableSpec } from "../spec-contract";
import { HOST_ROOT } from "../../../guardrails/src/host-source";
import {
  subAppManifestSchema as gateManifestSchema,
  subAppMigrationSchema as gateMigrationSchema,
  validateManifestData,
} from "../../../conformance/src/manifest-schema";

const ID = "wc-clock";
const DIR = `server/subapps/${ID}`;
const RECORD = `${DIR}/.fd/emitted-spec.json`;
const BASE_SQL = `${DIR}/migrations/subapp_wc-clock_0001_base.sql`;
const EVOLVE_SQL = `${DIR}/migrations/subapp_wc-clock_0002_evolve.sql`;

type Spec = MiniAppSpec;
type Table = TableSpec;

/** wc-clock plus a second table, so the base migration carries two. */
const NOTES: Table["columns"] = [
  { name: "body", type: "text", notNull: true },
  { name: "tag", type: "text" },
];
const twoTables = (version = "0.1.0", clocksExtra: Table["columns"] = [], notes: Table["columns"] = NOTES): Spec => ({
  ...wcClockSpec,
  version,
  tables: [
    { ...wcClockSpec.tables[0]!, columns: [...wcClockSpec.tables[0]!.columns, ...clocksExtra] },
    { name: "notes", columns: notes },
  ],
});

const fileAt = (app: GeneratedSubApp, p: string): string => {
  const file = app.files.find((f) => f.path === p);
  if (file === undefined) throw new Error(`no emitted file at ${p} (have: ${app.files.map((f) => f.path).join(", ")})`);
  return file.contents;
};
const recordOf = (app: GeneratedSubApp): unknown => JSON.parse(fileAt(app, RECORD));
const manifestOf = (app: GeneratedSubApp) => readEmittedManifest(fileAt(app, `${DIR}/manifest.ts`));
/** SQL statements, `--` comment lines dropped. */
const statements = (sql: string): string[] =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);

function rejection(spec: unknown, previousEmitted: unknown): SpecRejectedError {
  try {
    generateSubApp(spec, { previousEmitted });
  } catch (error) {
    if (error instanceof SpecRejectedError) return error;
    throw error;
  }
  throw new Error("expected the spec to be refused, but it generated");
}

const base = generateSubApp(twoTables());

describe("a spec with two tables emits the base migration", () => {
  it("writes migrations/subapp_<id>_0001_base.sql with both tables and their indexes, Postgres-typed and schema-qualified", () => {
    const sql = statements(fileAt(base, BASE_SQL));
    const creates = sql.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS"));
    expect(creates.map((s) => /:"schema"\."([a-z0-9_]+)"/.exec(s)?.[1])).toEqual(["subapp_wc_clock_clocks", "subapp_wc_clock_notes"]);
    expect(creates[0]).toContain('"id" text PRIMARY KEY');
    expect(creates[0]).toContain('"days" bigint NOT NULL');
    expect(creates[0]).toContain(`"state" text NOT NULL CHECK ("state" IN ('running','paused','expired'))`);
    expect(sql.filter((s) => s.startsWith("CREATE INDEX IF NOT EXISTS"))).toEqual([
      'CREATE INDEX IF NOT EXISTS "idx_wc_clock_clocks_ticket" ON :"schema"."subapp_wc_clock_clocks" ("ticket")',
    ]);
    expect(sql.every((s) => /^CREATE (TABLE|INDEX) IF NOT EXISTS /.test(s))).toBe(true);
  });

  it("declares it in manifest.migrations — class immutable, phase expand — in the host's sdk-63 shape", () => {
    const data = manifestOf(base);
    expect(data["migrations"]).toEqual([
      { node_id: "subapp_wc-clock_0001_base", file: "subapp_wc-clock_0001_base.sql", class: "immutable", phase: "expand" },
    ]);
    // Both local copies of the host schema accept it, and the codegen boot rules pass.
    expect(codegenManifestSchema.parse(data).migrations).toEqual(data["migrations"]);
    expect(validateManifestData(data)).toEqual([]);
  });

  it("stores what it emitted in .fd/emitted-spec.json, so the next generation can diff against it", () => {
    const record = recordOf(base) as { schema: string; id: string; version: string; migrations: Array<{ node_id: string; sql: string }> };
    expect(record.schema).toBe("studio-emitted-spec/1");
    expect(record.id).toBe(ID);
    expect(record.version).toBe("0.1.0");
    expect(record.migrations.map((m) => m.node_id)).toEqual(["subapp_wc-clock_0001_base"]);
    expect(record.migrations[0]!.sql).toBe(fileAt(base, BASE_SQL));
  });

  it("emits nothing of the kind for a database-free mini-app", () => {
    const mini = generateSubApp(contractRunSpec);
    expect(mini.files.filter((f) => f.path.includes("/migrations/") || f.path.includes("/.fd/"))).toEqual([]);
    expect(readEmittedManifest(fileAt(mini, "server/subapps/contract-run/manifest.ts"))).not.toHaveProperty("migrations");
  });
});

describe("a version bump that adds a column emits an evolve migration", () => {
  const evolved = generateSubApp(twoTables("0.2.0", [{ name: "owner", type: "text" }]), { previousEmitted: recordOf(base) });

  it("writes migrations/subapp_<id>_0002_evolve.sql with ADD COLUMN IF NOT EXISTS and nothing else", () => {
    expect(statements(fileAt(evolved, EVOLVE_SQL))).toEqual([
      'ALTER TABLE :"schema"."subapp_wc_clock_clocks" ADD COLUMN IF NOT EXISTS "owner" text',
    ]);
  });

  it("re-emits the base migration byte for byte — an emitted migration is immutable", () => {
    expect(fileAt(evolved, BASE_SQL)).toBe(fileAt(base, BASE_SQL));
  });

  it("appends it to manifest.migrations, after the base", () => {
    expect(manifestOf(evolved)["migrations"]).toEqual([
      { node_id: "subapp_wc-clock_0001_base", file: "subapp_wc-clock_0001_base.sql", class: "immutable", phase: "expand" },
      {
        node_id: "subapp_wc-clock_0002_evolve",
        file: "subapp_wc-clock_0002_evolve.sql",
        class: "immutable",
        phase: "expand",
        after: ["subapp_wc-clock_0001_base"],
      },
    ]);
  });

  it("keeps schema.ts the complete CREATE TABLE, so SQLite and the replayed Postgres chain name the same columns", () => {
    expect(fileAt(evolved, `${DIR}/schema.ts`)).toMatch(/note TEXT,\n {2}owner TEXT\n\);/);
  });

  it("emits no new migration when the tables did not change", () => {
    const again = generateSubApp(twoTables("0.3.0", [{ name: "owner", type: "text" }]), { previousEmitted: recordOf(evolved) });
    expect(again.files.filter((f) => f.path.includes("/migrations/")).map((f) => f.path)).toEqual([BASE_SQL, EVOLVE_SQL]);
    expect((manifestOf(again)["migrations"] as unknown[]).length).toBe(2);
  });
});

describe("what codegen refuses — a manual contract step, never a generated one", () => {
  const previous = recordOf(base);

  it("refuses dropping a column", () => {
    const spec = twoTables("0.2.0", [], NOTES.filter((c) => c.name !== "tag"));
    expect(rejection(spec, previous).issues.join("\n")).toMatch(/drops column "tag".*manual contract step/);
  });

  it("refuses dropping a table", () => {
    const spec = { ...twoTables("0.2.0"), tables: [twoTables().tables![0]!] };
    expect(rejection(spec, previous).issues.join("\n")).toMatch(/drops table "subapp_wc_clock_notes".*manual contract step/);
  });

  it("refuses retyping a column", () => {
    const retyped = twoTables("0.2.0", [], NOTES.map((c) => (c.name === "tag" ? { ...c, type: "integer" as const } : c)));
    expect(rejection(retyped, previous).issues.join("\n")).toMatch(/changes column "tag".*manual contract step/);
  });

  it("refuses adding a NOT NULL column (an existing row has no value for it)", () => {
    const spec = twoTables("0.2.0", [], [...NOTES, { name: "owner", type: "text", notNull: true }]);
    expect(rejection(spec, previous).issues.join("\n")).toMatch(/NOT NULL column "owner"/);
  });

  it("refuses a schema change without a version bump", () => {
    const spec = twoTables("0.1.0", [{ name: "owner", type: "text" }]);
    expect(rejection(spec, previous).issues.join("\n")).toMatch(/bump the spec's version/);
  });

  it("refuses a record that is not what codegen writes (fail closed, never a fresh base)", () => {
    expect(rejection(twoTables("0.2.0"), { schema: "studio-emitted-spec/1", id: ID }).issues.join("\n")).toMatch(/emitted-spec\.json/);
    const tampered = structuredClone(previous) as { migrations: Array<{ sql: string }> };
    tampered.migrations[0]!.sql += '\nGRANT ALL ON :"schema"."subapp_wc_clock_clocks" TO public;\n';
    expect(() => generateSubApp(twoTables("0.2.0"), { previousEmitted: tampered })).toThrow(/migration-sql/);
  });
});

/** Review round 3: what SQLite accepts but PostgreSQL refuses or silently
 * mangles must be refused at generation, never shipped as a migration that
 * fails (or worse, half-applies) on the tier the product runs on. */
describe("what Postgres itself would refuse — rejected before a migration is written", () => {
  const withCols = (cols: Table["columns"], version = "0.1.0"): Spec => twoTables(version, [], cols);
  const accepts = (spec: Spec, previousEmitted?: unknown) => generateSubApp(spec, previousEmitted === undefined ? {} : { previousEmitted });

  it("refuses a column name longer than 63 bytes (Postgres truncates it, so two long names collide)", () => {
    const a = `${"x".repeat(63)}a`;
    const b = `${"x".repeat(63)}b`;
    const issues = rejection(withCols([...NOTES, { name: a, type: "text" }, { name: b, type: "text" }]), undefined).issues.join("\n");
    expect(issues).toMatch(new RegExp(`column "${a}".*63`));
    expect(issues).toMatch(new RegExp(`column "${b}".*63`));
  });

  it("refuses a table name longer than 63 bytes once prefixed", () => {
    const bare = "t".repeat(64 - "subapp_wc_clock_".length);
    const spec = { ...twoTables(), tables: [...twoTables().tables!, { name: bare, columns: NOTES }] };
    expect(rejection(spec, undefined).issues.join("\n")).toMatch(new RegExp(`table "subapp_wc_clock_${bare}".*63`));
  });

  it("refuses an index name longer than 63 bytes, even when every column name fits", () => {
    const c1 = "a".repeat(30);
    const c2 = "b".repeat(30);
    const spec = {
      ...twoTables(),
      tables: [...twoTables().tables!, { name: "wide", columns: [{ name: c1, type: "text" as const }, { name: c2, type: "text" as const }], indexes: [{ on: [c1, c2] }] }],
    };
    expect(rejection(spec, undefined).issues.join("\n")).toMatch(/index "idx_wc_clock_wide_a+_b+".*63/);
  });

  it("accepts an identifier of exactly 63 bytes", () => {
    expect(() => accepts(withCols([...NOTES, { name: "y".repeat(63), type: "text" }]))).not.toThrow();
  });

  it("refuses an integer column whose CHECK values are not bigint literals", () => {
    const issues = rejection(withCols([...NOTES, { name: "rating", type: "integer", values: ["1.0", "2.0"] }]), undefined).issues.join("\n");
    expect(issues).toMatch(/column "rating".*"1\.0".*bigint/);
    expect(issues).toMatch(/column "rating".*"2\.0".*bigint/);
    expect(rejection(withCols([...NOTES, { name: "rating", type: "integer", values: ["9223372036854775808"] }]), undefined).issues.join("\n")).toMatch(/bigint/);
  });

  it("refuses a real column whose CHECK values are not double precision literals", () => {
    const issues = rejection(withCols([...NOTES, { name: "score", type: "real", values: ["1.5", "high"] }]), undefined).issues.join("\n");
    expect(issues).toMatch(/column "score".*"high".*double precision/);
    expect(issues).not.toMatch(/"1\.5"/);
  });

  it("accepts numeric CHECK values Postgres can cast", () => {
    expect(() => accepts(withCols([...NOTES, { name: "rating", type: "integer", values: ["1", "-2", "10"] }]))).not.toThrow();
    expect(() => accepts(withCols([...NOTES, { name: "score", type: "real", values: ["1.5", "-2", "3e2", ".5"] }]))).not.toThrow();
  });

  it("refuses the same on the evolve path (an ADD COLUMN)", () => {
    const issues = rejection(twoTables("0.2.0", [{ name: "rating", type: "integer", values: ["1.0"] }]), recordOf(base)).issues.join("\n");
    expect(issues).toMatch(/column "rating".*bigint/);
  });
});

/** ⭐ The two local copies of the host's manifest schema (codegen's boot rules
 * and the conformance gate's) must carry the host's `migrations` shape
 * exactly. The host block is hashed against a pinned fixture, so a change to
 * it goes red here until someone re-transcribes both copies and re-pins. */
const HOST_TYPES = path.join(HOST_ROOT, "flightdeck", "server", "subapps", "types.ts");
const FIXTURE = path.join(__dirname, "..", "fixtures", "host-migration-schema.sha256");

describe.skipIf(!fs.existsSync(HOST_TYPES))("the manifest migrations schema is the host's", () => {
  const source = fs.existsSync(HOST_TYPES) ? fs.readFileSync(HOST_TYPES, "utf8") : "";
  const start = source.indexOf("const MIGRATION_NODE_ID_RE");
  const end = source.indexOf(".strict();", source.indexOf("export const subAppMigrationSchema"));
  const block = source.slice(start, end + ".strict();".length);

  it("matches the pinned host fixture hash", () => {
    expect(start).toBeGreaterThan(-1);
    const digest = crypto.createHash("sha256").update(block.replace(/\s+/g, " ").trim()).digest("hex");
    expect(digest).toBe(fs.readFileSync(FIXTURE, "utf8").trim());
  });

  it("is transcribed key for key, regex for regex, enum for enum, in both local copies", () => {
    for (const copy of [codegenMigrationSchema, gateMigrationSchema]) {
      expect(Object.keys(copy.shape).sort()).toEqual(["after", "class", "file", "node_id", "phase"]);
      expect(block).toContain(`const MIGRATION_NODE_ID_RE = /${(copy.shape.node_id._def.checks[0] as { regex: RegExp }).regex.source}/;`);
      expect(block).toContain(`const MIGRATION_FILE_RE = /${(copy.shape.file._def.checks[0] as { regex: RegExp }).regex.source}/;`);
      expect(block).toContain(`class: z.enum(${JSON.stringify(copy.shape.class.options).replace(/,/g, ", ")})`);
      expect(block).toContain(`phase: z.enum(${JSON.stringify(copy.shape.phase.unwrap().options).replace(/,/g, ", ")}).optional()`);
    }
    expect(Object.keys(gateManifestSchema.shape)).toContain("migrations");
  });
});
