import { CHECKS, runConformanceGate } from '../../packages/conformance/src/gate';
import { RULES } from '../../packages/conformance/src/finding';
import { snapshotSchema } from '../../packages/subapp-workspace/schema';

export interface WorkingSourceReport {
  readonly scope: 'working-source-static-only';
  readonly ok: boolean;
  readonly staticChecksComplete: boolean;
  readonly executed: false;
  readonly typechecked: false;
  readonly checks: readonly string[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly findings: readonly {
    readonly rule: string; readonly severity: 'error' | 'warning'; readonly file: string;
    readonly line: number; readonly column: number; readonly title: string;
  }[];
}

/** Pure static text inspection: no candidate import/evaluation, compiler or host access.
 * The immutable generated checks are input history, never this check's authority. */
export function checkWorkingSource(value: unknown): WorkingSourceReport {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error('Working source exceeds snapshot bounds or has an invalid artifact inventory.');
  const report = runConformanceGate({ files: parsed.data.files });
  const staticChecksComplete = report.checks.length === CHECKS.length && CHECKS.every((check, index) => report.checks[index] === check.name);
  return {
    scope: 'working-source-static-only', ok: report.ok && staticChecksComplete, staticChecksComplete, executed: false, typechecked: false,
    checks: report.checks, errorCount: report.findings.filter(f => f.severity === 'error').length,
    warningCount: report.findings.filter(f => f.severity === 'warning').length,
    // Bound display data; do not echo source snippets, arbitrary parser exceptions or old evidence.
    findings: report.findings.slice(0, 100).map(f => ({ rule: f.rule, severity: f.severity,
      file: f.file, line: f.line, column: f.column, title: RULES[f.rule].title })),
  };
}
