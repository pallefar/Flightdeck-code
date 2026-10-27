import {describe,expect,it} from 'vitest';
import {builtinRegistry,configSchemas,type BuiltinType} from '../../packages/workflow/graph';
import {createWorkflowRunner,type ExecutionAdapters} from '../../packages/workflow/engine';
import {chain,mappings} from '../../packages/workflow/test-helpers';
import {WorkflowEditorStore} from './store';
import {createParameterDraft,applyQuickParameterDraft} from './NodeParameters';
import {blockControlProfile} from './block-controls';

const quickKeys:Record<BuiltinType,readonly string[]>={
 manual:[],set:['fields'],branch:['field','operator','value'],output:[],
 http:['url','method'],llm:['instruction'],resource:['resourceId','functionId'],
 approval:['reviewer'],unconfigured:['description'],
};

describe('builtin block purpose profiles',()=>{
 it('covers exactly the actual registry and schema types with schema-bound quick keys',()=>{
  expect(Object.keys(quickKeys).sort()).toEqual(Object.keys(configSchemas).sort());
  expect(builtinRegistry.map(block=>block.type).sort()).toEqual(Object.keys(quickKeys).sort());
  for(const {type} of builtinRegistry){
   const profile=blockControlProfile(type);
   expect(profile.quickKeys).toEqual(quickKeys[type]);
   expect(Object.keys(profile).sort()).toEqual(['boundary','purpose','quickKeys','title']);
   for(const key of profile.quickKeys)expect(Object.keys(configSchemas[type].shape)).toContain(key);
   expect(profile.title.length).toBeGreaterThan(3);
   expect(profile.purpose.length).toBeGreaterThan(15);
   expect(profile.boundary.length).toBeGreaterThan(15);
  }
  expect(new Set(builtinRegistry.map(({type})=>blockControlProfile(type).purpose)).size).toBe(9);
 });
 it.each([
  ['manual',/original.*seed/i,/no stored parameters/i],
  ['set',/typed.*merge/i,/no.*code/i],
  ['branch',/true.*false/i,/JSON/i],
  ['output',/incoming data/i,/mapping/i],
  ['http',/trusted HTTP/i,/credential.*reference/i],
  ['llm',/trusted model/i,/no.*tools/i],
  ['resource',/reviewed.*function/i,/not.*grant/i],
  ['approval',/independent.*human/i,/cannot.*approv/i],
  ['unconfigured',/placeholder/i,/blocked/i],
 ] as const)('describes the real %s role and boundary',(type,purpose,boundary)=>{
  expect(blockControlProfile(type).purpose).toMatch(purpose);
  expect(blockControlProfile(type).boundary).toMatch(boundary);
 });
});

