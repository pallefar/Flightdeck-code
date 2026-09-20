/** Spec -> plan. One resolution pass, then every emitter reads the plan.
 *
 * ⭐ WHY A PLAN STEP EXISTS AT ALL. Five emitters need the same derived
 * facts — the full table name, the full route path, which capability a
 * route needs, which column a body field lands in. Deriving those inside
 * each emitter is how a manifest ends up naming `/api/apps/x/items` while
 * the route file registers `/api/apps/x/item`: five agreeing copies with
 * nothing making them agree. Resolve once, here, and an emitter that wants
 * a name has exactly one place to get it.
 *
 * The second job is the one Zod cannot do: CROSS-FIELD coherence. Zod
 * validates a field against a rule; it cannot see that an operation names a
 * table that does not exist, that a route declares `:id` no handler reads,
 * that a NOT NULL column has no body field to fill it, or that the manifest
 * declares a capability nothing calls. Those are the failures that produce
 * source which compiles and then misbehaves, so they are refused here —
 * ALL of them at once, because a generator that reports one problem per run
 * is a generator nobody uses. */
import {
  MANAGED_COLUMNS,
  RESERVED_SUBAPP_IDS,
  miniAppSpecSchema,
  requiredScopeOf,
  versionOf,
  webModuleIdOf,
  type CapabilityScope,
  type ColumnSpec,
  type DomainSpec,
  type FieldSpec,
  type MiniAppSpec,
  type Operation,
  type RouteSpec,
} from "./spec-contract";
import { HOST_VERSION } from "./spec-contract";
import { assertManifestWouldBoot, type SubAppManifestData } from "./manifest-rules";
import * as names from "./naming";

export class SpecRejectedError extends Error {
  constructor(message: string, readonly issues: readonly string[]) {
    super(`${message}\n  - ${issues.join("\n  - ")}`);
  }
}

export interface PlannedColumn {
  /** Bare column name, as it appears in the DDL. */
  name: string;
  sqlType: "TEXT" | "INTEGER" | "REAL";
  notNull: boolean;
  values: readonly string[] | null;
  /** True for the three columns codegen owns on every table. */
  managed: boolean;
}

export interface PlannedTable {
  bare: string;
  /** `subapp_<id_underscored>_<bare>` — the only name emitted into SQL. */
  full: string;
  columns: PlannedColumn[];
  indexes: Array<{ name: string; columns: readonly string[] }>;
}

export interface PlannedField extends FieldSpec {
  /** Resolved target column (explicit `column`, else snake_case of name). */
  targetColumn: string;
}

export interface PlannedRoute {
  method: RouteSpec["method"];
  /** Lowercase Fastify method, e.g. `get`. */
  fastifyMethod: string;
  /** `routePrefix` + the spec's sub-path. What the handler registers. */
  fullPath: string;
  subPath: string;
  summary: string | null;
  operation: Operation;
  /** Present for body-carrying operations: the `const <name> = z.object(...)`
   * emitted above the registrar. */
  bodyConstName: string | null;
  /** Present when the path carries a `:param` the handler reads. Path
   * params are an HTTP boundary too, so they get a Zod schema of their
   * own rather than being trusted because Fastify produced them. */
  paramsConstName: string | null;
  fields: PlannedField[];
  table: PlannedTable | null;
  requiredScope: CapabilityScope | null;
}

export interface PlannedDomain {
  name: string;
  title: string;
  /** `routes/<name>.ts` */
  fileName: string;
  registerFn: string;
  routes: PlannedRoute[];
}

export interface SubAppPlan {
  spec: MiniAppSpec;
  id: string;
  label: string;
  version: string;
  summary: string | null;
  webModuleId: string;
  routePrefix: string;
  navPath: string;
  envVar: string;
  tablePrefix: string;
  manifestData: SubAppManifestData;
  tables: PlannedTable[];
  domains: PlannedDomain[];
  warnings: string[];
  names: {
    manifestConst: string;
    guardFn: string;
    disabledError: string;
    subAppIdConst: string;
    schemaConst: string;
    applySchemaFn: string;
    registerRoutesFn: string;
  };
}

