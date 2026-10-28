// TEST ONLY. All credentials below are visibly synthetic, never real keys.
import {StrictMode} from 'react';
import {TransientSetupCredential} from '../transient-setup-credential';
let credentialReleases=0;
const releaseCredential=TransientSetupCredential.prototype.release;
TransientSetupCredential.prototype.release=function(){releaseCredential.call(this);if(this.take()!=='')throw Error('Release retained a synthetic key');credentialReleases++;};
import {createRoot} from 'react-dom/client';
import {StudioApp} from '../StudioApp';
import {StudioController} from '../controller';
import type {Candidate} from '../../workbench/types';
const host=document.getElementById('fixture')!;
const root=createRoot(host);
const operator='NONSECRET_OPERATOR_CONNECTION_FIXTURE';
const key='NONSECRET_KEY_CONNECTION_FIXTURE';
const initial={available:true,persistence:'server-memory',model:'claude-fixture',status:'unavailable',revision:'11111111-1111-4111-8111-111111111111'};
const configured={...initial,status:'configured',revision:'22222222-2222-4222-8222-222222222222'};
const external={...configured,available:false,persistence:'external'};
const calls:Array<{url:string;method:string}>=[];
const checks:string[]=[];
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
let reply:(method:string)=>Promise<Response>=async method=>json(method==='POST'?configured:initial);
let engineFixture=false;
const fetcher:typeof fetch=(url,init)=>{
  const method=init?.method??'GET';
  if(engineFixture&&String(url)!=='/api/studio/model-connections/anthropic/setup'){
    assert(method==='GET','Engine fixture permits only explicitly requested metadata reads');
    calls.push({url:String(url),method});
    if(String(url)==='/api/studio/health')return Promise.resolve(json({ok:true,selectedId:null,model:null,modelStatus:'unselected',verification:'not-probed'}));
    if(String(url)==='/api/studio/model-connections')return Promise.resolve(json({connections:['codex-chatgpt','flightdeck','local','anthropic'].map(id=>({id,label:id,model:id==='anthropic'?'claude-fixture':null,status:id==='anthropic'?'configured':'unavailable',verification:'not-probed'})),selectedId:null}));
    if(/^\/api\/studio\/projects\/[a-z0-9-]+\/skills$/.test(String(url)))return Promise.resolve(json({projectId:String(url).split('/')[4],skillSourceState:'empty',skillSources:[]}));
    if(String(url)==='/api/studio/authoring')return Promise.resolve(json({engine:'native-v1',enabled:true,connectionIds:['anthropic'],maxModelCalls:6,maxToolCalls:16,draftOnly:true,executed:false,deployed:false}));
    throw Error('Unexpected engine fixture API');
  }
  assert(String(url)==='/api/studio/model-connections/anthropic/setup','Transport uses only the existing fixed setup endpoint');
  assert(init?.credentials==='omit'&&init.redirect==='error'&&init.cache==='no-store','Transport preserves bearer-only/no-redirect/no-store policy');
  assert((init?.headers as Record<string,string>).Authorization===`Bearer ${operator}`,'Operator auth is not the model key');
  if(method==='POST'){
    const body=JSON.parse(String(init?.body));
    assert(body.apiKey===key&&body.expectedRevision===initial.revision,'One CAS write carries the exact synthetic key and freshly loaded revision');
  }
  // Never retain headers/bodies/credential material in this evidence ledger.
  calls.push({url:String(url),method});return reply(method);
};
const controller=new StudioController(fetcher);
root.render(<StrictMode><StudioApp controller={controller} fetcher={fetcher}/></StrictMode>);
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
function assert(value:unknown,label:string){if(!value)throw new Error(label);checks.push(label);}
function get<T extends Element=HTMLElement>(selector:string){const node=host.querySelector<T>(selector);if(!node)throw new Error(`Missing ${selector}`);return node;}
function button(text:string){const node=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===text&&node.getClientRects().length>0&&!node.closest('[hidden],[inert]'));if(!node)throw new Error(`Missing reachable button: ${text}`);return node;}
async function input(node:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){const proto=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();}
async function waitFor(test:()=>boolean,label:string){for(let i=0;i<120;i++){if(test())return;await pause();}throw new Error(`Timed out: ${label}`);}
const panel=()=>get<HTMLDialogElement>('dialog[aria-label="Connection settings"]');
const field=()=>get<HTMLInputElement>('[aria-label="Anthropic API key"]');
async function open(){const trigger=button('Connection settings');trigger.focus();trigger.click();await pause();return trigger;}
async function close(){button('Close').click();await pause();}
async function enter(){await input(field(),key);get<HTMLInputElement>('.studio-anthropic-consent input').click();await pause();}
const result=()=>({developmentFixture:true,realSignInVerified:false,providerVerified:false,checks:[...checks],calls:[...calls]});
async function initialChecks(){
  await pause();await pause();assert(calls.length===0,'StrictMode mount does not request metadata');
  await input(get<HTMLTextAreaElement>('.studio-compose textarea'),'NONSECRET unsent authoring request');
  const trigger=await open();
  assert(panel().open&&panel().matches(':modal'),'Connection settings is a real native modal');
  assert(calls.length===0,'Opening settings makes zero metadata, auth, probe or model requests');
  assert(panel().contains(document.activeElement),'Opening puts focus inside settings');
  assert(field().disabled,'Operator authentication is required independently of model key');
  await input(get<HTMLInputElement>('[aria-label="Operator token"]'),operator);
  await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'fixture-project');
  assert(!field().disabled,'Direct key field is available without a nested setup or initial metadata read');
  assert(field().type==='password'&&field().autocomplete==='off'&&!field().spellcheck&&field().getAttribute('value')===null,'Direct key input is masked and uncontrolled with autofill/spelling disabled');
  await input(field(),key);
  assert(calls.length===0,'Typing a key makes zero requests');
  assert(!host.innerHTML.includes(key)&&!JSON.stringify(controller.getState()).includes(key),'Synthetic key never appears in HTML attributes, transcript or controller');
  assert(button('Save session key').disabled,'Save requires explicit session-memory acknowledgment');
  await close();assert(field().value===''&&document.activeElement===trigger,'Close clears key and returns focus to exact trigger');
  assert(get<HTMLTextAreaElement>('.studio-compose textarea').value==='NONSECRET unsent authoring request','Opening and closing retains composer buffer');
  return result();
}
let retained:{editor:Element;ide:Element;workbench:unknown;studio:unknown;condition:HTMLInputElement}|null=null;
async function retainedChecks(){
  button('Open workflow example').click();await pause();
  // The real branch form is staged; it is not a directly saved node label.
  const node=[...host.querySelectorAll<HTMLButtonElement>('.wf-node-head')].find(node=>node.querySelector('code')?.textContent==='branch');if(!node)throw new Error('Missing real branch block');node.click();await pause();
  const condition=get<HTMLInputElement>('[aria-label="Condition field"]');
  await input(condition,'NONSECRET_pending_condition');
  const candidate:Candidate={manifest:{id:'fixture',label:'TEST ONLY retained source',version:'1.0.0',summary:null,icon:'Box',navSection:'project',routePrefix:'/fixture',webModuleId:'fixture',capabilities:[],visibleToRoles:[],envVar:'SUBAPP_FIXTURE_ENABLED',tablePrefix:'subapp_fixture_'},files:[{path:'web/src/subapps/fixture/index.tsx',contents:'// NONSECRET generated fixture\n',kind:'web-module'}],findings:[],rulesRun:[],notes:['TEST ONLY synthetic retention fixture']};
  const turn=controller.workbench.prompt('TEST ONLY source retention fixture');assert(!!turn,'Synthetic source fixture opens a local round');
  controller.workbench.settle(turn!,candidate);controller.workbench.editFile(candidate.files[0]!.path,'// NONSECRET dirty source buffer\n');controller.workbench.setLock(candidate.files[0]!.path,true);await pause();
  retained={editor:get('.wf-editor'),ide:get('.fd-wb'),workbench:controller.workbench.getState(),studio:controller.getState(),condition};
  const trigger=await open();
  assert(get('.studio-shell').getAttribute('data-area')==='editor','Settings does not force authoring route back to chat');
  assert(controller.getState()===retained.studio&&controller.workbench.getState()===retained.workbench,'Opening does not reset controllers, dirty buffers or locks');
  button('Done').click();await pause();
  assert(get('.wf-editor')===retained.editor&&get('.fd-wb')===retained.ide&&condition===retained.condition&&condition.value==='NONSECRET_pending_condition','Done preserves editor DOM and unapplied parameter draft');
  assert(controller.workbench.getState()===retained.workbench&&document.activeElement===trigger,'Done retains dirty source/lock snapshot and returns focus');
  // Keep this open for trusted CDP keyboard and backdrop checks.
  await open();return result();
}
async function saveChecks(){
  await enter();const before=calls.length;
  button('Save session key').click();
  assert(field().value==='','Submitting immediately clears the key field');
  await waitFor(()=>panel().textContent?.includes('Session key configured — not probed.')===true,'save fixture');
  assert(calls.slice(before).map(call=>call.method).join(',')==='GET,POST','One Save gesture does one fresh metadata read and exactly one CAS write');
  assert(get<HTMLSelectElement>('[aria-label="Model connection"]').value==='','Confirmed save never selects a model');
  assert(!panel().textContent?.includes(key),'Save response does not echo the key');
  return result();
}
let release:((response:Response)=>void)|null=null;
async function pendingCloseChecks(){
  reply=method=>method==='POST'?new Promise(resolve=>{release=resolve;}):Promise.resolve(json(initial));
  await enter();const before=calls.length;button('Save session key').click();
  await waitFor(()=>calls.length===before+2,'pending fixture POST');
  get<HTMLFormElement>('.studio-anthropic-inline form').requestSubmit();await pause();
  assert(calls.length===before+2,'Pending ref blocks duplicate submission');
  await close();await open();
  assert(panel().textContent?.includes('Server state is uncertain.')&&field().disabled,'Closing a pending write discloses uncertainty on reopen and blocks write retry');
  release!(json(configured));await pause();await pause();
  assert(!panel().textContent?.includes('Session key configured — not probed.'),'A late closed-session callback cannot announce success');
  assert(calls.length===before+2,'Close and reopen never retries metadata or mutation');
  reply=async()=>json(initial);button('Load setup status').click();
  await waitFor(()=>!field().disabled,'explicit uncertainty recovery');
  assert(calls.length===before+3&&!panel().textContent?.includes('Server state is uncertain.'),'Only an explicit successful metadata reload clears uncertainty');
  return result();
}
async function contextChecks(){
  // A save cancelled during its fresh GET must never proceed to POST.
  reply=()=>new Promise(resolve=>{release=resolve;});await enter();const before=calls.length;
  button('Save session key').click();await waitFor(()=>calls.length===before+1,'pending metadata GET');
  await close();release!(json(initial));await pause();await pause();
  assert(calls.length===before+1,'Closing during fresh metadata load prevents the subsequent CAS write');
  await open();assert(!panel().textContent?.includes('Server state is uncertain.'),'Cancelled read alone does not invent write uncertainty');
  reply=async()=>json(initial);
  for(const kind of ['project','operator','provider','navigation'] as const){
    await input(field(),key);
    if(kind==='project')await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'fixture-project-changed');
    if(kind==='operator'){await input(get<HTMLInputElement>('[aria-label="Operator token"]'),operator+'-changed');await input(get<HTMLInputElement>('[aria-label="Operator token"]'),operator);}
    if(kind==='provider')await input(get<HTMLSelectElement>('[aria-label="Model connection"]'),'');
    if(kind==='navigation'){window.dispatchEvent(new PopStateEvent('popstate'));await pause();}
    assert(field().value==='',`${kind} context change clears the uncontrolled field`);
    if(kind==='navigation')await open();
  }
  return result();
}
async function refusalChecks(){
  reply=async method=>method==='POST'?new Response('NONSECRET_RAW_ERROR',{status:409}):json(initial);
  const before=calls.length;await enter();button('Save session key').click();
  await waitFor(()=>!!panel().querySelector('.studio-anthropic-error'),'CAS refusal');
  assert(calls.length===before+2&&field().value===''&&field().disabled,'CAS refusal clears key, blocks another write and never auto-retries');
  assert(panel().querySelector('.studio-anthropic-error')?.textContent==='Setup changed. Reload setup status before trying again.'&&!host.innerHTML.includes('NONSECRET_RAW_ERROR'),'CAS error is fixed safe copy, not a raw response');
  reply=async()=>json(external);button('Load setup status').click();
  await waitFor(()=>!!panel().querySelector('[aria-label="Externally managed connection"]'),'external metadata');
  assert(!panel().querySelector('.studio-anthropic-inline form'),'External ownership removes key, consent and mutation form');
  const text=get('.studio-anthropic-inline').textContent??'';
  assert(text.includes('retention')&&text.includes('unknown')&&!text.includes('destination is the official Anthropic API'),'External destination/retention are not relabeled session-only');
  await close();await open();await input(field(),key);
  const attempt=calls.length;get<HTMLInputElement>('.studio-anthropic-consent input').click();await pause();button('Save session key').click();
  await waitFor(()=>!!panel().querySelector('[aria-label="Externally managed connection"]'),'fresh Save external refusal');
  assert(calls.length===attempt+1&&calls.at(-1)?.method==='GET','Fresh Save metadata refuses externally owned setup before write');
  return result();
}
async function prepareNative(){await close();await open();return {open:panel().open,calls:calls.length};}
async function unmountCheck(){await input(field(),key);const node=field();root.unmount();assert(node.value===''&&!node.isConnected,'Unmount clears even a detached field reference');return result();}
async function lifetimeChecks(){
 await open();
 for(const kind of ['close','project','operator','navigation','pagehide'] as const){
  reply=()=>new Promise(resolve=>{release=resolve;});await enter();const before=calls.length;
  button('Save session key').click();await waitFor(()=>calls.length===before+1,'stalled metadata GET');
  const releases=credentialReleases;
  if(kind==='close')await close();
  if(kind==='project')await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'fixture-project-release');
  if(kind==='operator'){await input(get<HTMLInputElement>('[aria-label="Operator token"]'),operator+'-changed');await input(get<HTMLInputElement>('[aria-label="Operator token"]'),operator);}
  if(kind==='navigation'){window.dispatchEvent(new PopStateEvent('popstate'));await pause();}
  if(kind==='pagehide'){window.dispatchEvent(new PageTransitionEvent('pagehide'));await pause();}
  assert(credentialReleases>releases,`${kind} proactively releases the held pre-dispatch key while metadata is still unresolved`);
  assert(field().value==='',`${kind} clears masked DOM value`);
  release!(json(initial));await pause();await pause();
  assert(calls.length===before+1&&!panel().textContent?.includes('Session key configured — not probed.'),`${kind} rejects late read and never writes`);
  if(!panel().open)await open();else {await close();await open();}
 }
 reply=async()=>json(initial);return result();
}
async function engineChecks(){
 if(!panel().open)await open();engineFixture=true;reply=async()=>json(initial);
 button('Check connection & project skills').click();await waitFor(()=>!get<HTMLSelectElement>('[aria-label="Model connection"] option[value="anthropic"]').disabled,'configured synthetic Anthropic metadata');
 await input(get<HTMLSelectElement>('[aria-label="Model connection"]'),'anthropic');
 get<HTMLDetailsElement>('.studio-authoring-options').open=true;button('Check native authoring availability').click();
 await waitFor(()=>!get<HTMLSelectElement>('[aria-label="Authoring engine"] option[value="native-v1"]').disabled,'synthetic native availability');
 await input(field(),key);const before=calls.length;
 await input(get<HTMLSelectElement>('[aria-label="Authoring engine"]'),'native-v1');
 assert(field().value===''&&calls.length===before,'Changing authoring engine clears key without metadata, probe or send');
 reply=()=>new Promise(resolve=>{release=resolve;});await enter();button('Save session key').click();await waitFor(()=>calls.length===before+1,'engine pending metadata');
 const releases=credentialReleases;await input(get<HTMLSelectElement>('[aria-label="Authoring engine"]'),'json-planner');
 assert(credentialReleases>releases,'Engine change releases held key before pending metadata settles');
 release!(json(initial));await pause();await pause();assert(calls.length===before+1&&!panel().textContent?.includes('Session key configured — not probed.'),'Engine change prevents late metadata write and result');
 reply=method=>method==='POST'?new Promise(resolve=>{release=resolve;}):Promise.resolve(json(initial));await enter();button('Save session key').click();await waitFor(()=>calls.length===before+3,'engine pending write');
 await input(get<HTMLSelectElement>('[aria-label="Authoring engine"]'),'json-planner');release!(json(configured));await pause();await pause();
 assert(field().disabled&&panel().textContent?.includes('Server state is uncertain.')&&!panel().textContent?.includes('Session key configured — not probed.'),'Engine invalidates pending write result while preserving possible-commit uncertainty');
 reply=async()=>json(initial);button('Load setup status').click();await waitFor(()=>!field().disabled,'engine explicit recovery');engineFixture=false;return result();
}
Object.assign(window,{connectionFixture:{engineChecks,lifetimeChecks,initialChecks,retainedChecks,saveChecks,pendingCloseChecks,contextChecks,refusalChecks,prepareNative,unmountCheck,result,panel,field,button,input,open,close,pause}});
