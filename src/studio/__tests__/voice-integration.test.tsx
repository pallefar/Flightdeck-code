import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { StudioApp } from '../StudioApp';

it('the actual Studio entry includes the opt-in voice copilot beside its retained text composer', () => {
  const html = renderToStaticMarkup(<StudioApp />);
  expect(html.includes('aria-label="Voice copilot"')).toBe(true);
  expect(html.includes('aria-label="Studio connection and request"')).toBe(true);
  expect(html.includes('Create draft')).toBe(true);
  expect(html.includes('Select a configured model')).toBe(true);
});
