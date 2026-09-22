/**
 * ⭐ THE CLOSED CATALOGUE OF PROPOSAL TEMPLATES — owner ruling 2026-09-22 (8).
 *
 * A proposing mini-app writes into the host's review inbox on someone's behalf. Until this
 * file, `translate-spec.ts` refused every proposing route, because @codegen's `propose`
 * operation needs `proposalKind`, `ticketField`, `fields` and `auditEvent` and nothing in a
 * @spec document names a field. Teaching the planner to emit field shapes would have meant
 * the model deciding what an app writes about a person. The ruling closes the gap the other
 * way:
 *
 *   - proposing apps are generated ONLY from templates in this catalogue;
 *   - the model picks a template id and never invents the fields — @spec's draft route has
 *     `template` and no key a field could be written in;
 *   - every template carries an approval record, and generation refuses one without a valid
 *     record: no record, an approver who is not a named human, no real date, or content that
 *     changed after the approval was given;
 *   - read-only mini-apps are unaffected.
 *
 * ── WHY THE APPROVAL CARRIES A CONTENT HASH ──────────────────────────────────────────────
 * The ruling asks for `approvedBy`/`approvedAt`. A name and a date alone approve a LABEL:
 * editing a template's fields after the fact would keep the record and change what it
 * approved. So the record also carries the sha256 of the template it was given for —
 * everything except the record itself — and `checkTemplateApproval` recomputes it. Widening a
 * template is therefore a change that has to be re-approved, visibly, in review. The same
 * shape as `guardrails/src/approval-pure.ts`'s `Approval.contentHash`, and the same named-
 * human rule, imported rather than copied (HANDOVER §5.2).
 *
 * ── HOW THE CATALOGUE STAYS CLOSED ───────────────────────────────────────────────────────
 * It is a frozen literal in source. Adding or widening a template is a code change with an
 * approval record a reviewer can read; nothing at runtime can extend it. `translateSpec` and
 * `approvedTemplateMenu` take the catalogue as a parameter only so the refusals can be tested
 * against an unapproved entry (and `convertWorkflow`, so the approved `step` path can be); the
 * production paths (`buildSubAppFromPrompt`, and through it the server, and the conversion)
 * pass none, so they always read this one.
 *
 * ── THE SEED ─────────────────────────────────────────────────────────────────────────────
 * Two templates, derived from contract-run's existing `divergence` and `handoff` shapes
 * (`codegen/src/fixtures/specs.ts`, `contractRunSpec` — the orchestrate-workflow conversion's
 * steps 2 and 5). The owner approved seeding these by accepting the recommendation. The test
 * compares them to the fixture field for field, so "derived from" is checked, not claimed.
 *
 * ── THE CONVERSION'S `step` TEMPLATE: IN THE CATALOGUE, NOT APPROVED ─────────────────────
 * The Cowork-workflow conversion (`packages/subapp/src/studio/conversion.ts`) used to write
 * its own fixed `step` proposal (`ticket`, `step`, `note`) in code, outside this catalogue.
 * The ruling covers it all the same — "proposing apps are generated ONLY from" this
 * catalogue, and "generation refuses unapproved ones" — so that shape is now the `step`
 * entry below, with `approval: null`: visible, reviewable, never generated from. The
 * conversion resolves it like any other template and, while it is unapproved, emits no
 * proposing route (and so no `write:inbox-proposal`). Approving it is one approval record
 * on that entry; carving the conversion out of the ruling instead is the owner's call, not
 * this file's (HANDOVER §8).
 */
import type { FieldSpec, MiniAppSpec as CodegenSpec } from "../../codegen/src/spec-contract";
import { isNamedHuman } from "../../guardrails/src/approval-pure";
import { contentHashWith, sha256Hex } from "../../guardrails/src/pure";
import type { ProposalTemplateChoice } from "../../spec/src/templates";

export interface TemplateApproval {
  /** A NAMED human — the one rule in `guardrails/src/approval-pure.ts`. */
  readonly approvedBy: string;
  /** ISO 8601 date (or date-time) the approval was given. */
  readonly approvedAt: string;
  /** sha256 of the template minus this record: what was approved. */
  readonly contentHash: string;
}

export interface ProposalTemplate {
  /** What a @spec route names in `template`. */
  readonly id: string;
  /** What the planner is shown to choose by. */
  readonly summary: string;
  /** The proposal's `kind`, and part of its filename (`<app>-<kind>-<ticket>`). */
  readonly proposalKind: string;
  /** Which body field names the contract folder. */
  readonly ticketField: string;
  /** Every field a proposal from this template writes. The model never adds to it. */
  readonly fields: readonly FieldSpec[];
  /** Audited as `<app id>.<suffix>` — field names only, never values (contract rule 8). */
  readonly auditEventSuffix: string;
  /** Where the shape came from, so a reviewer can follow it back. */
  readonly derivedFrom: string;
  /** `null` is an unapproved template: kept visible, never generated from. */
  readonly approval: TemplateApproval | null;
}

export type TemplateApprovalProblem =
  | "unapproved"
  | "unnamed-approver"
  | "undated-approval"
  | "content-changed-since-approval";

export type TemplateResolution =
  | { readonly ok: true; readonly template: ProposalTemplate }
  | { readonly ok: false; readonly problem: TemplateApprovalProblem | "unknown-template" };

