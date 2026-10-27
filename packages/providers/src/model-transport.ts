import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import { lookup } from 'node:dns/promises';
import { checkServerIdentity } from 'node:tls';
import { BlockList, isIP } from 'node:net';
import type { Socket } from 'node:net';

export interface ModelTransportRequest {
  readonly signal: AbortSignal;
  readonly headers: Readonly<Record<string,string>>;
  readonly body: string;
  readonly maxBytes: number;
  /** Already validated/copied trusted startup policy; enforced again before DNS. */
  readonly approvedOrigins: readonly string[];
}
const failure = () => new Error('Model connection request failed');
/** Bump whenever address/transport policy changes: part of exact-context model bindings. */
export const MODEL_TRANSPORT_POLICY_ID = 'studio-model-pinned-v2-iana-ipv4-2025-10-09';
// Conservative IANA IPv4 Special-Purpose registry snapshot: deny whole entries,
// including globally-reachable special-use exceptions. IPv6 is unsupported remotely.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
const denied = new BlockList();
for(const [network,prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.31.196.0',24],['192.52.193.0',24],['192.88.99.0',24],['192.168.0.0',16],
  ['192.175.48.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
  ['224.0.0.0',4],['240.0.0.0',4],
] as const) denied.addSubnet(network,prefix,'ipv4');
// Azure's platform virtual IP is public-looking but is not a model destination.
// https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16
denied.addAddress('168.63.129.16','ipv4');

/** Direct one-shot Node socket. Never inherits global fetch, agents, proxies or credentials. */
export async function requestModelResponse(destination:string, options:ModelTransportRequest):Promise<Response> {
  // Await the original operation through DNS and owned-socket close before sanitizing.
  try { return await requestPinnedResponse(destination,options); }
  catch { throw failure(); }
}
async function requestPinnedResponse(destination:string, options:ModelTransportRequest):Promise<Response> {
  const url = new URL(destination);
  // Node treats numeric port zero as the protocol default; reject before DNS/socket work.
  if (url.port === '0' || options.signal.aborted) throw failure();
  const development=url.protocol==='http:' && ['127.0.0.1','[::1]'].includes(url.hostname);
  if(!development && (url.protocol!=='https:' || !options.approvedOrigins.includes(url.origin))) throw failure();
  const addresses=development ? [{address:url.hostname==='[::1]' ? '::1' : '127.0.0.1',family:url.hostname==='[::1]' ? 6 : 4}] : await lookup(url.hostname,{all:true,verbatim:true});
  if(!addresses.length || addresses.length>64 || options.signal.aborted ||
      (!development && addresses.some(value=>value.family!==4 || isIP(value.address)!==4 || denied.check(value.address,'ipv4')))) throw failure();
  const address={...addresses[0]!};
  return await new Promise<Response>((resolve,reject)=>{
    let socket:Socket|undefined;
    let complete = false;
    let failed = false;
    let status = 0;
    const chunks:Buffer[]=[];
    let bytes = 0;
    const finish = ()=>{
      try {
        if (failed || !complete || options.signal.aborted) throw failure();
        resolve(new Response(Buffer.concat(chunks),{status}));
      } catch {reject(failure());}
    };
    const socketOptions:RequestOptions & {autoSelectFamily:boolean} = {
      method:'POST',agent:false,signal:options.signal,maxHeaderSize:16384,
      // Numeric hostname makes re-resolution impossible, even if Node skips lookup for literals.
      hostname:address.address,autoSelectFamily:false,family:address.family,
      lookup:(_hostname,lookupOptions,callback)=>{
        if(lookupOptions.all) callback(null,[{...address}]);
        else callback(null,address.address,address.family);
      },
      ...(!development ? {rejectUnauthorized:true,servername:isIP(url.hostname) ? '' : url.hostname,
        checkServerIdentity:(_hostname,certificate)=>checkServerIdentity(url.hostname,certificate)} : {}),
      headers:{...options.headers,host:url.host,'content-length':String(Buffer.byteLength(options.body)),connection:'close'},
    };
    const req = (development ? httpRequest : httpsRequest)(url,socketOptions,res=>{
      status=res.statusCode ?? 0;
      const fail=()=>{failed=true;res.destroy();req.destroy();};
      res.on('error',fail);res.on('aborted',fail);
      if (status<200 || status>=300) {fail();return;}
      res.on('data',(chunk:Buffer)=>{
        bytes+=chunk.length;
        if(bytes>options.maxBytes) {fail();return;}
        chunks.push(chunk);
      });
      res.on('end',()=>{complete=true;req.destroy();});
    });
    req.once('socket',value=>{socket=value;socket.once('close',finish);});
    req.on('error',()=>{failed=true;req.destroy();});
    req.once('close',()=>{if(!socket) finish();});
    req.end(options.body);
  });
}
