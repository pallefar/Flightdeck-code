import { ResourceError } from './store';
import { requestJson, type Schema, type NetworkPolicy } from './transport';
export const MCP_VERSION='2025-11-25';
export function canonical(value:unknown):string {if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']'; if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(value);}
/** Bounded selected-tool client, not a general MCP agent: no sampling, stdio, retries or URL discovery. */
export async function callMcp(endpoint:string,tool:string,inputSchema:Schema,outputSchema:Schema,parameters:unknown,headers:Record<string,string>,policy:NetworkPolicy,signal?:AbortSignal) {
  const controller=new AbortController(), abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted) controller.abort();
  const timer=setTimeout(abort,Math.min(policy.timeoutMs ?? 5000,15000));
  let nextId=0;
  const rpc=async(method:string,params:unknown,notification=false)=>{
    const id=++nextId;
    const response=await requestJson(endpoint,{method:'POST',headers,body:{jsonrpc:'2.0',...(notification ? {} : {id}),method,...(params===undefined ? {} : {params})},signal:controller.signal,...(notification ? {notification:true} : {rpcId:id})},policy);
    if(notification) {if(response.value!==null) throw new ResourceError(502);return response;}
    const body=response.value as {jsonrpc?:unknown;id?:unknown;result?:unknown;error?:unknown};
    if(!body || body.jsonrpc!=='2.0' || body.id!==id || body.error || !Object.hasOwn(body,'result')) throw new ResourceError(502);
    return {...response,value:body.result};
  };
  const started=performance.now();
  try {
    const initialized=await rpc('initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'Flightdeck Resources',version:'0.1.0'}});
    const init=initialized.value as {protocolVersion?:unknown;capabilities?:{tools?:unknown}};
    if(init.protocolVersion!==MCP_VERSION || !init.capabilities?.tools) throw new ResourceError(502);
    const session=initialized.headers['mcp-session-id'];
    if(session!==undefined) {if(typeof session!=='string' || !/^[\x21-\x7e]{1,256}$/.test(session)) throw new ResourceError(502);headers['mcp-session-id']=session;}
    headers['mcp-protocol-version']=MCP_VERSION;
    await rpc('notifications/initialized',undefined,true);
    const listing=(await rpc('tools/list',{})).value as {tools?:Array<{name?:unknown;inputSchema?:unknown;outputSchema?:unknown}>;nextCursor?:unknown};
    if(!Array.isArray(listing.tools) || listing.tools.length>128 || listing.nextCursor!==undefined) throw new ResourceError(502); // Pagination deliberately unsupported, never silently truncated.
    const selected=listing.tools.filter(t=>t.name===tool);
    if(selected.length!==1 || canonical(selected[0]!.inputSchema)!==canonical(inputSchema) || canonical(selected[0]!.outputSchema)!==canonical(outputSchema)) throw new ResourceError(409);
    const result=(await rpc('tools/call',{name:tool,arguments:parameters})).value as {isError?:unknown;structuredContent?:unknown};
    if(!result || result.isError || !Object.hasOwn(result,'structuredContent')) throw new ResourceError(502);
    return {value:result.structuredContent,durationMs:performance.now()-started};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
