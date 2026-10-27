import {describe,it,expect} from 'vitest';
import {builtinRegistry,configSchemas,graphSchema} from './graph';
import {chain,mappings} from './test-helpers';
import {createWorkflowRunner,type ExecutionAdapters} from './engine';
import type {Json} from './graph';

it('executes a reviewed Resource with real mapped parameters through the injected test adapter',async()=>{
 const g=resourceGraph();mappings(g,1,[{target:'selected',source:{kind:'input',path:['nested',0]}},{target:'ancestor',source:{kind:'node',nodeId:'n0',path:['previous']}},{target:'fixed',source:{kind:'literal',value:{list:[true]}}}]);
 let observed:unknown;const fixtureOutput={fixture:'trusted-adapter-result'};
 const resource:NonNullable<ExecutionAdapters['resource']>=async request=>{observed=request;return fixtureOutput;};
 const run=await createWorkflowRunner(g,{resource}).run({nested:[{title:'selected'}],previous:42,omit:true});
 expect(run.status).toBe('completed');expect(run.output).toEqual(fixtureOutput);
 expect(observed).toEqual({...reference,parameters:{selected:{title:'selected'},ancestor:42,fixed:{list:[true]}},signal:expect.any(AbortSignal)});
 expect(run.trace[1]).toMatchObject({status:'completed',details:{durationMs:expect.any(Number)}});
 expect(run.trace[1]!.details).not.toHaveProperty('input');expect(run.trace[1]!.details).not.toHaveProperty('output');
 fixtureOutput.fixture='later mutation';expect(run.output).toEqual({fixture:'trusted-adapter-result'});
});

