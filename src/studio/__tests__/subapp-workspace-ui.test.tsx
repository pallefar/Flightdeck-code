import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SubappWorkspace } from '../SubappWorkspace';
import { SubappWorkspaceController } from '../subapp-workspace-controller';
import { generatedStore, draftId, at } from './subapp-workspace.fixture';
import { createHash } from 'node:crypto';
import { captureSubappSnapshot } from '../subapp-snapshot';

it('starts as one closed compact disclosure without networking and retains credential-free source export', () => {
  const store = generatedStore(); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error('No automatic networking'); };
  const html = renderToStaticMarkup(<SubappWorkspace store={store} projectId="demo" token="" active fetcher={fetcher}/>);
  expect(calls).toBe(0); expect(html).toContain('aria-label="Saved sub-app drafts"'); expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('Download source bundle'); expect(html).toContain('In-session Save'); expect(html).toContain('Generated baseline');
  expect(html).toContain('aria-label="Working source static check"');
  expect(html).toContain('Check working source'); expect(html).toContain('No source is executed or sent to a model');
  expect(html).not.toMatch(/<dialog[^>]* open/); expect(html).not.toContain('type="password"');
});
it('masks private saved metadata synchronously on a mismatched project or token before effects', () => {
  const store = generatedStore(); const controller = new SubappWorkspaceController(store); controller.setScope('private-old', 'old-development-sentinel');
  const html = renderToStaticMarkup(<SubappWorkspace store={store} projectId="demo" token="new-development-sentinel" controller={controller}/>);
  expect(html).not.toContain('private-old'); expect(html).not.toContain('old-development-sentinel');
  expect(html).toContain('Saved drafts not checked');
});
it('keeps the panel renderable when saved manual source later exceeds the durable limit', async () => {
  const store = generatedStore(); const snapshot = captureSubappSnapshot(store.getState());
  const draft = { id: draftId, projectId: 'demo', revision: 1, status: 'draft', snapshot, contentHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), createdBy: 'fixture', updatedBy: 'fixture', createdAt: at, updatedAt: at };
  const controller = new SubappWorkspaceController(store, async (_url, init) => new Response(JSON.stringify({ draft }), { status: init!.method === 'POST' ? 201 : 200, headers: { 'content-type': 'application/json' } }));
  controller.setScope('demo', 'development-sentinel'); await controller.save('new');
  const file = store.effectiveFiles()[0]!; store.editFile(file.path, 'x'.repeat(200_001)); store.saveFile(file.path);
  expect(() => renderToStaticMarkup(<SubappWorkspace store={store} projectId="demo" token="development-sentinel" controller={controller}/>)).not.toThrow();
});
