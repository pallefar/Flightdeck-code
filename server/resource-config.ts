import { constants,openSync,closeSync,fstatSync,lstatSync,readSync } from 'node:fs';
import { resolve,parse,join } from 'node:path';
import { z } from 'zod';
import { ResourceRegistry, type CredentialResolver, type TrustedFunction } from '../packages/resources/registry';
import { key } from '../packages/resources/contract';
import type { WorkflowResourceDependencies } from './workflow-resources';

const safeKey=key.refine(v=>!['__proto__','constructor','prototype'].includes(v));
const origin=z.string().max(2000).refine(v=>{try{const u=new URL(v);return u.origin===v&&!u.username&&!u.password&&['https:','http:'].includes(u.protocol);}catch{return false;}});
const endpoint=z.string().max(2000).refine(v=>{try{const u=new URL(v);return !u.username&&!u.password&&!u.hash&&!u.search&&['https:','http:'].includes(u.protocol);}catch{return false;}});
function schemaAt(depth:number):z.ZodTypeAny {
  if(depth>10)return z.never();
  const child=()=>schemaAt(depth+1);
  return z.union([
    z.object({type:z.literal('string'),maxLength:z.number().int().min(0).max(4096).optional()}).strict(),
    z.object({type:z.literal('number')}).strict(),z.object({type:z.literal('boolean')}).strict(),
    z.object({type:z.literal('array'),items:z.lazy(child),maxItems:z.number().int().min(0).max(256)}).strict(),
    z.object({type:z.literal('object'),properties:z.record(safeKey,z.lazy(child)).refine(p=>Object.keys(p).length<=64),required:z.array(safeKey).max(64),additionalProperties:z.literal(false)}).strict().refine(s=>new Set(s.required).size===s.required.length&&s.required.every(k=>Object.hasOwn(s.properties,k))),
  ]);
}
const valueSchema=schemaAt(0);
const common={id:safeKey,projects:z.array(safeKey).min(1).max(100),endpoint,input:valueSchema,output:valueSchema,credential:z.object({ref:safeKey,origin,header:z.enum(['authorization','x-api-key'])}).strict().optional()};
const configSchema=z.object({
  version:z.literal(1),
  projects:z.array(z.object({id:safeKey,actions:z.array(z.enum(['read','propose','execute'])).min(1).max(3)}).strict()).max(100),
  network:z.object({allowedOrigins:z.array(origin).max(100),developmentOrigins:z.array(origin).max(20).optional(),timeoutMs:z.number().int().min(1).max(15000).optional(),maxBytes:z.number().int().min(1).max(256000).optional()}).strict(),
  functions:z.array(z.discriminatedUnion('kind',[
    z.object({...common,kind:z.literal('rest'),method:z.literal('GET'),query:z.record(safeKey,safeKey).optional()}).strict(),
    z.object({...common,kind:z.literal('mcp'),tool:safeKey,readOnly:z.literal(true)}).strict(),
  ])).max(100),
}).strict();

/** Fixed trusted startup path only. No browser override; errors never reveal paths or content. */
export function loadResourceConfig(file:string|undefined,credentials?:CredentialResolver): {registry:ResourceRegistry;authorize:WorkflowResourceDependencies['authorize']}|undefined {
  if(file===undefined)return undefined;
  let fd:number|undefined;
  try {
    const path=resolve(file),root=parse(path).root;
    let current=root;
    for(const part of path.slice(root.length).split('/').filter(Boolean)) {
      current=join(current,part);
      if(lstatSync(current).isSymbolicLink())throw new Error();
    }
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const info=fstatSync(fd),entry=lstatSync(path);
    if(!info.isFile()||(info.mode&0o077)||info.size>64000||entry.ino!==info.ino||entry.dev!==info.dev)throw new Error();
    // Bound even a concurrently growing file, rather than reading to EOF.
    const bytes=Buffer.alloc(64001);
    const count=readFileBounded(fd,bytes);
    if(count>64000)throw new Error();
    const config=configSchema.parse(JSON.parse(bytes.subarray(0,count).toString('utf8')));
    const projects=new Map(config.projects.map(p=>[p.id,new Set(p.actions)]));
    if(projects.size!==config.projects.length)throw new Error();
    const development=config.network.developmentOrigins??[];
    if(development.some(o=>new URL(o).hostname!=='127.0.0.1'||!config.network.allowedOrigins.includes(o)))throw new Error();
    if(config.network.allowedOrigins.some(o=>new URL(o).protocol!=='https:'&&!development.includes(o)))throw new Error();
    for(const f of config.functions) {
      const url=new URL(f.endpoint);
      if(!config.network.allowedOrigins.includes(url.origin)||f.projects.some(p=>!projects.has(p))||new Set(f.projects).size!==f.projects.length||f.credential&&f.credential.origin!==url.origin)throw new Error();
      if(f.kind==='rest'&&Object.keys(f.query??{}).some(p=>f.input.type!=='object'||!Object.hasOwn(f.input.properties,p)||!['string','number','boolean'].includes(f.input.properties[p]?.type)))throw new Error();
    }
    // Retain the entire explicit policy in registry fingerprints, including startup origin grants.
    const policy={allowedOrigins:config.network.allowedOrigins,developmentOrigins:development,...(config.network.timeoutMs===undefined?{}:{timeoutMs:config.network.timeoutMs}),...(config.network.maxBytes===undefined?{}:{maxBytes:config.network.maxBytes})};
    const registry=new ResourceRegistry(config.functions as TrustedFunction[],policy,credentials);
    return {registry,authorize:async(_actor,project,action)=>projects.get(project)?.has(action)??false};
  } catch {throw new Error('resource configuration unavailable');}
  finally {if(fd!==undefined)closeSync(fd);}
}

function readFileBounded(fd:number,bytes:Buffer):number {
  let total=0;
  while(total<bytes.length){const n=readSync(fd,bytes,total,bytes.length-total,null);if(n===0)break;total+=n;}
  return total;
}
