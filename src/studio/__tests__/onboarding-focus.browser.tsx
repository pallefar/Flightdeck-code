// TEST ONLY: mounted actual StudioApp; bounded synthetic metadata, never a provider.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioApp} from '../StudioApp';
import {StudioController} from '../controller';
const host=document.getElementById('fixture')!,root=createRoot(host);
const calls:Array<{method:string;path:string}>=[],checks:string[]=[];
const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
const fetcher:typeof fetch=async(url,init)=>{
 const path=String(url),method=init?.method??'GET';calls.push({path,method});
 if(method!=='GET')throw Error('Synthetic focus fixture refuses mutations');
 if(path==='/api/studio/health')return json({ok:true,selectedId:null,model:null,modelStatus:'unselected',verification:'not-probed'});
 if(path==='/api/studio/model-connections')return json({connections:['codex-chatgpt','flightdeck','local','anthropic'].map(id=>({id,label:id,model:id==='local'?'NONSECRET_json_fixture':null,status:id==='local'?'configured':'unavailable',verification:'not-probed'})),selectedId:null});
 if(path==='/api/studio/projects/fixture-project/skills')return json({projectId:'fixture-project',skillSourceState:'empty',skillSources:[]});
 throw Error('Synthetic fixture unexpected path');
};
window.fetch=async()=>{throw Error('Native network disabled');};
const controller=new StudioController(fetcher);
root.render(<StrictMode><StudioApp controller={controller} fetcher={fetcher}/></StrictMode>);
const pause=()=>new Promise(r=>setTimeout(r,25));
function assert(v:unknown,label:string){if(!v)throw Error(label);checks.push(label);}
function get<T extends Element=HTMLElement>(s:string){const n=host.querySelector<T>(s);if(!n)throw Error('Missing '+s);return n;}
async function input(node:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){const proto=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();}
const panel=()=>get<HTMLDialogElement>('.studio-connection-panel');
let opener:HTMLElement,refs:{editor:Element;ide:Element;store:unknown;state:unknown};
async function initial(){await pause();assert(calls.length===0,'StrictMode initial mount makes zero requests');await input(get<HTMLTextAreaElement>('.studio-compose textarea'),'NONSECRET retained onboarding composer');opener=get('.studio-send-row button[data-primary-action=true]');assert(opener.textContent==='Set up connection','Regression uses conditional onboarding opener, not permanent header');return result();}
async function prepare(){assert(panel().open&&panel().matches(':modal'),'Conditional opener opens actual native settings');assert(calls.length===0,'Opening makes zero requests');await input(get<HTMLInputElement>('[aria-label="Operator token"]'),'NONSECRET_OPERATOR_FOCUS_FIXTURE');await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'fixture-project');return result();}
async function choose(){for(let n=0;n<120&&get<HTMLOptionElement>('[aria-label="Model connection"] option[value=local]').disabled;n++)await pause();assert(!get<HTMLOptionElement>('[aria-label="Model connection"] option[value=local]').disabled,'Explicit Check loads configured JSON-planner model');const select=get<HTMLSelectElement>('[aria-label="Model connection"]');assert(select.value==='','Check does not choose a model');await input(select,'local');assert(calls.length===3&&calls.every(c=>c.method==='GET'),'Exactly three explicit synthetic metadata GETs; no model sends');refs={editor:get('.wf-editor'),ide:get('.fd-wb'),store:controller.workbench.getState(),state:controller.getState()};return result();}
function verify(){assert(!panel().open,'Dismissal really closes modal');assert(!opener.isConnected,'Successful onboarding actually removes conditional opener');const fallback=get<HTMLButtonElement>('.studio-settings-button'),s=getComputedStyle(fallback);assert(fallback.isConnected&&!fallback.disabled&&!fallback.closest('[hidden],[inert]')&&fallback.getClientRects().length>0&&s.visibility==='visible','Fallback is meaningful permanent enabled visible settings control');assert(document.activeElement===fallback,'F1: successful conditional onboarding returns focus to owner-scoped permanent settings control');assert(get('.wf-editor')===refs.editor&&get('.fd-wb')===refs.ide&&controller.workbench.getState()===refs.store&&controller.getState()===refs.state,'Dismissal retains route, editor DOM and controller state');assert(get<HTMLTextAreaElement>('.studio-compose textarea').value==='NONSECRET retained onboarding composer','Dismissal retains composer and does not create a draft');assert(calls.length===3,'Dismissal makes no network/model/mutation calls');return result();}
async function unmountCheck(){const fallback=get<HTMLButtonElement>('.studio-settings-button');let focused=0;const original=fallback.focus;fallback.focus=function(options){focused++;original.call(this,options);};root.unmount();assert(focused===0,'Unmounted dialog does not focus the fallback');return result();}
function result(){return {testOnly:true,checks:[...checks],calls:[...calls],area:host.querySelector('.studio-shell')?.getAttribute('data-area')??null};}
Object.assign(window,{onboardingFixture:{initial,prepare,choose,verify,unmountCheck,result,panel}});
