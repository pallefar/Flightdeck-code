import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ResourceLibrary } from '../ResourceLibrary';
import { ResourceController } from '../resource-controller';
import { StudioApp } from '../StudioApp';
it('mounts Resources in Studio with disabled unauthenticated refresh and no second global shell',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html).toContain('>Resources</button>');expect(html).toContain('aria-label="Resource library"');expect(html).toMatch(/aria-label="Refresh resources" disabled/);
 expect(html).toContain('Independent server review required');expect(html).not.toContain('Approve resource');
});
it('shows not-checked rather than fake empty or connected status before explicit refresh',()=>{
 const c=new ResourceController();c.setScope('demo','development-test');
 const html=renderToStaticMarkup(<ResourceLibrary controller={c} projectId="demo" token="development-test" onCredentials={()=>{}}/>);
 expect(html).toContain('Resources not checked');expect(html).not.toContain('No resources saved');expect(html).not.toContain('type="password"');expect(html).not.toContain('<nav');expect(html).not.toContain('Insert into workflow');
});
it('masks previous scope resources immediately before effects reset controller',async()=>{
 const fetcher:typeof fetch=async()=>new Response(JSON.stringify({resources:[{id:'ba9acba0-752e-4c44-8c4a-603754b44a18',projectId:'a',revision:1,sourceRevision:null,state:'draft',definition:{name:'Old private proposal',functions:['measure']},actor:'dev'}],functions:[]}),{headers:{'content-type':'application/json'}});
 const c=new ResourceController(fetcher);c.setScope('a','development-test');await c.refresh();
 const html=renderToStaticMarkup(<ResourceLibrary controller={c} projectId="b" token="new-development-test" onCredentials={()=>{}}/>);
 expect(html).not.toContain('Old private proposal');expect(html).toContain('Resources not checked');
});
