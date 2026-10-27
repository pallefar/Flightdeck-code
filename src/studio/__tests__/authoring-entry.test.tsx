import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { StudioApp } from '../StudioApp';
import { StudioController } from '../controller';
import { subapp } from './fixtures';

it('clears obsolete accepted routing after an explicit saved-source replacement while preserving source and conversation', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(subapp())));
  const studio = new StudioController(fetcher);
  await studio.submit({ connectionId: 'anthropic', prompt: 'A proposal form.', projectId: 'authoring-fixture' }, 'development-only');
  const source = studio.workbench.getState(); const turns = studio.getState().transcript;
  expect(source.rounds).toHaveLength(1);
  expect(typeof studio.clearReceivedHandoff).toBe('function');
  studio.clearReceivedHandoff();
  expect(studio.workbench.getState()).toBe(source);
  expect(studio.getState()).toMatchObject({ phase: 'idle', result: null, acceptedRequestId: null, transcript: turns });
  await studio.answer({ ignored: 'yes' }, 'development-only');
  await studio.approveSkillSend('development-only');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps native authoring an explicit initially-disabled engine choice in the real entry', () => {
  const fetcher = vi.fn<typeof fetch>(); const html = renderToStaticMarkup(<StudioApp fetcher={fetcher}/>);
  expect(html.includes('aria-label="Authoring engine"')).toBe(true);
  expect(html.includes('value="json-planner" selected=""')).toBe(true);
  expect(html.includes('value="native-v1" disabled=""')).toBe(true);
  expect(html.includes('Check native authoring availability')).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});

it('mounts compact durable sub-app controls in the actual IDE header without automatic reads', () => {
  const fetcher = vi.fn<typeof fetch>();
  const html = renderToStaticMarkup(<StudioApp fetcher={fetcher}/>);
  expect(html).toContain('aria-label="Saved sub-app drafts"');
  expect(html).toContain('Durable source drafts');
  expect(html).not.toContain('File edits stay in this session.');
  expect(html).toContain('In-session Save');
  expect(html).toContain('Save draft');
  expect(fetcher).not.toHaveBeenCalled();
});
