/** The MiniAppSpec shape codegen accepts — declared HERE, as a structural
 * port, not imported from the spec package.
 *
 * ⛔ WHY A LOCAL COPY. Codegen's input is a *shape*, not a module. Binding
 * this package to `@spec/...`'s file layout would make every rename over
 * there a compile break here, and would make codegen untestable on its own.
 * The rule that keeps the two honest instead: `miniAppSpecSchema` is the
 * only door in. Anything the spec package produces that parses against it
 * generates; anything that does not is refused at the door with a Zod issue
 * list naming the field. If the spec package widens its output, the widening
 * shows up as a parse failure here — loudly, at the seam — rather than as a
 * silently ignored field in an emitted file.
 *
 * Everything in this file is the INPUT contract. The OUTPUT contract — what
 * a manifest must look like for the host to boot — lives in
 * `manifest-rules.ts`, a deliberate second copy of the host's own
 * `subAppManifestSchema` rules. Two schemas, because they check two
 * different things: a spec author can write a perfectly valid spec that
 * still derives an invalid manifest (an id with a capital letter, a
 * nav section the host does not know), and the generator must catch that
 * before it writes a file that takes the server down at boot. */
import { z } from "zod";
import { DEFAULT_PROFILE, PROFILES, type Profile } from "./profile";

/** Mirrors `server/subapps/types.ts`'s SUBAPP_ID_RE. Locked once shipped
 * (D-04): the id derives the env var, the nav path and the table prefix. */
export const SUBAPP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const NAV_SECTIONS = ["Overview", "Contract pipeline", "Ops & insight", "Admin", "System apps"] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

export const CAPABILITY_SCOPES = ["read:contracts", "write:inbox-proposal"] as const;
export type CapabilityScope = (typeof CAPABILITY_SCOPES)[number];

export const WORKSPACE_ROLES = ["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** `server/subapps/registry.ts`'s HOST_VERSION. Every generated manifest
 * declares exactly this — `assertHostVersionCompatible` refuses to boot a
 * manifest whose minHostVersion is newer, and a generated sub-app has no
 * business claiming to need a host that does not exist yet. */
export const HOST_VERSION = "5.0.0";

/** Ids already occupied in the host's `SUBAPP_MANIFESTS`. Generating over
 * one of these would produce a duplicate nav path, a duplicate route prefix
 * and a colliding table prefix — and the registry patch would push a second
 * entry beside the hand-written one. Refused at the door. */
export const RESERVED_SUBAPP_IDS = ["shell-reference", "docusign", "maps", "advantage"] as const;

/** The three columns codegen owns on every generated table. A spec declares
 * only its DOMAIN columns; these are always emitted first, so every
 * generated row is attributable and orderable without the spec author
 * remembering to ask. Redeclaring one is a coherence error, not a merge. */
export const MANAGED_COLUMNS = ["id", "created_at", "created_by"] as const;

const SNAKE_RE = /^[a-z][a-z0-9_]*$/;
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;
const CAMEL_RE = /^[a-z][A-Za-z0-9]*$/;

/** A Zod `.regex()` source that is safe to emit as a REGEX LITERAL into a
 * generated file: no `/` (would close the literal), no backslash-escape
 * games, no template-literal punctuation, no newline. Anything outside this
 * charset is refused rather than escaped — an emitter that escapes cleverly
 * is an emitter with an injection bug waiting in it. */
const EMITTABLE_PATTERN_RE = /^[A-Za-z0-9_^$.*+?()[\]{}|\\,:# -]+$/;

const emittablePattern = z
  .string()
  .min(1)
  .max(200)
  .regex(EMITTABLE_PATTERN_RE, "pattern uses characters that cannot be emitted as a regex literal")
  .refine((p) => !p.includes("\\\\"), "pattern must not contain a double backslash")
  .refine((p) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  }, "pattern is not a valid regular expression");

export const columnSpecSchema = z
  .object({
    name: z.string().regex(SNAKE_RE, "column name must be snake_case"),
    type: z.enum(["text", "integer", "real"]),
    notNull: z.boolean().optional(),
    /** Emitted as a SQLite `CHECK(col IN (...))`. Values are single-quoted
     * into the DDL, so the charset is deliberately narrow. */
    values: z.array(z.string().regex(/^[A-Za-z0-9_.-]+$/)).min(1).optional(),
  })
  .strict();
export type ColumnSpec = z.infer<typeof columnSpecSchema>;

export const tableSpecSchema = z
  .object({
    /** Bare name. The emitter prefixes it `subapp_<id_underscored>_`; a
     * spec never writes the prefix itself, so it cannot get it wrong. */
    name: z.string().regex(SNAKE_RE, "table name must be snake_case"),
    columns: z.array(columnSpecSchema).min(1),
    indexes: z.array(z.object({ on: z.array(z.string().regex(SNAKE_RE)).min(1) }).strict()).optional(),
  })
  .strict();
export type TableSpec = z.infer<typeof tableSpecSchema>;

export const fieldSpecSchema = z
  .object({
    /** camelCase — this is an HTTP body key, not a column. */
    name: z.string().regex(CAMEL_RE, "field name must be camelCase"),
    type: z.enum(["string", "integer", "number", "boolean", "enum"]),
    values: z.array(z.string().regex(/^[A-Za-z0-9_.-]+$/)).min(1).optional(),
    optional: z.boolean().optional(),
    maxLength: z.number().int().positive().max(100_000).optional(),
    pattern: emittablePattern.optional(),
    /** Which column this field lands in. Defaults to the snake_case of
     * `name`; only needed when the two genuinely differ. */
    column: z.string().regex(SNAKE_RE).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.type === "enum" && (field.values === undefined || field.values.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${field.name}": type "enum" needs a non-empty values[]` });
    }
    if (field.type !== "enum" && field.values !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${field.name}": values[] is only meaningful for type "enum"` });
    }
    if (field.type !== "string" && (field.maxLength !== undefined || field.pattern !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `field "${field.name}": maxLength/pattern are only meaningful for type "string"` });
    }
  });
