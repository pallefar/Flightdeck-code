import {admitSerializedJson,boundedUtf8Bytes,createPublicReuseCatalog,isMetadataList,isReuseDetail,parseReuseQuery,parseReuseSelection,reviewedDetailStillMatches,type ReuseMetadata,type ReuseDetail,type ReuseSelection} from './catalog';
import {MAX_REQUEST_BYTES,MAX_TEXT_CHARS} from '../../packages/envelope/src/allowlists';
export interface ComposerSnapshot {readonly contextEpoch:number;readonly revision:number;readonly text:string}
export interface CatalogPort {
 readonly list:(input:unknown,signal:AbortSignal)=>Promise<unknown>;
 readonly detail:(input:unknown,signal:AbortSignal)=>Promise<unknown>;
}
/** Trusted synchronous app bridge; JSON responses are admitted before inspection. */
export interface ComposerPort {
 readonly read:()=>unknown;
 readonly measure:(text:string)=>unknown;
 /** Check isCurrent and the exact tuple again after any reentrant review notification,
  * immediately before the one synchronous editPrompt mutation. Never await it. */
 readonly compareAndSet:(expected:ComposerSnapshot,nextText:string,isCurrent:()=>boolean)=>unknown;
}
export interface ReuseControllerPorts {readonly composer:ComposerPort;readonly catalog?:CatalogPort}
export interface ReferenceCandidate {
 readonly candidateId:number;readonly selection:ReuseSelection;readonly detail:ReuseDetail;
 readonly before:ComposerSnapshot;readonly insertedText:string;readonly afterText:string;
 readonly insertedUtf8Bytes:number;readonly promptUtf8Bytes:number;readonly promptJsonUtf8Bytes:number;
 readonly requestBytes:number;readonly dynamicContextCodeUnits:number;readonly envelopeBytes:number;
}
export interface ReuseControllerState {
 readonly open:boolean;readonly phase:'idle'|'listing'|'detail'|'reviewed'|'inserting';
 readonly rows:readonly ReuseMetadata[];readonly selection:ReuseSelection|null;readonly detail:ReuseDetail|null;
 readonly candidate:ReferenceCandidate|null;readonly reviewId:number|null;readonly undoId:number|null;readonly error:string|null;
}
function parseSnapshot(input:unknown):ComposerSnapshot {
 const v=admitSerializedJson(input,65536) as Record<string,unknown>|null;
 if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!=='contextEpoch,revision,text'||!Number.isSafeInteger(v['contextEpoch'])||(v['contextEpoch'] as number)<0||!Number.isSafeInteger(v['revision'])||(v['revision'] as number)<0||typeof v['text']!=='string'||v['text'].length>8000)throw Error('composer-input');
 return Object.freeze({contextEpoch:v['contextEpoch'] as number,revision:v['revision'] as number,text:v['text']});
}
const same=(a:ComposerSnapshot,b:ComposerSnapshot)=>a.contextEpoch===b.contextEpoch&&a.revision===b.revision&&a.text===b.text;
function measureCandidate(text:string,insertedText:string,measure:(text:string)=>unknown){
 const promptJson=JSON.stringify({prompt:text});
 if(text.length>8000||promptJson.length>MAX_TEXT_CHARS||boundedUtf8Bytes(insertedText,4096)===null)throw Error();
 const v=admitSerializedJson(measure(text),2048) as Record<string,unknown>|null;
 const keys=['dynamicContextCodeUnits','envelopeBytes','requestBytes'];
 if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.join(',')||keys.some(k=>typeof v[k]!=='number'||!Number.isSafeInteger(v[k])||(v[k] as number)<0))throw Error();
 const requestBytes=v['requestBytes'] as number,dynamicContextCodeUnits=v['dynamicContextCodeUnits'] as number,envelopeBytes=v['envelopeBytes'] as number;
 const encoder=new TextEncoder(),promptJsonUtf8Bytes=encoder.encode(promptJson).length;
 if(requestBytes>1_000_000||dynamicContextCodeUnits>MAX_TEXT_CHARS||envelopeBytes>MAX_REQUEST_BYTES||dynamicContextCodeUnits<promptJson.length||requestBytes<promptJsonUtf8Bytes||envelopeBytes<promptJsonUtf8Bytes)throw Error();
 return {requestBytes,dynamicContextCodeUnits,envelopeBytes,insertedUtf8Bytes:encoder.encode(insertedText).length,promptUtf8Bytes:encoder.encode(text).length,promptJsonUtf8Bytes};
}
export function createReuseController(ports:ReuseControllerPorts){
 let state:ReuseControllerState=Object.freeze({open:false,phase:'idle',rows:Object.freeze([]),selection:null,detail:null,candidate:null,reviewId:null,undoId:null,error:null});
 const listeners=new Set<()=>void>(),catalog=ports.catalog??createPublicReuseCatalog();
 // Pin trusted callables before any await or notification.
 const listPort=catalog.list,detailPort=catalog.detail,readPort=ports.composer.read,measurePort=ports.composer.measure,writePort=ports.composer.compareAndSet;
 let turn=0,serial=0,disposed=false,reading=false,last:ComposerSnapshot|null=null;
 let undoReceipt:{readonly id:number;readonly before:ComposerSnapshot;readonly after:ComposerSnapshot}|null=null;
 let activeWrite:ComposerSnapshot|null=null;
 type Work={readonly turn:number;readonly abort:AbortController;readonly before:ComposerSnapshot};
 let pending:Work|null=null;
 const notify=()=>{for(const listener of [...listeners]){try{listener();}catch{/* Listener failures do not interrupt revocation. */}}};
 const publish=(patch:Partial<ReuseControllerState>)=>{state=Object.freeze({...state,...patch});notify();};
 const invalidate=(patch:Partial<ReuseControllerState>={})=>{
  const own=++turn,old=pending;pending=null;
  if(patch.undoId===null)undoReceipt=null;
  state=Object.freeze({...state,phase:'idle',selection:null,detail:null,candidate:null,reviewId:null,error:null,...patch});
  old?.abort.abort();if(turn===own)notify();return own;
 };
 const read=():ComposerSnapshot|null=>{
  if(reading||disposed)return null;reading=true;
  try{return parseSnapshot(readPort());}catch{return null;}finally{reading=false;}
 };
 const sync=()=>{
  const at=turn,next=read();if(at!==turn||disposed)return;
  if(!next){invalidate({rows:Object.freeze([]),undoId:null,error:'composer-unavailable'});return;}
  if(activeWrite&&same(next,activeWrite)){last=next;return;}
  if(last&&!same(last,next)){
   const context=last.contextEpoch!==next.contextEpoch;
   last=next;invalidate({...(context?{rows:Object.freeze([])}:{}),undoId:null,error:context?'context-changed':'composer-changed'});
  }else last=next;
 };
 const current=(work:Work)=>{
  if(pending!==work||turn!==work.turn||disposed||!state.open||work.abort.signal.aborted)return false;
  sync();return pending===work&&turn===work.turn&&last!==null&&same(work.before,last);
 };
 const refresh=()=>{const at=turn;sync();return turn===at&&last!==null&&!disposed;};
 const load=async(input:unknown)=>{
  try{parseReuseQuery(input);}catch{if(!disposed)invalidate({error:'catalog-input'});return false;}
  if(disposed||activeWrite||!refresh()||!last)return false;
  const own=invalidate({open:true,rows:Object.freeze([])}),work:Work={turn:own,abort:new AbortController(),before:last};
  if(turn!==own||disposed)return false;pending=work;publish({phase:'listing'});
  try{
   if(!current(work))return false;
   const rows=await listPort(input,work.abort.signal);
   if(!current(work))return false;if(!isMetadataList(rows))throw Error();pending=null;
   publish({phase:'idle',rows,error:null});return true;
  }catch{if(current(work)){pending=null;publish({phase:'idle',error:'catalog-unavailable'});}return false;}
 };
 const query=(input:unknown)=>state.open?load(input):Promise.resolve(false);
 const matches=(a:ReuseSelection,b:ReuseSelection)=>a.kind===b.kind&&a.id===b.id&&a.metadataDigest===b.metadataDigest&&a.templateVersion===b.templateVersion;
 const select=async(input:unknown)=>{
  if(disposed||activeWrite||!state.open||!refresh()||!last)return false;
  const own=invalidate(),work:Work={turn:own,abort:new AbortController(),before:last};
  if(turn!==own||disposed)return false;pending=work;
  let failure='catalog-stale';
  try{
   const selection=parseReuseSelection(input);
   if(!state.rows.some(row=>matches(row,selection)))throw Error();
   publish({phase:'detail',selection});if(!current(work))return false;
   const detail=await detailPort(input,work.abort.signal);
   if(!current(work))return false;if(!isReuseDetail(detail)||!matches(detail,selection))throw Error();
   const insertedText='\n\n[reuse reference: untrusted request context; not an executable tool selection, enforced reuse or release approval]\n'+JSON.stringify({kind:detail.kind,id:detail.id,templateVersion:detail.templateVersion,metadataDigest:detail.metadataDigest,detailDigest:detail.detailDigest,description:detail.description,boundary:detail.boundary,license:null,independentApproval:null,executableVersion:null,canonicalOwner:null});
   const afterText=work.before.text+insertedText;failure='prompt-limit';
   const measurements=measureCandidate(afterText,insertedText,measurePort);
   if(!current(work))return false;
   const candidate:ReferenceCandidate=Object.freeze({candidateId:++serial,selection,detail,before:work.before,insertedText,afterText,...measurements});
   pending=null;publish({phase:'idle',detail,candidate,error:null});return true;
  }catch{if(current(work)){pending=null;publish({phase:'idle',selection:null,detail:null,error:failure});}return false;}
 };
 const review=(input:unknown)=>{
  if(disposed||activeWrite||!state.open||pending||!refresh())return false;const candidate=state.candidate,at=turn;
  try{
   const v=admitSerializedJson(input,8192) as Record<string,unknown>|null;
   if(!candidate||!last||!same(candidate.before,last)||!v||Array.isArray(v)||Object.keys(v).sort().join(',')!=='accepted,candidateId,exactText'||v['accepted']!==true||v['candidateId']!==candidate.candidateId||v['exactText']!==candidate.insertedText)throw Error();
   publish({phase:'reviewed',reviewId:++serial,error:null});return turn===at&&state.candidate===candidate&&state.reviewId!==null;
  }catch{if(turn===at)publish({phase:'idle',reviewId:null,error:'review-required'});return false;}
 };
 const actionId=(input:unknown,key:string)=>{
  const v=admitSerializedJson(input,512) as Record<string,unknown>|null;
  if(!v||Array.isArray(v)||Object.keys(v).join(',')!==key||!Number.isSafeInteger(v[key])||(v[key] as number)<1)throw Error();
  return v[key] as number;
 };
 const insert=async(input:unknown)=>{
  if(disposed||activeWrite||!state.open||pending||!refresh())return false;
  const candidate=state.candidate,reviewId=state.reviewId;
  try{if(!candidate||reviewId===null||actionId(input,'reviewId')!==reviewId||!last||!same(candidate.before,last))return false;}catch{return false;}
  const own=invalidate({phase:'inserting'}),work:Work={turn:own,abort:new AbortController(),before:candidate.before};
  if(turn!==own||disposed)return false;pending=work;
  let failure='catalog-stale';
  try{
   if(!current(work))return false;
   const detail=await detailPort(JSON.stringify(candidate.selection),work.abort.signal);
   if(!current(work))return false;
   if(!reviewedDetailStillMatches(candidate.detail,detail))throw Error();
   failure='prompt-limit';const measurements=measureCandidate(candidate.afterText,candidate.insertedText,measurePort);
   if(Object.entries(measurements).some(([k,v])=>candidate[k as keyof ReferenceCandidate]!==v))throw Error();
   if(!current(work))return false;failure='composer-unavailable';
   // Synchronous CAS: never await a write or retry an uncertain confirmation.
   const after=write(candidate.before,candidate.afterText,()=>pending===work&&turn===own&&!disposed&&!work.abort.signal.aborted);
   const observed=read();
   if(pending!==work||turn!==own||!observed||after.contextEpoch!==candidate.before.contextEpoch||after.revision!==candidate.before.revision+1||after.text!==candidate.afterText||!same(after,observed))throw Error();
   last=after;pending=null;undoReceipt=Object.freeze({id:++serial,before:candidate.before,after});publish({phase:'idle',undoId:undoReceipt.id,error:null});return true;
  }catch{if(pending===work&&turn===own){pending=null;sync();if(turn===own)publish({phase:'idle',error:failure});}return false;}
 };
 const write=(expected:ComposerSnapshot,text:string,isCurrent:()=>boolean)=>{
  if(activeWrite||expected.revision>=Number.MAX_SAFE_INTEGER||!isCurrent())throw Error();
  const target=Object.freeze({contextEpoch:expected.contextEpoch,revision:expected.revision+1,text});activeWrite=target;
  const allowed=()=>activeWrite===target&&isCurrent();
  try{return parseSnapshot(writePort(expected,text,allowed));}finally{activeWrite=null;}
 };
 const undo=(input:unknown)=>{
  if(disposed||activeWrite||!refresh())return false;const receipt=undoReceipt;
  try{if(!receipt||actionId(input,'undoId')!==receipt.id||!last||!same(last,receipt.after))return false;}catch{return false;}
  const own=invalidate({undoId:null});if(turn!==own||disposed)return false;
  sync();if(turn!==own||!last||!same(last,receipt.after))return false;
  try{
   const after=write(receipt.after,receipt.before.text,()=>turn===own&&!disposed),observed=read();
   if(turn!==own||!observed||after.contextEpoch!==receipt.after.contextEpoch||after.revision!==receipt.after.revision+1||after.text!==receipt.before.text||!same(after,observed))throw Error();
   last=after;publish({error:null});return true;
  }catch{if(turn===own)publish({error:'composer-unavailable'});return false;}
 };
 const cancel=()=>{if(!disposed)invalidate();};
 const close=()=>{if(!disposed)invalidate({open:false,rows:Object.freeze([])});};
 const dispose=()=>{if(disposed)return;disposed=true;invalidate({open:false,rows:Object.freeze([]),undoId:null});listeners.clear();};
 return Object.freeze({getState:()=>state,subscribe:(listener:()=>void)=>{if(!disposed)listeners.add(listener);return()=>{listeners.delete(listener);};},open:(input:unknown='{}')=>load(input),query,select,review,insert,undo,sync,cancel,close,hide:close,dispose});
}
