/** Naming a proposal, and the artefact a reviewer opens.
 *
 * ⭐ ONE OPEN PROPOSAL PER SUB-APP ID, and the idempotency key is that id
 * rather than a hash of the bundle. Two consequences, both deliberate:
 *
 *   • Filing the same bundle twice files one proposal. That is the property
 *     asked for.
 *   • Filing a DIFFERENT bundle that carries the same id also files one — and
 *     answers with the proposal already on file rather than writing a second.
 *     That is not a near-miss of the first property, it is the stronger
 *     reading of it: two proposals for one sub-app id cannot both be applied,
 *     because the second collides with the first on the nav path, the route
 *     prefix and the registry entry. Answering "already on file" is the honest
 *     outcome, and the response names the id so the person can see why.
 *
 * ⛔ THE TWO VERDICTS ARE KEPT APART BY NAME. `gate` is what Studio reported
 * about a run this server did not witness. `admission` is what this host
 * concluded, here, from the bundle's own bytes. A proposal that flattened them
 * into one "checks passed" block would be inviting the reviewer to read a
 * claim as a finding, which is the whole failure this split exists to
 * prevent. */
import type { AdmissionReport } from "./admit.js";
import type { BundleFinding, BundleRegistry, BundleSpec, StudioBundle } from "./bundle.js";

/** The proposal's `kind`, and the first part of its filename. */
export const STUDIO_PROPOSAL_KIND = "studio-mini-app";

export function proposalPrefixFor(subAppId: string): string {
  return `${STUDIO_PROPOSAL_KIND}-${subAppId}-`;
}

export function proposalFileNameFor(subAppId: string, at: number): string {
  return `${proposalPrefixFor(subAppId)}${String(at)}.json`;
}

/** The EXACT filename shape this sub-app writes, not a bare prefix test.
 * `wc-clock-` is a prefix of `wc-clock-2-…`, and a prefix test would report
 * the wrong app as already proposed. */
export function findFiledProposal(fileNames: readonly string[], subAppId: string): string | null {
  const prefix = proposalPrefixFor(subAppId);
  return (
    fileNames.find((name) => name.startsWith(prefix) && /^\d+\.json$/.test(name.slice(prefix.length))) ?? null
  );
}

export interface ProposalFileSummary {
  readonly path: string;
  readonly kind: string;
  readonly bytes: number;
}

export function summarizeFiles(bundle: StudioBundle): ProposalFileSummary[] {
  return bundle.files.map((file) => ({ path: file.path, kind: file.kind, bytes: file.contents.length }));
}

export interface StudioProposalBody {
  readonly kind: typeof STUDIO_PROPOSAL_KIND;
  readonly subAppId: string;
  readonly label: string;
  readonly spec: BundleSpec;
  readonly files: readonly { readonly path: string; readonly kind: string; readonly contents: string }[];
  readonly registry: BundleRegistry;
  /** REPORTED by whatever produced the bundle. Provenance, not a verdict —
   * the field name says so, and so does `reportedBy`. */
  readonly gate: {
    readonly reportedBy: string;
    readonly reportedAt: string;
    readonly ok: boolean;
    readonly checks: readonly string[];
    readonly findings: readonly BundleFinding[];
  };
  /** CONCLUDED by this host, from the bundle's own bytes, by code that lives
   * in this repository. */
  readonly admission: {
    readonly ok: boolean;
    readonly checks: readonly string[];
    readonly findings: readonly { readonly rule: string; readonly severity: string; readonly file: string; readonly message: string }[];
  };
  readonly warnings: readonly string[];
  readonly workflowSource: string | null;
  readonly proposedBy: { readonly username: string; readonly displayName: string } | null;
  readonly proposedAt: string;
  /** Said inside the artefact, not only on the screen that produced it:
   * whoever opens this file in the Inbox is the person who has to know it
   * installs nothing by itself. */
  readonly appliedBy: string;
}

export function buildProposalBody(
  bundle: StudioBundle,
  admission: AdmissionReport,
  proposedBy: { username: string; displayName: string } | null,
  at: string,
): StudioProposalBody {
  return {
    kind: STUDIO_PROPOSAL_KIND,
    subAppId: bundle.subAppId,
    label: bundle.label,
    spec: bundle.spec,
    files: bundle.files,
    registry: bundle.registry,
    gate: {
      reportedBy: bundle.producedBy,
      reportedAt: bundle.producedAt,
      ok: bundle.gate.ok,
      checks: bundle.gate.checks,
      findings: bundle.gate.findings,
    },
    admission: {
      ok: admission.ok,
      checks: admission.checks,
      findings: admission.findings.map((finding) => ({
        rule: finding.rule,
        severity: finding.severity,
        file: finding.file,
        message: finding.message,
      })),
    },
    warnings: bundle.warnings,
    workflowSource: bundle.workflowSource,
    proposedBy,
    proposedAt: at,
    appliedBy:
      "a human. Filing this proposal installed nothing: these files are text until somebody writes them into the host repo and makes the registry.ts edit above. The `gate` block is what the tool that generated them reported; the `admission` block is what this host checked for itself.",
  };
}
