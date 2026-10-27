import {builtinRegistry,configSchemas,type BuiltinType} from '../../packages/workflow/graph';
import type {ZodTypeAny} from 'zod';
import type {ProcessTemplate} from '../process-studio/contracts';
import {PROCESS_TEMPLATES} from '../process-studio/plan';

const metadataLists=new WeakSet<object>(),details=new WeakSet<object>();
const detailSchemas=new WeakMap<object,ZodTypeAny|null>();
/** Opaque, same-realm factory provenance; never reflects on unknown native inputs. */
export function isMetadataList(value:unknown):value is readonly ReuseMetadata[]{return typeof value==='object'&&value!==null&&metadataLists.has(value);}
export function isReuseDetail(value:unknown):value is ReuseDetail{return typeof value==='object'&&value!==null&&details.has(value);}
/** Same-realm source identity supplements the explicitly partial structural hash.
 * It is not an executable hash/version, approval or hostile-JS protection. */
export function reviewedDetailStillMatches(reviewed:unknown,current:unknown):boolean {
 return isReuseDetail(reviewed)&&isReuseDetail(current)&&reviewed.kind===current.kind&&reviewed.id===current.id&&reviewed.templateVersion===current.templateVersion&&reviewed.metadataDigest===current.metadataDigest&&reviewed.detailDigest===current.detailDigest&&detailSchemas.get(reviewed)===detailSchemas.get(current);
}
export type ReuseKind='workflow-builtin'|'process-template';
export interface ReuseMetadata {
 readonly kind:ReuseKind;readonly id:string;readonly label:string;readonly description:string;
 readonly templateVersion:string|null;readonly metadataDigest:string;
 readonly availability:'source-static-not-probed';readonly executableVersion:null;readonly license:null;readonly independentApproval:null;readonly canonicalOwner:null;
}
/** Primitive serialized JSON only: bound bytes before parse/enumeration/coercion.
 * This is admission, not a sandbox for hostile JavaScript or trusted source seams. */
