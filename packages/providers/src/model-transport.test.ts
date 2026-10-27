import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { it, expect, vi } from 'vitest';
import { openAiCompatibleLlm } from './openai-compatible';

const input = {system:'nonsecret fixture system',user:'nonsecret fixture user',purpose:'draft' as const,attempt:1};
const completion = JSON.stringify({choices:[{message:{content:'{"socket":true}'},finish_reason:'stop'}]});

it('rejects zero ports at the exported socket boundary before DNS or OS connect and retains native 8443 (guarded child)',async()=>{
  const destinations=['https://approved.test:0/v1/chat/completions','http://127.0.0.1:0/v1/chat/completions','http://[::1]:0/v1/chat/completions','https://approved.test:00/v1/chat/completions','http://127.0.0.1:000/v1/chat/completions'];
  const source=`
    import {createRequire,syncBuiltinESMExports} from 'node:module';
    const require=createRequire(import.meta.url),dns=require('node:dns/promises'),net=require('node:net');
    const originalLookup=dns.lookup,originalConnect=net.Socket.prototype.connect;
    let dnsCalls=0;const attempts=[];const rows=[];
    dns.lookup=async()=>{dnsCalls++;return [{address:'93.184.216.34',family:4}];};
    net.Socket.prototype.connect=function(...args){const o=Array.isArray(args[0])?args[0][0]:args[0];attempts.push({host:o.host,hostname:o.hostname,port:o.port,family:o.family});throw new Error('guarded before OS connect');};
    syncBuiltinESMExports();
    try{
      const {requestModelResponse}=await import('./packages/providers/src/model-transport.ts');
      const {openAiCompatibleLlm}=await import('./packages/providers/src/openai-compatible.ts');
      const {createModelConnections}=await import('./server/model-connections.ts');
      for(const destination of ${JSON.stringify(destinations)}){
        const previousDns=dnsCalls,previousSockets=attempts.length;
        const approvedOrigins=destination.startsWith('https:')?[new URL(destination).origin]:[];
        const error=await requestModelResponse(destination,{signal:new AbortController().signal,headers:{},body:'{}',maxBytes:256000,approvedOrigins}).then(()=>null,error=>({message:error.message,hasCause:error.cause!==undefined}));
        const registry=createModelConnections({env:{STUDIO_LOCAL_BASE_URL:destination.replace('/chat/completions',''),STUDIO_LOCAL_MODEL:'fixture',STUDIO_MODEL_APPROVED_ORIGINS:JSON.stringify(approvedOrigins)}});
        rows.push({destination,error,dnsCalls:dnsCalls-previousDns,socketAttempts:attempts.length-previousSockets,status:registry.descriptors.find(d=>d.id==='local').status});
      }
      const control=await openAiCompatibleLlm({baseUrl:'https://approved.test:8443/v1',model:'fixture',approvedOrigins:['https://approved.test:8443']})(${JSON.stringify(input)}).then(()=>null,error=>error.message);
      process.stdout.write(JSON.stringify({rows,control,dnsCalls,attempts}));
    }finally{dns.lookup=originalLookup;net.Socket.prototype.connect=originalConnect;syncBuiltinESMExports();}
  `;
  const child=await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',source],{timeout:10000,maxBuffer:8192,env:{PATH:process.env.PATH??'',...(process.env.TMPDIR===undefined?{}:{TMPDIR:process.env.TMPDIR})}});
  expect(child.stderr).toBe('');
  expect(JSON.parse(child.stdout)).toEqual({
    rows:destinations.map(destination=>({destination,error:{message:'Model connection request failed',hasCause:false},dnsCalls:0,socketAttempts:0,status:'unavailable'})),
    control:'Model connection request failed',dnsCalls:1,
    attempts:[{host:'93.184.216.34',hostname:'93.184.216.34',port:8443,family:4}],
  });
});

it('default transport completes over a real literal-loopback socket without global fetch', async () => {
  let hits = 0;
  let sockets = 0;
  const server = createServer(async (req,res)=>{
    hits++;
    expect(req.url).toBe('/v1/chat/completions');
    expect(req.headers.authorization).toBe('Bearer nonsecret-fixture');
    const chunks:Buffer[]=[];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({model:'fixture',stream:false,messages:[{role:'system',content:input.system},{role:'user',content:input.user}]});
    res.setHeader('content-type','application/json');res.end(completion);
  });
  server.on('connection',()=>{sockets++;});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const ambient = vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('ambient fetch must not be used'));
  try {
    const llm = openAiCompatibleLlm({baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,model:'fixture',apiKey:'nonsecret-fixture'});
    expect(hits).toBe(0);
    expect(await llm(input)).toEqual({text:'{"socket":true}',truncated:false});
    expect(hits).toBe(1);expect(sockets).toBe(1);expect(ambient).not.toHaveBeenCalled();
  } finally {
    ambient.mockRestore();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});

