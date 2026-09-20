/**
 * The audit EVENT BODY — and the reason this file stops where it stops.
 *
 * boot.json guardrail 5: "All actions touching guardrails are proposed, never
 * auto-applied, and audited."
 *
 * The host's shape (`flightdeck/server/lib/flightdeckAudit.ts`):
 *
 *     export interface AuditInput {
 *       event: string;   // e.g. "config.checksums-seeded", "wc.consented"
 *       actor: string;   // named human or "flightdeck-server"
 *       [key: string]: JsonValue;
 *     }
 *
 * and `appendFlightdeckAudit` then adds `at`, `prevHash` and `hash` itself.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS FILE EMITS A BODY. IT NEVER HASHES ONE.
 * ─────────────────────────────────────────────────────────────────────────
 * `hash = sha256(prevHash + canonicalPyJson(body))`, GENESIS-rooted,
 * append-only, "there is no code path that rewrites this file". Its integrity
 * comes from being computed in ONE place against the real tail of the real
 * chain. Studio is a different checkout and does not know `prevHash`; a second
 * implementation guessing at it is how a chain forks, and a forked chain is
 * worse than no chain because it still verifies.
 *
 * So: build the body, hand it to the caller, let the capability adapter append
 * it. The `at`/`prevHash`/`hash` keys are absent from the type on purpose —
 * not optional, absent — so no caller can pass a Studio-computed one through.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AN AUDIT EVENT IS THE MOST WIDELY-READ ARTEFACT IN THE SYSTEM
 * ─────────────────────────────────────────────────────────────────────────
 * It is append-only, replicated, and read by people who were not in the room.
 * It is therefore the LAST place a caught value may appear. Every field below
 * is either a constant (`event`, `decision`), a number (`tier`, counts), a
 * name the caller supplied for itself (`actor`, `subject`), or a class name
 * drawn from a compiled-in list. `__tests__/no-value-leak.test.ts` asserts
 * this against the serialised body, not against the intent.
 */

import type { Classification, Finding, Tier } from "./findings";

export type GuardrailEventName =
  | "guardrails.registration-refused"
  | "guardrails.registration-approval-required"
  | "guardrails.registration-allowed"
  | "guardrails.model-request-refused"
  | "guardrails.model-request-redacted"
  | "guardrails.model-request-allowed"
  | "guardrails.workflow-intake-refused"
  | "guardrails.workflow-intake-allowed"
  | "guardrails.generated-artifacts-refused"
  | "guardrails.generated-artifacts-allowed";

export interface GuardrailAuditBody {
  readonly event: GuardrailEventName;
  /** Named human, or the service acting — the host's own two options. */
  readonly actor: string;
  /** What the decision was about: a mini-app id, a provider name, an intake
   * id. A caller-chosen identifier, never scanned content. */
  readonly subject: string;
  readonly decision: "allow" | "refuse" | "redact" | "approval-required";
  readonly tier: Tier;
  /** Class names only, sorted, deduplicated. The 422 contract of the AI
   * gateway in one field: "response names classes only". */
  readonly classes: readonly string[];
  /** Sanitised locations, so a human can find the fields without being shown
   * their contents. */
  readonly locations: readonly string[];
  readonly findingCount: number;
  /** Present only when an approval was involved. */
  readonly approver?: string;
  readonly contentHash?: string;
  readonly approvalProblem?: string;
}

export function classesOf(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map((f) => f.class))].sort();
}

export function locationsOf(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map((f) => f.where))].sort();
}

export interface AuditBodyInput {
  readonly event: GuardrailEventName;
  readonly actor: string;
  readonly subject: string;
  readonly decision: GuardrailAuditBody["decision"];
  readonly classification: Classification;
  readonly approver?: string;
  readonly contentHash?: string;
  readonly approvalProblem?: string;
}

/** Cap on how many locations one event lists. A refusal over 900 rows should
 * not append a 900-entry array to an append-only chain; the count is the fact,
 * the list is the convenience. */
export const MAX_LOCATIONS_IN_EVENT = 25;

export function auditBody(input: AuditBodyInput): GuardrailAuditBody {
  const { findings, tier } = input.classification;
  const locations = locationsOf(findings).slice(0, MAX_LOCATIONS_IN_EVENT);
  const body: GuardrailAuditBody = {
    event: input.event,
    actor: input.actor,
    subject: input.subject,
    decision: input.decision,
    tier,
    classes: classesOf(findings),
    locations,
    findingCount: findings.length,
    // `exactOptionalPropertyTypes` is on: spread conditionally rather than
    // assigning `undefined`, so an absent approver is an absent KEY in the
    // appended JSON rather than a null in the chain.
    ...(input.approver === undefined ? {} : { approver: input.approver }),
    ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
    ...(input.approvalProblem === undefined ? {} : { approvalProblem: input.approvalProblem }),
  };
  return body;
}
