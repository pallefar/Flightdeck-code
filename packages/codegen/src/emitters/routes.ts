/** `routes/index.ts` and one `routes/<domain>.ts` per domain.
 *
 * ── THE FOUR PROPERTIES EVERY EMITTED HANDLER HAS ────────────────────
 * 1. The guard is the FIRST statement. Not the first interesting one —
 *    the first. Nothing is parsed, read or written above it, because the
 *    shell enforces roles only and never enable-state for a sub-app's own
 *    routes.
 * 2. Zod at every boundary, `.strict()` on every body, and path params get
 *    a schema too. Fastify producing a param is not the same as the param
 *    being what the handler assumes.
 * 3. No template literals anywhere in the file. That is a hard rule this
 *    emitter keeps and `invariants.ts` enforces: with no template literal,
 *    there is no syntactic way for spec text or request data to end up
 *    interpolated into a SQL string. Generated code concatenates with `+`
 *    where it must build a string at all, and every value that reaches SQL
 *    goes through a `?` placeholder.
 * 4. Only `ctx.capabilitiesFor(...)` reaches contracts, proposals or the
 *    audit log. No `node:` import, no db driver, no host reader module, no
 *    sibling sub-app — the import list of an emitted route file is a short
 *    closed set, and `invariants.ts` checks it against an ALLOWLIST rather
 *    than a list of things to avoid.
 *
 * ── WHY EVERY LIST QUERY CARRIES A LIMIT ─────────────────────────────
 * `list-rows` emits `LIMIT` whether or not the spec asked for one (default
 * 200). A generated route is a route nobody has load-tested; an unbounded
 * `SELECT` over a workspace table is the cheapest way to turn a mini-app
 * into an outage. The spec may raise it, up to the cap the schema allows. */
import { banner, joinLines, str } from "../emit";
import type { PlannedDomain, PlannedField, PlannedRoute, SubAppPlan } from "../plan";

const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_STRING_MAX = 2000;

/** The filename-safe ticket charset, forced on every `propose` ticket
 * field. A spec cannot widen it: the value becomes part of a path segment
 * under `memory/proposals/`. Byte-identical to `shell-reference/routes.ts`. */
const TICKET_PATTERN = "/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/";

export function emitRoutesIndex(plan: SubAppPlan): string {
  return joinLines([
    banner([
      `${plan.label} route aggregator — GENERATED. Calls each per-domain registrar.`,
      "",
      "One import and one call per domain. `manifest.ts` names this file and nothing else, so a new domain never touches the manifest.",
    ]),
    `import type { FastifyInstance } from "fastify";`,
    `import type { RegisterRoutesCtx } from "../../types.js";`,
    ...plan.domains.map((d) => `import { ${d.registerFn} } from "./${d.name}.js";`),
    "",
    `export function ${plan.names.registerRoutesFn}(app: FastifyInstance, ctx: RegisterRoutesCtx): void {`,
    ...plan.domains.map((d) => `  ${d.registerFn}(app, ctx);`),
    "}",
    "",
  ]);
}

