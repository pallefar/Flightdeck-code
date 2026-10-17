import { it, expect } from 'vitest';
import Fastify from 'fastify';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore } from '../../packages/resources/store';
import { ResourceRegistry } from '../../packages/resources/registry';
import { registerWorkflowResourceRoutes } from '../workflow-resources';
it('authenticates before JSON parsing, scopes proposals, executes only reviewed revision-bound server GET', async () => {
  let hits=0;
  const remote=createServer((req,res)=>{ hits++; expect(req.url).toBe('/measure?label=actual'); res.setHeader('content-type','application/json'); res.end(JSON.stringify({hits})); });
  remote.listen(0,'127.0.0.1'); await once(remote,'listening');
  const origin=`http://127.0.0.1:${(remote.address() as {port:number}).port}`;
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-routes-'));
  const store=new ResourceStore(root), registry=new ResourceRegistry([{id:'measure',kind:'rest',projects:['a'],endpoint:origin+'/measure',method:'GET',query:{label:'label'},input:{type:'object',properties:{label:{type:'string'}},required:['label'],additionalProperties:false},output:{type:'object',properties:{hits:{type:'number'}},required:['hits'],additionalProperties:false}}],{developmentOrigins:[origin]});
  const app=Fastify(); registerWorkflowResourceRoutes(app,{store,registry,authenticate:async authorization=>authorization==='Bearer test' ? {actor:'operator'} : null,authorize:async (_actor,project)=>project==='a'});
  const headers={authorization:'Bearer test'},base='/api/studio/workspaces/a/resources';
  try {
    expect((await app.inject({method:'POST',url:base,payload:'{',headers:{'content-type':'application/json'}})).statusCode).toBe(401);
    expect((await app.inject({method:'GET',url:'/api/studio/workspaces/b/resources',headers})).statusCode).toBe(403);
    const created=await app.inject({method:'POST',url:base,headers,payload:{definition:{name:'Metrics',functions:['measure']}}}); expect(created.statusCode).toBe(201);
    const draft=created.json().resource;
    expect((await app.inject({method:'GET',url:base+'/'+draft.id,headers})).json().resource).toEqual(draft);
    const url=base+'/'+draft.id+'/execute';
    expect((await app.inject({method:'POST',url,headers,payload:{revision:1,functionId:'measure',parameters:{label:'actual'}}})).statusCode).toBe(409); expect(hits).toBe(0);
    await registry.activate(store,'a',draft.id,1,'human-reviewer');
    expect((await app.inject({method:'POST',url,headers,payload:{revision:2,functionId:'measure',parameters:{label:'actual'},url:'http://evil'}})).statusCode).toBe(400);
    const invoked=await app.inject({method:'POST',url,headers,payload:{revision:2,functionId:'measure',parameters:{label:'actual'}}}); expect(invoked.statusCode).toBe(200); expect(invoked.json().result.output).toEqual({hits:1});
    expect(invoked.json().result.durationMs).toBeGreaterThanOrEqual(0);
    console.info('REAL DEVELOPMENT REST GET smoke', JSON.stringify({output:invoked.json().result.output,durationMs:invoked.json().result.durationMs}));
    expect(JSON.stringify((await app.inject({method:'GET',url:base,headers})).json())).not.toContain(origin);
    await store.revise('a',draft.id,2,{name:'New draft',functions:['measure']},'operator');
    expect((await app.inject({method:'POST',url,headers,payload:{revision:2,functionId:'measure',parameters:{label:'actual'}}})).statusCode).toBe(409);
    expect(hits).toBe(1);
  } finally { await app.close(); remote.closeAllConnections(); await new Promise<void>(r=>remote.close(()=>r())); await rm(root,{recursive:true,force:true}); }
});