it('sanitizes an empty HTTP 204 instead of throwing outside the transport promise', async()=>{
  const server=createServer((_,res)=>{res.writeHead(204);res.end();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const llm=openAiCompatibleLlm({baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,model:'fixture',timeoutMs:50});
    await expect(llm(input)).rejects.toThrow(/^Model connection request failed$/);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it.each(['response-bytes','headers','invalid-utf8','disconnect','stalled-headers','stalled-body','empty205'] as const)('bounds and sanitizes a real loopback socket: %s', async mode=>{
  let hits=0;
  let sockets=0;
  let closed!:()=>void;
  const socketClosed=new Promise<void>(resolve=>{closed=resolve;});
  const server=createServer((req,res)=>{
    hits++;
    if(mode==='response-bytes') res.end('nonsecret-fixture-detail'.repeat(20));
    else if(mode==='headers') {res.setHeader('x-detail','nonsecret-fixture-detail'.repeat(1000));res.end(completion);}
    else if(mode==='invalid-utf8') res.end(Buffer.from([0xff,0xfe]));
    else if(mode==='disconnect') req.socket.destroy();
    else if(mode==='stalled-body') {res.flushHeaders();res.write('{');}
    else if(mode==='empty205') {res.writeHead(205);res.end();}
    // stalled-headers deliberately keeps this fixture socket open until abort.
  });
  server.on('connection',socket=>{sockets++;socket.once('close',closed);});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const llm=openAiCompatibleLlm({baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,model:'fixture',apiKey:'nonsecret-fixture-key',timeoutMs:100,maxResponseBytes:64});
    const error=await llm(input).then(()=>undefined,error=>error as Error);
    expect(error?.message).toBe('Model connection request failed');
    expect(error?.cause).toBeUndefined();
    expect(String(error)).not.toMatch(/nonsecret-fixture|127\.0\.0\.1|ECONN|HTTP/);
    await socketClosed;
    expect(hits).toBe(1);expect(sockets).toBe(1);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('cancels a real response socket on caller abort without a retry', async()=>{
  let started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  let hits=0;
  const server=createServer((_,res)=>{hits++;res.flushHeaders();res.write('{');started();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const controller=new AbortController();
    const llm=openAiCompatibleLlm({baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}/v1`,model:'fixture'});
    const pending=llm({...input,signal:controller.signal});
    await ready;controller.abort();
    await expect(pending).rejects.toThrow(/^Model connection request failed$/);
    expect(hits).toBe(1);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('preserves canonical literal IPv6 loopback development without DNS', async()=>{
  let hits=0;
  const server=createServer((_,res)=>{hits++;res.end(completion);});
  server.listen(0,'::1');await once(server,'listening');
  try {
    const llm=openAiCompatibleLlm({baseUrl:`http://[::1]:${(server.address() as {port:number}).port}/v1`,model:'fixture'});
    expect(await llm(input)).toEqual({text:'{"socket":true}',truncated:false});expect(hits).toBe(1);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('does not inherit proxy or API credential environment in an isolated real-socket child', async()=>{
  let proxyHits=0;
  let destinationHits=0;
  const proxy=createServer((_,res)=>{proxyHits++;res.writeHead(502);res.end();});
  const destination=createServer((req,res)=>{destinationHits++;expect(req.headers.authorization).toBeUndefined();res.end(completion);});
  proxy.listen(0,'127.0.0.1');destination.listen(0,'127.0.0.1');await Promise.all([once(proxy,'listening'),once(destination,'listening')]);
  const proxyOrigin=`http://127.0.0.1:${(proxy.address() as {port:number}).port}`;
  const baseUrl=`http://127.0.0.1:${(destination.address() as {port:number}).port}/v1`;
  const script=`import {openAiCompatibleLlm} from './packages/providers/src/openai-compatible.ts'; const result=await openAiCompatibleLlm({baseUrl:${JSON.stringify(baseUrl)},model:'fixture'})(${JSON.stringify(input)});process.stdout.write(JSON.stringify(result));`;
  try {
    const child=await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','--eval',script],{timeout:10000,maxBuffer:4096,env:{
      HTTP_PROXY:proxyOrigin,HTTPS_PROXY:proxyOrigin,ALL_PROXY:proxyOrigin,http_proxy:proxyOrigin,https_proxy:proxyOrigin,all_proxy:proxyOrigin,
      NO_PROXY:'',no_proxy:'',NODE_USE_ENV_PROXY:'1',OPENAI_API_KEY:'nonsecret-ambient-not-authorized',HOME:'/nonexistent-model-egress-fixture-home',TMPDIR:process.env.TMPDIR ?? '',
    }});
    expect(JSON.parse(child.stdout)).toEqual({text:'{"socket":true}',truncated:false});
    // NODE_USE_ENV_PROXY itself emits this fixed native experimental warning on Node 22.
    // Permit only those lines; arbitrary stderr, fixture values and transport details still fail.
    const expectedWarning=/^(?:\(node:\d+\) \[UNDICI-EHPA\] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time\.\n|\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n)*$/;
    expect(child.stderr).toMatch(expectedWarning);expect(destinationHits).toBe(1);expect(proxyHits).toBe(0);
  } finally {
    proxy.closeAllConnections();destination.closeAllConnections();
    await Promise.all([new Promise<void>(resolve=>proxy.close(()=>resolve())),new Promise<void>(resolve=>destination.close(()=>resolve()))]);
  }
});
