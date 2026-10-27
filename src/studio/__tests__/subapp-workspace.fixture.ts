import { generateSubApp } from '../../../packages/codegen/src/generate';
import { minimalSpec } from '../../../packages/codegen/src/fixtures/specs';
import type { Candidate } from '../../workbench/types';
import { createStore } from '../../workbench/store';

/** Real emitted source, not a provider response or executed application. */
export function generatedCandidate(): Candidate {
  const { plan, files, warnings } = generateSubApp(minimalSpec);
  return {
    manifest: { id: plan.id, label: plan.label, version: plan.version, summary: plan.summary ?? null,
      icon: plan.manifestData.icon, navSection: plan.manifestData.navSection, routePrefix: plan.routePrefix,
      webModuleId: plan.webModuleId, capabilities: plan.manifestData.capabilities, visibleToRoles: plan.manifestData.visibleToRoles,
      envVar: plan.envVar, tablePrefix: plan.tablePrefix },
    files, findings: [{ rule: 'FIXTURE', severity: 'warning', file: '(candidate)', line: 0, column: 0, message: 'Synthetic retained evidence; not a new check.', evidence: null }],
    rulesRun: ['FIXTURE'], notes: warnings,
  };
}
export function generatedStore() {
  const store = createStore();
  store.settle(store.prompt('Development generated fixture')!, generatedCandidate());
  return store;
}
export const draftId = '779dfbdd-3505-4f3a-9f9b-b01d54ca0b35';
export const at = '2026-10-16T09:00:00.000Z';
