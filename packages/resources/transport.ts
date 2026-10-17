import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ResourceError } from './store';
export type Schema = { type:'object'; properties:Record<string,Schema>; required:string[]; additionalProperties:false } | {type:'string'; maxLength?:number} | {type:'number'} | {type:'boolean'} | {type:'array'; items:Schema; maxItems:number};
const banned = new Set(['__proto__','constructor','prototype']);
export function validateValue(value:unknown,schema:Schema,depth=0):boolean {
  if (depth>10 || !schema || typeof schema !== 'object') return false;
  const allowedKeys:Record<string,string[]>={object:['type','properties','required','additionalProperties'],string:['type','maxLength'],number:['type'],boolean:['type'],array:['type','items','maxItems']};
  if(!allowedKeys[schema.type] || Object.keys(schema).some(k=>!allowedKeys[schema.type]!.includes(k))) return false;
  if (schema.type==='string') return typeof value==='string' && value.length <= Math.min(schema.maxLength ?? 4096,4096);
  if (schema.type==='number') return typeof value==='number' && Number.isFinite(value);
  if (schema.type==='boolean') return typeof value==='boolean';
  if (schema.type==='array') {
    if(!Number.isInteger(schema.maxItems) || schema.maxItems<0 || schema.maxItems>256 || !Array.isArray(value) || value.length>schema.maxItems) return false;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if(Object.keys(descriptors).length!==value.length+1) return false;
    return Array.from({length:value.length},(_,i)=>descriptors[String(i)]).every(d=>d && Object.hasOwn(d,'value') && validateValue(d.value,schema.items,depth+1));
  }
  if (schema.type!=='object' || schema.additionalProperties!==false || !schema.properties || !Array.isArray(schema.required) || !value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.keys(descriptors).length<=64 && schema.required.every(k=>Object.hasOwn(descriptors,k)) && Object.entries(descriptors).every(([k,d])=>!banned.has(k) && Object.hasOwn(d,'value') && Object.hasOwn(schema.properties,k) && validateValue(d.value,schema.properties[k]!,depth+1));
}
export interface NetworkPolicy { developmentOrigins?:readonly string[]; timeoutMs?:number; maxBytes?:number }
function publicIPv4(address:string) {
  if (isIP(address)!==4) return false; // IPv6 unsupported: reject rather than misclassify mapped/special ranges.
  const [a,b] = address.split('.').map(Number);
  return a!==undefined && b!==undefined && a>0 && a<224 && ![10,127].includes(a) && !(a===100 && b>=64 && b<=127) && !(a===169 && b===254) && !(a===172 && b>=16 && b<=31) && !(a===192 && [0,88,168].includes(b)) && !(a===198 && [18,19,51].includes(b)) && !(a===203 && b===0);
}
export async function requestJson(destination:string, options:{method:'GET'|'POST'; headers?:Record<string,string>; body?:unknown; signal?:AbortSignal; notification?:boolean; rpcId?:number}, policy:NetworkPolicy) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), Math.min(policy.timeoutMs ?? 5000,15000));
  const abort = ()=>controller.abort(); options.signal?.addEventListener('abort',abort,{once:true});
  try {
    if(options.signal?.aborted) controller.abort();
    const url = new URL(destination);
    if(url.username || url.password || url.hash || !['https:','http:'].includes(url.protocol)) throw new ResourceError(403);
    const development = url.hostname==='127.0.0.1' && policy.developmentOrigins?.includes(url.origin);
    if(!development && url.protocol!=='https:') throw new ResourceError(403);
    const addresses = development ? [{address:'127.0.0.1',family:4}] : await Promise.race([lookup(url.hostname,{all:true}), new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new ResourceError(504)),{once:true}))]);
    if(!addresses.length || (!development && addresses.some(a=>!publicIPv4(a.address)))) throw new ResourceError(403);
    if(controller.signal.aborted) throw new ResourceError(504);
    const address = addresses[0]!;
    const payload = options.body===undefined ? undefined : JSON.stringify(options.body);
    if(payload && Buffer.byteLength(payload)>32_000) throw new ResourceError(413);
    return await new Promise<{value:unknown; headers:Record<string,string|string[]|undefined>; durationMs:number}>((resolve,reject)=>{
      const started = performance.now();
      const req = (url.protocol==='https:' ? httpsRequest : httpRequest)(url, { method:options.method, headers:{accept:'application/json, text/event-stream',...(payload ? {'content-type':'application/json','content-length':String(Buffer.byteLength(payload))} : {}),...options.headers}, signal:controller.signal, agent:false,
        // Pin the checked address; never resolve a second time at connect.
        lookup:(_hostname,_options,callback)=>callback(null,address.address,address.family)
      },res=>{
        const fail = (status:number)=>{ res.destroy(); reject(new ResourceError(status)); };
        if(options.notification && res.statusCode===202) {res.resume(); resolve({value:null,headers:res.headers,durationMs:performance.now()-started}); return;}
        if(!res.statusCode || res.statusCode<200 || res.statusCode>=300) {fail(502);return;}
        const contentType = res.headers['content-type'] ?? '';
        if(!contentType.startsWith('application/json') && !(options.rpcId!==undefined && contentType.startsWith('text/event-stream'))) {fail(502);return;}
        let bytes=0; const chunks:Buffer[]=[];
        res.on('error',()=>reject(new ResourceError(502)));
        res.on('data',(chunk:Buffer)=>{
          bytes+=chunk.length;
          if(bytes>Math.min(policy.maxBytes ?? 64_000,256_000)) {fail(413);return;}
          chunks.push(chunk);
          if(contentType.startsWith('text/event-stream')) {
            const text=Buffer.concat(chunks).toString('utf8');
            for(const event of text.split(/\r?\n\r?\n/).slice(0,-1)) {
              const data=event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
              if(!data) continue;
              try {const parsed=JSON.parse(data); if(parsed.id===options.rpcId) {resolve({value:parsed,headers:res.headers,durationMs:performance.now()-started});res.destroy();return;} } catch {fail(502);return;}
            }
          }
        });
        res.on('end',()=>{try {if(contentType.startsWith('text/event-stream')) {reject(new ResourceError(502));return;} resolve({value:JSON.parse(Buffer.concat(chunks).toString('utf8')),headers:res.headers,durationMs:performance.now()-started});} catch {reject(new ResourceError(502));}});
      });
      req.on('error',()=>reject(new ResourceError(controller.signal.aborted ? 504 : 502)));
      if(payload) req.write(payload); req.end();
    });
  } catch(e) { if(e instanceof ResourceError) throw e; throw new ResourceError(502); }
  finally {clearTimeout(timer); options.signal?.removeEventListener('abort',abort);}
}
