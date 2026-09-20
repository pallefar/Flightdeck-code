/**
 * ⭐ THE HOST'S COMPLIANCE VERDICT, ADMITTED RATHER THAN READ.
 *
 * `scripts/promote.sh` runs the host's own gate — `scripts/gate.sh`, five
 * stacks including the PII boundary check and the Python engine eval — with
 * the candidate mounted, and writes a `studio-compliance-record/1` JSON file.
 * Studio does not get to define compliance for Flightdeck; Flightdeck already
 * did, and that script submits to it.
 *
 * Nothing read the file. It was produced, printed, and consumed by no one —
 * the same shape as `effectiveGrant` having no call site, and as ~2,100 tests
 * over packages nothing assembled.
 *
 * ── WHY THIS DOES NOT TRUST `readyForProduction` ────────────────────────
 *
 * The record carries a boolean the PRODUCER computed. Reading it is exactly
 * the mistake `envelope/src/tier-claim.ts` exists to fix: a field whose value
 * decides a gate, written by the party the gate is about. A record is a JSON
 * file on disk — editable by anyone who can edit a JSON file, including a
 * script that means well.
 *
 * So the verdict is RECOMPUTED from the evidence beside it (`failed` and
 * `skipped` must both be empty), and a record whose boolean disagrees with
 * its own lists is refused outright rather than believed in either
 * direction. A disagreement is not a cautious record; it is evidence the
 * file did not come from the gate.
 *
 * ⚠ A SKIP IS NEVER GREEN. `promote.sh` takes this position, quoting
 * `gate.sh`: "a green gate that quietly exercised one engine fewer than it
 * looks like it did is the thing this file was just changed to stop being
 * possible." A record that skipped a stack does not COVER that stack, so it
 * cannot certify it.
 */

/** The schema `promote.sh` writes. Pinned: a future shape is a migration. */
export const COMPLIANCE_SCHEMA = "studio-compliance-record/1";

/**
 * How long a record covers the thing it certifies.
 *
 * Not arbitrary: the gate ran against a particular host checkout and a
 * particular Studio tree. Neither stands still, and a certificate with no
 * expiry is a certificate for code nobody has run in months.
 */
export const MAX_RECORD_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type ComplianceRefusal =
  | "not-an-object"
  | "unknown-schema"
  | "missing-stack-lists"
  | "no-stack-passed"
  | "stacks-failed"
  | "stacks-skipped"
  | "verdict-contradicts-its-own-evidence"
  | "spec-hash-missing"
  | "spec-hash-mismatch"
  | "timestamp-missing"
  | "record-expired";

export interface AdmittedCompliance {
  readonly specSha256: string;
  readonly at: string;
  readonly passed: readonly string[];
}

export type ComplianceAdmission =
  | { readonly ok: true; readonly record: AdmittedCompliance }
  | { readonly ok: false; readonly code: ComplianceRefusal };

export interface AdmitOptions {
  /** The spec that produced the candidate being shipped. */
  readonly specSha256: string;
  /** Injected so a test is not a function of the wall clock. */
  readonly now?: number;
  readonly maxAgeMs?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((v) => typeof v === "string") ? (value as readonly string[]) : null;
}

export function admitComplianceRecord(value: unknown, options: AdmitOptions): ComplianceAdmission {
  if (!isObject(value)) return { ok: false, code: "not-an-object" };
  if (value["schema"] !== COMPLIANCE_SCHEMA) return { ok: false, code: "unknown-schema" };

  const passed = stringArray(value["passed"]);
  const failed = stringArray(value["failed"]);
  const skipped = stringArray(value["skipped"]);
  if (passed === null || failed === null || skipped === null) return { ok: false, code: "missing-stack-lists" };

  // ⭐ RECOMPUTED, then compared with what the record CLAIMS. Order matters:
  // the claim is checked against the evidence, never used in place of it.
  const ready = failed.length === 0 && skipped.length === 0;
  if (value["readyForProduction"] !== ready) {
    return { ok: false, code: "verdict-contradicts-its-own-evidence" };
  }
  if (failed.length > 0) return { ok: false, code: "stacks-failed" };
  // A skip is not a pass. `promote.sh`'s own words.
  if (skipped.length > 0) return { ok: false, code: "stacks-skipped" };
  // ⚠ AND AN EMPTY RUN IS NOT A CLEAN RUN. Nothing failed and nothing was
  // skipped is also true of a gate that executed no stacks at all — the
  // "7 of 7 clean" arithmetic this repo has already been caught by once.
  if (passed.length === 0) return { ok: false, code: "no-stack-passed" };

  const specSha256 = value["specSha256"];
  if (typeof specSha256 !== "string" || specSha256.length === 0) return { ok: false, code: "spec-hash-missing" };
  // ⭐ BOUND TO THE SPEC IT CERTIFIED. A record is not a licence to ship
  // anything; it is a statement about one input.
  if (specSha256 !== options.specSha256) return { ok: false, code: "spec-hash-mismatch" };

  const at = value["at"];
  if (typeof at !== "string") return { ok: false, code: "timestamp-missing" };
  const when = Date.parse(at);
  if (Number.isNaN(when)) return { ok: false, code: "timestamp-missing" };
  const now = options.now ?? Date.now();
  const maxAge = options.maxAgeMs ?? MAX_RECORD_AGE_MS;
  // A record from the future is as wrong as an expired one, and a clock
  // nobody set is the likeliest way to get one.
  if (when > now + 60_000 || now - when > maxAge) return { ok: false, code: "record-expired" };

  return { ok: true, record: { specSha256, at, passed } };
}
