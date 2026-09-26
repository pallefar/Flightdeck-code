/** A LOCAL COPY of the host's `subAppManifestSchema` rules
 * (`server/subapps/types.ts`) plus the two boot-time checks that sit beside
 * it in `registry.ts`.
 *
 * ⛔ WHY COPY A SCHEMA. The host's copy is the one that runs, and
 * `loadValidatedManifests` is fail-LOUD: one malformed generated manifest
 * does not get skipped, it takes the whole server down at boot. Codegen
 * therefore has to answer "would this boot?" BEFORE it writes a file —
 * which means having the rules here, in a package that does not and must
 * not import the host.
 *
 * ⭐ WHAT KEEPS THE COPY HONEST. `__tests__/manifest-rules.test.ts` runs
 * this schema against the FOUR REAL hand-written manifests on disk
 * (`shell-reference`, `docusign`, `maps`, `advantage`), read as source text
 * and parsed by `testing/readEmittedManifest.ts`. If the host widens or
 * narrows a rule, a real manifest stops matching this copy and that test
 * goes red — the drift is caught by reality, not by a comment asking
 * someone to remember. The contract document says it plainly: if this and
 * the host repo disagree, the host repo wins. */
import { z } from "zod";
import { CAPABILITY_SCOPES, HOST_VERSION, LISTING_CATEGORIES, NAV_SECTIONS, SUBAPP_ID_RE, WORKSPACE_ROLES } from "./spec-contract";

const ROUTE_PREFIX_RE = /^\/api\/apps\/[a-z0-9-]+$/;

/** ⛔ D-036 (option b, fail-closed). The marker codegen stamps on every
 * manifest it generates, exactly as the host's `subAppManifestSchema`
 * declares it: `z.literal("flightdeck-studio").optional()`. The host's
 * `tests/subapps/launcherSubappDefaults.test.ts` keys on this exact string
 * and holds a marked sub-app to a STRICTER launcher rule — off by default,
 * its kill switch never named in `scripts/start-postgres.sh`. It grants
 * nothing; a hand-written manifest omits it. */
export const GENERATED_BY = "flightdeck-studio" as const;

const settingsPanelSchema = z.object({
  tier: z.enum(["workspace-admin", "super-admin"]),
  webComponentId: z.string().min(1),
  label: z.string().min(1),
});

/** Field-for-field with `server/subapps/types.ts#subAppListingSchema`
 * (apps-01, D-037) — and `.strict()` like the host's, which is the point:
 * an unknown key (copy, a URL, media, release state) FAILS LOUD at boot
 * rather than being stripped and later mistaken for approved content. */
export const subAppListingSchema = z
  .object({
    availability: z.enum(["available", "coming-soon"]),
    discoverable: z.boolean().default(false),
    category: z.enum(LISTING_CATEGORIES),
    requirements: z.array(z.string().regex(SUBAPP_ID_RE)).max(5).optional(),
    publisher: z.object({ name: z.string().min(1) }).strict(),
  })
  .strict();

/** sdk-21 — the host's `subAppIntegrationSchema` (server/subapps/types.ts),
 * transcribed: DECLARED outbound operations, a request that grants nothing.
 * Every object is `.strict()` in the host (a target URL or a token FAILS
 * LOUD at boot), so here too. `kind` is the host's shipped connector kinds
 * (server/services/connectors/kinds.ts) — drift-tested in codegen's
 * manifest-rules.test.ts. Cross-reference rules (secret roles per kind,
 * schema files on disk, public egress hosts) are the host kit's
 * `integration-*` checks, not shape. */
