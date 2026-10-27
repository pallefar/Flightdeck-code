import {describe,it,expect} from 'vitest';
import {createWorkflowRunner,type HumanAuthorization} from './engine';
import {createEmptyGraph,type Graph} from './graph';
import {workflowCheckpointSchema,WORKFLOW_CHECKPOINT_MAX_BYTES,canonicalWorkflowValue} from './checkpoint';
function fixture():Graph {return {...createEmptyGraph(),nodes:['manual','resource','approval','output'].map((type,i)=>({id:`n${i}`,type,label:type,position:{x:i*200,y:0},config:type==='resource'?{resourceId:'123e4567-e89b-12d3-a456-426614174000',revision:1,functionId:'read'}:type==='approval'?{reviewer:'Review team'}:{}})),edges:[0,1,2].map(i=>({id:`e${i}`,source:`n${i}`,target:`n${i+1}`}))};}
const options={initiator:'Creator'};
const human={humanName:'Reviewer',proof:'independently verified'};
describe('restart-safe approval checkpoint',()=>{
 it('restores actual resource output without replay and still requires independent verification',async()=>{
  let calls=0;const adapters={resource:async()=>({actual:++calls}),authorizeHuman:async(a:HumanAuthorization)=>a.proof===human.proof};
  const g=fixture(),first=createWorkflowRunner(g,adapters,options),paused=await first.run({seed:'original'});
  const saved=JSON.parse(JSON.stringify(first.checkpoint(paused)));
  const next=createWorkflowRunner(g,adapters,options),restored=next.restore(saved);
  expect(restored.status).toBe('paused');expect(calls).toBe(1);
  expect((await next.resume(restored,{...human,humanName:'Creator'})).status).toBe('blocked');
  expect((await next.resume(restored,{...human,proof:'fake'})).status).toBe('blocked');
  expect((await next.resume(restored,human)).output).toEqual({actual:1});expect(calls).toBe(1);
  expect(()=>next.checkpoint(restored)).toThrow();
 });
 it('rejects inconsistent cursor, trace, values and forged pending input',async()=>{
  const g=fixture(),runner=createWorkflowRunner(g,{resource:async()=>({actual:1})},options);
  const c=runner.checkpoint(await runner.run({seed:'original'}));
  const corruptions=[
   (x:typeof c)=>{x.index=1;},(x:typeof c)=>{x.steps=1;},
   (x:typeof c)=>{x.trace[0]!.status='skipped';},(x:typeof c)=>{x.trace[0]!.nodeId='n3';},
   (x:typeof c)=>{x.values.push(['n3',{}]);},(x:typeof c)=>{x.values.push(x.values[0]!);},
   (x:typeof c)=>{x.values.shift();},(x:typeof c)=>{x.values[0]![1]={fake:true};},
   (x:typeof c)=>{x.pending.data={fake:true};},(x:typeof c)=>{x.output={fake:true};},
   (x:typeof c)=>{x.branches.push(['n1','true']);},(x:typeof c)=>{x.trace[1]!.humanName='Forged';},
  ];
  for(const mutate of corruptions){const copy=structuredClone(c);mutate(copy);expect(()=>runner.restore(copy)).toThrow();}
 });
 it('binds exact graph configuration, mappings, edges, gate and effective options',async()=>{
  const g=fixture(),runner=createWorkflowRunner(g,{resource:async()=>({actual:1})},options),c=runner.checkpoint(await runner.run({}));
  const changes=[(x:Graph)=>{x.nodes[1]!.config.revision=2;},(x:Graph)=>{x.nodes[1]!.type='set';x.nodes[1]!.config={fields:{}};},(x:Graph)=>{x.nodes[2]!.config.reviewer='Someone else';},(x:Graph)=>{x.nodes[2]!.config.reason='Changed review';},(x:Graph)=>{x.nodes[3]!.inputMappings=[];},(x:Graph)=>{x.edges[1]!.source='n0';},(x:Graph)=>{x.nodes[0]!.label='Changed';}];
  for(const mutate of changes){const changed=structuredClone(g);mutate(changed);expect(()=>createWorkflowRunner(changed,{},options).restore(c)).toThrow();}
  for(const changed of [{initiator:'Other'},{initiator:'Creator',maxSteps:99},{initiator:'Creator',maxDataBytes:101},{initiator:'Creator',timeoutMs:100},{initiator:'Creator',captureData:true}])expect(()=>createWorkflowRunner(g,{},changed).restore(c)).toThrow();
 });
 it('rejects unsafe shapes and bounded corrupt envelopes before getters execute',async()=>{
  const runner=createWorkflowRunner(fixture(),{resource:async()=>({actual:1})},options),c=runner.checkpoint(await runner.run({}));let getters=0;
  const accessor=structuredClone(c);Object.defineProperty(accessor,'seed',{enumerable:true,get(){getters++;return {};}});
  const inherited=Object.assign(Object.create({evil:true}),c);
  const bad=[accessor,inherited,{...c,version:2},{...c,trusted:true},{...c,proof:'fake'},{...c,requestId:'fake'}, {...c,graphBinding:'x'.repeat(WORKFLOW_CHECKPOINT_MAX_BYTES)}, {...c,values:Array(101).fill(['n0',{}])},{...c,pending:{...c.pending,data:{large:'x'.repeat(2001)}}},JSON.parse('{"__proto__":{}}')];
  for(const value of bad)expect(()=>runner.restore(value)).toThrow();expect(getters).toBe(0);
  expect(workflowCheckpointSchema.safeParse(c).success).toBe(true);
  const cycle=structuredClone(c) as unknown as Record<string,unknown>;cycle.seed=cycle;expect(()=>runner.restore(cycle)).toThrow();
 });
 it('requires genuine current pause instances and does not leak proof or diagnostic payloads by default',async()=>{
  const runner=createWorkflowRunner(fixture(),{resource:async()=>({actual:1}),authorizeHuman:async()=>true},options),p=await runner.run({email:'private@example.test'});
  expect(()=>runner.checkpoint({...p})).toThrow();expect(()=>createWorkflowRunner(fixture()).checkpoint(p)).toThrow();
  const c=runner.checkpoint(p);expect(c.trace).toEqual(p.trace);expect(c.trace.every(t=>t.details?.input===undefined&&t.details?.output===undefined)).toBe(true);
  p.trace[0]!.nodeId='tampered';expect(runner.checkpoint(p).trace[0]!.nodeId).toBe('n0');
  await runner.resume(p,human);expect(()=>runner.checkpoint(p)).toThrow();expect(JSON.stringify(c)).not.toContain('independently verified');
 });
 it('restores repeated gates, mapped ancestor values and branch choices without skipping reviews',async()=>{
  const g=fixture();g.nodes[1]!.inputMappings=[{target:'original',source:{kind:'input',path:['original']}}];
  g.nodes[3]!.type='branch';g.nodes[3]!.config={field:'actual',operator:'equals',value:1};
  g.nodes.push({id:'skip',type:'set',label:'skip',position:{x:0,y:0},config:{fields:{bad:true}}},{id:'second',type:'approval',label:'second',position:{x:0,y:0},config:{reviewer:'Second reviewer'}},{id:'out',type:'output',label:'out',position:{x:0,y:0},config:{},inputMappings:[{target:'actual',source:{kind:'node',nodeId:'n1',path:['actual']}},{target:'original',source:{kind:'input',path:['original']}}]});
  g.edges.push({id:'falseEdge',source:'n3',target:'skip',sourcePort:'false'},{id:'trueEdge',source:'n3',target:'second',sourcePort:'true'},{id:'skipEdge',source:'skip',target:'second'},{id:'outEdge',source:'second',target:'out'});
  let calls=0,verified=0;const adapters={resource:async(q:{parameters:unknown})=>{expect(q.parameters).toEqual({original:'seed'});return {actual:++calls};},authorizeHuman:async()=>{verified++;return true;}};
  const first=createWorkflowRunner(g,adapters,options),p=await first.run({original:'seed'});
  const next=createWorkflowRunner(g,adapters,options),second=await next.resume(next.restore(JSON.parse(JSON.stringify(first.checkpoint(p)))),human);
  expect(second.pendingNodeId).toBe('second');expect(calls).toBe(1);expect(verified).toBe(1);
  const c=next.checkpoint(second);expect(c.branches).toEqual([['n3','true']]);expect(c.trace.find(t=>t.nodeId==='skip')?.status).toBe('skipped');
  const corrupt=structuredClone(c);corrupt.branches[0]![1]='false';expect(()=>createWorkflowRunner(g,adapters,options).restore(corrupt)).toThrow();
  const changed=structuredClone(g);changed.nodes[3]!.config.value=2;expect(()=>createWorkflowRunner(changed,adapters,options).restore(c)).toThrow();
  const final=createWorkflowRunner(g,adapters,options),r=final.restore(c);expect(verified).toBe(1);expect((await final.resume(r,human)).output).toEqual({actual:1,original:'seed'});expect(verified).toBe(2);expect(calls).toBe(1);
 });
 it('consumes a restored pause before concurrent downstream side effects',async()=>{
  const g=fixture();g.nodes[1]!.type='set';g.nodes[1]!.config={fields:{}};g.nodes[3]!.type='resource';g.nodes[3]!.config=fixture().nodes[1]!.config;
  g.nodes.push({id:'out',type:'output',label:'out',position:{x:0,y:0},config:{}});g.edges.push({id:'outEdge',source:'n3',target:'out'});
  let effects=0;const first=createWorkflowRunner(g,{},options),c=first.checkpoint(await first.run({}));
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
  const next=createWorkflowRunner(g,{authorizeHuman:async()=>{await barrier;return true;},resource:async()=>({actual:++effects})},options),p=next.restore(c);
  const resumes=[next.resume(p,human),next.resume(p,human)];release();const results=await Promise.all(resumes);expect(results.filter(r=>r.status==='completed')).toHaveLength(1);expect(effects).toBe(1);expect(()=>next.checkpoint(p)).toThrow();
 });
 it('rejects fabricated checkpoints for graphs bypassing a required gate',async()=>{
  const g=fixture(),runner=createWorkflowRunner(g,{resource:async()=>({actual:1})},options),c=runner.checkpoint(await runner.run({}));
  g.edges.push({id:'bypass',source:'n1',target:'n3'});c.graphBinding=canonicalWorkflowValue(g);
  expect(()=>createWorkflowRunner(g,{},options).restore(c)).toThrow();
 });
 it('retains opt-in diagnostic trace and detached state across restore',async()=>{
  const g=fixture(),settings={...options,captureData:true},adapters={resource:async()=>({actual:1}),authorizeHuman:async()=>true};
  const first=createWorkflowRunner(g,adapters,settings),p=await first.run({plain:'data'}),c=first.checkpoint(p);
  const next=createWorkflowRunner(g,adapters,settings),r=next.restore(c);expect(r.trace).toEqual(p.trace);
  c.values[1]![1]={actual:999};c.pending.data={actual:999};r.trace[0]!.details!.input={tampered:true};
  expect(next.checkpoint(r).trace).toEqual(p.trace);expect((await next.resume(r,human)).output).toEqual({actual:1});
 });
 it('does not turn restore or a checkpoint into human authority when no verifier is configured',async()=>{
  const first=createWorkflowRunner(fixture(),{resource:async()=>({actual:1})},options),c=first.checkpoint(await first.run({}));
  const next=createWorkflowRunner(fixture(),{},options),p=next.restore(c);
  expect((await next.resume(p,human)).reason).toMatch(/trusted verifier/);expect(()=>next.checkpoint(p)).not.toThrow();
  expect((await next.resume({...p},human)).status).toBe('blocked');
 });
 it('preserves accumulated step limits across reconstruction',async()=>{
  const g=fixture(),settings={...options,maxSteps:3};let calls=0;
  const first=createWorkflowRunner(g,{resource:async()=>({actual:++calls})},settings),c=first.checkpoint(await first.run({}));
  const next=createWorkflowRunner(g,{resource:async()=>({actual:++calls}),authorizeHuman:async()=>true},settings);
  expect((await next.resume(next.restore(c),human)).reason).toMatch(/Step limit/);expect(calls).toBe(1);
 });
 it('never invokes pre-gate HTTP or LLM adapters during restore or resume',async()=>{
  const g=fixture();g.nodes[1]!.type='http';g.nodes[1]!.config={url:'https://example.com',credentialRef:'fixture',method:'GET'};
  g.nodes.splice(2,0,{id:'model',type:'llm',label:'model',position:{x:0,y:0},config:{instruction:'Fixture only'}});
  g.edges[1]!.target='model';g.edges.push({id:'modelGate',source:'model',target:'n2'});
  let http=0,llm=0;const first=createWorkflowRunner(g,{http:async()=>({http:++http}),llm:async()=>({llm:++llm})},options),c=first.checkpoint(await first.run({}));
  const next=createWorkflowRunner(g,{http:async()=>{throw new Error('must not replay');},llm:async()=>{throw new Error('must not replay');},authorizeHuman:async()=>true},options);
  expect((await next.resume(next.restore(c),human)).output).toEqual({llm:1});expect([http,llm]).toEqual([1,1]);
 });
 it('fails bounded checkpoint export without consuming an oversized live pause',async()=>{
  const g=fixture();g.nodes[1]!.type='set';g.nodes[1]!.config={fields:{}};
  const seed=Object.fromEntries(Array.from({length:500},(_,i)=>[`field${i}`,'x'.repeat(1500)]));
  const extra=['extraA','extraB','extraC'];for(const id of extra)g.nodes.push({id,type:'set',label:id,position:{x:0,y:0},config:{fields:{}}});
  g.edges[1]!.target=extra[0]!;g.edges.push({id:'extraAB',source:extra[0]!,target:extra[1]!},{id:'extraBC',source:extra[1]!,target:extra[2]!},{id:'extraGate',source:extra[2]!,target:'n2'});
  const runner=createWorkflowRunner(g,{authorizeHuman:async()=>true},{...options,maxDataBytes:1000000}),p=await runner.run(seed);expect(p.status).toBe('paused');expect(()=>runner.checkpoint(p)).toThrow();expect((await runner.resume(p,human)).status).toBe('completed');
 });
 it('makes cross-runner replay an explicit server CAS responsibility, not a false core guarantee',async()=>{
  const first=createWorkflowRunner(fixture(),{resource:async()=>({actual:1})},options),c=first.checkpoint(await first.run({}));
  for(let i=0;i<2;i++){const next=createWorkflowRunner(fixture(),{authorizeHuman:async()=>true},options);expect((await next.resume(next.restore(structuredClone(c)),human)).status).toBe('completed');}
 });
 it('binds nested object key order used by branch equality rather than sorting it away',async()=>{
  const g=fixture();g.nodes[3]!.type='branch';g.nodes[3]!.config={field:'shape',operator:'equals',value:{a:1,b:2}};
  for(const port of ['true','false'] as const){g.nodes.push({id:port,type:'output',label:port,position:{x:0,y:0},config:{}});g.edges.push({id:`edge${port}`,source:'n3',target:port,sourcePort:port});}
  const first=createWorkflowRunner(g,{resource:async()=>({shape:{a:1,b:2}})},options),c=first.checkpoint(await first.run({}));
  g.nodes[3]!.config.value={b:2,a:1};expect(()=>createWorkflowRunner(g,{},options).restore(c)).toThrow();
 });
});
export {fixture,options,human};
