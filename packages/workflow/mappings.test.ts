import {describe,it,expect} from 'vitest';
import {createWorkflowRunner} from './engine';
import * as publicApi from './index';
import {graphSchema} from './graph';
import {chain,mappings} from './test-helpers';
describe('public mapping contract',()=>{
 it('exports browser-safe mapping schemas and permits the existing safe credentialRef field target',()=>{
  expect(Object.hasOwn(publicApi,'inputMappingSchema')).toBe(true);expect(Object.hasOwn(publicApi,'inputMappingSourceSchema')).toBe(true);
  const g=chain(['manual','output']);mappings(g,1,[{target:'credentialRef',source:{kind:'literal',value:'reference_only'}}]);expect(graphSchema.safeParse(g).success).toBe(true);
 });
});
describe('declarative input mappings',()=>{
 it('replaces incoming input with nested seed, ancestor and literal selections before real set execution',async()=>{
  const g=chain(['manual','set','set','output']);
  mappings(g,2,[{target:'chosen',source:{kind:'input',path:['items',0,'title']}},{target:'previous',source:{kind:'node',nodeId:'n1',path:['answer']}},{target:'literal',source:{kind:'literal',value:{list:[true]}}}]);
  const run=await createWorkflowRunner(g).run({items:[{title:'selected'}],unmapped:'omit'});
  expect(run.status).toBe('completed');expect(run.output).toEqual({chosen:'selected',previous:42,literal:{list:[true]},answer:42});
 });
});
describe('mapping preflight',()=>{
 it.each(['constructor','prototype','__proto__','apiKey','access_token','credential','bad-key'])('rejects unsafe target %s',target=>{
  const g=chain(['manual','output']);mappings(g,1,[{target,source:{kind:'literal',value:true}}]);expect(graphSchema.safeParse(g).success).toBe(false);
 });
 it.each(['__proto__','constructor','prototype','authorization','credentialRef','password',-1,100,1.5])('rejects unsafe path segment %s',segment=>{
  const g=chain(['manual','output']);mappings(g,1,[{target:'safe',source:{kind:'input',path:[segment]}}]);expect(graphSchema.safeParse(g).success).toBe(false);
 });
 it('rejects duplicate targets and nonancestor references before execution',()=>{
  for(const source of [{kind:'node',nodeId:'n1',path:[]},{kind:'node',nodeId:'n2',path:[]},{kind:'node',nodeId:'absent',path:[]}]){
   const g=chain(['manual','set','output']);mappings(g,1,[{target:'safe',source}]);expect(graphSchema.safeParse(g).success).toBe(false);
  }
  const g=chain(['manual','output']);mappings(g,1,[{target:'safe',source:{kind:'literal',value:1}},{target:'safe',source:{kind:'literal',value:2}}]);expect(graphSchema.safeParse(g).success).toBe(false);
 });
 it('forbids even empty mappings on manual and approval gates',()=>{
  const g=chain(['manual','approval','output']);g.nodes[1]!.config={reviewer:'Reviewer'};
  for(const index of [0,1]){const copy=structuredClone(g);mappings(copy,index,[]);expect(graphSchema.safeParse(copy).success).toBe(false);}
 });
});
describe('bounded mapping literals',()=>{
 it('rejects deep, cyclic, accessor, prototype-bearing and oversized literals without recursive parsing',()=>{
  let deep:unknown=true;for(let i=0;i<10000;i++)deep={child:deep};
  const cyclic:Record<string,unknown>={};cyclic.child=cyclic;
  let reads=0;const accessor=Object.defineProperty({},'child',{enumerable:true,get(){reads++;return true;}});
  const oversized=Array.from({length:10},()=> 'é'.repeat(1000));
  class ExecutableArray extends Array {toJSON(){reads++;return [];}}
  for(const value of [deep,cyclic,accessor,new ExecutableArray(),Object.create({inherited:true}),oversized,JSON.parse('{"__proto__":true}'),{password:'secret'}]){
   const g=chain(['manual','output']);mappings(g,1,[{target:'safe',source:{kind:'literal',value}}]);
   expect(()=>graphSchema.safeParse(g)).not.toThrow();expect(graphSchema.safeParse(g).success).toBe(false);
  }
  expect(reads).toBe(0);
 });
 it('bounds mapping count and path depth',()=>{
  const g=chain(['manual','output']);mappings(g,1,Array.from({length:101},(_,i)=>({target:`a${i}`,source:{kind:'literal',value:true}})));expect(graphSchema.safeParse(g).success).toBe(false);
  mappings(g,1,[{target:'safe',source:{kind:'input',path:Array(17).fill('child')}}]);expect(graphSchema.safeParse(g).success).toBe(false);
 });
});
describe('mapped execution',()=>{
 it('blocks array properties and string indices instead of treating them as JSON fields',async()=>{
  for(const path of [['items','length'],['items','0'],['items',1],['missing'],['items',0,'missing']]){
   const g=chain(['manual','output']);mappings(g,1,[{target:'selected',source:{kind:'input',path}}]);
   const run=await createWorkflowRunner(g).run({items:[{title:'x'}]});expect(run.status).toBe('blocked');expect(run.reason).toMatch(/mapping/i);expect(run.output).toBe(null);
  }
 });
 it('distinguishes absent mappings from explicit empty mappings',async()=>{
  const g=chain(['manual','output']);expect((await createWorkflowRunner(g).run({keep:true})).output).toEqual({keep:true});
  mappings(g,1,[]);expect((await createWorkflowRunner(g).run({keep:true})).output).toEqual({});
 });
 it('feeds mapped fields to both branch ports and reviewed wrappers',async()=>{
  const g=chain(['manual','branch','set','output','output']);g.nodes[1]!.config={field:'selected',operator:'equals',value:true};
  g.edges=[{id:'a',source:'n0',target:'n1'},{id:'b',source:'n1',target:'n2',sourcePort:'true'},{id:'c',source:'n2',target:'n3'},{id:'d',source:'n1',target:'n4',sourcePort:'false'}];
  mappings(g,1,[{target:'selected',source:{kind:'input',path:['nested','ok']}}]);
  g.customBlocks=[{id:'enrich',label:'Enrich',baseType:'set',defaults:{fields:{fixed:true}},description:'Reviewed declarative wrapper'}];g.nodes[2]!.type='enrich';g.nodes[2]!.config={};mappings(g,2,[]);
  expect((await createWorkflowRunner(g).run({nested:{ok:true}})).output).toEqual({fixed:true});
  expect((await createWorkflowRunner(g).run({nested:{ok:false}})).output).toEqual({selected:false});
 });
 it('rejects a different branch source statically and an unexecuted ancestor at runtime',async()=>{
  const g=chain(['manual','branch','set','set','output']);g.nodes[1]!.config={field:'ok',operator:'equals',value:true};
  g.edges=[{id:'a',source:'n0',target:'n1'},{id:'b',source:'n1',target:'n2',sourcePort:'true'},{id:'c',source:'n1',target:'n3',sourcePort:'false'},{id:'d',source:'n2',target:'n4'},{id:'e',source:'n3',target:'n4'}];
  mappings(g,3,[{target:'selected',source:{kind:'node',nodeId:'n2',path:[]}}]);expect(graphSchema.safeParse(g).success).toBe(false);
  delete g.nodes[3]!.inputMappings;mappings(g,4,[{target:'selected',source:{kind:'node',nodeId:'n2',path:[]}}]);expect(graphSchema.safeParse(g).success).toBe(true);
  const run=await createWorkflowRunner(g).run({ok:false});expect(run.status).toBe('blocked');expect(run.reason).toMatch(/mapping/i);expect(run.trace.find(t=>t.nodeId==='n2')?.status).toBe('skipped');
 });
 it('passes mapped input separately from explicit HTTP body to an injected fixture adapter',async()=>{
  const g=chain(['manual','http','output']);g.nodes[1]!.config={url:'https://example.com',method:'POST',credentialRef:'fixture',body:{explicit:true}};
  mappings(g,1,[{target:'selected',source:{kind:'input',path:['nested',0]}}]);let observed:unknown;
  const run=await createWorkflowRunner(g,{http:async request=>{observed={input:request.input,body:request.body};return {fixture:'adapter-output'};}}).run({nested:[42],omit:true});
  expect(observed).toEqual({input:{selected:42},body:{explicit:true}});expect(run.output).toEqual({fixture:'adapter-output'});
 });
 it('does not promote inherited or accessor seed fields into mapping sources',async()=>{
  const g=chain(['manual','output']);mappings(g,1,[{target:'selected',source:{kind:'input',path:['nested','value']}}]);
  let reads=0;const accessor=Object.defineProperty({},'value',{enumerable:true,get(){reads++;return 'private';}});
  for(const nested of [Object.create({value:'inherited'}),accessor]){expect((await createWorkflowRunner(g).run({nested})).status).toBe('blocked');}
  expect(reads).toBe(0);
 });
 it('accepts valid shared JSON subtrees without mistaking them for cycles',async()=>{
  const shared={value:42};const g=chain(['manual','output']);mappings(g,1,[{target:'literal',source:{kind:'literal',value:{a:shared,b:shared}}}]);
  expect((await createWorkflowRunner(g).run({a:shared,b:shared})).output).toEqual({literal:{a:{value:42},b:{value:42}}});
 });
 it('keeps original seed and ancestor outputs stable when an injected adapter mutates its request',async()=>{
  const g=chain(['manual','http','output']);g.nodes[1]!.config={url:'https://example.com',method:'GET',credentialRef:'fixture'};
  mappings(g,2,[{target:'seed',source:{kind:'input',path:['nested','value']}},{target:'ancestor',source:{kind:'node',nodeId:'n0',path:['nested','value']}}]);
  const run=await createWorkflowRunner(g,{http:async request=>{((request.input as Record<string,unknown>).nested as Record<string,unknown>).value='mutation';return {fixture:true};}}).run({nested:{value:'original'}});
  expect(run.output).toEqual({seed:'original',ancestor:'original'});
 });
});
