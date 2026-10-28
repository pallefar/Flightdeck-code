import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {StudioApp} from '../StudioApp';
import {WORKBENCH_CSS} from '../../workbench/theme';

it('uses a compact authoring rail and chrome, with warm token-derived surfaces rather than a dashboard',()=>{
 const shell=readFileSync(new URL('../StudioShell.css',import.meta.url),'utf8');
 expect(shell).toContain('--studio-sidebar-width:148px');
 expect(shell).toContain('grid-template-rows:56px 32px minmax(0,1fr)');
 expect(shell).toContain('--studio-paper:color-mix(in srgb,var(--te,#e98300) 3%,var(--surface,#fff))');
 expect(shell).not.toMatch(/(?:^|\})\s*(?:html|body|:root)\b/m);
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html.match(/aria-label="Studio connection and request"/g)).toHaveLength(1);
 expect(html).toContain('Draft — not deployed');
 expect(html).not.toContain('Builder workspace standby');
});

it('anchors optional architecture inspection without spending editor rows and preserves readable source minima',()=>{
 expect(WORKBENCH_CSS).toContain('.fd-wb .fd-architecture-panel');
 expect(WORKBENCH_CSS).toContain('min-height: 64px');
 expect(WORKBENCH_CSS).toContain('.fd-wb .fd-architecture > summary');
 const builder=readFileSync(new URL('../StudioBuilder.css',import.meta.url),'utf8');
 expect(builder).toContain('.studio-shell .studio-ide-action-panel');
 expect(builder).not.toContain('margin-left:350px');
 expect(builder).not.toContain('height:88px');
});
