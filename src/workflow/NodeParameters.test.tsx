import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {createEmptyGraph, type Graph} from '../../packages/workflow/graph';
import {createWorkflowRunner} from '../../packages/workflow/engine';
import {WorkflowEditorStore} from './store';
import {NodeSettings} from './WorkflowEditor';
import {NodeParameters, createParameterDraft, applyParameterDraft, parameterDraftJson} from './NodeParameters';

it('saves typed Resource references through the store and executes mapped input with a trusted test adapter', async()=>{
 const store=new WorkflowEditorStore(fixture('resource'));const graph=store.getSnapshot().graph;const node=graph.nodes[1]!;
 const draft=createParameterDraft(graph,node);
 draft.config={resourceId:'123e4567-e89b-42d3-a456-426614174000',revision:'2',functionId:'reviewed_read'};
 expect(applyParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};})).toEqual({ok:true});
 const saved=store.getSnapshot().graph;expect(saved.nodes[1]!.config.revision).toBe(2);
 store.updateNode(node.id,{inputMappings:[{target:'selection',source:{kind:'input',path:['nested']}},{target:'limit',source:{kind:'literal',value:10}}]});
 let observed:unknown;
 const run=await createWorkflowRunner(store.getSnapshot().graph,{resource:async request=>{observed=request.parameters;return {fixture:'real-adapter-output'};}}).run({nested:{title:'selected'}});
 expect(observed).toEqual({selection:{title:'selected'},limit:10});expect(run.output).toEqual({fixture:'real-adapter-output'});
 const html=renderToStaticMarkup(createElement(NodeParameters,{graph:saved,node:saved.nodes[1]!,update:()=>({ok:true as const})}));
 for(const label of ['Resource ID','Active resource revision','Function ID','Resources library','independent server review','No secrets or model overrides'])expect(html).toContain(label);
 expect(html).toContain('type="number"');expect(html).not.toContain('HTTP URL');expect(html).not.toContain('Credential reference');
});

it('validates all Resource reference controls, preserves incomplete drafts and rejects arbitrary advanced destination settings', async()=>{
 const graph=fixture('resource');const node=graph.nodes[1]!;const draft=createParameterDraft(graph,node);
 const valid={resourceId:'123e4567-e89b-42d3-a456-426614174000',revision:'2',functionId:'reviewed_read'};
 for(const bad of [{resourceId:'not-uuid'},{resourceId:' '+valid.resourceId},{functionId:'read()'},{functionId:' read'},{revision:'0'},{revision:'1.1'},{revision:'-1'},{revision:'1e2'},{revision:'02'},{revision:' 2'},{revision:'9007199254740992'}]){
  draft.config={...valid,...bad};let called=false;expect(applyParameterDraft(graph,node,draft,()=>{called=true;return {ok:true};}).ok).toBe(false);expect(called).toBe(false);
 }
 draft.config={resourceId:valid.resourceId};let saved:Record<string,unknown>|undefined;
 expect(applyParameterDraft(graph,node,draft,config=>{saved=config;return {ok:true};})).toEqual({ok:true});expect(saved).toEqual({resourceId:valid.resourceId});
 const run=await createWorkflowRunner({...graph,nodes:graph.nodes.map(n=>n.id===node.id?{...n,config:{resourceId:valid.resourceId}}:n)}).run();expect(run.status).toBe('blocked');
 draft.mode='json';
 for(const extra of [{url:'https://example.com'},{headers:{Accept:'text/plain'}},{credentialRef:'vault'},{parameters:{stored:true}},{actor:'Reviewer'},{model:'override'},{revision:'2'}]){
  draft.advanced=JSON.stringify({...valid,revision:2,...extra});expect(applyParameterDraft(graph,node,draft,()=>({ok:true})).ok).toBe(false);
 }
 draft.advanced='{}';expect(applyParameterDraft(graph,node,draft,()=>({ok:true}))).toEqual({ok:true});
});

function fixture(type = 'set', config = {}): Graph {
  return {...createEmptyGraph(), nodes: [
    {id:'start', type:'manual', label:'Start', position:{x:0,y:0}, config:{}},
    {id:'edit', type, label:'Edit', position:{x:250,y:0}, config},
    {id:'end', type:'output', label:'End', position:{x:500,y:0}, config:{}},
  ], edges:[{id:'first',source:'start',target:'edit'}, {id:'last',source:'edit',target:'end'}]};
}

it('ignores an unused equality value when switching a condition to exists', async () => {
  const graph=fixture('branch',{field:'ready',operator:'equals',value:true});
  graph.edges[1]!.sourcePort='true';
  const node=graph.nodes[1]!;const draft=createParameterDraft(graph,node);
  draft.config.operator='exists';draft.config.valueText='unfinished JSON';
  const store=new WorkflowEditorStore(graph);
  expect(applyParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};}).ok).toBe(true);
  expect((await createWorkflowRunner(store.getSnapshot().graph).run({ready:false})).status).toBe('completed');
});

