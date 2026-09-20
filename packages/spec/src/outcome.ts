/**
 * What intake can return. Four outcomes, no exceptions thrown for expected paths, so the
 * caller can `switch` exhaustively and a UI can render each one.
 */

import type { MiniAppSpec } from "./schema";
import type { ClarifyingQuestion } from "./questions";
import type { BlockedRule, PlannerDraft } from "./draft";

/** Codes for things Studio decided by itself. Narrowing only - widening always asks. */
export const WARNING_CODES = [
  "id-normalized",
  "nav-section-normalized",
  "purpose-from-understanding",
  "capability-unused",
  "capability-denied",
  "route-dropped",
  "route-write-scope-stripped",
  "table-dropped",
  "table-name-truncated",
  "column-type-defaulted",
  "widget-dropped",
  "clarification-unknown-field",
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

export interface PlanWarning {
  readonly code: WarningCode;
  readonly message: string;
}

export interface PlannedOutcome {
  readonly status: "planned";
  readonly spec: MiniAppSpec;
  readonly understanding: string;
  readonly warnings: readonly PlanWarning[];
}

export interface NeedsInputOutcome {
  readonly status: "needs_input";
  readonly questions: readonly ClarifyingQuestion[];
  readonly understanding: string;
  readonly warnings: readonly PlanWarning[];
  /** The draft as the model left it, for prefilling a review screen. Never half-valid spec. */
  readonly draft: PlannerDraft;
}

export interface BlockedOutcome {
  readonly status: "blocked";
  readonly rule: BlockedRule;
  readonly explanation: string;
  readonly evidence: string;
  /** False when the quote is not in the user's words - we still refuse, but say so. */
  readonly evidenceGrounded: boolean;
  readonly contractRule: string;
  readonly understanding: string;
}

export interface InvalidDraftOutcome {
  readonly status: "invalid_draft";
  readonly issues: readonly string[];
  /** Last raw model reply, truncated, for logs. */
  readonly raw: string | null;
  readonly attempts: number;
}

export type PlanOutcome = PlannedOutcome | NeedsInputOutcome | BlockedOutcome | InvalidDraftOutcome;