export const CONNECTOR_KIND_IDS = ["teams", "power-automate", "atlas"] as const;
const INTEGRATION_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const EGRESS_HOST_RE = /^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;
const SUBAPP_EVENT_RE = /^subapp\.[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const INTEGRATION_SCHEMA_FILE_RE = /^(?!.*\.\.)[a-z0-9][a-z0-9/_.-]*\.json$/;
const LABEL_KEY_RE = /^[a-z0-9][a-z0-9-]*(?:\.[A-Za-z0-9_-]+)+$/;
const INTEGRATION_MAX_BYTES = 262144;
const integrationOperationSchema = z
  .object({
    key: z.string().regex(INTEGRATION_SLUG_RE),
    event: z.string().regex(SUBAPP_EVENT_RE),
    payloadSchema: z.string().regex(INTEGRATION_SCHEMA_FILE_RE),
    responseSchema: z.string().regex(INTEGRATION_SCHEMA_FILE_RE).optional(),
    maxBytes: z.number().int().positive().max(INTEGRATION_MAX_BYTES),
  })
  .strict();
const subAppIntegrationSchema = z
  .object({
    key: z.string().regex(INTEGRATION_SLUG_RE),
    kind: z.enum(CONNECTOR_KIND_IDS),
    labelKey: z.string().regex(LABEL_KEY_RE),
    egressHosts: z.array(z.string().regex(EGRESS_HOST_RE)).min(1).max(5),
    secretRefs: z
      .array(z.object({ name: z.string().regex(INTEGRATION_SLUG_RE), role: z.string().regex(INTEGRATION_SLUG_RE) }).strict())
      .max(5),
    operations: z.array(integrationOperationSchema).min(1).max(10),
  })
  .strict();

/** sdk-44 — the host's `subAppWorkflowStepSchema` (server/subapps/types.ts),
 * transcribed: optional Builder palette steps. `.strict()` in the host, with
 * unique keys; declaring one runs nothing. Codegen emits none. */
const WORKFLOW_STEP_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const WORKFLOW_STEP_INPUT_TYPES = ["text", "number", "contractRef", "date"] as const;
const uniqueKeys =
  (what: string) =>
  (items: ReadonlyArray<{ key: string }>, ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    for (const [i, it] of items.entries()) {
      if (seen.has(it.key)) ctx.addIssue({ code: "custom", path: [i, "key"], message: `duplicate ${what} key "${it.key}"` });
      seen.add(it.key);
    }
  };
const workflowStepInputSchema = z
  .object({
    key: z.string().regex(WORKFLOW_STEP_SLUG_RE),
    labelKey: z.string().regex(LABEL_KEY_RE),
    type: z.enum(WORKFLOW_STEP_INPUT_TYPES),
    required: z.boolean(),
  })
  .strict();
const subAppWorkflowStepSchema = z
  .object({
    key: z.string().regex(WORKFLOW_STEP_SLUG_RE),
    labelKey: z.string().regex(LABEL_KEY_RE),
    descriptionKey: z.string().regex(LABEL_KEY_RE),
    input: z.array(workflowStepInputSchema).max(10).superRefine(uniqueKeys("input")),
    action: z.union([
      z.object({ proposalTemplateId: z.string().regex(WORKFLOW_STEP_SLUG_RE) }).strict(),
      z.object({ handler: z.literal(true) }).strict(),
    ]),
    gate: z.enum(["human", "statutory"]),
  })
  .strict();

/** sdk-63 — the host's `subAppMigrationSchema` (server/subapps/types.ts),
 * transcribed regex for regex: one Postgres migration the app ships, a
 * DECLARATION the host's catalogue and executor act on (the SDK runs
 * nothing). `emitters/migrations.ts` writes exactly this shape.
 * `__tests__/schema-migration.test.ts` pins the host block by hash and
 * compares this copy to it. */
const MIGRATION_NODE_ID_RE = /^[a-z0-9][a-z0-9_.-]*$/;
const MIGRATION_FILE_RE = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\.sql$/;
export const subAppMigrationSchema = z
  .object({
    node_id: z.string().regex(MIGRATION_NODE_ID_RE),
    file: z.string().regex(MIGRATION_FILE_RE),
    class: z.enum(["immutable", "generated"]),
    phase: z.enum(["expand", "backfill", "validate", "contract", "unknown"]).optional(),
    after: z.array(z.string().regex(MIGRATION_NODE_ID_RE)).optional(),
  })
  .strict();
export type SubAppMigration = z.infer<typeof subAppMigrationSchema>;

/** sdk-42 — the host's `subAppWorkflowTemplateSchema` (server/subapps/types.ts),
 * transcribed: optional starting processes for the Workflow Builder. The
 * manifest carries only the key, label key and a bare `<slug>.process.json`
 * file NAME; the host kit's `workflow-templates-valid` judges the file.
 * `.strict()`, at most five, unique keys. Codegen emits none. */
const WORKFLOW_TEMPLATE_FILE_RE = /^[a-z0-9][a-z0-9-]*\.process\.json$/;
const subAppWorkflowTemplateSchema = z
  .object({
    key: z.string().regex(WORKFLOW_STEP_SLUG_RE),
    labelKey: z.string().regex(LABEL_KEY_RE),
    file: z.string().regex(WORKFLOW_TEMPLATE_FILE_RE),
  })
  .strict();

/** upd-app-schema-range — the host's `subAppAppSchemaRangeSchema`, transcribed:
 * an INCLUSIVE range of app schema versions, integers >= 1, `.strict()`,
 * min <= max (a malformed range refuses to boot). Codegen emits none. */
const subAppAppSchemaRangeSchema = z
  .object({
    min: z.number().int().min(1),
    max: z.number().int().min(1),
  })
  .strict()
  .refine((r) => r.min <= r.max, { message: "appSchema.min must not exceed appSchema.max" });

/** Field-for-field with `server/subapps/types.ts#subAppManifestSchema`.
 * NOT `.strict()` — the host's is not either, and `widgets` is an optional
 * additive field this copy deliberately accepts without modelling (D-26's
 * additive rule: a manifest carrying one must still validate here). */
export const subAppManifestSchema = z.object({
  id: z.string().regex(SUBAPP_ID_RE),
  label: z.string().min(1),
  version: z.string(),
  minHostVersion: z.string(),
  /** sdk-60: the optional EXCLUSIVE upper bound of the host range, strict
   * MAJOR.MINOR.PATCH as in the host (a malformed bound refuses to boot). */
  maxHostVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  icon: z.string().min(1),
  navSection: z.enum(NAV_SECTIONS),
  routePrefix: z.string().regex(ROUTE_PREFIX_RE),
  webModuleId: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITY_SCOPES)),
  visibleToRoles: z.array(z.enum(WORKSPACE_ROLES)).min(1),
  settingsPanel: settingsPanelSchema.optional(),
  generatedBy: z.literal(GENERATED_BY).optional(),
  listing: subAppListingSchema.optional(),
  /** sdk-21: declared outbound operations (see subAppIntegrationSchema). */
  integrations: z.array(subAppIntegrationSchema).max(5).optional(),
  /** sdk-44: optional Builder palette steps (see subAppWorkflowStepSchema). */
  workflowSteps: z.array(subAppWorkflowStepSchema).max(10).superRefine(uniqueKeys("workflow step")).optional(),
  /** sdk-42: optional Builder starting processes (see subAppWorkflowTemplateSchema). */
  workflowTemplates: z.array(subAppWorkflowTemplateSchema).max(5).superRefine(uniqueKeys("workflow template")).optional(),
  /** sdk-63: the app's Postgres migrations (see subAppMigrationSchema). */
  migrations: z.array(subAppMigrationSchema).optional(),
  /** upd-app-schema-range: the app schema range this version needs (see subAppAppSchemaRangeSchema). */
  appSchema: subAppAppSchemaRangeSchema.optional(),
});

