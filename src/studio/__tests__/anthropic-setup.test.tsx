import {renderToStaticMarkup} from 'react-dom/server';
import {StudioApp} from '../StudioApp';
import {describe, expect, it, vi} from 'vitest';
import * as setup from '../anthropic-setup-client';
import {parseAnthropicSetupMetadata} from '../anthropic-setup-client';

// Nonsecret, hand-written DTO fixtures. Not evidence of backend integration.
const fixture = {available:true, persistence:'server-memory', model:'claude-fixture', status:'unavailable', revision:'11111111-1111-4111-8111-111111111111'} as const;

it('parses the exact public session-setup metadata fixture', async()=>{
  const api = await import('../anthropic-setup-client').catch(()=>({parseAnthropicSetupMetadata:undefined}));
  expect(api.parseAnthropicSetupMetadata?.(fixture)).toEqual(fixture);
});

it.each([
  null, {}, {...fixture, available:false}, {...fixture, persistence:'encrypted'},
  {...fixture,persistence:'external'}, {...fixture,available:false,persistence:'external',apiKey:'NONSECRET_VALUE_FIXTURE'},
  {...fixture, status:'connected'}, {...fixture, revision:'not-a-uuid'}, {...fixture, apiKey:'NONSECRET_FIXTURE'},
  ...['', 'x'.repeat(201), 'line\nfeed', '\u007f', '\u009f', '\u202e', '\u2028', 'https://fixture.invalid', 'https:fixture.invalid', '//fixture.invalid', 'data:fixture', 'www.fixture.invalid', 'sk-fixture', 'Bearer fixture'].map(model=>({...fixture,model})),
])('rejects untrusted metadata without exposing the raw DTO %#', value=>{
  expect(()=>parseAnthropicSetupMetadata(value)).toThrow('Invalid setup response. Reload setup status.');
});

it('offers explicit setup inside closed existing settings without keys, selection or network',()=>{
  const fetcher=vi.fn<typeof fetch>(),html=renderToStaticMarkup(<StudioApp fetcher={fetcher}/>);
  expect(html).toContain('Anthropic API key setup');
  expect(html).toContain('Never enter a model API key here');
  expect(html).not.toContain('aria-label="Anthropic API key"');
  expect(html).not.toContain('<dialog class="studio-anthropic-setup');
  expect(html).not.toMatch(/<option[^>]*selected[^>]*value="anthropic"/);
  expect(html).toContain('<details class="studio-connection-help"><summary>Project &amp; model setup');
  expect(fetcher).not.toHaveBeenCalled();
});

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const context=()=>({signal:new AbortController().signal,isCurrent:()=>true});
const operator='NONSECRET_OPERATOR_FIXTURE';
it('explicitly reads and CAS-writes only the fixed bearer-only setup route',async()=>{
  expect(setup.AnthropicSetupClient).toBeTypeOf('function');
  const changed={...fixture,status:'configured',revision:'22222222-2222-4222-8222-222222222222'};
  const removed={...fixture,revision:'33333333-3333-4333-8333-333333333333'};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json(fixture)).mockResolvedValueOnce(json(changed)).mockResolvedValueOnce(json(removed));
  const client=new setup.AnthropicSetupClient(fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await client.load(operator,context())).toEqual(fixture);
  expect(await client.save(operator,' NONSECRET_KEY_FIXTURE ',fixture.revision,context())).toEqual(changed);
  expect(await client.remove(operator,changed.revision,context())).toEqual(removed);
  expect(fetcher.mock.calls.map(call=>call[0])).toEqual(Array(3).fill('/api/studio/model-connections/anthropic/setup'));
  for(const [,init]of fetcher.mock.calls)expect(init).toMatchObject({credentials:'omit',redirect:'error',cache:'no-store',headers:{Authorization:`Bearer ${operator}`}});
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({method:'GET'});
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({apiKey:' NONSECRET_KEY_FIXTURE ',expectedRevision:fixture.revision});
  expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({expectedRevision:changed.revision});
});

