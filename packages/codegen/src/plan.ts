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
  profileOf,
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
  type WorkflowGate,
} from "./spec-contract";
import { HOST_VERSION } from "./spec-contract";
import { tableRefusalReason, type Profile } from "./profile";
import { assertManifestWouldBoot, type SubAppManifestData } from "./manifest-rules";
import * as names from "./naming";
import { PROPOSAL_TEMPLATES, proposeOperationProblem, type ProposalTemplate } from "./proposal-templates";

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
  /** The id the emitted page gives this route's form, and the id a
   * workflow step's `action` resolves to. Derived ONCE here because two
   * emitters and one cross-check have to agree on it; three copies of
   * `method + "-" + path` is how a step ends up pointing at a form that
   * does not exist. */
  formId: string;
  /** `<subAppId>-<proposalKind>-`, the exact filename prefix this route
   * writes under `memory/proposals/`. Non-null only for `propose`. The
   * page matches it against `listOwnInboxProposals()` to show a step as
   * already proposed, so it is derived here rather than rebuilt there. */
  proposalPrefix: string | null;
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

/** A `## Procedure` step, resolved: its gate defaulted, its action bound
 * to a real planned route (or explicitly null), and nothing left for an
 * emitter to look up for itself. */
export interface PlannedWorkflowStep {
  n: number;
  title: string;
  detail: string | null;
  needs: readonly string[];
  produces: readonly string[];
  gate: WorkflowGate;
  action: {
    domain: string;
    method: string;
    subPath: string;
    label: string;
    formId: string;
    operationKind: Operation["kind"];
    /** Non-null when performing this step files a proposal — which is the
     * only way a step can ever be observed as done. */
    proposalPrefix: string | null;
  } | null;
}

export interface PlannedWorkflow {
  name: string;
  description: string | null;
  source: string | null;
  steps: PlannedWorkflowStep[];
  /** Sub-path of the `list-proposals` route, when the spec declares one.
   * Null means the page can file proposals but cannot show which steps
   * already have one — a warning, not a refusal. */
  proposalsPath: string | null;
}

export interface SubAppPlan {
  spec: MiniAppSpec;
  /** `mini-app` unless the spec asked for the other one by name. */
  profile: Profile;
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
  /** The Cowork workflow this app was converted from, when the spec
   * carried one. Null is ordinary — a mini-app need not come from a
   * workflow — and the page then renders panels alone. */
  workflow: PlannedWorkflow | null;
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

export interface PlanOptions {
  /** The proposal-template catalogue. ⛔ TESTS ONLY — so the refusals can be run against
   * an unapproved entry and the approved-`step` path exercised without the production
   * catalogue approving anything. Every production caller passes nothing and gets
   * `PROPOSAL_TEMPLATES`; `__tests__/propose-from-catalogue.test.ts` pins which non-test
   * files may name this. Never read from a spec: it is a parameter, not a field. */
  readonly proposalCatalogue?: readonly ProposalTemplate[];
}

/** Parses, resolves and cross-checks. Throws `SpecRejectedError` listing
 * every problem found — never a partial plan. */
export function planSubApp(input: unknown, options: PlanOptions = {}): SubAppPlan {
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
  const profile = profileOf(spec);

  if ((RESERVED_SUBAPP_IDS as readonly string[]).includes(spec.id)) {
    issues.push(
      `id "${spec.id}" is already a hand-written sub-app in the host registry — generating it would duplicate its nav path, route prefix and table prefix`,
    );
  }

  // ⭐ The profile fence. A mini-app is database-free, and a spec that
  // declares tables under the default profile is refused BY NAME rather
  // than quietly generating a migration for somebody's workspace.
  const declaredTables = spec.tables ?? [];
  if (profile === "mini-app" && declaredTables.length > 0) {
    issues.push(tableRefusalReason(spec.id, declaredTables.map((t) => t.name)));
  }
  if (profile === "table-backed" && declaredTables.length === 0) {
    warnings.push(
      `profile "table-backed" is declared but the spec has no tables — that profile exists only for a sub-app that needs its own storage; the default "mini-app" profile emits the same files minus schema.ts`,
    );
  }

  const tables = planTables(spec, issues);
  const tablesByBare = new Map(tables.map((t) => [t.bare, t]));
  const domains = planDomains(spec, profile, tablesByBare, issues, warnings);

  checkRouteUniqueness(domains, issues);
  checkProposalTemplates(spec, domains, options.proposalCatalogue ?? PROPOSAL_TEMPLATES, issues);
  checkCapabilityLeastPrivilege(spec, domains, issues);
  checkTablesAreUsed(tables, domains, warnings);
  const workflow = planWorkflow(spec, domains, issues, warnings);

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
    profile,
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
    workflow,
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
  profile: Profile,
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
      routes: domain.routes.map((route) => planRoute(spec, profile, domain, route, tablesByBare, issues, warnings)),
    });
  }
  return out;
}

