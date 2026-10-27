import { z } from 'zod';
import { definitionSchema, resourceSummarySchema, key, type Definition, type ResourceSummary, type FunctionSummary, type ResourceExecution } from '../../packages/resources/contract';

type Schema = FunctionSummary['input'];
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function boundedJson(value: unknown, maxBytes = 256_000, maxDepth = 24): boolean {
 try {
  const pending = [{value, depth:0}]; const seen = new Set<object>(); let count=0;
  while(pending.length) {
   const {value:v,depth}=pending.pop()!;
   if(depth>maxDepth || ++count>30_000) return false;
   if(v===null || typeof v==='boolean' || typeof v==='string' || (typeof v==='number' && Number.isFinite(v))) continue;
   if(typeof v!=='object' || seen.has(v) || Object.getOwnPropertySymbols(v).length) return false;
   seen.add(v); const array=Array.isArray(v);
   if(![array?Array.prototype:Object.prototype,null].includes(Object.getPrototypeOf(v))) return false;
   const entries=Object.entries(Object.getOwnPropertyDescriptors(v));
   if(array && entries.length!==v.length+1) return false;
   for(const [k,d] of entries) {if(array && k==='length') continue; if(forbidden.has(k) || !('value' in d) || !d.enumerable || (array && !/^(0|[1-9][0-9]*)$/.test(k))) return false; pending.push({value:d.value,depth:depth+1});}
  }
  return new TextEncoder().encode(JSON.stringify(value)).length<=maxBytes;
 }catch {return false;}
}
function schemaShape(value:unknown,depth=0): value is Schema {
 if(depth>10 || !value || typeof value!=='object' || Array.isArray(value)) return false;
 const s=value as Record<string,unknown>; const allowed:Record<string,string[]>={object:['type','properties','required','additionalProperties'],string:['type','maxLength'],number:['type'],boolean:['type'],array:['type','items','maxItems']};
 if(typeof s.type!=='string' || !Object.hasOwn(allowed,s.type) || Object.keys(s).some(k=>!allowed[String(s.type)]!.includes(k))) return false;
 if(s.type==='string') return s.maxLength===undefined || (Number.isInteger(s.maxLength) && Number(s.maxLength)>=0 && Number(s.maxLength)<=4096);
 if(s.type==='number' || s.type==='boolean') return true;
 if(s.type==='array') return Number.isInteger(s.maxItems) && Number(s.maxItems)>=0 && Number(s.maxItems)<=256 && schemaShape(s.items,depth+1);
 if(s.type!=='object' || s.additionalProperties!==false || !s.properties || typeof s.properties!=='object' || Array.isArray(s.properties) || !Array.isArray(s.required)) return false;
 const properties=s.properties as Record<string,unknown>;
 return Object.keys(properties).length<=64 && s.required.length<=64 && new Set(s.required).size===s.required.length && s.required.every(k=>typeof k==='string' && Object.hasOwn(properties,k)) && Object.entries(properties).every(([k,v])=>!forbidden.has(k) && schemaShape(v,depth+1));
}
const schemaDto=z.unknown().refine(v=>boundedJson(v,32_000,24) && schemaShape(v)).transform(v=>v as Schema);
const functionDto=z.object({id:key,kind:z.enum(['rest','mcp']),input:schemaDto,output:schemaDto,effect:z.literal('read-only'),status:z.literal('configured-not-probed')}).strict();
const resourceDto=resourceSummarySchema.refine(r=>Number.isSafeInteger(r.revision) && (r.sourceRevision===null || Number.isSafeInteger(r.sourceRevision)) && (r.state==='draft' ? r.sourceRevision===null : r.sourceRevision!==null && r.sourceRevision<r.revision));
const listDto=z.object({resources:z.array(resourceDto).max(1000),functions:z.array(functionDto).max(256)}).strict().refine(v=>new Set(v.resources.map(r=>r.id)).size===v.resources.length && new Set(v.functions.map(f=>f.id)).size===v.functions.length);
const oneDto=z.object({resource:resourceDto}).strict();
const historyDto=z.object({revisions:z.array(resourceDto).max(1000)}).strict();
const resultDto=z.object({result:z.object({output:z.unknown(),durationMs:z.number().finite().min(0).max(86_400_000),resourceId:z.string().uuid(),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),functionId:key}).strict()}).strict();
export function validateResourceValue(value:unknown,schema:Schema):boolean {
 if(!boundedJson(schema,32_000) || !schemaShape(schema) || !boundedJson(value,32_000,10)) return false;
 function check(v:unknown,s:Schema):boolean {
  if(s.type==='string') return typeof v==='string' && v.length<=(s.maxLength??4096);
  if(s.type==='number') return typeof v==='number' && Number.isFinite(v);
  if(s.type==='boolean') return typeof v==='boolean';
  if(s.type==='array') return Array.isArray(v) && v.length<=s.maxItems && v.every(i=>check(i,s.items));
  if(!v || typeof v!=='object' || Array.isArray(v)) return false;
  return s.required.every(k=>Object.hasOwn(v,k)) && Object.entries(v).length<=64 && Object.entries(v).every(([k,i])=>Object.hasOwn(s.properties,k) && check(i,s.properties[k]!));
 }
 return check(value,schema);
}
export function canonicalResource(value:unknown):string {if(Array.isArray(value)) return `[${value.map(canonicalResource).join(',')}]`;if(value!==null && typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalResource((value as Record<string,unknown>)[k])}`).join(',')}}`;return JSON.stringify(value);}
export class ResourceClientError extends Error {
 constructor(public readonly code:number|'invalid'|'unavailable'|'readback') {super(code==='readback'?'Save not confirmed: exact readback failed. Preserve this draft; refresh before retrying.':code===409?'Revision or activation conflict. Draft retained; refresh and explicitly load the latest revision.':code===401?'Operator credential refused. Check AI builder credentials.':code===403?'Project resource access refused.':code==='invalid'?'Resource data refused. Use configured function identities and bounded schema-valid parameters.':'Resources unavailable or request refused. Check server configuration. No execution or save is confirmed.');}
}
export class ResourceClient {
 private base:string;
 constructor(public readonly projectId:string,private token:string,private transport:typeof fetch=fetch) {
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId) || projectId.length>64 || !token || /[\r\n]/.test(token)) throw new ResourceClientError('invalid');
  this.base=`/api/studio/workspaces/${projectId}/resources`;
 }
 private id(id:string) {if(!z.string().uuid().safeParse(id).success) throw new ResourceClientError('invalid');return id;}
 private async request<T>(suffix:string,schema:z.ZodType<T,z.ZodTypeDef,unknown>,method='GET',body?:unknown,signal?:AbortSignal):Promise<T> {
  if(signal?.aborted) throw new ResourceClientError('unavailable');
  if(body!==undefined && !boundedJson(body,32_000)) throw new ResourceClientError('invalid');
  try {
   const response=await this.transport(this.base+suffix,{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${this.token}`,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),...(signal?{signal}:{})});
   if(signal?.aborted) {await response.body?.cancel();throw new ResourceClientError('unavailable');}
   if(!response.ok) {await response.body?.cancel();throw new ResourceClientError(response.status);}
   if(!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new ResourceClientError('invalid');
   const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
   try {for(;;) {const {value,done}=await reader.read();if(done) break;size+=value.byteLength;if(size>256_000) throw new ResourceClientError('invalid');chunks.push(value);}} finally {await reader.cancel();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const raw:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!boundedJson(raw)) throw new ResourceClientError('invalid');
   const parsed=schema.safeParse(raw);if(!parsed.success) throw new ResourceClientError('invalid');if(signal?.aborted) throw new ResourceClientError('unavailable');return parsed.data;
  }catch(e) {if(e instanceof ResourceClientError) throw e;throw new ResourceClientError('unavailable');}
 }
 async list(signal?:AbortSignal) {const v=await this.request('',listDto,'GET',undefined,signal);if(v.resources.some(r=>r.projectId!==this.projectId)) throw new ResourceClientError('invalid');return v;}
 async get(id:string,signal?:AbortSignal) {const {resource}=await this.request('/'+this.id(id),oneDto,'GET',undefined,signal);if(resource.id!==id || resource.projectId!==this.projectId) throw new ResourceClientError('invalid');return resource;}
 async history(id:string,signal?:AbortSignal) {const {revisions}=await this.request('/'+this.id(id)+'/revisions',historyDto,'GET',undefined,signal);if(revisions.some(r=>r.id!==id || r.projectId!==this.projectId) || new Set(revisions.map(r=>r.revision)).size!==revisions.length) throw new ResourceClientError('invalid');return revisions;}
 async save(definition:Definition,current?:ResourceSummary,signal?:AbortSignal) {
  const parsed=definitionSchema.safeParse(definition);if(!parsed.success || (current && current.projectId!==this.projectId)) throw new ResourceClientError('invalid');
  const {resource}=await this.request(current?'/'+this.id(current.id):'',oneDto,current?'PUT':'POST',{definition:parsed.data,...(current?{expectedRevision:current.revision}:{})},signal);
  try {const actual=await this.get(resource.id,signal);if(resource.projectId!==this.projectId || resource.state!=='draft' || resource.revision!==(current?current.revision+1:1) || (current && resource.id!==current.id) || canonicalResource(resource.definition)!==canonicalResource(parsed.data) || canonicalResource(actual)!==canonicalResource(resource)) throw new ResourceClientError('readback');return actual;}catch {throw new ResourceClientError('readback');}
 }
 async execute(resource:ResourceSummary,fn:FunctionSummary,parameters:unknown,signal?:AbortSignal):Promise<ResourceExecution> {
  if(resource.projectId!==this.projectId || resource.state!=='active' || !resource.definition.functions.includes(fn.id) || !validateResourceValue(parameters,fn.input)) throw new ResourceClientError('invalid');
  const {result}=await this.request('/'+this.id(resource.id)+'/execute',resultDto,'POST',{revision:resource.revision,functionId:fn.id,parameters},signal);
  if(result.resourceId!==resource.id || result.revision!==resource.revision || result.functionId!==fn.id || !validateResourceValue(result.output,fn.output)) throw new ResourceClientError('invalid');return {...result,output:result.output};
 }
}
export type { Definition, ResourceSummary, FunctionSummary, ResourceExecution };
