import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
it('contains voice chrome and animates only genuine native-active states with both motion opt-outs', () => {
  const css = readFileSync(new URL('./voice.css', import.meta.url), 'utf8');
  expect(css).not.toMatch(/(?:^|\n)(?:html|body|:root)\b/);
  expect(css).toContain('.fd-voice');
  expect(css).toContain('prefers-reduced-motion: reduce');
  expect(css).toContain('[data-motion="off"]');
  expect(css).toContain('[data-voice-state="listening"]');
  expect(css).toContain('[data-voice-state="speaking"]');
  expect(css).not.toMatch(/\[data-voice-state="(?:idle|off|queued|preparing)"\][^{]*\{[^}]*animation:/);
});
