import {createRoot} from 'react-dom/client';
import {createRef} from 'react';
import {flushSync} from 'react-dom';
import {WorkflowEditor,createWorkflowTemplate,type WorkflowEditorHandle,type WorkflowEditorProps} from '../WorkflowEditor';
import type {Graph} from '../../../packages/workflow/graph';
const wait=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
function check(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
export function button(root:Element,text:string){const result=[...root.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===text||node.getAttribute('aria-label')===text);check(result,`Missing ${text}`);return result;}
function type(input:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}
export function fixture({reveal=false,initialGraph=createWorkflowTemplate('branch'),voice=false,...injections}:{reveal?:boolean;initialGraph?:Graph;voice?:boolean}&Pick<WorkflowEditorProps,'executionAdapters'|'onRequestBlock'>={}){
 const container=document.createElement('section');container.style.setProperty('--workflow-canvas-height','320px');document.body.append(container);
 const root=createRoot(container),handle=createRef<WorkflowEditorHandle>(),spoken:string[]=[],stops:string[]=[];
 let graph=initialGraph,active=true;
 const narration={enabled:voice,speak:(text:string)=>spoken.push(text),stop:()=>stops.push('stop')};
 const render=()=>flushSync(()=>root.render(<WorkflowEditor ref={handle} initialGraph={initialGraph} buildReveal={reveal} onChange={next=>graph=next} {...{active,narration}} {...injections}/>));render();
 return {container,handle,spoken,stops,narration,get graph(){return graph;},setActive(value:boolean){active=value;render();},render,dispose(){flushSync(()=>root.unmount());container.remove();}};
}
export async function guidedControls(){
 const f=fixture(),c=f.container;await wait();
 try{
  const before=JSON.stringify(f.graph);const opener=button(c,'Explain workflow');opener.focus();opener.click();await wait();
  const panel=c.querySelector<HTMLElement>('.wf-walkthrough')!;check(panel&&!panel.hidden,'Tour panel did not open');
  check(panel.textContent?.includes('Design walkthrough · not an execution'),'Execution boundary missing');
  check(c.querySelectorAll('[data-explanation-current="true"]').length>=1,'Current node not highlighted');
  button(panel,'Next').click();await wait();
  check(panel.querySelector('h3')?.textContent?.includes('Condition'),'Next ignored topological node');
  check(c.querySelectorAll('.wf-edges [data-explanation-route="true"]').length===3,'Both branch alternatives not highlighted');
  check(panel.textContent?.includes('both true and false as alternatives'),'Branch paths chosen without data');
  check(c.querySelector('[data-explanation-current="true"]')?.hasAttribute('aria-describedby'),'Current node not linked to accessible explanation');
  button(panel,'Previous').click();await wait();check(panel.querySelector('h3')?.textContent?.includes('Manual trigger'),'Previous did not work');
  check(button(panel,'Narrate current step').disabled,'Voice not safe-disabled by default');
  button(panel,'Play walkthrough').click();await wait(2100);check(panel.querySelector('h3')?.textContent?.includes('Condition'),'Play did not advance');
  button(panel,'Pause walkthrough').click();const paused=panel.querySelector('h3')?.textContent;await wait(2100);check(panel.querySelector('h3')?.textContent===paused,'Pause did not hold');
  button(panel,'Stop').click();await wait();check(!c.querySelector('[data-explanation-current="true"]'),'Stop retained highlight');
  button(panel,'Replay walkthrough').click();await wait();check(panel.querySelector('h3')?.textContent?.includes('Manual trigger'),'Replay did not reset');
  button(panel,'Skip to final').click();await wait();check(!c.querySelector('[data-explanation-current="true"]'),'Skip retained highlight');
  check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'Tour mutated graph or history');
  button(panel,'Close walkthrough').click();await wait();check(panel.hidden&&document.activeElement===opener,'Dismiss did not restore focus/canvas');
  return {controls:true,branchAlternatives:true,accessibleDescription:true,noMutation:true,focusReturned:true};
 }finally{f.dispose();}
}
export async function narrationPrivacy(){
 const graph=createWorkflowTemplate('approval');graph.name='Private customer project';graph.nodes[1]!.label='Private reviewer name';graph.nodes[1]!.config={reviewer:'private queue identity',reason:'private review payload'};
 const f=fixture({voice:true,initialGraph:graph}),c=f.container;await wait();
 try{
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector<HTMLElement>('.wf-walkthrough')!;
  button(panel,'Next').click();await wait();check(Number(f.spoken.length)===0,'Opening or advancing implicitly narrated');
  button(panel,'Narrate current step').click();await wait();check(Number(f.spoken.length)===1,'Explicit narration did not call shared bridge');
  check(f.spoken[0]!.includes('Independent human pause')&&!/private/i.test(f.spoken[0]!), 'Narration disclosed private graph identities/payloads');
  button(panel,'Previous').click();await wait();check(Number(f.stops.length)===1,'Next/Previous did not interrupt owned narration');
  button(panel,'Narrate current step').click();await wait();f.narration.enabled=false;f.render();await wait();
  check(Number(f.stops.length)===2&&button(panel,'Narrate current step').disabled,'Disabling voice did not stop owned narration');
  f.narration.enabled=true;f.render();await wait();check(Number(f.spoken.length)===2,'Re-enabling voice replayed old narration');
  button(panel,'Play walkthrough').click();await wait(2100);check(Number(f.spoken.length)===2,'Timed visual playback silently auto-spoke');
  return {explicitOnly:true,genericSafeText:true,interrupts:true,disableCancels:true,noEnableReplay:true,noTimedAutoSpeech:true};
 }finally{f.dispose();}
}
export async function creationMaximum(){
 const graph=createWorkflowTemplate('branch');
 graph.nodes.push(...Array.from({length:96},(_,i)=>({id:`extra${i}`,type:'set',label:`Set ${i}`,position:{x:60+i%4*240,y:550+Math.floor(i/4)*170},config:{fields:{ready:true}}})));
 const start=performance.now(),f=fixture({reveal:true,initialGraph:graph}),c=f.container;await wait();
 try{
  const before=JSON.stringify(f.graph),queued=()=>c.querySelectorAll('.wf-node-assembly[data-creation-queued="true"]').length;
  check(c.querySelectorAll('.wf-node').length===100&&queued()>0,'Maximum actual graph not assembled in bounded groups');
  check([...c.querySelectorAll('.wf-node')].every(n=>getComputedStyle(n).transform==='none'),'Creation changed position wrapper transforms');
  button(c,'Pause creation').click();await wait();const count=queued();await wait(600);check(queued()===count,'Pause creation did not hold group count');
  button(c,'Resume creation').click();await wait(2200);check(queued()===0&&!c.querySelector('.wf-creation-bar'),'Creation did not finish within 2.2 seconds after resume');
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;
  button(panel,'Replay creation').click();await wait();check(queued()>0,'Replay did not reassemble actual nodes');button(c.querySelector('.wf-creation-bar')!,'Skip to final').click();await wait();check(queued()===0,'Creation skip did not show final topology');
  return {actualNodes:100,grouped:true,positionTransformsUnchanged:true,pauseResume:true,completionBoundMs:2200,totalObservedMs:performance.now()-start,graphUnchanged:JSON.stringify(f.graph)===before};
 }finally{f.dispose();}
}
export async function navigationPause(kind:'hidden'|'inactive'){
 const f=fixture(),c=f.container;await wait();
 try{
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;
  button(panel,'Next').click();await wait();button(panel,'Play walkthrough').click();await wait();
  const title=panel.querySelector('h3')?.textContent;
  if(kind==='hidden')c.hidden=true;else f.setActive(false);
  await wait(2150);
  if(kind==='hidden')c.hidden=false;else f.setActive(true);
  await wait();check(panel.querySelector('h3')?.textContent===title,'Retained navigation advanced hidden/inactive tour');
  check(button(panel,'Play walkthrough'),'Navigation failed to pause');
  await wait(2100);check(panel.querySelector('h3')?.textContent===title,'Return navigation silently resumed');
  button(panel,'Next').click();await wait();check(panel.querySelector('h3')?.textContent?.includes('Return output'),'Manual tour did not work after navigation');
  return {kind,pausedWhileAway:true,noAutomaticResume:true,manualContinues:true};
 }finally{f.dispose();}
}
export async function modifiedGraphStops(){
 const f=fixture({voice:true}),c=f.container;await wait();
 try{
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;
  button(panel,'Narrate current step').click();await wait();button(panel,'Play walkthrough').click();await wait();
  type(c.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')!,'Edited during explanation');await wait();
  check(!c.querySelector('[data-explanation-current="true"]')&&!c.querySelector('[data-explanation-route="true"]'),'Graph edit retained old highlights');
  check(panel.querySelector('h3')?.textContent==='Actual graph overview','Graph edit retained old instructions');await wait(2100);
  check(panel.querySelector('h3')?.textContent==='Actual graph overview','Old timer advanced edited graph');
  button(c,'Undo').click();await wait();check(button(c,'Undo').disabled&&!c.querySelector('[data-explanation-current="true"]'),'Tour consumed history or restarted on undo');
  return {editClearsHighlights:true,oldTimersCancelled:true,oldInstructionsCleared:true,oneUndo:true,noUndoReplay:true};
 }finally{f.dispose();}
}
export async function settingsRetained(){
 const f=fixture(),c=f.container;await wait();
 try{
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;button(panel,'Next').click();await wait();button(panel,'Play walkthrough').click();await wait();
  const opener=button(panel,'Open current block settings');opener.focus();opener.click();await wait();const dialog=c.querySelector('dialog')!;
  check(dialog.matches(':modal')&&dialog.contains(document.activeElement),'Tour did not open real settings modal');
  const field=c.querySelector<HTMLInputElement>('[aria-label="Condition field"]')!;type(field,'retainedTourDraft');await wait();
  button(c,'Close ×').click();await wait();check(document.activeElement===opener,'Settings did not return focus to linked tour action');
  await wait(2100);check(panel.querySelector('h3')?.textContent?.includes('Condition'),'Modal raced automatic tour playback');
  opener.click();await wait();check(c.querySelector('[aria-label="Condition field"]')===field&&field.value==='retainedTourDraft','Tour discarded retained parameter draft');
  button(c,'Results').click();await wait();check(dialog.textContent?.includes('Not run'),'Walkthrough fabricated result');
  return {nativeModal:true,focusReturn:true,pauseOnModal:true,retainedDraft:true,noInventedResult:true};
 }finally{f.dispose();}
}
export async function reducedMotionManual(){
 const f=fixture({reveal:true}),c=f.container;await wait();
 try{
  check(!c.querySelector('.wf-creation-bar')&&!c.querySelector('[data-creation-queued="true"]'),'Reduced motion did not immediately finalize reveal');
  check([...c.querySelectorAll<HTMLElement>('.wf-node-assembly')].every(n=>getComputedStyle(n).opacity==='1'),'Reduced motion kept nodes obscured');
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;button(panel,'Next').click();await wait();
  check(panel.querySelector('h3')?.textContent?.includes('Condition'),'Reduced motion disabled manual explanation');
  check(button(panel,'Play walkthrough').disabled,'Reduced motion left timed playback active');
  button(panel,'Replay creation').click();await wait();check(!c.querySelector('.wf-creation-bar'),'Reduced motion manually replayed animation');
  return {immediateFinal:true,noAnimation:true,manualNextWorks:true,timedPlayDisabled:true};
 }finally{f.dispose();}
}
export async function motionOffManual(){
 const f=fixture(),c=f.container;await wait();
 try{
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;
  button(panel,'Replay creation').click();await wait();check(c.querySelector('.wf-creation-bar'),'Missing replay before motion off');
  const checkbox=[...panel.querySelectorAll<HTMLInputElement>('input')].find(input=>input.parentElement?.textContent?.includes('Presentation motion'))!;checkbox.click();await wait();
  check(!c.querySelector('.wf-creation-bar')&&!c.querySelector('[data-creation-queued="true"]'),'Motion off did not immediately finalize');
  button(panel,'Replay walkthrough').click();await wait();button(panel,'Next').click();await wait();check(panel.querySelector('h3')?.textContent?.includes('Condition'),'Motion off disabled manual tour');
  return {immediateFinal:true,manualNextWorks:true,noGraphMutation:button(c,'Undo').disabled};
 }finally{f.dispose();}
}
export async function viewOperations(){
 const f=fixture(),c=f.container;await wait();
 try{
  const before=JSON.stringify(f.graph);button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;button(panel,'Next').click();await wait();
  const title=panel.querySelector('h3')?.textContent;button(c,'Fit to graph').click();button(c,'Inspector').click();await wait();
  c.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();await wait();
  const select=c.querySelector<HTMLSelectElement>('[aria-label="Block display"]')!;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,'compact');select.dispatchEvent(new Event('change',{bubbles:true}));await wait();f.render();await wait();
  check(panel.querySelector('h3')?.textContent===title&&c.querySelector('[data-explanation-current="true"]'),'View/parent object updates restarted walkthrough');
  check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'View/replay modified graph or undo history');
  return {zoomDisplayFitRetainedStep:true,parentRerenderRetainedStep:true,graphAndHistoryUnchanged:true};
 }finally{f.dispose();}
}
export async function deletionStops(){
 const f=fixture(),c=f.container;await wait();
 try{
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;button(panel,'Next').click();await wait();button(panel,'Next').click();await wait();
  button(panel,'Open current block settings').click();await wait();button(c,'Delete node').click();await wait();button(c,'Close ×').click();await wait();
  check(Number(f.graph.nodes.length)===3&&!c.querySelector('[data-explanation-current="true"]'),'Deletion left stale current node');
  check(panel.querySelector('h3')?.textContent==='Actual graph overview','Deletion left stale instructions');
  button(c,'Undo').click();await wait();check(Number(f.graph.nodes.length)===4&&button(c,'Undo').disabled,'Deletion not single history entry');
  return {staleNodeRemoved:true,instructionsCleared:true,oneUndo:true};
 }finally{f.dispose();}
}
export async function localExecutionUnchanged(){
 const f=fixture(),c=f.container;await wait();
 try{
  const before=JSON.stringify(f.graph);button(c,'Run locally').click();await wait();const run=c.querySelector('.wf-run')!;
  check(run.textContent?.includes('COMPLETED'),'Deterministic local fixture did not execute');const trace=run.textContent;
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;button(panel,'Next').click();await wait();button(panel,'Replay creation').click();await wait();
  button(panel,'Skip to final').click();await wait();check(run.textContent===trace,'Presentation changed real local execution trace');
  check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'Presentation changed graph/history');
  return {explicitDeterministicRun:true,traceUnaffected:true,noExecutionFromTour:true,graphHistoryUnchanged:true};
 }finally{f.dispose();}
}
export async function resourceReferenceInsertion(){
 const f=fixture(),c=f.container;await wait();
 try{
  const before=JSON.stringify(f.graph);button(c,'Explain workflow').click();await wait();const result=flushSync(()=>f.handle.current!.insertResource({resourceId:'ba9acba0-752e-4c44-8c4a-603754b44a18',revision:2,functionId:'measure',parameters:{label:'reviewed literal'}}));await wait();
  check(result.ok&&Number(f.graph.nodes.length)===5,'Resource insertion failed with tour active');check(!c.querySelector('[data-explanation-current="true"]'),'Insertion retained stale tour');
  const added=f.graph.nodes.at(-1)!;check(added.type==='resource'&&!f.graph.edges.some(e=>e.target===added.id),'Reference was implicitly connected');
  check(JSON.stringify(added.inputMappings)==='[{"target":"label","source":{"kind":"literal","value":"reviewed literal"}}]','Reference literal mappings changed');
  button(c,'Close ×').click();await wait();button(c,'Undo').click();await wait();check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'Reference insertion not one undo');
  return {referenceOnly:true,unconnected:true,literalMappings:true,oneUndo:true,tourCancelled:true};
 }finally{f.dispose();}
}
Object.assign(window,{walkthroughTests:{fixture,guidedControls,narrationPrivacy,creationMaximum,navigationPause,modifiedGraphStops,settingsRetained,reducedMotionManual,motionOffManual,viewOperations,deletionStops,localExecutionUnchanged,resourceReferenceInsertion,button,wait,type}});