it('bounds nested JSON and rejects unsafe HTTP credentials before persisting', () => {
  const graph=fixture();const node=graph.nodes[1]!;const draft=createParameterDraft(graph,node);
  draft.rows=[{name:'items',type:'array',value:JSON.stringify(Array(101).fill(1))}];
  expect(applyParameterDraft(graph,node,draft,()=>({ok:true})).ok).toBe(false);
  draft.rows=[{name:'items',type:'array',value:' '.repeat(20001)+'[]'}];
  expect(applyParameterDraft(graph,node,draft,()=>({ok:true})).ok).toBe(false);
  const http=fixture('http');const httpNode=http.nodes[1]!;const httpDraft=createParameterDraft(http,httpNode);
  for(const bad of [
    {url:'http://example.com'}, {url:'https://example.com?key=hidden'},
    {url:'https://user:pass@example.com'}, {credentialRef:'raw credential with spaces'},
    {bodyText:'{"password":"hidden"}'}, {method:'TRACE'}, {service:'invented'},
  ]) {
    httpDraft.config={url:'https://example.com',credentialRef:'safeVault',method:'GET',...bad};
    expect(applyParameterDraft(http,httpNode,httpDraft,()=>({ok:true})).ok).toBe(false);
  }
});

it('preserves all six field value types and validates manual/output JSON strictly', async () => {
  const store=new WorkflowEditorStore(fixture());const graph=store.getSnapshot().graph;const node=graph.nodes[1]!;
  const draft=createParameterDraft(graph,node);
  draft.rows=[
    {name:'text',type:'string',value:'123'}, {name:'quantity',type:'number',value:'1.5'},
    {name:'flag',type:'boolean',value:'false'}, {name:'empty',type:'null',value:''},
    {name:'details',type:'object',value:'{"nested":true}'}, {name:'list',type:'array',value:'[1,"two"]'},
  ];
  expect(applyParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};}).ok).toBe(true);
  expect((await createWorkflowRunner(store.getSnapshot().graph).run()).output).toEqual({text:'123',quantity:1.5,flag:false,empty:null,details:{nested:true},list:[1,'two']});
  for (const type of ['manual','output']) {
    const graph=fixture(type);const node=graph.nodes[1]!;const draft=createParameterDraft(graph,node);
    draft.mode='json';draft.advanced='{"invented":true}';
    expect(applyParameterDraft(graph,node,draft,()=>({ok:true})).ok).toBe(false);
  }
});

it('carries unsaved typed edits into Advanced JSON without saving and rejects inline secrets before update', () => {
  const graph=fixture('llm');const node=graph.nodes[1]!;
  const draft=createParameterDraft(graph,node);draft.config.instruction='Summarize this input';
  expect(JSON.parse(parameterDraftJson(graph,node,draft))).toEqual({instruction:'Summarize this input'});
  expect(node.config).toEqual({});
  draft.config.instruction='Bearer private-secret';
  let called=false;
  const result=applyParameterDraft(graph,node,draft,()=>{called=true;return {ok:true};});
  expect(result.ok).toBe(false);expect(called).toBe(false);
});

it('integrates typed parameters with existing inspector metadata and synchronizes saved undo/redo configs', () => {
  const store = new WorkflowEditorStore(fixture('llm',{instruction:'Original'}));
  const render = () => {
    const graph=store.getSnapshot().graph;
    return renderToStaticMarkup(createElement(NodeSettings,{graph,node:graph.nodes[1]!,hint:'Hint',update:()=>({ok:true as const})}));
  };
  expect(render()).toContain('Node label');
  expect(render()).toContain('Instruction');
  expect(render()).toContain('Saved settings');
  store.updateNode('edit',{config:{instruction:'Revised'}});
  expect(render()).toContain('Revised');
  store.undo();expect(render()).toContain('Original');
  store.redo();expect(render()).toContain('Revised');
});

it('saves reviewer changes and pauses without granting approval', async () => {
  const store=new WorkflowEditorStore(fixture('approval'));
  const graph=store.getSnapshot().graph;const node=graph.nodes[1]!;
  const draft=createParameterDraft(graph,node);
  draft.config={reviewer:'Independent reviewer',reason:'Check request'};
  expect(applyParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};}).ok).toBe(true);
  const runner=createWorkflowRunner(store.getSnapshot().graph,{}, {initiator:'Requester'});
  const paused=await runner.run({request:'Review me'});
  expect(paused.status).toBe('paused');
  expect((await runner.resume(paused,{humanName:'Requester',proof:null})).status).toBe('blocked');
});

