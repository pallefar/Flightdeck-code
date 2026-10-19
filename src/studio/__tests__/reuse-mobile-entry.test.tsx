import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {StudioApp} from '../StudioApp';

const builderCss=readFileSync(new URL('../StudioBuilder.css',import.meta.url),'utf8');
const shellCss=readFileSync(new URL('../StudioShell.css',import.meta.url),'utf8');
const emptyHomeChat='.studio-shell .studio-builder-grid[data-area=studio][data-home=empty] .studio-chat';

// Deliberately a source contract, not CSSOM/layout emulation. Native 390x568
// hit-testing reproduced UI-REUSE-MOBILE-CLIP-01; fresh browser acceptance is
// still required. SSR cannot prove viewport geometry, scrolling or pointer hits.
function rules(css:string,selector:string):string[]{
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`,'g'))].map(match=>match[1]??'');
}

it('UI-REUSE-MOBILE-CLIP-01 source contract centers fitting empty-home content but uses safe start-edge overflow',()=>{
  const home=rules(builderCss,emptyHomeChat);
  expect(home).toHaveLength(1);
  // `safe center` retains desktop centering when the content fits, but falls
  // back to start alignment on overflow instead of placing Browse behind chrome.
  expect(home[0]).toMatch(/(?:^|;)\s*justify-content:\s*safe\s+center\s*(?:;|$)/);
});

it('retains the source overflow route to the existing main scroller without shrinking the command or controls',()=>{
  const home=rules(builderCss,emptyHomeChat)[0];
  expect(home).toMatch(/(?:^|;)\s*overflow:\s*visible\s*(?:;|$)/);
  const chat=rules(builderCss,'.studio-shell .studio-chat')[0];
  expect(chat).toContain('height:100%');
  expect(chat).toContain('min-height:0');
  expect(chat).toContain('display:flex');
  expect(chat).toContain('flex-direction:column');
  expect(rules(builderCss,'.studio-shell .studio-command')[0]).toContain('flex:none');
  expect(rules(shellCss,'.studio-shell .studio-main').some(rule=>/(?:^|;)\s*overflow:\s*auto\s*(?:;|$)/.test(rule))).toBe(true);
  expect(shellCss).toContain('.studio-shell .studio-main :is(button,summary):not(:where(.wf-editor *,.fd-wb *)){min-height:44px}');
});

it('keeps the real unauthenticated Browse entry inside the visible empty-home command before the request form',()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>{throw Error('Unexpected network access in static mobile entry test.');});
  const html=renderToStaticMarkup(<StudioApp fetcher={fetcher}/>);
  const grid=html.match(/<div\b[^>]*class="studio-builder-grid"[^>]*>/)?.[0];
  expect(grid).toContain('data-home="empty"');
  expect(grid).toContain('data-area="studio"');
  expect(grid).not.toMatch(/\b(?:hidden|inert)(?:[\s=>])/);
  const commandStart=html.indexOf('class="studio-command"'),setupStart=html.indexOf('class="studio-chat-setup"');
  expect(commandStart).toBeGreaterThan(-1);
  expect(setupStart).toBeGreaterThan(commandStart);
  const command=html.slice(commandStart,setupStart);
  const trigger=command.match(/<button\b[^>]*aria-label="Browse reusable sources"[^>]*>/)?.[0];
  expect(trigger).toContain('aria-haspopup="dialog"');
  expect(trigger).not.toMatch(/\b(?:disabled|hidden|inert)(?:[\s=>])/);
  expect(command.indexOf('aria-label="Browse reusable sources"')).toBeLessThan(command.indexOf('aria-label="Studio connection and request"'));
  expect(fetcher).not.toHaveBeenCalled();
});
