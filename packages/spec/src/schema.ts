/**
 * `MiniAppSpec` - the contract between Studio's intake and Studio's codegen.
 *
 * A spec that parses here is meant to be compilable without further interpretation: every
 * value the Flightdeck manifest needs is present, exact, and already cross-checked against
 * the rest of the spec. Codegen may read it; codegen may not "fix" it.
 *
 * Two design rules this schema enforces structurally, not by convention:
 *
 *  1. Anything the host derives from `id` (route prefix, web module, nav path, env var,
 *     table prefix) lives in `derived` and must equal the derivation. A model cannot smuggle
 *     a different route prefix past this, and codegen never recomputes it.
 *  2. `capabilities` is exactly the union of what the routes use - not a superset. The array
 *     is the human consent screen (contract §5.9), so an unused scope is a bug, and a route
 *     that needs a scope the screen does not list is a boot-time failure waiting to happen.
 */

import { z } from "zod";
import {
  CAPABILITIES,
  HOST_VERSION,
  MAX_LOGICAL_TABLE_NAME_LENGTH,
  MAX_TABLE_NAME_LENGTH,
  NAV_SECTIONS,
  ROLES,
  SUBAPP_ID_PATTERN,
  derivationsFor,
  satisfiesHostCeiling,
  tablePrefixFor,
} from "./vocabulary";
import { isLikelyEmoji, looksLikeI18nKey } from "./text";
import { TEMPLATE_ID_PATTERN } from "./templates";

export const navSectionSchema = z.enum(NAV_SECTIONS);
export const capabilitySchema = z.enum(CAPABILITIES);
export const roleSchema = z.enum(ROLES);

const semverSchema = z
  .string()
  .regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/, "must be a three-part version such as 1.0.0");

export const subAppIdSchema = z
  .string()
  .min(3, "id must be at least 3 characters")
  .max(32, "id must be at most 32 characters - it prefixes every table name")
  .regex(SUBAPP_ID_PATTERN, "id must match /^[a-z0-9][a-z0-9-]*$/")
  .refine((id) => !id.endsWith("-"), "id must not end with a hyphen")
  .refine((id) => !id.includes("--"), "id must not contain a double hyphen");

export const labelSchema = z
  .string()
  .min(1, "label must not be empty")
  .max(48, "label is rendered verbatim in the nav; keep it under 48 characters")
  .refine((value) => value.trim() === value, "label must not have leading or trailing whitespace")
  .refine((value) => /\p{L}/u.test(value), "label must contain letters")
  .refine((value) => !looksLikeI18nKey(value), "label is literal English, not an i18n key");

export const iconSchema = z
  .string()
  .min(1, "icon must not be empty")
  .refine(isLikelyEmoji, "icon must be an emoji, for example 📄");

export const routePathSchema = z
  .string()
  .regex(
    /^\/(?:(?:[a-z0-9-]+|:[a-z][a-zA-Z0-9]*)(?:\/(?:[a-z0-9-]+|:[a-z][a-zA-Z0-9]*))*)?$/,
    "route path must be lowercase segments or :params below the route prefix, for example /contracts/:id",
  );

/**
 * `kind` is the whole write story. `read` may only read; `propose` writes a proposal into
 * `memory/proposals/`. There is deliberately no `mutate` - contract §5.7 forbids a mini app
 * from advancing or resolving a gated step, so the spec language cannot express it.
 */
export const routeSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "route id must be a lowercase slug")
      .max(48),
    method: z.enum(["GET", "POST"]),
    path: routePathSchema,
    summary: z.string().min(1).max(160),
    kind: z.enum(["read", "propose"]),
    capabilities: z.array(capabilitySchema),
    /**
     * The approved proposal template a `propose` route files (owner ruling 2026-09-22 (8)) -
     * an id, never the fields. Optional at this level because the Cowork-workflow path
     * builds its own fixed proposal shape and names none; the prompt path's gates require
     * one on every propose route, and `@pipeline`'s translator refuses a propose route that
     * lacks one or names an unapproved one. A read route may not carry one.
     */
    template: z.string().regex(TEMPLATE_ID_PATTERN, "template must be a lowercase slug").max(48).optional(),
  })
  .strict();

