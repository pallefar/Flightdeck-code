/** What every check is handed, and what it gives back.
 *
 * A check is a pure function of the analysed candidate. It never reads the
 * filesystem, never asks the generator what it meant, and never throws:
 * the gate runs all of them and concatenates the findings, so one check
 * blowing up on a strange file cannot hide the other five. */
import type { AnalyzedSubApp } from "./analyze";
import type { Finding } from "./finding";

export interface CheckContext {
  readonly app: AnalyzedSubApp;
  /** The host the candidate is being judged against. Defaults to the
   * contract's 5.0.0; parameterised because the ceiling is the one rule
   * here that legitimately moves when the host ships. */
  readonly hostVersion: string;
}

export interface Check {
  readonly name: string;
  run(ctx: CheckContext): Finding[];
}
