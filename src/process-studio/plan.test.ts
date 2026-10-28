import {expect,it} from 'vitest';
import {PROCESS_TEMPLATES,emptyProcessDraft,parseProcessDraft,buildProcessPlan} from './plan';
import {ROI_ASSUMPTION_KEYS} from './roi';
import type {ProcessDraft,ProcessTemplateId} from './contracts';
import {generateSubApp} from '../../packages/codegen/src/pure';
import {buildSubAppFromSpec} from '../../packages/pipeline/src/build-subapp-spec';
import {createHash} from 'node:crypto';

import {fileURLToPath} from 'node:url';
import {runtimeImportClosure} from '../../test-helpers/runtime-import-closure';

function completeDraft(templateId:ProcessTemplateId='operations-queue'):ProcessDraft {
 const draft=emptyProcessDraft();
 Object.assign(draft.brief,{title:'Process review',problem:'Review requests are scattered across a manual intake queue.',outcome:'Prepare a reviewable request without changing source records.',users:'Operations staff and independent human reviewers',systemOfRecord:'Workspace contract references; no external connector is configured.',dataSensitivity:'internal',templateId,v1Features:['Prepare one bounded human-review proposal'],v2Features:['Explore additional sources only after separate review'],acceptanceCriteria:['A proposal is not an approval or a completed process step']});
 Object.assign(draft.choices,{appId:'process-review',icon:'📋',navSection:'Ops & insight',visibleToRoles:['legal'],consentedScopes:[...PROCESS_TEMPLATES.find(t=>t.id===templateId)!.requiredScopes]});
 return draft;
}

it('starts with fresh explicitly unanswered facts and draft ceilings',()=>{
 const draft=emptyProcessDraft();
 expect(draft).toEqual({brief:{format:'flightdeck-process-brief/1',title:'',problem:'',outcome:'',users:'',systemOfRecord:'',dataSensitivity:'unanswered',currency:'',templateId:null,v1Features:[],v2Features:[],acceptanceCriteria:[],roi:Object.fromEntries(ROI_ASSUMPTION_KEYS.map(key=>[key,null]))},choices:{appId:'',icon:'',navSection:null,visibleToRoles:[],consentedScopes:[]}});
 draft.brief.v1Features.push('Changed');
 expect(emptyProcessDraft().brief.v1Features).toEqual([]);
 expect(PROCESS_TEMPLATES.map(template=>template.id)).toEqual(['operations-queue','case-workspace','analytical-report']);
});

it('parses an exact detached draft and refuses unsafe or malformed JSON without reading getters',()=>{
 const draft=emptyProcessDraft();
 const parsed=parseProcessDraft(draft);
 expect(parsed).toEqual(draft);
 expect(parsed).not.toBe(draft);
 if(parsed)parsed.brief.title='Changed';
 expect(draft.brief.title).toBe('');
 let reads=0;
 const getter=Object.defineProperty(emptyProcessDraft(),'brief',{enumerable:true,get(){reads++;throw Error('must not run');}});
 const cycle:Record<string,unknown>={};cycle.loop=cycle;
 const badValues:unknown[]=[getter,cycle,null,[],true,{},Object.create(draft),{...draft,grant:true},{...draft,[Symbol('hidden')]:true},{...draft,choices:{...draft.choices,visibleToRoles:['super_admin']}},{...draft,brief:{...draft.brief,roi:{...draft.brief.roi,annualVolume:-1}}},{...draft,brief:{...draft.brief,title:'x'.repeat(81)}}];
 for(const value of badValues)expect(parseProcessDraft(value)).toBeNull();
 expect(reads).toBe(0);
});

it('asks stable explicit facts and choices instead of inventing them or using ROI as a prerequisite',()=>{
 const draft=emptyProcessDraft();
 const result=buildProcessPlan(draft);
 expect(result.status).toBe('needs-input');
 if(result.status!=='needs-input')return;
 expect(result.questions.map(q=>q.id)).toEqual(['title','problem','outcome','users','systemOfRecord','dataSensitivity','v1Features','acceptanceCriteria','templateId','appId','icon','navSection','visibleToRoles']);
 expect(result.questions.every(q=>q.question.length>10&&q.because.length>10)).toBe(true);
 expect(buildProcessPlan(JSON.parse(JSON.stringify(draft)))).toEqual(result);
 expect(buildProcessPlan({brief:{}})).toEqual({status:'invalid',issues:['invalid-process-draft']});
 draft.brief.templateId='operations-queue';
 const scoped=buildProcessPlan(draft);
 if(scoped.status!=='needs-input')throw Error('questions required');
 expect(scoped.questions.map(q=>q.id)).toContain('consent:write:inbox-proposal');
 expect(scoped.questions.map(q=>q.id)).not.toContain('consent:read:contracts');
 expect(scoped.questions.map(q=>q.id)).not.toContain('roi');
});

