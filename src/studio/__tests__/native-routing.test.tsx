import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioController } from '../controller';
import { AcceptedHandoff } from '../AcceptedHandoff';
import { StudioApp } from '../StudioApp';
import { createDraft } from '../client';
import { parseStudioResult } from '../result';
import { createWorkflowTemplate } from '../../workflow';

const graph = createWorkflowTemplate('branch');
const local = {
  status: 'workflow-graph-proposed', target: 'workflow',
  determination: { target: 'workflow', reason: 'A local declarative graph.' },
  graph, projectId: 'local-authoring', skillSources: [],
  warnings: ['Local graph only. No host scaffold or project pages were created.'],
};

it('accepts an actual bounded local graph without fabricating host metadata or pages', () => {
  expect(parseStudioResult(local)).toEqual(local);
});

it('shows a local graph as received without adding a sub-app source round or host claim', async () => {
  const studio = new StudioController(async () => new Response(JSON.stringify(local)));
  await studio.submit({ connectionId: 'anthropic', prompt: 'Create a conditional graph.', projectId: 'local-authoring' }, 'fixture-operator');
  expect(studio.getState().phase).toBe('result');
  expect(studio.getState().transcript.at(-1)?.text).toContain(`Workflow draft received: ${graph.name}`);
  expect(studio.getState().transcript.at(-1)?.text).toContain('not deployed');
  expect(studio.workbench.getState().rounds).toHaveLength(0);
  const html = renderToStaticMarkup(<AcceptedHandoff receipt={{ requestId: 'local', result: parseStudioResult(local), target: 'editor' }} onDismiss={() => {}} />);
  expect(html).toContain(`${graph.nodes.length} blocks · ${graph.edges.length} connections`);
  expect(html).toContain('Review required · not deployed');
});

it('offers the general graph in the real Studio entry without a false decline or invented host handoff', async () => {
  const studio = new StudioController(async () => new Response(JSON.stringify(local)));
  await studio.submit({ connectionId: 'anthropic', prompt: 'Create a conditional graph.', projectId: 'local-authoring' }, 'fixture-operator');
  const html = renderToStaticMarkup(<StudioApp controller={studio} />);
  expect(html).toContain('DRAFT RECEIVED / WORKFLOW');
  expect(html).toContain('Open workflow builder');
  expect(html).not.toContain('Studio declined this draft');
  expect(html).not.toContain('Download reviewed handoff');
});

it('accepts server skill-source state but refuses invented local host metadata and graph corruption', () => {
  expect(parseStudioResult({ ...local, skillSourceState: 'empty' })).toMatchObject({ skillSourceState: 'empty' });
  for (const value of [
    { ...local, pages: [] }, { ...local, skillSources: [{ id: 'invented' }] },
    { ...local, graph: { ...graph, edges: [{ id: 'bad', source: 'absent', target: graph.nodes[0]!.id }] } },
  ]) expect(() => parseStudioResult(value)).toThrow('Invalid Studio response');
});

it('rejects a local workflow returned from another requested project', async () => {
  await expect(createDraft({ connectionId: 'anthropic', prompt: 'Build.', projectId: 'different-project' }, 'fixture-operator', new AbortController().signal, async () => new Response(JSON.stringify(local)))).rejects.toThrow('project');
});
