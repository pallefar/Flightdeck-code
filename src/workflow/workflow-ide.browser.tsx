// Explicit DEVELOPMENT injection only: no vendor, credentials, network or execution.
import {createRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {WorkflowEditor,createWorkflowTemplate,type WorkflowEditorHandle,type BlockRequest} from './WorkflowEditor';
import type {Graph} from '../../packages/workflow/graph';

const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
function check(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
export function mountWorkflowIdeFixture({reveal=false,request,hidden=false,initialGraph}:{reveal?:boolean;hidden?:boolean;initialGraph?:Graph;request?:(value:BlockRequest)=>Promise<unknown>}={}) {
 const container=document.createElement('div');document.body.append(container);container.style.setProperty('--workflow-canvas-height','340px');
 container.hidden=hidden;
 const root=createRoot(container),handle=createRef<WorkflowEditorHandle>();let graph:Graph=initialGraph??createWorkflowTemplate('branch');
 const render=(key=0)=>flushSync(()=>root.render(<WorkflowEditor key={key} ref={handle} initialGraph={graph} buildReveal={reveal} onChange={next=>{graph=next;}} {...(request?{onRequestBlock:request}:{})}/>));
 render();
 return {container,handle,get graph(){return graph;},render,dispose(){flushSync(()=>root.unmount());container.remove();}};
}
function button(container:Element,text:string){const result=Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(element=>element.textContent?.trim()===text);check(result,`Missing ${text}`);return result;}
function input(container:Element,label:string){const element=container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);check(element,`Missing ${label}`);return element;}
function type(element:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));}

export async function proposalControlsBrowserTest(){
 const calls:BlockRequest[]=[];
 const wrapper={id:'proposedSet',label:'Proposed normalizer',baseType:'set',defaults:{fields:{ready:true}},description:'DEVELOPMENT declarative normalization fixture'};
 let next:unknown=wrapper;
 const fixture=mountWorkflowIdeFixture({request:async value=>{calls.push(value);return next;}});await pause();const {container}=fixture;
 try {
  container.querySelector<HTMLButtonElement>('[aria-controls="workflow-palette"]')!.click();await pause();
  button(container,'Ask AI for a block').click();await pause();check(calls.length===0,'Opening block review called a model');
  check(document.activeElement===input(container,'Block purpose'),'AI block opener did not focus actual prompt');
  check(container.textContent?.includes('Block JSON contract'),'Missing reviewable block JSON contract');
  const add=button(container,'Add reviewed reusable block');check(add.disabled,'Human-review checkbox bypassed');
  type(input(container,'Block purpose'),'Normalize incoming data with existing set capabilities');await pause();
  button(container,'Request block proposal').click();await pause();
  check(Number(calls.length)===1&&calls[0]!.graph.nodes.length===4,'Explicit proposal did not receive current actual graph');
  check(container.querySelector<HTMLTextAreaElement>('[aria-label="Custom block JSON"]')!.value.includes('proposedSet'),'Actual proposed JSON absent');check(add.disabled,'AI result auto-approved');
  container.querySelector<HTMLInputElement>('.wf-checkbox input')!.click();await pause();add.click();await pause();
  check(fixture.graph.customBlocks[0]?.id==='proposedSet'&&fixture.graph.nodes.length===4,'Review add inserted nodes or ignored declaration');
  const block=Array.from(container.querySelectorAll<HTMLButtonElement>('.wf-palette-item')).find(b=>b.textContent?.includes('Proposed normalizer'));check(block,'Reviewed wrapper missing from registry');block.click();await pause();
  check(fixture.graph.nodes[4]?.type==='proposedSet'&&fixture.graph.nodes[4]?.config.fields,'Wrapper defaults not reused');button(container,'Undo').click();await pause();check(fixture.graph.nodes.length===4&&fixture.graph.customBlocks.length===1,'One-action insertion undo lost definition');button(container,'Undo').click();await pause();check(Number(fixture.graph.customBlocks.length)===0,'Definition not one-action undo');
  button(container,'Ask AI for a block').click();await pause();type(input(container,'Block purpose'),'Forbidden approval wrapper');await pause();next={...wrapper,baseType:'approval'};button(container,'Request block proposal').click();await pause();
  check(container.querySelector('[role="alert"]')?.textContent?.includes('strict declarative validation'),'Approval wrapper accepted');check(button(container,'Add reviewed reusable block').disabled,'Rejected proposal remained reviewed');check(Number(fixture.graph.customBlocks.length)===0,'Invalid proposal changed document');
  return {explicitRequestOnly:true,currentGraphSent:true,contractVisible:true,checkboxRequired:true,noAutoInsert:true,reviewedDefaultsReused:true,oneUndoPerEdit:true,approvalWrapperRejected:true};
 } finally {fixture.dispose();}
}

