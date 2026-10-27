import { expect, it } from 'vitest';
import { checkWorkingSource } from '../subapp-source-validation';
import { captureSubappSnapshot } from '../subapp-snapshot';
import { generatedStore } from './subapp-workspace.fixture';

it('checks the current applied working files through the real static gate without changing the generated baseline', () => {
  const store = generatedStore();
  const baseline = store.getState().rounds.at(-1)!.candidate;
  const file = store.effectiveFiles().find(file => file.kind === 'web-module')!;
  expect(store.editFile(file.path, 'import fs from "node:fs";\n' + file.contents)).toBeNull();
  expect(store.saveFile(file.path)).toBe(true);
  const snapshot = captureSubappSnapshot(store.getState());
  const before = JSON.stringify(snapshot);
  const report = checkWorkingSource(snapshot);
  expect(report.ok).toBe(false);
  expect(report.checks).toHaveLength(7);
  expect(report.findings).toContainEqual(expect.objectContaining({ rule: 'FD-C001', file: file.path, severity: 'error' }));
  expect(report.scope).toBe('working-source-static-only');
  expect(report.executed).toBe(false);
  expect(report.typechecked).toBe(false);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(store.getState().rounds.at(-1)!.candidate).toBe(baseline);
  expect(baseline.rulesRun).toEqual(['FIXTURE']);
  expect(baseline.findings[0]!.message).toContain('Synthetic retained evidence');
});

it('distinguishes a complete static pass from uninspectable source, never treating unrun checks as passes', () => {
  const snapshot = captureSubappSnapshot(generatedStore().getState());
  const valid = checkWorkingSource(snapshot);
  expect(valid.ok).toBe(true);
  expect(valid.staticChecksComplete).toBe(true);
  const file = snapshot.files.find(file => file.kind === 'manifest')!;
  snapshot.baseline.files.find(original => original.path === file.path)!.path = file.path.replace('/manifest.ts', '/absent-manifest.ts');
  file.path = file.path.replace('/manifest.ts', '/absent-manifest.ts');
  const rejected = checkWorkingSource(snapshot);
  expect(rejected.ok).toBe(false);
  expect(rejected.staticChecksComplete).toBe(false);
  expect(rejected.checks).toHaveLength(0);
});


it('does not execute source statements or echo source snippets in findings', () => {
  const snapshot = captureSubappSnapshot(generatedStore().getState());
  const file = snapshot.files.find(file => file.kind === 'web-module')!;
  file.contents = 'import fs from "node:fs";\n' + file.contents + '\n(globalThis as any).__staticSourceProbe = "PRIVATE-SOURCE-PROBE"; throw new Error("PRIVATE-SOURCE-PROBE");';
  const report = checkWorkingSource(snapshot);
  expect((globalThis as {__staticSourceProbe?: unknown}).__staticSourceProbe).toBeUndefined();
  expect(report.ok).toBe(false); expect(JSON.stringify(report)).not.toContain('PRIVATE-SOURCE-PROBE');
  expect(report.findings.every(finding => !('evidence' in finding) && !('message' in finding))).toBe(true);
});

it('rejects descriptor hooks and excessive Unicode source before running static checks', () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, 'files', { enumerable: true, get() { reads++; throw new Error('PRIVATE-GETTER'); } });
  expect(() => checkWorkingSource(accessor)).toThrow('Working source exceeds snapshot bounds'); expect(reads).toBe(0);
  const snapshot = captureSubappSnapshot(generatedStore().getState());
  snapshot.files.find(file => file.kind === 'web-module')!.contents = '💡'.repeat(50_001);
  expect(() => checkWorkingSource(snapshot)).toThrow('Working source exceeds snapshot bounds');
});