export type FieldSpec = z.infer<typeof fieldSpecSchema>;

/** The closed set of things a generated handler may DO.
 *
 * ⭐ This union is the whole safety argument of the package. A generated
 * route cannot express "read this file" or "call this host service"
 * because there is no operation kind that means it. Widening the union is
 * the only way to widen what generated code can reach, which makes that
 * widening a reviewable event rather than a prompt away. */
export const operationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("list-rows"),
      table: z.string().regex(SNAKE_RE),
      orderBy: z.object({ column: z.string().regex(SNAKE_RE), direction: z.enum(["asc", "desc"]) }).strict().optional(),
      limit: z.number().int().positive().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("get-row"),
      table: z.string().regex(SNAKE_RE),
      keyColumn: z.string().regex(SNAKE_RE),
      /** The `:param` in this route's path that carries the key. */
      param: z.string().regex(CAMEL_RE),
    })
    .strict(),
  z
    .object({
      kind: z.literal("insert-row"),
      table: z.string().regex(SNAKE_RE),
      fields: z.array(fieldSpecSchema).min(1),
      /** Appended through `caps.auditAppend` — FIELD NAMES only, never
       * values (contract rule 8). Must be namespaced under the sub-app id. */
      auditEvent: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    })
    .strict(),
  z.object({ kind: z.literal("list-contracts") }).strict(),
  /** `caps.listOwnInboxProposals()` — the filenames under
   * `memory/proposals/` that THIS sub-app wrote, and the ONLY durable
   * state a database-free mini-app can observe about itself. The step
   * rail on the generated page reads this to say which workflow steps
   * have already been proposed; without it the page can still file
   * proposals but cannot tell you it did. Gated by `write:inbox-proposal`
   * in the host's `buildCapabilities`, which is why `requiredScopeOf`
   * answers that scope for a route that only READS. */
  z.object({ kind: z.literal("list-proposals") }).strict(),
  z
    .object({
      kind: z.literal("propose"),
      /** Becomes the proposal's `kind` and part of its filename. */
      proposalKind: z.string().regex(KEBAB_RE),
      /** Which body field names the contract folder. Forced to the
       * filename-safe charset by the emitter regardless of what the spec
       * says — it ends up in a path segment. */
      ticketField: z.string().regex(CAMEL_RE),
      fields: z.array(fieldSpecSchema).min(1),
      auditEvent: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    })
    .strict(),
]);
export type Operation = z.infer<typeof operationSchema>;