export async function staleProposalBrowserTest(){
 let finish:(value:unknown)=>void=()=>{};
 const fixture=mountWorkflowIdeFixture({request:()=>new Promise(resolve=>{finish=resolve;})});await pause();const {container}=fixture;
 try {
  container.querySelector<HTMLButtonElement>('[aria-controls="workflow-palette"]')!.click();await pause();button(container,'Ask AI for a block').click();await pause();type(input(container,'Block purpose'),'Pending DEVELOPMENT wrapper');await pause();button(container,'Request block proposal').click();await pause();
  container.querySelector<HTMLInputElement>('.wf-checkbox input')!.click();await pause();check(button(container,'Add reviewed reusable block').disabled,'Pending request allowed stale reviewed add');
  const json=container.querySelector<HTMLTextAreaElement>('[aria-label="Custom block JSON"]')!.value;
  type(input(container,'Workflow name'),'Changed while request pending');await pause();finish({id:'staleSet',label:'Stale result',baseType:'set',defaults:{fields:{}},description:'DEVELOPMENT stale result'});await pause();
  check(container.querySelector<HTMLTextAreaElement>('[aria-label="Custom block JSON"]')!.value===json,'Late result crossed document change');
  check(container.querySelector('[role="alert"]')?.textContent?.includes('Draft or model context changed'),'Stale proposal not explained');check(fixture.graph.customBlocks.length===0,'Stale result committed');
  return {pendingAddDisabled:true,lateResultDiscarded:true,noCommit:true,staleContextExplained:true};
 } finally {fixture.dispose();}
}

export async function hiddenInitialFitBrowserTest(){
 const fixture=mountWorkflowIdeFixture({hidden:true});await pause();const {container}=fixture;
 try {
  container.hidden=false;await pause();await pause();
  const viewport=container.querySelector<HTMLDivElement>('.wf-scroll')!,rect=viewport.getBoundingClientRect();
  check(Array.from(container.querySelectorAll('.wf-node')).every(node=>{const bounds=node.getBoundingClientRect();return bounds.left>=rect.left-1&&bounds.right<=rect.left+viewport.clientWidth+1&&bounds.top>=rect.top-1&&bounds.bottom<=rect.top+viewport.clientHeight+1;}),'Initially hidden editor did not fit on first activation');
  container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();await pause();const zoom=container.querySelector<HTMLElement>('.wf-stage')!.style.transform;
  container.hidden=true;await pause();container.hidden=false;await pause();check(container.querySelector<HTMLElement>('.wf-stage')!.style.transform===zoom,'Return navigation reset retained zoom');
  return {firstVisibleFit:true,returnZoomRetained:true};
 } finally {fixture.dispose();}
}

export async function topologyRevealBrowserTest(reduced=false){
 const graph=createWorkflowTemplate('branch');
 graph.nodes.push(...Array.from({length:96},(_,index)=>({id:`extra${index}`,type:'set',label:`Set ${index}`,config:{fields:{ready:true}},position:{x:50+index%4*260,y:550+Math.floor(index/4)*180}})));
 const fixture=mountWorkflowIdeFixture({reveal:true,initialGraph:graph});const {container}=fixture;
 try {
  const content=Array.from(container.querySelectorAll<HTMLElement>('.wf-node-content'));
  const animations=content.flatMap(element=>element.getAnimations());
  const startOpacity=Number(getComputedStyle(content[99]!).opacity);
  check(content.length===100,'Reveal did not render actual maximum graph');
  if(reduced)check(animations.length===0&&startOpacity===1,'Reduced motion was not honored');
  else {check(animations.length===100&&startOpacity<1,'Real initial topology entry motion absent');check(animations.every(animation=>Number(animation.effect!.getComputedTiming().endTime)<=300),'Reveal exceeds capped 300ms');}
  check(Array.from(container.querySelectorAll<HTMLElement>('.wf-node')).every(node=>getComputedStyle(node).transform==='none'),'Reveal changed position hit-test transforms');
  await new Promise(resolve=>setTimeout(resolve,400));
  check(content.every(element=>Number(getComputedStyle(element).opacity)===1),'Topology remained obscured after capped entry');
  const before=JSON.stringify(fixture.graph);
  container.querySelector<HTMLButtonElement>('[aria-controls="workflow-palette"]')!.click();await pause();
  const display=container.querySelector<HTMLSelectElement>('[aria-label="Block display"]')!;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(display,'compact');display.dispatchEvent(new Event('change',{bubbles:true}));await pause();
  check(JSON.stringify(fixture.graph)===before,'Reveal or view changed graph data');
  type(input(container,'Workflow name'),'Changed after reveal');await pause();button(container,'Undo').click();await pause();
  check(!content.some(element=>element.getAnimations().some(animation=>animation.playState==='running')),'Ordinary edits, undo or view replayed reveal');
  return {actualNodes:100,maxEntryMilliseconds:reduced?0:Math.max(...animations.map(animation=>Number(animation.effect!.getComputedTiming().endTime))),startOpacity,reducedMotion:reduced,positionsUnaffected:true,noEditReplay:true,branchStatusColor:getComputedStyle(container.querySelector<HTMLElement>('.wf-node[data-family="Logic / review"]')!).borderTopColor};
 } finally {fixture.dispose();}
}