it.each([[401,'Authentication refused.'],[403,'Setup request refused.'],[404,'Session setup is disabled.'],[409,'Setup changed. Reload setup status before trying again.'],[413,'Setup request refused.'],[500,'Setup unavailable. Reload setup status.']])('sanitizes HTTP %s and does not retry a write',async(status,message)=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('NONSECRET_RAW_ERROR_FIXTURE',{status:Number(status)}));
  await expect(new setup.AnthropicSetupClient(fetcher).save(operator,'NONSECRET_KEY_FIXTURE',fixture.revision,context())).rejects.toThrow(String(message));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('sanitizes transport failures and never echoes credentials or raw errors',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockRejectedValue(new Error('NONSECRET_RAW_ERROR_FIXTURE'));
  await expect(new setup.AnthropicSetupClient(fetcher).save(operator,'NONSECRET_KEY_FIXTURE',fixture.revision,context())).rejects.toThrow('Setup unavailable. Reload setup status.');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['','x'.repeat(8193),'nonsecret\nfixture','nonsecret\u0000fixture','nonsecret\u007ffixture','nonsecret\u009ffixture','nonsecret\u2028fixture','nonsecret\u2029fixture','nonsecret\u202efixture'])('refuses invalid credentials before transport %#',async key=>{
  const fetcher=vi.fn<typeof fetch>();
  await expect(new setup.AnthropicSetupClient(fetcher).save(operator,key,fixture.revision,context())).rejects.toThrow('Enter a single-line API key of 1 to 8192 characters.');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['','invalid\noperator'])('refuses missing or multiline bearer auth locally %#',async token=>{
  const fetcher=vi.fn<typeof fetch>();
  await expect(new setup.AnthropicSetupClient(fetcher).load(token,context())).rejects.toThrow('Authentication refused.');
  expect(fetcher).not.toHaveBeenCalled();
});
it('requires a UUID CAS revision before writes',async()=>{
  const fetcher=vi.fn<typeof fetch>();
  await expect(new setup.AnthropicSetupClient(fetcher).remove(operator,'bad-revision',context())).rejects.toThrow('Reload setup status before making changes.');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['POST','DELETE'] as const)('refuses inconsistent %s success metadata',async method=>{
  const client=new setup.AnthropicSetupClient(async()=>json({...fixture,status:method==='POST'?'unavailable':'configured'}));
  await expect(method==='POST'?client.save(operator,'NONSECRET_KEY_FIXTURE',fixture.revision,context()):client.remove(operator,fixture.revision,context())).rejects.toThrow('Invalid setup response. Reload setup status.');
});

it.each(['POST','DELETE'] as const)('refuses externally managed metadata as a successful %s mutation',async method=>{
  const external={...fixture,available:false,persistence:'external',status:method==='POST'?'configured':'unavailable',revision:'22222222-2222-4222-8222-222222222222'};
  const fetcher=vi.fn<typeof fetch>(async()=>json(external));
  const client=new setup.AnthropicSetupClient(fetcher);
  await expect(method==='POST'?client.save(operator,'NONSECRET_KEY_FIXTURE',fixture.revision,context()):client.remove(operator,fixture.revision,context())).rejects.toThrow('Invalid setup response. Reload setup status.');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('refuses an already aborted request before transport',async()=>{
  const abort=new AbortController();abort.abort();const fetcher=vi.fn<typeof fetch>();
  await expect(new setup.AnthropicSetupClient(fetcher).load(operator,{signal:abort.signal,isCurrent:()=>true})).rejects.toThrow('Setup request cancelled.');
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['abort','epoch'] as const)('discards a late transport response on %s and cancels its stream',async mode=>{
  const abort=new AbortController();let current=true;let release!:(response:Response)=>void;
  const cancel=vi.fn();const response=new Response(new ReadableStream({cancel}),{headers:{'content-type':'application/json'}});
  const fetcher=vi.fn<typeof fetch>(()=>new Promise(resolve=>{release=resolve;}));
  const pending=new setup.AnthropicSetupClient(fetcher).load(operator,{signal:abort.signal,isCurrent:()=>current});
  const settled=pending.catch(error=>error.message);
  if(mode==='abort')abort.abort();else current=false;
  release(response);
  expect(await Promise.race([settled,new Promise(resolve=>setTimeout(()=>resolve('still waiting'),150))])).toBe('Setup request cancelled.');
  expect(cancel).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('cancels a stalled body read immediately when aborted',async()=>{
  const abort=new AbortController(),cancel=vi.fn();let reading!:(value:void)=>void;
  const readStarted=new Promise<void>(resolve=>{reading=resolve;});
  const response=new Response(new ReadableStream({pull(){reading();},cancel}),{headers:{'content-type':'application/json'}});
  const pending=new setup.AnthropicSetupClient(async()=>response).load(operator,{signal:abort.signal,isCurrent:()=>true}).catch(error=>error.message);
  await readStarted;abort.abort();
  expect(await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('still waiting'),150))])).toBe('Setup request cancelled.');
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('checks current epoch after the final awaited stream read',async()=>{
  let current=true;const encoded=new TextEncoder().encode(JSON.stringify(fixture));let pull=0;
  const response=new Response(new ReadableStream({pull(controller){if(pull++===0)controller.enqueue(encoded);else{current=false;controller.close();}}}),{headers:{'content-type':'application/json'}});
  await expect(new setup.AnthropicSetupClient(async()=>response).load(operator,{signal:new AbortController().signal,isCurrent:()=>current})).rejects.toThrow('Setup request cancelled.');
});
it('bounds oversized streamed responses at 4096 bytes and cancels the source',async()=>{
  const cancel=vi.fn();const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4097));},cancel}),{headers:{'content-type':'application/json'}});
  await expect(new setup.AnthropicSetupClient(async()=>response).load(operator,context())).rejects.toThrow('Invalid setup response. Reload setup status.');
  expect(cancel).toHaveBeenCalledTimes(1);
});
it('refuses untrusted content types and malformed UTF-8 without raw errors',async()=>{
  for(const response of [new Response('NONSECRET_RAW_ERROR_FIXTURE'),new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}})]){
    await expect(new setup.AnthropicSetupClient(async()=>response).load(operator,context())).rejects.toThrow('Invalid setup response. Reload setup status.');
  }
});
