import { afterEach, expect, it } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createEmptyGraph } from '../workflow/graph';
import { createDraftRoot, openDraftService } from './draft-store';
import { createAuthority } from './authority';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
it('uses the existing file store in isolated exact tuple namespaces and reconstructs exact drafts without legacy access', async () => {
  directory = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'bridge-store-test-'));
  const root = await createDraftRoot(directory); const service = await openDraftService(root);
  const authority = createAuthority({ enabled: true, adapter: { current: async (s: { workspaceId: string }) => ({ actorId: 'alice', displayName: 'Same label', workspaceId: s.workspaceId, projectId: 'general', active: true, pending: false, member: true, workspaceEnabled: true, projectEnabled: true, sessionVersion: 's1', authorityVersion: 'm1' }) }, policy: { permit: async () => ({ revision: 'p1' }) } });
  const created = [];
  for (const workspaceId of ['alpha', 'beta']) {
    const wire = { method: 'POST', path: `/bridge/workspaces/${workspaceId}/projects/general/drafts`, body: Buffer.from(JSON.stringify({ graph: createEmptyGraph(workspaceId) })) };
    const issued = await authority.issue({ workspaceId }, wire); const claim = await authority.consume(issued.handle, wire, 'studio-drafts/v1');
    const result = await service.execute(wire, claim.binding, () => authority.check(claim.lease, wire, 'studio-drafts/v1')); created.push(result.body.draft);
  }
  const reconstructed = await openDraftService(root);
  for (const [i, workspaceId] of ['alpha', 'beta'].entries()) {
    const draft = created[i]!;
    const wire = { method: 'GET', path: `/bridge/workspaces/${workspaceId}/projects/general/drafts/${draft.id}`, body: Buffer.alloc(0) };
    const issued = await authority.issue({ workspaceId }, wire); const claim = await authority.consume(issued.handle, wire, 'studio-drafts/v1');
    expect((await reconstructed.execute(wire, claim.binding, () => authority.check(claim.lease, wire, 'studio-drafts/v1'))).body.draft).toEqual(draft);
  }
  await expect(openDraftService(directory)).rejects.toThrow();
});
