/**
 * `studio-workflow-definition/1` — the file Studio writes for the OS New-workflow wizard.
 *
 * Studio lands an OS workflow ONLY as this file, imported by an admin in the OS wizard
 * and submitted to the Workflow Builder (`POST /api/workflows`, admin RBAC), which
 * scaffolds the `teoa-process/1` manifest and a boot.json PROPOSAL. Never through
 * from-manifest, never server-to-server.
 *
 * So the schema is the Builder's body (`definitionBody` in the host's
 * `flightdeck/server/routes/workflows.ts`) and nothing more — `process-definition-drift.test.ts`
 * holds the two in step — made stricter in the ways that keep the model out of human
 * decisions:
 *
 * - `.strict()`: unknown keys are refused, so no prompts, ladder, gates or manifest can
 *   ride along into the OS.
 * - `statutorySteps` is REQUIRED. The host defaults it to `["statutory"]`; a Studio file
 *   must say what a human decided, never inherit a default.
 * - `statutoryConfirmedBy` (Studio-only): the named human who decided which steps are
 *   statutory. A non-empty `statutorySteps` without that name is refused. An EMPTY set is
 *   a statutory decision too ("nothing here is statutory": the Builder then scaffolds every
 *   step agent-run, with a prompt template), so a FILE needs the name whatever the set:
 *   `workflowDefinitionFileSchema` — what `serializeWorkflowDefinition` writes and
 *   `parseWorkflowDefinition` reads — refuses `statutoryConfirmedBy: null` outright. Only an
 *   in-memory draft (`workflowDefinitionSchema`) may still have nobody's name there.
 * - `by` may be `null` in a draft (no author named yet); the Builder requires it, so the
 *   OS import sets it before submitting.
 * - `steps` must be unique.
 */

import { z } from "zod";

import { isNamedHuman } from "../../guardrails/src/approval-pure";

export const WORKFLOW_DEFINITION_SCHEMA_ID = "studio-workflow-definition/1" as const;

/** `definitionBody.intakeFields[].type` in the host. */
export const WORKFLOW_INTAKE_FIELD_TYPES = ["string", "number", "date", "boolean", "enum"] as const;

/** `definitionBody.slug` in the host. */
export const WORKFLOW_SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

/** The universal manifest floor the Builder enforces on `steps`. */
export const WORKFLOW_FIRST_STEP = "intake_received" as const;
export const WORKFLOW_LAST_STEP = "complete" as const;

/**
 * A named human, by the ONE rule the repo keeps (guardrails' `isNamedHuman`): "studio",
 * "agent", "system", "x" or a blank are not names. Imported, never transcribed — see
 * packages/registry/src/__tests__/one-named-human-rule.test.ts.
 */
const namedHumanSchema = z
  .string()
  .min(1, "named human required") // the host's own bound on `by`; the drift test compares bounds
  .refine(isNamedHuman, "a named human, not a system/agent/placeholder");

/** Keys this file carries that the host's Builder body does not. The OS import drops them. */
export const STUDIO_ONLY_KEYS = ["schema", "statutoryConfirmedBy"] as const;

const intakeFieldSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(WORKFLOW_INTAKE_FIELD_TYPES),
    required: z.boolean(),
    source: z.string().max(80).optional(),
  })
  .strict();

export const workflowDefinitionSchema = z
  .object({
    schema: z.literal(WORKFLOW_DEFINITION_SCHEMA_ID),
    by: namedHumanSchema.nullable(),
    name: z.string().min(3).max(80),
    slug: z.string().regex(WORKFLOW_SLUG_PATTERN, "kebab-case slug"),
    country: z.string().min(2).max(40),
    entity: z.string().max(80).optional(),
    intakeFields: z.array(intakeFieldSchema).min(1),
    steps: z
      .array(z.string().min(2))
      .min(3)
      .refine((s) => s[0] === WORKFLOW_FIRST_STEP, { message: `first step must be '${WORKFLOW_FIRST_STEP}'` })
      .refine((s) => s.at(-1) === WORKFLOW_LAST_STEP, { message: `last step must be '${WORKFLOW_LAST_STEP}'` }),
    statutorySteps: z.array(z.string()),
    statutoryConfirmedBy: namedHumanSchema.nullable(),
  })
  .strict()
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    for (const s of d.steps) {
      if (seen.has(s)) ctx.addIssue({ code: "custom", path: ["steps"], message: `step '${s}' appears twice` });
      seen.add(s);
    }
    for (const s of d.statutorySteps) {
      if (!d.steps.includes(s)) {
        ctx.addIssue({ code: "custom", path: ["statutorySteps"], message: `statutory step '${s}' is not in steps` });
      }
    }
    if (d.statutorySteps.length > 0 && d.statutoryConfirmedBy === null) {
      ctx.addIssue({
        code: "custom",
        path: ["statutoryConfirmedBy"],
        message: "statutory steps need the named human who decided them (statutoryConfirmedBy); a model never decides a statutory step",
      });
    }
  });

/**
 * A definition fit to be a FILE: the draft rules plus a named human behind the statutory set,
 * empty or not. Nobody choosing is not the same as choosing "none".
 */
export const workflowDefinitionFileSchema = workflowDefinitionSchema.superRefine((d, ctx) => {
  if (d.statutoryConfirmedBy === null) {
    ctx.addIssue({
      code: "custom",
      path: ["statutoryConfirmedBy"],
      message:
        "a workflow definition file needs the named human who decided its statutory steps (statutoryConfirmedBy), even when the answer is none",
    });
  }
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowIntakeField = z.infer<typeof intakeFieldSchema>;

/**
 * The canonical file text: validated against `workflowDefinitionFileSchema`, keys in one
 * fixed order, 2-space JSON, trailing newline. Throws on an invalid definition or an
 * unconfirmed statutory set — Studio never writes a file the import refuses.
 */
export function serializeWorkflowDefinition(definition: WorkflowDefinition): string {
  const d = workflowDefinitionFileSchema.parse(definition);
  const canonical = {
    schema: d.schema,
    by: d.by,
    name: d.name,
    slug: d.slug,
    country: d.country,
    ...(d.entity === undefined ? {} : { entity: d.entity }),
    intakeFields: d.intakeFields.map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required,
      ...(f.source === undefined ? {} : { source: f.source }),
    })),
    steps: [...d.steps],
    statutorySteps: [...d.statutorySteps],
    statutoryConfirmedBy: d.statutoryConfirmedBy,
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export type WorkflowDefinitionParse =
  | { readonly ok: true; readonly definition: WorkflowDefinition }
  | { readonly ok: false; readonly error: string };

/** File text in, a definition that passes `workflowDefinitionFileSchema` or a named error out. */
export function parseWorkflowDefinition(text: string): WorkflowDefinitionParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `not JSON: ${(err as Error).message}` };
  }
  const parsed = workflowDefinitionFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, definition: parsed.data };
}
