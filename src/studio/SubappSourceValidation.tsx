import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { WorkbenchStore } from '../workbench/store';
import { snapshotDisabledReason } from './subapp-snapshot';
import { SourceValidationController, type WorkingSourceValidator } from './subapp-source-validation-controller';

export function SubappSourceValidation({ store, projectId, token, active, validate, controller: supplied }: {
  store: WorkbenchStore; projectId: string; token: string; active: boolean;
  validate: WorkingSourceValidator; controller?: SourceValidationController;
}) {
  const controller = useMemo(() => supplied ?? new SourceValidationController(store, validate), [supplied, store, validate]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const workbench = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => controller.connect(), [controller]);
  useEffect(() => { controller.setScope(projectId, token, active); }, [controller, projectId, token, active]);
  const reason = snapshotDisabledReason(workbench);
  const visible = active && controller.matchesScope(projectId, token, active) && !reason;
  const checking = visible && state.status === 'checking';
  const report = visible ? state.report : null;
  return <section className="studio-source-validation" aria-label="Working source static check">
    <h3>Check working source</h3>
    <p>Explicit local static conformance only. No source is executed or sent to a model. This is not a typecheck, live-host verification, approval or deployment.</p>
    <button type="button" disabled={!active || !!reason} title={reason ?? undefined} onClick={() => {
      if (checking) controller.cancel(); else void controller.check();
    }}>{checking ? 'Cancel static check' : 'Check working source'}</button>
    {reason && <p>{reason}</p>}
    <p role="status">{checking ? 'Checking applied working source locally…' : report ?
      report.ok ? 'Static conformance checks passed — static only.' : 'Static conformance needs attention.' :
      visible && state.error ? state.error : 'Working source not checked.'}</p>
    {report && <div className="studio-source-validation-report">
      <p>{report.checks.length} static checks ran{report.staticChecksComplete ? '.' : ' — incomplete.'} {report.errorCount} errors · {report.warningCount} warnings.</p>
      <p>Working-file fingerprint: <code style={{overflowWrap: 'anywhere'}}>{report.sourceHash}</code></p>
      <p>Checks attempted: {report.checks.join(', ') || 'None'}.</p>
      <p>Generated baseline evidence is unchanged. This report is in-session only and is cleared on any edit or context change.</p>
      {report.findings.length > 0 && <ol>{report.findings.map((finding, index) => <li key={index}>
        <strong>{finding.rule}</strong> · {finding.severity} · {finding.title}<br/>
        <code style={{overflowWrap: 'anywhere'}}>{finding.file}:{finding.line}:{finding.column}</code>
      </li>)}</ol>}
      {report.findings.length < report.errorCount + report.warningCount && <p>Showing the first {report.findings.length} findings. Counts above include all findings.</p>}
    </div>}
  </section>;
}
