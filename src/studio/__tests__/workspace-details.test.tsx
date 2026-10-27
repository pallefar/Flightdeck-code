import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WorkspaceRunDetail } from '../WorkflowWorkspace';
import type { WorkspaceRun } from '../workspace-client';
import { createWorkflowTemplate } from '../../workflow/WorkflowEditor';
import { createWorkflowRunner } from '../../../packages/workflow/engine';

it('shows measured timing and branch/error metadata, explaining durable diagnostic payloads are unavailable', async () => {
 const graph = createWorkflowTemplate('branch'); const result = await createWorkflowRunner(graph).run({ approved: true });
 const run = { id: 'fixture', state: 'completed', draftRevision: 1, result, graphSnapshot: graph, input: { approved: true }, graphDigest: 'fixture', startedAt: 'fixture', finishedAt: 'fixture' } as unknown as WorkspaceRun;
 const html = renderToStaticMarkup(<WorkspaceRunDetail run={run} />);
 expect(html).toContain('Measured duration'); expect(html).toContain('Selected branch'); expect(html).toContain('Diagnostic payloads unavailable'); expect(html).toContain('local opt-in');
 run.result = { status: 'blocked', output: null, trace: [{ nodeId: 'fixture', status: 'blocked', details: { durationMs: 0, errorCode: 'MAPPING_SOURCE_UNAVAILABLE' } }] };
 expect(renderToStaticMarkup(<WorkspaceRunDetail run={run} />)).toContain('Error category');
});
it('does not fabricate timing for legacy traces or payloads for skipped nodes', () => {
 const run = { id: 'fixture', state: 'completed', draftRevision: 1, result: { status: 'completed', output: {}, trace: [{ nodeId: 'old', status: 'completed' }, { nodeId: 'skip', status: 'skipped' }] }, graphSnapshot: createWorkflowTemplate('branch'), input: {}, graphDigest: 'fixture' } as unknown as WorkspaceRun;
 const html = renderToStaticMarkup(<WorkspaceRunDetail run={run} />);
 expect(html).toContain('Timing unavailable'); expect(html).toContain('Not attempted');
});