it('compiles an operations queue to a real proposal-only spec with an incomplete ROI and version-bound exact review key',()=>{
 const draft=completeDraft();
 const before=JSON.stringify(draft);
 const result=buildProcessPlan(draft);
 expect(result.status).toBe('ready');
 if(result.status!=='ready')return;
 expect(result.templateId).toBe('operations-queue');
 expect(result.roi).toMatchObject({status:'incomplete',missing:ROI_ASSUMPTION_KEYS});
 expect(result.spec).toMatchObject({profile:'mini-app',id:draft.choices.appId,icon:draft.choices.icon,navSection:draft.choices.navSection,visibleToRoles:['legal'],capabilities:['write:inbox-proposal']});
 expect(result.spec.tables).toBeUndefined();
 expect(result.spec.domains.flatMap(d=>d.routes.map(r=>r.operation.kind))).toEqual(['list-proposals','propose']);
 expect(JSON.parse(result.reviewKey)).toEqual({format:'flightdeck-process-plan/1',template:{id:'operations-queue',version:'1.0.0'},draft});
 expect(result.prd).toContain('V1 requirements');
 expect(result.prd).toContain('V2 backlog');
 expect(result.prd).toContain('Acceptance criteria');
 expect(result.prd).toContain('incomplete');
 expect(result.prd).toContain('capacity is not cash');
 expect(result.prd).toContain(draft.brief.systemOfRecord);
 expect(result.buildPrompt).toContain('consent:write:inbox-proposal: yes');
 expect(result.buildPrompt).toContain('visibleToRoles: legal');
 expect(result.buildPrompt.length).toBeLessThanOrEqual(8000);
 expect(result.prd.length).toBeLessThanOrEqual(8000);
 expect(result.suggestedAgents.map(a=>a.id)).toEqual(['planner','builder','reviewer']);
 expect(result.suggestedAgents.every(a=>a.state==='proposed')).toBe(true);
 expect(result.reuse.some(r=>r.id==='generateSubApp'&&r.source==='packages/codegen/src/pure.ts')).toBe(true);
 expect(result.limitations.join(' ')).toContain('never OS grants');
 const generated=generateSubApp(result.spec);
 const routes=generated.files.find(f=>f.path.endsWith('routes/queue.ts'))!.contents;
 expect(routes).toContain('caps.listOwnInboxProposals()');
 expect(routes).toContain('await caps.writeInboxProposal(');
 expect(routes).not.toContain('caps.readContracts()');
 expect(JSON.stringify(draft)).toBe(before);
 expect(buildProcessPlan(draft)).toEqual(result);
});

it('generates a materially different case workspace with source-record validation and a case-note form',()=>{
 const draft=completeDraft('case-workspace');
 const result=buildProcessPlan(draft);
 expect(result.status).toBe('ready');
 if(result.status!=='ready')return;
 expect(result.spec.capabilities).toEqual(['read:contracts','write:inbox-proposal']);
 expect(result.spec.domains.flatMap(d=>d.routes.map(r=>r.operation.kind))).toEqual(['list-contracts','propose']);
 const generated=generateSubApp(result.spec);
 const routes=generated.files.find(f=>f.path.endsWith('routes/cases.ts'))!.contents;
 expect(routes).toContain('caps.readContracts()');
 expect(routes).toContain('row.ticket === ticket');
 expect(routes).toContain('code: "unknown_ticket"');
 expect(routes).toContain('caseNote: z.string().min(1).max(1000)');
 expect(routes).not.toContain('requestId:');
 const web=generated.files.find(f=>f.kind==='web-module')!.contents;
 expect(web).toContain('name: "caseNote"');
 expect(web).not.toContain('name: "requestId"');
 expect(result.limitations.join(' ')).toContain('record existence');
});

