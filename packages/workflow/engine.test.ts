import { describe,it,expect } from 'vitest';
import { createWorkflowRunner } from './engine';
import { createEmptyGraph, type Graph } from './graph';
function chain(types:string[]):Graph {return {...createEmptyGraph(),nodes:types.map((type,i)=>({id:`n${i}`,type,label:type,position:{x:i*250,y:0},config:type==='set'?{fields:{answer:42}}:{}})),edges:types.slice(1).map((_,i)=>({id:`e${i}`,source:`n${i}`,target:`n${i+1}`}))};}
describe('bounded runner',()=>{
 it('executes a real deterministic trace and refuses invalid graphs',async()=>{
  const r=await createWorkflowRunner(chain(['manual','set','output'])).run({input:'x'});
  expect(r.status).toBe('completed');expect(r.output).toEqual({input:'x',answer:42});expect(r.trace.map(t=>t.nodeId)).toEqual(['n0','n1','n2']);
  expect(()=>createWorkflowRunner({...chain(['manual']),edges:[{id:'e',source:'n0',target:'n0'}]})).toThrow();
 });
 it('selects condition ports and skips inactive branches',async()=>{
  const g=chain(['manual','branch','output','output']);g.nodes[1]!.config={field:'ok',operator:'equals',value:true};
  g.edges=[{id:'a',source:'n0',target:'n1'},{id:'b',source:'n1',target:'n2',sourcePort:'true'},{id:'c',source:'n1',target:'n3',sourcePort:'false'}];
  const r=await createWorkflowRunner(g).run({ok:true});expect(r.status).toBe('completed');expect(r.trace.find(t=>t.nodeId==='n3')?.status).toBe('skipped');expect(r.output).toEqual({ok:true});
  const f=await createWorkflowRunner(g).run({ok:false});expect(f.trace.find(t=>t.nodeId==='n2')?.status).toBe('skipped');expect(f.output).toEqual({ok:false});
 });
 it('fails closed for missing credentials/adapters and bounds adapter waits',async()=>{
  const g=chain(['manual','http','output']);g.nodes[1]!.config={url:'https://example.com',method:'GET'};
  expect((await createWorkflowRunner(g).run({})).status).toBe('blocked');
  const adapters={http:async()=>({real:'adapter result'})};
  expect((await createWorkflowRunner(g,adapters).run({})).reason).toMatch(/credential/i);
  g.nodes[1]!.config.credentialRef='crm';
  expect((await createWorkflowRunner(g).run({})).reason).toMatch(/adapter/i);
  expect((await createWorkflowRunner(g,adapters).run({})).output).toEqual({real:'adapter result'});
  expect((await createWorkflowRunner(g,{http:async()=>new Promise(()=>{})},{timeoutMs:10}).run({})).status).toBe('blocked');
 });
 it('pauses at approval and only resumes with independent externally verified human authorization',async()=>{
  const g=chain(['manual','approval','output']);g.nodes[1]!.config={reviewer:'review-team',reason:'Review operation'};
  const runner=createWorkflowRunner(g,{authorizeHuman:async(a)=>a.humanName==='Reviewer'&&a.proof==='verified'},{initiator:'Creator'});
  const paused=await runner.run({answer:42});expect(paused.status).toBe('paused');expect(paused.trace.map(t=>t.nodeId)).toEqual(['n0','n1']);
  expect((await runner.resume(paused,{humanName:'Creator',proof:'verified'})).status).toBe('blocked');
  expect((await runner.resume({...paused},{humanName:'Reviewer',proof:'verified'})).status).toBe('blocked');
  const complete=await runner.resume(paused,{humanName:'Reviewer',proof:'verified'});expect(complete.status).toBe('completed');expect(complete.output).toEqual({answer:42});
  expect((await runner.resume(paused,{humanName:'Reviewer',proof:'verified'})).status).toBe('blocked');
  const noVerifier=createWorkflowRunner(g);expect((await noVerifier.resume(await noVerifier.run({}),{humanName:'Reviewer',proof:'verified'})).status).toBe('blocked');
 });
 it('rejects paths bypassing required human approval before adapters execute',async()=>{
  const g=chain(['manual','approval','http','output']);g.nodes[1]!.config={reviewer:'Review team'};g.nodes[2]!.config={url:'https://example.com',method:'POST',credentialRef:'crm'};
  g.edges.push({id:'bypass',source:'n0',target:'n2'});let calls=0;
  const r=await createWorkflowRunner(g,{http:async()=>{calls++;return {};}}).run({});expect(r.status).toBe('blocked');expect(r.reason).toMatch(/bypass/i);expect(calls).toBe(0);
 });
 it('executes configured custom and LLM blocks with size and step bounds',async()=>{
  const g=chain(['manual','llm','set','output']);g.nodes[1]!.config={instruction:'Classify'};
  g.customBlocks=[{id:'enrich',label:'Enrich',baseType:'set',defaults:{fields:{category:'review'}},description:'Reviewed field mapping'}];g.nodes[2]!.type='enrich';g.nodes[2]!.config={};
  expect((await createWorkflowRunner(g).run({})).status).toBe('blocked');
  const r=await createWorkflowRunner(g,{llm:async q=>({instruction:q.instruction})}).run({});expect(r.output).toEqual({instruction:'Classify',category:'review'});
  expect((await createWorkflowRunner(g,{llm:async()=>({})},{maxSteps:1}).run({})).reason).toMatch(/step limit/i);
  expect((await createWorkflowRunner(g,{llm:async()=>({large:'x'.repeat(150)})},{maxDataBytes:100}).run({})).reason).toMatch(/size limit/i);
 });
 it('blocks incomplete condition execution and non-terminal output nodes',async()=>{
  const g=chain(['manual','branch','output']);g.nodes[1]!.config={field:'missing',operator:'equals'};g.edges[1]!.sourcePort='true';
  expect((await createWorkflowRunner(g).run({})).status).toBe('blocked');
  const malformed=chain(['manual','output','set']);expect((await createWorkflowRunner(malformed).run({})).status).toBe('blocked');
 });
});
export {chain};