describe('purpose metadata matches the actual engine, not a new execution model',()=>{
 it('manual returns the original seed, while set merges typed fields into the incoming object',async()=>{
  const seed={count:1,original:'kept'},manual=chain(['manual','output']);
  expect((await createWorkflowRunner(manual).run(seed)).output).toEqual(seed);
  expect(configSchemas.manual.safeParse({seed:{stored:true}}).success).toBe(false);
  const store=new WorkflowEditorStore(chain(['manual','set','output'])),graph=store.getSnapshot().graph,node=graph.nodes[1]!;
  const draft=createParameterDraft(graph,node);draft.rows=[{name:'count',type:'number',value:'2'},{name:'ready',type:'boolean',value:'true'}];
  expect(applyQuickParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};})).toEqual({ok:true});
  expect((await createWorkflowRunner(store.getSnapshot().graph).run(seed)).output).toEqual({count:2,original:'kept',ready:true});
  expect(seed).toEqual({count:1,original:'kept'});
 });
 it('quick condition edits select opposite actual true/false paths, not two generic transformations',async()=>{
  const graph=chain(['manual','branch','set','set','output']);
  graph.nodes[2]!.config={fields:{path:'yes'}};graph.nodes[3]!.config={fields:{path:'no'}};
  graph.edges=[{id:'in',source:'n0',target:'n1'},{id:'yes',source:'n1',target:'n2',sourcePort:'true'},{id:'no',source:'n1',target:'n3',sourcePort:'false'},{id:'yesOut',source:'n2',target:'n4'},{id:'noOut',source:'n3',target:'n4'}];
  const store=new WorkflowEditorStore(graph),node=graph.nodes[1]!,draft=createParameterDraft(graph,node);
  draft.config={...draft.config,field:'ready',operator:'equals',valueText:'true'};
  expect(applyQuickParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};})).toEqual({ok:true});
  const runner=createWorkflowRunner(store.getSnapshot().graph);
  for(const ready of [true,false]){
   const run=await runner.run({ready});expect(run.status).toBe('completed');expect(run.output).toEqual({ready,path:ready?'yes':'no'});
   expect(run.trace.find(entry=>entry.nodeId==='n1')?.details?.selectedPort).toBe(ready?'true':'false');
   expect(run.trace.find(entry=>entry.nodeId===(ready?'n3':'n2'))?.status).toBe('skipped');
  }
 });
 it('output has no stored parameters but declarative input mapping meaningfully shapes its incoming data',async()=>{
  const graph=chain(['manual','output']);
  expect((await createWorkflowRunner(graph).run({original:'incoming'})).output).toEqual({original:'incoming'});
  expect(configSchemas.output.safeParse({result:'invented'}).success).toBe(false);
  mappings(graph,1,[{target:'selected',source:{kind:'input',path:['original']}}]);
  expect((await createWorkflowRunner(graph).run({original:'incoming',omit:true})).output).toEqual({selected:'incoming'});
 });
 it('quick reviewer settings still pause for independent human authorization and do not approve',async()=>{
  const store=new WorkflowEditorStore(chain(['manual','approval','output'])),graph=store.getSnapshot().graph,node=graph.nodes[1]!;
  const draft=createParameterDraft(graph,node);draft.config.reviewer='Independent reviewer';
  expect(applyQuickParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};})).toEqual({ok:true});
  let verifications=0;
  // DEVELOPMENT nonnetwork verifier fixture; not a real authenticated review.
  const runner=createWorkflowRunner(store.getSnapshot().graph,{authorizeHuman:async()=>{verifications++;return true;}},{initiator:'Requester'});
  const pause=await runner.run({request:'Review me'});expect(pause.status).toBe('paused');expect(verifications).toBe(0);
  expect((await runner.resume(pause,{humanName:'Requester',proof:null})).status).toBe('blocked');expect(verifications).toBe(0);
  expect((await runner.resume(pause,{humanName:'Independent reviewer',proof:null})).output).toEqual({request:'Review me'});expect(verifications).toBe(1);
 });
 it('a quick placeholder description is saved as a draft but execution remains blocked',async()=>{
  const graph=chain(['manual','unconfigured','output']);graph.nodes[1]!.config={description:'Draft'};
  const store=new WorkflowEditorStore(graph),node=graph.nodes[1]!,draft=createParameterDraft(graph,node);draft.config.description='A description, not implementation';
  expect(applyQuickParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};})).toEqual({ok:true});
  const run=await createWorkflowRunner(store.getSnapshot().graph).run({incoming:true});
  expect(run.status).toBe('blocked');expect(run.trace.find(entry=>entry.nodeId==='n1')?.details?.errorCode).toBe('CONFIG_REQUIRED');expect(run.output).toBe(null);
 });
 it('DEVELOPMENT-only HTTP / model / resource ports dispatch once each through nonnetwork trusted fixtures, not providers',async()=>{
  const graph=chain(['manual','http','llm','resource','output']);
  const reference={resourceId:'123e4567-e89b-42d3-a456-426614174000',revision:2,functionId:'reviewed_read'};
  graph.nodes[1]!.config={url:'https://example.com',method:'GET',service:'generic',credentialRef:'developmentVault',body:{message:'fixture'}};
  graph.nodes[2]!.config={instruction:'Initial fixture instruction',model:'development-model'};
  graph.nodes[3]!.config={...reference};
  const store=new WorkflowEditorStore(graph);
  for(const [id,key,value] of [['n1','method','POST'],['n2','instruction','Inspect fixture input'],['n3','functionId','reviewed_other']] as const){
   const current=store.getSnapshot().graph,node=current.nodes.find(entry=>entry.id===id)!,draft=createParameterDraft(current,node);draft.config[key]=value;
   expect(applyQuickParameterDraft(current,node,draft,config=>{store.updateNode(id,{config});return {ok:true};})).toEqual({ok:true});
  }
  const calls={http:0,llm:0,resource:0};const observed:Record<string,unknown>={};
  const adapters:ExecutionAdapters={
   http:async request=>{calls.http++;observed.http=request;return {fixture:'http-port'};},
   llm:async request=>{calls.llm++;observed.llm=request;return {fixture:'model-port'};},
   resource:async request=>{calls.resource++;observed.resource=request;return {fixture:'resource-port'};},
  };
  const run=await createWorkflowRunner(store.getSnapshot().graph,adapters).run({original:'seed'});
  expect(run.status).toBe('completed');expect(run.output).toEqual({fixture:'resource-port'});expect(calls).toEqual({http:1,llm:1,resource:1});
  expect(observed.http).toEqual({url:'https://example.com',method:'POST',credentialRef:'developmentVault',body:{message:'fixture'},input:{original:'seed'},signal:expect.any(AbortSignal)});
  expect(observed.llm).toEqual({instruction:'Inspect fixture input',model:'development-model',input:{fixture:'http-port'},signal:expect.any(AbortSignal)});
  expect(observed.resource).toEqual({...reference,functionId:'reviewed_other',parameters:{fixture:'model-port'},signal:expect.any(AbortSignal)});
  // HTTP service is stored metadata only, and never becomes an invented request field.
  expect(observed.http).not.toHaveProperty('service');
 });
 it.each([
  ['http',{url:'https://example.com',credentialRef:'developmentVault'},'HTTP adapter unconfigured'],
  ['llm',{instruction:'Fixture instruction'},'LLM adapter unconfigured'],
  ['resource',{resourceId:'123e4567-e89b-42d3-a456-426614174000',revision:2,functionId:'reviewed_read'},'Resource adapter unconfigured'],
 ] as const)('has no %s provider or adapter fallback when the trusted port is absent',async(type,config,reason)=>{
  const graph=chain(['manual',type,'output']);graph.nodes[1]!.config={...config};
  const run=await createWorkflowRunner(graph).run();expect(run.status).toBe('blocked');expect(run.reason).toBe(reason);
 });
});
