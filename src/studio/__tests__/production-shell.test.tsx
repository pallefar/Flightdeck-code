import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {StudioApp} from '../StudioApp';

it('offers a shared named application bar, explicit context and a keyboard skip target without authenticating',()=>{
 const fetcher=vi.fn<typeof fetch>();
 const html=renderToStaticMarkup(<StudioApp fetcher={fetcher}/>);
 expect(html).toContain('aria-label="Flightdeck Studio workspace"');
 expect(html).toContain('href="#studio-main"');
 expect(html).toContain('id="studio-main" tabindex="-1"');
 expect(html).toContain('Project: Not selected');
 expect(html).toContain('Model: Not selected');
 expect(html).toContain('Graph draft: Untitled workflow');
 expect(html).toContain('Connection settings');
 expect(html).toContain('aria-current="page"');
 expect(fetcher).not.toHaveBeenCalled();
});

it('exposes one main landmark without nesting the retained workflow editor',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html.match(/<main(?:\s|>)/g)??[]).toHaveLength(1);
 expect(html).not.toContain('<main class="wf-main"');
});

it('keeps run and save boundaries discoverable in closed editor help rather than a paragraph wall',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html).toContain('<details class="studio-editor-help"><summary>Local run &amp; draft help</summary>');
 expect(html).toContain('routing data, not a human-approval authorization');
 expect(html).toContain('Graph JSON export contains your edits');
 expect(html).toContain('Server saves and execution require an operator credential and project');
 expect(html).toContain('aria-label="Workflow workspace"');
});

it('puts the authoring request before disclosed setup and explains unavailable creation',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html.indexOf('<span class="studio-request-label">Your request')).toBeLessThan(html.indexOf('<summary>Project &amp; model setup'));
 expect(html).toContain('Select a configured model in Connection settings before creating a draft');
 expect(html).toContain('Authoring only — saved-revision execution is separate');
});

it('distinguishes production same-origin built assets from the local Vite development proxy',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html).toContain('Production: the built Studio app and backend share the same origin');
 expect(html).toContain('Development only:');
 expect(html).toContain('npm run dev:server');
 expect(html).toContain('not a production serving requirement');
});