export const tableColumnSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, "column name must be lower_snake_case").max(48),
    type: z.enum(["text", "integer", "boolean", "timestamptz", "jsonb"]),
    nullable: z.boolean(),
    /** Marks a column whose *value* must never reach an audit event (contract §5.8). */
    pii: z.boolean(),
  })
  .strict();

export const tableSchema = z
  .object({
    /** Logical name; the physical name is `fullName` and carries the host's prefix. */
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "table name must be lower_snake_case")
      .max(MAX_LOGICAL_TABLE_NAME_LENGTH),
    fullName: z.string(),
    purpose: z.string().min(1).max(160),
    columns: z.array(tableColumnSchema).min(1, "a table needs at least one column"),
  })
  .strict();

/**
 * Widgets are presentational only. There is no role or capability field here by design:
 * contract §2 says widgets must not feed RBAC derivation, so the shape makes it impossible.
 */
export const widgetSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(48),
    title: z.string().min(1).max(64),
    kind: z.enum(["count", "list"]),
  })
  .strict();

/**
 * One numbered step of a Cowork workflow, carried into the mini app that walks a person
 * through it. Steps exist so a converted workflow keeps the shape of the document it came
 * from - the page renders them in order and never decides for the person.
 *
 * `kind` is the whole write story again, one level down from `routes`:
 *   `display` - the page shows the instruction. No host data is touched, so `capabilities` is empty.
 *   `read`    - the step reads host contract records, so it needs `read:contracts`.
 *   `propose` - the step files an inbox proposal, so it needs `write:inbox-proposal`.
 * There is no `advance` and no `resolve`: contract §5.7 forbids a mini app from advancing or
 * resolving a gated or statutory step, so the step language cannot express it either.
 */
export const specStepSchema = z
  .object({
    /** Stable slug, unique within the spec; the generated page keys its sections off it. */
    key: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "step key must be a lowercase slug")
      .max(48),
    /** The numbering the source document used ("1", "2b"), kept verbatim so the page matches it. */
    ordinal: z.string().regex(/^\d{1,3}[a-z]?$/, 'step ordinal must look like "1" or "2b"'),
    title: z
      .string()
      .min(1, "step title must not be empty")
      .max(120, "step title is rendered verbatim; keep it under 120 characters")
      .refine((value) => value.trim() === value, "step title must not have leading or trailing whitespace"),
    /** The rest of the step, in the document's own words. May be empty. */
    detail: z.string().max(600),
    kind: z.enum(["display", "read", "propose"]),
    /**
     * True when the source says a person decides this step. The page shows it and stops;
     * it is never a licence to advance the step, only a reason not to.
     */
    gated: z.boolean(),
    capabilities: z.array(capabilitySchema),
  })
  .strict();

/**
 * Enablement has two rows: the ceiling row ('*') that grants scopes and the per-project row
 * that can only turn a sub-app off (contract §4). A settings panel therefore belongs to
 * exactly one of those tiers.
 */
export const settingsPanelSchema = z.object({ tier: z.enum(["ceiling", "project"]) }).strict();

export const derivationsSchema = z
  .object({
    routePrefix: z.string(),
    webModuleId: z.string(),
    navPath: z.string(),
    enableEnvVar: z.string(),
    tablePrefix: z.string(),
  })
  .strict();

