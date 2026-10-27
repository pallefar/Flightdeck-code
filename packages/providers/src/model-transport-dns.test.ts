import { createServer, request as httpRequest } from 'node:http';
import type { RequestOptions as HttpsOptions } from 'node:https';
import type { DetailedPeerCertificate } from 'node:tls';
import { once } from 'node:events';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { afterEach, it, expect, vi } from 'vitest';
import { openAiCompatibleLlm } from './openai-compatible';
import { requestModelResponse } from './model-transport';
import { createModelConnections } from '../../../server/model-connections';

vi.mock('node:dns/promises',()=>({lookup:vi.fn()}));
vi.mock('node:https',()=>({request:vi.fn()}));
afterEach(()=>{vi.mocked(lookup).mockReset();vi.mocked(httpsRequest).mockReset();});
const input = {system:'fixture',user:'fixture',purpose:'draft' as const,attempt:1};
const completion = JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]});

it.each(['url','dns','native-request'] as const)('sanitizes direct low-level %s failures without leaking input or cause',async mode=>{
  const detail='NONSECRET_DIRECT_TRANSPORT_DETAIL';
  vi.mocked(lookup).mockResolvedValue([{address:'93.184.216.34',family:4}] as never);
  if(mode==='dns')vi.mocked(lookup).mockRejectedValue(new Error(detail,{cause:detail}));
  vi.mocked(httpsRequest).mockImplementation(()=>{throw new Error(detail,{cause:detail});});
  const error=await requestModelResponse(mode==='url'?detail:'https://approved.test/v1/chat/completions',{
    signal:new AbortController().signal,headers:{},body:'{}',maxBytes:256000,approvedOrigins:['https://approved.test'],
  }).then(()=>null,error=>error as Error&{input?:unknown});
  expect(error?.message).toBe('Model connection request failed');
  expect(error?.cause).toBeUndefined();expect(error?.input).toBeUndefined();
  expect(lookup).toHaveBeenCalledTimes(mode==='url'?0:1);
  expect(httpsRequest).toHaveBeenCalledTimes(mode==='native-request'?1:0);
});

it('direct socket transport also refuses an unapproved origin before DNS',async()=>{
  await expect(requestModelResponse('https://unapproved.test/v1/chat/completions',{
    signal:new AbortController().signal,headers:{},body:'{}',maxBytes:256000,approvedOrigins:[],
  })).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled();expect(httpsRequest).not.toHaveBeenCalled();
});

it('constructs, lists and resolves the production connection without DNS or sockets',()=>{
  const registry=createModelConnections({env:{STUDIO_MODEL_CONNECTION:'local',STUDIO_LOCAL_BASE_URL:'https://approved.test/v1',STUDIO_LOCAL_MODEL:'fixture',STUDIO_MODEL_APPROVED_ORIGINS:'["https://approved.test"]'}});
  expect(registry.resolve('local').descriptor).toMatchObject({status:'configured',verification:'not-probed'});
  expect(registry.resolveSelected().descriptor.id).toBe('local');
  expect(registry.descriptors).toHaveLength(4);
  expect(lookup).not.toHaveBeenCalled();expect(httpsRequest).not.toHaveBeenCalled();
});

it.each([
  '0.0.0.0','0.255.255.255','10.0.0.1','100.64.0.1','100.100.100.200','100.127.255.255',
  '127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.0.0.9','192.0.2.1',
  '192.31.196.1','192.52.193.1','192.88.99.2','192.168.0.1','192.175.48.1','198.18.0.1',
  '198.19.255.255','198.51.100.1','203.0.113.1','224.0.0.1','239.255.255.255','240.0.0.1',
  '255.255.255.255','168.63.129.16','::1','::ffff:169.254.169.254','::ffff:8.8.8.8','fe80::1','fd00::1','2001:4860:4860::8888','not-an-ip',
])('refuses every unsafe mixed DNS result before a socket: %s', async address=>{
  vi.mocked(lookup).mockResolvedValue([{address:'93.184.216.34',family:4},{address,family:address.includes(':')?6:4}] as never);
  const llm=openAiCompatibleLlm({baseUrl:'https://approved.test/v1',approvedOrigins:['https://approved.test'],model:'fixture',apiKey:'never-leak-fixture'});
  await expect(llm(input)).rejects.toThrow(/^Model connection request failed$/);
  expect(httpsRequest).not.toHaveBeenCalled();
});

