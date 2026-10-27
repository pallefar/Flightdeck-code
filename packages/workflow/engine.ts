import { graphSchema, resolveNode, jsonValue, type Graph, type Json, type GraphNode } from './graph';
import {boundedJson,diagnosticSnapshot} from './data';
import {canonicalWorkflowValue,parseWorkflowCheckpoint,validateCheckpointState,type WorkflowCheckpoint} from './checkpoint';
export interface TraceDetails {durationMs:number;input?:Json;output?:Json;selectedPort?:'true'|'false';errorCode?:string}
export interface TraceEntry {nodeId:string;status:'completed'|'skipped'|'paused'|'blocked';message?:string;humanName?:string;details?:TraceDetails}
export interface RunResult {status:'completed'|'paused'|'blocked';output:Json;trace:TraceEntry[];pendingNodeId?:string;reason?:string}
export interface HumanAuthorization {humanName:string;proof:unknown}
export interface ExecutionAdapters {
 /** Trusted server adapter resolves the active reviewed read-only function and reauthorizes actor/project. Graphs supply references, never destinations or credentials. */
 resource?:(request:{resourceId:string;revision:number;functionId:string;parameters:Json;signal:AbortSignal})=>Promise<Json>;
 /** Adapter must resolve credentialRef in a trusted vault and enforce destination/SSRF policy. No secrets come from the graph. */
 http?:(request:{url:string;method:string;credentialRef:string;body?:Json;input:Json;signal:AbortSignal})=>Promise<Json>;
 llm?:(request:{instruction:string;model?:string;input:Json;signal:AbortSignal})=>Promise<Json>;
 /** Trusted application must authenticate the actual human and authorize this exact pending node. */
 authorizeHuman?:(authorization:HumanAuthorization,context:{graphId:string;nodeId:string;reviewer:string;initiator:string;signal:AbortSignal})=>Promise<boolean>;
}
export interface RunnerOptions {initiator?:string;timeoutMs?:number;maxSteps?:number;maxDataBytes?:number;captureData?:boolean}
interface State {index:number;seed:Json;values:Map<string,Json>;branches:Map<string,string>;trace:TraceEntry[];output:Json;steps:number;pending?:{node:GraphNode;data:Json;entry:TraceEntry}}
class ExecutionIssue extends Error {constructor(readonly code:string,message:string){super(message);}}
// Only used on internally produced or checkpoint-schema-validated traces.
function cloneTrace(trace:TraceEntry[]|WorkflowCheckpoint['trace']):TraceEntry[] {return JSON.parse(JSON.stringify(trace)) as TraceEntry[];}
export function createWorkflowRunner(inputGraph:Graph,adapters:ExecutionAdapters={},options:RunnerOptions={}) {
 options={...options};
 const g=graphSchema.parse(inputGraph);const order:Graph['nodes']=[];const done=new Set<string>();
 while(order.length<g.nodes.length){const ready=g.nodes.filter(n=>!done.has(n.id)&&g.edges.filter(e=>e.target===n.id).every(e=>done.has(e.source)));if(!ready.length)throw new Error('Cycle');for(const n of ready){order.push(n);done.add(n.id);}}
 const timeout=Math.min(30000,Math.max(1,options.timeoutMs??5000));const maxSteps=Math.min(100,Math.max(1,options.maxSteps??100));const maxBytes=Math.min(1000000,Math.max(100,options.maxDataBytes??100000));
 const pauses=new WeakMap<RunResult,State>();
 function checked(value:Json):Json {
  // Preserve the existing serialized-character budget, but reject non-JSON own-key shapes before parsing.
  if(!boundedJson(value,maxBytes*4,256,100000))throw new ExecutionIssue('DATA_INVALID','Unsafe node data or structural data limit exceeded');
  if(JSON.stringify(value).length>maxBytes)throw new ExecutionIssue('DATA_LIMIT','Data size limit exceeded');
  const parsed=jsonValue.safeParse(value);if(!parsed.success)throw new ExecutionIssue('DATA_INVALID','Unsafe or invalid node data');return parsed.data;
 }
 async function bounded<T>(fn:(signal:AbortSignal)=>Promise<T>):Promise<T>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)).catch(()=>{throw new ExecutionIssue('ADAPTER_ERROR','Adapter execution failed; side effects may already have occurred');}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ExecutionIssue('ADAPTER_TIMEOUT','Adapter timed out; side effects may already have occurred'));},timeout);})]);}finally{if(timer)clearTimeout(timer);}}
 function blocked(s:State,reason:string,nodeId?:string,details?:TraceDetails):RunResult{return {status:'blocked',output:null,trace:[...s.trace,...(nodeId?[{nodeId,status:'blocked' as const,message:reason,...(details?{details}:{})}]:[])],reason};}
 function admissionIssue():string|undefined {
  const triggers=g.nodes.filter(n=>resolveNode(g,n).type==='manual');
  if(triggers.length!==1||g.edges.some(e=>e.target===triggers[0]?.id)||g.nodes.some(n=>n.id!==triggers[0]?.id&&!g.edges.some(e=>e.target===n.id))||!g.nodes.some(n=>resolveNode(g,n).type==='output'))return 'Execution requires one manual root, connected nodes and an output';
  const outputs=g.nodes.filter(n=>resolveNode(g,n).type==='output');
  if(outputs.some(n=>g.edges.some(e=>e.source===n.id)))return 'Output nodes must be terminal';
  for(const gate of g.nodes.filter(n=>resolveNode(g,n).type==='approval')){
   const reachable=new Set<string>();const visit=(id:string)=>{if(id===gate.id||reachable.has(id))return;reachable.add(id);g.edges.filter(e=>e.source===id).forEach(e=>visit(e.target));};visit(triggers[0]!.id);
   if(outputs.some(n=>reachable.has(n.id)))return 'Workflow path would bypass required human approval';
  }
  return undefined;
 }
 async function advance(s:State):Promise<RunResult>{
 for(;s.index<order.length;s.index++){
 const n=order[s.index]!;const {type,config}=resolveNode(g,n);const incoming=g.edges.filter(e=>e.target===n.id);const active=incoming.filter(e=>s.values.has(e.source)&&(!s.branches.has(e.source)||s.branches.get(e.source)===e.sourcePort));
 if(incoming.length&&!active.length){s.trace.push({nodeId:n.id,status:'skipped'});continue;}
 const started=performance.now();
 if(++s.steps>maxSteps)return blocked(s,'Step limit exceeded',n.id,{durationMs:Math.max(0,performance.now()-started),errorCode:'STEP_LIMIT'});
 if(active.length>1)return blocked(s,'Multiple active inputs unsupported in v1; add an explicit merge adapter in a future version',n.id,{durationMs:Math.max(0,performance.now()-started),errorCode:'MULTIPLE_ACTIVE_INPUTS'});
 let data:Json=active.length?s.values.get(active[0]!.source)??{}:s.seed;
 let capturedInput:Json|undefined;
 try {
 if(n.inputMappings!==undefined){
  const mapped:Record<string,Json>={};
  for(const {target,source} of n.inputMappings){
   let value:Json|undefined=source.kind==='literal'?source.value:source.kind==='input'?s.seed:s.values.get(source.nodeId);
   if(source.kind!=='literal')for(const segment of source.path){
    const compatible=Array.isArray(value)?typeof segment==='number'&&segment<value.length:typeof segment==='string';
    value=compatible&&value!==null&&typeof value==='object'&&Object.hasOwn(value,segment)?(value as Record<string,Json>)[segment]:undefined;
   }
   if(value===undefined)throw new ExecutionIssue('MAPPING_SOURCE_UNAVAILABLE','Mapping source unavailable or missing path');
   mapped[target]=value;
  }
  data=checked(mapped);
 }
 if(options.captureData===true)capturedInput=diagnosticSnapshot(data,Math.min(maxBytes,10000));
 let value:Json=data;
 switch(type){
 case 'manual':value=s.seed;break;
 case 'set':if(typeof data!=='object'||data===null||Array.isArray(data))throw new ExecutionIssue('INPUT_INVALID','Set fields requires object input');value={...data,...(config.fields as Record<string,Json>)};break;
 case 'branch':{if(!config.field||(config.operator==='equals'&&config.value===undefined))throw new ExecutionIssue('CONFIG_REQUIRED','Condition field/value unconfigured');const v=typeof data==='object'&&data!==null&&!Array.isArray(data)?data[config.field as string]:undefined;s.branches.set(n.id,(config.operator==='exists'?v!==undefined:JSON.stringify(v)===JSON.stringify(config.value))?'true':'false');break;}
 case 'http':if(!config.url||!config.credentialRef)throw new ExecutionIssue('CONFIG_REQUIRED','HTTP URL and credential reference required');if(!adapters.http)throw new ExecutionIssue('ADAPTER_UNCONFIGURED','HTTP adapter unconfigured');value=await bounded(signal=>adapters.http!({url:config.url as string,method:config.method as string,credentialRef:config.credentialRef as string,...(config.body!==undefined?{body:config.body}:{}),input:checked(data),signal}));break;
 case 'resource':if(!config.resourceId||!config.revision||!config.functionId)throw new ExecutionIssue('CONFIG_REQUIRED','Resource ID, active revision and function ID required');if(!adapters.resource)throw new ExecutionIssue('ADAPTER_UNCONFIGURED','Resource adapter unconfigured');if(data===null||typeof data!=='object'||Array.isArray(data))throw new ExecutionIssue('INPUT_INVALID','Resource parameters require object input');value=await bounded(signal=>adapters.resource!({resourceId:config.resourceId as string,revision:config.revision as number,functionId:config.functionId as string,parameters:checked(data),signal}));break;
 case 'llm':if(!config.instruction)throw new ExecutionIssue('CONFIG_REQUIRED','LLM instruction unconfigured');if(!adapters.llm)throw new ExecutionIssue('ADAPTER_UNCONFIGURED','LLM adapter unconfigured');value=await bounded(signal=>adapters.llm!({instruction:config.instruction as string,...(typeof config.model==='string'?{model:config.model}:{}),input:checked(data),signal}));break;
 case 'approval':{
  if(!config.reviewer)throw new ExecutionIssue('CONFIG_REQUIRED','Human reviewer unconfigured');
  const entry:TraceEntry={nodeId:n.id,status:'paused',details:{durationMs:Math.max(0,performance.now()-started),...(capturedInput!==undefined?{input:capturedInput}:{})}};s.pending={node:n,data,entry};
  const result:RunResult={status:'paused',output:null,trace:cloneTrace([...s.trace,entry]),pendingNodeId:n.id};pauses.set(result,s);return result;
 }
 case 'unconfigured':throw new ExecutionIssue('CONFIG_REQUIRED','Legacy step unconfigured');
 case 'output':s.output=data;break;
 }
 const result=checked(value);s.values.set(n.id,result);
 const capturedOutput=options.captureData===true?diagnosticSnapshot(result,Math.min(maxBytes,10000)):undefined;
 s.trace.push({nodeId:n.id,status:'completed',details:{durationMs:Math.max(0,performance.now()-started),...(capturedInput!==undefined?{input:capturedInput}:{}),...(capturedOutput!==undefined?{output:capturedOutput}:{}),...(s.branches.has(n.id)?{selectedPort:s.branches.get(n.id) as 'true'|'false'}:{})}});
 }catch(error){const issue=error instanceof ExecutionIssue?error:new ExecutionIssue('EXECUTION_REFUSED','Execution refused');return blocked(s,issue.message,n.id,{durationMs:Math.max(0,performance.now()-started),errorCode:issue.code,...(capturedInput!==undefined?{input:capturedInput}:{})});}
 }return {status:'completed',output:s.output,trace:[...s.trace]};
 }
 return {
 checkpoint(paused:RunResult):WorkflowCheckpoint {
  const s=pauses.get(paused);if(!s?.pending)throw new Error('Unknown, copied or already consumed pause');
  return parseWorkflowCheckpoint({version:1,graphBinding:canonicalWorkflowValue(g),options:{initiator:options.initiator??'',timeoutMs:timeout,maxSteps,maxDataBytes:maxBytes,captureData:options.captureData===true},index:s.index,steps:s.steps,seed:s.seed,values:[...s.values],branches:[...s.branches],trace:[...s.trace,s.pending.entry],output:s.output,pending:{nodeId:s.pending.node.id,data:s.pending.data}});
 },
 restore(checkpoint:unknown):RunResult {
  const c=parseWorkflowCheckpoint(checkpoint);
  if(c.graphBinding!==canonicalWorkflowValue(g)||canonicalWorkflowValue(c.options)!==canonicalWorkflowValue({initiator:options.initiator??'',timeoutMs:timeout,maxSteps,maxDataBytes:maxBytes,captureData:options.captureData===true}))throw new Error('Checkpoint graph or execution options mismatch');
  const node=order[c.index];if(!node||node.id!==c.pending.nodeId||resolveNode(g,node).type!=='approval')throw new Error('Checkpoint pending gate mismatch');
  const admission=admissionIssue();if(admission)throw new Error(admission);
  validateCheckpointState(c,g,order);
  const restoredTrace=cloneTrace(c.trace);
  const s:State={index:c.index,steps:c.steps,seed:checked(c.seed),values:new Map(c.values.map(([id,value])=>[id,checked(value)])),branches:new Map(c.branches),trace:restoredTrace.slice(0,-1),output:checked(c.output),pending:{node,data:checked(c.pending.data),entry:restoredTrace[c.index]!}};
  const result:RunResult={status:'paused',output:null,trace:cloneTrace(restoredTrace),pendingNodeId:node.id};pauses.set(result,s);return result;
 },
 async run(seed:Record<string,Json>={}):Promise<RunResult>{
 const s:State={index:0,seed,values:new Map(),branches:new Map(),trace:[],output:null,steps:0};
 const admission=admissionIssue();if(admission)return blocked(s,admission);
 try{s.seed=checked(seed);}catch{return blocked(s,'Unsafe or oversized seed');}return advance(s);
 },
 async resume(paused:RunResult,authorization:HumanAuthorization):Promise<RunResult>{
 const s=pauses.get(paused);if(!s||!s.pending)return {status:'blocked',output:null,trace:[],reason:'Unknown, copied or already consumed pause'};
 const {node,data}=s.pending;const {config}=resolveNode(g,node);const initiator=options.initiator??'';
 const started=performance.now();
 const capturedInput=options.captureData===true?diagnosticSnapshot(data,Math.min(maxBytes,10000)):undefined;
 const diagnostic=(errorCode?:string):TraceDetails=>({durationMs:Math.max(0,performance.now()-started),...(capturedInput!==undefined?{input:capturedInput}:{}),...(errorCode?{errorCode}:{})});
 if(!initiator||!authorization.humanName.trim()||authorization.humanName.trim().toLowerCase()===initiator.trim().toLowerCase()||!adapters.authorizeHuman)return blocked(s,'Independent named human authorization and trusted verifier required',node.id,diagnostic('AUTHORIZATION_REQUIRED'));
 try{const allowed=await bounded(signal=>adapters.authorizeHuman!(authorization,{graphId:g.id,nodeId:node.id,reviewer:config.reviewer as string,initiator,signal}));if(!allowed)return blocked(s,'Human authorization refused',node.id,diagnostic('AUTHORIZATION_REFUSED'));}catch{return blocked(s,'Human authorization verification failed',node.id,diagnostic('AUTHORIZATION_FAILED'));}
 // Consume before continuing so concurrent resumes cannot replay downstream side effects.
 if(!pauses.has(paused))return blocked(s,'Pause already consumed',node.id,diagnostic('PAUSE_CONSUMED'));pauses.delete(paused);delete s.pending;s.values.set(node.id,data);
 const capturedOutput=options.captureData===true?diagnosticSnapshot(data,Math.min(maxBytes,10000)):undefined;
 s.trace.push({nodeId:node.id,status:'completed',humanName:authorization.humanName,details:{...diagnostic(),...(capturedOutput!==undefined?{output:capturedOutput}:{})}});s.index++;return advance(s);
 }
 };
}