const SQL_TYPES = { text: "TEXT", integer: "INTEGER", real: "REAL" } as const;

/** Which column type each body-field type must land in. */
const FIELD_COLUMN_TYPES = {
  string: "TEXT",
  enum: "TEXT",
  integer: "INTEGER",
  boolean: "INTEGER",
  number: "REAL",
} as const;

/** Parses, resolves and cross-checks. Throws `SpecRejectedError` listing
 * every problem found — never a partial plan. */
export function planSubApp(input: unknown): SubAppPlan {
  const parsed = miniAppSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new SpecRejectedError(
      "MiniAppSpec did not parse",
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const spec = parsed.data;
  const issues: string[] = [];
  const warnings: string[] = [];

  if ((RESERVED_SUBAPP_IDS as readonly string[]).includes(spec.id)) {
    issues.push(
      `id "${spec.id}" is already a hand-written sub-app in the host registry — generating it would duplicate its nav path, route prefix and table prefix`,
    );
  }

  const tables = planTables(spec, issues);
  const tablesByBare = new Map(tables.map((t) => [t.bare, t]));
  const domains = planDomains(spec, tablesByBare, issues, warnings);

  checkRouteUniqueness(domains, issues);
  checkCapabilityLeastPrivilege(spec, domains, issues);
  checkTablesAreUsed(tables, domains, warnings);

  if (issues.length > 0) throw new SpecRejectedError(`MiniAppSpec "${spec.id}" is not generatable`, issues);

  const webModuleId = webModuleIdOf(spec);
  const manifestData = assertManifestWouldBoot(
    {
      id: spec.id,
      label: spec.label,
      version: versionOf(spec),
      minHostVersion: HOST_VERSION,
      icon: spec.icon,
      navSection: spec.navSection,
      routePrefix: names.routePrefix(spec.id),
      webModuleId,
      capabilities: spec.capabilities,
      visibleToRoles: spec.visibleToRoles,
      ...(spec.settingsPanel
        ? { settingsPanel: { ...spec.settingsPanel, webComponentId: webModuleId } }
        : {}),
    },
    HOST_VERSION,
  );

  return {
    spec,
    id: spec.id,
    label: spec.label,
    version: versionOf(spec),
    summary: spec.summary ?? null,
    webModuleId,
    routePrefix: names.routePrefix(spec.id),
    navPath: names.navPath(spec.id),
    envVar: names.killSwitchEnvVar(spec.id),
    tablePrefix: names.tablePrefix(spec.id),
    manifestData,
    tables,
    domains,
    warnings,
    names: {
      manifestConst: names.manifestConstName(spec.id),
      guardFn: names.guardFunctionName(spec.id),
      disabledError: names.disabledErrorName(spec.id),
      subAppIdConst: names.subAppIdConstName(spec.id),
      schemaConst: names.schemaConstName(spec.id),
      applySchemaFn: names.applySchemaFunctionName(spec.id),
      registerRoutesFn: names.registerRoutesFunctionName(spec.id),
    },
  };
}

function planTables(spec: MiniAppSpec, issues: string[]): PlannedTable[] {
  const seen = new Set<string>();
  const out: PlannedTable[] = [];
  for (const table of spec.tables ?? []) {
    if (seen.has(table.name)) {
      issues.push(`table "${table.name}" is declared twice`);
      continue;
    }
    seen.add(table.name);

    const columns: PlannedColumn[] = [
      { name: "id", sqlType: "TEXT", notNull: true, values: null, managed: true },
      { name: "created_at", sqlType: "TEXT", notNull: true, values: null, managed: true },
      { name: "created_by", sqlType: "TEXT", notNull: true, values: null, managed: true },
    ];
    const columnNames = new Set<string>(MANAGED_COLUMNS);
    for (const column of table.columns) {
      if ((MANAGED_COLUMNS as readonly string[]).includes(column.name)) {
        issues.push(
          `table "${table.name}" redeclares managed column "${column.name}" — codegen always emits id/created_at/created_by, declare only domain columns`,
        );
        continue;
      }
      if (columnNames.has(column.name)) {
        issues.push(`table "${table.name}" declares column "${column.name}" twice`);
        continue;
      }
      columnNames.add(column.name);
      columns.push(toPlannedColumn(column));
    }

    const indexes: PlannedTable["indexes"] = [];
    for (const index of table.indexes ?? []) {
      const missing = index.on.filter((c) => !columnNames.has(c));
      if (missing.length > 0) {
        issues.push(`table "${table.name}" indexes unknown column(s) ${missing.map((m) => `"${m}"`).join(", ")}`);
        continue;
      }
      indexes.push({ name: names.indexName(spec.id, table.name, index.on), columns: index.on });
    }

    out.push({ bare: table.name, full: names.tableName(spec.id, table.name), columns, indexes });
  }
  return out;
}

function toPlannedColumn(column: ColumnSpec): PlannedColumn {
  return {
    name: column.name,
    sqlType: SQL_TYPES[column.type],
    notNull: column.notNull === true,
    values: column.values ?? null,
    managed: false,
  };
}

function planDomains(
  spec: MiniAppSpec,
  tablesByBare: ReadonlyMap<string, PlannedTable>,
  issues: string[],
  warnings: string[],
): PlannedDomain[] {
  const seen = new Set<string>();
  const out: PlannedDomain[] = [];
  for (const domain of spec.domains) {
    if (seen.has(domain.name)) {
      issues.push(`domain "${domain.name}" is declared twice`);
      continue;
    }
    seen.add(domain.name);
    out.push({
      name: domain.name,
      title: domain.title ?? titleCase(domain.name),
      fileName: `${domain.name}.ts`,
      registerFn: names.registerDomainRoutesFunctionName(spec.id, domain.name),
      routes: domain.routes.map((route) => planRoute(spec, domain, route, tablesByBare, issues, warnings)),
    });
  }
  return out;
}

function planRoute(
  spec: MiniAppSpec,
  domain: DomainSpec,
  route: RouteSpec,
  tablesByBare: ReadonlyMap<string, PlannedTable>,
  issues: string[],
  warnings: string[],
): PlannedRoute {
  const where = `${domain.name} ${route.method} ${route.path}`;
  const op = route.operation;
  const pathParams = [...route.path.matchAll(/:([a-z][A-Za-z0-9]*)/g)].map((m) => m[1] as string);

  let table: PlannedTable | null = null;
  if (op.kind === "list-rows" || op.kind === "get-row" || op.kind === "insert-row") {
    table = tablesByBare.get(op.table) ?? null;
    if (table === null) issues.push(`${where}: operation names unknown table "${op.table}"`);
  }

  // Method/operation agreement. A GET that writes, or a POST that only
  // lists, is a shape the host's own routes never take and a reviewer
  // would have to re-read the handler to trust.
  const writes = op.kind === "insert-row" || op.kind === "propose";
  if (writes && route.method === "GET") issues.push(`${where}: a writing operation ("${op.kind}") cannot be a GET`);
  if (!writes && route.method !== "GET") issues.push(`${where}: a reading operation ("${op.kind}") must be a GET`);

  if (op.kind === "get-row") {
    if (!pathParams.includes(op.param)) {
      issues.push(`${where}: operation reads path param ":${op.param}" but the path does not declare it`);
    }
    if (table !== null && !table.columns.some((c) => c.name === op.keyColumn)) {
      issues.push(`${where}: keyColumn "${op.keyColumn}" is not a column of table "${op.table}"`);
    }
  }
  const unused = pathParams.filter((p) => op.kind !== "get-row" || p !== op.param);
  if (unused.length > 0) {
    issues.push(`${where}: path declares param(s) ${unused.map((p) => `":${p}"`).join(", ")} that no operation reads`);
  }

  if (op.kind === "list-rows" && table !== null && op.orderBy && !table.columns.some((c) => c.name === op.orderBy?.column)) {
    issues.push(`${where}: orderBy column "${op.orderBy.column}" is not a column of table "${op.table}"`);
  }

  const fields = planFields(where, op, table, issues, warnings, spec);

  if (op.kind === "insert-row" || op.kind === "propose") {
    if (!op.auditEvent.startsWith(`${spec.id}.`)) {
      issues.push(`${where}: auditEvent "${op.auditEvent}" must be namespaced under the sub-app id ("${spec.id}.")`);
    }
  }

  return {
    method: route.method,
    fastifyMethod: route.method.toLowerCase(),
    fullPath: `${names.routePrefix(spec.id)}${route.path}`,
    subPath: route.path,
    summary: route.summary ?? null,
    operation: op,
    bodyConstName: writes ? `${route.method.toLowerCase()}${names.pascalCase(routeSlug(route))}Body` : null,
    paramsConstName: op.kind === "get-row" ? `${route.method.toLowerCase()}${names.pascalCase(routeSlug(route))}Params` : null,
    fields,
    table,
    requiredScope: requiredScopeOf(op),
  };
}

/** A stable per-route token for naming the body schema const — derived from
 * the path, so two POSTs in one domain never collide. */
function routeSlug(route: RouteSpec): string {
  return route.path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => (s.startsWith(":") ? `by-${s.slice(1)}` : s))
    .join("-");
}

