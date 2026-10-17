import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {StudioApp} from '../StudioApp';

it('inherits the host appearance unless the standalone caller explicitly chooses Night',()=>{
 const inherited=renderToStaticMarkup(<StudioApp/>);
 const night=renderToStaticMarkup(<StudioApp initialAppearance="night"/>);
 expect(inherited.includes('data-appearance="inherit"')).toBe(true);
 expect(night.includes('data-appearance="night"')).toBe(true);
 expect(night.includes('aria-label="Studio appearance"')).toBe(true);
 const css=readFileSync(new URL('../StudioShell.css',import.meta.url),'utf8');
 expect(css).toContain('.studio-shell[data-appearance=night]');
 expect(css).toContain('--surface: #17242f');
 expect(css).not.toMatch(/(?:^|\})\s*(?:html|body|:root)\b/m);
});

it('keeps IDE draft/sandbox limits in a compact contextual disclosure instead of an extra toolbar paragraph',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html.includes('class="studio-ide-help"')).toBe(true);
 expect(html.includes('Draft · scriptless preview')).toBe(true);
 expect(html.includes('generated source is not evaluated')).toBe(true);
});

it('keeps startup focused on the command without a duplicate heading or empty graph context',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html.includes('class="studio-chat-header" hidden=""')).toBe(true);
 expect(html.includes('class="studio-context-details" hidden=""')).toBe(true);
 expect(html.includes('class="studio-request-boundary"')).toBe(true);
 expect(html.includes('Fresh draft · not deployed')).toBe(true);
});

it('starts with one integrated command surface instead of suggestions above a detached composer',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 const command=html.slice(html.indexOf('class="studio-command"'),html.indexOf('class="studio-chat-setup"'));
 expect(html).toContain('class="studio-command"');
 expect(command).toContain('aria-label="Studio connection and request"');
 expect(command).toContain('Your request');
 expect(command).toContain('class="studio-suggestions"');
 expect(command.indexOf('Studio connection and request')).toBeLessThan(command.indexOf('class="studio-suggestions"'));
 expect(command).toContain('Each new request creates a fresh draft');
});

it('keeps the three authoring destinations primary and puts resource/review tools in a disclosure',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 const primary=html.slice(html.indexOf('<nav'),html.indexOf('</nav>'));
 expect(primary).toContain('AI builder');
 expect(primary).toContain('Workflow builder');
 expect(primary).toContain('Sub-app IDE');
 expect(primary).not.toContain('Resources');
 expect(primary).not.toContain('Approvals');
 expect(html).toContain('aria-label="Studio tools"');
 expect(html).toContain('Resources');
 expect(html).toContain('Approvals');
 expect(html).toContain('Draft — not deployed');
});
