import {beforeAll,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {buildSubAppFromSpec} from '../../packages/pipeline/src/build-subapp-spec';
import {buildProcessDraft,type ProcessBuildRequest} from './build-client';
import type {ProcessDraft,ProcessTemplateId} from './contracts';
import {buildProcessPlan,PROCESS_TEMPLATES} from './plan';
import {generateSubApp} from '../../packages/codegen/src/pure';
import {contentHashWith} from '../../packages/guardrails/src/hash';

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const draft=(templateId:ProcessTemplateId='operations-queue'):ProcessDraft=>({brief:{format:'flightdeck-process-brief/1',title:'Review queue',problem:'Review requests are scattered across a manual intake queue.',outcome:'Prepare a reviewable request without changing source records.',users:'Operations staff and independent human reviewers',systemOfRecord:'Workspace contract references; no external connector is configured.',dataSensitivity:'internal',currency:'',templateId,v1Features:['Prepare one bounded human-review proposal'],v2Features:[],acceptanceCriteria:['A proposal is not an approval or a completed process step'],roi:{annualVolume:null,baselineSeconds:null,targetSeconds:null,adoptionBasisPoints:null,loadedHourlyCostCents:null,cashRealizationBasisPoints:null,annualRecurringCostCents:null,initialCostCents:null}},choices:{appId:'review-queue',icon:'Q',navSection:'Ops & insight',visibleToRoles:['legal'],consentedScopes:[...PROCESS_TEMPLATES.find(template=>template.id===templateId)!.requiredScopes]}});
const request=(templateId:ProcessTemplateId='operations-queue'):ProcessBuildRequest=>{
 const input=draft(templateId),plan=buildProcessPlan(input);
 if(plan.status!=='ready')throw new Error(`Compiler fixture not ready: ${plan.status}`);
 return {projectId:'alpha',draft:input,reviewKey:plan.reviewKey,templateVersion:PROCESS_TEMPLATES.find(template=>template.id===templateId)!.version};
};
let receipt:Record<string,unknown>;
const templateReceipts=new Map<ProcessTemplateId,Record<string,unknown>>();
beforeAll(async()=>{
 for(const template of PROCESS_TEMPLATES){
  const input=request(template.id),plan=buildProcessPlan(input.draft);
  if(plan.status!=='ready')throw new Error('Compiler fixture not ready');
  // Real compiler prompt/spec + registered description, matching the pure
  // domain SDK tests. This is not route acceptance: the separate retained
  // full-PRD probe documents the unchanged native privacy refusal.
  const outcome=await buildSubAppFromSpec({prompt:plan.buildPrompt,understanding:template.description,answers:{...Object.fromEntries(input.draft.choices.consentedScopes.map(scope=>[`consent:${scope}`,'yes'])),visibleToRoles:'legal',navSection:'Ops & insight',icon:'Q'},spec:plan.spec},{ctx:{actor:'DEVELOPMENT-only-test-operator'},digest,authorship:'first-party-operator'});
  if(outcome.status!=='proposed')throw new Error(`Real compiler + SDK fixture did not generate: ${outcome.status}`);
  expect(outcome.generated.files).toEqual(generateSubApp(plan.spec).files);
  templateReceipts.set(template.id,{status:'process-built',projectId:'alpha',reviewKey:input.reviewKey,templateId:template.id,templateVersion:template.version,artifactId:digest(JSON.stringify(outcome.generated.files.map(file=>({path:file.path,kind:file.kind,contents:file.contents})))),outcome});
 }
 receipt=templateReceipts.get('operations-queue')!;
});
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const transport=(value:unknown)=>vi.fn(async()=>json(value)) as unknown as ReturnType<typeof vi.fn>&typeof fetch;
const controller=()=>new AbortController();
type MutableFiles={path:string;kind:string;contents:string}[];
const sourceOf=(value:Record<string,unknown>)=>(value.outcome as {generated:{files:MutableFiles}}).generated.files;
const rehash=(value:Record<string,unknown>)=>{
 const files=sourceOf(value);value.artifactId=digest(JSON.stringify(files.map(({path,kind,contents})=>({path,kind,contents}))));
 // Keep BOTH transfer and real gate-source bindings current so inventory tests
 // cannot pass accidentally on a stale-hash refusal introduced by R3.
 const host=files.filter(file=>file.kind!=='standalone').map(({path,contents})=>({path,content:contents}));
 const gate=(value.outcome as {artifacts:{contentHash:string;audit:{contentHash:string;subject:string}}}).artifacts;
 gate.contentHash=contentHashWith(digest,host);gate.audit.contentHash=gate.contentHash;gate.audit.subject=`<${host.length} files>`;
};
it.each(PROCESS_TEMPLATES)('accepts the complete actual $id compiler inventory and native gate receipts',async template=>{
 const value=templateReceipts.get(template.id)!;
 const result=await buildProcessDraft(request(template.id),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value));
 expect(sourceOf(value)).toEqual(result.outcome.generated.files);
 expect(result.outcome.artifacts).toMatchObject({gate:'generated-artifacts',decision:'allow',contentHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
});
it.each(PROCESS_TEMPLATES)('IR-1: refuses source/hash-unchanged plan.label metadata for $id',async template=>{
 const original=templateReceipts.get(template.id)!,value=structuredClone(original);
 (value.outcome as {generated:{plan:{label:string}}}).generated.plan.label='Unreviewed source title';
 expect(sourceOf(value)).toEqual(sourceOf(original));expect(value.artifactId).toBe(original.artifactId);
 expect((value.outcome as {artifacts:unknown}).artifacts).toEqual((original.outcome as {artifacts:unknown}).artifacts);
 expect((value.outcome as {conformance:unknown}).conformance).toEqual((original.outcome as {conformance:unknown}).conformance);
 const fetcher=transport(value);
 await expect(buildProcessDraft(request(template.id),'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/no draft accepted/i);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(PROCESS_TEMPLATES.flatMap(template=>([
 ['version','99.0.0'],['summary','Unreviewed source summary'],['summary',null],['summary',undefined],
 ['routePrefix','/api/admin'],['webModuleId','unrelated-module'],['envVar','UNRELATED_HOST_SWITCH'],['tablePrefix','unrelated_'],
] as const).map(([field,replacement])=>({templateId:template.id,field,replacement}))))('IR-1: refuses source/hash-unchanged plan.$field=$replacement for $templateId',async({templateId,field,replacement})=>{
 const original=templateReceipts.get(templateId)!,value=structuredClone(original);
 const received=(value.outcome as {generated:{plan:Record<string,unknown>}}).generated.plan;
 if(replacement===undefined)delete received[field];else received[field]=replacement;
 expect(sourceOf(value)).toEqual(sourceOf(original));expect(value.artifactId).toBe(original.artifactId);
 expect((value.outcome as {artifacts:unknown}).artifacts).toEqual((original.outcome as {artifacts:unknown}).artifacts);
 expect((value.outcome as {conformance:unknown}).conformance).toEqual((original.outcome as {conformance:unknown}).conformance);
 const fetcher=transport(value);
 await expect(buildProcessDraft(request(templateId),'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/no draft accepted/i);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(PROCESS_TEMPLATES.flatMap(template=>([
 ['id','other-app'],['label','Unreviewed manifest title'],['version','99.0.0'],
 ['routePrefix','/api/apps/other-app'],['webModuleId','unrelated-module'],['minHostVersion','99.0.0'],
] as const).flatMap(([field,replacement])=>[replacement,undefined].map(value=>({templateId:template.id,field,replacement:value})))))('IR-1: refuses source/hash-unchanged mirrored manifestData.$field=$replacement for $templateId',async({templateId,field,replacement})=>{
 const original=templateReceipts.get(templateId)!,value=structuredClone(original);
 const received=(value.outcome as {generated:{plan:{manifestData:Record<string,unknown>}}}).generated.plan.manifestData;
 if(replacement===undefined)delete received[field];else received[field]=replacement;
 expect(sourceOf(value)).toEqual(sourceOf(original));expect(value.artifactId).toBe(original.artifactId);
 expect((value.outcome as {artifacts:unknown}).artifacts).toEqual((original.outcome as {artifacts:unknown}).artifacts);
 expect((value.outcome as {conformance:unknown}).conformance).toEqual((original.outcome as {conformance:unknown}).conformance);
 const fetcher=transport(value);
 await expect(buildProcessDraft(request(templateId),'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/no draft accepted/i);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([
 ['absolute path',(files:MutableFiles)=>{files[0]!.path='/server/subapps/review-queue/manifest.ts';}],
 ['backslash path',(files:MutableFiles)=>{files[0]!.path='server\\\\subapps\\\\review-queue\\\\manifest.ts';}],
 ['control in path',(files:MutableFiles)=>{files[0]!.path='server/subapps/review-queue/mani\u0001fest.ts';}],
 ['foreign app',(files:MutableFiles)=>{files.find(file=>file.kind==='manifest')!.path='server/subapps/other-app/manifest.ts';}],
 ['foreign template domain',(files:MutableFiles)=>{files.find(file=>file.kind==='routes-domain')!.path='server/subapps/review-queue/routes/reviews.ts';}],
 ['foreign root',(files:MutableFiles)=>{files[0]!.path='outside/source.ts';}],
 ['dot segment',(files:MutableFiles)=>{files[0]!.path='server/./db.ts';}],
 ['empty segment',(files:MutableFiles)=>{files[0]!.path='server//db.ts';}],
 ['encoded traversal',(files:MutableFiles)=>{files[0]!.path='server/%2e%2e/db.ts';}],
 ['drive path',(files:MutableFiles)=>{files[0]!.path='C:/server/db.ts';}],
 ['overlong path',(files:MutableFiles)=>{files[0]!.path=`server/${'a'.repeat(240)}.ts`;}],
 ['unknown kind',(files:MutableFiles)=>{files[0]!.kind='unknown';}],
 ['unrecognized kind',(files:MutableFiles)=>{files[0]!.kind='executable';}],
 ['wrong supported kind',(files:MutableFiles)=>{files.find(file=>file.kind==='manifest')!.kind='guard';}],
 ['additional foreign file',(files:MutableFiles)=>{files.push({path:'server/subapps/review-queue/routes/extra.ts',kind:'routes-domain',contents:''});}],
 ['more than 100 files',(files:MutableFiles)=>{while(files.length<101)files.push({path:`standalone/extra-${files.length}.ts`,kind:'standalone',contents:''});}],
 ['oversized source bytes',(files:MutableFiles)=>{files[0]!.contents='x'.repeat(200001);}],
 ['oversized UTF-8 source bytes',(files:MutableFiles)=>{files[0]!.contents='\u20ac'.repeat(70000);}],
 ...(['manifest','guard','routes-index','routes-domain','web-module','host-test','standalone'] as const).map(kind=>[`missing ${kind}`,(files:MutableFiles)=>{files.splice(files.findIndex(file=>file.kind===kind),1);}] as const),
] as const)('R2: refuses %s with matching transfer and gate-source hashes',async(_label,change)=>{
 const value=structuredClone(receipt);change(sourceOf(value));rehash(value);
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
it.each([
 ['R2a: empty inventory',(files:MutableFiles)=>{files.length=0;}],
 ['R2b: duplicate path',(files:MutableFiles)=>{files.push(structuredClone(files[0]!));}],
 ['R2c: traversal path',(files:MutableFiles)=>{files[0]!.path='../../outside/manifest.ts';}],
] as const)('%s refuses even a matching recomputed digest',async(_label,change)=>{
 const value=structuredClone(receipt);change(sourceOf(value));rehash(value);
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
it.each([
 ...(['gate','decision','tier','findings','reason','contentHash','audit'] as const).map(key=>[`missing ${key}`,(gate:Record<string,unknown>)=>{delete gate[key];}] as const),
 ['wrong gate',(gate:Record<string,unknown>)=>{gate.gate='registration';}],
 ['tier 3 allow',(gate:Record<string,unknown>)=>{gate.tier=3;(gate.audit as Record<string,unknown>).tier=3;}],
 ['tier 4 allow',(gate:Record<string,unknown>)=>{gate.tier=4;(gate.audit as Record<string,unknown>).tier=4;}],
 ['malformed finding',(gate:Record<string,unknown>)=>{gate.findings=[{class:'pii',tier:2}];}],
 ['inconsistent classification',(gate:Record<string,unknown>)=>{gate.tier=2;(gate.audit as Record<string,unknown>).tier=2;}],
 ['wrong source hash',(gate:Record<string,unknown>)=>{gate.contentHash='a'.repeat(64);(gate.audit as Record<string,unknown>).contentHash=gate.contentHash;}],
 ['wrong audit hash',(gate:Record<string,unknown>)=>{(gate.audit as Record<string,unknown>).contentHash='a'.repeat(64);}],
 ['wrong audit decision',(gate:Record<string,unknown>)=>{(gate.audit as Record<string,unknown>).decision='refuse';}],
 ['wrong audit event',(gate:Record<string,unknown>)=>{(gate.audit as Record<string,unknown>).event='guardrails.registration-allowed';}],
 ['wrong audit subject',(gate:Record<string,unknown>)=>{(gate.audit as Record<string,unknown>).subject='<0 files>';}],
 ['wrong audit count',(gate:Record<string,unknown>)=>{(gate.audit as Record<string,unknown>).findingCount=1;}],
 ['wrong audit classes',(gate:Record<string,unknown>)=>{(gate.audit as Record<string,unknown>).classes=['pii'];}],
 ['wrong audit locations',(gate:Record<string,unknown>)=>{(gate.audit as Record<string,unknown>).locations=['(candidate)'];}],
 ...(['event','actor','subject','decision','tier','classes','locations','findingCount','contentHash'] as const).map(key=>[`missing audit ${key}`,(gate:Record<string,unknown>)=>{delete (gate.audit as Record<string,unknown>)[key];}] as const),
 ['inapplicable approval',(gate:Record<string,unknown>)=>{gate.approval={ok:true};}],
] as const)('R3: refuses %s in the generated-artifacts receipt',async(_label,change)=>{
 const value=structuredClone(receipt);change((value.outcome as {artifacts:Record<string,unknown>}).artifacts);
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
it('R3: refuses host source changed with only the transfer digest recomputed',async()=>{
 const value=structuredClone(receipt);sourceOf(value).find(file=>file.kind==='manifest')!.contents+='\n// transfer changed';
 value.artifactId=digest(JSON.stringify(sourceOf(value).map(({path,kind,contents})=>({path,kind,contents}))));
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
it.each(['all files','contents not content','transfer artifact id'] as const)('R3: rejects a gate hash over the wrong %s projection',async projection=>{
 const value=structuredClone(receipt),files=sourceOf(value);
 const wrong=projection==='transfer artifact id'?value.artifactId as string:contentHashWith(digest,(projection==='all files'?files:files.filter(file=>file.kind!=='standalone')).map(({path,contents})=>projection==='contents not content'?{path,contents}:{path,content:contents}));
 const gate=(value.outcome as {artifacts:{contentHash:string;audit:{contentHash:string}}}).artifacts;
 expect(wrong).not.toBe(gate.contentHash);gate.contentHash=wrong;gate.audit.contentHash=wrong;
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
it('R3: keeps actual native standalone-exclusion and canonical-object-key hash policies explicit',async()=>{
 const value=structuredClone(receipt),files=sourceOf(value);
 files.find(file=>file.kind==='standalone')!.contents+='\n// inert transfer-only fixture';
 value.artifactId=digest(JSON.stringify(files.map(({path,kind,contents})=>({path,kind,contents}))));
 const gate=(value.outcome as {artifacts:{contentHash:string}}).artifacts;
 expect(gate.contentHash).toBe(contentHashWith(digest,files.filter(file=>file.kind!=='standalone').map(({path,contents})=>({content:contents,path}))));
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).resolves.toHaveProperty('artifactId',value.artifactId);
});
it('R3: refuses contradictory conformance errors even when findings remains warning-only',async()=>{
 const value=structuredClone(receipt);(value.outcome as {conformance:{errors:unknown[]}}).conformance.errors.push({rule:'FD-C001',severity:'error',file:'server/subapps/review-queue/manifest.ts',line:1,column:1,message:'Contradictory errors projection',evidence:null});
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
it('R3a: refuses an incomplete generated-artifacts receipt',async()=>{
 const value=structuredClone(receipt);(value.outcome as {artifacts:unknown}).artifacts={decision:'allow'};
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
it('R3b: refuses conformance ok that contradicts an error finding',async()=>{
 const value=structuredClone(receipt);(value.outcome as {conformance:{findings:unknown[]}}).conformance.findings.push({rule:'FD-C001',severity:'error',file:'server/subapps/review-queue/manifest.ts',line:1,column:1,message:'Contradictory gate receipt',evidence:null});
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
it('accepts actual SDK-generated conformance-passed source only with exact scope, review, version and file digest',async()=>{
 const fetcher=transport(receipt),input=request();const result=await buildProcessDraft(input,'DEVELOPMENT-only-nonsecret',controller().signal,fetcher);
 expect(result.artifactId).toBe(receipt.artifactId);expect(result.outcome.conformance.ok).toBe(true);
 expect(fetcher).toHaveBeenCalledTimes(1);const [url,init]=fetcher.mock.calls[0]!;
 expect(url).toBe('/api/studio/process/build');expect(init).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store'});
 expect(JSON.parse(String(init.body))).toEqual({projectId:input.projectId,draft:input.draft,reviewKey:input.reviewKey});
 expect(JSON.parse(String(init.body))).not.toHaveProperty('templateVersion');
});

it.each([
 ['project', (v:Record<string,unknown>)=>{v.projectId='beta';}],
 ['review', (v:Record<string,unknown>)=>{v.reviewKey='obsolete';}],
 ['template', (v:Record<string,unknown>)=>{v.templateId='case-workspace';}],
 ['version', (v:Record<string,unknown>)=>{v.templateVersion='2.0.0';}],
 ['hash', (v:Record<string,unknown>)=>{v.artifactId='a'.repeat(64);}],
 ['status', (v:Record<string,unknown>)=>{v.status='process-refused';}],
 ['extra authority', (v:Record<string,unknown>)=>{v.actor='forged';}],
 ['conformance', (v:Record<string,unknown>)=>{(v.outcome as {conformance:{ok:boolean}}).conformance.ok=false;}],
 ['privacy gate', (v:Record<string,unknown>)=>{(v.outcome as {artifacts:{decision:string}}).artifacts.decision='refuse';}],
 ['source bytes', (v:Record<string,unknown>)=>{(v.outcome as {generated:{files:{contents:string}[]}}).generated.files[0]!.contents+='\nchanged';}],
 ['app identity', (v:Record<string,unknown>)=>{(v.outcome as {generated:{plan:{id:string}}}).generated.plan.id='different-app';}],
] as const)('refuses %s mismatch without accepting a generated candidate',async(_label,change)=>{
 const value=structuredClone(receipt);change(value);
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});

it.each([401,403,404,409,429,500,503])('refuses HTTP %s before accepting even a valid-looking source body',async status=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(receipt),{status,headers:{'content-type':'application/json'}})) as unknown as typeof fetch;
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/no draft accepted/i);
});
it('refuses a JSON-shaped body with non-JSON content type',async()=>{
 const fetcher=(async()=>new Response(JSON.stringify(receipt),{headers:{'content-type':'text/html'}})) as typeof fetch;
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/no draft accepted/i);
});
it('scrubs native transport errors instead of exposing their private message',async()=>{
 const fetcher=(async()=>{throw new Error('PRIVATE-TRANSPORT-DETAIL');}) as typeof fetch;
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/unavailable.*no draft accepted/i);
});
it('snapshots the exact immutable scope and source request before the first await',async()=>{
 let resolve!:(value:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(done=>{resolve=done;})) as unknown as typeof fetch;
 const input=request();const pending=buildProcessDraft(input,'DEVELOPMENT-only-nonsecret',controller().signal,fetcher);
 input.projectId='beta';input.draft.choices.appId='different-app';input.reviewKey='other';
 resolve(json(receipt));await expect(pending).resolves.toHaveProperty('projectId','alpha');
});
it.each([
 ['project path',(v:ProcessBuildRequest)=>{v.projectId='../escape';}],
 ['unknown top-level field',(v:ProcessBuildRequest)=>{Object.assign(v,{actor:'forged'});}],
 ['empty review',(v:ProcessBuildRequest)=>{v.reviewKey='';}],
 ['unknown template',(v:ProcessBuildRequest)=>{Object.assign(v.draft.brief,{templateId:'unregistered'});}],
 ['oversized request',(v:ProcessBuildRequest)=>{v.draft.brief.problem='x'.repeat(70_000);}],
] as const)('refuses %s before any network access',async(_label,change)=>{
 const input=request();change(input);const fetcher=transport(receipt);
 await expect(buildProcessDraft(input,'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/request.*no draft accepted/i);
 expect(fetcher).not.toHaveBeenCalled();
});
it.each([
 ['unknown brief field',(v:ProcessBuildRequest)=>{Object.assign(v.draft.brief,{send:true});}],
 ['unknown choice field',(v:ProcessBuildRequest)=>{Object.assign(v.draft.choices,{activate:true});}],
 ['missing human fact',(v:ProcessBuildRequest)=>{v.draft.brief.problem='';}],
 ['missing required schema field',(v:ProcessBuildRequest)=>{delete (v.draft.choices as Partial<ProcessDraft['choices']>).icon;}],
 ['unconsented template scope',(v:ProcessBuildRequest)=>{v.draft.choices.consentedScopes=[];}],
 ['unnecessary template scope',(v:ProcessBuildRequest)=>{v.draft.choices.consentedScopes.push('read:contracts');}],
 ['unknown role',(v:ProcessBuildRequest)=>{Object.assign(v.draft.choices,{visibleToRoles:['super_admin']});}],
 ['invalid ROI percent',(v:ProcessBuildRequest)=>{v.draft.brief.roi.adoptionBasisPoints=10001;}],
 ['stale local review',(v:ProcessBuildRequest)=>{v.reviewKey='obsolete';}],
 ['unregistered local version',(v:ProcessBuildRequest)=>{v.templateVersion='2.0.0';}],
] as const)('refuses full-domain %s before network access',async(_label,change)=>{
 const input=request();change(input);const fetcher=transport(receipt);
 await expect(buildProcessDraft(input,'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/request.*no draft accepted/i);
 expect(fetcher).not.toHaveBeenCalled();
});
it('rejects accessor input without reading its value or sending any request',async()=>{
 const input=request();let reads=0;Object.defineProperty(input.draft.brief,'problem',{get(){reads++;return 'private';},enumerable:true});const fetcher=transport(receipt);
 await expect(buildProcessDraft(input,'DEVELOPMENT-only-nonsecret',controller().signal,fetcher)).rejects.toThrow(/request.*no draft accepted/i);
 expect(reads).toBe(0);expect(fetcher).not.toHaveBeenCalled();
});

it('does not send an already-cancelled request',async()=>{
 const abort=controller();abort.abort();const fetcher=transport(receipt);
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',abort.signal,fetcher)).rejects.toThrow(/cancelled.*no draft accepted/i);
 expect(fetcher).not.toHaveBeenCalled();
});
it('settles cancellation even when the transport ignores abort, and discards its late reply',async()=>{
 vi.useFakeTimers();let resolve!:(value:Response)=>void;const abort=controller();let settled=false;
 const fetcher=(()=>new Promise<Response>(done=>{resolve=done;})) as typeof fetch;
 const pending=buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',abort.signal,fetcher).then(value=>{settled=true;return value;},error=>{settled=true;return error as Error;});
 try{abort.abort();await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(true);expect(await pending).toMatchObject({message:expect.stringMatching(/cancelled.*no draft accepted/i)});}
 finally{resolve(json(receipt));await pending;vi.useRealTimers();}
});
it('cancels a pending body read without waiting for a hung source cancellation',async()=>{
 vi.useFakeTimers();let sink!:ReadableStreamDefaultController<Uint8Array>;let cancelled=false;let settled=false;const abort=controller();
 const body=new ReadableStream<Uint8Array>({start(s){sink=s;},cancel(){cancelled=true;return new Promise<void>(()=>{});}},{highWaterMark:0});
 const fetcher=(async()=>new Response(body,{headers:{'content-type':'application/json'}})) as typeof fetch;
 const pending=buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',abort.signal,fetcher).then(value=>{settled=true;return value;},error=>{settled=true;return error as Error;});
 try{await vi.advanceTimersByTimeAsync(1);abort.abort();await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(true);expect(cancelled).toBe(true);expect(await pending).toMatchObject({message:expect.stringMatching(/cancelled.*no draft accepted/i)});}
 finally{try{sink.close();}catch{/* The cancelled source is already closed. */}await pending;vi.useRealTimers();}
});
it('applies a bounded deadline even to a transport that never returns headers',async()=>{
 vi.useFakeTimers();let resolve!:(value:Response)=>void;let settled=false;
 const fetcher=(()=>new Promise<Response>(done=>{resolve=done;})) as typeof fetch;
 const pending=buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,fetcher).then(value=>{settled=true;return value;},error=>{settled=true;return error as Error;});
 try{await vi.advanceTimersByTimeAsync(30_001);expect(settled).toBe(true);expect(await pending).toMatchObject({message:expect.stringMatching(/deadline.*no draft accepted/i)});}
 finally{resolve(json(receipt));await pending;vi.useRealTimers();}
});
it('stops oversized streamed JSON and does not await a hung cancel promise',async()=>{
 vi.useFakeTimers();let cancelled=false;let settled=false;let pulls=0;let sink!:ReadableStreamDefaultController<Uint8Array>;
 const body=new ReadableStream<Uint8Array>({start(s){sink=s;},pull(s){pulls++;if(pulls===1)s.enqueue(new Uint8Array(2_000_001).fill(32));else if(pulls===2)s.enqueue(new TextEncoder().encode(JSON.stringify(receipt)));else s.close();},cancel(){cancelled=true;return new Promise<void>(()=>{});}},{highWaterMark:0});
 const fetcher=(async()=>new Response(body,{headers:{'content-type':'application/json'}})) as typeof fetch;
 const pending=buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,fetcher).then(value=>{settled=true;return value;},error=>{settled=true;return error as Error;});
 try{await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(true);expect(cancelled).toBe(true);expect(pulls).toBe(1);expect(await pending).toMatchObject({message:expect.stringMatching(/no draft accepted/i)});}
 finally{try{sink.close();}catch{/* Already cancelled. */}vi.useRealTimers();}
});

it.each([
 ['roles',(v:Record<string,unknown>)=>{v.visibleToRoles=['admin'];}],
 ['scopes',(v:Record<string,unknown>)=>{v.capabilities=['read:contracts','write:inbox-proposal'];}],
 ['navigation',(v:Record<string,unknown>)=>{v.navSection='Admin';}],
 ['icon',(v:Record<string,unknown>)=>{v.icon='X';}],
] as const)('refuses generated %s metadata outside the exact reviewed draft ceiling',async(_label,change)=>{
 const value=structuredClone(receipt);change((value.outcome as {generated:{plan:{manifestData:Record<string,unknown>}}}).generated.plan.manifestData);
 await expect(buildProcessDraft(request(),'DEVELOPMENT-only-nonsecret',controller().signal,transport(value))).rejects.toThrow(/no draft accepted/i);
});