export function emitDomainRoutes(plan: SubAppPlan, domain: PlannedDomain): string {
  const usesCaps = domain.routes.some((r) => needsCaps(r));
  const usesCapabilityScope = domain.routes.some((r) => r.requiredScope !== null);
  // The `WorkspaceRuntime` type is needed by any handler that binds `rt`,
  // which is every table-backed route AND every capability route — not just
  // the table-backed ones. Getting this condition wrong emits a file that
  // names a type it never imported.
  const bindsRuntime = domain.routes.some((r) => r.table !== null || needsCaps(r));
  const usesTicket = domain.routes.some((r) => r.operation.kind === "propose");
  const ctxParam = usesCaps ? "ctx" : "_ctx";

  const schemaConsts: string[] = [];
  // `z` is imported only when a schema is actually emitted: an unused
  // import in generated code is the kind of small wrongness that teaches a
  // reader not to trust the rest of the file.
  const usesZod = domain.routes.some((r) => r.bodyConstName !== null || r.paramsConstName !== null);
  for (const route of domain.routes) {
    const body = emitBodySchema(route);
    if (body !== null) schemaConsts.push(body, "");
    const params = emitParamsSchema(route);
    if (params !== null) schemaConsts.push(params, "");
  }

  return joinLines([
    banner([
      `${plan.label} — ${domain.title} routes. GENERATED.`,
      "",
      `\`${plan.names.guardFn}\` is the FIRST statement in every handler below, and its refusal is mapped to a 403 by the shared \`mapError\`. The shell's manifest-derived RBAC rule checks ROLES ONLY and never enable-state, so a handler missing that call would answer with the kill switch off.`,
      "",
      "⛔ This file contains no template literal, by construction. Nothing a request or a spec carries can be interpolated into a SQL string; every value reaches the database through a `?` placeholder.",
      usesCapabilityScope
        ? "Contracts, proposals and the audit log are reached ONLY through `ctx.capabilitiesFor(...)` — never a filesystem or reader-module import of this file's own."
        : "Nothing here reaches outside this sub-app's own tables; the capability adapter is used for audit only, which the host leaves ungated.",
    ]),
    usesZod ? `import { z } from "zod";` : null,
    `import type { FastifyInstance, FastifyReply } from "fastify";`,
    `import type { RegisterRoutesCtx } from "../../types.js";`,
    bindsRuntime ? `import type { WorkspaceRuntime } from "../../../workspace/types.js";` : null,
    usesCapabilityScope ? `import { CapabilityDeniedError } from "../../capabilities.js";` : null,
    `import { ${plan.names.disabledError}, ${plan.names.guardFn} } from "../guard.js";`,
    "",
    ...(usesTicket
      ? [
          "/** Forced by codegen, never taken from the spec: a ticket becomes part",
          " * of a proposal FILENAME, so a slash or a dot-dot must not reach the",
          " * adapter's containment check in the first place. */",
          `const TICKET_RE = ${TICKET_PATTERN};`,
          "",
        ]
      : []),
    ...schemaConsts,
    emitMapError(plan, usesCapabilityScope),
    "",
    `export function ${domain.registerFn}(app: FastifyInstance, ${ctxParam}: RegisterRoutesCtx): void {`,
    domain.routes.map((route) => emitHandler(plan, route)).join("\n\n"),
    "}",
    "",
  ]);
}

function needsCaps(route: PlannedRoute): boolean {
  return (
    route.operation.kind === "list-contracts" ||
    route.operation.kind === "list-proposals" ||
    route.operation.kind === "propose" ||
    route.operation.kind === "insert-row"
  );
}

function emitMapError(plan: SubAppPlan, usesCapabilityScope: boolean): string {
  return joinLines([
    "/** One refusal map for the whole file, so no handler invents its own",
    " * status for a refusal the rest already answer consistently. An error",
    " * this does not recognise is RETHROWN, not swallowed into a 500 body",
    " * that hides it from the host's error handler. */",
    "function mapError(reply: FastifyReply, err: unknown) {",
    `  if (err instanceof ${plan.names.disabledError}) {`,
    `    return reply.code(403).send({ error: err.message, code: "subapp_disabled" });`,
    "  }",
    ...(usesCapabilityScope
      ? [
          "  if (err instanceof CapabilityDeniedError) {",
          `    return reply.code(403).send({ error: err.message, code: "capability_denied", scope: err.scope ?? null });`,
          "  }",
        ]
      : []),
    "  throw err;",
    "}",
  ]);
}

function emitBodySchema(route: PlannedRoute): string | null {
  if (route.bodyConstName === null) return null;
  const op = route.operation;
  const ticketField = op.kind === "propose" ? op.ticketField : null;
  const lines = route.fields.map((field) => `  ${field.name}: ${zodForField(field, field.name === ticketField)},`);
  return joinLines([
    `const ${route.bodyConstName} = z`,
    "  .object({",
    ...lines.map((l) => `  ${l}`),
    "  })",
    "  .strict();",
  ]);
}

/** `.strict()` on the body is not decoration: an unknown key that silently
 * passes is a widening nobody reviewed. */
