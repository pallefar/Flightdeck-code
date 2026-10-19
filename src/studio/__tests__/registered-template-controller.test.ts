import {beforeAll,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {StudioController} from '../controller';
import {buildSubAppFromSpec} from '../../../packages/pipeline/src/build-subapp-spec';
import {buildProcessPlan,PROCESS_TEMPLATES} from '../../process-studio/plan';
import {parseStudioResult,type ProposedSubapp} from '../result';
import {completeProcessDraft} from './process-template-fixture';

let outcome:ProposedSubapp;
let prd:string;
const receipt=()=>({projectId:'development-process',templateId:'operations-queue' as const,templateVersion:'1.0.0',artifactId:'a'.repeat(64),prd});
beforeAll(async()=>{
 const draft=completeProcessDraft(),plan=buildProcessPlan(draft);if(plan.status!=='ready')throw new Error('Complete development plan required');prd=plan.prd;
 const native=await buildSubAppFromSpec({prompt:plan.buildPrompt,spec:plan.spec,understanding:PROCESS_TEMPLATES[0]!.description,answers:{icon:draft.choices.icon,navSection:draft.choices.navSection!,visibleToRoles:draft.choices.visibleToRoles.join(','),...Object.fromEntries(draft.choices.consentedScopes.map(scope=>[`consent:${scope}`,'yes']))}},{ctx:{actor:'Development Operator'},digest:text=>createHash('sha256').update(text).digest('hex'),authorship:'first-party-operator'});
 const parsed=parseStudioResult({status:'subapp-result',target:'subapp',determination:{target:'subapp',reason:'Explicit registered template'},outcome:native});
 if(parsed.status!=='subapp-result'||parsed.outcome.status!=='proposed')throw new Error('Real native SDK fixture required');outcome=parsed.outcome;
});
it('adopts the real validated template source into existing Workbench without a model request or fake model determination',()=>{
 const fetcher=vi.fn<typeof fetch>();const controller=new StudioController(fetcher);
 expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(true);
 const source=controller.workbench.getState();
 expect(source.rounds).toHaveLength(1);expect(source.rounds[0]!.candidate.files).toEqual(outcome.generated.files.filter(file=>file.kind!=='standalone'));
 expect(controller.getState()).toMatchObject({phase:'idle',result:null,acceptedRequestId:null});
 expect(controller.getState().transcript).toHaveLength(2);expect(controller.getState().transcript[1]).toMatchObject({role:'studio',status:'settled',destination:{connectionId:'registered-template',projectId:'development-process'}});
 expect(controller.getState().transcript[1]!.text).toContain('No model invoked');expect(fetcher).not.toHaveBeenCalled();
});
it('retains an unsaved-only source buffer when the real SDK template regenerates identical bytes',()=>{
 const fetcher=vi.fn<typeof fetch>();const controller=new StudioController(fetcher);
 const source=outcome.generated.files.find(file=>file.kind==='web-module');if(!source)throw new Error('Real SDK web module required');
 const unsaved=source.contents+'\r\n// Pending: café e\u0301 🧭\r\n';
 expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(true);
 expect(controller.workbench.editFile(source.path,unsaved)).toBeNull();
 expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(true);
 const state=controller.workbench.getState(),retained=state.drafts.get(source.path);
 expect(retained?.buffer).toBe(unsaved);expect(retained?.saved).toBeNull();
 expect(retained?.generated).toBe(source.contents);expect(retained?.roundId).toBe(state.selectedRoundId);
 expect(retained?.conflict?.incoming).toBe(source.contents);
 expect(state.rounds).toHaveLength(2);expect(controller.workbench.effectiveFiles().find(file=>file.path===source.path)?.contents).toBe(source.contents);
 expect(fetcher).not.toHaveBeenCalled();
});
it('keeps saved source and the latest pending buffer independent across real template receipts',()=>{
 const fetcher=vi.fn<typeof fetch>();const controller=new StudioController(fetcher);
 const source=outcome.generated.files.find(file=>file.kind==='web-module');if(!source)throw new Error('Real SDK web module required');
 const saved=source.contents+'\r\n// Saved: café 保留\r\n';
 const pending=saved+'// Pending: e\u0301 🧭\r\n';
 const latest=pending+'// Typed after conflict opened: Δ\r\n\t';
 expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(true);
 controller.workbench.editFile(source.path,saved);expect(controller.workbench.saveFile(source.path)).toBe(true);
 controller.workbench.editFile(source.path,pending);
 expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(true);
 expect(controller.workbench.getState().drafts.get(source.path)?.saved).toBe(saved);
 expect(controller.workbench.getState().drafts.get(source.path)?.buffer).toBe(pending);
 expect(controller.workbench.editFile(source.path,latest)).toBeNull();
 expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(true);
 controller.workbench.resolveConflict(source.path,'mine');
 const kept=controller.workbench.getState().drafts.get(source.path);
 expect(kept?.generated).toBe(source.contents);expect(kept?.saved).toBe(saved);expect(kept?.buffer).toBe(latest);expect(kept?.conflict).toBeNull();
 expect(controller.workbench.effectiveFiles().find(file=>file.path===source.path)?.contents).toBe(saved);
 expect(controller.workbench.getState().rounds.every(round=>round.candidate.files.find(file=>file.path===source.path)?.contents===source.contents)).toBe(true);
 expect(controller.workbench.getState().rounds).toHaveLength(3);expect(fetcher).not.toHaveBeenCalled();
});
it('keeps a repeated clean real template source free of unnecessary drafts',()=>{
 const fetcher=vi.fn<typeof fetch>();const controller=new StudioController(fetcher);
 expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(true);
 expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(true);
 expect(controller.workbench.getState().drafts.size).toBe(0);
 expect(controller.workbench.getState().rounds).toHaveLength(2);
 expect(controller.workbench.effectiveFiles()).toEqual(outcome.generated.files.filter(file=>file.kind!=='standalone'));
 expect(fetcher).not.toHaveBeenCalled();
});
it('does not cancel or replace an already pending AI request when a template receipt arrives',async()=>{
 let release!:(response:Response)=>void;
 const held=new Promise<Response>(resolve=>{release=resolve;});
 const fetcher=vi.fn<typeof fetch>(()=>held);const controller=new StudioController(fetcher);
 const pending=controller.submit({connectionId:'local',prompt:'Development concurrency control'},'development-only-token');
 const before=controller.getState(),source=controller.workbench.getState();
 try{
  expect(before.phase).toBe('requesting');
  expect(controller.acceptRegisteredTemplate(outcome,receipt())).toBe(false);
  expect(controller.getState()).toBe(before);expect(controller.workbench.getState()).toBe(source);
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
 }finally{controller.cancel();release(new Response('{}',{status:200,headers:{'content-type':'application/json'}}));await pending;}
});
it.each(['conformance-failed','error-finding','privacy-refused'] as const)('refuses %s without changing the existing source or conversation',kind=>{
 const controller=new StudioController();const before=controller.getState(),source=controller.workbench.getState();
 const invalid=structuredClone(outcome);
 if(kind==='conformance-failed')invalid.conformance.ok=false;
 if(kind==='error-finding')invalid.conformance.findings.push({rule:'development-negative-control',severity:'error',file:'(candidate)',line:0,column:0,message:'Explicit failing source finding',evidence:null});
 if(kind==='privacy-refused')invalid.artifacts.decision='refuse';
 expect(controller.acceptRegisteredTemplate(invalid,receipt())).toBe(false);
 expect(controller.getState()).toBe(before);expect(controller.workbench.getState()).toBe(source);
});