export const miniAppSpecSchema = z
  .object({
    specVersion: z.literal(1),
    id: subAppIdSchema,
    label: labelSchema,
    version: semverSchema,
    minHostVersion: semverSchema.refine(
      (value) => satisfiesHostCeiling(value, HOST_VERSION),
      `minHostVersion must be <= ${HOST_VERSION} or the server refuses to boot`,
    ),
    icon: iconSchema,
    navSection: navSectionSchema,
    /** One sentence, for the generated module header and the review screen. */
    purpose: z.string().min(1).max(280),
    /** The user's own words, kept for provenance in generated files and audits. */
    sourcePrompt: z.string().min(1),
    capabilities: z.array(capabilitySchema),
    visibleToRoles: z.array(roleSchema).min(1, "visibleToRoles is required and must be non-empty"),
    derived: derivationsSchema,
    routes: z.array(routeSchema).min(1, "a sub-app needs at least one route"),
    tables: z.array(tableSchema),
    widgets: z.array(widgetSchema),
    settingsPanel: settingsPanelSchema.nullable(),
    /**
     * Present only on a spec converted from a Cowork workflow; the prompt path leaves it
     * absent. A spec that has steps is a mini app - a walkthrough of a document - and is
     * database-free by construction (see the refinement below).
     */
    steps: z.array(specStepSchema).optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const expected = derivationsFor(spec.id);
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (spec.derived[key] !== expected[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["derived", key],
          message: `derived.${key} must be "${expected[key]}" - it is derived from id, not chosen`,
        });
      }
    }

    const duplicate = <T>(values: readonly T[]): T[] => {
      const seen = new Set<T>();
      const dupes = new Set<T>();
      for (const value of values) {
        if (seen.has(value)) {
          dupes.add(value);
        }
        seen.add(value);
      }
      return [...dupes];
    };

    for (const dupe of duplicate(spec.capabilities)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capabilities"],
        message: `capability "${dupe}" is listed twice`,
      });
    }
    for (const dupe of duplicate(spec.visibleToRoles)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibleToRoles"],
        message: `role "${dupe}" is listed twice`,
      });
    }
    for (const dupe of duplicate(spec.routes.map((route) => route.id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["routes"],
        message: `route id "${dupe}" is used twice`,
      });
    }
    for (const dupe of duplicate(spec.routes.map((route) => `${route.method} ${route.path}`))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["routes"],
        message: `two routes answer "${dupe}"`,
      });
    }
    for (const dupe of duplicate(spec.widgets.map((widget) => widget.id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["widgets"],
        message: `widget id "${dupe}" is used twice`,
      });
    }

    const declared = new Set<string>(spec.capabilities);
    const used = new Set<string>();

    spec.routes.forEach((route, index) => {
      for (const dupe of duplicate(route.capabilities)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["routes", index, "capabilities"],
          message: `capability "${dupe}" is listed twice on this route`,
        });
      }
      for (const capability of route.capabilities) {
        used.add(capability);
        if (!declared.has(capability)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["routes", index, "capabilities"],
            message: `route "${route.id}" uses "${capability}" but the manifest does not declare it - the consent screen would understate what the code does`,
          });
        }
      }
      if (route.kind === "propose" && !route.capabilities.includes("write:inbox-proposal")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["routes", index, "kind"],
          message: `route "${route.id}" proposes but does not hold "write:inbox-proposal"`,
        });
      }
      if (route.kind === "read" && route.capabilities.includes("write:inbox-proposal")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["routes", index, "capabilities"],
          message: `route "${route.id}" is read-only but holds "write:inbox-proposal"`,
        });
      }
      if (route.kind === "read" && route.template !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["routes", index, "template"],
          message: `route "${route.id}" is read-only but names a proposal template - only a propose route files one`,
        });
      }
    });

    for (const capability of declared) {
      if (!used.has(capability)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["capabilities"],
          message: `"${capability}" is declared but no route uses it - the manifest must declare the narrowest capabilities (contract §5.9)`,
        });
      }
    }

    const prefix = tablePrefixFor(spec.id);
    for (const dupe of duplicate(spec.tables.map((table) => table.name))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tables"],
        message: `table "${dupe}" is declared twice`,
      });
    }
    spec.tables.forEach((table, index) => {
      const expectedFullName = `${prefix}${table.name}`;
      if (table.fullName !== expectedFullName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", index, "fullName"],
          message: `table fullName must be "${expectedFullName}" - every table this sub-app creates carries the id-derived prefix`,
        });
      }
      if (table.fullName.length > MAX_TABLE_NAME_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", index, "fullName"],
          message: `"${table.fullName}" is ${table.fullName.length} characters; Postgres truncates identifiers over ${MAX_TABLE_NAME_LENGTH}`,
        });
      }
      for (const dupe of duplicate(table.columns.map((column) => column.name))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tables", index, "columns"],
          message: `column "${dupe}" is declared twice`,
        });
      }
    });

    // --- steps: a converted workflow ----------------------------------------------------
    const steps = spec.steps ?? [];
    if (steps.length > 0 && spec.tables.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tables"],
        message:
          "a step-driven mini app is database-free: it declares no tables, the way shell-reference declares none",
      });
    }
    for (const dupe of duplicate(steps.map((step) => step.key))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: `step key "${dupe}" is used twice`,
      });
    }
    steps.forEach((step, index) => {
      for (const dupe of duplicate(step.capabilities)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "capabilities"],
          message: `capability "${dupe}" is listed twice on this step`,
        });
      }
      for (const capability of step.capabilities) {
        if (!declared.has(capability)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["steps", index, "capabilities"],
            message: `step "${step.key}" uses "${capability}" but the manifest does not declare it - the consent screen would understate what the code does`,
          });
        }
      }
      if (step.kind === "display" && step.capabilities.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "capabilities"],
          message: `step "${step.key}" only displays its instruction, so it must hold no capability`,
        });
      }
      if (step.kind === "read" && !step.capabilities.includes("read:contracts")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "kind"],
          message: `step "${step.key}" reads host records but does not hold "read:contracts"`,
        });
      }
      if (step.kind === "propose" && !step.capabilities.includes("write:inbox-proposal")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "kind"],
          message: `step "${step.key}" proposes but does not hold "write:inbox-proposal"`,
        });
      }
    });
  });