/** Sub-path under the route prefix. Named segments and `:params` only —
 * the whole path is emitted into a string literal, so nothing that could
 * escape it is admitted. Shared with `workflowStepSchema.action`, which
 * names a route by the same spelling the route declares. */
const ROUTE_PATH_RE = /^(\/(?::[a-z][A-Za-z0-9]*|[a-z0-9][a-z0-9-]*))+$/;

export const routeSpecSchema = z
  .object({
    method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
    path: z.string().max(120).regex(ROUTE_PATH_RE, 'path must be one or more "/segment" or "/:param" parts'),
    summary: z.string().min(1).max(200).optional(),
    operation: operationSchema,
  })
  .strict();
export type RouteSpec = z.infer<typeof routeSpecSchema>;

export const domainSpecSchema = z
  .object({
    /** One `routes/<name>.ts` per domain. */
    name: z.string().regex(KEBAB_RE, "domain name must be kebab-case"),
    title: z.string().min(1).max(80).optional(),
    routes: z.array(routeSpecSchema).min(1),
  })
  .strict();
export type DomainSpec = z.infer<typeof domainSpecSchema>;

/** How a step is allowed to complete — carried from the workflow's own
 * words, not invented here.
 *
 * `statutory` is the one that changes generated behaviour: the
 * orchestrate-workflow skill's Procedure says "never advance out of order,
 * never self-approve, never skip a statutory step", and contract rule 7
 * says no mini-app may resolve a gated or statutory step. So a statutory
 * step may be PROPOSED and never performed, and `plan.ts` refuses a spec
 * that binds one to an operation which writes state directly. */
export const WORKFLOW_GATES = ["human", "statutory", "auto"] as const;
export type WorkflowGate = (typeof WORKFLOW_GATES)[number];

/** One numbered line of a Cowork workflow's `## Procedure`.
 *
 * The four descriptive fields are the ones a person actually needs on
 * screen — the step's own words (`title`/`detail`), what it consumes
 * (`needs`) and what it leaves behind (`produces`). They are free text
 * copied out of the skill, so they are LENGTH-BOUNDED and nothing more:
 * they land in JSX text nodes, never in a path, a filename or SQL. */
