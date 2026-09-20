/**
 * `@envelope` — Studio's outbound AI request, BUILT rather than screened.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS PACKAGE IS FOR
 * ─────────────────────────────────────────────────────────────────────────
 * It is the structural answer to a question three red-team rounds proved
 * cannot be answered any other way: what may leave this process?
 *
 * `packages/guardrails` answers it by SCANNING a payload and refusing what it
 * recognises. That is a detector, it is useful, and it is unbounded — the last
 * round defeated it with five nested `JSON.stringify` calls, and a sixth
 * unwrapping pass would only move the number.
 *
 * This package answers it by CONSTRUCTION, the way the host already does
 * (`flightdeck/server/services/ai/envelope.ts`). A request is assembled from
 * compiled-in lists — a closed task set, closed vocabularies, an allowlist of
 * field NAMES, a per-key policy — and anything not expressible in that shape
 * is REFUSED. There is no free-form payload, so there is nothing to nest JSON
 * into.
 *
 *     const result = buildEnvelope(
 *       { task: "studio.spec.draft", facts: { field: { kind: "fieldName", value: "startDate" } } },
 *       { names: ["Jane Doe"] },
 *     );
 *     if (!result.ok) return report(result.failures);   // keys and codes only
 *     send(result.wire);                                 // iff disposition is "ready"
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE THAT GOVERNS EVERY EXPORT BELOW
 * ─────────────────────────────────────────────────────────────────────────
 * A CONTROL MAY REFUSE. IT MAY NEVER CERTIFY. Nothing here emits a clean
 * certificate. `Assurance` ships with every envelope AND every refusal and
 * names what was checked, what matched, and what nothing looked at —
 * `notChecked` is never empty. A caller looking for a green light will not
 * find one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FREE-TEXT PATH IS DIFFERENT, AND IS LABELLED AS DIFFERENT
 * ─────────────────────────────────────────────────────────────────────────
 * A pasted Cowork workflow is arbitrary text and it IS the product; it cannot
 * be allowlisted away. It travels as a BOUNDED TEXT FACT that has been through
 * `packages/pseudonym` first and arrives with that package's coverage report,
 * which is carried on the envelope. Such an envelope is never `ready`: it is
 * `requires-human-approval`, unconditionally. A bounded text fact is not as
 * safe as a `fieldName` fact and this package says so on the fact itself.
 */

export {
  AI_TASKS,
  FACT_KEY_ALLOWLIST,
  FACT_KEY_POLICY,
  FACT_KINDS,
  FIELD_NAME_ALLOWLIST,
  HOST_AI_TASKS,
  HOST_FACT_KEY_POLICY,
  HOST_FIELD_NAME_ALLOWLIST,
  HOST_VOCABULARIES,
  MAX_COUNT,
  MAX_REQUEST_BYTES,
  MAX_TEXT_CHARS,
  MAX_TEXT_FACTS,
  PROVIDER_MODELS,
  STUDIO_AI_TASKS,
  STUDIO_FACT_KEY_POLICY,
  STUDIO_FIELD_NAMES,
  STUDIO_VOCABULARIES,
  VOCABULARIES,
  factKeyPolicy,
  isKnownModel,
  isSelectableProvider,
  vocabulary,
} from "./allowlists";
export type { AiTaskId, FactKeyPolicy, FactKind } from "./allowlists";

export {
  APPROVAL_REASON_CODES,
  DEFAULT_PROVIDER,
  REFUSAL_REASON,
  buildEnvelope,
  describeEnvelope,
} from "./build";
export type { BuildOptions } from "./build";

export { ENVELOPE_CLASSES_NOT_CHECKED, isEnvelope, isRefusal } from "./types";
export type {
  Assurance,
  BuildResult,
  CoverageReportLike,
  Disposition,
  Envelope,
  EnvelopeFact,
  ExpressionFailure,
  PseudonymisedText,
  Refusal,
  RefusalCode,
  TextProvenance,
} from "./types";

/** The host's own residual scan, transcribed and divergence-tested. Exported
 * so a caller that wants to re-prove something downstream uses the SAME
 * function this package proved with, not a second opinion — and so the
 * divergence test can drive it directly.
 *
 * ⛔ It is the BRACES, not the belt. A pass means five named classes did not
 * match. It does not mean the payload is clean, and no export here will ever
 * say that it does. */
export {
  PiiRefusalError,
  SCANNED_CLASSES,
  assertNoResidualPii,
  residualPiiFindings,
} from "./host-scan";
export type { RedactOptions } from "./host-scan";

export { balancedObject, readHostFactKeyPolicy, readHostRecordOfStringArrays } from "./host-policy";
export type { HostKeyPolicy } from "./host-policy";
