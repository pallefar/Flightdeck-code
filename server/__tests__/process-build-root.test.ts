import {expect,it,vi} from 'vitest';
import {createServer} from '../index';
import {createMemoryGrantStore} from '../../packages/approvals/src/store';
import {createModelConnections} from '../model-connections';
import {PROCESS_TEMPLATES} from '../../src/process-studio/plan';
import {processBuildRequest} from '../../src/studio/__tests__/process-template-fixture';
import {checkConnection} from '../../src/studio/connection';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createFileSubappWorkspaceStore,type SubappWorkspaceStore} from '../subapp-workspace-store';
import {buildProcessDraft} from '../../src/process-studio/build-client';
import {buildProcessPlan} from '../../src/process-studio/plan';
import {StudioController} from '../../src/studio/controller';
import {captureSubappSnapshot,restoreSubappSnapshot} from '../../src/studio/subapp-snapshot';
import {SubappWorkspaceClient} from '../../src/studio/subapp-workspace-client';

const operator={actor:'Development Operator',token:'public-process-root-development-only'};
const headers={authorization:`Bearer ${operator.token}`,host:'127.0.0.1:3111',origin:'http://127.0.0.1:3111'};
function fixture(subappWorkspaceStore?:SubappWorkspaceStore){
 const base=createModelConnections({env:{}});
 const resolve=vi.fn(()=>{throw new Error('Model resolution is prohibited in a registered-template build.');});
 const app=createServer({operator,modelConnections:{...base,resolve,resolveSelected:resolve},store:createMemoryGrantStore(),projectSkillSource:async()=>[],...(subappWorkspaceStore?{subappWorkspaceStore}:{})});
 return {app,resolve};
}
it.each(PROCESS_TEMPLATES)('mounts real model-free $id generation at the actual root and never resolves a model',async template=>{
 const {app,resolve}=fixture();
 try{
  const response=await app.inject({method:'POST',url:'/api/studio/process/build',headers,payload:processBuildRequest(template.id)});
  expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');
  const value=response.json();expect(value).toMatchObject({status:'process-built',projectId:'development-process',templateId:template.id,templateVersion:template.version,outcome:{status:'proposed',conformance:{ok:true},artifacts:{decision:'allow'}}});
  expect(value.outcome.generated.files.length).toBeGreaterThan(0);expect(resolve).not.toHaveBeenCalled();
 }finally{await app.close();}
});

it.each(PROCESS_TEMPLATES)('composes $id through native HTTP, strict browser client, Workbench and exact durable readback after reconstruction',async template=>{
 const root=await mkdtemp(join(await realpath(process.env.TMPDIR!),'process-root-e2e-'));
 const file=join(root,'private','subapps.json');
 let fixtureRoot=fixture(createFileSubappWorkspaceStore(file));
 const transport=(origin:string):typeof fetch=>async(input,init)=>{
  const requestHeaders=new Headers(init?.headers);requestHeaders.set('origin',origin);
  return fetch(new URL(String(input),origin),{...init,headers:requestHeaders});
 };
 try{
  const origin=await fixtureRoot.app.listen({host:'127.0.0.1',port:0});
  const request=processBuildRequest(template.id),abort=new AbortController(),fetcher=transport(origin);
  const metadata=await checkConnection(request.projectId,operator.token,fetcher,abort.signal);
  expect(metadata.processBuild).toBe('registered-templates-v1');
  const receipt=await buildProcessDraft({...request,templateVersion:template.version},operator.token,abort.signal,fetcher);
  const plan=buildProcessPlan(request.draft);if(plan.status!=='ready')throw new Error('Complete real plan required');
  const controller=new StudioController(fetcher);
  expect(controller.acceptRegisteredTemplate(receipt.outcome,{projectId:request.projectId,templateId:template.id,templateVersion:template.version,artifactId:receipt.artifactId,prd:plan.prd})).toBe(true);
  const snapshot=captureSubappSnapshot(controller.workbench.getState());
  expect(snapshot.baseline.files).toEqual(receipt.outcome.generated.files.filter(source=>source.kind!=='standalone'));
  const client=new SubappWorkspaceClient(request.projectId,operator.token,fetcher);
  const saved=await client.create(snapshot);expect(await client.get(saved.id)).toEqual(saved);
  expect(saved.snapshot).toEqual(snapshot);expect(fixtureRoot.resolve).not.toHaveBeenCalled();
  await fixtureRoot.app.close();fixtureRoot=fixture(createFileSubappWorkspaceStore(file));
  const rebuiltOrigin=await fixtureRoot.app.listen({host:'127.0.0.1',port:0});
  const readback=await new SubappWorkspaceClient(request.projectId,operator.token,transport(rebuiltOrigin)).get(saved.id);
  expect(readback).toEqual(saved);
  const restored=new StudioController();restoreSubappSnapshot(restored.workbench,readback.snapshot);
  expect(captureSubappSnapshot(restored.workbench.getState())).toEqual(snapshot);
  expect(fixtureRoot.resolve).not.toHaveBeenCalled();
 }finally{await fixtureRoot.app.close();await rm(root,{recursive:true,force:true});}
});
it('browser metadata client accepts the real authenticated root capability without selecting or resolving a model',async()=>{
 const {app,resolve}=fixture();
 const fetcher:typeof fetch=async(input,init)=>{
  const result=await app.inject({method:'GET',url:String(input),headers:{...Object.fromEntries(new Headers(init?.headers)),host:'127.0.0.1:3111'}});
  return new Response(result.body,{status:result.statusCode,headers:{'content-type':String(result.headers['content-type'])}});
 };
 try{
  const status=await checkConnection('development-process',operator.token,fetcher);
  expect(status).toMatchObject({projectId:'development-process',selectedId:null,processBuild:'registered-templates-v1'});
  expect(resolve).not.toHaveBeenCalled();
 }finally{await app.close();}
});
it('advertises registered-template availability only in authenticated non-probing health metadata',async()=>{
 const {app,resolve}=fixture();
 try{
  const publicHealth=await app.inject({method:'GET',url:'/api/studio/health'});
  expect(publicHealth.json()).toEqual({ok:true});
  const health=await app.inject({method:'GET',url:'/api/studio/health',headers});
  expect(health.json()).toMatchObject({ok:true,selectedId:null,processBuild:'registered-templates-v1'});
  expect(health.headers['cache-control']).toBe('no-store');expect(resolve).not.toHaveBeenCalled();
 }finally{await app.close();}
});
