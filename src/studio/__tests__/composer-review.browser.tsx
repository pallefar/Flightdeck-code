// DEVELOPMENT ONLY: actual StudioApp, deterministic DTOs. No backend/vendor/microphone.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioApp} from '../StudioApp';
import {StudioController} from '../controller';
import type {RecognitionEvent,RecognitionPort} from '../../voice/ports';
let recognition:FixtureRecognition|null=null;
class FixtureRecognition implements RecognitionPort {
 static async available(){return 'available' as const;}
 lang='en-GB';continuous=false;interimResults=false;maxAlternatives=1;processLocally=true;
 onstart:(()=>void)|null=null;onend:(()=>void)|null=null;
 onerror:((event:{error?:string})=>void)|null=null;onresult:((event:RecognitionEvent)=>void)|null=null;
 start(){recognition=this;this.onstart?.();}
 abort(){this.onend?.();}
}
Object.defineProperty(FixtureRecognition.prototype,'processLocally',{value:true,writable:true});
Object.defineProperty(window,'SpeechRecognition',{value:FixtureRecognition,configurable:true});
const hash='b'.repeat(64);
const review={status:'model-request-refused',decision:{decision:'approval-required',reason:'FIXTURE: review required',contentHash:'a'.repeat(64)},review:{hash,preview:'FIXTURE: masked project context',unchecked:['partial scan']}};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const calls:Array<{url:string;body:unknown}>=[];
let delayed=false,release:(()=>void)|null=null;
const fetcher:typeof fetch=async(url,init)=>{
 const path=String(url);calls.push({url:path,body:init?.body?JSON.parse(String(init.body)):null});
 if(path.endsWith('/health'))return json({ok:true,selectedId:'local',model:'fixture-local',modelStatus:'configured',verification:'not-probed'});
 if(path.endsWith('/model-connections'))return json({selectedId:'local',connections:['codex-chatgpt','flightdeck','local','anthropic'].map(id=>({id,label:`FIXTURE ${id}`,model:id==='local'?'fixture-local':null,status:id==='local'?'configured':'unavailable',verification:'not-probed'}))});
 if(path.endsWith('/skills'))return json({projectId:'development-p3',skillSourceState:'loaded',skillSources:[]});
 if(path.endsWith('/create')){if(delayed){delayed=false;return new Promise(resolve=>{release=()=>{release=null;resolve(json(review));};});}return json(review);}
 throw new Error('Unexpected fixture route');
};
const host=document.getElementById('fixture')!,root=createRoot(host),controller=new StudioController(fetcher);
let invalidations=0;
const invalidate=controller.invalidateSkillSendReview.bind(controller);
controller.invalidateSkillSendReview=()=>{invalidations++;invalidate();};
root.render(<StrictMode><StudioApp controller={controller} fetcher={fetcher}/></StrictMode>);
const pause=()=>new Promise(resolve=>setTimeout(resolve,35));
const get=<T extends Element=HTMLElement>(selector:string)=>{const node=host.querySelector<T>(selector);if(!node)throw new Error(`Missing ${selector}`);return node;};
function button(text:string){const node=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===text);if(!node)throw new Error(`Missing ${text}`);return node;}
async function seed(node:HTMLInputElement|HTMLTextAreaElement,value:string){const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));await pause();}
async function prepare(){
 await pause();button('Connection settings').click();await pause();
 // Nonsecret fixture-only operator sentinel. No authentication request goes to a server.
 await seed(get<HTMLInputElement>('[aria-label="Operator token"]'),'NONSECRET_P3_FIXTURE');
 await seed(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'development-p3');
 button('Check connection & project skills').click();await pause();await pause();
 get<HTMLDetailsElement>('.studio-connection-help').open=false;await pause();return snapshot();
}
let baseline:ReturnType<typeof controller.getState>|null=null,workbench:ReturnType<typeof controller.workbench.getState>|null=null,editor:Element|null=null,workspace:Element|null=null;
function remember(){baseline=controller.getState();workbench=controller.workbench.getState();editor=get('.wf-editor');workspace=get('.wf-workspace');return snapshot();}
function snapshot(){return {developmentFixture:true,backendVerified:false,vendorCalls:0,invalidations,composer:get<HTMLTextAreaElement>('.studio-compose textarea').value,phase:controller.getState().phase,reviewPresent:!!host.querySelector('[aria-label="Skill send review"]'),reviewButton:[...host.querySelectorAll<HTMLButtonElement>('button')].filter(node=>node.textContent==='Send reviewed context to model').map(node=>({disabled:node.disabled})),reviewCurrent:controller.skillSendReviewCurrent,calls:[...calls],payloads:calls.filter(call=>call.url.endsWith('/create')).map(call=>call.body),transcript:controller.getState().transcript,retained:baseline?{transcript:controller.getState().transcript===baseline.transcript,result:controller.getState().result===baseline.result,workbench:controller.workbench.getState()===workbench,editor:get('.wf-editor')===editor,workspace:get('.wf-workspace')===workspace}:null};}
function assertRevoked(){const state=snapshot();if(state.reviewButton.length)throw new Error('P3: stale review action remains after native composer edit');if(!Object.values(state.retained??{}).every(Boolean))throw new Error('Composer edit discarded retained session/editor context');return state;}
function emitDictation(){if(!recognition)throw new Error('Use the explicit fixture Dictate gesture first');recognition.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:'FIXTURE dictated addition'}}]});recognition.onend?.();}
Object.assign(window,{composerReviewFixture:{prepare,snapshot,remember,assertRevoked,emitDictation,holdNext:()=>{delayed=true;},release:()=>release?.(),controller,button,get,pause}});