it('generates a read-only record-list report without inventing SQL, charts, count widgets or cardinality limits',()=>{
 const draft=completeDraft('analytical-report');
 draft.brief.v1Features=['List available contract references without changes'];
 const result=buildProcessPlan(draft);
 expect(result.status).toBe('ready');
 if(result.status!=='ready')return;
 expect(result.spec.capabilities).toEqual(['read:contracts']);
 expect(result.spec.domains.flatMap(d=>d.routes.map(r=>[r.method,r.operation.kind]))).toEqual([['GET','list-contracts']]);
 const generated=generateSubApp(result.spec);
 const routes=generated.files.find(f=>f.path.endsWith('routes/report.ts'))!.contents;
 expect(routes).toContain('rows: folders.map((folder) => ({ ticket: folder.ticket, folderName: folder.folderName }))');
 expect(routes).not.toContain('app.post(');
 expect(routes).not.toContain('caps.writeInboxProposal(');
 expect(routes).not.toContain('folder.dir');
 const web=generated.files.find(f=>f.kind==='web-module')!.contents;
 const panels=web.slice(web.indexOf('const PANELS:'),web.indexOf('const T ='));
 expect(panels).toContain('forms: [\n    ]');
 expect(panels).not.toContain('name: "ticket"');
 expect(result.limitations.join(' ')).toContain('no numeric count widget');
 expect(result.limitations.join(' ')).toContain('without pagination or a numeric row cap');
 expect(result.spec.summary).not.toContain('list/count');
 expect(result.limitations.join(' ')).not.toContain('queue request ID');
 expect(result.limitations.join(' ')).toContain('Report has no write or proposal form');
});

it.each([
 ['extra read scope',(d:ProcessDraft)=>{d.choices.consentedScopes.push('read:contracts');}],
 ['duplicate role',(d:ProcessDraft)=>{d.choices.visibleToRoles.push('legal');}],
 ['duplicate scope',(d:ProcessDraft)=>{d.choices.consentedScopes.push('write:inbox-proposal');}],
 ['malformed ID',(d:ProcessDraft)=>{d.choices.appId='Process Review';}],
 ['unreviewable icon',(d:ProcessDraft)=>{d.choices.icon='x\nicon:';}],
] as const)('rejects %s without widening the draft ceiling',(_label,change)=>{
 const draft=completeDraft();change(draft);
 expect(buildProcessPlan(draft).status).toBe('invalid');
});

it.each(['loadedHourlyCostCents','annualRecurringCostCents','initialCostCents'] as const)('requires explicit currency for a known %s even when it is zero',key=>{
 const draft=completeDraft();draft.brief.roi[key]=0;
 const result=buildProcessPlan(draft);
 expect(result.status).toBe('needs-input');
 if(result.status!=='needs-input')return;
 expect(result.questions.map(q=>q.id)).toEqual(['currency']);
 draft.brief.currency='USD';
 const ready=buildProcessPlan(draft);
 expect(ready.status).toBe('ready');
 if(ready.status!=='ready')return;
 expect(ready.roi.status).toBe('incomplete');
 expect(ready.prd).toContain('currency: USD');
});

it('shows an estimated cash case only from explicit complete baselines and currency',()=>{
 const draft=completeDraft();
 draft.brief.roi={annualVolume:1200,baselineSeconds:600,targetSeconds:300,adoptionBasisPoints:10000,loadedHourlyCostCents:6000,cashRealizationBasisPoints:0,annualRecurringCostCents:20000,initialCostCents:100000};
 expect(buildProcessPlan(draft).status).toBe('needs-input');
 draft.brief.currency='EUR';
 const result=buildProcessPlan(draft);
 if(result.status!=='ready')throw Error(JSON.stringify(result));
 expect(result.roi).toMatchObject({status:'estimated',annualCapacitySeconds:360000,annualCashBenefitCents:0,firstYearNetCashCents:-120000,paybackMonthsMilli:null});
 expect(result.prd).toContain('not measured savings');
});

it.each(PROCESS_TEMPLATES)('passes $id through the real no-model builder with actual conformance and privacy gates',async template=>{
 const plan=buildProcessPlan(completeDraft(template.id));
 if(plan.status!=='ready')throw Error(JSON.stringify(plan));
 const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
 const result=await buildSubAppFromSpec({prompt:plan.buildPrompt,spec:plan.spec,understanding:template.description},{ctx:{actor:'Karsten Haldan'},digest,authorship:'first-party-operator'});
 expect(result.status,JSON.stringify(result)).toBe('proposed');
 if(result.status!=='proposed')return;
 expect(result.conformance.ok).toBe(true);
 expect(result.conformance.checks).toHaveLength(7);
 expect(result.artifacts.decision).toBe('allow');
 const expected=generateSubApp(plan.spec);
 expect(result.generated.files).toEqual(expected.files);
 expect(digest(JSON.stringify(result.generated.files))).toBe(digest(JSON.stringify(expected.files)));
 expect(result.generated.registryPatch).toEqual({file:expected.registryPatch.file,importLine:expected.registryPatch.importLine,entryLines:expected.registryPatch.entryLines});
 expect(result.generated.files.find(f=>f.kind==='manifest')?.contents).toContain('generatedBy: "flightdeck-studio"');
});

