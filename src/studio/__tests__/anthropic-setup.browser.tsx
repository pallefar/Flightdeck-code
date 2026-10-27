// DEVELOPMENT ONLY: hand-written fake DTO responses, never a backend/provider proof.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioApp} from '../StudioApp';
import {StudioController} from '../controller';
import {AnthropicSetupClient,AnthropicSetupError} from '../anthropic-setup-client';
const host=document.getElementById('fixture')!;
const root=createRoot(host);
const nonsecretOperator='NONSECRET_OPERATOR_UI_FIXTURE';
const nonsecretKey='NONSECRET_KEY_UI_FIXTURE';
const initial={available:true,persistence:'server-memory',model:'claude-fixture',status:'unavailable',revision:'11111111-1111-4111-8111-111111111111'};
const configured={...initial,status:'configured',revision:'22222222-2222-4222-8222-222222222222'};
const removed={...initial,revision:'33333333-3333-4333-8333-333333333333'};
const calls:Array<{url:string;method:string}>=[];
const checks:string[]=[];
let reply:(method:string,url:string)=>Promise<Response>=async method=>json(method==='POST'?configured:method==='DELETE'?removed:initial);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const fetcher:typeof fetch=(url,init)=>{const method=init?.method??'GET';calls.push({url:String(url),method});return reply(method,String(url));};
const controller=new StudioController(fetcher);
root.render(<StrictMode><StudioApp controller={controller} fetcher={fetcher}/></StrictMode>);
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
function assert(value:unknown,label:string){if(!value)throw new Error(label);checks.push(label);}
function get<T extends Element=HTMLElement>(selector:string){const node=host.querySelector<T>(selector);if(!node)throw new Error(`Missing ${selector}`);return node;}
function button(text:string){const node=[...host.querySelectorAll<HTMLButtonElement>('button')].find(value=>value.textContent===text);if(!node)throw new Error(`Missing button ${text}`);return node;}
async function input(node:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){const proto=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();}
async function waitFor(test:()=>boolean,label:string){for(let i=0;i<160;i++){if(test())return;await pause();}throw new Error(`Timed out: ${label}`);}
function result(){return{developmentFixture:true,backendVerified:false,vendorCalls:0,checks:[...checks],calls:[...calls]};}
export async function runInitialSetupChecks(){
  await pause();await pause();assert(calls.length===0,'StrictMode mount has zero networking');
  button('Connection settings').click();await pause();assert(calls.length===0,'Ordinary Setup action has zero networking');
  assert(button('Anthropic API key setup').disabled,'Missing operator token disables setup');
  await input(get<HTMLInputElement>('[aria-label="Operator token"]'),nonsecretOperator);
  await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'development-project');
  await input(get<HTMLTextAreaElement>('.studio-compose textarea'),'Unsent request must survive setup');
  const graph=get('.wf-editor'),ide=get('.fd-wb');
  const opener=button('Anthropic API key setup');opener.focus();opener.click();await pause();
  assert(calls.length===0,'Opening key modal performs no automatic metadata or model call');
  const dialog=get<HTMLDialogElement>('dialog[aria-label="Anthropic session key setup"]');
  assert(dialog.open&&dialog.matches(':modal'),'Native modal is in the top layer');
  assert(dialog.contains(document.activeElement),'Opening modal places focus inside');
  const field=get<HTMLInputElement>('[aria-label="Anthropic API key"]');
  assert(field.type==='password'&&field.autocomplete==='off'&&!field.spellcheck&&field.getAttribute('autocapitalize')==='off'&&field.autocapitalize==='none','Secret input is masked with autofill/spellcheck/capitalization disabled');
  assert(field.getAttribute('value')===null,'Secret input has no value attribute');
  button('Load setup status').click();await waitFor(()=>!field.disabled,'explicit fixture metadata read');
  assert(calls.length===1&&calls[0]?.method==='GET','Only Load setup status fetches metadata');
  await input(field,nonsecretKey);
  assert(!host.innerHTML.includes(nonsecretKey)&&!JSON.stringify(controller.getState()).includes(nonsecretKey),'Typed fixture is absent from HTML attributes, text and controller/transcript state');
  assert(button('Save session key').disabled,'Saving requires a fresh explicit persistence acknowledgment');
  get<HTMLInputElement>('.studio-anthropic-consent input').click();await pause();
  button('Save session key').click();assert(field.value==='','Submit clears the DOM key immediately');
  await waitFor(()=>dialog.textContent?.includes('Session key configured')===true,'fixture save result');
  assert(calls.length===2&&calls[1]?.method==='POST','Save makes one setup write with no probe or automatic readback/model call');
  assert(get<HTMLSelectElement>('[aria-label="Model connection"]').value===''&&button('Create draft').disabled,'Saving does not select a model or enable draft creation');
  assert(get<HTMLTextAreaElement>('.studio-compose textarea').value==='Unsent request must survive setup','Unsent request is preserved');
  assert(get('.wf-editor')===graph&&get('.fd-wb')===ide,'Setup preserves retained editor and Workbench DOM');
  button('Close key setup').click();await pause();assert(!host.contains(field)&&field.value==='','Close removes and clears the key field');
  assert(document.activeElement===opener,'Close restores focus to the exact opener');
  return result();
}
export async function runNavigationClearChecks(){
  for(const kind of ['project','token','provider','navigation','pagehide']){
    button('Connection settings').click();await pause();
    button('Anthropic API key setup').click();await pause();
    button('Load setup status').click();const field=get<HTMLInputElement>('[aria-label="Anthropic API key"]');await waitFor(()=>!field.disabled,'metadata before scope clear');
    await input(field,nonsecretKey);
    if(kind==='project')await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'changed-development-project');
    else if(kind==='token')await input(get<HTMLInputElement>('[aria-label="Operator token"]'),nonsecretOperator+'-changed');
    else if(kind==='provider')await input(get<HTMLSelectElement>('[aria-label="Model connection"]'),'');
    else if(kind==='navigation'){button('Workflow builder').click();await pause();}
    else{window.dispatchEvent(new Event('pagehide'));await pause();}
    assert(field.value===''&&!host.contains(field),`${kind} clears and removes the secret field`);
    assert(!host.querySelector('.studio-anthropic-setup'),`${kind} closes the modal without retaining a hidden key`);
  }
  return result();
}
async function openLoaded(){
  button('Connection settings').click();await pause();button('Anthropic API key setup').click();await pause();
  button('Load setup status').click();const field=get<HTMLInputElement>('[aria-label="Anthropic API key"]');await waitFor(()=>!field.disabled,'explicit metadata');return field;
}
async function acknowledge(field:HTMLInputElement){await input(field,nonsecretKey);get<HTMLInputElement>('.studio-anthropic-consent input').click();await pause();}
export async function runSecuritySetupChecks(){
  // A pending fake write may have reached the server. Closing cannot claim no change.
  let field=await openLoaded(),release!:(response:Response)=>void;
  reply=method=>method==='POST'?new Promise(resolve=>{release=resolve;}):Promise.resolve(json(configured));
  await acknowledge(field);const before=calls.length;const form=get<HTMLFormElement>('.studio-anthropic-setup form');
  button('Save session key').click();form.requestSubmit();
  assert(field.value===''&&calls.length===before+1,'Busy ref prevents synchronous double submission and immediately clears the key');
  button('Close key setup').click();await pause();button('Anthropic API key setup').click();await pause();
  assert(get('.studio-anthropic-setup').textContent?.includes('Server state is uncertain.'),'Cancelled writes disclose possible server mutation on reopen');
  assert(get<HTMLInputElement>('[aria-label="Anthropic API key"]').disabled,'Uncertainty blocks further writes until explicit reload');
  release(json(configured));await pause();await pause();
  assert(!get('.studio-anthropic-setup').textContent?.includes('Session key configured'),'Late write cannot announce success or accept state in a reopened dialog');
  const reloadStart=calls.length;button('Load setup status').click();field=get<HTMLInputElement>('[aria-label="Anthropic API key"]');await waitFor(()=>!field.disabled,'uncertainty reload');
  assert(calls.length===reloadStart+1,'Recovery is one explicit metadata read, not a write retry');
  assert(!get('.studio-anthropic-setup').textContent?.includes('Server state is uncertain.'),'Successful explicit reload clears uncertainty');
  reply=async method=>json(method==='DELETE'?removed:configured);
  button('Remove session key').click();await waitFor(()=>get('.studio-anthropic-setup').textContent?.includes('Session key removed.')===true,'fixture removal');
  assert(field.value===''&&button('Remove session key').disabled,'Confirmed removal has unavailable metadata and no retained credential');
  button('Close key setup').click();await pause();
  field=await openLoaded();reply=async()=>new Response('NONSECRET_RAW_ERROR_FIXTURE',{status:409});await acknowledge(field);
  const conflictStart=calls.length;button('Save session key').click();await waitFor(()=>!!host.querySelector('.studio-anthropic-error'),'fixture conflict');
  assert(calls.length===conflictStart+1&&field.value==='','Conflict performs no automatic retry and clears the key');
  assert(get('.studio-anthropic-error').textContent==='Setup changed. Reload setup status before trying again.','Conflict displays a fixed safe category');
  assert(!host.textContent?.includes('NONSECRET_RAW_ERROR_FIXTURE')&&field.disabled,'Raw server response never appears and stale metadata cannot authorize another write');
  reply=async()=>json({...configured,apiKey:'NONSECRET_RAW_ERROR_FIXTURE'});button('Load setup status').click();await waitFor(()=>host.querySelector('.studio-anthropic-error')?.textContent?.includes('Invalid setup response.')===true,'strict UI metadata rejection');
  assert(!host.innerHTML.includes('NONSECRET_RAW_ERROR_FIXTURE')&&field.disabled,'Malicious metadata extras are rejected, never reflected');
  button('Close key setup').click();await pause();

  // A model default after mutation must still require a new explicit model choice.
  reply=async(_method,url)=>url.endsWith('/health')?json({ok:true,selectedId:'anthropic',model:'claude-fixture',modelStatus:'configured',verification:'not-probed'}):url.endsWith('/model-connections')?json({selectedId:'anthropic',connections:['codex-chatgpt','flightdeck','local','anthropic'].map(id=>({id,label:id,model:id==='anthropic'?'claude-fixture':null,status:id==='anthropic'?'configured':'unavailable',verification:'not-probed'}))}):url.endsWith('/skills')?json({projectId:'development-project',skillSourceState:'empty',skillSources:[]}):json(configured);
  button('Check connection & project skills').click();await waitFor(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].some(node=>node.textContent==='Check connection & project skills'&&!node.disabled),'explicit descriptors after mutation');
  const select=get<HTMLSelectElement>('[aria-label="Model connection"]');
  assert(select.value===''&&button('Create draft').disabled,'Even a server Anthropic default is not selected after key mutation');
  await input(select,'anthropic');assert(!button('Create draft').disabled,'Only explicit model selection restores request eligibility');
  field=await openLoaded();
  let releaseDraft!:(response:Response)=>void;let resets=0;const originalReset=controller.reset.bind(controller);controller.reset=()=>{resets++;originalReset();};
  reply=(method,url)=>url.endsWith('/create')?new Promise(resolve=>{releaseDraft=resolve;}):Promise.resolve(json(method==='POST'?{...configured,revision:'44444444-4444-4444-8444-444444444444'}:configured));
  controller.workbench.prompt('Nonsecret prior private Workbench fixture');
  const pendingDraft=controller.submit({prompt:'Nonsecret pending draft fixture',connectionId:'anthropic',projectId:'development-project'},nonsecretOperator);
  await pause();assert(controller.getState().phase==='requesting'&&controller.workbench.getState().turns.length>0,'Explicit fake pending generation and private Workbench context are seeded');
  resets=0;await acknowledge(field);button('Save session key').click();
  assert(controller.getState().phase==='idle'&&controller.workbench.getState().turns.length===0&&Number(resets)===1,'Mutation start invalidates the generation and private Workbench before awaiting the write');
  await waitFor(()=>get('.studio-anthropic-setup').textContent?.includes('Session key configured')===true,'fixture changed callback');
  assert(Number(resets)===2&&select.value===''&&button('Create draft').disabled,'Confirmed mutation invalidates again without model selection or draft submission');
  releaseDraft(json({}));await pendingDraft;await pause();
  assert(controller.getState().phase==='idle'&&controller.getState().result===null,'Late old generation cannot restore a result after key mutation');
  controller.reset=originalReset;button('Close key setup').click();await pause();

  get<HTMLButtonElement>('.studio-voice-open').click();await pause();button('Enable voice').click();await pause();
  get<HTMLButtonElement>('[aria-label="Close voice settings"]').click();await pause();button('Anthropic API key setup').click();await pause();
  assert(get<HTMLElement>('.fd-voice-controls').dataset.voiceState==='off'&&get<HTMLElement>('.studio-voice-menu').hidden,'Opening key setup revokes voice consent and hides dictation controls');
  button('Close key setup').click();await pause();
  // Default browser transport reaches this owned fixture's fixed 404, not an illegal invocation.
  let nativeCategory='';try{await new AnthropicSetupClient().load(nonsecretOperator,{signal:new AbortController().signal,isCurrent:()=>true});}catch(error){nativeCategory=error instanceof AnthropicSetupError?error.code:'unexpected';}
  assert(nativeCategory==='disabled','Default native browser fetch is receiver-safe against an owned static 404 fixture');
  return result();
}
export async function prepareNativeModal(){
  button('Connection settings').click();await pause();button('Anthropic API key setup').click();await pause();
  return {open:get<HTMLDialogElement>('.studio-anthropic-setup').open,calls:calls.length};
}
export async function unmountClearCheck(){
  reply=async()=>json(configured);const field=await openLoaded();await input(field,nonsecretKey);root.unmount();
  assert(field.value===''&&!field.isConnected,'Unmount clears even a detached input reference');return result();
}
let externalBaseline:{calls:number;composer:string;graph:Element;ide:Element;form:HTMLFormElement}|null=null;
const external={available:false,persistence:'external',model:'external-fixture-model',status:'configured',revision:'55555555-5555-4555-8555-555555555555'};
export async function prepareExternalSetupChecks(){
  reply=async()=>json(external);
  button('Connection settings').click();await pause();
  await input(get<HTMLInputElement>('[aria-label="Operator token"]'),nonsecretOperator);
  await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'development-project');
  await input(get<HTMLTextAreaElement>('.studio-compose textarea'),'External setup must retain this unsent draft');
  externalBaseline={calls:calls.length,composer:get<HTMLTextAreaElement>('.studio-compose textarea').value,graph:get('.wf-editor'),ide:get('.fd-wb'),form:null as unknown as HTMLFormElement};
  return result();
}
export function rememberExternalForm(){if(!externalBaseline)throw new Error('Prepare external first');externalBaseline.form=get<HTMLFormElement>('.studio-anthropic-setup form');}
export function assertExternalSetupState(){
  if(!externalBaseline)throw new Error('Prepare external first');
  const modal=get<HTMLDialogElement>('.studio-anthropic-setup'),text=modal.textContent??'';
  assert(text.includes('Externally managed')&&text.includes('at its source'),'External ownership directs change/remove to its source');
  assert(text.includes('retention')&&text.includes('unknown'),'External retention is explicitly unknown here');
  assert(!modal.querySelector('form,input'),'External metadata exposes no credential form, key field or acknowledgment');
  assert(!text.includes('The key is held in server memory until restart, then lost.'),'External key never receives an unconditional restart-loss promise');
  assert(!text.includes('The destination is the official Anthropic API'),'External destination is not inferred from session setup');
  assert(calls.length===externalBaseline.calls+1&&calls.at(-1)?.method==='GET','External status loads only on one explicit gesture');
  externalBaseline.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  assert(!calls.some(call=>call.method!=='GET'),'Detached imperative form submission makes no setup write or model request');
  assert(get<HTMLTextAreaElement>('.studio-compose textarea').value===externalBaseline.composer&&get('.wf-editor')===externalBaseline.graph&&get('.fd-wb')===externalBaseline.ide,'External metadata retains composer and editor identities');
  assert(get<HTMLSelectElement>('[aria-label="Model connection"]').value==='','External metadata never selects a model');
  assert(external.revision==='55555555-5555-4555-8555-555555555555','External fixture revision is unchanged');
  return {...result(),external:{...external},modal:modal.open&&modal.matches(':modal'),focusInside:modal.contains(document.activeElement)};
}
Object.assign(window,{anthropicFixture:{runInitialSetupChecks,runNavigationClearChecks,runSecuritySetupChecks,prepareNativeModal,unmountClearCheck,prepareExternalSetupChecks,rememberExternalForm,assertExternalSetupState,button,input,get,pause,result}});