export async function manifestSettingsBrowserTest(){
 const fixture=mountWorkflowIdeFixture();await pause();const {container}=fixture;
 try {
  const manifest=container.querySelector<HTMLDetailsElement>('.wf-manifest')!;check(!manifest.open,'Manifest crowds initial canvas');manifest.open=true;
  container.querySelector<HTMLButtonElement>('[aria-label="Open block settings for Route request"]')!.click();await pause();
  const dialog=container.querySelector<HTMLDialogElement>('dialog')!;check(dialog.matches(':modal')&&dialog.contains(document.activeElement),'Manifest node did not open actual modal');
  const parameter=input(container,'Condition field');type(parameter,'retainedManifestDraft');await pause();button(container,'Close ×').click();await pause();
  container.querySelector<HTMLButtonElement>('[aria-label="Open block settings for Route request"]')!.click();await pause();check(input(container,'Condition field')===parameter&&parameter.value==='retainedManifestDraft','Manifest remounted settings or lost unapplied draft');
  button(container,'Results').click();await pause();check(dialog.textContent?.includes('Not run'),'Manifest invented node output');
  return {collapsedByDefault:true,actualNodeModal:true,retainedParameterDom:true,noInventedOutput:true};
 } finally {fixture.dispose();}
}

export async function replacementGuardBrowserTest(){
 const fixture=mountWorkflowIdeFixture();await pause();const {container,handle}=fixture;
 const original=window.confirm;let confirmations=0;window.confirm=()=>{confirmations++;return false;};
 try {
  check(typeof handle.current?.confirmReplacement==='function','Missing actual imperative replacement guard');
  check(handle.current.confirmReplacement()&&confirmations===0,'Clean document prompted');
  container.querySelector<HTMLButtonElement>('[aria-label="Fit to graph"]')!.click();await pause();
  check(handle.current.confirmReplacement()&&confirmations===0,'View changes made document dirty');
  type(input(container,'Workflow name'),'Edited handoff');await pause();
  check(!handle.current.confirmReplacement()&&Number(confirmations)===1,'Edited graph handoff was not refused');
  button(container,'Undo').click();await pause();check(handle.current.confirmReplacement(),'Undo to opened graph remained dirty');
  container.querySelector<HTMLButtonElement>('.wf-node-head[aria-label="Select and drag Route request"]')!.click();await pause();
  input(container,'Condition field').dispatchEvent(new Event('input',{bubbles:true}));await pause();
  check(!handle.current.confirmReplacement(),'Unapplied parameter input bypassed guard');
  fixture.render(1);await pause();
  container.querySelector<HTMLButtonElement>('.wf-node-head[aria-label="Select and drag Route request"]')!.click();await pause();button(container,'Inputs').click();await pause();button(container,'Add mapping').click();await pause();
  check(!handle.current!.confirmReplacement(),'Unapplied mapping-row insertion bypassed guard');
  const before=JSON.stringify(fixture.graph);window.confirm=()=>{confirmations++;return true;};
  check(handle.current!.confirmReplacement(),'Explicit confirmed handoff refused');check(JSON.stringify(fixture.graph)===before,'Guard replaced graph or changed history');
  return {cleanNoPrompt:true,viewNoPrompt:true,dirtyCancelled:true,undoClean:true,unappliedParameter:true,unappliedMappingRow:true,explicitConfirmation:true,noGraphMutation:true};
 } finally {window.confirm=original;fixture.dispose();}
}