export function boundedUtf8Bytes(value:unknown,ceiling:number):number|null {
 if(typeof ceiling!=='number'||!Number.isSafeInteger(ceiling)||ceiling<0||ceiling>1_000_000||typeof value!=='string'||value.length>ceiling)return null;
 let bytes=0;
 for(let i=0;i<value.length;i++){
  const c=value.charCodeAt(i);
  if(c<128)bytes++;else if(c<2048)bytes+=2;
  else if(c>=0xd800&&c<=0xdbff&&i+1<value.length&&value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){bytes+=4;i++;}
  else bytes+=3;
  if(bytes>ceiling)return null;
 }
 return bytes;
}
export function admitSerializedJson(value:unknown,ceiling:number):unknown {
 if(boundedUtf8Bytes(value,ceiling)===null)throw new Error('catalog-input');
 try{return JSON.parse(value as string) as unknown;}catch{throw new Error('catalog-input');}
}
function record(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function parseReuseQuery(input:unknown){
 const v=admitSerializedJson(input,4096);
 if(!record(v)||Object.keys(v).some(k=>!['query','kind'].includes(k))||v['query']!==undefined&&(typeof v['query']!=='string'||v['query'].length>160)||v['kind']!==undefined&&!['workflow-builtin','process-template','all'].includes(v['kind'] as string))throw new Error('catalog-input');
 return Object.freeze(v);
}
async function fingerprint(projection:unknown):Promise<string>{
 const wire=JSON.stringify(projection);
 if(boundedUtf8Bytes(wire,32768)===null)throw new Error('catalog-source-limit');
 if(!globalThis.crypto?.subtle)throw new Error('crypto-unavailable');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(wire));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
const unknowns={availability:'source-static-not-probed' as const,executableVersion:null,license:null,independentApproval:null,canonicalOwner:null};
async function metadata(base:Omit<ReuseMetadata,'metadataDigest'|keyof typeof unknowns>):Promise<ReuseMetadata>{
 return Object.freeze({...base,...unknowns,metadataDigest:await fingerprint(['flightdeck-reuse-metadata/1',base.kind,base.id,base.label,base.description,base.templateVersion,unknowns.availability,null,null,null,null])});
}
/** DECLARED trusted source/DEVELOPMENT counterfactual seam; not untrusted JS admission. */
export interface TrustedCatalogSource {
 builtins:()=>readonly (typeof builtinRegistry[number])[];
 templates:()=>readonly ProcessTemplate[];
 schema:(id:BuiltinType)=>ZodTypeAny;
}
export const bundledCatalogSource:TrustedCatalogSource=Object.freeze({builtins:()=>builtinRegistry,templates:()=>PROCESS_TEMPLATES,schema:(id:BuiltinType)=>configSchemas[id]});
export interface ReuseSelection {readonly kind:ReuseKind;readonly id:string;readonly metadataDigest:string;readonly templateVersion:string|null}
export interface SchemaField {readonly name:string;readonly type:string;readonly optional:boolean;readonly hasDefault:boolean}
export interface ReuseDetail extends ReuseMetadata {
 readonly boundary:string;readonly requiredScopes:readonly string[];readonly schemaFields:readonly SchemaField[];
 readonly schemaDigest:string|null;readonly defaultsDigest:string|null;readonly detailDigest:string;
 readonly schemaBoundary:'structural-summary-only-runtime-refinements-authoritative';
}
function canonical(value:unknown,depth=0):unknown {
 if(depth>16)throw new Error('catalog-source-limit');
 if(value instanceof RegExp)return ['RegExp',value.source,value.flags];
 if(Array.isArray(value))return value.map(v=>canonical(v,depth+1));
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical((value as Record<string,unknown>)[k],depth+1)]));
 return value;
}
function schemaProjection(schema:ZodTypeAny,depth=0):unknown {
 if(depth>12)throw new Error('catalog-source-limit');
 const d=schema._def,type=d.typeName as string;
 const sub=(s:ZodTypeAny)=>schemaProjection(s,depth+1);
 switch(type){
 case 'ZodObject':return [type,d.unknownKeys,Object.keys(d.shape()).sort().map(k=>[k,sub(d.shape()[k])])];
 case 'ZodOptional':case 'ZodNullable':return [type,sub(d.innerType)];
 case 'ZodDefault':return [type,canonical(d.defaultValue()),sub(d.innerType)];
 case 'ZodEffects':return [type,d.effect.type,'function-uninspected',sub(d.schema)];
 case 'ZodRecord':return [type,sub(d.keyType),sub(d.valueType)];
 case 'ZodArray':return [type,canonical(d.minLength??null),canonical(d.maxLength??null),sub(d.type)];
 case 'ZodUnion':return [type,d.options.map(sub)];
 case 'ZodEnum':return [type,[...d.values]];
 case 'ZodString':case 'ZodNumber':return [type,canonical(d.checks)];
 case 'ZodLazy':return [type,'deferred-function-uninspected'];
 default:return [type];
 }
}
function fieldSummary(name:string,schema:ZodTypeAny):SchemaField {
 let current=schema,optional=false,hasDefault=false;
 while(['ZodOptional','ZodDefault','ZodEffects','ZodNullable'].includes(current._def.typeName)){
  const d=current._def;if(d.typeName==='ZodOptional'||d.typeName==='ZodDefault')optional=true;
  if(d.typeName==='ZodDefault')hasDefault=true;
  current=d.innerType??d.schema;
 }
 return Object.freeze({name,type:current._def.typeName as string,optional,hasDefault});
}
export function parseReuseSelection(input:unknown):ReuseSelection {
 const q=admitSerializedJson(input,4096);
 if(!record(q)||Object.keys(q).sort().join(',')!=='id,kind,metadataDigest,templateVersion'||!['workflow-builtin','process-template'].includes(q['kind'] as string)||typeof q['id']!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(q['id'])||typeof q['metadataDigest']!=='string'||!/^[a-f0-9]{64}$/.test(q['metadataDigest'])||(q['kind']==='workflow-builtin'?q['templateVersion']!==null:typeof q['templateVersion']!=='string'||q['templateVersion'].length<1||q['templateVersion'].length>64))throw new Error('catalog-input');
 return Object.freeze(q as unknown as ReuseSelection);
}
export function createPublicReuseCatalog(source:TrustedCatalogSource=bundledCatalogSource) {
 const detail=async(input:unknown):Promise<ReuseDetail>=>{
  const q=parseReuseSelection(input);
  const builtin=q.kind==='workflow-builtin'?source.builtins().find(b=>b.type===q.id):undefined;
  const template=q.kind==='process-template'?source.templates().find(t=>t.id===q.id):undefined;
  if(!builtin&&!template)throw new Error('catalog-missing');
  const base=await metadata(builtin?{kind:'workflow-builtin',id:builtin.type,label:builtin.label,description:builtin.description,templateVersion:null}:{kind:'process-template',id:template!.id,label:template!.label,description:template!.description,templateVersion:template!.version});
  if(base.metadataDigest!==q.metadataDigest||base.templateVersion!==q.templateVersion||builtin&&(builtin.type!==base.id||builtin.label!==base.label||builtin.description!==base.description)||template&&(template.id!==base.id||template.version!==base.templateVersion||template.label!==base.label||template.description!==base.description))throw new Error('catalog-stale');
  const schema=builtin?source.schema(builtin.type):null;
  const marker=(b:typeof builtin,t:typeof template,s:ZodTypeAny|null)=>JSON.stringify([b?[b.type,b.label,b.description,canonical(b.defaults)]:null,t?[t.id,t.version,t.label,t.description,t.boundary,[...t.requiredScopes]]:null,s?schemaProjection(s):null]);
  const before=marker(builtin,template,schema);
  const schemaFields=Object.freeze(schema?Object.keys(schema._def.shape()).sort().map(name=>fieldSummary(name,schema._def.shape()[name])):[]);
  const schemaDigest=schema?await fingerprint(['flightdeck-reuse-schema-structure/1',schemaProjection(schema)]):null;
  const defaultsDigest=builtin?await fingerprint(['flightdeck-reuse-defaults/1',canonical(builtin.defaults)]):null;
  const boundary=template?.boundary??'Source-static workflow declaration only; adapters, runtime validation and independent execution authority remain separate.';
  const requiredScopes=Object.freeze([...(template?.requiredScopes??[])]);
  const schemaBoundary='structural-summary-only-runtime-refinements-authoritative' as const;
  const detailDigest=await fingerprint(['flightdeck-reuse-detail/1',base.metadataDigest,boundary,requiredScopes,schemaFields,schemaDigest,defaultsDigest,schemaBoundary]);
  const currentBuiltin=builtin?source.builtins().find(b=>b.type===q.id):undefined;
  const currentTemplate=template?source.templates().find(t=>t.id===q.id):undefined;
  const currentSchema=currentBuiltin?source.schema(currentBuiltin.type):null;
  if(currentSchema!==schema||marker(currentBuiltin,currentTemplate,currentSchema)!==before)throw new Error('catalog-stale');
  const result=Object.freeze({...base,boundary,requiredScopes,schemaFields,schemaDigest,defaultsDigest,schemaBoundary,detailDigest});
  if(boundedUtf8Bytes(JSON.stringify(result),65536)===null)throw new Error('catalog-source-limit');
  details.add(result);detailSchemas.set(result,schema);return result;
 };
 return {detail,list:async(input:unknown):Promise<readonly ReuseMetadata[]>=>{
  const q=parseReuseQuery(input),query=((q['query']??'') as string).trim().replace(/[A-Z]/g,c=>c.toLowerCase());
  const fold=(s:string)=>s.replace(/[A-Z]/g,c=>c.toLowerCase());
  const builtins=source.builtins(),templates=source.templates();
  if(builtins.length+templates.length>64)throw new Error('catalog-source-limit');
  const identities=[...builtins.map(b=>'workflow-builtin:'+b.type),...templates.map(t=>'process-template:'+t.id)];
  if(new Set(identities).size!==identities.length)throw new Error('catalog-source-duplicate');
  const rows=await Promise.all([
  ...builtins.map(b=>metadata({kind:'workflow-builtin',id:b.type,label:b.label,description:b.description,templateVersion:null})),
  ...templates.map(t=>metadata({kind:'process-template',id:t.id,label:t.label,description:t.description,templateVersion:t.version})),
 ]);
 const result=Object.freeze(rows.filter(r=>(!q['kind']||q['kind']==='all'||r.kind===q['kind'])&&(!query||r.id===query||fold(r.label).includes(query)||fold(r.description).includes(query)))
 .sort((a,b)=>Number(b.id===query)-Number(a.id===query)||(a.kind<b.kind?-1:a.kind>b.kind?1:a.id<b.id?-1:a.id>b.id?1:0)));
 if(boundedUtf8Bytes(JSON.stringify(result),65536)===null)throw new Error('catalog-source-limit');
 metadataLists.add(result);return result;}};
}