describe('Resource safety and execution boundaries',()=>{
 it.each([
  {resourceId:'not-a-uuid'},{resourceId:' 123e4567-e89b-42d3-a456-426614174000'},
  {revision:0},{revision:-1},{revision:1.5},{revision:'2'},{revision:Number.MAX_SAFE_INTEGER+1},
  {functionId:'bad.function'},{functionId:' reviewed_read'},{functionId:'1bad'},
  {url:'https://example.com'},{endpoint:'https://example.com'},{headers:{Accept:'application/json'}},
  {credentialRef:'vaultRef'},{parameters:{stored:true}},{model:'override'},{actor:'Reviewer'},{projectId:'other'},
 ])('rejects malformed references or extra config %j',bad=>{
  const g=resourceGraph();g.nodes[1]!.config={...reference,...bad} as Record<string,Json>;
  expect(graphSchema.safeParse(g).success).toBe(false);
 });
 it('keeps UUID case exact and forbids unreviewed resource custom wrappers',()=>{
  const g=resourceGraph();g.nodes[1]!.config.resourceId=reference.resourceId.toUpperCase();
  expect(graphSchema.parse(g).nodes[1]!.config.resourceId).toBe(reference.resourceId.toUpperCase());
  expect(configSchemas.resource.parse({})).toEqual({});
  const wrapped={...g,customBlocks:[{id:'wrapped',baseType:'resource',label:'Wrapper',defaults:reference,description:'Not approved'}]};
  expect(graphSchema.safeParse(wrapped).success).toBe(false);
 });
 it('preserves Resource input mappings across graph serialization and retains ancestry and literal limits',()=>{
  const g=resourceGraph();mappings(g,1,[{target:'selected',source:{kind:'node',nodeId:'n0',path:['nested']}},{target:'fixed',source:{kind:'literal',value:[1,true]}}]);
  expect(graphSchema.parse(JSON.parse(JSON.stringify(g)))).toEqual(g);
  for(const source of [{kind:'node',nodeId:'n1',path:[]},{kind:'node',nodeId:'n2',path:[]},{kind:'literal',value:Array(101).fill(true)}]){
   mappings(g,1,[{target:'selected',source}]);expect(graphSchema.safeParse(g).success).toBe(false);
  }
 });
 it('blocks incomplete references before calling an adapter and fully configured references without an adapter',async()=>{
  let calls=0;
  for(const config of [{},{resourceId:reference.resourceId},{resourceId:reference.resourceId,revision:2}]){
   const g=resourceGraph();g.nodes[1]!.config=config;
   const run=await createWorkflowRunner(g,{resource:async()=>{calls++;return {};}}).run();
   expect(run.status).toBe('blocked');expect(run.reason).toBe('Resource ID, active revision and function ID required');
   expect(run.trace[1]?.details?.errorCode).toBe('CONFIG_REQUIRED');
  }
  expect(calls).toBe(0);
  const run=await createWorkflowRunner(resourceGraph()).run();expect(run.status).toBe('blocked');
  expect(run.reason).toBe('Resource adapter unconfigured');expect(run.trace[1]?.details?.errorCode).toBe('ADAPTER_UNCONFIGURED');
 });
 it.each(['stale revision','authorization denied','private transport error'])('blocks trusted adapter rejection (%s) without exposing raw errors',async(category)=>{
  const run=await createWorkflowRunner(resourceGraph(),{resource:async()=>{throw new Error(category+' https://private.local secret');}}).run();
  expect(run.status).toBe('blocked');expect(run.output).toBe(null);
  expect(run.reason).toBe('Adapter execution failed; side effects may already have occurred');
  expect(run.trace[1]?.details?.errorCode).toBe('ADAPTER_ERROR');expect(JSON.stringify(run)).not.toContain(category);expect(JSON.stringify(run)).not.toContain('private.local');
 });
 it('aborts a timed-out trusted adapter with bounded payload-free metadata',async()=>{
  let signal:AbortSignal|undefined;
  const run=await createWorkflowRunner(resourceGraph(),{resource:request=>{signal=request.signal;return new Promise<Json>(()=>{});}}, {timeoutMs:5}).run();
  expect(run.status).toBe('blocked');expect(signal?.aborted).toBe(true);expect(run.trace[1]?.details?.errorCode).toBe('ADAPTER_TIMEOUT');
  expect(run.trace[1]?.details?.durationMs).toBeGreaterThanOrEqual(0);expect(run.trace[1]?.details).not.toHaveProperty('input');
 });
 it('isolates seed, literals, ancestors and captured trace from adapter parameter mutations',async()=>{
  const g=resourceGraph();mappings(g,1,[{target:'selected',source:{kind:'node',nodeId:'n0',path:['nested']}},{target:'literal',source:{kind:'literal',value:{value:'fixed'}}}]);
  mappings(g,2,[{target:'seed',source:{kind:'input',path:['nested']}},{target:'ancestor',source:{kind:'node',nodeId:'n0',path:['nested']}},{target:'result',source:{kind:'node',nodeId:'n1',path:[]}}]);
  const seed={nested:{value:'original'}};
  const run=await createWorkflowRunner(g,{resource:async request=>{
   const parameters=request.parameters as {selected:{value:string};literal:{value:string}};
   parameters.selected.value='mutated';parameters.literal.value='mutated';return {fixture:true};
  }},{captureData:true}).run(seed);
  expect(run.output).toEqual({seed:{value:'original'},ancestor:{value:'original'},result:{fixture:true}});
  expect(seed).toEqual({nested:{value:'original'}});expect(g.nodes[1]!.inputMappings![1]!.source).toEqual({kind:'literal',value:{value:'fixed'}});
  expect(run.trace[1]?.details?.input).toEqual({selected:{value:'original'},literal:{value:'fixed'}});
 });
 it('rejects invalid or oversized adapter outputs and nonobject function parameters',async()=>{
  for(const output of [{secret:'private'},'x'.repeat(2001),{items:Array(101).fill(1)}]){
   const run=await createWorkflowRunner(resourceGraph(),{resource:async()=>output}).run();expect(run.status).toBe('blocked');expect(run.trace[1]?.details?.errorCode).toBe('DATA_INVALID');
  }
  const g=chain(['manual','llm','resource','output']);g.nodes[1]!.config={instruction:'Test fixture string output'};g.nodes[2]!.config={...reference};
  let calls=0;const run=await createWorkflowRunner(g,{llm:async()=> 'scalar',resource:async()=>{calls++;return {};}}).run();
  expect(calls).toBe(0);expect(run.trace[2]?.details?.errorCode).toBe('INPUT_INVALID');
 });
 it('keeps independent human gates unavoidable before Resource invocation',async()=>{
  const g=chain(['manual','approval','resource','output']);g.nodes[1]!.config={reviewer:'Independent'};g.nodes[2]!.config={...reference};
  let calls=0;const adapters:ExecutionAdapters={resource:async()=>{calls++;return {fixture:true};},authorizeHuman:async()=>true};
  const runner=createWorkflowRunner(g,adapters,{initiator:'Requester'});const paused=await runner.run();expect(paused.status).toBe('paused');expect(calls).toBe(0);
  expect((await runner.resume(paused,{humanName:'Requester',proof:null})).status).toBe('blocked');expect(calls).toBe(0);
  expect((await runner.resume(paused,{humanName:'Independent',proof:null})).output).toEqual({fixture:true});expect(calls).toBe(1);
  g.edges.push({id:'bypass',source:'n0',target:'n2'});
  expect((await createWorkflowRunner(g,adapters,{initiator:'Requester'}).run()).reason).toBe('Workflow path would bypass required human approval');expect(calls).toBe(1);
 });
});

const reference={resourceId:'123e4567-e89b-42d3-a456-426614174000',revision:2,functionId:'reviewed_read'};
function resourceGraph(){const g=chain(['manual','resource','output']);g.nodes[1]!.config={...reference};return g;}

describe('Resource reference schema',()=>{
 it('accepts reference-only drafts and mapped reviewed references without coercing identifiers',()=>{
  expect(builtinRegistry.find(b=>b.type==='resource')).toMatchObject({defaults:{}});
  const g=resourceGraph();mappings(g,1,[{target:'selected',source:{kind:'input',path:['nested',0]}},{target:'fixed',source:{kind:'literal',value:{list:[true]}}}]);
  expect(graphSchema.parse(g)).toEqual(g);
  g.nodes[1]!.config={};expect(graphSchema.safeParse(g).success).toBe(true);
  for(const config of [{resourceId:reference.resourceId},{revision:2},{functionId:'reviewed_read'}]){g.nodes[1]!.config=config;expect(graphSchema.safeParse(g).success).toBe(true);}
 });
});
