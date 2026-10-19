import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {RoiEvidenceSources} from './SourceEvidencePanel';

it('shows the three actual source boundaries without implying live data, savings or source authority',()=>{
 const transport=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No source request is permitted.'));
 try{
  const html=renderToStaticMarkup(<RoiEvidenceSources/>);
  for(const label of ['Flightdeck Maps','TEOA / Advantage','Flightdeck OS'])expect(html).toContain(label);
  expect(html.match(/data-availability="unavailable"/g)).toHaveLength(3);
  expect(html).toContain('host-owned aggregate export');
  expect(html).toContain('Manual assumptions remain separate');
  expect(html).toContain('not measured active labor');
  expect(html).toContain('not verified cash savings');
  expect(html).toContain('Statutory and human-only steps remain unchanged');
  expect(transport).not.toHaveBeenCalled();
 }finally{transport.mockRestore();}
});