function planFields(
  where: string,
  op: Operation,
  table: PlannedTable | null,
  issues: string[],
  warnings: string[],
  spec: MiniAppSpec,
): PlannedField[] {
  if (op.kind !== "insert-row" && op.kind !== "propose") return [];

  const fields: PlannedField[] = [];
  const seenNames = new Set<string>();
  const seenColumns = new Set<string>();
  for (const field of op.fields) {
    if (seenNames.has(field.name)) {
      issues.push(`${where}: body field "${field.name}" is declared twice`);
      continue;
    }
    seenNames.add(field.name);
    const targetColumn = field.column ?? names.snakeCase(field.name);
    fields.push({ ...field, targetColumn });

    if (op.kind !== "insert-row") continue;
    if ((MANAGED_COLUMNS as readonly string[]).includes(targetColumn)) {
      issues.push(
        `${where}: body field "${field.name}" targets managed column "${targetColumn}" — id/created_at/created_by are written by the generated handler, never by a client`,
      );
      continue;
    }
    if (seenColumns.has(targetColumn)) {
      issues.push(`${where}: two body fields both target column "${targetColumn}"`);
      continue;
    }
    seenColumns.add(targetColumn);
    const column = table?.columns.find((c) => c.name === targetColumn);
    if (table !== null && column === undefined) {
      issues.push(`${where}: body field "${field.name}" targets column "${targetColumn}", which table "${op.table}" does not have`);
    } else if (column !== undefined) {
      // SQLite is forgiving about types; the generated INSERT is not
      // allowed to be. A boolean binds as 0/1 and needs an INTEGER column,
      // an enum binds as text. Letting these disagree produces a table
      // whose CHECK constraint can never match what the route writes.
      const expected = FIELD_COLUMN_TYPES[field.type];
      if (column.sqlType !== expected) {
        issues.push(
          `${where}: body field "${field.name}" is a "${field.type}" but column "${targetColumn}" is ${column.sqlType} (expected ${expected})`,
        );
      }
      if (field.type === "enum" && column.values !== null) {
        const outside = (field.values ?? []).filter((v) => !column.values?.includes(v));
        if (outside.length > 0) {
          issues.push(
            `${where}: body field "${field.name}" admits value(s) ${outside.map((v) => `"${v}"`).join(", ")} that column "${targetColumn}"'s CHECK constraint rejects`,
          );
        }
      }
    }
  }

  if (op.kind === "insert-row" && table !== null) {
    // A NOT NULL column with no field behind it is an INSERT that throws at
    // runtime, every time, for every caller. Caught here, not in production.
    for (const column of table.columns) {
      if (column.managed || !column.notNull) continue;
      const field = fields.find((f) => f.targetColumn === column.name);
      if (field === undefined) {
        issues.push(`${where}: column "${column.name}" is NOT NULL but no body field fills it`);
      } else if (field.optional === true) {
        issues.push(`${where}: column "${column.name}" is NOT NULL but body field "${field.name}" is optional`);
      }
    }
  }

  if (op.kind === "propose") {
    const ticket = fields.find((f) => f.name === op.ticketField);
    if (ticket === undefined) {
      issues.push(`${where}: ticketField "${op.ticketField}" is not one of this operation's body fields`);
    } else {
      if (ticket.type !== "string") issues.push(`${where}: ticketField "${op.ticketField}" must be a string — it becomes part of a proposal filename`);
      if (ticket.optional === true) issues.push(`${where}: ticketField "${op.ticketField}" cannot be optional`);
      if (ticket.pattern !== undefined || ticket.maxLength !== undefined) {
        warnings.push(
          `${where}: the pattern/maxLength on ticketField "${op.ticketField}" is ignored — codegen always emits the filename-safe charset for a ticket, which a spec must not be able to widen`,
        );
      }
    }
    if (!spec.capabilities.includes("read:contracts")) {
      warnings.push(
        `${where}: without "read:contracts" the generated handler cannot check that the ticket names a real contract folder, so it proposes blind — declare the scope if that check matters`,
      );
    }
  }

  return fields;
}

