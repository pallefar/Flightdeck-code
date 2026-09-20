/** The gate. One call, one verdict, before anything is written.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────
 * A generated sub-app that violates the manifest schema does not get
 * skipped at boot — `loadValidatedManifests` is fail-loud and never
 * filters, so it takes the whole Flightdeck server down, along with every
 * other sub-app on it. A generated route that forgets its enable guard
 * answers with the kill switch off. A generated table without the
 * `subapp_<id>_` prefix is invisible to the host and survives an
 * uninstall. None of those are visible in a diff at a glance, and all of
 * them are cheap to prove statically. So Studio proves them, and refuses
 * to ship an app that fails — which is the single claim this product makes
 * that a generic prompt-to-app builder cannot: bolt.diy writes whatever
 * the model produced into the container and finds out at runtime, because
 * its target is arbitrary web apps and there is nothing to check them
 * against. A sub-app has a contract, so it can be checked against it.
 *
 * ── THE SHAPE OF THE VERDICT ────────────────────────────────────────
 * `ok` is false when any ERROR finding exists. Warnings are things that
 * produce a wrong output rather than a broken host — a missing registry
 * edit, a shipped dictionary, an unreferenced file — and they ride along
 * in the report for the human, without blocking.
 *
 * `checks` names every check that RAN. A gate that quietly skipped half
 * its rules and reported "no findings" would be worse than no gate, so the
 * report distinguishes "nothing was wrong" from "that never ran", and a
 * check that throws becomes an error finding (FD-Z001) rather than an
 * exception that a caller might catch and treat as a pass. */
import { analyzeCandidate, type CandidateSubApp } from "./analyze";
import type { Check, CheckContext } from "./check";
import { HOST_VERSION } from "./derive";
import { CANDIDATE_SCOPE, NO_POSITION, RULE_IDS, finding, sortFindings, type Finding, type RuleId } from "./finding";
import { capabilityEscapeCheck } from "./checks/capability-escape";
import { cachedBooleanCheck } from "./checks/cached-boolean";
import { guardFirstCheck } from "./checks/guard-first";
import { importClosureCheck } from "./checks/import-closure";
import { manifestCheck } from "./checks/manifest";
import { mountCheck } from "./checks/mount";
import { tablePrefixCheck } from "./checks/table-prefix";

/** In the order a reviewer would ask the questions: is it a manifest at
 * all, what does it drag in, what can it reach, does it check before it
 * acts, does it cache what must stay live, does it stay in its own tables,
 * and would the thing actually mount. */
export const CHECKS: readonly Check[] = [
  manifestCheck,
  importClosureCheck,
  capabilityEscapeCheck,
  guardFirstCheck,
  cachedBooleanCheck,
  tablePrefixCheck,
  mountCheck,
];

export interface GateOptions {
  /** The host the candidate is judged against. Only `minHostVersion` uses
   * it; everything else in the contract is version-independent. */
  readonly hostVersion?: string;
  /** A subset of the checks, for a caller that wants one answer fast —
   * Studio re-runs the manifest check while a spec is being edited. The
   * report names what ran, so a partial run can never be mistaken for a
   * clean one. */
  readonly checks?: readonly Check[];
}

export interface GateReport {
  /** No ERROR findings. The only thing a caller needs to decide whether
   * to write the files. */
  readonly ok: boolean;
  /** The id the manifest claims, or null when there was no readable
   * manifest to claim one. */
  readonly id: string | null;
  readonly findings: readonly Finding[];
  readonly errors: readonly Finding[];
  readonly warnings: readonly Finding[];
  /** Names of the checks that ran. */
  readonly checks: readonly string[];
  /** Every rule this gate knows — so a caller can tell an empty findings
   * list from a rule that was never applied. */
  readonly rules: readonly RuleId[];
  readonly filesChecked: number;
}

export function runConformanceGate(candidate: CandidateSubApp, options: GateOptions = {}): GateReport {
  const hostVersion = options.hostVersion ?? HOST_VERSION;
  const analysis = analyzeCandidate(candidate);

  if (!analysis.ok) {
    return report(null, analysis.findings, [], candidate.files.length);
  }

  const ctx: CheckContext = { app: analysis.app, hostVersion };
  const findings: Finding[] = [];
  const ran: string[] = [];

  for (const check of options.checks ?? CHECKS) {
    try {
      findings.push(...check.run(ctx));
      ran.push(check.name);
    } catch (error) {
      findings.push(
        finding(
          "FD-Z001",
          CANDIDATE_SCOPE,
          NO_POSITION,
          `the "${check.name}" check could not complete (${(error as Error).message}) — a check that did not finish has not passed this app, so the gate refuses rather than reporting a clean run`,
        ),
      );
    }
  }

  return report(analysis.app.id, findings, ran, candidate.files.length);
}

function report(id: string | null, findings: readonly Finding[], ran: readonly string[], filesChecked: number): GateReport {
  const sorted = sortFindings(findings);
  const errors = sorted.filter((f) => f.severity === "error");
  return {
    ok: errors.length === 0,
    id,
    findings: sorted,
    errors,
    warnings: sorted.filter((f) => f.severity === "warning"),
    checks: ran,
    rules: RULE_IDS,
    filesChecked,
  };
}

export class ConformanceError extends Error {
  constructor(readonly report: GateReport) {
    super(
      `sub-app${report.id === null ? "" : ` "${report.id}"`} is not safe to add to the host repo:\n` +
        report.errors.map((f) => `  - [${f.rule}] ${f.file}:${f.line} ${f.message}`).join("\n"),
    );
    this.name = "ConformanceError";
  }
}

/** For the write path, where the only interesting outcome is the refusal.
 * Returns the report so a caller can still surface the warnings. */
export function assertShippable(candidate: CandidateSubApp, options: GateOptions = {}): GateReport {
  const result = runConformanceGate(candidate, options);
  if (!result.ok) throw new ConformanceError(result);
  return result;
}
