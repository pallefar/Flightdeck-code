// DEVELOPMENT ONLY: actual StudioApp/core; controlled local replies, no backend/auth/model verification.
import {StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioApp} from '../StudioApp';
import {StudioController} from '../controller';
import {createPublicReuseCatalog,bundledCatalogSource} from '../../reuse-catalog/catalog';
import type {CatalogPort} from '../../reuse-catalog/controller';
import {configSchemas} from '../../../packages/workflow/graph';

const counts={list:0,detail:0,schemaReads:0,invalidations:0,configuration:0,create:0,refused:0,sourceRotations:0};
let holdNext:'list'|'detail'|'create'|null=null;
const held:Array<{kind:'list'|'detail'|'create';release:()=>void}>=[];
let selectedHttpSchema=configSchemas.http;
const api=createPublicReuseCatalog({...bundledCatalogSource,schema:id=>{counts.schemaReads++;return id==='http'?selectedHttpSchema:configSchemas[id];}});
async function hold(kind:'list'|'detail'|'create'){
  if(holdNext!==kind)return;holdNext=null;
  await new Promise<void>(resolve=>held.push({kind,release:resolve}));
}
// Port wrappers return the original frozen, branded actual-factory DTOs.
// They intentionally ignore abort while held, to exercise late-settlement refusal.
const catalog:CatalogPort={
  list:async input=>{counts.list++;await hold('list');return api.list(input);},
  detail:async input=>{counts.detail++;await hold('detail');return api.detail(input);},
};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const fetcher:typeof fetch=async(input)=>{
  // Fixed local classifications only: no header, token, prompt, body or exception logging.
  const path=typeof input==='string'?input:'';
  if(path==='/api/studio/health'){counts.configuration++;return json({ok:true,selectedId:'local',model:'development-only',modelStatus:'configured',verification:'not-probed'});}
  if(path==='/api/studio/model-connections'){counts.configuration++;return json({selectedId:'local',connections:['codex-chatgpt','flightdeck','local','anthropic'].map(id=>({id,label:`DEVELOPMENT ${id}`,model:id==='local'?'development-only':null,status:id==='local'?'configured':'unavailable',verification:'not-probed'}))});}
  if(path==='/api/studio/projects/development-reuse/skills'){counts.configuration++;return json({projectId:'development-reuse',skillSourceState:'empty',skillSources:[]});}
  if(path==='/api/studio/create'){counts.create++;await hold('create');return json({status:'needs_input',understanding:'DEVELOPMENT controlled reply; no model called.',questions:[{id:'purpose',question:'What outcome should the development draft support?',because:'Declared local acceptance fixture.'}]});}
  counts.refused++;return json({error:'development-fixture-route-refused'},503);
};
const controller=new StudioController(fetcher);
const invalidate=controller.invalidateSkillSendReview.bind(controller);
controller.invalidateSkillSendReview=()=>{counts.invalidations++;invalidate();};
let remembered:{state:ReturnType<typeof controller.getState>;workbench:ReturnType<typeof controller.workbench.getState>;editor:Element|null;workspace:Element|null}|null=null;
function remember(){remembered={state:controller.getState(),workbench:controller.workbench.getState(),editor:document.querySelector('.wf-editor'),workspace:document.querySelector('.wf-workspace')};return snapshot();}
function snapshot(){const state=controller.getState();return {developmentOnly:true,backendVerified:false,modelInvoked:false,counts:{...counts},held:held.map(item=>item.kind),armed:holdNext,phase:state.phase,transcriptTurns:state.transcript.length,sourceRounds:controller.workbench.getState().rounds.length,retained:remembered?{transcript:state.transcript===remembered.state.transcript,result:state.result===remembered.state.result,workbench:controller.workbench.getState()===remembered.workbench,editor:document.querySelector('.wf-editor')===remembered.editor,workspace:document.querySelector('.wf-workspace')===remembered.workspace}:null};}
function releaseAll(){const batch=held.splice(0);for(const item of batch)item.release();}
function rotateSource(){selectedHttpSchema=selectedHttpSchema.extend({});counts.sourceRotations++;}
function Fixture(){
  const [mounted,setMounted]=useState(true),[tick,setTick]=useState(0);
  return <><aside aria-label="Development acceptance controls" style={{padding:12,font:'12px Arial',overflowWrap:'anywhere'}}><strong>DEVELOPMENT ONLY — controlled local replies. No backend, authentication verification, model, microphone or remote processing.</strong><p>Browse works without setup. Optional connection-path check: use project <code>development-reuse</code> and only a nonsecret DEVELOPMENT operator sentinel. Never enter a real token or key here.</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{(['list','detail','create'] as const).map(kind=><button type="button" key={kind} onClick={()=>{holdNext=kind;setTick(value=>value+1);}}>Hold next {kind}</button>)}<button type="button" onClick={()=>{releaseAll();setTick(value=>value+1);}}>Release held DEVELOPMENT work</button><button type="button" onClick={()=>{rotateSource();setTick(value=>value+1);}}>Rotate DEVELOPMENT HTTP schema identity</button><button type="button" onClick={()=>setMounted(value=>!value)}>{mounted?'Unmount actual StudioApp':'Remount actual StudioApp'}</button><button type="button" onClick={()=>{remember();setTick(value=>value+1);}}>Remember read-only retention baseline</button></div><output aria-live="polite" data-refresh={tick}>{JSON.stringify(snapshot())}</output></aside>{mounted&&<StudioApp controller={controller} fetcher={fetcher} reuseCatalog={catalog}/>}</>;
}
const element=document.getElementById('reuse-fixture');
if(!element)throw Error('Development fixture root unavailable');
createRoot(element).render(<StrictMode><Fixture/></StrictMode>);
// Read-only evidence plus controlled release/source seam. No composer/controller handles.
Object.assign(window,{reuseCatalogFixture:Object.freeze({snapshot,remember,holdNext:(kind:'list'|'detail'|'create')=>{holdNext=kind;},releaseAll,rotateSource})});
