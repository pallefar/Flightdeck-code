/**
 * Proposal templates, as the planner sees them — owner ruling 2026-09-22 (8).
 *
 * A proposing route writes into the host's review inbox on someone's behalf. What it writes
 * is not the model's to decide: it comes from a closed catalogue of templates the owner
 * approved, and the model's only choice is WHICH one. @spec holds none of the catalogue
 * itself — the fields, the approval records and the check that refuses an unapproved
 * template live in @codegen (`codegen/src/proposal-templates.ts`), where every path to a
 * generated app meets. What reaches this package is the MENU: an id to pick, a line saying what it is
 * for, and the names of the fields it writes, so the model can choose well without ever
 * being handed something it could edit.
 *
 * The menu is a parameter, not an import, for the same reason the model call is: @spec
 * stays free of every other package, and a planner run with no menu offers nothing — a
 * propose route then becomes a question, never a default.
 */

export interface ProposalTemplateChoice {
  /** What a draft route names in `template`. */
  readonly id: string;
  /** One line on what the template is for. */
  readonly summary: string;
  /** The body fields the template writes — shown, never editable by the model. */
  readonly fields: readonly string[];
}

/** A template id is a lowercase slug, like a route id. */
export const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Where the rule comes from, for the `because` on a question. */
export const TEMPLATE_RULE =
  "owner ruling 2026-09-22 (8) - a proposing app writes only the fields of a proposal template the owner approved; the model picks the template and never invents the fields";
