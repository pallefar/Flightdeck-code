import { z } from "zod";
import { graphSchema } from "../../packages/workflow/graph";
import { STUDIO_PAGE_NAV_SECTIONS } from "../../packages/spec/src/studio-create";

const text = z.string().min(1);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const strings = z.array(z.string());
export const workflowResultSchema = z.object({
  status: z.literal("workflow-proposed"), target: z.literal("workflow"),
  determination: z.object({ target: z.literal("workflow"), reason: text }),
  workflow: z.object({ name: text, slug, country: text, intakeFields: z.array(z.object({ name: text, type: z.enum(["string", "number", "date", "boolean", "enum"]), required: z.boolean(), source: z.string().optional() })), steps: z.array(text).min(1), statutorySteps: strings }),
  pages: z.array(z.object({ slug, title: text, purpose: text, sourceSkillIds: strings, stepIds: strings, icon: z.string().trim().min(1).max(8), navSection: z.enum(STUDIO_PAGE_NAV_SECTIONS), visibleToRoles: strings })),
  graph: graphSchema.optional(),
  projectId: slug, skillSources: z.array(z.object({ id: text, version: text, contentHash: text })), warnings: strings,
}).superRefine((result, ctx) => {
  const steps = new Set(result.workflow.steps);
  const skills = new Set(result.skillSources.map((source) => source.id));
  if (result.workflow.statutorySteps.some((step) => !steps.has(step)) || result.pages.some((page) => page.stepIds.some((step) => !steps.has(step)) || page.sourceSkillIds.some((id) => !skills.has(id)))) ctx.addIssue({ code: "custom", message: "Broken workflow or skill reference" });
});
export type WorkflowResult = z.infer<typeof workflowResultSchema>;
/** General local DAG authoring has no invented host process/page metadata. */
const localWorkflowResultSchema = z.object({
  status: z.literal('workflow-graph-proposed'), target: z.literal('workflow'),
  determination: z.object({ target: z.literal('workflow'), reason: z.string().min(1).max(800) }).strict(),
  graph: graphSchema,
  projectId: z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  skillSources: z.array(z.never()).max(0),
  skillSourceState: z.enum(['loaded', 'empty', 'unavailable', 'not-loaded']).optional(),
  warnings: z.array(z.string().min(1).max(1000)).max(8),
}).strict();
export type LocalWorkflowResult = z.infer<typeof localWorkflowResultSchema>;
export type EditableWorkflowResult = WorkflowResult | LocalWorkflowResult;
const needsInputSchema = z.object({ status: z.literal("needs_input"), understanding: z.string().optional(), questions: z.array(z.object({ id: text, question: text, because: z.string().optional(), field: text.optional(), severity: text.optional(), options: z.array(text).nullable().optional() })).min(1) });
const finding = z.object({ rule: text, severity: z.enum(["error", "warning"]), file: text, line: z.number().int().nonnegative(), column: z.number().int().nonnegative(), message: text, evidence: z.string().nullable() });
const proposedSchema = z.object({
  status: z.literal("proposed"), understanding: z.string(),
  generated: z.object({ plan: z.object({ id: text, label: text, version: text, summary: z.string().nullable().optional(), routePrefix: text, webModuleId: text, envVar: text, tablePrefix: text, manifestData: z.object({ icon: text, navSection: text, capabilities: strings, visibleToRoles: strings }).passthrough() }).passthrough(), files: z.array(z.object({ path: text, contents: z.string(), kind: text })), warnings: strings }).passthrough(),
  conformance: z.object({ ok: z.boolean(), findings: z.array(finding), rules: strings }).passthrough(),
  artifacts: z.record(z.unknown()),
});
const refusalSchema = z.union([
  z.object({ status: z.enum(["invalid_workflow", "invalid_determination", "invalid_draft", "generation-refused"]), issues: strings, attempts: z.number().optional() }),
  z.object({ status: z.literal("blocked"), rule: text, explanation: text, evidence: z.string() }),
  z.object({ status: z.enum(["model-request-refused", "artifacts-refused"]), decision: z.object({ decision: z.enum(["refuse", "approval-required"]), reason: text, contentHash: text }).passthrough(), review: z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), preview: z.string().max(2000), unchecked: strings }).strict().optional() }),
  z.object({ status: z.literal("grant-refused"), decision: z.object({ allowed: z.literal(false), reason: text, contentHash: text }).passthrough() }),
  z.object({ status: z.literal("translation-refused"), refusals: z.array(z.object({ at: text, needs: text })) }),
]);
const subappResultSchema = z.object({ status: z.literal("subapp-result"), target: z.literal("subapp"), determination: z.object({ target: z.literal("subapp"), reason: text }), outcome: z.union([proposedSchema, needsInputSchema, refusalSchema]) });
const resultSchema = z.union([localWorkflowResultSchema, workflowResultSchema, subappResultSchema, needsInputSchema, refusalSchema]).and(z.object({ skillSourceState: z.enum(["loaded", "empty", "unavailable", "not-loaded"]).optional() }));
export type StudioResult = z.infer<typeof resultSchema>;
export type ProposedSubapp = z.infer<typeof proposedSchema>;
export function parseStudioResult(value: unknown): StudioResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid Studio response — no draft accepted. Check that Studio server and frontend versions match.");
  return parsed.data;
}
