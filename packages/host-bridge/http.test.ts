import { expect, it } from 'vitest';
import { createEmptyGraph } from '../workflow/graph';
import { startDraftFixture } from './fixture';

it('exercises real separate loopback HTTP servers and real durable draft create/read/update/reconstruction', async () => {
  const f = await startDraftFixture({ enabled: true, enableDraftPolicy: true });
  try {
    expect(new URL(f.hostOrigin).port).not.toBe(new URL(f.studioOrigin).port);
    const path = '/bridge/workspaces/alpha/projects/general/drafts';
    const created = await f.browser(path, { method: 'POST', body: { graph: createEmptyGraph('Created over HTTP') } });
    expect(created.status).toBe(201); if (!created.json.draft) throw new Error('draft missing'); expect(created.json.draft.createdBy).toBe('alice');
    const exact = `${path}/${created.json.draft.id}`;
    expect((await f.browser(exact)).json.draft).toEqual(created.json.draft);
    const updated = await f.browser(exact, { method: 'PUT', body: { graph: createEmptyGraph('Updated over HTTP'), expectedRevision: 1 } });
    expect(updated.status).toBe(200); if (!updated.json.draft) throw new Error('draft missing'); expect(updated.json.draft.revision).toBe(2);
    await f.reconstruct();
    expect((await f.browser(exact)).json.draft).toEqual(updated.json.draft);
    expect(f.privateHeaders.every(headers => !headers.some(h => ['cookie', 'authorization', 'x-actor-id', 'x-workspace-id', 'x-project-id'].includes(h)))).toBe(true);
    expect(f.service().counters).toMatchObject({ modelSends: 0, credentials: 0, executions: 0, approvals: 0, activations: 0, installs: 0, publications: 0 });
  } finally { await f.close(); }
});
