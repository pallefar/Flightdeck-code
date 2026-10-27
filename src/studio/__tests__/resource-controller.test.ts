import { expect, it } from 'vitest';
import { ResourceController } from '../resource-controller';
const summary={id:'ba9acba0-752e-4c44-8c4a-603754b44a18',projectId:'a',revision:1,sourceRevision:null,state:'draft',definition:{name:'One',functions:['measure']},actor:'dev'};
it('makes no automatic requests and suppresses delayed old-scope refresh',async()=>{
 let resolve!:(response:Response)=>void;let calls=0;let signal:AbortSignal|null|undefined;
 const transport:typeof fetch=async (_url,options)=>{calls++;signal=options?.signal;return new Promise(r=>{resolve=r;});};
 const c=new ResourceController(transport);c.setScope('a','development');expect(calls).toBe(0);
 const pending=c.refresh();c.setScope('b','different');expect(signal?.aborted).toBe(true);
 resolve(new Response(JSON.stringify({resources:[summary],functions:[]}),{headers:{'content-type':'application/json'}}));await pending;
 expect(c.getState().resources).toEqual([]);expect(c.getState().loaded).toBe(false);expect(c.getState().busy).toBe(false);
 c.setScope('bad/project','different');expect(c.getState().ready).toBe(false);
});
it('does not issue old-scope readback after a delayed save response resolves post-abort',async()=>{
 let release!:(response:Response)=>void;let calls=0;
 const transport:typeof fetch=async()=>{calls++;if(calls===1)return new Promise(resolve=>{release=resolve;});return new Response(JSON.stringify({resource:summary}),{headers:{'content-type':'application/json'}});};
 const c=new ResourceController(transport);c.setScope('a','development');c.create();c.edit({name:'One',functions:['measure']});const pending=c.save();c.setScope('b','different-development');
 release(new Response(JSON.stringify({resource:summary}),{headers:{'content-type':'application/json'}}));await pending;
 expect(calls).toBe(1);expect(c.getState().selected).toBeNull();expect(c.getState().saved).toBe(false);expect(c.getState().draft).toBeNull();
});
it('initializes an empty schema-bound object without running a test',async()=>{
 const fn={id:'measure',kind:'rest',input:{type:'object',properties:{},required:[],additionalProperties:false},output:{type:'number'},effect:'read-only',status:'configured-not-probed'};let calls=0;
 const transport:typeof fetch=async (url)=>{calls++;return new Response(JSON.stringify(String(url).endsWith('/revisions')?{revisions:[summary]}:String(url).endsWith(summary.id)?{resource:summary}:{resources:[summary],functions:[fn]}),{headers:{'content-type':'application/json'}});};
 const c=new ResourceController(transport);c.setScope('a','development');await c.refresh();await c.open(summary.id);
 expect(c.getState().parameters).toEqual({});expect(c.getState().result).toBeNull();expect(calls).toBe(3);
});
it('retains typed proposal after CAS refusal without automatic retry',async()=>{
 let calls=0;const transport:typeof fetch=async (url,options)=>{calls++;return new Response(JSON.stringify(options?.method==='GET'?(String(url).endsWith('/revisions')?{revisions:[summary]}:{resource:summary}):{error:'https://private.invalid/?token=secret'}),{status:options?.method==='GET'?200:409,headers:{'content-type':'application/json'}});};
 const c=new ResourceController(transport);c.setScope('a','development');await c.open(summary.id);
 c.edit({name:'Keep this draft',functions:['measure']});await c.save();
 expect(c.getState().draft?.name).toBe('Keep this draft');expect(c.getState().selected?.revision).toBe(1);expect(c.getState().error).toContain('conflict');expect(c.getState().error).not.toContain('private');expect(calls).toBe(3);
});
