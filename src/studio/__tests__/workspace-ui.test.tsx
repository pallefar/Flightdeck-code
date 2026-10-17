import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { createEmptyGraph } from '../../../packages/workflow/graph';
import { WorkflowWorkspace } from '../WorkflowWorkspace';
import { WorkspaceController } from '../workspace-controller';

it('renders embedded themed controls with missing credential explanation, not an empty-success list', () => {
  const html = renderToStaticMarkup(<WorkflowWorkspace projectId="project-one" token="" graph={createEmptyGraph()} onLoadGraph={() => {}} />);
  expect(html).toContain('Connect operator credential in AI builder');
  expect(html).toContain('Local project partition');
  expect(html).toContain('Saved drafts not checked');
  expect(html).toMatch(/aria-label="Save as new draft" disabled/);
  expect(html).not.toContain('No saved drafts');
  expect(html).not.toContain('<nav');
  expect(html).not.toContain('body{');
});
it('shows a configured graph as unsaved and does not run or claim persistence in SSR', () => {
  const controller = new WorkspaceController(); controller.setScope('project-one', 'explicit-fixture-token'); controller.setGraph(createEmptyGraph());
  const html = renderToStaticMarkup(<WorkflowWorkspace controller={controller} projectId="project-one" token="explicit-fixture-token" graph={createEmptyGraph()} onLoadGraph={() => {}} />);
  expect(html).toContain('Unsaved');
  expect(html).toMatch(/aria-label="Run saved revision" disabled/);
  expect(html).toContain('Configure reviewer and reason before first saving');
  expect(html).not.toContain('Executed successfully');
});