function planRoute(
  spec: MiniAppSpec,
  profile: Profile,
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
    if (table === null) {
      // Under the default profile there is no table to name, and saying
      // "unknown table" would send the author off to add one — which is
      // the thing the profile refuses. Name the profile instead.
      issues.push(
        profile === "mini-app"
          ? `${where}: operation "${op.kind}" reads or writes a table, which profile "mini-app" has none of — a mini-app's routes reach the host only through the capability adapter (list-contracts, list-proposals, propose). Declare profile: "table-backed" if this app genuinely needs storage.`
          : `${where}: operation names unknown table "${op.table}"`,
      );
    }
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
    formId: `${route.method.toLowerCase()}-${route.path}`,
    proposalPrefix: op.kind === "propose" ? `${spec.id}-${op.proposalKind}-` : null,
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

/** ⭐ Owner ruling 2026-09-22 (8), at the one step every path goes through: "proposing apps
 * are generated only from a closed catalogue of proposal templates the owner approves …
 * generation refuses an unapproved one."
 *
 * The prompt path and the workflow conversion already build their proposing routes from
 * the catalogue. What they cannot cover is a @codegen spec that never went through them:
 * `cli.ts --spec <file|->`, which is `scripts/promote.sh`'s way into the host, and the
 * workbench's `candidateFrom(spec)`. So a `propose` operation is generated only when it is
 * EXACTLY an approved template's operation under this app's id, and only one route may file
 * each template — two would write proposals with the same `<app>-<kind>-` prefix, which the
 * step rail could not tell apart. */
function checkProposalTemplates(
  spec: MiniAppSpec,
  domains: readonly PlannedDomain[],
  catalogue: readonly ProposalTemplate[],
  issues: string[],
): void {
  const filed = new Set<string>();
  for (const domain of domains) {
    for (const route of domain.routes) {
      const op = route.operation;
      if (op.kind !== "propose") continue;
      const where = `${domain.name} ${route.method} ${route.subPath}`;
      const problem = proposeOperationProblem(op, spec.id, catalogue);
      if (problem !== null) {
        issues.push(
          `${where}: a proposing route is generated only from an approved proposal template, exactly as the catalogue holds it (owner ruling 2026-09-22 (8)) — ${problem}`,
        );
        continue;
      }
      if (filed.has(op.proposalKind)) {
        issues.push(
          `${where}: one route per proposal template — another route already files this one, and two routes sharing a template file proposals indistinguishable by filename (<app>-<kind>-<ticket>)`,
        );
        continue;
      }
      filed.add(op.proposalKind);
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

/** Resolve the `## Procedure` against the routes that were actually
 * planned.
 *
 * ⭐ WHY THIS IS A REFUSAL SITE AND NOT A RENDERING DETAIL. A step whose
 * action points at a route nobody emitted renders as a button that 404s,
 * and it renders that way silently — the page has no way to know. The
 * binding is checked here, once, against the planned domains, for the same
 * reason every other cross-field check lives in this file.
 *
 * The one rule with teeth is contract rule 7. A statutory step may be
 * PROPOSED and never performed: the orchestrate-workflow skill's own words
 * are "never advance out of order, never self-approve, never skip a
 * statutory step", and RPA "may set a file present … but only an
 * authenticated human may set audited or approved". So a statutory step
 * bound to an operation that writes state directly is refused. */
function planWorkflow(
  spec: MiniAppSpec,
  domains: readonly PlannedDomain[],
  issues: string[],
  warnings: string[],
): PlannedWorkflow | null {
  const workflow = spec.workflow;
  if (workflow === undefined) return null;

  const allRoutes = domains.flatMap((domain) => domain.routes.map((route) => ({ domain, route })));
  const proposalListings = allRoutes.filter((r) => r.route.operation.kind === "list-proposals");
  if (proposalListings.length > 1) {
    issues.push(
      `the spec declares ${proposalListings.length} "list-proposals" routes — the step rail reads exactly one, and two would make "has this step been proposed?" depend on which the page happened to call`,
    );
  }
  const proposalsPath = proposalListings[0]?.route.subPath ?? null;

  const steps: PlannedWorkflowStep[] = [];
  const seen = new Set<number>();
  const boundFormIds = new Set<string>();
  let previous = 0;

  for (const step of workflow.steps) {
    const where = `workflow step ${step.n} ("${step.title}")`;
    if (seen.has(step.n)) {
      issues.push(`${where} is declared twice`);
      continue;
    }
    seen.add(step.n);
    if (step.n <= previous) {
      issues.push(
        `${where} is numbered below the step before it (${previous}) — the Procedure's numbering IS the order the page renders and the order a person reads, so it has to ascend`,
      );
    }
    previous = step.n;

    let action: PlannedWorkflowStep["action"] = null;
    const bound = step.action;
    if (bound !== undefined) {
      const domain = domains.find((d) => d.name === bound.domain);
      if (domain === undefined) {
        issues.push(
          `${where}: action names domain "${bound.domain}", which this spec does not declare (declared: ${domains.map((d) => `"${d.name}"`).join(", ")})`,
        );
      } else {
        const route = domain.routes.find((r) => r.method === bound.method && r.subPath === bound.path);
        if (route === undefined) {
          issues.push(
            `${where}: action names "${bound.method} ${bound.path}" in domain "${bound.domain}", which declares ${domain.routes.map((r) => `"${r.method} ${r.subPath}"`).join(", ")}`,
          );
        } else {
          const gate = step.gate ?? "human";
          if (gate === "statutory" && route.operation.kind === "insert-row") {
            issues.push(
              `${where} is a statutory gate bound to an "insert-row" route, which writes state directly. A statutory step may only be PROPOSED (contract rule 7: propose, don't mutate) — bind it to a "propose" route, or drop the statutory gate if the step is not one.`,
            );
          }
          boundFormIds.add(route.formId);
          action = {
            domain: domain.name,
            method: route.method,
            subPath: route.subPath,
            label: route.summary ?? `${route.method} ${route.subPath}`,
            formId: route.formId,
            operationKind: route.operation.kind,
            proposalPrefix: route.proposalPrefix,
          };
        }
      }
    }

    steps.push({
      n: step.n,
      title: step.title,
      detail: step.detail ?? null,
      needs: step.needs ?? [],
      produces: step.produces ?? [],
      gate: step.gate ?? "human",
      action,
    });
  }

  // A proposal route nobody's step points at still works — it just does
  // not appear in the rail, which is the surface people will read as the
  // whole app. Worth a sentence, not a refusal.
  for (const { domain, route } of allRoutes) {
    if (route.operation.kind !== "propose" || boundFormIds.has(route.formId)) continue;
    warnings.push(
      `${domain.name} ${route.method} ${route.subPath} proposes, but no workflow step names it — it renders under "Other actions" instead of in the step rail`,
    );
  }
  if (proposalsPath === null && steps.some((s) => s.action !== null && s.action.proposalPrefix !== null)) {
    warnings.push(
      `no "list-proposals" route is declared, so the step rail can file proposals but cannot show which steps already have one — add a GET route with operation { kind: "list-proposals" } to give the steps real state`,
    );
  }

  return {
    name: workflow.name,
    description: workflow.description ?? null,
    source: workflow.source ?? null,
    steps,
    proposalsPath,
  };
}

function titleCase(kebab: string): string {
  return kebab
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