it('keeps exact canonical draft review separate from edit history and does not normalize meaningful edits',()=>{
 const draft=completeDraft();
 const original=buildProcessPlan(draft);
 if(original.status!=='ready')throw Error('ready');
 const edits:((d:ProcessDraft)=>void)[]=[d=>{d.brief.title+=' ';},d=>{d.brief.problem+=' More context.';},d=>{d.brief.outcome+=' Review first.';},d=>{d.brief.users+=' and counsel';},d=>{d.brief.systemOfRecord+=' Read only.';},d=>{d.brief.dataSensitivity='restricted';},d=>{d.brief.currency='USD';},d=>{d.brief.v1Features.push('Keep manual process review explicit');},d=>{d.brief.v2Features=[];},d=>{d.brief.acceptanceCriteria.push('No source record may change');},d=>{d.brief.roi.annualVolume=0;},d=>{d.choices.appId='another-review';},d=>{d.choices.icon='🔎';},d=>{d.choices.navSection='Admin';},d=>{d.choices.visibleToRoles=['legal','admin'];}];
 for(const edit of edits){const next=structuredClone(draft);edit(next);const result=buildProcessPlan(next);if(result.status!=='ready')throw Error(JSON.stringify(result));expect(result.reviewKey).not.toBe(original.reviewKey);}
 const reordered={choices:draft.choices,brief:Object.fromEntries(Object.entries(draft.brief).reverse())};
 const canonical=buildProcessPlan(reordered);
 if(canonical.status!=='ready')throw Error('canonical ready');
 expect(canonical.reviewKey).toBe(original.reviewKey);
 const reverted=buildProcessPlan(structuredClone(draft));
 if(reverted.status!=='ready')throw Error('reverted ready');
 expect(reverted.reviewKey).toBe(original.reviewKey); // UI owns monotonic edit revocation.
 expect(original.limitations.join(' ')).toContain('including reverted edits');
 expect(Object.isFrozen(PROCESS_TEMPLATES)).toBe(true);
 expect(PROCESS_TEMPLATES.every(t=>Object.isFrozen(t)&&Object.isFrozen(t.requiredScopes))).toBe(true);
});

it.each([
 ['missing required field',(d:ProcessDraft)=>{delete (d.choices as Partial<ProcessDraft['choices']>).icon;}],
 ['own undefined',(d:ProcessDraft)=>{Object.defineProperty(d.brief,'title',{value:undefined,enumerable:true});}],
 ['unknown field',(d:ProcessDraft)=>{Object.assign(d.brief,{table:'arbitrary'});}],
 ['arbitrary code',(d:ProcessDraft)=>{Object.assign(d.choices,{source:'ignored',activate:true});}],
 ['unsafe key',(d:ProcessDraft)=>{Object.defineProperty(d.brief,'__proto__',{value:{},enumerable:true});}],
 ['non-enumerable',(d:ProcessDraft)=>{Object.defineProperty(d.brief,'private',{value:1});}],
 ['cycle',(d:ProcessDraft)=>{Object.assign(d.brief,{loop:d});}],
 ['custom array prototype',(d:ProcessDraft)=>{Object.setPrototypeOf(d.brief.v1Features,{0:'prototype'});}],
 ['symbol',(d:ProcessDraft)=>{Object.assign(d.brief,{[Symbol('hidden')]:1});}],
 ['sparse array',(d:ProcessDraft)=>{d.brief.v1Features=new Array(3);}],
 ['array property',(d:ProcessDraft)=>{Object.assign(d.brief.v1Features,{extra:'hidden'});}],
 ['too many entries',(d:ProcessDraft)=>{d.brief.v1Features=Array(7).fill('A human reviewed requirement');}],
 ['too long entry',(d:ProcessDraft)=>{d.brief.v2Features=['x'.repeat(161)];}],
 ['oversized Unicode',(d:ProcessDraft)=>{d.brief.problem='🔎'.repeat(6000);}],
 ['ROI over percent',(d:ProcessDraft)=>{d.brief.roi.adoptionBasisPoints=10001;}],
 ['ROI NaN',(d:ProcessDraft)=>{d.brief.roi.baselineSeconds=NaN;}],
 ['unknown currency',(d:ProcessDraft)=>{d.brief.currency='dollars';}],
 ['unknown template',(d:ProcessDraft)=>{Object.assign(d.brief,{templateId:'sql-charts'});}],
 ['unknown role',(d:ProcessDraft)=>{Object.assign(d.choices,{visibleToRoles:['super_admin']});}],
 ['reserved ID',(d:ProcessDraft)=>{d.choices.appId='maps';}],
] as const)('refuses %s with fixed bounded errors',(_label,change)=>{
 const draft=completeDraft();change(draft);
 const result=buildProcessPlan(draft);
 expect(result.status).toBe('invalid');
 expect(JSON.stringify(result).length).toBeLessThan(120);
});

