import type {ProcessDraft,ProcessTemplateId} from './contracts';
import type {ProposedSubapp} from '../studio/result';
import {parseStudioResult} from '../studio/result';
import {z} from 'zod';
import {boundedJson} from '../../packages/workflow/data';
import {readStudioJson} from '../studio/connection';
import {parseProcessDraft,buildProcessPlan,PROCESS_TEMPLATES} from './plan';
import {generateSubApp} from '../../packages/codegen/src/pure';
import {generatedFileSchema,MAX_SUBAPP_FILES,actorSchema} from '../../packages/subapp-workspace/schema';
import {canonicalJson} from '../../packages/guardrails/src/hash';
import {auditBody,MAX_LOCATIONS_IN_EVENT} from '../../packages/guardrails/src/audit';
import {tierOf} from '../../packages/guardrails/src/findings';
import type {GateDecision} from '../../packages/guardrails/src/gates';
const invalid=()=>new Error('Invalid process response. No draft accepted.');
const templateId=z.enum(['operations-queue','case-workspace','analytical-report']);
const projectId=z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const requestSchema=z.object({projectId,draft:z.unknown(),reviewKey:z.string().min(1).max(32_000),templateVersion:z.string().min(1).max(80)}).strict();
// Durable source labels/bounds are shared; "unknown" is a working-overlay
// category, not a kind the native generator can emit.
const inventorySchema=z.array(generatedFileSchema.refine(file=>file.kind!=='unknown')).min(1).max(MAX_SUBAPP_FILES);
const hashSchema=z.string().regex(/^[a-f0-9]{64}$/),receiptText=z.string().min(1).max(2_000);
const tierSchema=z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]);
const gateFindingSchema=z.object({
 class:receiptText,tier:tierSchema,via:z.enum(['value-pattern','field-name','special-category','label','value-shape','artifact-path']),where:receiptText,
 offset:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),count:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().transform(({offset,count,...finding})=>({...finding,...(offset===undefined?{}:{offset}),...(count===undefined?{}:{count})}));
// Applicable native success subset of GateDecision: generated-artifacts has
// NO tier-3/4 approval path (GATE_POLICY), and this pipeline supplies no approval.
const generatedArtifactsSchema=z.object({
 gate:z.literal('generated-artifacts'),decision:z.literal('allow'),tier:z.union([z.literal(1),z.literal(2)]),
 findings:z.array(gateFindingSchema).max(1_000),reason:receiptText,contentHash:hashSchema,
 audit:z.object({event:z.literal('guardrails.generated-artifacts-allowed'),actor:actorSchema,subject:receiptText,decision:z.literal('allow'),tier:tierSchema,
  classes:z.array(receiptText).max(1_000),locations:z.array(receiptText).max(MAX_LOCATIONS_IN_EVENT),findingCount:z.number().int().min(0).max(1_000),contentHash:hashSchema,
 }).strict(),
}).strict();
async function sha256(source:string):Promise<string>{
 return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))),byte=>byte.toString(16).padStart(2,'0')).join('');
}
const receiptSchema=z.object({status:z.literal('process-built'),projectId:z.string().min(1).max(64),reviewKey:z.string().min(1).max(32_000),templateId,templateVersion:z.string().min(1).max(80),artifactId:hashSchema,outcome:z.unknown()}).strict();
export interface ProcessBuildRequest {projectId:string;draft:ProcessDraft;reviewKey:string;templateVersion:string}
export interface ProcessBuilt {status:'process-built';projectId:string;reviewKey:string;templateId:ProcessTemplateId;templateVersion:string;artifactId:string;outcome:ProposedSubapp}
async function performBuild(request:ProcessBuildRequest,token:string,signal:AbortSignal,fetcher:typeof fetch):Promise<ProcessBuilt>{
 let plan:Extract<ReturnType<typeof buildProcessPlan>,{status:'ready'}>|undefined;
 try{
  if(boundedJson(request,64_000,20,10_000)){
   const parsed=requestSchema.safeParse(request);
   if(parsed.success){
    const draft=parseProcessDraft(parsed.data.draft),compiled=buildProcessPlan(draft);
    if(draft&&compiled.status==='ready'&&compiled.reviewKey===parsed.data.reviewKey&&PROCESS_TEMPLATES.some(template=>template.id===compiled.templateId&&template.version===parsed.data.templateVersion)){
     request={...parsed.data,draft};plan=compiled;
    }
   }
  }
 }catch{/* Preflight traps are refusal, never transport diagnostics. */}
 if(!plan)throw new Error('Invalid process request. No draft accepted.');
 if(typeof token!=='string'||!token||token.length>8192||/[\r\n]/.test(token))throw new Error('Authentication refused. No draft accepted.');
 let response:Response;
 try{response=await fetcher('/api/studio/process/build',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json',Authorization:`Bearer ${token}`},signal,body:JSON.stringify({projectId:request.projectId,draft:request.draft,reviewKey:request.reviewKey})});}
 catch{throw new Error('Process build server unavailable. No draft accepted.');}
 if(signal.aborted){void response.body?.cancel().catch(()=>{});throw cancelled();}
 if(!response.ok){void response.body?.cancel().catch(()=>{});throw new Error(response.status===401||response.status===403?'Authentication refused. No draft accepted.':response.status===409?'Process review changed. Review again. No draft accepted.':response.status===429?'Studio is busy. No automatic retry. No draft accepted.':'Process build API unavailable. No automatic retry. No draft accepted.');}
 const wire=await readAbortableJson(response,signal);
 if(!boundedJson(wire,2_000_000,24,50_000))throw invalid();
 const receipt=receiptSchema.safeParse(wire);if(!receipt.success)throw invalid();
 const value=receipt.data;
 if(value.projectId!==request.projectId||value.reviewKey!==request.reviewKey||value.templateId!==request.draft.brief.templateId||value.templateVersion!==request.templateVersion)throw invalid();
 const parsed=parseStudioResult({status:'subapp-result',target:'subapp',determination:{target:'subapp',reason:'Explicit registered template; no model invoked.'},outcome:value.outcome});
 if(parsed.status!=='subapp-result'||parsed.outcome.status!=='proposed'||!parsed.outcome.conformance.ok||parsed.outcome.generated.plan.id!==request.draft.choices.appId)throw invalid();
 const conformance=parsed.outcome.conformance;
 if(conformance.findings.some(finding=>finding.severity==='error')||(conformance.errors!==undefined&&(!Array.isArray(conformance.errors)||conformance.errors.length!==0)))throw invalid();
 const gate=generatedArtifactsSchema.safeParse(parsed.outcome.artifacts);if(!gate.success)throw invalid();
 const artifacts:GateDecision=gate.data;
 if(artifacts.tier!==tierOf(artifacts.findings))throw invalid();
 const local=generateSubApp(plan.spec),received=parsed.outcome.generated.plan;
 // Bind the complete Candidate.manifest scalar projection to the exact local
 // deterministic plan, not merely to mutually consistent untrusted metadata.
 if((['id','label','version','summary','routePrefix','webModuleId','envVar','tablePrefix'] as const).some(key=>received[key]!==local.plan[key]))throw invalid();
 const manifest=received.manifestData;
 // The native SDK also carries these identity/dependency fields in its
 // manifestData mirror; missing or contradictory copies are not admissible.
 if((['id','label','version','routePrefix','webModuleId','minHostVersion'] as const).some(key=>manifest[key]!==local.plan.manifestData[key]))throw invalid();
 const sameChoices=(left:readonly string[],right:readonly string[])=>JSON.stringify([...left].sort())===JSON.stringify([...right].sort());
 if(manifest.navSection!==request.draft.choices.navSection||manifest.icon!==request.draft.choices.icon||!sameChoices(manifest.visibleToRoles,request.draft.choices.visibleToRoles)||!sameChoices(manifest.capabilities,request.draft.choices.consentedScopes))throw invalid();
 const files=parsed.outcome.generated.files;
 // The closed template spec and existing pure generator own the inventory,
 // including standalone SDK files outside the app directory. Never invent or
 // normalize paths and never evaluate received source to establish identity.
 if(!inventorySchema.safeParse(files).success)throw invalid();
 const expected=new Map(local.files.map(file=>[file.path,file.kind]));
 if(files.length!==expected.size||new Set(files.map(file=>file.path)).size!==files.length||files.some(file=>expected.get(file.path)!==file.kind))throw invalid();
 const source=JSON.stringify(files.map(file=>({path:file.path,kind:file.kind,contents:file.contents})));
 const hash=await sha256(source);
 // Native build-subapp-spec.ts gates ONLY host files, projected as {path,
 // content}; contentHash sorts object keys but preserves file order. artifactId
 // instead hashes ordered {path,kind,contents} for ALL emitted files. Neither
 // hash, the supplied actor nor this audit-body consistency check is a privacy
 // authority, an appended audit event, independent review or a host grant.
 const host=files.filter(file=>file.kind!=='standalone').map(file=>({path:file.path,content:file.contents}));
 const gateHash=await sha256(canonicalJson(host));
 const expectedAudit=auditBody({event:'guardrails.generated-artifacts-allowed',actor:gate.data.audit.actor,subject:`<${host.length} files>`,decision:'allow',classification:{tier:artifacts.tier,findings:artifacts.findings},contentHash:gateHash});
 if(signal.aborted)throw cancelled();
 if(hash!==value.artifactId||artifacts.contentHash!==gateHash||canonicalJson(gate.data.audit)!==canonicalJson(expectedAudit))throw invalid();
 return {...value,outcome:parsed.outcome};
}
const cancelled=()=>new Error('Process build cancelled. No draft accepted.');
/** Bridge the shared byte-bounded reader; never await untrusted source cancellation. */
async function readAbortableJson(response:Response,signal:AbortSignal):Promise<unknown>{
 const reader=response.body?.getReader();if(!reader)throw invalid();
 const cancelSource=()=>{void reader.cancel().catch(()=>{});};
 let owner!:ReadableStreamDefaultController<Uint8Array>;
 const stream=new ReadableStream<Uint8Array>({
  start(sink){owner=sink;},
  async pull(sink){
   try{
    if(signal.aborted)throw cancelled();
    const part=await reader.read();
    if(signal.aborted)throw cancelled();
    if(part.done)sink.close();else sink.enqueue(part.value);
   }catch{cancelSource();sink.error(invalid());}
  },
  cancel(){cancelSource();},
 },{highWaterMark:0});
 const onAbort=()=>{cancelSource();owner.error(cancelled());};
 signal.addEventListener('abort',onAbort,{once:true});
 try{
  if(signal.aborted)throw cancelled();
  return await readStudioJson(new Response(stream,{headers:response.headers}),2_000_000);
 }catch{throw invalid();}
 finally{signal.removeEventListener('abort',onAbort);cancelSource();try{reader.releaseLock();}catch{/* A pending source read retains its lock until settlement. */}}
}
const safeErrors=new Set(['Invalid process request. No draft accepted.','Authentication refused. No draft accepted.','Process build server unavailable. No draft accepted.','Process review changed. Review again. No draft accepted.','Studio is busy. No automatic retry. No draft accepted.','Process build API unavailable. No automatic retry. No draft accepted.']);
/** Only an explicit caller action sends. Cancellation rejects admission, not proof of server interruption. */
export async function buildProcessDraft(request:ProcessBuildRequest,token:string,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<ProcessBuilt>{
 if(signal.aborted)throw cancelled();
 const abort=new AbortController();let deadline=false;
 const forwardAbort=()=>abort.abort();signal.addEventListener('abort',forwardAbort,{once:true});
 const timer=setTimeout(()=>{deadline=true;abort.abort();},30_000);
 let rejectAbort!:()=>void;
 const aborted=new Promise<never>((_resolve,reject)=>{rejectAbort=()=>reject(cancelled());abort.signal.addEventListener('abort',rejectAbort,{once:true});});
 try{return await Promise.race([performBuild(request,token,abort.signal,fetcher),aborted]);}
 catch(error){
  if(abort.signal.aborted)throw deadline?new Error('Process build deadline reached. No automatic retry. No draft accepted.'):cancelled();
  if(error instanceof Error&&safeErrors.has(error.message))throw error;
  throw invalid();
 }finally{clearTimeout(timer);signal.removeEventListener('abort',forwardAbort);abort.signal.removeEventListener('abort',rejectAbort);}
}
