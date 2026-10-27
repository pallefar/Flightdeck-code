import { expect, it } from 'vitest';
import * as workflow from './index';

it('exposes the reviewed fragment transform through the public workflow package without adding a nested runtime', () => {
  const api = workflow as unknown as Record<string, unknown>;
  expect(api.composeWorkflowFragment).toBeTypeOf('function');
  expect(api.WORKFLOW_COMPOSITION_LIMITS).toMatchObject({ fragments: 1, maxNodes: 100, maxEdges: 100 });
  expect(workflow.builtinRegistry.some(block => ['subflow', 'shell', 'deploy'].includes(block.type))).toBe(false);
});