it('never invokes nested property or array accessors and accepts ordinary null-prototype records',()=>{
 let reads=0;
 for(const target of ['brief','choices','array','roi'] as const){
  const draft=completeDraft();
  const [object,key]=target==='brief'?[draft.brief,'title']:target==='choices'?[draft.choices,'icon']:target==='array'?[draft.brief.v1Features,'0']:[draft.brief.roi,'annualVolume'];
  Object.defineProperty(object,key,{enumerable:true,get(){reads++;throw Error('never');}});
  expect(parseProcessDraft(draft)).toBeNull();
  expect(buildProcessPlan(draft).status).toBe('invalid');
 }
 expect(reads).toBe(0);
 const draft=completeDraft();Object.setPrototypeOf(draft,null);Object.setPrototypeOf(draft.brief,null);
 expect(buildProcessPlan(draft).status).toBe('ready');
});

it('keeps the complete runtime import closure browser-safe without IO, model or host modules',()=>{
 const {seen,bare}=runtimeImportClosure(fileURLToPath(new URL('../../',import.meta.url)),[fileURLToPath(new URL('./plan.ts',import.meta.url))]);
 expect([...bare]).toEqual(['zod']);
 expect([...seen].some(p=>p.includes('/server/')||p.includes('/pipeline/')||p.includes('/apply.ts'))).toBe(false);
});

it.each(PROCESS_TEMPLATES)('asks only the required $id scopes after explicit metadata choices',template=>{
 const draft=completeDraft(template.id);draft.choices.consentedScopes=[];
 const result=buildProcessPlan(draft);
 if(result.status!=='needs-input')throw Error(JSON.stringify(result));
 expect(result.questions.map(q=>q.id)).toEqual(template.requiredScopes.map(scope=>`consent:${scope}`));
});

it('keeps meaningful human facts required even when a complete template and consent have been chosen',()=>{
 for(const key of ['title','problem','outcome','users','systemOfRecord','v1Features','acceptanceCriteria'] as const){
  const draft=completeDraft();
  if(key==='v1Features'||key==='acceptanceCriteria')draft.brief[key]=['  '];else draft.brief[key]='  ';
  const result=buildProcessPlan(draft);
  if(result.status!=='needs-input')throw Error(JSON.stringify(result));
  expect(result.questions.map(q=>q.id)).toEqual([key]);
 }
});

it('rejects oversized rendered documents rather than truncating human requirements or emitting an unbounded review key',()=>{
 const draft=completeDraft();
 Object.assign(draft.brief,{title:'a'.repeat(80),problem:'a'.repeat(600),outcome:'a'.repeat(400),users:'a'.repeat(240),systemOfRecord:'a'.repeat(300),v1Features:Array(6).fill('"'.repeat(160)),v2Features:Array(6).fill('"'.repeat(160)),acceptanceCriteria:Array(6).fill('"'.repeat(160))});
 expect(parseProcessDraft(draft)).not.toBeNull();
 expect(buildProcessPlan(draft)).toEqual({status:'invalid',issues:['process-document-limit']});
});

it('returns detached proposal data while preserving readonly template metadata across caller mutations',()=>{
 const draft=completeDraft();const first=buildProcessPlan(draft);
 if(first.status!=='ready')throw Error('ready');
 first.spec.capabilities.push('read:contracts');first.spec.domains=[];
 expect(draft.choices.consentedScopes).toEqual(['write:inbox-proposal']);
 const second=buildProcessPlan(draft);
 if(second.status!=='ready')throw Error('ready');
 expect(second.spec.capabilities).toEqual(['write:inbox-proposal']);
 expect(second.spec.domains.flatMap(d=>d.routes.map(r=>r.operation.kind))).toEqual(['list-proposals','propose']);
 const {proxy,revoke}=Proxy.revocable({},{});revoke();
 expect(buildProcessPlan(proxy)).toEqual({status:'invalid',issues:['invalid-process-draft']});
});
