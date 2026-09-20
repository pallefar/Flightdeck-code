/**
 * The planner model's wire format.
 *
 * This is deliberately *not* `MiniAppSpec`. The model is allowed to be unsure - every
 * semantic field is nullable and every list defaults to empty - but it is not allowed to be
 * sloppy: the object is `.strict()`, so an invented key fails the parse and triggers one
 * bounded repair round-trip instead of silently reaching codegen.
 *
 * Two asymmetries are encoded here on purpose:
 *
 *  - Structural mistakes (a method of "PUT", an unknown key) are the model's fault and are
 *    repaired by asking it again with the issue list.
 *  - Semantic gaps (which nav section, which roles, whether a scope is really wanted) are the
 *    *user's* to settle, so those fields stay permissive here and become questions in `gates`.
 *
 *  - Every capability the model proposes must carry `evidence`: a verbatim quote from the
 *    user. `gates` checks the quote is really there. A scope the user never asked for cannot
 *    survive that check, which is what makes "do not guess a capability" a property of the
 *    code rather than a line in a prompt.
 */

import { z } from "zod";

export const BLOCKED_RULES = [
  "propose-not-mutate",
  "capability-escape",
  "audit-hash",
  "sibling-import",
  "out-of-scope",
] as const;
export type BlockedRule = (typeof BLOCKED_RULES)[number];

export const draftBlockedSchema = z
  .object({
    rule: z.enum(BLOCKED_RULES),
    /** The user's words that asked for the forbidden thing. */
    evidence: z.string(),
    explanation: z.string(),
  })
  .strict();

export const draftClarificationSchema = z
  .object({
    field: z.string(),
    question: z.string(),
    options: z.array(z.string()).nullable().default(null),
  })
  .strict();

export const draftCapabilitySchema = z
  .object({
    capability: z.string(),
    /** Verbatim quote from the user that asks for this scope. Checked, not trusted. */
    evidence: z.string(),
  })
  .strict();

export const draftRouteSchema = z
  .object({
    id: z.string().nullable().default(null),
    method: z.enum(["GET", "POST"]),
    path: z.string(),
    summary: z.string(),
    kind: z.enum(["read", "propose"]),
    capabilities: z.array(z.string()).default([]),
  })
  .strict();

export const draftColumnSchema = z
  .object({
    name: z.string(),
    /** Free text; `gates` maps the usual aliases (string -> text) and asks about the rest. */
    type: z.string(),
    nullable: z.boolean().default(false),
    pii: z.boolean().default(false),
  })
  .strict();

export const draftTableSchema = z
  .object({
    name: z.string(),
    purpose: z.string(),
    columns: z.array(draftColumnSchema).default([]),
  })
  .strict();

export const draftWidgetSchema = z
  .object({ id: z.string().nullable().default(null), title: z.string(), kind: z.string() })
  .strict();

export const draftBodySchema = z
  .object({
    id: z.string().nullable().default(null),
    label: z.string().nullable().default(null),
    icon: z.string().nullable().default(null),
    navSection: z.string().nullable().default(null),
    purpose: z.string().nullable().default(null),
    visibleToRoles: z
      .object({ roles: z.array(z.string()).default([]), evidence: z.string().nullable().default(null) })
      .strict()
      .nullable()
      .default(null),
    capabilities: z.array(draftCapabilitySchema).default([]),
    routes: z.array(draftRouteSchema).default([]),
    tables: z.array(draftTableSchema).default([]),
    widgets: z.array(draftWidgetSchema).default([]),
    settingsPanel: z.object({ tier: z.enum(["ceiling", "project"]) }).strict().nullable().default(null),
  })
  .strict();

export const draftSchema = z
  .object({
    /** One sentence restating the goal, shown back to the user with any question. */
    understanding: z.string(),
    blocked: draftBlockedSchema.nullable().default(null),
    clarifications: z.array(draftClarificationSchema).default([]),
    spec: draftBodySchema,
  })
  .strict();

export type PlannerDraft = z.infer<typeof draftSchema>;
export type DraftBody = z.infer<typeof draftBodySchema>;
export type DraftRoute = z.infer<typeof draftRouteSchema>;
export type DraftTable = z.infer<typeof draftTableSchema>;
export type DraftCapability = z.infer<typeof draftCapabilitySchema>;
export type DraftBlocked = z.infer<typeof draftBlockedSchema>;
