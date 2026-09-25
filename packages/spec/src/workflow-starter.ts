/**
 * A described workflow → a `studio-workflow-definition/1` draft, WITHOUT a model.
 *
 * The workflow twin of `@codegen/starters`. Ruling 8 keeps generation on the approved
 * catalogue; for a workflow the catalogue is the OS Workflow Builder's own shape (the
 * universal step floor, the five intake-field types), so a draft is assembled from a closed
 * list of named pieces the request's words pick — never from the request text itself, which
 * can carry a person's name and ends up in a file an admin imports. Only an explicit
 * `called "X"` name is copied.
 *
 * Every human decision stays open in the draft (`by: null`, `statutoryConfirmedBy: null`,
 * no statutory step): `finishWorkflowDraft` takes them from the person, and the file schema
 * refuses a file without them. A model never decides a statutory step, and neither does this.
 *
 * Pure (zod + guardrails' pure name rule), so the browser workbench runs it.
 */

import {
  WORKFLOW_DEFINITION_SCHEMA_ID,
  WORKFLOW_SLUG_PATTERN,
  serializeWorkflowDefinition,
  workflowDefinitionFileSchema,
  type WorkflowDefinition,
  type WorkflowIntakeField,
} from "./process-definition";

/** The Builder's default ladder without the statutory step (a person adds it). */
const BASE_STEPS = ["intake_received", "validate", "generate", "quality_gate", "human_review", "approve", "issue", "complete"];

interface Shape {
  readonly name: string;
  readonly keywords: readonly string[];
}

/** Named shapes a request can land on; ties go to catalogue order. */
const SHAPES: readonly Shape[] = [
  { name: "Reference Letter", keywords: ["reference", "letter", "zeugnis", "certificate"] },
  { name: "Equipment Request", keywords: ["equipment", "laptop", "hardware", "device", "phone"] },
  { name: "Leave Request", keywords: ["leave", "vacation", "holiday", "absence", "urlaub"] },
  { name: "Purchase Approval", keywords: ["purchase", "invoice", "order", "spend", "buy"] },
];

const DEFAULT_NAME = "New Request";

/** Intake fields a request's words switch on. `request_id` is always first. */
const FIELD_RULES: ReadonlyArray<{ readonly field: WorkflowIntakeField; readonly keywords: readonly string[] }> = [
  { field: { name: "due_date", type: "date", required: true }, keywords: ["date", "deadline", "due", "by when", "until"] },
  { field: { name: "amount", type: "number", required: false }, keywords: ["amount", "cost", "budget", "price", "sum"] },
  { field: { name: "quantity", type: "number", required: false }, keywords: ["quantity", "how many", "count", "number of"] },
  { field: { name: "category", type: "enum", required: false }, keywords: ["category", "type of", "kind of", "categor"] },
  { field: { name: "urgent", type: "boolean", required: false }, keywords: ["urgent", "priority", "asap"] },
];

function explicitName(text: string): string | null {
  const m = /\b(?:called|named)\s*["“']([^"”']{3,60})["”']/i.exec(text);
  const name = m?.[1]?.trim();
  return name !== undefined && name.length >= 3 ? name.slice(0, 80) : null;
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return WORKFLOW_SLUG_PATTERN.test(slug) ? slug : "new-request";
}

export function workflowDraftFromRequest(request: string): WorkflowDefinition {
  const text = request.toLowerCase();
  let name = DEFAULT_NAME;
  let best = 0;
  for (const shape of SHAPES) {
    const score = shape.keywords.filter((k) => text.includes(k)).length;
    if (score > best) {
      best = score;
      name = shape.name;
    }
  }
  name = explicitName(request) ?? name;
  const intakeFields: WorkflowIntakeField[] = [{ name: "request_id", type: "string", required: true }];
  for (const rule of FIELD_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) intakeFields.push({ ...rule.field });
  }
  return {
    schema: WORKFLOW_DEFINITION_SCHEMA_ID,
    by: null,
    name,
    slug: slugify(name),
    country: "DE",
    intakeFields,
    steps: [...BASE_STEPS],
    statutorySteps: [],
    statutoryConfirmedBy: null,
  };
}

/** What only a person can supply. */
export interface WorkflowDecisions {
  /** The author the OS Builder records (`createdBy`). */
  readonly by: string;
  /** The named human who decided which steps are statutory — even when none are. */
  readonly statutoryConfirmedBy: string;
  /** Whether this workflow has a statutory (locked human-only) step. */
  readonly statutory: boolean;
  /** Optional overrides of what the draft guessed. */
  readonly name?: string;
  readonly country?: string;
}

export type FinishedWorkflow =
  | { readonly ok: true; readonly text: string; readonly definition: WorkflowDefinition }
  | { readonly ok: false; readonly error: string };

/** The draft plus the person's decisions → the canonical file text, or the schema's named
 * refusal. Never throws: the workbench shows the error where the button is. */
export function finishWorkflowDraft(draft: WorkflowDefinition, decisions: WorkflowDecisions): FinishedWorkflow {
  const steps = draft.steps.filter((s) => s !== "statutory");
  if (decisions.statutory) steps.splice(steps.indexOf("approve") >= 0 ? steps.indexOf("approve") : steps.length - 1, 0, "statutory");
  const name = decisions.name?.trim() || draft.name;
  const candidate = {
    ...draft,
    by: decisions.by.trim(),
    name,
    slug: decisions.name?.trim() ? slugify(name) : draft.slug,
    country: decisions.country?.trim() || draft.country,
    steps,
    statutorySteps: decisions.statutory ? ["statutory"] : [],
    statutoryConfirmedBy: decisions.statutoryConfirmedBy.trim() === "" ? null : decisions.statutoryConfirmedBy.trim(),
  };
  const parsed = workflowDefinitionFileSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  }
  return { ok: true, text: serializeWorkflowDefinition(parsed.data), definition: parsed.data };
}
