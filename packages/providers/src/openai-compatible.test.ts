import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, it, expect } from 'vitest';
import { openAiCompatibleLlm, validateModelBaseUrl, validateModelApprovedOrigins } from './openai-compatible';
const request = {system:'protected system', user:'protected user', purpose:'draft' as const, attempt:1};
describe('OpenAI-compatible adapter (injected transport fixtures)', () => {
  it.each(['https://approved.test:0/v1','http://127.0.0.1:0/v1','http://[::1]:0/v1'])('rejects explicit zero destination port before any transport: %s', baseUrl => {
    let calls=0;
    const approvedOrigins=baseUrl.startsWith('https:')?['https://approved.test:0']:[];
    expect(()=>validateModelBaseUrl(baseUrl)).toThrow(/^Invalid model connection configuration$/);
    expect(()=>openAiCompatibleLlm({baseUrl,model:'fixture',approvedOrigins,fetchImpl:async()=>{calls++;throw new Error('must not send');}})).toThrow(/^Invalid model connection configuration$/);
    expect(calls).toBe(0);
  });
  it('rejects a zero-port approved origin even when the selected development destination is valid',()=>{
    const approvedOrigins=['https://approved.test:0'];
    expect(()=>validateModelApprovedOrigins(approvedOrigins)).toThrow(/^Invalid model connection configuration$/);
    expect(()=>openAiCompatibleLlm({baseUrl:'http://127.0.0.1:11434/v1',model:'fixture',approvedOrigins})).toThrow(/^Invalid model connection configuration$/);
  });
  it('refuses unapproved remote HTTPS even with a trusted injected fetch', () => {
    let sent = false;
    expect(() => openAiCompatibleLlm({baseUrl:'https://unknown.test/v1',model:'m',fetchImpl:async()=>{sent=true;return new Response('{}');}})).toThrow('Invalid model connection configuration');
    expect(sent).toBe(false);
  });
  it.each(['https://@example.com/v1','https:///example.com/v1','http://example.com/v1','http://localhost/v1','http://127.1/v1','https://u:p@example.com/v1','https://example.com/v1?key=secret','https://example.com/v1#secret','file:///v1'])('rejects unsafe destination %s before transport', baseUrl => {
    expect(() => openAiCompatibleLlm({baseUrl,model:'m'})).toThrow('Invalid model connection configuration');
  });
  it.each(['', ' ', 'bad\nmodel'])('rejects invalid model %s', model => {
    expect(() => openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model})).toThrow('Invalid model connection configuration');
  });
  it.each([
    new Response('secret-body', {status:401}),
    new Response('secret-body', {status:302,headers:{location:'https://evil.test'}}),
    new Response('not json secret'),
    new Response(JSON.stringify({choices:[{message:{content:'not json'},finish_reason:'stop'}]})),
    new Response(JSON.stringify({choices:[{message:{content:'{}',tool_calls:[{}]},finish_reason:'tool_calls'}]})),
    new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:null}]})),
  ])('sanitizes unusable response fixture %#', async response => {
    const llm = openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model:'m',fetchImpl:async()=>response});
    await expect(llm(request)).rejects.toThrow(/^Model connection request failed$/);
  });
  it.each([
    ['https://EXAMPLE.com'], ['https://example.com/'], ['https://example.com:443'],
    ['http://example.com'], ['https://example.com/path'], ['https://u:p@example.com'],
    ['https://example.com?x'], ['https://example.com#x'], ['https://example.com.'],
    ['https://*.example.com'], [' https://example.com'], ['https://example.com','https://example.com'],
    Array.from({length:17},(_,i)=>`https://host${i}.test`),
  ].map(approvedOrigins=>({approvedOrigins})))('rejects noncanonical or unbounded trusted allowlist %#', ({approvedOrigins}) => {
    expect(() => openAiCompatibleLlm({baseUrl:'http://127.0.0.1/v1',model:'m',approvedOrigins})).toThrow('Invalid model connection configuration');
  });
  it.each(['http://127.0.0.1:080/v1','http://127.0.0.1:80/v1','http://[0:0:0:0:0:0:0:1]/v1','https://EXAMPLE.com/v1','https://example.com:443/v1','https://example.com/a/../v1'])('rejects normalized destination spelling %s', baseUrl => {
    expect(() => openAiCompatibleLlm({baseUrl,model:'m',approvedOrigins:['https://example.com']})).toThrow('Invalid model connection configuration');
  });
  it('snapshots validated model, explicit key and trusted transport at construction',async()=>{
    const originalKey='NONSECRET_CONSTRUCTION_KEY',sent:Array<{model:unknown;originalKey:boolean}>=[];
    let replacementCalls=0;
    const response=()=>new Response(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]}));
    const options={baseUrl:'http://127.0.0.1:11434/v1',model:'original-model',apiKey:originalKey,fetchImpl:async(_url:unknown,init?:RequestInit)=>{
      sent.push({model:JSON.parse(String(init?.body)).model,originalKey:(init?.headers as Record<string,string>).authorization===`Bearer ${originalKey}`});return response();
    }};
    const llm=openAiCompatibleLlm(options);
    options.model='changed after validation (invalid model)';
    expect(await llm(request)).toEqual({text:'{}',truncated:false});
    expect(sent.at(-1)?.model).toBe('original-model');
    options.apiKey='NONSECRET_REPLACEMENT_KEY';
    await llm(request);expect(sent.at(-1)?.originalKey).toBe(true);
    options.fetchImpl=async()=>{replacementCalls++;return response();};
    await llm(request);
    expect(replacementCalls).toBe(0);
    expect(sent).toEqual(Array.from({length:3},()=>({model:'original-model',originalKey:true})));
  });
  it('preserves truncation without parsing unfinished JSON', async () => {
    const llm = openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model:'m',fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'{"unfinished"'},finish_reason:'length'}]}))});
    expect(await llm(request)).toEqual({text:'{"unfinished"',truncated:true});
  });
  it('bounds response bytes while consuming the transport body', async () => {
    let canceled = false;
    let pushed = false;
    const response = new Response(new ReadableStream({pull(c){if (!pushed) {pushed=true; c.enqueue(new TextEncoder().encode('x'.repeat(70)));}},cancel(){canceled = true;}}));
    const llm = openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model:'m',maxResponseBytes:64,fetchImpl:async()=>response});
    await expect(llm(request)).rejects.toThrow('Model connection request failed');
    expect(canceled).toBe(true);
  });
  it('keeps ignored-abort fetch occupied until the original operation settles', async () => {
    let signal: AbortSignal | null | undefined;
    let release!: (response:Response)=>void;
    let settled = false;
    const llm = openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model:'m',timeoutMs:10,fetchImpl:async(_,init)=>{
      signal=init?.signal; return await new Promise<Response>(resolve=>{release=resolve;});
    }});
    const pending = llm(request);
    void pending.then(()=>{settled=true;},()=>{settled=true;});
    await new Promise(resolve=>setTimeout(resolve,25));
    expect(signal?.aborted).toBe(true);
    const earlySettlement = settled;
    release(new Response('{}'));
    await expect(pending).rejects.toThrow(/^Model connection request failed$/);
    expect(earlySettlement).toBe(false);
  });
  it('aborts stalled injected response bodies and retains work until source cancellation settles', async () => {
    let source!:ReadableStreamDefaultController<Uint8Array>;
    let finishCancel!:()=>void;
    let canceled=false;
    let settled=false;
    const response=new Response(new ReadableStream<Uint8Array>({start(c){source=c;},cancel(){canceled=true;return new Promise<void>(resolve=>{finishCancel=resolve;});}}));
    const llm=openAiCompatibleLlm({baseUrl:'http://127.0.0.1/v1',model:'fixture',timeoutMs:10,fetchImpl:async()=>response});
    const pending=llm(request);
    void pending.then(()=>{settled=true;},()=>{settled=true;});
    await new Promise(resolve=>setTimeout(resolve,25));
    const cancelStarted=canceled;
    const settledBeforeCancellation=settled;
    if(canceled) finishCancel();
    else {source.enqueue(new TextEncoder().encode(JSON.stringify({choices:[{message:{content:'{}'},finish_reason:'stop'}]})));source.close();}
    await expect(pending).rejects.toThrow(/^Model connection request failed$/);
    expect(cancelStarted).toBe(true);
    expect(settledBeforeCancellation).toBe(false);
  });
  it('does not send an already canceled request', async () => {
    let sent = false;
    const llm = openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model:'m',fetchImpl:async()=>{sent=true;return new Response('{}');}});
    const controller = new AbortController(); controller.abort();
    await expect(llm({...request,signal:controller.signal})).rejects.toThrow('Model connection request failed');
    expect(sent).toBe(false);
  });
  it.each([0,-1,NaN,Infinity,99999999,1.5])('rejects unsupported bounds %s', value => {
    expect(() => openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model:'m',timeoutMs:value})).toThrow('Invalid model connection configuration');
    expect(() => openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model:'m',maxResponseBytes:value})).toThrow('Invalid model connection configuration');
  });
  it('bounds protected request bytes before sending', async () => {
    let sent = false;
    const llm = openAiCompatibleLlm({baseUrl:'https://example.com/v1',approvedOrigins:['https://example.com'],model:'m',fetchImpl:async()=>{sent=true;throw new Error('private');}});
    await expect(llm({...request,user:'x'.repeat(256001)})).rejects.toThrow('Model connection request failed');
    expect(sent).toBe(false);
  });
  it('pinned transport refuses redirects without a second socket or credential forwarding', async () => {
    let escaped = 0;
    let sourceHits=0;
    let sourceSockets=0;
    let targetSockets=0;
    const target = createServer((_,res)=>{escaped++;res.end('{}');});
    target.on('connection',()=>{targetSockets++;});
    const source = createServer((req,res)=>{
      sourceHits++;
      expect(req.headers.authorization).toBe('Bearer fixture-secret');
      res.writeHead(307,{location:`http://127.0.0.1:${(target.address() as {port:number}).port}/stolen`});res.end();
    });
    source.on('connection',()=>{sourceSockets++;});
    try {
      target.listen(0,'127.0.0.1'); await once(target,'listening');
      source.listen(0,'127.0.0.1'); await once(source,'listening');
      const llm = openAiCompatibleLlm({baseUrl:`http://127.0.0.1:${(source.address() as {port:number}).port}/v1`,model:'fixture',apiKey:'fixture-secret'});
      await expect(llm(request)).rejects.toThrow('Model connection request failed');
      expect(escaped).toBe(0);
      expect(sourceHits).toBe(1);expect(sourceSockets).toBe(1);expect(targetSockets).toBe(0);
    } finally {
      source.closeAllConnections();target.closeAllConnections();
      await Promise.all([new Promise<void>(resolve=>source.close(()=>resolve())),new Promise<void>(resolve=>target.close(()=>resolve()))]);
    }
  });
  it('uses a server-owned destination, nonstreaming JSON and protected messages', async () => {
    let sent: RequestInit | undefined;
    const llm = openAiCompatibleLlm({baseUrl:'http://127.0.0.1:11434/v1',model:'installed-model', fetchImpl:async (url, init) => {
      expect(String(url)).toBe('http://127.0.0.1:11434/v1/chat/completions'); sent = init;
      return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]}));
    }});
    expect(await llm(request)).toEqual({text:'{"ok":true}',truncated:false});
    expect(sent?.redirect).toBe('error');
    expect(JSON.parse(String(sent?.body))).toMatchObject({model:'installed-model', stream:false, messages:[{role:'system',content:request.system},{role:'user',content:request.user}]});
  });
});
