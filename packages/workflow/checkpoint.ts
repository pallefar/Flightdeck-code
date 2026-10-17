import {z} from 'zod';
import {jsonValue,resolveNode,type Graph,type Json} from './graph';
import {boundedJson,diagnosticSnapshot} from './data';

/** Private execution state, NOT approval evidence. Never accept from a client as authority. */
export const WORKFLOW_CHECKPOINT_MAX_BYTES=4_000_000;
const id=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const details=z.object({durationMs:z.number().finite().nonnegative(),input:jsonValue.optional(),output:jsonValue.optional(),selectedPort:z.enum(['true','false']).optional(),errorCode:z.string().max(100).optional()}).strict();
const trace=z.object({nodeId:id,status:z.enum(['completed','skipped','paused']),message:z.string().max(2000).optional(),humanName:z.string().min(1).max(2000).optional(),details:details.optional()}).strict();
const envelope=z.object({
 version:z.literal(1),graphBinding:z.string().max(WORKFLOW_CHECKPOINT_MAX_BYTES),
 options:z.object({initiator:z.string().max(2000),timeoutMs:z.number().int().min(1).max(30000),maxSteps:z.number().int().min(1).max(100),maxDataBytes:z.number().int().min(100).max(1000000),captureData:z.boolean()}).strict(),
 index:z.number().int().min(0).max(99),steps:z.number().int().min(1).max(100),
 seed:jsonValue,values:z.array(z.tuple([id,jsonValue])).max(100),branches:z.array(z.tuple([id,z.enum(['true','false'])])).max(100),
 trace:z.array(trace).min(1).max(100),output:jsonValue,pending:z.object({nodeId:id,data:jsonValue}).strict(),
}).strict();
/** Preflight runs BEFORE recursive Zod, rejecting accessors, cycles and prototypes. */
export const workflowCheckpointSchema=z.unknown().refine(value=>boundedJson(value,WORKFLOW_CHECKPOINT_MAX_BYTES,264,200000),'Unsafe or oversized workflow checkpoint').pipe(envelope);
export type WorkflowCheckpoint=z.infer<typeof workflowCheckpointSchema>;
export function canonicalWorkflowValue(value:unknown):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalWorkflowValue).join(',')+']';
// Preserve object order too: existing branch equality compares JSON.stringify.
 return '{'+Object.keys(value).map(key=>JSON.stringify(key)+':'+canonicalWorkflowValue((value as Record<string,unknown>)[key])).join(',')+'}';
}
export function parseWorkflowCheckpoint(value:unknown):WorkflowCheckpoint {return workflowCheckpointSchema.parse(value);}
export function checkpointDataWithinLimit(value:Json,maxBytes:number):boolean {return boundedJson(value,maxBytes*4,256,100000)&&JSON.stringify(value).length<=maxBytes;}

/** Validate a prefix structurally and recompute ONLY pure declarative operations.
 * Adapter outputs are opaque private persisted facts; no adapter is ever invoked here.
 */