it('checks all DNS results once and supplies immutable pinned lookup with original TLS identity (trusted socket fixture)', async()=>{
  const addresses=[{address:'93.184.216.34',family:4},{address:'8.8.8.8',family:4}];
  vi.mocked(lookup).mockResolvedValue(addresses as never);
  let hits=0;
  const server=createServer((_,res)=>{hits++;res.end(completion);});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const checked:string[]=[];
  vi.mocked(httpsRequest).mockImplementation(((url:URL,options:HttpsOptions,callback:Parameters<typeof httpRequest>[2])=>{
    expect(url.hostname).toBe('approved.test');
    expect(options).toMatchObject({agent:false,hostname:'93.184.216.34',rejectUnauthorized:true,servername:'approved.test',autoSelectFamily:false,family:4});
    expect(options.checkServerIdentity).toBeTypeOf('function');
    expect(options.checkServerIdentity!('93.184.216.34',{subjectaltname:'DNS:approved.test'} as DetailedPeerCertificate)).toBeUndefined();
    expect(options.checkServerIdentity!('approved.test',{subjectaltname:'DNS:wrong.test'} as DetailedPeerCertificate)).toBeInstanceOf(Error);
    expect((options.headers as Record<string,string>).host).toBe('approved.test');
    const pin=options.lookup!;
    pin('approved.test',{all:false},(error,address,family)=>{expect(error).toBeNull();checked.push(String(address));expect(family).toBe(4);});
    // Changing the resolver's original array cannot change a selected address or cause re-resolution.
    addresses[0]!.address='169.254.169.254';
    pin('approved.test',{all:true},((error:Error|null,result:unknown)=>{expect(error).toBeNull();expect(result).toEqual([{address:'93.184.216.34',family:4}]);}) as never);
    return httpRequest(`http://127.0.0.1:${(server.address() as {port:number}).port}`,{method:'POST',agent:false,signal:options.signal,headers:options.headers},callback!);
  }) as typeof httpsRequest);
  try {
    const llm=openAiCompatibleLlm({baseUrl:'https://approved.test/v1',approvedOrigins:['https://approved.test'],model:'fixture'});
    expect(lookup).not.toHaveBeenCalled();
    expect(await llm(input)).toEqual({text:'{}',truncated:false});
    expect(lookup).toHaveBeenCalledExactlyOnceWith('approved.test',{all:true,verbatim:true});
    expect(checked).toEqual(['93.184.216.34']);expect(hits).toBe(1);expect(httpsRequest).toHaveBeenCalledTimes(1);
    await expect(llm(input)).rejects.toThrow(/^Model connection request failed$/);
    expect(lookup).toHaveBeenCalledTimes(2);expect(httpsRequest).toHaveBeenCalledTimes(1);expect(hits).toBe(1);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it.each([
  [], [{address:'8.8.8.8',family:6}], [{address:'8.8.8.8',family:0}],
  Array.from({length:65},()=>({address:'8.8.8.8',family:4})),
].map(addresses=>({addresses})))('refuses empty, oversized or unsupported DNS answer shape %#', async({addresses})=>{
  vi.mocked(lookup).mockResolvedValue(addresses as never);
  const llm=openAiCompatibleLlm({baseUrl:'https://approved.test/v1',approvedOrigins:['https://approved.test'],model:'fixture'});
  await expect(llm(input)).rejects.toThrow(/^Model connection request failed$/);
  expect(httpsRequest).not.toHaveBeenCalled();
});

it('awaits actual DNS settlement after deadline and never opens a socket afterward', async()=>{
  let release!:(addresses:{address:string;family:number}[])=>void;
  vi.mocked(lookup).mockReturnValue(new Promise<{address:string;family:number}[]>(resolve=>{release=resolve;}) as never);
  const llm=openAiCompatibleLlm({baseUrl:'https://approved.test/v1',approvedOrigins:['https://approved.test'],model:'fixture',timeoutMs:10});
  let settled=false;
  const pending=llm(input);
  void pending.then(()=>{settled=true;},()=>{settled=true;});
  await new Promise(resolve=>setTimeout(resolve,25));
  const settledEarly=settled;
  release([{address:'8.8.8.8',family:4}]);
  await expect(pending).rejects.toThrow(/^Model connection request failed$/);
  expect(settledEarly).toBe(false);expect(httpsRequest).not.toHaveBeenCalled();
});