function zodForField(field: PlannedField, isTicket: boolean): string {
  if (isTicket) {
    return `z.string().regex(TICKET_RE, ${str("must be 1-64 characters of A-Z a-z 0-9 . _ -")})`;
  }
  let expr: string;
  switch (field.type) {
    case "string":
      expr = `z.string().min(1).max(${field.maxLength ?? DEFAULT_STRING_MAX})`;
      if (field.pattern !== undefined) expr += `.regex(/${field.pattern}/)`;
      break;
    case "integer":
      expr = "z.number().int()";
      break;
    case "number":
      expr = "z.number()";
      break;
    case "boolean":
      expr = "z.boolean()";
      break;
    case "enum":
      expr = `z.enum([${(field.values ?? []).map(str).join(", ")}])`;
      break;
  }
  return field.optional === true ? `${expr}.optional()` : expr;
}

function emitParamsSchema(route: PlannedRoute): string | null {
  if (route.paramsConstName === null || route.operation.kind !== "get-row") return null;
  return joinLines([
    `const ${route.paramsConstName} = z`,
    "  .object({",
    `    ${route.operation.param}: z.string().min(1).max(200),`,
    "  })",
    "  .strict();",
  ]);
}

function emitHandler(plan: SubAppPlan, route: PlannedRoute): string {
  const body = joinLines([...emitGuardFirst(plan, route), ...emitOperation(plan, route)]);
  return joinLines([
    ...(route.summary !== null ? [`  // ${route.summary}`] : []),
    `  app.${route.fastifyMethod}(${str(route.fullPath)}, async (req, reply) => {`,
    body,
    "  });",
  ]);
}

/** The guard block, emitted identically for every handler. `rt` is declared
 * before the try so the rest of the handler reads it as definitely
 * assigned; the catch returns, so there is no path past this block with the
 * sub-app disabled. */
function emitGuardFirst(plan: SubAppPlan, route: PlannedRoute): string[] {
  const needsRt = route.table !== null || needsCaps(route);
  if (!needsRt) {
    return [
      "    try {",
      `      await ${plan.names.guardFn}(req);`,
      "    } catch (err) {",
      "      return mapError(reply, err);",
      "    }",
    ];
  }
  return [
    "    let rt: WorkspaceRuntime;",
    "    try {",
    `      rt = await ${plan.names.guardFn}(req);`,
    "    } catch (err) {",
    "      return mapError(reply, err);",
    "    }",
  ];
}

function emitOperation(plan: SubAppPlan, route: PlannedRoute): string[] {
  const op = route.operation;
  switch (op.kind) {
    case "list-rows":
      return emitListRows(route);
    case "get-row":
      return emitGetRow(route);
    case "insert-row":
      return emitInsertRow(route);
    case "list-contracts":
      return emitListContracts();
    case "list-proposals":
      return emitListProposals();
    case "propose":
      return emitPropose(plan, route);
  }
}

function columnList(route: PlannedRoute): string {
  const table = route.table;
  if (table === null) throw new Error("internal: table-backed operation without a planned table");
  return table.columns.map((c) => c.name).join(", ");
}

function emitListRows(route: PlannedRoute): string[] {
  const op = route.operation;
  if (op.kind !== "list-rows" || route.table === null) throw new Error("internal: emitListRows on the wrong operation");
  const order = op.orderBy ? `${op.orderBy.column} ${op.orderBy.direction.toUpperCase()}, id DESC` : "created_at DESC, id DESC";
  const sql = `SELECT ${columnList(route)} FROM ${route.table.full} ORDER BY ${order} LIMIT ${op.limit ?? DEFAULT_LIST_LIMIT}`;
  return [
    "    const rows = await rt.db",
    `      .prepare(${str(sql)})`,
    "      .all();",
    "    return { rows };",
  ];
}

function emitGetRow(route: PlannedRoute): string[] {
  const op = route.operation;
  if (op.kind !== "get-row" || route.table === null || route.paramsConstName === null) {
    throw new Error("internal: emitGetRow on the wrong operation");
  }
  const sql = `SELECT ${columnList(route)} FROM ${route.table.full} WHERE ${op.keyColumn} = ?`;
  return [
    `    const params = ${route.paramsConstName}.safeParse(req.params);`,
    `    if (!params.success) return reply.code(400).send({ error: "invalid path parameters", issues: params.error.issues });`,
    "    const row = await rt.db",
    `      .prepare(${str(sql)})`,
    `      .get(params.data.${op.param});`,
    `    if (!row) return reply.code(404).send({ error: "no such row", code: "unknown_row" });`,
    "    return row;",
  ];
}

