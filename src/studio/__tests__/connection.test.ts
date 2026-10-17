import { expect, it, vi } from "vitest";
import { checkConnection } from "../connection";
const ids = ['codex-chatgpt', 'flightdeck', 'local', 'anthropic'];
const descriptors = { connections: ids.map(id => ({ id, label: id, model: id === 'local' ? 'local-model' : null, status: id === 'local' ? 'configured' : 'unavailable', verification: 'not-probed', ...(id === 'local' ? {} : { reason: 'Not configured' }) })), selectedId: null };
const health = { ok: true, selectedId: null, model: null, modelStatus: 'unselected', verification: 'not-probed' };
const skills = { projectId: 'project-a', skillSourceState: 'loaded', skillSources: [{ id: 'skill', version: '1', contentHash: 'abc' }] };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
it("authenticates four descriptors and updated health without a model call or implicit selection", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(health)).mockResolvedValueOnce(response(descriptors)).mockResolvedValueOnce(response(skills));
  const status = await checkConnection('project-a', 'secret', fetcher);
  expect(status).toMatchObject({ selectedId: null, connections: descriptors.connections, skillSourceState: 'loaded' });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/studio/health', '/api/studio/model-connections', '/api/studio/projects/project-a/skills']);
  for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ credentials: 'same-origin', headers: { Authorization: 'Bearer secret' }, cache: 'no-store' });
});
it.each([
  { ...descriptors, endpoint: 'https://secret.invalid' },
  { ...descriptors, connections: descriptors.connections.slice(1) },
  { ...descriptors, connections: [...descriptors.connections.slice(1), descriptors.connections[1]] },
  { ...descriptors, connections: descriptors.connections.map(d => ({ ...d, apiKey: 'sk-secret' })) },
  { ...descriptors, connections: descriptors.connections.map(d => ({ ...d, label: 'https://provider.invalid' })) },
  { ...descriptors, selectedId: 'unknown' },
])('rejects unsafe or incomplete descriptors %#', async body => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(health)).mockResolvedValueOnce(response(body)).mockResolvedValueOnce(response(skills));
  await expect(checkConnection('project-a', 'secret', fetcher)).rejects.toThrow('Invalid connection response');
});
it('bounds streamed descriptor bytes', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(health)).mockResolvedValueOnce(response({ connections: 'x'.repeat(33000) }));
  await expect(checkConnection('project-a', 'secret', fetcher)).rejects.toThrow('Invalid connection response');
});
it('refuses public liveness as authenticated configuration', async () => {
  await expect(checkConnection('project-a', 'secret', async () => response({ ok: true }))).rejects.toThrow('Invalid connection response');
});
it('does not echo raw transport or server errors', async () => {
  await expect(checkConnection('project-a', 'secret', async () => { throw new Error('sk-secret https://provider.invalid'); })).rejects.toThrow('Studio server unavailable');
  await expect(checkConnection('project-a', 'secret', async () => new Response('sk-secret', { status: 401 }))).rejects.toThrow('Authentication refused');
});
it('rejects project URL/path injection before requests', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(checkConnection('../secret', 'secret', fetcher)).rejects.toThrow('Project ID');
  expect(fetcher).not.toHaveBeenCalled();
});
