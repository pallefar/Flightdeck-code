import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {StudioApp} from '../StudioApp';

it('retains the blank Process workspace behind the unchanged chat-first entry and offers an explicit starter',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html).toContain('data-entry="chat-first"');
 expect(html).toContain('data-area="studio"');
 expect(html).toContain('Start from a process / template');
 expect(html).toContain('aria-label="Process discovery workspace" hidden=""');
 expect(html).toContain('aria-label="Process name"');
 expect(html).toContain('Authenticate and check the current project');
});

it('describes exact rational ROI intermediates with quantization only at reported outputs',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html).toContain('Exact rational intermediates are retained');
 expect(html).toContain('reported outputs are quantized');
 expect(html).not.toContain('truncates intermediate fractional units');
});

it('mounts the source-evidence disclosure in the retained ROI step with no live connector claim',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html).toContain('aria-label="Process evidence sources"');
 for(const label of ['Flightdeck Maps','TEOA / Advantage','Flightdeck OS'])expect(html).toContain(label);
 expect(html).toContain('No live sources connected');
});
