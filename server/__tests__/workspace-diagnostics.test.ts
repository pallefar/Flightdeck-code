import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createServer } from '../index';
import { createFileWorkflowWorkspaceStore, graphDigest } from '../workflow-workspace-store';
import { createMemoryGrantStore } from '../../packages/approvals/src/store';
import { graphSchema } from '../../packages/workflow/graph';
import { WorkspaceClient } from '../../src/studio/workspace-client';

const mappedGraph = graphSchema.parse({ version: 1, id: 'mapped', name: 'Mapped durable graph', customBlocks: [],
  nodes: [
    { id: 'start', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'set', type: 'set', label: 'Set', position: { x: 100, y: 0 }, config: { fields: { nested: { items: [7] } } }, inputMappings: [{ target: 'seed', source: { kind: 'input', path: ['nested', 'items', 0] } }] },
    { id: 'out', type: 'output', label: 'Output', position: { x: 200, y: 0 }, config: {}, inputMappings: [{ target: 'original', source: { kind: 'input', path: ['nested', 'items', 0] } }, { target: 'derived', source: { kind: 'node', nodeId: 'set', path: ['nested', 'items', 0] } }, { target: 'literal', source: { kind: 'literal', value: 'saved' } }] },
  ], edges: [{ id: 'e1', source: 'start', target: 'set' }, { id: 'e2', source: 'set', target: 'out' }] });

it('transfers measured metadata and exact mapped snapshots through file-backed composition, browser DTOs and reconstructed server', async () => {
  const dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'workspace-details-')); const path = join(dir, 'workspace.json');
  const options = { operator: { actor: 'Test Operator', token: 'local-fixture-only' }, store: createMemoryGrantStore() };
  let app = createServer({ ...options, workflowWorkspaceStore: createFileWorkflowWorkspaceStore(path) });
  const transport: typeof fetch = async (url, init) => { const r = await app.inject({ method: (init?.method ?? 'GET') as 'GET' | 'POST', url: String(url), headers: init?.headers as Record<string, string>, ...(init?.body ? { payload: String(init.body) } : {}) }); return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } }); };
  const client = new WorkspaceClient('local-demo', options.operator.token, transport);
  try {
    const draft = await client.create(mappedGraph); expect((await client.get(draft.id)).graph).toEqual(mappedGraph);
    const run = await client.run(draft.id, draft.revision, { nested: { items: [3] } });
    expect(run.result?.output).toEqual({ original: 3, derived: 7, literal: 'saved' }); expect(run.graphDigest).toBe(graphDigest(mappedGraph));
    for (const t of run.result!.trace) { expect(t.details?.durationMs).toBeGreaterThanOrEqual(0); expect(t.details).not.toHaveProperty('input'); expect(t.details).not.toHaveProperty('output'); }
    expect(await client.getRun(draft.id, run.id)).toEqual(run);
    await app.close(); app = createServer({ ...options, workflowWorkspaceStore: createFileWorkflowWorkspaceStore(path) });
    expect(await client.getRun(draft.id, run.id)).toEqual(run); expect((await client.get(draft.id)).graph).toEqual(mappedGraph);
    const file = JSON.parse(await readFile(path, 'utf8')); expect(file.version).toBe(1); expect(file.runs[0]).toEqual(run);
    const missingDraft = await client.create(mappedGraph);
    const missing = await client.run(missingDraft.id, 1, { nested: { items: [] } });
    expect(missing.state).toBe('blocked'); expect(missing.result?.trace.at(-1)?.details?.errorCode).toBe('MAPPING_SOURCE_UNAVAILABLE');
    expect(await client.getRun(missingDraft.id, missing.id)).toEqual(missing);
    const branchGraph = graphSchema.parse({ ...mappedGraph, nodes: [mappedGraph.nodes[0],
      { id: 'condition', type: 'branch', label: 'Condition', position: { x: 100, y: 0 }, config: { field: 'approved', operator: 'equals', value: true } },
      { id: 'yes', type: 'set', label: 'Yes', position: { x: 200, y: 0 }, config: { fields: { value: 1 } } },
      { id: 'no', type: 'set', label: 'No', position: { x: 200, y: 100 }, config: { fields: { value: 2 } } },
      { ...mappedGraph.nodes[2], inputMappings: [{ target: 'value', source: { kind: 'node', nodeId: 'no', path: ['value'] } }] }],
      edges: [{ id: 'b1', source: 'start', target: 'condition' }, { id: 'b2', source: 'condition', target: 'yes', sourcePort: 'true' }, { id: 'b3', source: 'condition', target: 'no', sourcePort: 'false' }, { id: 'b4', source: 'yes', target: 'out' }, { id: 'b5', source: 'no', target: 'out' }] });
    const branchDraft = await client.create(branchGraph); const branchRun = await client.run(branchDraft.id, 1, { approved: true });
    expect(branchRun.state).toBe('blocked'); expect(branchRun.result?.output).toBeNull();
    expect(branchRun.result?.trace.find(t => t.nodeId === 'condition')?.details?.selectedPort).toBe('true');
    expect(branchRun.result?.trace.find(t => t.nodeId === 'no')).toEqual({ nodeId: 'no', status: 'skipped' });
    expect(branchRun.result?.trace.at(-1)?.details?.errorCode).toBe('MAPPING_SOURCE_UNAVAILABLE');
    expect(await client.getRun(branchDraft.id, branchRun.id)).toEqual(branchRun);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
