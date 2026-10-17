import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore } from './store';

describe('durable resources', () => {
  it('persists proposal revisions, isolates projects and CAS, requires server activation', async () => {
    const root = await mkdtemp(join(homedir(), '.hermes/cache/scratch/resources-'));
    try {
      const store = new ResourceStore(root);
      const first = await store.propose('project-a', { name: 'Measurements', functions: ['measure'] }, 'operator');
      expect(first.state).toBe('draft');
      expect(await new ResourceStore(root).get('project-a', first.id)).toEqual(first);
      await expect(store.get('project-b', first.id)).rejects.toMatchObject({ statusCode: 404 });
      const results = await Promise.allSettled([store.revise('project-a', first.id, 1, first.definition, 'operator'), store.revise('project-a', first.id, 1, first.definition, 'operator')]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const next = await store.get('project-a', first.id);
      expect(next.revision).toBe(2);
      const active = await store.activate('project-a', first.id, 2, 'reviewer', { measure: 'server-policy-v1' });
      expect(active.state).toBe('active');
      expect(active.sourceRevision).toBe(2);
      expect(await new ResourceStore(root).get('project-a', first.id)).toEqual(active);
      expect((await stat(join(root, 'project-a', first.id, '3.json'))).mode & 0o777).toBe(0o600);
      expect((await store.history('project-a', first.id)).map(r => r.revision)).toEqual([1, 2, 3]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
