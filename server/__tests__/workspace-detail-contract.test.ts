import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createWorkflowTemplate } from '../../src/workflow/WorkflowEditor';
import { createWorkflowRunner } from '../../packages/workflow/engine';
import { runSchema, graphDigest, createFileWorkflowWorkspaceStore, safeWorkspaceValue } from '../workflow-workspace-store';
import { runSchema as browserRunSchema, safeWorkspaceValue as browserSafe } from '../../src/studio/workspace-client';

async function fixture() {
 const graph = createWorkflowTemplate('branch'); const result = await createWorkflowRunner(graph).run({ approved: true }); const now = new Date().toISOString();
 return { id: randomUUID(), draftId: randomUUID(), projectId: 'local-demo', draftRevision: 1, graphSnapshot: graph, graphDigest: graphDigest(graph), state: result.status, result, initiatedBy: 'Test Operator', input: { approved: true }, startedAt: now, finishedAt: now, resumable: false, pauseDisposition: 'not-paused', executionEpoch: randomUUID() };
}
for (const [label, schema] of [['server', runSchema], ['browser', browserRunSchema]] as const) {
 it(`${label} rejects contradictory trace metadata rather than accepting fabricated attempts`, async () => {
  const run = await fixture(); expect(schema.safeParse(run).success).toBe(true);
  const completed = run.result.trace.find(t => t.status === 'completed' && t.nodeId !== run.graphSnapshot.nodes.find(n => n.type === 'branch')!.id)!;
  completed.details!.selectedPort = 'true'; expect(schema.safeParse(run).success).toBe(false);
  delete completed.details!.selectedPort; completed.details!.errorCode = 'ADAPTER_ERROR'; expect(schema.safeParse(run).success).toBe(false);
  delete completed.details!.errorCode;
  const skipped = run.result.trace.find(t => t.status === 'skipped')!; skipped.details = { durationMs: 1 }; expect(schema.safeParse(run).success).toBe(false);
 });
 it(`${label} refuses snapshots, malformed duration/ports/error codes and prototype details`, async () => {
  const original = await fixture();
  for (const details of [{ durationMs: -1 }, { durationMs: Infinity }, { durationMs: 86_400_001 }, { durationMs: 0, selectedPort: 'default' }, { durationMs: 0, errorCode: 'raw exception' }, { durationMs: 0, input: { email: 'private' } }, { durationMs: 0, output: {} }, Object.create({ durationMs: 1 }), JSON.parse('{"durationMs":0,"__proto__":{}}')]) {
   const run = structuredClone(original); run.result.trace[0]!.details = details as never; expect(schema.safeParse(run).success).toBe(false);
  }
 });
}
it('workspace preflight never evaluates getters or accepts inherited/hidden/symbol fields', () => {
 for (const safe of [safeWorkspaceValue, browserSafe]) {
  let reads = 0; const getter = Object.defineProperty({}, 'field', { enumerable: true, get() { reads++; return 1; } });
  expect(safe(getter, 1000)).toBe(false); expect(reads).toBe(0);
  expect(safe(Object.create({ field: 1 }), 1000)).toBe(false);
  expect(safe(Object.defineProperty({}, 'hidden', { value: 1 }), 1000)).toBe(false);
  expect(safe({ [Symbol('field')]: 1 }, 1000)).toBe(false);
 }
});
it('loads version-one records without details unchanged in reconstructed store and browser DTO', async () => {
 const dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'workspace-legacy-')); const path = join(dir, 'workspace.json');
 try {
  const store = createFileWorkflowWorkspaceStore(path); const graph = createWorkflowTemplate('branch'); const draft = await store.create('local-demo', graph, 'Test Operator');
  const reserved = await store.reserveRun('local-demo', draft.id, 1, { approved: true }, 'Test Operator');
  const result = await createWorkflowRunner(graph).run({ approved: true }); result.trace.forEach(t => delete t.details);
  const run = await store.finishRun('local-demo', draft.id, reserved.id, result);
  const file = JSON.parse(await readFile(path, 'utf8')); expect(file.version).toBe(1); await writeFile(path, JSON.stringify(file));
  const restored = await createFileWorkflowWorkspaceStore(path).getRun('local-demo', draft.id, run.id);
  expect(restored).toEqual(run); expect(browserRunSchema.parse(restored)).toEqual(run);
 } finally { await rm(dir, { recursive: true, force: true }); }
});
