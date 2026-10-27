import {fixture,button} from './walkthrough.browser';
import {createWorkflowTemplate} from '../WorkflowEditor';
import {createWalkthrough} from '../walkthrough';
import type {Graph} from '../../../packages/workflow/graph';
const wait=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
function check(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
export async function connectionLock(){
 const f=fixture({reveal:true}),c=f.container;await wait();
 try{
  await wait(520);button(c,'Pause creation').click();await wait();
  const current=c.querySelector<SVGGElement>('.wf-edges g[data-creation-current="true"]');
  check(current,'A released actual dependency has no connection-lock phase');
  const path=current.querySelector('path')!,style=getComputedStyle(path);
  check(path.getAttribute('pathLength')==='1'&&style.animationName==='wf-connection-lock','Connection lock is not a normalized real SVG path animation');
  check(style.animationPlayState==='paused','Pause did not stop the connection lock');
  check(Number.parseFloat(style.animationDuration)*1000<=210,'Connection animation exceeded a module group');
  check(c.querySelectorAll('.wf-edges path').length===f.graph.edges.length,'Animation fabricated dependency edges');
  button(c,'Resume creation').click();await wait(2200);
  check(!c.querySelector('.wf-creation-bar')&&[...c.querySelectorAll('.wf-edges path')].every(n=>getComputedStyle(n).strokeDashoffset==='0px'),'Connections did not lock into final actual topology');
  return {actualEdges:f.graph.edges.length,normalizedConnectionDraw:true,pauseStopsEdge:true,finalTopology:true};
 }finally{f.dispose();}
}
export async function ancestorMotionOff(){
 const f=fixture({reveal:true}),c=f.container;await wait();
 try{
  c.dataset.motion='off';await wait();
  check(!c.querySelector('.wf-creation-bar')&&!c.querySelector('[data-creation-queued="true"]'),'Ancestor motion-off did not immediately finalize received assembly');
  const skin=[...c.querySelectorAll('.wf-assembly-plate')];
  check(skin.every(n=>getComputedStyle(n).transform==='none'&&getComputedStyle(n).animationName==='none'),'Ancestor motion-off left a moving faceplate');
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;
  button(panel,'Next').click();await wait();check(panel.querySelector('h3')?.textContent?.includes('Condition'),'Ancestor motion-off disabled manual explanation');
  check(button(panel,'Play walkthrough').disabled,'Ancestor motion-off left timed Play enabled');
  c.removeAttribute('data-motion');await wait(600);check(!c.querySelector('.wf-creation-bar'),'Removing ancestor motion-off silently replayed assembly');
  return {immediateFinal:true,plateTransformNone:true,animationNone:true,manualTour:true,noEnableReplay:true};
 }finally{f.dispose();}
}
export function geometry(c:Element){
 return [...c.querySelectorAll<HTMLElement>('.wf-node,.wf-node-assembly,.wf-node-content,.wf-node-head,.wf-ports,.wf-ports button')].map(n=>{
  const r=n.getBoundingClientRect(),s=getComputedStyle(n);check(s.transform==='none',`Interactive ${n.className} moved with assembly`);
  return {name:n.className.split(' ').filter(name=>!name.startsWith('wf-reveal-')).join(' ')||n.getAttribute('aria-label'),x:r.x,y:r.y,width:r.width,height:r.height};
 });
}
export function hitTests(c:Element){
 const v=c.querySelector('.wf-scroll')!.getBoundingClientRect();let hits=0;
 for(const n of c.querySelectorAll<HTMLElement>('.wf-node-head,.wf-ports button')){
  const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
  if(x<v.left||x>=v.right||y<v.top||y>=v.bottom)continue;
  check(n.contains(document.elementFromPoint(x,y)),`Decorative plate intercepted ${n.getAttribute('aria-label')}`);hits++;
 }
 check(hits>=4,'Not enough real button centers visible to exercise hit tests');return hits;
}
export async function modularPhases(display:'expanded'|'compact'='expanded'){
 const f=fixture({reveal:true}),c=f.container;await wait();
 try{
  if(display==='compact'){const select=c.querySelector<HTMLSelectElement>('[aria-label="Block display"]')!;select.value='compact';select.dispatchEvent(new Event('change',{bubbles:true}));await wait();}
  button(c,'Pause creation').click();await wait();
  const before=JSON.stringify(f.graph),rects=JSON.stringify(geometry(c)),nodes=[...c.querySelectorAll<HTMLElement>('.wf-node')],current=nodes.find(n=>n.dataset.creationCurrent==='true')!,queued=nodes.find(n=>n.dataset.creationQueued==='true')!;
  const plate=current.querySelector<HTMLElement>('.wf-assembly-plate')!,ghost=queued.querySelector<HTMLElement>('.wf-assembly-plate')!;
  check(plate.dataset.assemblyPhase==='arriving'&&ghost.dataset.assemblyPhase==='queued','Actual node phases are not received-piece arrival and queued ghost');
  check(getComputedStyle(queued).borderLeftStyle==='dashed'&&getComputedStyle(ghost).opacity==='0','Queued node has no placement ghost');
  check(getComputedStyle(queued.querySelector('.wf-ports button')!,'::after').borderLeftStyle==='dashed','Queued actual typed port has no pending coupler');
  check(getComputedStyle(current.querySelector('.wf-ports button')!,'::after').animationName==='wf-port-seat','Current actual typed port has no coupler seating accent');
  check(getComputedStyle(plate).pointerEvents==='none'&&plate.getAttribute('aria-hidden')==='true','Faceplate is not noninteractive decoration');
  const animation=plate.getAnimations()[0]!;check(animation,'Missing physical faceplate animation');
  animation.currentTime=0;const first=getComputedStyle(plate).transform;const firstHits=hitTests(c);
  animation.currentTime=Number(animation.effect!.getTiming().duration)*.68;const seated=getComputedStyle(plate).transform;
  check(first!==seated&&first!=='none'&&seated!=='none','Faceplate did not physically travel and settle');
  check(JSON.stringify(geometry(c))===rects,'Assembly keyframes changed real node, head or port geometry');
  check(hitTests(c)===firstHits,'Assembly changed visible editing hit tests');
  button(c,'Resume creation').click();await wait(300);
  check(current.querySelector('.wf-assembly-plate')?.getAttribute('data-assembly-phase')==='locked',`Actual arriving plate never became visually locked: ${JSON.stringify({style:getComputedStyle(current.querySelector('.wf-assembly-plate')!).animationPlayState,animations:current.querySelector('.wf-assembly-plate')!.getAnimations().map(a=>({time:a.currentTime,state:a.playState})),hidden:document.hidden})}`);
  button(c,'Pause creation').click();await wait();
  check(queued.dataset.creationQueued==='true','Unreceived group was silently assembled');
  const seatedCoupler=getComputedStyle(current.querySelector('.wf-ports button')!,'::after').backgroundColor;
  check(seatedCoupler!==getComputedStyle(queued.querySelector('.wf-ports button')!,'::after').backgroundColor,'Port coupler did not visually seat into its real socket');
  button(c.querySelector('.wf-creation-bar')!,'Skip to final').click();await wait();
  check([...c.querySelectorAll('.wf-assembly-plate')].every(n=>n.getAttribute('data-assembly-phase')==='locked'&&getComputedStyle(n).transform==='none'),'Skip did not leave final stable plates');
  check(JSON.stringify(geometry(c))===rects,`Final presentation geometry changed: ${JSON.stringify({before:JSON.parse(rects),after:geometry(c)})}`);
  check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'Presentation modified graph positions or undo');
  return {display,actualNodes:nodes.length,queuedGhost:true,arrivingPlate:true,lockedPlate:true,seatedCoupler,plateTransforms:[first,seated],stableInteractiveRects:true,pointerHeadAndPortHits:firstHits,skipExact:true,noHistoryMutation:true};
 }finally{f.dispose();}
}
export async function motionDisabled(kind:'local'|'reduced'){
 const f=fixture({reveal:kind==='reduced'}),c=f.container;await wait();
 try{
  const before=JSON.stringify(f.graph);button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;
  if(kind==='local'){
   button(panel,'Replay creation').click();await wait();
   const toggle=[...panel.querySelectorAll<HTMLInputElement>('input')].find(n=>n.parentElement?.textContent?.includes('Presentation motion'))!;toggle.click();await wait();
  }
  check(!c.querySelector('.wf-creation-bar')&&!c.querySelector('[data-creation-queued="true"]'),'Motion disabled kept pending visual pieces');
  for(const node of c.querySelectorAll<HTMLElement>('.wf-node,.wf-assembly-plate,.wf-ports button,.wf-edges path')){
   const s=getComputedStyle(node);check(s.transform==='none'&&s.animationName==='none','Motion disabled left a transform or animation');
   for(const pseudo of ['::before','::after'])check(getComputedStyle(node,pseudo).animationName==='none','Motion disabled left an animated port decoration');
  }
  button(panel,'Replay walkthrough').click();await wait();button(panel,'Next').click();await wait();check(panel.querySelector('h3')?.textContent?.includes('Condition'),'Motion disabled prevented manual Next');
  check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'Motion disabled mutated received graph');
  return {kind,immediateFinal:true,interactiveAndPlateTransformsNone:true,pseudoAnimationNone:true,manualTour:true,graphHistoryUnchanged:true};
 }finally{f.dispose();}
}
export async function graphExportNoEffects(){
 const graph=createWorkflowTemplate('http');graph.nodes[1]!.config={url:'https://example.test/read',method:'GET',credentialRef:'development-reference'};
 graph.customBlocks=[{id:'normalize',label:'Normalize',baseType:'set',description:'Reviewed declarative defaults',defaults:{fields:{ready:true}}}];
 graph.nodes.push({id:'wrapped',type:'normalize',label:'Normalize',config:{},position:{x:910,y:150}},{id:'missing',type:'unconfigured',label:'Configure capability',config:{description:'Pending setup'},position:{x:910,y:330}});
 let effects=0;const refused=async()=>{effects++;throw new Error('Presentation must not execute');};
 const f=fixture({initialGraph:graph,executionAdapters:{http:refused,llm:refused,resource:refused,authorizeHuman:refused},onRequestBlock:refused}),c=f.container;await wait();
 async function exported(){const menu=c.querySelector<HTMLDetailsElement>('.wf-document-menu')!;menu.open=true;button(c,'Export JSON').click();await wait();const value=c.querySelector<HTMLTextAreaElement>('[aria-label="Draft JSON"]')!.value;button(c.querySelector('[aria-label="Draft JSON transfer"]')!,'Close').click();await wait();return value;}
 try{
  const before=await exported();check(JSON.stringify(JSON.parse(before))===JSON.stringify(f.graph),'Actual store export differs from received graph');
  button(c,'Explain workflow').click();await wait();const panel=c.querySelector('.wf-walkthrough')!;button(panel,'Replay creation').click();await wait();button(c,'Pause creation').click();await wait();
  const warning=c.querySelector<HTMLElement>('.wf-node[data-config-warning="true"]')!;check(warning.textContent?.includes('Execution blocked')&&warning.querySelector('.wf-node-warning'),'Unconfigured piece falsely became an approved module');
  check(c.textContent?.includes('Reusable wrapper'),'Actual wrapper origin disappeared');
  button(c,'Resume creation').click();await wait(2200);button(panel,'Replay creation').click();await wait();button(c.querySelector('.wf-creation-bar')!,'Skip to final').click();await wait();
  const after=await exported();check(after===before&&button(c,'Undo').disabled&&button(c,'Redo').disabled,'Replay/pause/skip changed actual export bytes or history');
  check(effects===0&&!c.querySelector('.wf-run strong'),'Presentation invoked adapters, model proposals or fabricated execution');
  return {actualExportBytesIdentical:true,pauseResumeReplaySkip:true,adapterAndProposalCalls:effects,noRunTrace:true,unconfiguredStillBlocked:true,wrapperOriginPreserved:true,undoRedoUnchanged:true};
 }finally{f.dispose();}
}
export function maximumGraph():Graph{
 const graph=createWorkflowTemplate('branch');graph.nodes=Array.from({length:100},(_,i)=>({id:`step${i}`,type:i===0?'manual':i===99?'output':'set',label:`Module ${i}`,position:{x:60+i%10*240,y:60+Math.floor(i/10)*170},config:i===0||i===99?{}:{fields:{ready:true}}}));
 graph.edges=graph.nodes.slice(1).map((node,i)=>({id:`link${i}`,source:`step${i}`,target:node.id}));return graph;
}
export async function maximumSnapBound(){
 const graph=maximumGraph(),groups=createWalkthrough(graph).creationGroups.length,start=performance.now(),f=fixture({reveal:true,initialGraph:graph}),c=f.container;let finished=0,lastEnd=0;
 const observer=new MutationObserver(()=>{
  if(!c.querySelector('.wf-creation-bar'))finished ||= performance.now()-start;
  for(const n of c.querySelectorAll('.wf-assembly-plate[data-assembly-phase="arriving"]')){
   const a=n.getAnimations()[0];if(a)lastEnd=Math.max(lastEnd,performance.now()-start+Number(a.effect!.getComputedTiming().endTime)-Number(a.currentTime));
  }
 });observer.observe(c,{subtree:true,childList:true,attributes:true,attributeFilter:['data-assembly-phase']});await wait();
 try{
  const before=JSON.stringify(f.graph),duration=parseFloat(getComputedStyle(c.querySelector('.wf-editor')!).getPropertyValue('--wf-assembly-duration'));
  check(duration<=2000/groups-8&&groups<=12,'Snap timeline added an unbounded per-node tail');
  check(c.querySelectorAll('.wf-node').length===100&&c.querySelectorAll('.wf-edges path').length===99,'Maximum received graph changed piece counts');
  check([...c.querySelectorAll('.wf-node')].every(n=>getComputedStyle(n).transform==='none'),'100-node animation moved hit wrappers');
  const viewport=c.querySelector('.wf-scroll')!.getBoundingClientRect();
  check([...c.querySelectorAll('.wf-node')].every(n=>{const r=n.getBoundingClientRect();return r.left>=viewport.left-1&&r.right<=viewport.right+1&&r.top>=viewport.top-1&&r.bottom<=viewport.bottom+1;}),'100-node Fit clipped actual graph bounds');
  await wait(2250);check(finished>0&&finished<=2200&&lastEnd<=2200,'Maximum graph or final plate exceeded bounded replay');
  check(!c.querySelector('.wf-creation-bar')&&[...c.querySelectorAll('.wf-assembly-plate')].every(n=>getComputedStyle(n).transform==='none'),'Maximum graph did not finish locked');
  check(JSON.stringify(f.graph)===before&&button(c,'Undo').disabled,'Maximum graph presentation changed data/history');
  return {nodes:100,edges:99,groups,snapDurationMs:duration,measuredFinalPlateEndMs:lastEnd,measuredFinalViewMs:finished,allNodesFit:true,graphHistoryUnchanged:true};
 }finally{observer.disconnect();f.dispose();}
}
Object.assign(window,{modularTests:{connectionLock,ancestorMotionOff,modularPhases,motionDisabled,graphExportNoEffects,maximumSnapBound,maximumGraph,geometry,hitTests}});
