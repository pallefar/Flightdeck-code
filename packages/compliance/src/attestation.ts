/**
 * ⭐ WHAT THE PROMOTE WORKFLOW MAY SIGN (upd-studio-attestation).
 *
 * `.github/workflows/promote.yml` runs `scripts/promote.sh` and then makes a
 * cosign KEYLESS attestation: subject `PROVENANCE.json`, predicate the
 * compliance record, predicate type {@link ATTESTATION_PREDICATE_TYPE}, signed
 * by the workflow's own OIDC identity. A recomputed verdict says whether the
 * checks passed; the attestation says WHO ran them — the OS admission
 * (upd-studio-admission) pins this workflow's identity.
 *
 * So the signer checks, itself and fail-closed, that what it is about to sign
 * says what the signature will be read as saying — promote.sh's exit code is
 * not trusted for it:
 *
 * - the record ADMITS (`admitComplianceRecord`: recomputed verdict, nothing
 *   failed or skipped, something passed, bound to THIS spec, fresh);
 * - the sidecar is a `studio-provenance/1` naming THAT record by its JCS
 *   digest, with a well-formed subject and host head;
 * - the sidecar's Studio commit is exactly the commit the workflow checked
 *   out (no `-dirty`): the certificate carries the workflow's commit, the
 *   sidecar the Studio commit, and they must be one.
 *
 * Pure: `provenance-cli.ts attest-check` reads the files and calls this.
 */
import { PROVENANCE_SCHEMA, ProvenanceError, checkSubject, type ProvenanceSubject } from "./provenance";
import { admitComplianceRecord, recordDigest } from "./record";

/** The in-toto predicate type of the Studio promote attestation. The OS admission pins it. */
export const ATTESTATION_PREDICATE_TYPE = "https://flightdeck/studio-compliance/v1";

const COMMIT_RE = /^[0-9a-f]{40}$/;

export interface AttestableInput {
  /** The parsed compliance record promote.sh wrote. */
  readonly record: unknown;
  /** The parsed PROVENANCE.json promote.sh sealed. */
  readonly provenance: unknown;
  /** sha256 of the spec file the workflow handed promote.sh. */
  readonly specSha256: string;
  /** The commit the workflow checked out (GITHUB_SHA). */
  readonly studioCommit: string;
  readonly now?: number;
}

export type Attestable = { readonly ok: true; readonly subappId: string } | { readonly ok: false; readonly refusals: readonly string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkAttestable(input: AttestableInput): Attestable {
  const refusals: string[] = [];

  const admitted = admitComplianceRecord(input.record, {
    specSha256: input.specSha256,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  if (!admitted.ok) refusals.push(`record-${admitted.code}`);

  const prov = input.provenance;
  if (!isObject(prov)) return { ok: false, refusals: [...refusals, "provenance-not-an-object"] };
  if (prov["schema"] !== PROVENANCE_SCHEMA) refusals.push("provenance-unknown-schema");

  if (isObject(input.record) && prov["recordSha256"] !== recordDigest(input.record)) {
    refusals.push("provenance-names-another-record");
  }
  if (!COMMIT_RE.test(input.studioCommit) || prov["studioCommit"] !== input.studioCommit) {
    refusals.push("studio-commit-not-the-workflow-commit");
  }
  if (typeof prov["hostHead"] !== "string" || !COMMIT_RE.test(prov["hostHead"])) refusals.push("provenance-host-head-invalid");

  let subappId: string | undefined;
  const subject = prov["subject"];
  if (!isObject(subject) || !Array.isArray(subject["hostFiles"])) {
    refusals.push("provenance-subject-missing");
  } else {
    try {
      subappId = checkSubject(subject as unknown as ProvenanceSubject).subappId;
    } catch (err) {
      if (!(err instanceof ProvenanceError)) throw err;
      refusals.push("provenance-subject-invalid");
    }
  }

  if (refusals.length > 0 || subappId === undefined) return { ok: false, refusals };
  return { ok: true, subappId };
}
