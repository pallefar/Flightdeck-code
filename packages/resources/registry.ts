import { callMcp } from './mcp';
import { createHash } from 'node:crypto';
import { ResourceError, key, type ResourceStore, type ResourceRecord } from './store';
import { requestJson, validateValue, type Schema, type NetworkPolicy } from './transport';
export interface RestFunction { id:string; kind:'rest'; projects:readonly string[]; endpoint:string; method:'GET'; query?:Record<string,string>; input:Schema; output:Schema; credential?:{ref:string;origin:string;header:'authorization'|'x-api-key'} }
export interface McpFunction { id:string; kind:'mcp'; projects:readonly string[]; endpoint:string; tool:string; readOnly:true; input:Schema; output:Schema; credential?:RestFunction['credential'] }
export type TrustedFunction = RestFunction | McpFunction;
export type CredentialResolver = (ref:string, context:{projectId:string;actor:string;origin:string})=>Promise<string>;
export class ResourceRegistry {
  private functions:ReadonlyMap<string,TrustedFunction>;
  constructor(functions:readonly TrustedFunction[], private policy:NetworkPolicy, private credentials?:CredentialResolver) {
    const copied=structuredClone(functions);
    if(new Set(copied.map(f=>f.id)).size!==copied.length || copied.some(f=>!key.safeParse(f.id).success || (f.kind==='rest' ? f.method!=='GET' : f.kind!=='mcp' || f.readOnly!==true || !key.safeParse(f.tool).success))) throw new ResourceError(400);
    this.functions=new Map(copied.map(f=>[f.id,f]));
    this.policy=structuredClone(policy);
  }
  private allowed(project:string,id:string) {
    const f=this.functions.get(id);
    if(!f || !f.projects.includes(project)) throw new ResourceError(403);
    return f;
  }
  private fingerprint(f:TrustedFunction) {return createHash('sha256').update(JSON.stringify({function:f,policy:this.policy})).digest('hex');}
  summaries(project:string) {return [...this.functions.values()].filter(f=>f.projects.includes(project)).map(f=>({id:f.id,kind:f.kind,input:f.input,output:f.output,effect:'read-only' as const,status:'configured-not-probed' as const}));}
  async activate(store:ResourceStore,project:string,id:string,revision:number,reviewer:string) {
    const record=await store.get(project,id);
    if(record.revision!==revision) throw new ResourceError(409);
    const bindings=Object.fromEntries(record.definition.functions.map(id=>[id,this.fingerprint(this.allowed(project,id))]));
    return store.activate(project,id,revision,reviewer,bindings);
  }
  async execute(record:ResourceRecord, functionId:string, parameters:unknown, actor:string, signal?:AbortSignal) {
    try {return await this.performExecute(record,functionId,parameters,actor,signal);}
    catch(error) {if(error instanceof ResourceError) throw error;throw new ResourceError(503);}
  }
  private async performExecute(record:ResourceRecord, functionId:string, parameters:unknown, actor:string, signal?:AbortSignal) {
    if(record.state!=='active' || !record.definition.functions.includes(functionId)) throw new ResourceError(409);
    const f=this.allowed(record.projectId,functionId);
    if(record.bindings?.[functionId]!==this.fingerprint(f)) throw new ResourceError(409);
    if(!validateValue(parameters,f.input)) throw new ResourceError(400);
    const url=new URL(f.endpoint);
    for(const [parameter,query] of Object.entries(f.kind==='rest' ? f.query ?? {} : {})) {
      const value=(parameters as Record<string,unknown>)[parameter];
      if(!['string','number','boolean'].includes(typeof value)) throw new ResourceError(400);
      url.searchParams.set(query,String(value));
    }
    const headers:Record<string,string>={};
    if(f.credential) {
      if(f.credential.origin!==url.origin || !this.credentials) throw new ResourceError(409);
      let timer:ReturnType<typeof setTimeout>|undefined;
      let cancel:(()=>void)|undefined;
      let value:string;
      try {
        value=await Promise.race([
          this.credentials(f.credential.ref,{projectId:record.projectId,actor,origin:url.origin}),
          new Promise<never>((_resolve,reject)=>{
            cancel=()=>reject(new ResourceError(504));
            timer=setTimeout(cancel,Math.min(this.policy.timeoutMs ?? 5000,15000));
            signal?.addEventListener('abort',cancel,{once:true});
            if(signal?.aborted) cancel();
          }),
        ]);
      } finally {if(timer) clearTimeout(timer);if(cancel) signal?.removeEventListener('abort',cancel);}
      if(typeof value!=='string' || value.length>8192 || /[\r\n]/.test(value)) throw new ResourceError(503);
      headers[f.credential.header]=value;
    }
    const result=f.kind==='mcp' ? await callMcp(url.href,f.tool,f.input,f.output,parameters,headers,this.policy,signal) : await requestJson(url.href,{method:'GET',headers,...(signal ? {signal}: {})},this.policy);
    const serialized=JSON.stringify(result.value);
    if(!validateValue(result.value,f.output) || Object.values(headers).flatMap(secret=>[secret,secret.replace(/^(Bearer|Basic)\s+/i,'')]).some(secret=>secret.length>0 && serialized.includes(JSON.stringify(secret).slice(1,-1)))) throw new ResourceError(502);
    return {output:result.value,durationMs:result.durationMs,resourceId:record.id,revision:record.revision,functionId};
  }
}
