import { it,expect } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp,rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../index';
import { createFileWorkflowWorkspaceStore } from '../workflow-workspace-store';
import { ResourceStore } from '../../packages/resources/store';
import { ResourceRegistry } from '../../packages/resources/registry';
import { registerDevelopmentMcp,graphInput,graphOutput } from '../../packages/resources/development-mcp';
import type { Graph } from '../../packages/workflow/graph';

it('runs saved REST and MCP resource graphs using operator/project-bound authority with no browser activation',async()=>{
  let hits=0,allowed=true,checks=0,revokeAt=Infinity,reviseAt=Infinity,resourceToRevise='';
  const remote=Fastify();
  remote.get('/measure',async req=>{hits++;return {label:(req.query as {label:string}).label,hits};});
  registerDevelopmentMcp(remote,()=>true);
  const origin=await remote.listen({host:'127.0.0.1',port:0});
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-run-'));
  const store=new ResourceStore(join(root,'resources'));
  const registry=new ResourceRegistry([
    {id:'measure',kind:'rest',projects:['local-project'],endpoint:origin+'/measure',method:'GET',query:{label:'label'},input:{type:'object',properties:{label:{type:'string'}},required:['label'],additionalProperties:false},output:{type:'object',properties:{label:{type:'string'},hits:{type:'number'}},required:['label','hits'],additionalProperties:false}},
    {id:'validate',kind:'mcp',projects:['local-project'],endpoint:origin+'/mcp',tool:'validate_graph',readOnly:true,input:graphInput,output:graphOutput},
  ],{developmentOrigins:[origin]});
  const operator={actor:'Karsten Haldan',token:'composition-run-token-at-least-24-chars'};
  const app=createServer({operator,workflowWorkspaceStore:createFileWorkflowWorkspaceStore(join(root,'workspace.json')),workflowResources:{store,registry,authorize:async(actor,project,action)=>{expect(actor).toBe(operator.actor);if(action==='execute'){checks++;if(checks===reviseAt)await store.revise('local-project',resourceToRevise,2,{name:'Changed during scope resolution',functions:['measure','validate']},operator.actor);}return allowed&&checks<revokeAt&&project==='local-project';}}});
  const address=await app.listen({host:'127.0.0.1',port:0});
  const headers={authorization:`Bearer ${operator.token}`,'content-type':'application/json'};
  const base='/api/studio/workspaces/local-project/resources';
  async function http(path:string,method='GET',payload?:unknown){const r=await fetch(address+path,{method,headers,...(payload===undefined?{}:{body:JSON.stringify(payload)})});return {status:r.status,body:await r.json()};}
  async function run(resourceId:string,revision:number,functionId:string,input:Record<string,never>|Record<string,unknown>,project='local-project'){
    const graph:Graph={version:1,id:'actualResourceGraph',name:'DEVELOPMENT reviewed resource',customBlocks:[],nodes:[{id:'start',type:'manual',label:'Start',position:{x:0,y:0},config:{}},{id:'read',type:'resource',label:'Reviewed read',position:{x:100,y:0},config:{resourceId,revision,functionId},...(functionId==='measure'?{inputMappings:[{target:'label',source:{kind:'input' as const,path:['label']}}]}:{})},{id:'end',type:'output',label:'End',position:{x:200,y:0},config:{}}],edges:[{id:'a',source:'start',target:'read'},{id:'b',source:'read',target:'end'}]};
    const workflow='/api/studio/workspaces/'+project+'/workflows';
    const saved=await http(workflow,'POST',{graph});expect(saved.status).toBe(201);
    expect((await http(workflow+'/'+saved.body.draft.id)).body.draft.graph).toEqual(graph);
    const executed=await http(workflow+'/'+saved.body.draft.id+'/runs','POST',{revision:1,input});expect(executed.status).toBe(201);
    expect((await http(workflow+'/'+saved.body.draft.id+'/runs/'+executed.body.run.id)).body.run).toEqual(executed.body.run);
    expect(executed.body.run.result.trace.every((t:{details?:Record<string,unknown>})=>!t.details||(!('input' in t.details)&&!('output' in t.details)))).toBe(true);
    return executed.body.run.result;
  }
  try {
    const draft=(await http(base,'POST',{definition:{name:'DEVELOPMENT two reviewed functions',functions:['measure','validate']}})).body.resource;
    expect((await run(draft.id,1,'measure',{label:'blocked draft'})).status).toBe('blocked');expect(hits).toBe(0);
    // Explicit independent reviewer FIXTURE, not an identity created in Docker or accepted from a browser.
    const active=await registry.activate(store,'local-project',draft.id,1,'Independent reviewer fixture');
    expect((await http(base+'/'+draft.id)).body.resource.revision).toBe(active.revision);
    const rest=await run(draft.id,2,'measure',{label:'real',ignored:'mapping must exclude this'});
    expect(rest.status).toBe('completed');expect(rest.output).toEqual({label:'real',hits:1});
    const mcp=await run(draft.id,2,'validate',{nodes:['a','b'],edges:[{from:'a',to:'b'}]});
    expect(mcp.status).toBe('completed');expect(mcp.output).toEqual({valid:true,nodeCount:2,edgeCount:1});
    expect((await http('/api/studio/workspaces/foreign/resources')).status).toBe(403);
    expect((await run(draft.id,2,'measure',{label:'foreign'},'foreign')).status).toBe('blocked');
    expect((await run(draft.id,2,'not-selected',{})).status).toBe('blocked');
    allowed=false;expect((await run(draft.id,2,'measure',{label:'revoked'})).status).toBe('blocked');allowed=true;
    revokeAt=checks+2;expect((await run(draft.id,2,'measure',{label:'revoked-at-effect'})).status).toBe('blocked');expect(checks).toBe(revokeAt);revokeAt=Infinity;expect(hits).toBe(1);
    const routeDraft=(await http(base,'POST',{definition:{name:'Route effect-time regression fixture',functions:['measure']}})).body.resource;
    await registry.activate(store,'local-project',routeDraft.id,1,'Independent route reviewer fixture');
    resourceToRevise=routeDraft.id;reviseAt=checks+2;
    expect((await http(base+'/'+routeDraft.id+'/execute','POST',{revision:2,functionId:'measure',parameters:{label:'changed-route-grant'}})).status).toBe(409);
    expect(hits).toBe(1);reviseAt=Infinity;
    resourceToRevise=draft.id;reviseAt=checks+2;
    expect((await run(draft.id,2,'measure',{label:'changed-during-grant-check'})).status).toBe('blocked');
    expect((await http(base+'/'+draft.id)).body.resource.revision).toBe(3);
    reviseAt=Infinity;
    expect((await run(draft.id,2,'measure',{label:'stale'})).status).toBe('blocked');expect(hits).toBe(1);expect(checks).toBeGreaterThanOrEqual(2);
    console.info('REAL ROOT SAVED RESOURCE GRAPHS',JSON.stringify({rest:rest.output,mcp:mcp.output,hits}));
  } finally {await app.close();await remote.close();await rm(root,{recursive:true,force:true});}
});
