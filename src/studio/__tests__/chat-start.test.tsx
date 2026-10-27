import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioApp } from '../StudioApp';

afterEach(() => vi.unstubAllGlobals());

it.each(['/', '/demo'])('starts %s with one chat page, not a standby split or preselected builder', path => {
  vi.stubGlobal('window', { location: { pathname: path } });
  const html = renderToStaticMarkup(<StudioApp />);
  expect(html.includes('aria-label="Builder workspace standby"')).toBe(false);
  expect(html.includes('data-area="studio"')).toBe(true);
  expect(html.includes('data-entry="chat-first"')).toBe(true);
  expect((html.match(/aria-label="Studio connection and request"/g) ?? []).length).toBe(1);
  expect(html.includes('Ask for a workflow or a sub-app')).toBe(true);
  expect(html.includes('Open workflow example')).toBe(true);
});

it('makes connection setup the sole enabled primary action while creation is unavailable', () => {
  const fetcher = vi.fn<typeof fetch>(() => Promise.reject(new Error('No automatic connection request')));
  const html = renderToStaticMarkup(<StudioApp fetcher={fetcher} />);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const setup = buttons.find(button => button[2] === 'Set up connection');
  const create = buttons.find(button => button[2] === 'Create draft');
  expect(setup?.[1]).toContain('data-primary-action="true"');
  expect(setup?.[1]).toContain('type="button"');
  expect(setup?.[1]).not.toContain('disabled');
  expect(create?.[1]).toContain('data-primary-action="false"');
  expect(create?.[1]).toContain('disabled');
  expect(buttons.filter(button => button[1]?.includes('data-primary-action="true"'))).toHaveLength(1);
  expect(fetcher).not.toHaveBeenCalled();
});
