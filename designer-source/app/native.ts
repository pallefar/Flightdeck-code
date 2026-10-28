import {z} from 'zod/v4';
import {parsePageDoc,type PageDocV2} from '../mirror/flightdeck/pagedoc/schema/index.js';
/** Context is an association supplied by an authenticated host, NEVER authority. */
export interface DesignerContext {workspaceId:string;projectId:string;/** Exact current page writer's actorOf(req) username, matching readback.by; not a display label or an assumed database UUID. */actorId:string;epoch:string}
export interface OsPageTarget {kind:'os-project';pageId:string}
export interface NativeReadback {context:DesignerContext;target:OsPageTarget;rev:number;doc:unknown;by:string|null}
export interface NativeCommit {rev:number;sha256:string}
/** Trusted adapter-only evidence of a definite rejection before any commit. */
export interface NativeWriteRefusal {status:'refused';reason:'conflict'|'forbidden'|'invalid'|'not-found'}
export interface NativeAttempt {id:string;context:DesignerContext;target:OsPageTarget;baseRev:number;doc:PageDocV2}
/** Trusted in-process host adapter. Rechecks canonical auth/context/CAS server-side. */
export interface NativePageAdapter {write(attempt:Readonly<NativeAttempt>):Promise<NativeCommit|NativeWriteRefusal>;read(context:Readonly<DesignerContext>,target:Readonly<OsPageTarget>):Promise<NativeReadback>}
export interface NativeBinding {context:DesignerContext;target:OsPageTarget;baseRev:number;adapter:NativePageAdapter}
export type NativeSaveResult={status:'saved';rev:number;doc:PageDocV2}|{status:'refused'|'uncertain';reason:string};
const identifier=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const contextSchema=z.strictObject({workspaceId:identifier,projectId:identifier,actorId:z.string().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/),epoch:identifier});
const targetSchema=z.strictObject({kind:z.literal('os-project'),pageId:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)});
const revSchema=z.number().int().min(0).max(999999999);
export function detachDocument(input:unknown):PageDocV2 {const p=parsePageDoc(input);if(!p.ok)throw Error('Invalid PageDoc v2');return JSON.parse(JSON.stringify(p.doc)) as PageDocV2;}
export function documentBytes(input:unknown):string{return JSON.stringify(detachDocument(input));}
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
export async function documentSHA256(input:unknown):Promise<string>{const d=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(documentBytes(input)));return [...new Uint8Array(d)].map(n=>n.toString(16).padStart(2,'0')).join('');}
/** Only a trusted adapter's definite rejection BEFORE commit may use this class. */
export class NativePrecommitRefusal extends Error {constructor(public readonly reason:'conflict'|'forbidden'|'invalid'|'not-found'){super(reason);}}
export function snapshotNativeBinding(binding:NativeBinding):NativeBinding {const original=binding.adapter;if(typeof original?.write!=='function'||typeof original?.read!=='function')throw Error('Native adapter missing');return {context:contextSchema.parse(binding.context),target:targetSchema.parse(binding.target),baseRev:revSchema.parse(binding.baseRev),adapter:{write:original.write.bind(original),read:original.read.bind(original)}};}
export function createNativeSession(input:NativeBinding){
 const binding=snapshotNativeBinding(input),context=binding.context,target=binding.target,adapter=binding.adapter;
 if(typeof adapter?.write!=='function'||typeof adapter?.read!=='function')throw Error('Native adapter missing');
 let baseRev=revSchema.parse(binding.baseRev),status:'idle'|'reading'|'saving'|'uncertain'|'reconciling'|'retired'='idle',attempt:NativeAttempt|null=null,retired=false;
 const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
 const read=async()=>{const r=await adapter.read(clone(context),clone(target));if(!same(contextSchema.parse(r.context),context)||!same(targetSchema.parse(r.target),target)||!Number.isSafeInteger(r.rev)||r.rev<0||r.rev>999999999)throw Error('Native readback association mismatch');return {...r,doc:detachDocument(r.doc)};};
 const unavailable=():NativeSaveResult=>({status:'refused',reason:'retired'});
 const uncertain=():NativeSaveResult=>{status='uncertain';return {status:'uncertain',reason:'Native write/readback not verified; retry refused'};};
 return {
  snapshot:()=>({status,baseRev,context:clone(context),target:clone(target),attempt:attempt?clone(attempt):null}),
  retire(){retired=true;status='retired';},
  async save(input:unknown):Promise<NativeSaveResult>{
   if(status!=='idle')return {status:'refused',reason:status};
   const doc=detachDocument(input);attempt={id:globalThis.crypto.randomUUID(),context:clone(context),target:clone(target),baseRev,doc};status='saving';
   let committed=false;
   try{const ack=await adapter.write(clone(attempt));if(retired)return unavailable();if('status' in ack){if(ack.status!=='refused'||!['conflict','forbidden','invalid','not-found'].includes(ack.reason))throw Error('Invalid adapter refusal');status='idle';attempt=null;return {status:'refused',reason:ack.reason};}committed=true;const back=await read();if(ack.rev!==baseRev+1||back.rev!==ack.rev||back.by!==context.actorId||!same(back.doc,doc)||ack.sha256!==await documentSHA256(doc))throw Error('Native exact readback mismatch');if(retired)return unavailable();baseRev=ack.rev;attempt=null;status='idle';return {status:'saved',rev:baseRev,doc:clone(doc)};}catch(e:unknown){if(retired)return unavailable();if(!committed&&e instanceof NativePrecommitRefusal){status='idle';attempt=null;return {status:'refused',reason:e.reason};}return uncertain();}
  },
  async reconcile():Promise<NativeSaveResult>{if(status!=='uncertain'||!attempt)return {status:'refused',reason:status};const original=attempt;status='reconciling';try{const back=await read();if(retired)return unavailable();if(back.rev!==original.baseRev+1||back.by!==original.context.actorId||!same(back.doc,original.doc))return uncertain();baseRev=back.rev;attempt=null;status='idle';return {status:'saved',rev:baseRev,doc:clone(back.doc)};}catch{if(retired)return unavailable();return uncertain();}},
  async reopen(){if(status!=='idle')throw Error('Native session is '+status);status='reading';try{const back=await read();if(retired)throw Error('Native session retired');baseRev=back.rev;return back;}finally{if(!retired)status='idle';}},
 };
}
export type NativeSession=ReturnType<typeof createNativeSession>;
