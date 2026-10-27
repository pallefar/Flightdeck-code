import { z } from 'zod';
import {boundedJson,safeMappingKey} from './data';
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const text = z.string().max(2000);
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
const safeString=text.refine(v=>{if(/^Bearer\s+\S+|\bsk-[a-zA-Z0-9]{16,}/i.test(v))return false;try{if(/^https?:\/\//i.test(v)){const u=new URL(v);return !u.username&&!u.password&&!/token|secret|key|password|authorization/i.test(u.search);}}catch{return false;}return true;},'Inline secret or URL credential is forbidden');
export const jsonValue: z.ZodType<Json> = z.lazy(() => z.union([z.null(),z.boolean(),z.number().finite(),safeString,z.array(jsonValue).max(100),z.record(jsonValue).refine(v=>Object.keys(v).every(k=>!['__proto__','constructor','prototype'].includes(k)&&!/secret|password|token|api.?key|authorization|credential(?!Ref$)/i.test(k)),'Unsafe secret/prototype field')]));
const fields = z.record(jsonValue).refine(v=>Object.keys(v).every(k=>/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k) && !/secret|password|token|api.?key|authorization|credential(?!Ref$)/i.test(k)),'Unsafe field name');
const url = z.string().max(2000).refine(v=>{try {const u=new URL(v);return u.protocol==='https:' && !u.username && !u.password && !u.search && !u.hash;}catch{return false;}},'Use HTTPS without inline credentials, query secrets or fragments');
export const configSchemas = {
 manual:z.object({}).strict(),
 resource:z.object({resourceId:z.string().uuid().optional(),revision:z.number().int().positive().safe().optional(),functionId:id.optional()}).strict(),
 http:z.object({url:url.optional(),method:z.enum(['GET','POST','PUT','PATCH','DELETE']).default('GET'),credentialRef:id.optional(),body:fields.optional(),service:z.enum(['generic','slack','microsoft365']).optional()}).strict(),
 llm:z.object({instruction:text.optional(),model:text.optional()}).strict(),
 set:z.object({fields:fields.default({})}).strict(),
 branch:z.object({field:id.optional(),operator:z.enum(['equals','exists']).default('equals'),value:jsonValue.optional()}).strict(),
 approval:z.object({reviewer:text.optional(),reason:text.optional()}).strict(),
 output:z.object({}).strict(),
 unconfigured:z.object({description:text}).strict(),
} as const;
export type BuiltinType = keyof typeof configSchemas;
export const builtinRegistry: {type:BuiltinType;label:string;description:string;defaults:Record<string,Json>}[] = [
 {type:'manual',label:'Manual trigger',description:'Start with supplied input',defaults:{}},
 {type:'http',label:'HTTP connector',description:'Injected adapter · credential reference only',defaults:{method:'GET',service:'generic'}},
 {type:'resource',label:'Resource invocation',description:'Reviewed read-only REST / MCP function · trusted adapter · reference only',defaults:{}},
 {type:'llm',label:'LLM / agent',description:'Injected model adapter, not an autonomous tool runner',defaults:{}},
 {type:'set',label:'Set fields',description:'Declarative merge, no executable code',defaults:{fields:{}}},
 {type:'branch',label:'Condition',description:'True / false output ports',defaults:{operator:'equals'}},
 {type:'approval',label:'Human approval',description:'Pauses until independent human authorization',defaults:{}},
 {type:'output',label:'Return output',description:'Return the incoming payload',defaults:{}},
 {type:'unconfigured',label:'Unconfigured step',description:'Draft placeholder · execution blocked',defaults:{description:'Describe and configure this step'}},
];
export const customBlockSchema=z.object({id,label:z.string().min(1).max(100),baseType:z.enum(['http','llm','set','branch','output']),defaults:fields,description:text}).strict().superRefine((b,c)=>{const r=configSchemas[b.baseType].safeParse(b.defaults);if(!r.success)c.addIssue({code:'custom',message:'Custom defaults do not match base type'});});
const mappingLiteral=z.unknown().refine(value=>boundedJson(value,10000),'Mapping literal shape, depth or byte limit exceeded').pipe(jsonValue);
const mappingPath=z.array(z.union([z.string().min(1).max(64).refine(safeMappingKey,'Unsafe mapping path'),z.number().int().min(0).max(99)])).max(16);
export const inputMappingSourceSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('literal'),value:mappingLiteral}).strict(),
 z.object({kind:z.literal('input'),path:mappingPath}).strict(),
 z.object({kind:z.literal('node'),nodeId:id,path:mappingPath}).strict(),
]);
export const inputMappingSchema=z.object({target:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/).refine(key=>!['__proto__','constructor','prototype'].includes(key)&&!/secret|password|token|api.?key|authorization|credential(?!Ref$)/i.test(key),'Unsafe mapping target'),source:inputMappingSourceSchema}).strict();
export type InputMapping=z.infer<typeof inputMappingSchema>;
export type InputMappingSource=z.infer<typeof inputMappingSourceSchema>;
const rawGraph=z.object({version:z.literal(1),id,name:z.string().min(1).max(120),nodes:z.array(z.object({id,type:id,label:z.string().min(1).max(100),position:z.object({x:z.number().finite().min(0).max(10000),y:z.number().finite().min(0).max(10000)}).strict(),config:fields,inputMappings:z.array(inputMappingSchema).max(100).optional()}).strict()).max(100),edges:z.array(z.object({id,source:id,target:id,sourcePort:z.enum(['default','true','false']).optional()}).strict()).max(300),customBlocks:z.array(customBlockSchema).max(50)}).strict();
export type Graph=z.infer<typeof rawGraph>;
export type GraphNode=Graph['nodes'][number];
export type CustomBlock=z.infer<typeof customBlockSchema>;
export const graphSchema=rawGraph.superRefine((g,c)=>{
 const issue=(message:string)=>c.addIssue({code:'custom',message});
 const blockIds=new Set<string>(); for(const b of g.customBlocks){if(blockIds.has(b.id)||b.id in configSchemas)issue('Duplicate or reserved custom block ID');blockIds.add(b.id);}
 const nodeIds=new Set<string>();for(const n of g.nodes){if(nodeIds.has(n.id))issue('Duplicate node ID');nodeIds.add(n.id);const b=g.customBlocks.find(b=>b.id===n.type);const t=b?.baseType??n.type; const schema=Object.hasOwn(configSchemas,t)?configSchemas[t as BuiltinType]:undefined;if(!schema||!schema.safeParse({...b?.defaults,...n.config}).success)issue(`Invalid config or unknown type: ${n.id}`);}
 const edgeIds=new Set<string>();for(const e of g.edges){if(edgeIds.has(e.id))issue('Duplicate edge ID');edgeIds.add(e.id);if(!nodeIds.has(e.source)||!nodeIds.has(e.target))issue('Edge references missing node');const source=g.nodes.find(n=>n.id===e.source);const t=g.customBlocks.find(b=>b.id===source?.type)?.baseType??source?.type;if(t==='branch'&&!['true','false'].includes(e.sourcePort??''))issue('Branch edge needs true/false port');if(t!=='branch'&&e.sourcePort&&e.sourcePort!=='default')issue('Invalid output port');}
 const visited=new Set<string>(),active=new Set<string>();
 const visit=(n:string):boolean=>{if(active.has(n))return false;if(visited.has(n))return true;active.add(n);for(const e of g.edges.filter(e=>e.source===n))if(!visit(e.target))return false;active.delete(n);visited.add(n);return true;};
 if(g.nodes.some(n=>!visit(n.id)))issue('Cycles are unsupported in DAG v1');
 for(const n of g.nodes){
  if(n.inputMappings===undefined)continue;
  const type=g.customBlocks.find(b=>b.id===n.type)?.baseType??n.type;
  if(!['http','resource','llm','set','branch','output'].includes(type))issue('Input mappings forbidden on trigger, approval or unsupported nodes');
  const targets=new Set<string>(),ancestors=new Set<string>(),pending=g.edges.filter(e=>e.target===n.id).map(e=>e.source);
  while(pending.length){const current=pending.pop()!;if(current===n.id||ancestors.has(current))continue;ancestors.add(current);pending.push(...g.edges.filter(e=>e.target===current).map(e=>e.source));}
  for(const mapping of n.inputMappings){
   if(targets.has(mapping.target))issue('Duplicate mapping target');targets.add(mapping.target);
   if(mapping.source.kind==='node'&&!ancestors.has(mapping.source.nodeId))issue('Mapping source must be a graph ancestor');
  }
 }
});
export function createEmptyGraph(name='Untitled workflow'):Graph{return {version:1,id:'workflow',name,nodes:[],edges:[],customBlocks:[]};}
export function validateGraph(value:unknown): {ok:true;graph:Graph;issues:string[]}|{ok:false;issues:string[]} {const r=graphSchema.safeParse(value);return r.success?{ok:true,graph:r.data,issues:[]}:{ok:false,issues:r.error.issues.map(i=>i.path.join('.')+': '+i.message)};}
export function resolveNode(g:Graph,n:GraphNode){const b=g.customBlocks.find(b=>b.id===n.type);const type=(b?.baseType??n.type) as BuiltinType;return {type,config:configSchemas[type].parse({...b?.defaults,...n.config}) as Record<string,Json>};}