export type SubAppManifestData = z.infer<typeof subAppManifestSchema>;

/** Numeric-segment compare, ported from `registry.ts#isVersionNewer` — a
 * lexical string compare would call "5.9.0" newer than "5.10.0". */
export function isVersionNewer(version: string, baseline: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = baseline.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

export class ManifestRuleError extends Error {
  constructor(message: string, readonly issues: readonly string[]) {
    super(message);
  }
}

/** Everything the host checks at boot, in one call: the Zod shape, then
 * `assertHostVersionCompatible`'s host-version skew rule. Returns the
 * parsed data; throws `ManifestRuleError` naming every violation at once
 * (the host names only the first — a generator that reported one field per
 * run would be miserable to use). */
export function assertManifestWouldBoot(candidate: unknown, hostVersion: string = HOST_VERSION): SubAppManifestData {
  const parsed = subAppManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ManifestRuleError(`generated manifest would fail loadValidatedManifests: ${issues.join("; ")}`, issues);
  }
  if (isVersionNewer(parsed.data.minHostVersion, hostVersion)) {
    const issue = `minHostVersion: requires host >= ${parsed.data.minHostVersion}, but the host is ${hostVersion}`;
    throw new ManifestRuleError(`generated manifest would refuse to boot: ${issue}`, [issue]);
  }
  // sdk-60 `hostCompat.ts#checkHostCompat`: the bound is EXCLUSIVE and must
  // sit above minHostVersion; a host at or above it refuses to boot.
  const max = parsed.data.maxHostVersion;
  if (max !== undefined && (!isVersionNewer(max, parsed.data.minHostVersion) || !isVersionNewer(max, hostVersion))) {
    const issue = !isVersionNewer(max, parsed.data.minHostVersion)
      ? `maxHostVersion: ${max} must be above minHostVersion ${parsed.data.minHostVersion} (it is exclusive)`
      : `maxHostVersion: requires host < ${max}, but the host is ${hostVersion}`;
    throw new ManifestRuleError(`generated manifest would refuse to boot: ${issue}`, [issue]);
  }
  return parsed.data;
}
