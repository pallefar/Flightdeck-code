import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../../../server/index';
import { createModelConnections } from '../../../server/model-connections';
import { createMemoryGrantStore } from '../../../packages/approvals/src/store';
import { createFileWorkflowWorkspaceStore } from '../../../server/workflow-workspace-store';
import { checkConnection } from '../connection';
import { createDraft, proposeBlock } from '../client';

it('uses actual authenticated HTTP descriptors, health, create and reviewed block DTOs with no implicit selection', async () => {
  const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'frontend-model-contract-'));
  const block = { id: 'reviewFields', label: 'Review fields', baseType: 'set', defaults: { fields: { reviewNeeded: true } }, description: 'Mark requests for review.' };
  const model = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(block) } }] })));
  const operator = { actor: 'Contract fixture operator', token: 'frontend-contract-fixture-token' };
  const app = createServer({ operator, modelConnections: createModelConnections({ env: { STUDIO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1', STUDIO_LOCAL_MODEL: 'fixture-model' }, localFetch: model }), projectSkillSource: async () => [], store: createMemoryGrantStore(), workflowWorkspaceStore: createFileWorkflowWorkspaceStore(join(dir, 'workspace.json')) });
  const transport: typeof fetch = async (url, init) => {
    const result = await app.inject({ method: init?.method === 'POST' ? 'POST' : 'GET', url: String(url), headers: Object.fromEntries(new Headers(init?.headers)), ...(init?.body ? { payload: String(init.body) } : {}) });
    return new Response(result.body, { status: result.statusCode, headers: { 'content-type': String(result.headers['content-type']) } });
  };
  try {
    expect((await transport('/api/studio/health')).status).toBe(200);
    await expect(checkConnection('project-a', 'wrong', transport)).rejects.toThrow('Invalid connection response');
    const status = await checkConnection('project-a', operator.token, transport);
    expect(status.selectedId).toBeNull();
    expect(status.connections).toHaveLength(4);
    expect(status.connections.find(d => d.id === 'local')).toMatchObject({ status: 'configured', verification: 'not-probed' });
    expect(model).not.toHaveBeenCalled();
    await expect(createDraft({ connectionId: 'flightdeck', prompt: 'Review incoming requests.' }, operator.token, new AbortController().signal, transport)).rejects.toThrow('Selected model connection unavailable');
    expect(model).not.toHaveBeenCalled();
    expect(await proposeBlock('Review incoming requests.', 'local', operator.token, new AbortController().signal, transport)).toEqual(block);
    expect(model).toHaveBeenCalledTimes(1);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