export type MiniAppSpec = z.infer<typeof miniAppSpecSchema>;
export type SpecRoute = z.infer<typeof routeSchema>;
export type SpecTable = z.infer<typeof tableSchema>;
export type SpecTableColumn = z.infer<typeof tableColumnSchema>;
export type SpecWidget = z.infer<typeof widgetSchema>;
export type SpecStep = z.infer<typeof specStepSchema>;
export type SettingsPanel = z.infer<typeof settingsPanelSchema>;

/** Convenience wrapper so callers do not have to import zod to validate a spec. */
export function parseMiniAppSpec(value: unknown): z.SafeParseReturnType<unknown, MiniAppSpec> {
  return miniAppSpecSchema.safeParse(value);
}

/** Human-readable `path: message` lines from a failed parse, for logs and repair prompts. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

/**
 * Exactly the fields `subAppManifestSchema` validates at host boot. `initSchema` and
 * `registerRoutes` are function members and are codegen's job, not the spec's.
 */
export interface ManifestFields {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly minHostVersion: string;
  readonly icon: string;
  readonly navSection: string;
  readonly routePrefix: string;
  readonly webModuleId: string;
  readonly capabilities: readonly string[];
  readonly visibleToRoles: readonly string[];
  readonly settingsPanel: SettingsPanel | null;
  readonly widgets: readonly SpecWidget[];
}

export function toManifestFields(spec: MiniAppSpec): ManifestFields {
  return {
    id: spec.id,
    label: spec.label,
    version: spec.version,
    minHostVersion: spec.minHostVersion,
    icon: spec.icon,
    navSection: spec.navSection,
    routePrefix: spec.derived.routePrefix,
    webModuleId: spec.derived.webModuleId,
    capabilities: spec.capabilities,
    visibleToRoles: spec.visibleToRoles,
    settingsPanel: spec.settingsPanel,
    widgets: spec.widgets,
  };
}