export const workflowStepSchema = z
  .object({
    /** The step's number in the Procedure. Not an array index — a step
     * the conversion dropped must leave a visible gap rather than
     * silently renumber the ones after it. */
    n: z.number().int().positive().max(99),
    title: z.string().min(1).max(120),
    detail: z.string().min(1).max(600).optional(),
    needs: z.array(z.string().min(1).max(120)).max(8).optional(),
    produces: z.array(z.string().min(1).max(120)).max(8).optional(),
    gate: z.enum(WORKFLOW_GATES).optional(),
    /** The generated route that performs this step, named the way the
     * route declares itself. A step with no action is a checklist line:
     * the page shows it and says, in as many words, that it happens
     * somewhere else. Most steps of a real workflow are that.
     *
     * ⛔ `method` is REQUIRED, not inferred from the path. One domain may
     * legitimately carry `GET /clocks` and `POST /clocks`, and a binding
     * that matched on path alone would silently pick whichever came first
     * — which is how a statutory step ends up pointing at the write route
     * while the gate check looked at the read one. */
    action: z
      .object({
        domain: z.string().regex(KEBAB_RE),
        method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
        path: z.string().max(120).regex(ROUTE_PATH_RE),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WorkflowStepSpec = z.infer<typeof workflowStepSchema>;

/** The workflow a mini-app was converted FROM, kept with the app.
 *
 * ⭐ Why the generator carries this at all. Without it, a converted
 * workflow becomes a page of unlabelled forms and the thing a person
 * actually holds in their head — step 3 waits for step 2, step 5 is
 * statutory — is the one thing the output loses. With it, the emitted
 * page is a step rail: the steps in order, what each needs, what each
 * produced, and which ones this app has already proposed. */
export const workflowSpecSchema = z
  .object({
    /** The skill's frontmatter `name`. */
    name: z.string().min(1).max(80),
    /** The skill's frontmatter `description`, trimmed to a blurb. */
    description: z.string().min(1).max(600).optional(),
    /** Where the workflow came from, e.g. `skills/orchestrate-workflow/SKILL.md`.
     * Rendered verbatim as provenance; never opened by anything. */
    source: z.string().min(1).max(200).optional(),
    steps: z.array(workflowStepSchema).min(1).max(30),
  })
  .strict();
export type WorkflowSpec = z.infer<typeof workflowSpecSchema>;

export const miniAppSpecSchema = z
  .object({
    /** Which shape to emit. Absent means `mini-app`: database-free, the
     * `shell-reference` floor, and the only profile a Cowork-workflow
     * conversion should ever need. See `profile.ts` for why the other one
     * is kept and why it has to be asked for by name. */
    profile: z.enum(PROFILES).optional(),
    id: z.string().min(1).max(40).regex(SUBAPP_ID_RE, "id must match /^[a-z0-9][a-z0-9-]*$/"),
    /** Literal English. The shell renders it verbatim; it is NOT an i18n key. */
    label: z.string().min(1).max(80),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    icon: z.string().min(1).max(8),
    navSection: z.enum(NAV_SECTIONS),
    /** One sentence under the page title. Literal English, same rule as label. */
    summary: z.string().min(1).max(300).optional(),
    capabilities: z.array(z.enum(CAPABILITY_SCOPES)),
    visibleToRoles: z.array(z.enum(WORKSPACE_ROLES)).min(1),
    webModuleId: z.string().regex(KEBAB_RE).optional(),
    settingsPanel: z
      .object({
        tier: z.enum(["workspace-admin", "super-admin"]),
        label: z.string().min(1).max(80),
      })
      .strict()
      .optional(),
    /** ⛔ NOT the mini-app path. Parsed here so the refusal can NAME the
     * tables it is refusing (`plan.ts`, via `tableRefusalReason`) instead
     * of rejecting an unknown key and leaving the author guessing; only a
     * spec that also says `profile: "table-backed"` gets a schema.ts. */
    tables: z.array(tableSpecSchema).optional(),
    workflow: workflowSpecSchema.optional(),
    domains: z.array(domainSpecSchema).min(1),
  })
  .strict();
export type MiniAppSpec = z.infer<typeof miniAppSpecSchema>;

export function profileOf(spec: MiniAppSpec): Profile {
  return spec.profile ?? DEFAULT_PROFILE;
}

/** `settingsPanel.webComponentId` is deliberately NOT a spec field: the web
 * loader globs `web/src/subapps/<webComponentId>/SettingsPanel.tsx`, so any
 * value other than the module id fails closed and contributes no panel at
 * all (the mistake `advantage/manifest.ts`'s own comment warns about). The
 * emitter derives it from `webModuleId` instead of letting a spec get it
 * wrong. */
export function webModuleIdOf(spec: MiniAppSpec): string {
  return spec.webModuleId ?? spec.id;
}

export function versionOf(spec: MiniAppSpec): string {
  return spec.version ?? "0.1.0";
}

/** Which capability scope an operation actually needs — the single source
 * of truth behind both directions of the least-privilege check in
 * `coherence.ts`. `auditAppend` appears here as `null` on purpose: it is
 * ungated in the host's `buildCapabilities` (see types.ts's note on
 * `resolveSigningAuthority`, "mirroring the existing auditAppend
 * precedent"), so an audit-only sub-app declaring `capabilities: []` is a
 * valid and deliberately common shape. */
export function requiredScopeOf(op: Operation): CapabilityScope | null {
  switch (op.kind) {
    case "list-contracts":
      return "read:contracts";
    case "propose":
    // Reading its own proposals is gated by the WRITE scope in the host's
    // `buildCapabilities` — `listOwnInboxProposals` calls
    // `require("write:inbox-proposal")`. Answering "read:contracts" here
    // because the route only reads would emit a sub-app that 403s forever.
    case "list-proposals":
      return "write:inbox-proposal";
    case "list-rows":
    case "get-row":
    case "insert-row":
      return null;
  }
}
