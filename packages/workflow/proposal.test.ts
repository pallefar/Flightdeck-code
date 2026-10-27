import {describe,it,expect} from 'vitest';
import {proposeWorkflowGraph,createGraphFromWorkflowSteps} from './proposal';
import {createEmptyGraph} from './graph';
describe('validated draft proposal',()=>{
 it('describes reference-only Resource configs to the planner and accepts a mapped draft without authorizing it',async()=>{
  let system='';const graph=createEmptyGraph();graph.nodes=[{id:'resourceDraft',type:'resource',label:'Resource draft',position:{x:0,y:0},config:{}}];
  const proposal=await proposeWorkflowGraph('Read an approved resource',[],async request=>{system=request.system;return graph;});
  expect(proposal).toMatchObject({status:'proposed',reviewRequired:true,graph});
  expect(system).toContain('resource {resourceId?:UUID,revision?:positive safe integer,functionId?:identifier}');
  expect(system).toContain('Resource parameters come from inputMappings');
  expect(system).toContain('active reviewed read-only REST/MCP');
 });
 it('uses injected structural planner port and rejects unsafe graph output',async()=>{
  let request:unknown;
  const r=await proposeWorkflowGraph('Build intake',[{id:'intake',content:'Keep human review'}],async(q)=>{request=q;return createEmptyGraph();});
  expect(r.status).toBe('proposed');expect(request).toMatchObject({purpose:'draft',attempt:1});expect((request as {system:string}).system).toMatch(/reuse builtins/i);
  const invalid=await proposeWorkflowGraph('Build',[],async()=>({...createEmptyGraph(),nodes:[{id:'unsafe',type:'javascript',label:'Eval',position:{x:0,y:0},config:{code:'eval()'}}]}));expect(invalid.status).toBe('refused');
  expect((await proposeWorkflowGraph('Build',[],async()=>{throw new Error('network');})).status).toBe('refused');
 });
 it('converts legacy steps honestly into manual, human gates, unconfigured steps and output',()=>{
  const g=createGraphFromWorkflowSteps({name:'Review intake',steps:['collect','legal-review'],statutorySteps:['legal-review']});
  expect(g.nodes.map(n=>n.type)).toEqual(['manual','unconfigured','approval','output']);expect(g.nodes[1]!.config.description).toBe('collect');expect(g.nodes[2]!.config.reviewer).toBeUndefined();
 });
});