/** The hash an approval binds to: every field of the template except the approval. */
export function templateContentHash(template: ProposalTemplate): string {
  const { approval: _approval, ...content } = template;
  return contentHashWith(sha256Hex, content);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** A real calendar date in ISO form — `2026-13-40` matches the pattern and is still refused. */
function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `null` when the template may be generated from; otherwise why not. */
export function checkTemplateApproval(template: ProposalTemplate): TemplateApprovalProblem | null {
  const approval = template.approval;
  if (approval === null) return "unapproved";
  if (!isNamedHuman(approval.approvedBy)) return "unnamed-approver";
  if (!isIsoDate(approval.approvedAt)) return "undated-approval";
  if (approval.contentHash !== templateContentHash(template)) return "content-changed-since-approval";
  return null;
}

/** Deep-freezes a template literal, so the catalogue cannot be widened in place. */
function sealed(template: ProposalTemplate): ProposalTemplate {
  const fields = template.fields.map((field) =>
    // `FieldSpec.values` is typed mutable (it is a zod inference); frozen here regardless.
    Object.freeze(field.values === undefined ? { ...field } : { ...field, values: Object.freeze([...field.values]) as string[] }),
  );
  return Object.freeze({
    ...template,
    fields: Object.freeze(fields),
    approval: template.approval === null ? null : Object.freeze({ ...template.approval }),
  });
}

/** Owner ruling 2026-09-22 (8): "take your recommendations". */
const RULING_8 = { approvedBy: "Karsten Haldan", approvedAt: "2026-09-22" } as const;

export const PROPOSAL_TEMPLATES: readonly ProposalTemplate[] = Object.freeze([
  sealed({
    id: "divergence",
    summary: "Flag a divergence between a contract folder and canonical memory, for a person to review.",
    proposalKind: "divergence",
    ticketField: "ticket",
    fields: [
      { name: "ticket", type: "string" },
      { name: "note", type: "string", maxLength: 500, optional: true },
    ],
    auditEventSuffix: "divergence-proposed",
    derivedFrom: "codegen/src/fixtures/specs.ts contractRunSpec, POST /flag (orchestrate-workflow step 2)",
    approval: { ...RULING_8, contentHash: "ed69810edf9b15202109addc8575ca45210878e214f7341b6502b0e80268f8e4" },
  }),
  sealed({
    id: "handoff",
    summary: "Propose the hand-off ping for a workflow step, drafted for a person to send.",
    proposalKind: "handoff",
    ticketField: "ticket",
    fields: [
      { name: "ticket", type: "string" },
      { name: "step", type: "enum", values: ["works-council", "offer-letter", "approval", "finalize"] },
    ],
    auditEventSuffix: "handoff-proposed",
    derivedFrom: "codegen/src/fixtures/specs.ts contractRunSpec, POST /handoff (orchestrate-workflow step 5)",
    approval: { ...RULING_8, contentHash: "3cb75f1788cc1a6f9838626a2bdfb1058704fd8ce6159710af6ad1e13aa4a1e5" },
  }),
  // ⛔ UNAPPROVED. The shape the Cowork-workflow conversion wrote in code before ruling 8
  // brought it under this catalogue, transcribed exactly — so approving it changes nothing
  // but the fact of approval. Until an approval record is added here, no proposing route is
  // generated from it (see the header).
  sealed({
    id: "step",
    summary: "Propose that a person act on one step of a converted workflow, for a contract folder.",
    proposalKind: "step",
    ticketField: "ticket",
    fields: [
      { name: "ticket", type: "string", maxLength: 64 },
      { name: "step", type: "string", maxLength: 48 },
      { name: "note", type: "string", optional: true, maxLength: 500 },
    ],
    auditEventSuffix: "step-proposed",
    derivedFrom: "packages/subapp/src/studio/conversion.ts, the Cowork-workflow conversion's fixed step proposal (before ruling 8)",
    approval: null,
  }),
]);

type Operation = CodegenSpec["domains"][number]["routes"][number]["operation"];

/** The `@codegen` operation an approved template stands for, under THIS app's id —
 * `auditEvent` must be namespaced by the sub-app, and the template only carries the
 * suffix. The one place a template becomes an operation: `translate-spec.ts` (the model's
 * path) and the workflow conversion both build their proposing routes through it. */
export function proposeOperation(template: ProposalTemplate, appId: string): Operation {
  return {
    kind: "propose",
    proposalKind: template.proposalKind,
    ticketField: template.ticketField,
    fields: template.fields.map((field) => ({ ...field, ...(field.values === undefined ? {} : { values: [...field.values] }) })),
    auditEvent: `${appId}.${template.auditEventSuffix}`,
  };
}

/** A template the model named, if it is in the catalogue AND approved. */
export function resolveProposalTemplate(
  id: string,
  catalogue: readonly ProposalTemplate[] = PROPOSAL_TEMPLATES,
): TemplateResolution {
  const template = catalogue.find((candidate) => candidate.id === id);
  if (template === undefined) return { ok: false, problem: "unknown-template" };
  const problem = checkTemplateApproval(template);
  return problem === null ? { ok: true, template } : { ok: false, problem };
}

/** What the planner is offered: approved templates only, and their field NAMES only. */
export function approvedTemplateMenu(
  catalogue: readonly ProposalTemplate[] = PROPOSAL_TEMPLATES,
): ProposalTemplateChoice[] {
  return catalogue
    .filter((template) => checkTemplateApproval(template) === null)
    .map((template) => ({ id: template.id, summary: template.summary, fields: template.fields.map((f) => f.name) }));
}