function checkRouteUniqueness(domains: readonly PlannedDomain[], issues: string[]): void {
  const seen = new Map<string, string>();
  for (const domain of domains) {
    for (const route of domain.routes) {
      const key = `${route.method} ${route.fullPath}`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        issues.push(`route "${key}" is registered by both domain "${previous}" and domain "${domain.name}"`);
        continue;
      }
      seen.set(key, domain.name);
    }
  }
}

/** Both directions. Contract rule 9: "the array IS the human consent
 * screen" — so a scope with no caller is a lie told to whoever approves the
 * install, and a caller with no scope is a route that 403s forever. */
function checkCapabilityLeastPrivilege(spec: MiniAppSpec, domains: readonly PlannedDomain[], issues: string[]): void {
  const used = new Set<CapabilityScope>();
  for (const domain of domains) {
    for (const route of domain.routes) {
      if (route.requiredScope === null) continue;
      used.add(route.requiredScope);
      if (!spec.capabilities.includes(route.requiredScope)) {
        issues.push(
          `${domain.name} ${route.method} ${route.subPath}: operation "${route.operation.kind}" needs capability "${route.requiredScope}", which the spec does not declare`,
        );
      }
    }
  }
  for (const declared of spec.capabilities) {
    if (!used.has(declared)) {
      issues.push(
        `capability "${declared}" is declared but no route uses it — the capability array is the consent screen, so an unused scope asks a human to approve access nothing needs`,
      );
    }
  }
}

function checkTablesAreUsed(tables: readonly PlannedTable[], domains: readonly PlannedDomain[], warnings: string[]): void {
  const used = new Set<string>();
  for (const domain of domains) {
    for (const route of domain.routes) if (route.table !== null) used.add(route.table.bare);
  }
  for (const table of tables) {
    if (!used.has(table.bare)) {
      warnings.push(`table "${table.bare}" is created by initSchema but no route reads or writes it`);
    }
  }
}

function titleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
