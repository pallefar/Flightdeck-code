import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { createModelConnections } from './model-connections';
import { createServer } from './index';
import { createMemoryGrantStore } from '../packages/approvals/src/store';
import { RequestAdmission, admittedModel } from './request-admission';
import { MODEL_TRANSPORT_POLICY_ID } from '../packages/providers/src/model-transport';

it('invalidates the previous exact-context model binding for the zero-port transport policy revision',()=>{
  const baseUrl='http://127.0.0.1:11434/v1',model='fixture';
  const previousTarget=JSON.stringify([baseUrl,'studio-model-pinned-v1-iana-ipv4-2025-10-09',[]]);
  const previousBinding=createHash('sha256').update(JSON.stringify(['studio-model-binding-v1','local',previousTarget,model])).digest('hex');
  const registry=createModelConnections({env:{STUDIO_LOCAL_BASE_URL:baseUrl,STUDIO_LOCAL_MODEL:model}});
  expect(registry.resolve('local').bindingId).not.toBe(previousBinding);
  expect(MODEL_TRANSPORT_POLICY_ID).toBe('studio-model-pinned-v2-iana-ipv4-2025-10-09');
});
it('resolves only an explicitly configured local target without probing at construction', async () => {
  let calls = 0;
  const registry = createModelConnections({env:{STUDIO_MODEL_CONNECTION:'local',STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1',STUDIO_LOCAL_MODEL:'actual-model',STUDIO_LOCAL_API_KEY:'secret'},localFetch:async(url,init)=>{
    calls++; expect(String(url)).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect((init?.headers as Record<string,string>).authorization).toBe('Bearer secret');
    return new Response(JSON.stringify({choices:[{message:{content:'{"fixture":true}'},finish_reason:'stop'}]}));
  }});
  expect(calls).toBe(0);
  const connection = registry.resolveSelected();
  expect(connection.nativeAuthoring).toBeUndefined();
  expect(connection.descriptor).toMatchObject({id:'local',model:'actual-model',status:'configured',verification:'not-probed'});
  expect(connection.bindingId).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(registry.descriptors)).not.toMatch(/secret|127\.0\.0\.1/);
  expect(await connection.llm({system:'system',user:'user',purpose:'draft',attempt:1})).toEqual({text:'{"fixture":true}',truncated:false});
  expect(calls).toBe(1);
});
it('resolves a trusted Flightdeck bridge only with explicit host model and binding identity', async () => {
  const bridge = async () => ({text:'{"fixture":"host"}',truncated:false});
  const registry = createModelConnections({env:{STUDIO_MODEL_CONNECTION:'flightdeck'},flightdeckLlm:bridge,flightdeckModel:'approved-host-model',flightdeckBindingId:'approved-gateway-and-task-v1'});
  const resolved = registry.resolveSelected();
  expect(resolved.nativeAuthoring).toBeUndefined();
  expect(resolved.descriptor).toMatchObject({id:'flightdeck',model:'approved-host-model',status:'configured'});
  expect(await resolved.llm({system:'protected',user:'protected',purpose:'draft',attempt:1})).toEqual({text:'{"fixture":"host"}',truncated:false});
  expect(createModelConnections({env:{},flightdeckLlm:bridge}).descriptors.find(d=>d.id==='flightdeck')?.status).toBe('unavailable');
});
it('uses the existing Anthropic provider on explicit selection (injected SDK fixture)', async () => {
  let calls = 0;
  const client = {messages:{create:async (body: Record<string,unknown>)=>{
    calls++; expect(body.model).toBe('approved-claude-model');
    return {content:[{type:'text',text:'{"fixture":"anthropic"}'}],stop_reason:'end_turn',model:'approved-claude-model',usage:{input_tokens:1,output_tokens:1}};
  }}} as unknown as Anthropic;
  const registry = createModelConnections({env:{STUDIO_MODEL_CONNECTION:'anthropic',STUDIO_ANTHROPIC_MODEL:'approved-claude-model',ANTHROPIC_API_KEY:'fixture-secret'},anthropicClient:client});
  expect(calls).toBe(0);
  expect(registry.resolveSelected().nativeAuthoring).toBeUndefined();
  expect(await registry.resolveSelected().llm({system:'protected',user:'protected',purpose:'draft',attempt:1})).toEqual({text:'{"fixture":"anthropic"}',truncated:false});
  expect(calls).toBe(1);
  expect(JSON.stringify(registry.descriptors)).not.toContain('fixture-secret');
  expect(()=>createModelConnections({env:{STUDIO_MODEL_CONNECTION:'codex-chatgpt',ANTHROPIC_API_KEY:'fixture-secret'},anthropicClient:client}).resolveSelected()).toThrow('Model connection unavailable');
  expect(calls).toBe(1);
});
it('assigns every rebuilt base Anthropic connection a nonsecret review epoch, including same-key reconstruction', () => {
  let sends = 0;
  const client = new Anthropic({ apiKey: 'synthetic-base-key', authToken: null, webhookKey: null,
    baseURL: 'https://api.anthropic.com', logLevel: 'off', maxRetries: 0,
    fetch: async () => { sends++; throw new Error('must not probe'); },
  });
  const make = () => createModelConnections({ env: { STUDIO_ANTHROPIC_MODEL: 'fixture-model' }, anthropicClient: client });
  const first = make(); const second = make();
  const exact = first.resolve('anthropic');
  expect(exact.bindingId).not.toBe(second.resolve('anthropic').bindingId);
  expect(exact.bindingId).toMatch(/^[a-f0-9]{64}$/);
  expect(first.resolve('anthropic')).toBe(exact);
  expect(exact.bindingId + JSON.stringify(first.descriptors)).not.toMatch(/synthetic-base-key|nativeAuthoring|client/);
  expect(first.selectedId).toBeUndefined();
  expect(sends).toBe(0);
});
it('binding changes with destination/model/host policy, not secret rotation', () => {
  const binding = (baseUrl:string,model:string,key:string) => createModelConnections({env:{STUDIO_LOCAL_BASE_URL:baseUrl,STUDIO_LOCAL_MODEL:model,STUDIO_LOCAL_API_KEY:key,STUDIO_MODEL_APPROVED_ORIGINS:'["https://trusted.test","https://other.test"]'}}).resolve('local').bindingId;
  expect(binding('https://trusted.test/v1','m','a')).toBe(binding('https://trusted.test/v1','m','b'));
  expect(binding('https://trusted.test/v1','m','a')).not.toBe(binding('https://other.test/v1','m','a'));
  expect(binding('https://trusted.test/v1','m','a')).not.toBe(binding('https://trusted.test/v1','n','a'));
});
it('accepts only trusted startup JSON exact origins and binds the entire nonsecret policy without probing', () => {
  let calls=0;
  const registry=(origins:string|undefined)=>createModelConnections({env:{STUDIO_LOCAL_BASE_URL:'https://trusted.test/v1',STUDIO_LOCAL_MODEL:'fixture',...(origins===undefined?{}:{STUDIO_MODEL_APPROVED_ORIGINS:origins})},localFetch:async()=>{calls++;throw new Error('must not probe');}});
  expect(registry(undefined).descriptors.find(d=>d.id==='local')?.status).toBe('unavailable');
  const a=registry('["https://trusted.test"]').resolve('local');
  const b=registry('["https://trusted.test","https://other.test"]').resolve('local');
  expect(a.descriptor.verification).toBe('not-probed');
  expect(a.bindingId).not.toBe(b.bindingId);
  expect(b.bindingId).toBe(registry('["https://other.test","https://trusted.test"]').resolve('local').bindingId);
  expect(calls).toBe(0);
});
it.each(['','null','{}','"https://trusted.test"','https://trusted.test','["https://TRUSTED.test"]','["https://trusted.test/"]','["https://trusted.test:443"]','["https://trusted.test","https://trusted.test"]','["https://trusted.test",1]',' '.repeat(4097)])('refuses malformed trusted origin policy without exposing it %#', policy=>{
  const registry=createModelConnections({env:{STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:1234/v1',STUDIO_LOCAL_MODEL:'fixture',STUDIO_MODEL_APPROVED_ORIGINS:policy}});
  expect(registry.descriptors.find(d=>d.id==='local')).toMatchObject({status:'unavailable',reason:'Invalid model connection configuration'});
  expect(JSON.stringify(registry.descriptors)).not.toContain('trusted.test');
});
it.each([
  {STUDIO_LOCAL_BASE_URL:'http://evil.test/v1',STUDIO_LOCAL_MODEL:'m'},
  {STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1',STUDIO_LOCAL_MODEL:'bad model'},
  {STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:11434/v1'},
  {ANTHROPIC_API_KEY:'secret',STUDIO_ANTHROPIC_MODEL:'bad\nmodel'},
  {ANTHROPIC_API_KEY:'secret',FLIGHTDECK_EFFORT:'unsupported'},
])('marks unsupported configuration unavailable without leaking values %#', env => {
  const registry = createModelConnections({env});
  expect(registry.descriptors.every(d=>d.status==='unavailable')).toBe(true);
  expect(JSON.stringify(registry.descriptors)).not.toMatch(/secret|evil\.test|bad.*model|unsupported/);
});
it('rejects unknown explicit default selection', () => {
  expect(()=>createModelConnections({env:{STUDIO_MODEL_CONNECTION:'unknown-secret'}})).toThrow('Unknown model connection selection');
});
it.each(['raw-error','malformed','oversize'])('bounds and sanitizes trusted seam completion fixture %s', async mode => {
  const registry = createModelConnections({env:{},flightdeckModel:'m',flightdeckBindingId:'approved-v1',flightdeckLlm:async()=>{
    if (mode==='raw-error') throw new Error('secret-context');
    return {text:mode==='malformed' ? 'secret-context' : 'x'.repeat(256001)};
  }});
  await expect(registry.resolve('flightdeck').llm({system:'protected',user:'protected',purpose:'draft',attempt:1})).rejects.toThrow(/^Model connection request failed$/);
});
it('lists four explicit destinations without connection probes or fallback', () => {
  const registry = createModelConnections({env:{}});
  expect(registry.descriptors.map(d=>d.id)).toEqual(['codex-chatgpt','flightdeck','local','anthropic']);
  expect(registry.descriptors.every(d=>d.status === 'unavailable')).toBe(true);
  expect(registry.selectedId).toBeUndefined();
  expect(()=>registry.resolveSelected()).toThrow('No model connection selected');
  expect(()=>registry.resolve('anthropic')).toThrow('Model connection unavailable');
  expect(()=>registry.resolve('unknown')).toThrow('Unknown model connection');
});
it('invalidates an actual authenticated send review on an approved-origin-policy-only change', async()=>{
  const operator={actor:'Model egress fixture',token:'nonsecret-model-egress-fixture-token'};
  const headers={authorization:`Bearer ${operator.token}`};
  const skill={id:'review',version:'1',content:'review queue shows human_review for legal. human gate: human_review. country de.'};
  const sent:string[]=[];
  const registry=(origins:string)=>createModelConnections({env:{STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:1234/v1',STUDIO_LOCAL_MODEL:'fixture',STUDIO_MODEL_APPROVED_ORIGINS:origins},localFetch:async(_,init)=>{
    sent.push(String(init?.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({target:'workflow',reason:'A process.'})},finish_reason:'stop'}]}));
  }});
  const first=createServer({operator,modelConnections:registry('[]'),store:createMemoryGrantStore(),projectSkillSource:async()=>[skill]});
  const second=createServer({operator,modelConnections:registry('["https://newly-approved.test"]'),store:createMemoryGrantStore(),projectSkillSource:async()=>[skill]});
  const payload={prompt:'Review incoming requests for legal.',projectId:'alpha',connectionId:'local'};
  try {
    const before=await first.inject({method:'POST',url:'/api/studio/create',headers,payload});
    expect(before.json().status).toBe('model-request-refused');
    const hash=before.json().review.hash as string;
    const after=await second.inject({method:'POST',url:'/api/studio/create',headers,payload:{...payload,reviewedSkillHash:hash}});
    expect(after.json().status).toBe('model-request-refused');
    expect(after.json().review.hash).not.toBe(hash);
    expect(sent).toHaveLength(2);
    expect(sent.join('')).not.toContain(skill.content);
    expect(after.body).not.toMatch(/newly-approved|bindingId|127\.0\.0\.1/);
  } finally {await first.close();await second.close();}
});
it('rejects browser origin/header/key/policy authority before transport at every model route', async()=>{
  let calls=0;
  const registry=createModelConnections({env:{STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:1234/v1',STUDIO_LOCAL_MODEL:'fixture'},localFetch:async()=>{calls++;throw new Error('must not send');}});
  const operator={actor:'Model egress fixture',token:'nonsecret-model-egress-fixture-token'};
  const app=createServer({operator,modelConnections:registry,store:createMemoryGrantStore()});
  try {
    for(const url of ['/api/studio/create','/api/studio/build','/api/studio/blocks/propose']) {
      for(const override of [{baseUrl:'https://private.test'},{approvedOrigins:['https://private.test']},{headers:{authorization:'nonsecret-fixture'}},{apiKey:'nonsecret-fixture'},{policy:{approvedOrigins:['https://private.test']}}]) {
        const response=await app.inject({method:'POST',url,headers:{authorization:`Bearer ${operator.token}`},payload:{prompt:'Review requests.',connectionId:'local',...override}});
        expect(response.statusCode).toBe(400);expect(response.body).not.toMatch(/private\.test|nonsecret-fixture/);
      }
    }
    expect(calls).toBe(0);
  } finally {await app.close();}
});
it('retains real admission capacity through an ignored-abort original fetch settlement', async()=>{
  let release!:(response:Response)=>void;
  let markStarted!:()=>void;
  const started=new Promise<void>(resolve=>{markStarted=resolve;});
  let signal:AbortSignal|null|undefined;
  const registry=createModelConnections({env:{STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:1234/v1',STUDIO_LOCAL_MODEL:'fixture'},localFetch:async(_,init)=>{
    signal=init?.signal;markStarted();return await new Promise<Response>(resolve=>{release=resolve;});
  }});
  const admission=new RequestAdmission({global:1,deadlineMs:10,drainMs:10});
  const permit=admission.acquire('fixture','alpha')!;
  const pending=admittedModel(registry.resolve('local').llm,permit)({system:'fixture',user:'fixture',purpose:'draft',attempt:1});
  void pending.catch(()=>{});
  await started;
  const releasing=permit.release();
  await new Promise(resolve=>setTimeout(resolve,25));
  expect(signal?.aborted).toBe(true);
  expect(admission.snapshot().active).toBe(1);
  expect(admission.acquire('other','beta')).toBeUndefined();
  await expect(admission.close()).rejects.toThrow('request admission drain incomplete');
  release(new Response('{}'));
  await expect(pending).rejects.toThrow('model work unavailable');
  await releasing;
  expect(admission.snapshot().active).toBe(0);
  await admission.close();
});
