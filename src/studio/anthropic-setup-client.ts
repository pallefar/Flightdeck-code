import {z} from 'zod';
import {readStudioJson} from './connection';

const publicMetadata=z.object({
  model:z.string().min(1).max(200).refine(value=>!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|[a-z][a-z\d+.-]*:|\/\/|www\.|sk-|Bearer/iu.test(value)),
  status:z.enum(['configured','unavailable']),revision:z.string().uuid(),
});
const metadataSchema=z.discriminatedUnion('persistence',[
  publicMetadata.extend({available:z.literal(true),persistence:z.literal('server-memory')}).strict(),
  publicMetadata.extend({available:z.literal(false),persistence:z.literal('external')}).strict(),
]);
export type AnthropicSetupMetadata=z.infer<typeof metadataSchema>;

/** Public metadata only. Credential material must never enter this DTO. */
export function parseAnthropicSetupMetadata(value:unknown):AnthropicSetupMetadata {
  const parsed=metadataSchema.safeParse(value);
  if(!parsed.success)throw new Error('Invalid setup response. Reload setup status.');
  return parsed.data;
}

const messages={
  invalid:'Invalid setup response. Reload setup status.',
  auth:'Authentication refused.',disabled:'Session setup is disabled.',
  conflict:'Setup changed. Reload setup status before trying again.',
  refused:'Setup request refused.',unavailable:'Setup unavailable. Reload setup status.',
  credential:'Enter a single-line API key of 1 to 8192 characters.',
  revision:'Reload setup status before making changes.',cancelled:'Setup request cancelled.',
} as const;
export class AnthropicSetupError extends Error {
  constructor(readonly code:keyof typeof messages){super(messages[code]);this.name='AnthropicSetupError';}
}
export type AnthropicSetupRequestContext={signal:AbortSignal;isCurrent:()=>boolean};
function assertCurrent(context:AnthropicSetupRequestContext){
  if(context.signal.aborted||!context.isCurrent())throw new AnthropicSetupError('cancelled');
}
/** Reuse the bounded DTO reader through an abort/epoch-aware stream boundary. */
async function readSetupMetadata(response:Response,context:AnthropicSetupRequestContext){
  const reader=response.body?.getReader();
  if(!reader)throw new AnthropicSetupError('invalid');
  const cancelSource=()=>{void reader.cancel().catch(()=>{});};
  let controller:ReadableStreamDefaultController<Uint8Array>;
  const stream=new ReadableStream<Uint8Array>({
    start(value){controller=value;},
    async pull(sink){
      try{
        assertCurrent(context);
        const part=await reader.read();
        assertCurrent(context);
        if(part.done)sink.close();else sink.enqueue(part.value);
      }catch{cancelSource();sink.error(new AnthropicSetupError('cancelled'));}
    },
    cancel(){cancelSource();},
  },{highWaterMark:0});
  const onAbort=()=>{cancelSource();controller.error(new AnthropicSetupError('cancelled'));};
  context.signal.addEventListener('abort',onAbort,{once:true});
  try{
    assertCurrent(context);
    const value=await readStudioJson(new Response(stream,{headers:response.headers}),4096);
    assertCurrent(context);
    return parseAnthropicSetupMetadata(value);
  }catch{assertCurrent(context);throw new AnthropicSetupError('invalid');}
  finally{context.signal.removeEventListener('abort',onAbort);cancelSource();try{reader.releaseLock();}catch{/* A cancelled pending pull owns its lock until settlement. */}}
}
/** No URL override, persistent storage, implicit metadata read, vendor probe or retry. */
export class AnthropicSetupClient {
  private readonly transport:typeof fetch;
  constructor(fetcher:typeof fetch=(...args)=>fetch(...args)){this.transport=(...args)=>fetcher(...args);}
  load(token:string,context:AnthropicSetupRequestContext){return this.request('GET',token,undefined,context);}
  save(token:string,apiKey:string,expectedRevision:string,context:AnthropicSetupRequestContext){return this.request('POST',token,{apiKey,expectedRevision},context);}
  remove(token:string,expectedRevision:string,context:AnthropicSetupRequestContext){return this.request('DELETE',token,{expectedRevision},context);}
  private async request(method:'GET'|'POST'|'DELETE',token:string,body:{apiKey?:string;expectedRevision:string}|undefined,context:AnthropicSetupRequestContext):Promise<AnthropicSetupMetadata>{
    assertCurrent(context);
    if(!token||/[\x00-\x20\x7f-\x9f]/.test(token))throw new AnthropicSetupError('auth');
    if(body&&!z.string().uuid().safeParse(body.expectedRevision).success)throw new AnthropicSetupError('revision');
    if(method==='POST'&&(!body?.apiKey||body.apiKey.length>8192||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(body.apiKey)))throw new AnthropicSetupError('credential');
    const expectedRevision=body?.expectedRevision;
    let outgoing=body===undefined?undefined:JSON.stringify(body);
    body=undefined; // Release the object carrying the key before the first transport await.
    let response:Response;
    try{const waiting=this.transport('/api/studio/model-connections/anthropic/setup',{
      method,credentials:'omit',redirect:'error',cache:'no-store',signal:context.signal,
      headers:{Authorization:`Bearer ${token}`,...(method==='GET'?{}:{'Content-Type':'application/json'})},
      ...(outgoing===undefined?{}:{body:outgoing}),
    });outgoing=undefined;response=await waiting;}catch{assertCurrent(context);throw new AnthropicSetupError('unavailable');}
    try{assertCurrent(context);}catch(error){void response.body?.cancel().catch(()=>{});throw error;}
    if(!response.ok){
      void response.body?.cancel().catch(()=>{});
      throw new AnthropicSetupError(response.status===401?'auth':response.status===403?'refused':response.status===404?'disabled':response.status===409?'conflict':response.status===413?'refused':'unavailable');
    }
    const metadata=await readSetupMetadata(response,context);
    assertCurrent(context);
    if(method!=='GET'&&(!metadata.available||metadata.status!==(method==='POST'?'configured':'unavailable')||metadata.revision===expectedRevision))throw new AnthropicSetupError('invalid');
    return metadata;
  }
}