function emitInsertRow(route: PlannedRoute): string[] {
  const op = route.operation;
  if (op.kind !== "insert-row" || route.table === null) throw new Error("internal: emitInsertRow on the wrong operation");
  const columns = ["id", "created_at", "created_by", ...route.fields.map((f) => f.targetColumn)];
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${route.table.full} (${columns.join(", ")}) VALUES (${placeholders})`;
  const binds = ["id", "createdAt", "createdBy", ...route.fields.map(bindExpression)];
  return [
    `    const parsed = ${route.bodyConstName as string}.safeParse(req.body);`,
    `    if (!parsed.success) return reply.code(400).send({ error: "invalid body", issues: parsed.error.issues });`,
    "    const id = globalThis.crypto.randomUUID();",
    "    const createdAt = new Date().toISOString();",
    `    const createdBy = req.principal?.username ?? "anonymous";`,
    "    try {",
    "      await rt.db",
    `        .prepare(${str(sql)})`,
    `        .run(${binds.join(", ")});`,
    "      // Audit names FIELDS, never their values (contract rule 8): a body",
    "      // key can be `salary`, so only the key set is recorded.",
    "      const caps = await ctx.capabilitiesFor(rt.id);",
    "      caps.auditAppend({",
    `        event: ${str(op.auditEvent)},`,
    "        id,",
    "        actor: createdBy,",
    "        fields: Object.keys(parsed.data).sort(),",
    "      });",
    "      return reply.code(201).send({ id, createdAt, createdBy });",
    "    } catch (err) {",
    "      return mapError(reply, err);",
    "    }",
  ];
}

function bindExpression(field: PlannedField): string {
  const access = `parsed.data.${field.name}`;
  if (field.type === "boolean") return field.optional === true ? `${access} === undefined ? null : ${access} ? 1 : 0` : `${access} ? 1 : 0`;
  return field.optional === true ? `${access} ?? null` : access;
}

/** ⭐ PROJECTED ONTO A DECLARED SHAPE, NOT PASSED THROUGH.
 *
 * This was `return { rows: caps.readContracts() }`, which puts whatever the
 * capability adapter hands back onto the wire verbatim — including
 * `ContractFolder.dir`, an ABSOLUTE PATH ON THE SERVER. In the host that is
 * the Flightdeck machine's own directory layout, serialised to every browser
 * with this sub-app open and rendered into the DOM as a table column. It was
 * also, measurably, the widest column on the page: the thing a reader's eye
 * landed on first was a filesystem path they can do nothing with.
 *
 * ⚠ THIS IS THE SAME RULE THE ENVELOPE APPLIES OUTBOUND, TURNED AROUND. A
 * caller's bytes do not reach the model unless they are a member of a
 * compiled-in set; the server's bytes should not reach the browser unless the
 * route named them. "Return the adapter's object" is an unallowlisted region
 * in the one direction nobody was checking.
 *
 * Nothing loses a capability here. A route cannot read the filesystem
 * (contract rule 3), so a path in the browser was never actionable — and
 * `ticket` and `folderName` are what every emitted page actually renders.
 * Adding a field back is a one-line change a person makes deliberately, which
 * is the point of naming them.
 */
function emitListContracts(): string[] {
  return [
    "    const caps = await ctx.capabilitiesFor(rt.id);",
    "    try {",
    "      const folders = caps.readContracts();",
    "      return {",
    "        rows: folders.map((folder) => ({ ticket: folder.ticket, folderName: folder.folderName })),",
    "      };",
    "    } catch (err) {",
    "      return mapError(reply, err);",
    "    }",
  ];
}

/** The sub-app's own filed proposals, by filename.
 *
 * This is the whole state model of a database-free mini-app. It stores
 * nothing, so the only thing it can observe about its own past is the set
 * of files it wrote under `memory/proposals/` — which the adapter scopes
 * to this sub-app's own `<id>-` prefix, siblings excluded. The generated
 * page matches those names against each workflow step's proposal prefix to
 * say "step 4 has been proposed, and a human resolves it in the Inbox".
 *
 * `proposalPath` is built with `+` rather than a template literal, like
 * every other string in this file, and is the same `memory/proposals/`
 * spelling the propose handler answers with, so the two agree in the page.
 *
 * ⚠ Read-only by construction: `listOwnInboxProposals` returns names. A
 * route that wanted a proposal's CONTENTS would need a filesystem read,
 * which the adapter does not offer and which contract rule 3 forbids. */
function emitListProposals(): string[] {
  return [
    "    const caps = await ctx.capabilitiesFor(rt.id);",
    "    try {",
    "      const rows = caps.listOwnInboxProposals().map((fileName) => ({",
    "        fileName,",
    '        proposalPath: "memory/proposals/" + fileName,',
    "      }));",
    "      return { rows };",
    "    } catch (err) {",
    "      return mapError(reply, err);",
    "    }",
  ];
}

/** Ported from `shell-reference/routes.ts`, with the guard added above it.
 *
 * Idempotent per ticket: one open proposal per folder. The already-filed
 * match is the EXACT filename shape this route writes, not a bare prefix —
 * `DE-2026-9001-` is a prefix of `DE-2026-9001-x-…`, and a prefix test
 * would report the wrong ticket as already flagged.
 *
 * Propose, never mutate (contract rule 7): this writes a file under
 * `memory/proposals/` and nothing else. No generated operation advances a
 * gated or statutory step. */
function emitPropose(plan: SubAppPlan, route: PlannedRoute): string[] {
  const op = route.operation;
  if (op.kind !== "propose") throw new Error("internal: emitPropose on the wrong operation");
  const canReadContracts = plan.spec.capabilities.includes("read:contracts");
  const filenamePrefix = `${plan.id}-${op.proposalKind}-`;
  return [
    `    const parsed = ${route.bodyConstName as string}.safeParse(req.body);`,
    `    if (!parsed.success) return reply.code(400).send({ error: "invalid body", issues: parsed.error.issues });`,
    `    const ticket = parsed.data.${op.ticketField};`,
    "    const caps = await ctx.capabilitiesFor(rt.id);",
    "    try {",
    ...(canReadContracts
      ? [
          "      const folder = caps.readContracts().find((row) => row.ticket === ticket);",
          `      if (!folder) return reply.code(404).send({ error: "no contract folder by that name in this workspace", code: "unknown_ticket" });`,
        ]
      : [
          "      // No `read:contracts` scope is declared, so the ticket is NOT",
          "      // checked against a real contract folder here. Declaring the scope",
          "      // is what would buy that check — least privilege cuts both ways.",
        ]),
    `      const prefix = ${str(filenamePrefix)} + ticket + "-";`,
    "      const already = caps",
    "        .listOwnInboxProposals()",
    "        .find((f) => f.startsWith(prefix) && /^[0-9]+\\.json$/.test(f.slice(prefix.length)));",
    "      if (already) {",
    `        return { proposalPath: "memory/proposals/" + already, alreadyFiled: true, proposedBy: null };`,
    "      }",
    "      // WHO asked — resolved server-side from the session principal, never",
    "      // from the body. Null only with auth off; never a literal stand-in.",
    "      const proposedBy = req.principal",
    "        ? { username: req.principal.username, displayName: req.principal.displayName }",
    "        : null;",
    "      const proposalPath = caps.writeInboxProposal(prefix + Date.now() + \".json\", {",
    `        kind: ${str(`${plan.id}-${op.proposalKind}`)},`,
    "        ...parsed.data,",
    "        proposedBy,",
    "        proposedAt: new Date().toISOString(),",
    "      });",
    "      caps.auditAppend({",
    `        event: ${str(op.auditEvent)},`,
    "        proposalPath,",
    "        ticket,",
    "        proposedBy: proposedBy?.username ?? null,",
    "        fields: Object.keys(parsed.data).sort(),",
    "      });",
    "      return { proposalPath, alreadyFiled: false, proposedBy };",
    "    } catch (err) {",
    "      return mapError(reply, err);",
    "    }",
  ];
}
