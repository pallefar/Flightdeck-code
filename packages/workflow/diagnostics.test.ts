import {describe,it,expect} from 'vitest';
import {createWorkflowRunner, type RunnerOptions, type TraceEntry} from './engine';
import {chain,mappings} from './test-helpers';
// Local fake external adapter fixture only; deterministic nodes still execute the real runner.
const capture:RunnerOptions={captureData:true};
function details(entry:TraceEntry|undefined){return entry?.details;}
describe('actual node diagnostics',()=>{
 it('records measured node durations and branch decisions without capturing payloads by default',async()=>{
  const g=chain(['manual','http','branch','output','output']);g.nodes[1]!.config={url:'https://example.com',method:'GET',credentialRef:'fixture'};g.nodes[2]!.config={field:'ok',operator:'equals',value:true};
  g.edges=[{id:'a',source:'n0',target:'n1'},{id:'b',source:'n1',target:'n2'},{id:'c',source:'n2',target:'n3',sourcePort:'true'},{id:'d',source:'n2',target:'n4',sourcePort:'false'}];
  const run=await createWorkflowRunner(g,{http:async()=>{await new Promise(resolve=>setTimeout(resolve,20));return {ok:true};}}).run({input:'seed'});
  expect(run.status).toBe('completed');expect(details(run.trace.find(t=>t.nodeId==='n1'))?.durationMs).toBeGreaterThanOrEqual(15);
  expect(details(run.trace.find(t=>t.nodeId==='n2'))?.selectedPort).toBe('true');
  for(const entry of run.trace.filter(t=>t.status==='completed')){expect(details(entry)?.durationMs).toBeGreaterThanOrEqual(0);expect(details(entry)?.input).toBeUndefined();expect(details(entry)?.output).toBeUndefined();}
  expect(details(run.trace.find(t=>t.nodeId==='n4'))).toBeUndefined();
 });
 it('captures bounded cloned mapped input/output only on explicit opt-in and scrubs known identity fields',async()=>{
  const g=chain(['manual','set','output']);mappings(g,1,[{target:'chosen',source:{kind:'input',path:['safe']}}]);
  const run=await createWorkflowRunner(g,{},capture).run({safe:{nested:[42]},email:'person@example.org',displayName:'Jane Doe',note:'Contact person@example.org about Jane Doe',credentialRef:'vault-reference'});
  expect(details(run.trace[1])?.input).toEqual({chosen:{nested:[42]}});expect(details(run.trace[1])?.output).toEqual({chosen:{nested:[42]},answer:42});
  const first=details(run.trace[0])?.input as Record<string,unknown>;
  expect(first.email).toBeUndefined();expect(first.displayName).toBeUndefined();expect(first.credentialRef).toBeUndefined();expect(JSON.stringify(first)).not.toContain('person@example.org');expect(JSON.stringify(first)).not.toContain('Jane Doe');
  (run.output as Record<string,unknown>).chosen='changed';expect(details(run.trace[2])?.output).toEqual({chosen:{nested:[42]},answer:42});
 });
 it('records safe blocked categories without copying adapter exceptions, endpoints or secrets',async()=>{
  const g=chain(['manual','http','output']);g.nodes[1]!.config={url:'https://example.com',method:'POST',credentialRef:'fixture'};
  const run=await createWorkflowRunner(g,{http:async()=>{throw new Error('Bearer private-value https://private.example.org Jane Doe person@example.org');}},capture).run({safe:true});
  expect(run.status).toBe('blocked');expect(run.reason).toMatch(/adapter.*failed.*side effects/i);
  const entry=run.trace[1];expect(details(entry)?.errorCode).toBe('ADAPTER_ERROR');expect(details(entry)?.durationMs).toBeGreaterThanOrEqual(0);expect(details(entry)?.input).toEqual({safe:true});expect(details(entry)?.output).toBeUndefined();
  for(const unsafe of ['private-value','private.example.org','Jane Doe','person@example.org'])expect(JSON.stringify(run)).not.toContain(unsafe);
  const timeout=await createWorkflowRunner(g,{http:async()=>new Promise(()=>{})},{...capture,timeoutMs:5}).run({});expect(details(timeout.trace[1])?.errorCode).toBe('ADAPTER_TIMEOUT');expect(timeout.reason).toMatch(/side effects may already have occurred/i);
  mappings(g,1,[{target:'missing',source:{kind:'input',path:['absent']}}]);
  const missing=await createWorkflowRunner(g,{},capture).run({});expect(details(missing.trace[1])?.errorCode).toBe('MAPPING_SOURCE_UNAVAILABLE');expect(details(missing.trace[1])?.input).toBeUndefined();
 });
 it('measures approval pause and verification attempts without capturing proof or permitting replay',async()=>{
  const g=chain(['manual','approval','output']);g.nodes[1]!.config={reviewer:'Reviewer'};let verifications=0;
  const runner=createWorkflowRunner(g,{authorizeHuman:async authorization=>{verifications++;await new Promise(resolve=>setTimeout(resolve,15));return authorization.humanName==='Reviewer'&&authorization.proof==='private-proof';}},{...capture,initiator:'Creator'});
  const paused=await runner.run({safe:true});expect(details(paused.trace[1])?.durationMs).toBeGreaterThanOrEqual(0);expect(details(paused.trace[1])?.input).toEqual({safe:true});expect(details(paused.trace[1])?.output).toBeUndefined();
  const denied=await runner.resume(paused,{humanName:'Creator',proof:'private-proof'});expect(details(denied.trace.at(-1))?.errorCode).toBe('AUTHORIZATION_REQUIRED');expect(verifications).toBe(0);
  const refused=await runner.resume(paused,{humanName:'Other',proof:'private-proof'});expect(details(refused.trace.at(-1))?.errorCode).toBe('AUTHORIZATION_REFUSED');expect(details(refused.trace.at(-1))?.durationMs).toBeGreaterThanOrEqual(10);
  expect((await runner.resume({...paused},{humanName:'Reviewer',proof:'private-proof'})).status).toBe('blocked');
  const complete=await runner.resume(paused,{humanName:'Reviewer',proof:'private-proof'});expect(complete.status).toBe('completed');expect(complete.trace[1]?.humanName).toBe('Reviewer');expect(details(complete.trace[1])?.durationMs).toBeGreaterThanOrEqual(10);expect(details(complete.trace[1])?.output).toEqual({safe:true});expect(JSON.stringify(complete)).not.toContain('private-proof');
  expect((await runner.resume(paused,{humanName:'Reviewer',proof:'private-proof'})).status).toBe('blocked');
 });
 it('records node-specific execution limits without inventing input or output',async()=>{
  const run=await createWorkflowRunner(chain(['manual','set','output']),{}, {...capture,maxSteps:1}).run({safe:true});
  expect(details(run.trace[1])?.errorCode).toBe('STEP_LIMIT');expect(details(run.trace[1])?.durationMs).toBeGreaterThanOrEqual(0);expect(details(run.trace[1])?.input).toBeUndefined();expect(details(run.trace[1])?.output).toBeUndefined();
 });
 it('omits oversized snapshots rather than fabricating truncated payloads',async()=>{
  const g=chain(['manual','output']);const seed={items:Array.from({length:10},()=> 'x'.repeat(1500))};
  const run=await createWorkflowRunner(g,{},capture).run(seed);expect(run.status).toBe('completed');expect(run.output).toEqual(seed);
  for(const entry of run.trace){expect(details(entry)?.input).toBeUndefined();expect(details(entry)?.output).toBeUndefined();expect(details(entry)?.durationMs).toBeGreaterThanOrEqual(0);}
 });
 it('records false decisions and leaves skipped payloads absent even with capture enabled',async()=>{
  const g=chain(['manual','branch','output','output']);g.nodes[1]!.config={field:'selected',operator:'equals',value:true};
  g.edges=[{id:'a',source:'n0',target:'n1'},{id:'b',source:'n1',target:'n2',sourcePort:'true'},{id:'c',source:'n1',target:'n3',sourcePort:'false'}];
  mappings(g,1,[{target:'selected',source:{kind:'literal',value:false}}]);
  const run=await createWorkflowRunner(g,{},capture).run({unmapped:'omit'});expect(details(run.trace[1])?.selectedPort).toBe('false');expect(details(run.trace[1])?.input).toEqual({selected:false});expect(details(run.trace[1])?.output).toEqual({selected:false});expect(run.trace[2]?.status).toBe('skipped');expect(details(run.trace[2])).toBeUndefined();
 });
 it('blocks unsafe adapter data without recording its value or pretending execution completed',async()=>{
  const g=chain(['manual','http','output']);g.nodes[1]!.config={url:'https://example.com',method:'GET',credentialRef:'fixture'};
  const run=await createWorkflowRunner(g,{http:async()=>({password:'private-fixture-value'})},capture).run({});expect(run.status).toBe('blocked');expect(details(run.trace[1])?.errorCode).toBe('DATA_INVALID');expect(details(run.trace[1])?.output).toBeUndefined();expect(JSON.stringify(run)).not.toContain('private-fixture-value');
 });
 it('keeps concurrent verified resumes from replaying downstream adapter side effects',async()=>{
  const g=chain(['manual','approval','http','output']);g.nodes[1]!.config={reviewer:'Reviewer'};g.nodes[2]!.config={url:'https://example.com',method:'POST',credentialRef:'fixture'};let effects=0;
  const runner=createWorkflowRunner(g,{authorizeHuman:async()=>{await new Promise(resolve=>setTimeout(resolve,5));return true;},http:async()=>{effects++;return {fixture:true};}},{...capture,initiator:'Creator'});
  const paused=await runner.run({});const attempts=await Promise.all([runner.resume(paused,{humanName:'Reviewer',proof:'fixture-proof'}),runner.resume(paused,{humanName:'Reviewer',proof:'fixture-proof'})]);expect(attempts.map(r=>r.status).sort()).toEqual(['blocked','completed']);expect(effects).toBe(1);
 });
});
