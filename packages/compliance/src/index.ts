/**
 * The host's compliance verdict, as a thing Studio can be handed.
 *
 * `scripts/promote.sh` runs Flightdeck's own gate with the candidate mounted
 * and writes a record. This package is how that record becomes a decision —
 * and, deliberately, it contains no way to PRODUCE one. Studio does not get
 * to certify itself.
 */
export {
  COMPLIANCE_SCHEMA,
  MAX_RECORD_AGE_MS,
  admitComplianceRecord,
} from "./record";
export type { AdmitOptions, AdmittedCompliance, ComplianceAdmission, ComplianceRefusal } from "./record";
