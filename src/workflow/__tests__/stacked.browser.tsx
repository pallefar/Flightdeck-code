// Browser-only local DEVELOPMENT fixture. No network adapters, API or providers.
// Deferred tests inject only an owned DEVELOPMENT promise; no connector is contacted.
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createRef} from 'react';
import {WorkflowEditor,createWorkflowTemplate,type WorkflowEditorHandle} from '../WorkflowEditor';
import {createEmptyGraph,graphSchema,type Graph} from '../../../packages/workflow/graph';
import type {ExecutionAdapters} from '../../../packages/workflow/engine';
const wait=(ms=65)=>new Promise(resolve=>setTimeout(resolve,ms));
export function button(root:Element,name:string){const b=[...root.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')===name||b.textContent?.trim()===name);if(!b)throw new Error(`Missing button: ${name}`);return b;}
function check(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
function type(field:HTMLInputElement|HTMLTextAreaElement,value:string){Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));}
export function example(kind='branch'):Graph{
 if(kind==='empty')return createEmptyGraph();
 if(kind!=='join')return createWorkflowTemplate(kind==='approval'?'approval':'branch');
 const g=createWorkflowTemplate('branch');g.name='Review a request and reunite alternatives';
 g.nodes[2]!.type='set';g.nodes[2]!.label='Prepare accepted request';g.nodes[2]!.config={fields:{route:'accepted'}};
 g.nodes[3]!.type='set';g.nodes[3]!.label='Prepare other request';g.nodes[3]!.config={fields:{route:'other'}};
 g.nodes.push({id:'finish',type:'output',label:'Return chosen route',config:{},position:{x:1000,y:150}});
 g.edges.push({id:'joinTrue',source:'node2',target:'finish'},{id:'joinFalse',source:'node3',target:'finish'});
 return graphSchema.parse(g);
}
const container=document.querySelector<HTMLElement>('#preview')!,root=createRoot(container),handle=createRef<WorkflowEditorHandle>();
let graph:Graph=example(),changes=0;
export function mount(kind='branch'){return mountGraph(example(kind));}
export function mountGraph(initialGraph:Graph,executionAdapters?:ExecutionAdapters){
 changes=0;
 flushSync(()=>root.render(<WorkflowEditor key={`fixture:${++version}`} ref={handle} initialGraph={initialGraph} {...(executionAdapters?{executionAdapters}:{})} onChange={g=>{graph=g;changes++;}}/>));
 return initialGraph;
}
let version=0;mount();
const themeTokens={light:{bg:'#f3f6f7',surface:'#fff',surface2:'#f8fafb',ink:'#253d4b',muted:'#586e7c',line:'#d5dfe5',te:'#e98300',green:'#367956',amber:'#806620',red:'#aa3122'},dark:{bg:'#0e1720',surface:'#17242f',surface2:'#182833',ink:'#eef2f7',muted:'#a7b6c3',line:'#304553',te:'#e98300',green:'#87c3a7',amber:'#c9b687',red:'#ff807d'}};
function theme(mode:'light'|'dark'){for(const [key,value] of Object.entries(themeTokens[mode]))container.style.setProperty(`--${key}`,value);document.body.style.background=themeTokens[mode].bg;document.body.style.color=themeTokens[mode].ink;container.style.colorScheme=mode;}
document.querySelector('#example')!.addEventListener('change',event=>{mount((event.target as HTMLSelectElement).value);setTimeout(()=>button(container,'Stacked view').click(),0);});
document.querySelector('#theme')!.addEventListener('change',event=>theme((event.target as HTMLSelectElement).value as 'light'|'dark'));
export async function topology(){mount('join');await wait();const before=JSON.stringify(graph),count=changes;button(container,'Stacked view').click();await wait();
 const cards=[...container.querySelectorAll<HTMLElement>('.wf-node.is-stacked')];check(cards.length===5,'Stacked view did not render every real block');
 const start=cards.find(c=>c.textContent?.includes('Manual trigger'))!,route=cards.find(c=>c.textContent?.includes('Route request'))!,yes=cards.find(c=>c.textContent?.includes('Prepare accepted'))!,no=cards.find(c=>c.textContent?.includes('Prepare other'))!,end=cards.find(c=>c.textContent?.includes('Return chosen'))!;
 check(route.offsetTop>start.offsetTop&&yes.offsetTop>route.offsetTop&&no.offsetTop===yes.offsetTop&&end.offsetTop>yes.offsetTop,'Stacked topological order incorrect');check(yes.offsetLeft<no.offsetLeft,'True and false lanes reversed');
 const labels=[...container.querySelectorAll('.wf-edges text')].map(e=>e.textContent);check(labels.includes('True')&&labels.includes('False'),'Condition alternatives not labelled');
 check(container.querySelectorAll('.wf-edges g').length===graph.edges.length,'View omitted or invented an edge');check(JSON.stringify(graph)===before&&changes===count&&button(container,'Undo').disabled,'View toggle edited graph/history');
 button(container,'Canvas view').click();await wait();check(JSON.stringify(graph)===before,'Returning to canvas edited saved positions');return {cards:cards.length,connections:graph.edges.length,topological:true,branchLanes:true,exactGraphRetained:true};
}
export async function retainedSettings(){mount('join');await wait();button(container,'Select and drag Prepare accepted request').click();await wait();
 const field=container.querySelector<HTMLInputElement>('[aria-label="Field 1 value"]');check(field,'Actual staged set-field parameter missing');type(field,'"unsaved local draft"');await wait();const before=JSON.stringify(graph);
 button(container,'Stacked view').click();await wait();check(field.isConnected&&field.value==='"unsaved local draft"'&&JSON.stringify(graph)===before,'Switch discarded or silently saved a staged setting');
 button(container,'Canvas view').click();await wait();check(field===container.querySelector('[aria-label="Field 1 value"]'),'Switch remounted the shared settings form');return {sameForm:true,pendingDraftRetained:true,noImplicitSave:true};
}
export async function execution(){mount('join');await wait();button(container,'Stacked view').click();await wait();const output=[];
 for(const approved of [true,false]){type(container.querySelector<HTMLTextAreaElement>('[aria-label="Local input JSON"]')!,JSON.stringify({approved}));await wait();button(container,'Run locally').click();await wait();check(container.querySelector('.wf-run strong')?.textContent==='COMPLETED','Real local runner did not complete');const data=JSON.parse(container.querySelector('.wf-run pre')!.textContent!);check(data.route===(approved?'accepted':'other'),'Wrong actual conditional output');output.push(data);}
 return {actualLocalOutputs:output,providerCalls:0};
}
export async function viewRetention(){mount();await wait();button(container,'Zoom in').click();await wait();const canvas=container.querySelector<HTMLElement>('.wf-stage')!.style.transform,card=container.querySelector('.wf-node'),before=JSON.stringify(graph);button(container,'Stacked view').click();await wait();button(container,'Zoom out').click();await wait();const stacked=container.querySelector<HTMLElement>('.wf-stage')!.style.transform;button(container,'Canvas view').click();await wait();check(container.querySelector<HTMLElement>('.wf-stage')!.style.transform===canvas,'Canvas zoom not retained');button(container,'Stacked view').click();await wait();check(container.querySelector<HTMLElement>('.wf-stage')!.style.transform===stacked,'Stacked zoom not retained');check(container.querySelector('.wf-node')===card&&JSON.stringify(graph)===before,'View remounted cards / edited graph');return {canvasZoomRetained:true,stackedZoomRetained:true,cardDomRetained:true,graphUnchanged:true};}
export async function approval(){mount('approval');await wait();button(container,'Stacked view').click();await wait();button(container,'Run locally').click();await wait();check(container.querySelector('.wf-run strong')?.textContent==='BLOCKED','Unconfigured human review did not fail closed');button(container,'Select Review request').click();await wait();type(container.querySelector<HTMLInputElement>('[aria-label="Reviewer"]')!,'DEVELOPMENT review queue (not authenticated)');await wait();button(container,'Apply settings').click();await wait();button(container,'Run locally').click();await wait();check(container.querySelector('.wf-run strong')?.textContent==='PAUSED','Configured human approval did not pause');check(![...container.querySelectorAll('button')].some(b=>/^(approve|resume)$/i.test(b.textContent??'')),'View invented approval authority');return {unconfigured:'blocked',configured:'paused',approvalAuthority:false};}
export async function entryFocus(){
 const nodes=Array.from({length:100},(_,i)=>({id:`n${i}`,type:i===0?'manual':i===99?'output':'set',label:`Step ${i}`,config:{},position:{x:0,y:0}}));
 const initialGraph=graphSchema.parse({...createEmptyGraph('Large local topology'),nodes,edges:[...nodes.slice(1).map((n,i)=>({id:`chain${i}`,source:`n${i}`,target:n.id})),...nodes.slice(2).map((n,i)=>({id:`skip${i}`,source:'n0',target:n.id}))]});
 mountGraph(initialGraph);await wait();const before=JSON.stringify(graph);button(container,'Stacked view').click();await wait();await wait();
 const viewport=container.querySelector<HTMLElement>('.wf-scroll')!,first=container.querySelector<HTMLElement>('.wf-node')!,v=viewport.getBoundingClientRect(),r=first.getBoundingClientRect();
 check(r.left>=v.left&&r.right<=v.right,'Opening stacked view centered empty routing gutters instead of its trigger');
 check(JSON.stringify(graph)===before,'Entry focus mutated the graph');return {triggerFullyVisible:true,scrollLeft:viewport.scrollLeft,routingWidth:viewport.scrollWidth,graphUnchanged:true};
}
export async function registryPlacement(view:'canvas'|'stacked'='stacked'){
 mount();await wait();if(view==='stacked'){button(container,'Stacked view').click();await wait();}
 const priorMargin=container.style.marginTop,priorY=window.scrollY,before=JSON.stringify(graph);
 try{
  container.style.marginTop='400px';window.scrollTo(0,350);await wait();
  const disclosure=container.querySelector<HTMLDetailsElement>('.wf-manifest')!,opener=disclosure.querySelector<HTMLElement>('summary')!;
  opener.click();await wait();check(disclosure.open,'Native Registry disclosure did not open');
  const editor=container.querySelector<HTMLElement>('.wf-editor')!,bar=container.querySelector<HTMLElement>('.wf-canvasbar')!,panel=disclosure.querySelector<HTMLElement>('.wf-manifest-body')!;
  const e=editor.getBoundingClientRect(),b=bar.getBoundingClientRect(),p=panel.getBoundingClientRect();
  check(p.left>=e.left&&p.right<=e.right&&p.top>=b.bottom-1&&p.bottom<=e.bottom,'Registry escaped its editor / opener in scrolled mobile layout');
  const oldY=scrollY;window.scrollBy(0,24);await wait();const delta=scrollY-oldY;
  check(delta>0&&Math.abs(panel.getBoundingClientRect().top-p.top+delta)<1,'Registry detached from opener during page scroll');
  panel.scrollTop=panel.scrollHeight;check(panel.scrollTop>0,'Bounded Registry content is not internally scrollable');
  check(JSON.stringify(graph)===before&&button(container,'Undo').disabled,'Registry presentation edited graph/history');
  return {view,position:getComputedStyle(panel).position,pageScrollDelta:delta,panelScrollTop:panel.scrollTop,contained:true,movesWithEditor:true,historyUnchanged:true};
 }finally{container.querySelector<HTMLDetailsElement>('.wf-manifest')!.open=false;container.style.marginTop=priorMargin;window.scrollTo(0,priorY);}
}
// Reachable, delayed local-run freshness witness; the adapter below has no transport.
export async function pendingRunFreshness(mode:'rename'|'undo'|'view'='undo'){
 const initialGraph=graphSchema.parse({...createEmptyGraph('DEVELOPMENT deferred result freshness'),nodes:[
  {id:'start',type:'manual',label:'Manual trigger',config:{},position:{x:80,y:100}},
  {id:'held',type:'http',label:'DEVELOPMENT owned promise',config:{url:'https://example.invalid/development-only',method:'GET',service:'generic',credentialRef:'DEVELOPMENT-ONLY'},position:{x:360,y:100}},
  {id:'finish',type:'output',label:'Return DEVELOPMENT fixture',config:{},position:{x:640,y:100}}
 ],edges:[{id:'first',source:'start',target:'held'},{id:'last',source:'held',target:'finish'}]});
 let release!:()=>void,calls=0;
 const held=new Promise<void>(resolve=>{release=resolve;});
 mountGraph(initialGraph,{http:async()=>{calls++;await held;return {developmentOnly:true};}});await wait();
 const applied=graph,before=JSON.stringify(graph),count=changes;
 try{
  const runButton=button(container,'Run locally');runButton.click();await wait();
  check(calls===1&&runButton.disabled,'Actual local adapter did not remain pending');
  if(mode==='view'){
   button(container,'Stacked view').click();await wait();
   button(container,'Zoom out').click();await wait();
   check(JSON.stringify(graph)===before&&changes===count,'View-only change edited the graph');
  }else{
   type(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')!,'Edited during DEVELOPMENT execution');await wait();
   check(graph!==applied&&changes>count,'Rename did not reach the real editor store');
   if(mode==='undo'){button(container,'Undo').click();await wait();check(graph===applied,'Undo did not restore the original graph object');}
  }
  release();
  for(let i=0;i<20&&runButton.disabled;i++)await wait(25);
  check(!runButton.disabled,'Owned local adapter did not settle');
  const result=container.querySelector('.wf-run strong')?.textContent??null;
  if(mode==='view')check(result==='COMPLETED','View-only changes discarded the matching pending local result');
  else check(result===null,'An edited graph accepted a stale pending local result');
  return {mode,adapterCalls:calls,originalGraphRestored:graph===applied,result,providerCalls:0,networkAdapter:false};
 }finally{release();}
}
export async function localRunStatuses(){
 const observations=[];
 for(const view of ['canvas','stacked'] as const){
  mount('join');await wait();if(view==='stacked'){button(container,'Stacked view').click();await wait();}
  const before=JSON.stringify(graph),count=changes;
  check(!container.querySelector('[data-local-run-status]'),'Unexecuted nodes acquired a result badge');
  for(const approved of [true,false]){
   type(container.querySelector<HTMLTextAreaElement>('[aria-label="Local input JSON"]')!,JSON.stringify({approved}));await wait();
   button(container,'Run locally').click();await wait();
   check(container.querySelector('.wf-run strong')?.textContent==='COMPLETED','Actual branch run did not complete');
   const expected:Record<string,string>={node0:'completed',node1:'completed',node2:approved?'completed':'skipped',node3:approved?'skipped':'completed',finish:'completed'};
   const cards=[...container.querySelectorAll<HTMLElement>('.wf-node')],statuses:Record<string,string>={};
   check(cards.length===graph.nodes.length,'Card inventory differs from actual graph');
   graph.nodes.forEach((node,index)=>{
    const card=cards[index]!,badge=card.querySelector<HTMLElement>('[data-local-run-status]'),head=card.querySelector('.wf-node-head')!;
    check(badge&&badge.dataset.localRunStatus===expected[node.id],`Missing truthful ${expected[node.id]} badge for ${node.id}`);
    check(badge.id&&head.getAttribute('aria-describedby')?.split(/\s+/).includes(badge.id),'Header does not expose its local-result description');
    check(/local result/i.test(badge.title)&&!badge.querySelector('button,a,input,[tabindex]')&&!badge.hasAttribute('tabindex')&&!badge.hasAttribute('aria-live'),'Badge is not a bounded noninteractive local-result description');
    check([...container.querySelectorAll('.wf-run li')].some(entry=>entry.textContent===`${node.id} · ${expected[node.id]}`),'Badge disagrees with actual local trace');
    statuses[node.id]=badge.dataset.localRunStatus!;
   });
   const branch=cards[1]!.querySelector<HTMLElement>('[data-local-run-status]')!;
   check(/branch/i.test(branch.title)&&branch.title.includes(String(approved)),'Observed branch description did not match actual runner metadata');
   check(JSON.stringify(graph)===before&&changes===count&&button(container,'Undo').disabled,'Badges edited the graph or history');
   observations.push({view,approved,statuses});
  }
 }
 return {actualRuns:observations,providerCalls:0,graphAndHistoryUnchanged:true};
}
function statusSummary(){
 const cards=[...container.querySelectorAll('.wf-node')];
 return Object.fromEntries(graph.nodes.map((node,index)=>[node.id,cards[index]?.querySelector<HTMLElement>('[data-local-run-status]')?.dataset.localRunStatus??null]));
}
export async function localRunStatusGates(){
 const observations=[];
 for(const view of ['canvas','stacked'] as const){
  mount('approval');await wait();if(view==='stacked'){button(container,'Stacked view').click();await wait();}
  const gate=graph.nodes.find(node=>node.type==='approval')!,start=graph.nodes.find(node=>node.type==='manual')!,end=graph.nodes.find(node=>node.type==='output')!;
  button(container,'Run locally').click();await wait();let statuses=statusSummary();
  check(container.querySelector('.wf-run strong')?.textContent==='BLOCKED'&&statuses[start.id]==='completed'&&statuses[gate.id]==='blocked'&&statuses[end.id]==='not-reached','Unconfigured approval badges misrepresent actual gate/downstream execution');
  observations.push({view,phase:'unconfigured-approval',statuses});
  button(container,`${view==='stacked'?'Select':'Select and drag'} ${gate.label}`).click();await wait();
  type(container.querySelector<HTMLInputElement>('[aria-label="Reviewer"]')!,'DEVELOPMENT review queue (not authenticated)');await wait();button(container,'Apply settings').click();await wait();
  check(!container.querySelector('[data-local-run-status]'),'Applied reviewer settings retained a previous result');
  button(container,'Run locally').click();await wait();statuses=statusSummary();
  check(container.querySelector('.wf-run strong')?.textContent==='PAUSED'&&statuses[start.id]==='completed'&&statuses[gate.id]==='paused'&&statuses[end.id]==='not-reached','Paused gate leaked its overall state to unexecuted downstream nodes');
  check(![...container.querySelectorAll('button')].some(b=>/^(approve|resume)$/i.test(b.textContent??'')),'Badge introduced human approval authority');
  observations.push({view,phase:'configured-approval',statuses});
  const disconnected=example('join');disconnected.nodes.push({id:'isolated',type:'set',label:'Unconnected DEVELOPMENT block',config:{fields:{}},position:{x:80,y:700}});
  mountGraph(disconnected);await wait();if(view==='stacked'){button(container,'Stacked view').click();await wait();}
  check(!container.querySelector('[data-local-run-status]'),'Document replacement retained old badges');
  button(container,'Run locally').click();await wait();statuses=statusSummary();
  check(container.querySelector('.wf-run strong')?.textContent==='BLOCKED'&&!container.querySelector('.wf-run li')&&Object.values(statuses).every(status=>status==='not-reached'),'Trace-less admission refusal invented per-node Blocked records');
  observations.push({view,phase:'trace-less-admission',statuses});
 }
 return {actualRuns:observations,providerCalls:0,approvalAuthority:false};
}
export async function localRunStatusRetention(){
 mount('join');await wait();button(container,'Select and drag Prepare accepted request').click();await wait();
 const parameter=container.querySelector<HTMLInputElement>('[aria-label="Field 1 value"]')!;
 type(parameter,JSON.stringify('DEVELOPMENT unapplied parameter'));button(container,'Inputs').click();await wait();button(container,'Add mapping').click();await wait();
 const mapping=container.querySelector<HTMLInputElement>('[aria-label="Mapping 1 target"]')!;type(mapping,'draftPayload');await wait();
 const before=JSON.stringify(graph),count=changes,cards=[...container.querySelectorAll('.wf-node')];
 type(container.querySelector<HTMLTextAreaElement>('[aria-label="Local input JSON"]')!,JSON.stringify({approved:true}));await wait();button(container,'Run locally').click();await wait();
 check(container.querySelectorAll('[data-local-run-status]').length===graph.nodes.length,'Actual run did not produce per-card status');
 check(JSON.parse(container.querySelector('.wf-run pre')!.textContent!).route==='accepted','Run silently applied pending parameter or mapping drafts');
 button(container,'Stacked view').click();await wait();const display=container.querySelector<HTMLSelectElement>('[aria-label="Block display"]')!;display.value='compact';display.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 button(container,'Zoom out').click();await wait();button(container,'Fit stacked workflow width').click();await wait();
 button(container,'Select Prepare other request').click();await wait();button(container,'Select Prepare accepted request').click();await wait();
 button(container,'Open block settings').click();await wait();check(container.querySelector<HTMLDialogElement>('dialog[open]')?.open,'Retained settings did not open in native modal');
 check(parameter.isConnected&&parameter.value===JSON.stringify('DEVELOPMENT unapplied parameter')&&mapping.isConnected&&mapping.value==='draftPayload','Badge/view/modal updates remounted or erased a genuine unapplied draft');
 button(container,'Close block settings').click();await wait();button(container,'Canvas view').click();await wait();
 check(cards.every((card,index)=>card===container.querySelectorAll('.wf-node')[index]),'Badges or view changes remounted shared node cards');
 check(JSON.stringify(graph)===before&&changes===count&&button(container,'Undo').disabled,'Result/presentation operations changed the applied graph or history');
 check(container.querySelectorAll('[data-local-run-status]').length===graph.nodes.length,'Result was lost across presentation-only updates');
 type(container.querySelector<HTMLTextAreaElement>('[aria-label="Local input JSON"]')!,JSON.stringify({approved:false}));await wait();
 check(container.querySelectorAll('[data-local-run-status]').length===graph.nodes.length,'Changing an unexecuted seed erased last-local-result history');
 button(container,'Parameters').click();await wait();button(container,'Apply settings').click();await wait();
 check(JSON.stringify(graph)!==before&&!container.querySelector('[data-local-run-status]'),'Applied parameter edit failed to invalidate displayed results');
 check(graph.nodes.find(node=>node.id==='node2')!.inputMappings===undefined&&mapping.isConnected&&mapping.value==='draftPayload','Applying Parameters silently applied or erased the independent Inputs draft');
 button(container,'Undo').click();await wait();check(JSON.stringify(graph)===before&&!container.querySelector('[data-local-run-status]'),'Undo revived a completed result from an older editor snapshot');
 button(container,'Redo').click();await wait();check(!container.querySelector('[data-local-run-status]')&&mapping.isConnected&&mapping.value==='draftPayload','Redo revived a result or erased independent pending Inputs');
 return {pendingParametersRetained:true,pendingInputsRetained:true,noImplicitApply:true,cardIdentityRetained:true,presentationHistoryUnchanged:true,parameterApplySeparate:true,undoRedoCannotReviveResult:true,providerCalls:0};
}
Object.assign(window,{stackedTests:{mount,mountGraph,button,wait,type,theme,topology,retainedSettings,execution,viewRetention,approval,entryFocus,registryPlacement,pendingRunFreshness,localRunStatuses,localRunStatusGates,localRunStatusRetention,get graph(){return graph;},get changes(){return changes;},handle,container}});
setTimeout(()=>button(container,'Stacked view').click(),0);
