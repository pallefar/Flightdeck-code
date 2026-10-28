import { graphSchema, type Graph } from '../packages/workflow/graph.js';
import { boundedJson } from '../packages/workflow/data.js';
import type { WorkflowDraft } from '../server/workflow-workspace-store.js';
export interface Scope {workspaceId:string;projectId:string}
export interface Context {serverSelectionVerified:true;actor:{username:string;displayName:string};scope:Scope;sessionView:string;csrf:string;projects:Array<{id:string;label:string;enabled:boolean}>}
export class ClientError extends Error {constructor(readonly uncertain=false,readonly stale=false,readonly association?:WorkflowDraft){super('Studio request refused');}}
interface Options {origin:string;locationOrigin?:()=>string|undefined;fetchImpl?:typeof fetch}
interface Attempt {scope:Scope;actor:string;sessionView:string;graph:Graph;id?:string;revision:number;associated?:WorkflowDraft}
const slug=(v:unknown):string=>{if(typeof v!=='string'||v.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v))throw new ClientError();return v;};
const tuple=(s:Scope):Scope=>({workspaceId:slug(s.workspaceId),projectId:slug(s.projectId)});
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new ClientError();return v as Record<string,unknown>;};
const uuid=(v:unknown):string=>{if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v))throw new ClientError();return v;};
const canonicalActor=(v:unknown):v is string=>typeof v==='string'&&/^[^\s\x00-\x1f\x7f]{1,200}$/.test(v)&&v===v.trim().toLowerCase();
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function contextDTO(raw:unknown,scope:Scope):Context {
 const r=record(raw),a=record(r.actor),s=record(r.scope);
 if(r.serverSelectionVerified!==true||s.workspaceId!==scope.workspaceId||s.projectId!==scope.projectId||!canonicalActor(a.username)||typeof a.displayName!=='string'||a.displayName.length>500
  ||typeof r.sessionView!=='string'||!/^[a-f0-9]{64}$/.test(r.sessionView)||typeof r.csrf!=='string'||!/^[a-f0-9]{64}$/.test(r.csrf)||!Array.isArray(r.projects)||r.projects.length>1000)throw new ClientError();
 const projects=r.projects.map(v=>{const p=record(v);if(typeof p.label!=='string'||p.label.length>500||typeof p.enabled!=='boolean')throw new ClientError();return {id:slug(p.id),label:p.label,enabled:p.enabled};});
 if(!projects.some(p=>p.id===scope.projectId&&p.enabled)||new Set(projects.map(p=>p.id)).size!==projects.length)throw new ClientError();
 return {serverSelectionVerified:true,actor:{username:a.username,displayName:a.displayName},scope:{...scope},sessionView:r.sessionView,csrf:r.csrf,projects};
}
// Canonical validation is the shared server draftSchema. These are bounded
// browser disclosure/type guards, not a second persistence schema.
function draftDTO(raw:unknown,scope:Scope):WorkflowDraft {
 const r=record(raw);const keys=['id','projectId','revision','graph','status','createdBy','updatedBy','createdAt','updatedAt','approvalBindings'];
 if(Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k))||r.projectId!==scope.projectId||r.status!=='draft'||typeof r.revision!=='number'||!Number.isSafeInteger(r.revision)||r.revision<1
  ||!['createdBy','updatedBy'].every(k=>canonicalActor(r[k]))||typeof r.createdAt!=='string'||typeof r.updatedAt!=='string'||!Array.isArray(r.approvalBindings))throw new ClientError();
 uuid(r.id);graphSchema.parse(r.graph);return structuredClone(r) as unknown as WorkflowDraft;
}
export function createOSSession(options:Options) {
 const location=options.locationOrigin??(()=>globalThis.location?.origin),fetcher=options.fetchImpl??globalThis.fetch.bind(globalThis);
 const u=new URL(options.origin);if(!['http:','https:'].includes(u.protocol)||u.origin!==options.origin)throw new ClientError();
 let epoch=0,abort=new AbortController(),closed=false,busy=false,activeDispatched=false,context:Context|null=null,editor:Graph|null=null,draft:WorkflowDraft|null=null,uncertain:Attempt|null=null,quarantined=false;
 const listeners=new Set<()=>void>();const notify=()=>{for(const fn of listeners)fn();};
 const check=(e:number)=>{if(closed||e!==epoch||abort.signal.aborted||location()!==options.origin)throw new ClientError(false,true);};
 const collection=(s:Scope)=>`/api/studio/workspaces/${s.workspaceId}/projects/${s.projectId}/drafts`;
 async function wire(path:string,scope:Scope,e:number,method='GET',body?:unknown,csrf?:string):Promise<unknown> {
  check(e);let response:Response;
  try{response=await fetcher(path,{method,mode:'same-origin',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal,headers:{Accept:'application/json','X-Workspace-Id':scope.workspaceId,'X-Project-Id':scope.projectId,...(body===undefined?{}:{'Content-Type':'application/json'}),...(csrf?{'X-Studio-CSRF':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{check(e);throw new ClientError(method!=='GET');}
  check(e);
  if(response.status===401||response.status===403){if(e===epoch)clear();throw new ClientError(false,true);}
  if(response.status!==200&&response.status!==201)throw new ClientError(method!=='GET'&&![400,401,403,404,409,413].includes(response.status));
  if(response.redirected||response.url&&response.url!==options.origin+path||!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)throw new ClientError(method!=='GET');
  const reader=response.body.getReader();let total=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader.read();check(e);if(part.done)break;total+=part.value.byteLength;if(total>16_000_000)throw new ClientError(method!=='GET');chunks.push(part.value);}}catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  check(e);let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ClientError(method!=='GET');}
  if(!boundedJson(value,16_000_000,40,500_000,1000))throw new ClientError(method!=='GET');return value;
 }
 async function fresh(expected:Context,e:number) {
  try {
   const next=contextDTO(await wire('/api/studio/context',expected.scope,e),expected.scope);
   if(next.sessionView!==expected.sessionView||next.actor.username!==expected.actor.username)throw new ClientError(false,true);
   return next;
  } catch(error:unknown) {
   // A refused/mismatched fresh identity never leaves the previous private UI
   // presented as current. A dispatched save is quarantined by clear().
   if(e===epoch)clear();
   throw new ClientError(false,true);
  }
 }
 async function read(s:Scope,id:string,e:number){const expected=uuid(id);const r=record(await wire(collection(s)+'/'+expected,s,e));if(r.workspaceId!==s.workspaceId||r.projectId!==s.projectId)throw new ClientError();const d=draftDTO(r.draft,s);if(d.id!==expected)throw new ClientError();return d;}
 function clear(){epoch++;abort.abort();abort=new AbortController();context=null;editor=null;draft=null;busy=false;if(uncertain||activeDispatched){quarantined=true;uncertain=null;}activeDispatched=false;notify();}
 function available(){if(!context||busy||uncertain||quarantined||closed)throw new ClientError();return structuredClone(context);}
 return {
  snapshot:()=>structuredClone({context,editor,draft,busy,uncertain:!!uncertain||quarantined}),
  subscribe(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};},
  clear,
  async select(input:Scope){const scope=tuple(input);clear();const e=epoch;const result=contextDTO(await wire('/api/studio/context',scope,e),scope);check(e);context=result;notify();return structuredClone(result);},
  edit(value:Graph){available();editor=graphSchema.parse(value);notify();},
  async list(){const c=available(),e=epoch;await fresh(c,e);const r=record(await wire(collection(c.scope),c.scope,e));if(r.workspaceId!==c.scope.workspaceId||r.projectId!==c.scope.projectId||!Array.isArray(r.drafts))throw new ClientError();await fresh(c,e);return r.drafts.map(v=>draftDTO(v,c.scope));},
  async load(id:string){const c=available(),e=epoch;busy=true;notify();try{await fresh(c,e);const d=await read(c.scope,id,e);await fresh(c,e);check(e);draft=d;editor=d.graph;notify();return structuredClone(d);}finally{if(e===epoch)busy=false;notify();}},
  async save(){const c=available(),e=epoch;if(!editor)throw new ClientError();const graph=graphSchema.parse(editor),previous=draft?structuredClone(draft):null;
   const attempt:Attempt={scope:c.scope,actor:c.actor.username,sessionView:c.sessionView,graph,...(previous?{id:previous.id}:{}),revision:previous?previous.revision+1:1};busy=true;notify();let dispatched=false,associated:WorkflowDraft|undefined;
   try{
    const current=await fresh(c,e);check(e);dispatched=true;activeDispatched=true;
    const raw=record(await wire(collection(c.scope)+(previous?'/'+previous.id:''),c.scope,e,previous?'PUT':'POST',previous?{graph,expectedRevision:previous.revision}:{graph},current.csrf));
    if(raw.workspaceId!==c.scope.workspaceId||raw.projectId!==c.scope.projectId)throw new ClientError(true);
    associated=draftDTO(raw.draft,c.scope);
    if(associated.updatedBy!==c.actor.username||associated.revision!==attempt.revision||previous&&associated.id!==previous.id||!equal(associated.graph,graph))throw new ClientError(true);
    attempt.id=associated.id;attempt.associated=associated;
    const saved=await read(c.scope,associated.id,e);await fresh(c,e);check(e);
    if(!equal(saved,associated))throw new ClientError(true);
    draft=saved;editor=saved.graph;return structuredClone(saved);
   }catch(error:unknown){
    const ambiguity=dispatched&&(!(error instanceof ClientError)||error.uncertain||error.stale||associated!==undefined);
    if(ambiguity){if(e===epoch)uncertain=attempt;else quarantined=true;}
    if(error instanceof ClientError&&error.stale&&e===epoch){clear();}
    throw new ClientError(ambiguity,error instanceof ClientError&&error.stale,associated);
   }finally{if(e===epoch){busy=false;activeDispatched=false;}notify();}
  },
  async reconcile(){if(!uncertain||!context||busy||!uncertain.id)throw new ClientError(true);const a=structuredClone(uncertain),c=structuredClone(context),e=epoch;
   if(!equal(a.scope,c.scope)||a.sessionView!==c.sessionView||a.actor!==c.actor.username)throw new ClientError(true);
   busy=true;notify();try{
    await fresh(c,e);const d=await read(a.scope,a.id!,e);await fresh(c,e);check(e);
    if(!equal(uncertain,a)||d.revision!==a.revision||d.updatedBy!==a.actor||!equal(d.graph,a.graph)||a.associated&&!equal(d,a.associated))throw new ClientError(true);
    draft=d;editor=d.graph;uncertain=null;notify();return structuredClone(d);
   }finally{if(e===epoch)busy=false;notify();}
  },
  close(){clear();closed=true;listeners.clear();},
 };
}
export type OSSession=ReturnType<typeof createOSSession>;
