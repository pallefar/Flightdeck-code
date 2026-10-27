import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore } from '../../../packages/resources/store';
import { ResourceRegistry } from '../../../packages/resources/registry';
import { registerWorkflowResourceRoutes } from '../../../server/workflow-resources';
import { ResourceController } from '../resource-controller';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ResourceClient, validateResourceValue, boundedJson } from '../resource-client';
const devResource={id:'ba9acba0-752e-4c44-8c4a-603754b44a18',projectId:'demo',revision:2,sourceRevision:1,state:'active' as const,definition:{name:'Development',functions:['measure']},actor:'dev-reviewer'};
const devFunction={id:'measure',kind:'rest' as const,input:{type:'object' as const,properties:{},required:[],additionalProperties:false as const},output:{type:'number' as const},effect:'read-only' as const,status:'configured-not-probed' as const};
it('refuses unsupported inherited schema type keys rather than leaking raw exceptions',async()=>{
 const transport:typeof fetch=async()=>new Response(JSON.stringify({resources:[],functions:[{...devFunction,input:{type:'toString'}}]}),{headers:{'content-type':'application/json'}});
 await expect(new ResourceClient('demo','dev',transport).list()).rejects.toMatchObject({code:'invalid'});
});
it('requires bounded schema validation with no accessors, cycles, prototype properties or unsupported keywords',()=>{
 let invoked=false;const accessor=Object.defineProperty({},'name',{enumerable:true,get(){invoked=true;return 'no';}});
 const s={type:'object' as const,properties:{name:{type:'string' as const,maxLength:3}},required:['name'],additionalProperties:false as const};
 expect(validateResourceValue({name:'yes'},s)).toBe(true);expect(validateResourceValue({name:'long'},s)).toBe(false);
 expect(validateResourceValue(accessor,s)).toBe(false);expect(invoked).toBe(false);
 expect(validateResourceValue({name:'yes'},{...s,$ref:'https://private.invalid'} as typeof s)).toBe(false);
 expect(boundedJson(JSON.parse('{"__proto__":{}}'))).toBe(false);
 const cycle:unknown[]=[];cycle.push(cycle);expect(boundedJson(cycle)).toBe(false);
 expect(validateResourceValue(new Array(1),{type:'array',items:{type:'number'},maxItems:2})).toBe(false);
});
it('never reports saved on changed exact GET readback',async()=>{
 let calls=0;const proposal={name:'Development',functions:['measure']};
 const draft={...devResource,revision:1,sourceRevision:null,state:'draft'};
 const transport:typeof fetch=async()=>{calls++;return new Response(JSON.stringify({resource:calls===1?draft:{...draft,definition:{...proposal,name:'Changed underneath'}}}),{headers:{'content-type':'application/json'}});};
 await expect(new ResourceClient('demo','dev',transport).save(proposal)).rejects.toMatchObject({code:'readback'});expect(calls).toBe(2);
});
it('uses authenticated real routes and exact create/update readback with CAS', async () => {
 const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-ui-'));
 const app=Fastify(); const registry=new ResourceRegistry([] ,{});
 registerWorkflowResourceRoutes(app,{store:new ResourceStore(root),registry,authenticate:async h=>h==='Bearer development-test' ? {actor:'dev-operator'}:null,authorize:async (_a,p)=>p==='demo'});
 const calls:string[]=[];
 const transport:typeof fetch=async (url,options)=>{calls.push(`${options?.method} ${url}`); const response=await app.inject({method:options?.method as 'GET'|'POST'|'PUT',url:String(url),headers:options?.headers as Record<string,string>,...(options?.body ? {payload:String(options.body)}:{})});return new Response(response.body,{status:response.statusCode,headers:{'content-type':'application/json'}});};
 try {const client=new ResourceClient('demo','development-test',transport);
 expect(await client.list()).toEqual({resources:[],functions:[]});
 const created=await client.save({name:'Development proposal',functions:['missing-function']});
 expect(created.state).toBe('draft');expect(calls.slice(-2)).toEqual(['POST /api/studio/workspaces/demo/resources',`GET /api/studio/workspaces/demo/resources/${created.id}`]);
 const updated=await client.save({name:'Changed',functions:['missing-function']},created);expect(updated.revision).toBe(2);
 await expect(client.save({name:'Stale',functions:['missing-function']},created)).rejects.toMatchObject({code:409});
 expect(await client.history(created.id)).toHaveLength(2);
 await expect(new ResourceClient('demo','wrong',transport).list()).rejects.toMatchObject({code:401});
 }finally {await app.close();await rm(root,{recursive:true,force:true});}
});
it('measures a real DEVELOPMENT GET only after independent activation and explicit controller test',async()=>{
 let hits=0;const remote=createServer((request,response)=>{hits++;expect(request.url).toBe('/measure');response.setHeader('content-type','application/json');response.end(JSON.stringify({hits}));});
 remote.listen(0,'127.0.0.1');await once(remote,'listening');
 const origin=`http://127.0.0.1:${(remote.address() as {port:number}).port}`;
 const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-client-live-'));
 const store=new ResourceStore(root);const registry=new ResourceRegistry([{id:'measure',kind:'rest',projects:['demo'],endpoint:origin+'/measure',method:'GET',query:{},input:devFunction.input,output:{type:'object',properties:{hits:{type:'number'}},required:['hits'],additionalProperties:false}}],{developmentOrigins:[origin]});
 const app=Fastify();registerWorkflowResourceRoutes(app,{store,registry,authenticate:async h=>h==='Bearer development-test'?{actor:'development-operator'}:null,authorize:async(_a,p)=>p==='demo'});
 const transport:typeof fetch=async(url,options)=>{const r=await app.inject({url:String(url),method:options?.method as 'GET'|'POST'|'PUT',headers:options?.headers as Record<string,string>,...(options?.body?{payload:String(options.body)}:{})});return new Response(r.body,{status:r.statusCode,headers:{'content-type':'application/json'}});};
 try {
  const c=new ResourceController(transport);c.setScope('demo','development-test');await c.refresh();c.create();c.edit({name:'Development GET',functions:['measure']});await c.save();
  expect(c.getState().saved).toBe(true);const draft=c.getState().selected!;await c.test();expect(hits).toBe(0);
  await registry.activate(store,'demo',draft.id,1,'independent-development-reviewer');
  await c.refresh();await c.open(draft.id);expect(c.getState().selected?.state).toBe('active');expect(c.getState().revisions.map(r=>r.revision).sort()).toEqual([1,2]);expect(hits).toBe(0);
  await c.test();expect(hits).toBe(1);expect(c.getState().result?.output).toEqual({hits:1});expect(c.getState().result?.durationMs).toBeGreaterThanOrEqual(0);expect(c.getState().functions[0]?.status).toBe('configured-not-probed');
  console.info('REAL Resources browser-client DEVELOPMENT GET',JSON.stringify(c.getState().result));
  c.setParameters({});expect(c.getState().result).toBeNull();expect(hits).toBe(1);c.selectRevision(1);await c.test();expect(hits).toBe(1);
 }finally {await app.close();remote.closeAllConnections();await new Promise<void>(resolve=>remote.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