export function validateCheckpointState(c:WorkflowCheckpoint,g:Graph,order:Graph['nodes']):void {
 const fail=():never=>{throw new Error('Inconsistent workflow checkpoint');};
 const equal=(a:unknown,b:unknown)=>canonicalWorkflowValue(a)===canonicalWorkflowValue(b);
 const values=new Map(c.values),branches=new Map(c.branches);
 if(values.size!==c.values.length||branches.size!==c.branches.length||c.trace.length!==c.index+1)fail();
 if(c.seed===null||typeof c.seed!=='object'||Array.isArray(c.seed))fail();
 for(const data of [c.seed,c.output,c.pending.data,...values.values()])if(!checkpointDataWithinLimit(data,c.options.maxDataBytes))fail();
 const seen=new Map<string,Json>(),chosen=new Map<string,string>();let steps=0,output:Json=null;
 for(let i=0;i<=c.index;i++){
  const n=order[i],entry=c.trace[i];if(!n||!entry||entry.nodeId!==n.id)fail();
  const {type,config}=resolveNode(g,n!);
  const incoming=g.edges.filter(e=>e.target===n!.id);
  const active=incoming.filter(e=>seen.has(e.source)&&(!chosen.has(e.source)||chosen.get(e.source)===e.sourcePort));
  const skipped=incoming.length>0&&active.length===0;
  if(entry!.message!==undefined||entry!.details?.errorCode!==undefined)fail();
  if(skipped){if(entry!.status!=='skipped'||values.has(n!.id)||branches.has(n!.id)||entry!.humanName!==undefined||entry!.details!==undefined||i===c.index)fail();continue;}
  if(active.length>1||++steps>c.options.maxSteps)fail();
  let data:Json=active.length?seen.get(active[0]!.source)!:c.seed;
  if(n!.inputMappings!==undefined){
   const mapped:Record<string,Json>={};
   for(const {target,source} of n!.inputMappings){
    let value:Json|undefined=source.kind==='literal'?source.value:source.kind==='input'?c.seed:seen.get(source.nodeId);
    if(source.kind!=='literal')for(const segment of source.path){const compatible=Array.isArray(value)?typeof segment==='number'&&segment<value.length:typeof segment==='string';value=compatible&&value!==null&&typeof value==='object'&&Object.hasOwn(value,segment)?(value as Record<string,Json>)[segment]:undefined;}
    if(value===undefined)fail();mapped[target]=value!;
   }
   data=mapped;
  }
  if(!checkpointDataWithinLimit(data,c.options.maxDataBytes))fail();
  if(entry!.details?.input!==undefined&&(!c.options.captureData||!equal(entry!.details.input,diagnosticSnapshot(data,Math.min(c.options.maxDataBytes,10000)))))fail();
  if(i===c.index){
   if(type!=='approval'||!config.reviewer||entry!.status!=='paused'||entry!.humanName!==undefined||entry!.details?.output!==undefined||entry!.details?.selectedPort!==undefined||c.pending.nodeId!==n!.id||!equal(data,c.pending.data)||values.has(n!.id)||branches.has(n!.id))fail();
   break;
  }
  if(entry!.status!=='completed'||!values.has(n!.id))fail();
  const value=values.get(n!.id)!;
  if(type==='approval'){
   const human=entry!.humanName;
   if(!config.reviewer||!c.options.initiator||!human?.trim()||human.trim().toLowerCase()===c.options.initiator.trim().toLowerCase())fail();
  }else if(entry!.humanName!==undefined)fail();
  switch(type){
   case 'manual':if(!equal(value,c.seed))fail();break;
   case 'set':if(data===null||typeof data!=='object'||Array.isArray(data)||!equal(value,{...data,...config.fields as Record<string,Json>}))fail();break;
   case 'branch':{
    if(!config.field||(config.operator==='equals'&&config.value===undefined)||!equal(value,data))fail();
    const v=typeof data==='object'&&data!==null&&!Array.isArray(data)?data[config.field as string]:undefined;
    const port=(config.operator==='exists'?v!==undefined:JSON.stringify(v)===JSON.stringify(config.value))?'true':'false';
    if(branches.get(n!.id)!==port||entry!.details?.selectedPort!==port)fail();chosen.set(n!.id,port);break;
   }
   case 'approval':case 'output':if(!equal(value,data))fail();if(type==='output')output=data;break;
   case 'resource':if(!config.resourceId||!config.revision||!config.functionId||data===null||typeof data!=='object'||Array.isArray(data))fail();break;
   case 'http':if(!config.url||!config.credentialRef)fail();break;
   case 'llm':if(!config.instruction)fail();break;
   default:fail();
  }
  if(type!=='branch'&&(branches.has(n!.id)||entry!.details?.selectedPort!==undefined))fail();
  if(entry!.details?.output!==undefined&&(!c.options.captureData||!equal(entry!.details.output,diagnosticSnapshot(value,Math.min(c.options.maxDataBytes,10000)))))fail();
  seen.set(n!.id,value);
 }
 if(steps!==c.steps||seen.size!==values.size||chosen.size!==branches.size||!equal(c.output,output))fail();
}