it('saves HTTP body and branch JSON values through typed controls and remains fail closed', async () => {
  for (const type of ['http','branch']) {
    const graph = fixture(type);
    if (type==='branch') graph.edges[1]!.sourcePort='true';
    const store = new WorkflowEditorStore(graph);
    const node = store.getSnapshot().graph.nodes[1]!;
    const draft = createParameterDraft(graph,node);
    draft.config = type==='http'
      ? {...draft.config,url:'https://example.com',credentialRef:'vaultRef',bodyText:'{"message":"hello"}'}
      : {...draft.config,field:'ready',operator:'equals',valueText:'true'};
    expect(applyParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config});return {ok:true};})).toEqual({ok:true});
    const saved = store.getSnapshot().graph;
    expect(saved.nodes[1]!.config).not.toHaveProperty('bodyText');
    expect(saved.nodes[1]!.config).not.toHaveProperty('valueText');
    const run = await createWorkflowRunner(saved).run({ready:true});
    expect(run.status).toBe(type==='http'?'blocked':'completed');
    if(type==='http') {
      expect(saved.nodes[1]!.config.body).toEqual({message:'hello'});
      expect(run.reason).toBe('HTTP adapter unconfigured');
    } else expect(run.output).toEqual({ready:true});
  }
});

it('edits custom effective settings while preserving untouched inheritance and validates advanced overrides', () => {
  const graph = fixture('wrapped',{});
  graph.customBlocks=[{id:'wrapped',label:'Wrapped',baseType:'http',description:'Reviewed',defaults:{url:'https://example.com',method:'POST',credentialRef:'teamVault'}}];
  const node = graph.nodes[1]!;
  const draft = createParameterDraft(graph,node);
  expect(draft.config.method).toBe('POST');
  draft.config.method='PATCH';
  let saved:unknown;
  expect(applyParameterDraft(graph,node,draft,config=>{saved=config;return {ok:true};})).toEqual({ok:true});
  expect(saved).toEqual({method:'PATCH'});
  draft.mode='json';draft.advanced='{"method":"INVALID"}';
  expect(applyParameterDraft(graph,node,draft,()=>({ok:true})).ok).toBe(false);
  draft.advanced='{}';
  expect(applyParameterDraft(graph,node,draft,config=>{saved=config;return {ok:true};}).ok).toBe(true);
  expect(saved).toEqual({});
});

it('rejects secrets, duplicate fields, malformed typed values and reports persistence failures', () => {
  const graph = fixture();const node=graph.nodes[1]!;
  const draft=createParameterDraft(graph,node);
  for (const rows of [
    [{name:'apiKey',type:'string' as const,value:'no'}],
    [{name:'safe',type:'number' as const,value:'"wrong"'}],
    [{name:'same',type:'string' as const,value:'a'},{name:'same',type:'string' as const,value:'b'}],
  ]) {
    draft.rows=rows;
    expect(applyParameterDraft(graph,node,draft,()=>{throw new Error('Should not persist');}).ok).toBe(false);
  }
  draft.rows=[];
  expect(applyParameterDraft(graph,node,draft,()=>({ok:false,error:'Write refused'}))).toEqual({ok:false,error:'Write refused'});
});

describe('per-block controls', () => {
  it.each([
    ['manual', ['Manual input is supplied', 'No stored parameters']],
    ['output', ['Returns incoming data', 'No stored parameters']],
    ['http', ['HTTP URL', 'HTTP method', 'Service', 'Credential reference', 'HTTP body JSON', 'HTTP adapter is not configured']],
    ['llm', ['Instruction', 'Model', 'LLM adapter is not configured']],
    ['branch', ['Condition field', 'Condition operator', 'Condition value JSON']],
    ['approval', ['Reviewer', 'Review reason', 'cannot authorize approval']],
    ['unconfigured', ['Description', 'cannot execute']],
  ])('renders supported parameters for %s without secret or execution controls', (type, labels) => {
    const graph = fixture(type, type==='unconfigured'?{description:'Legacy step'}:{});
    const html = renderToStaticMarkup(createElement(NodeParameters,{graph,node:graph.nodes[1]!,update:()=>({ok:true as const})}));
    for (const label of labels) expect(html).toContain(label);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('API key');
    expect(html).not.toContain('Execute block');
    expect(html).not.toMatch(/<details[^>]*open/);
  });
});

it('edits typed set rows, saves through the real store, exports and executes the merge', async () => {
  const store = new WorkflowEditorStore(fixture());
  const graph = store.getSnapshot().graph;
  const node = graph.nodes[1]!;
  const draft = createParameterDraft(graph,node);
  draft.rows = [{name:'count',type:'number',value:'42'}, {name:'ready',type:'boolean',value:'true'}];
  const result = applyParameterDraft(graph,node,draft,config=>{store.updateNode(node.id,{config}); return {ok:true};});
  expect(result).toEqual({ok:true});
  expect(JSON.parse(store.exportJson()).nodes[1].config.fields).toEqual({count:42,ready:true});
  const run = await createWorkflowRunner(store.getSnapshot().graph).run({original:'kept'});
  expect(run.status).toBe('completed');
  expect(run.output).toEqual({original:'kept',count:42,ready:true});
  const html = renderToStaticMarkup(createElement(NodeParameters,{graph,node,update:()=>({ok:true as const})}));
  expect(html).toContain('Add field');
  expect(html).toContain('Advanced JSON');
  expect(html).toContain('Apply settings');
});
