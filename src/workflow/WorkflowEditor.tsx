import {useEffect,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type Ref,type CSSProperties} from 'react';
import type {ResourceSelection} from '../../packages/resources/contract';
import {builtinRegistry,createEmptyGraph,customBlockSchema,graphSchema,resolveNode,type Graph,type GraphNode,type Json} from '../../packages/workflow/graph';
import {createWorkflowRunner,type RunResult,type ExecutionAdapters} from '../../packages/workflow/engine';
import {WorkflowEditorStore,type FragmentReviewSession} from './store';
import {WorkflowFragmentReview} from './WorkflowFragmentReview';
import {WORKFLOW_CSS} from './styles';
import {NodeParameters, type SaveOutcome} from './NodeParameters';
import {WorkflowMenuBar,type WorkflowAppMenu} from './WorkflowMenuBar';
import {blockControlProfile} from './block-controls';
import {quickInspectorPlacement,type QuickInspectorRect} from './quick-inspector-layout';
import {NodeInputMapper} from './NodeInputMapper';
import {NodeRunResults,NodeRunStatus,localDetails} from './NodeRunResults';
import {workflowBuildManifest,BLOCK_FAMILIES} from './build-manifest';
import {BuildManifest} from './BuildManifest';
import {useWorkflowWalkthrough,type WorkflowNarration} from './useWorkflowWalkthrough';
import {WalkthroughPanel,CreationReplay} from './WalkthroughPanel';
import {AssemblyPlate} from './AssemblyPlate';
import {BlockComposer} from './BlockComposer';
import {WrapperReview} from './WrapperReview';
import {stackedWorkflowLayout} from './stacked-layout';
export {workflowBuildManifest} from './build-manifest';
export function canvasDropPosition(point:{x:number;y:number},rect:{left:number;top:number;width:number;height:number},scrollLeft:number,scrollTop:number,zoom:number):GraphNode['position']|null {
 if(![point.x,point.y,rect.left,rect.top,rect.width,rect.height,scrollLeft,scrollTop,zoom].every(Number.isFinite)||zoom<=0||point.x<rect.left||point.y<rect.top||point.x>rect.left+rect.width||point.y>rect.top+rect.height)return null;
 const x=(point.x-rect.left+scrollLeft)/zoom,y=(point.y-rect.top+scrollTop)/zoom;
 return x>=0&&y>=0&&x<=10000&&y<=10000?{x,y}:null;
}
export const PALETTE_DRAG_MIME='application/x-flightdeck-workflow-block';
export function paletteDropType(raw:string,active:string|null,graph:Graph):string|null {
 return raw.length<=64&&raw===active&&(builtinRegistry.some(b=>b.type===raw)||graph.customBlocks.some(b=>b.id===raw))?raw:null;
}
export const PALETTE_CATEGORIES=['Triggers','Connectors / AI','Data','Logic / review','Output / placeholders','Reusable blocks'] as const;
const BLOCK_CATEGORY=BLOCK_FAMILIES;
const BLOCK_GLYPH:Record<string,string>={manual:'▶',http:'↗',resource:'▧',llm:'✦',set:'{}',branch:'⑂',approval:'◇',output:'↳',unconfigured:'!'};
export function paletteEntries(graph:Graph,category:string='All',search:string='') {
 const entries=[...builtinRegistry.map(b=>({...b,category:BLOCK_CATEGORY[b.type]})),...graph.customBlocks.map(b=>({...b,type:b.id,category:'Reusable blocks'}))];
 const query=search.trim().toLowerCase();return entries.filter(b=>(category==='All'||b.category===category)&&`${b.label} ${b.description} ${b.type}`.toLowerCase().includes(query));
}
export type BlockDisplay='expanded'|'compact';
export function nodeLayout(display:BlockDisplay){return display==='compact'?{width:176,height:88,anchorY:68}:{width:220,height:144,anchorY:124};}
export function fitGraphViewport(nodes:ReadonlyArray<Pick<GraphNode,'position'>>,display:BlockDisplay,viewport:{width:number;height:number}){
 const valid=nodes.filter(n=>Number.isFinite(n.position.x)&&Number.isFinite(n.position.y));
 if(!valid.length||!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.width<=0||viewport.height<=0)return {zoom:1,scrollLeft:0,scrollTop:0};
 const layout=nodeLayout(display),left=Math.max(0,Math.min(...valid.map(n=>n.position.x))),top=Math.max(0,Math.min(...valid.map(n=>n.position.y)));
 const width=Math.max(layout.width,Math.max(...valid.map(n=>n.position.x+layout.width))-left),height=Math.max(layout.height,Math.max(...valid.map(n=>n.position.y+layout.height))-top);
 const zoom=Math.max(.01,Math.min(1.5,Math.max(1,viewport.width-48)/width,Math.max(1,viewport.height-48)/height));
 return {zoom,scrollLeft:Math.max(0,left*zoom-(viewport.width-width*zoom)/2),scrollTop:Math.max(0,top*zoom-(viewport.height-height*zoom)/2)};
}
export function connectionPath(a:GraphNode['position'],b:GraphNode['position'],display:BlockDisplay){
 const layout=nodeLayout(display),ax=a.x+layout.width,ay=a.y+layout.anchorY,bx=b.x,by=b.y+layout.anchorY;
 return `M${ax},${ay} C${ax+90},${ay} ${bx-90},${by} ${bx},${by}`;
}
export interface BlockRequest {prompt:string;graph:Graph}
export interface WorkflowEditorHandle {
 /** Existing document/unapplied-settings guard. Does not replace or authorize a graph. */
 confirmReplacement:()=>boolean;
 /** Synchronous one-shot edit; no pending command can replay on load or remount. */
 insertResource:(selection:ResourceSelection)=>({ok:true;nodeId:string}|{ok:false;error:string});
}
export interface WorkflowEditorProps {
 ref?:Ref<WorkflowEditorHandle>;
 /** Initial document only. Remount with a new key to replace from the parent. */
 initialGraph?:Graph;
 /** Visual-only entry for an explicitly accepted AI draft. Never an execution or review receipt. */
 buildReveal?:boolean;
 /** Retained parent view visibility. Hidden/inactive views never advance presentation timers. */
 active?:boolean;
 /** Optional shared voice-provider bridge. Explicit Narrate only; no speech implementation here. */
 narration?:WorkflowNarration;
 onChange?:(graph:Graph)=>void;
 /** Trusted parent supplies its guarded server request; result is untrusted and always human-reviewed. */
 onRequestBlock?:(request:BlockRequest)=>Promise<unknown>;
 /** Optional trusted adapters; omitted means connectors fail closed. No approval UI is supplied. */
 executionAdapters?:ExecutionAdapters;
}
export function createWorkflowTemplate(kind:'approval'|'branch'|'http'):Graph{
 const g=createEmptyGraph(kind==='approval'?'Human-reviewed request':kind==='branch'?'Conditional routing':'HTTP connector draft');
 const definitions=kind==='branch'?[['manual','Manual trigger',{}],['branch','Route request',{field:'approved',operator:'equals',value:true}],['output','Accepted output',{}],['output','Other output',{}]]:kind==='approval'?[['manual','Manual trigger',{}],['approval','Review request',{reason:'Independent human review required'}],['output','Return output',{}]]:[['manual','Manual trigger',{}],['http','Configure HTTP connector',{method:'GET',service:'generic'}],['output','Return output',{}]];
 g.nodes=definitions.map((n,i)=>({id:`node${i}`,type:n[0] as string,label:n[1] as string,config:n[2] as GraphNode['config'],position:{x:70+(i===3?2:i)*280,y:i===3?330:150}}));
 g.edges=kind==='branch'?[{id:'edge0',source:'node0',target:'node1'},{id:'edge1',source:'node1',target:'node2',sourcePort:'true'},{id:'edge2',source:'node1',target:'node3',sourcePort:'false'}]:[{id:'edge0',source:'node0',target:'node1'},{id:'edge1',source:'node1',target:'node2'}];return graphSchema.parse(g);
}
function describeConfig(type:string){return ({manual:'{} — manual input is supplied at execution, not stored in the graph.',http:'url (HTTPS), method, credentialRef (vault identifier), optional body and service. No secrets, URL query or credentials inline.',resource:'Resource ID, exact active revision and function ID. Input mappings supply reviewed read-only function parameters; references do not grant access.',llm:'instruction, optional model. Tools and autonomous code execution are not supported.',set:'fields: a JSON object merged into input. No JavaScript or expressions.',branch:'field, operator (equals or exists), optional value. Connect true and false ports.',approval:'reviewer: named review queue/person; reason. Pauses; graph config cannot authorize approval.',output:'{} — returns incoming data.',unconfigured:'description: the legacy intent. This node blocks execution.'} as Record<string,string>)[type]??'Declarative custom block defaults; node overrides must match its base type.';}
export function WorkflowEditor({initialGraph,onChange,onRequestBlock,executionAdapters,ref,buildReveal=false,active=true,narration}:WorkflowEditorProps){
 const [store]=useState(()=>new WorkflowEditorStore(initialGraph));const state=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);const g=state.graph;
 const openedGraph=useRef(store.exportJson()),settingsEdited=useRef(false);
 const manifest=workflowBuildManifest(g);
 const proposedWrapperIds=useRef(new Set(buildReveal?g.customBlocks.map(block=>block.id):[]));
 const revealNodes=useRef(new Set(buildReveal?g.nodes.map(node=>node.id):[]));
 const revealEdges=useRef(new Set(buildReveal?g.edges.map(edge=>edge.id):[]));
 function confirmReplacement(){return (store.exportJson()===openedGraph.current&&!settingsEdited.current)||window.confirm('Replace this edited local graph? Graph changes and unapplied block settings will be discarded. Export JSON first to keep the applied graph. Server-saved revisions are not changed.');}
 const [selected,setSelected]=useState<string|null>(null),[source,setSource]=useState(''),[target,setTarget]=useState(''),[port,setPort]=useState<'default'|'true'|'false'>('default');
 const [view,setView]=useState<'canvas'|'stacked'>('canvas');
 const [canvasZoom,setCanvasZoom]=useState(1),[stackedZoom,setStackedZoom]=useState(1);
 const zoom=view==='stacked'?stackedZoom:canvasZoom,setZoom=view==='stacked'?setStackedZoom:setCanvasZoom;
 const [error,setError]=useState(''),[json,setJson]=useState(''),[transfer,setTransfer]=useState(false),[localRun,setLocalRun]=useState<{snapshot:typeof state;result:RunResult}|null>(null),[running,setRunning]=useState(false),[seed,setSeed]=useState('{}');
 // Undo can restore a graph object, but never the store's previous snapshot identity.
 const run=localRun?.snapshot===state?localRun.result:null;
 const editorRoot=useRef<HTMLElement|null>(null),executionInput=useRef<HTMLTextAreaElement|null>(null);
 const transferField=useRef<HTMLTextAreaElement|null>(null),transferReturnFocus=useRef<HTMLElement|null>(null);
 function openTransfer(text:string){transferReturnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setJson(text);setTransfer(true);requestAnimationFrame(()=>{if(editorActive.current&&!transferField.current?.closest('[hidden],[inert]'))transferField.current?.focus();});}
 function closeTransfer(){setTransfer(false);const opener=transferReturnFocus.current;transferReturnFocus.current=null;requestAnimationFrame(()=>{if(editorActive.current&&opener?.isConnected&&!opener.closest('[hidden],[inert]')){const bounds=opener.getBoundingClientRect(),view=opener.ownerDocument.defaultView;if(view&&(bounds.top<0||bounds.bottom>view.innerHeight))opener.scrollIntoView({block:'center',inline:'nearest'});opener.focus({preventScroll:true});}});}
 const pendingSettings=useRef(new Set<string>()),visitedSettings=useRef(new Set<string>());
 const [fragmentSession,setFragmentSession]=useState<FragmentReviewSession|null>(null),[fragmentGuard,setFragmentGuard]=useState('');
 useEffect(()=>{setFragmentGuard('');},[selected,g]);
 function openFragment(){if(!selected)return;setFragmentGuard('');if(pendingSettings.current.size){setFragmentGuard('Apply pending block Parameters and Inputs before composing a fragment. No settings were discarded.');return;}tour.interrupt();try{setFragmentSession(store.beginFragmentReview(selected));setError('');}catch{setFragmentGuard('Fragment composition requires an unprotected builtin draft slot with exactly one incoming and outgoing connection.');}}
 const [custom,setCustom]=useState(false),[customText,setCustomText]=useState(JSON.stringify({id:'myConnector',label:'My connector',baseType:'http',defaults:{method:'GET',service:'generic'},description:'Describe the reviewed purpose'},null,2)),[reviewed,setReviewed]=useState(false),[blockPrompt,setBlockPrompt]=useState(''),[requesting,setRequesting]=useState(false);
 const proposalTurn=useRef(0),proposalPending=useRef(false),proposalContext=useRef({graph:g,request:onRequestBlock});proposalContext.current={graph:g,request:onRequestBlock};
 useEffect(()=>{setReviewed(false);if(proposalPending.current){proposalTurn.current++;proposalPending.current=false;setRequesting(false);setError('Draft or model context changed. Request a new block proposal before review.');}},[g,onRequestBlock]);
 useEffect(()=>()=>{proposalTurn.current++;},[]);
 function openCustom(){proposalTurn.current++;proposalPending.current=false;setRequesting(false);setError('');setCustom(true);setReviewed(false);}
 function closeCustom(){proposalTurn.current++;proposalPending.current=false;setRequesting(false);setReviewed(false);setCustom(false);}
 async function requestBlock(){
  if(!onRequestBlock||requesting||!blockPrompt.trim())return;
  const turn=++proposalTurn.current,request=onRequestBlock,graph=g;
  proposalPending.current=true;setRequesting(true);setReviewed(false);
  try {
   const raw=await request({prompt:blockPrompt,graph});
   if(turn!==proposalTurn.current)return;
   if(proposalContext.current.graph!==graph||proposalContext.current.request!==request){setError('Draft or model context changed. Request a new block proposal before review.');return;}
   const block=customBlockSchema.parse(typeof raw==='string'?JSON.parse(raw):raw);
   setCustomText(JSON.stringify(block,null,2));setError('');
  } catch {if(turn===proposalTurn.current)setError('Proposed block failed strict declarative validation');}
  finally {if(turn===proposalTurn.current){proposalPending.current=false;setRequesting(false);}}
 }
 const [category,setCategory]=useState('All'),[search,setSearch]=useState('');
 const [paletteOpen,setPaletteOpen]=useState(false),[inspectorOpen,setInspectorOpen]=useState(false);
 function selectNode(id:string){setSelected(id);setInspectorOpen(true);}
 const [display,setDisplay]=useState<BlockDisplay>('expanded');
 const stacked=useMemo(()=>view==='stacked'?stackedWorkflowLayout(g,display==='compact'):null,[g,view,display]);
 const stackNodes=new Map(stacked?.nodes.map(node=>[node.id,node]));
 const stackEdges=new Map(stacked?.edges.map(edge=>[edge.id,edge]));
 const layout=view==='stacked'?{width:300,height:display==='compact'?104:156,anchorY:0}:nodeLayout(display);
 const drawingWidth=stacked?Math.max(348,stacked.width):Math.max(1300,...g.nodes.map(n=>n.position.x+300));
 const drawingHeight=stacked?Math.max(320,stacked.height):Math.max(650,...g.nodes.map(n=>n.position.y+250));
 const scrollByView=useRef<Partial<Record<'canvas'|'stacked',{scrollLeft:number;scrollTop:number}>>>({});
 function changeView(next:'canvas'|'stacked'){
  if(next===view)return;
  const viewport=canvasViewport.current;if(viewport)scrollByView.current[view]={scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop};
  tour.interrupt();pendingViewport.current=null;dragRef.current=null;setDrag(null);setView(next);
 }
 const paletteDrag=useRef<string|null>(null);
 const canvasViewport=useRef<HTMLDivElement|null>(null),initialFitted=useRef(false),editorActive=useRef(active);editorActive.current=active;
 const pendingViewport=useRef<{scrollLeft:number;scrollTop:number}|null>(null);
 function fitToGraph(){const v=canvasViewport.current;if(!v||!editorActive.current||document.hidden||v.clientWidth<=0||v.clientHeight<=0||v.closest('[hidden],[inert]'))return;const fit=stacked?{zoom:Math.max(.01,Math.min(1,(v.clientWidth-24)/drawingWidth)),scrollLeft:0,scrollTop:0}:fitGraphViewport(currentGraph.current.nodes,display,{width:v.clientWidth,height:v.clientHeight});pendingViewport.current=fit;setZoom(fit.zoom);requestAnimationFrame(()=>{if(pendingViewport.current&&editorActive.current&&!document.hidden&&!v.closest('[hidden],[inert]')){v.scrollLeft=pendingViewport.current.scrollLeft;v.scrollTop=pendingViewport.current.scrollTop;pendingViewport.current=null;}});}
 useEffect(()=>{
  const viewport=canvasViewport.current;if(!viewport)return;
  const frame=requestAnimationFrame(()=>{const saved=scrollByView.current[view],entry=g.nodes.find(node=>resolveNode(g,node).type==='manual')??g.nodes[0],focus=entry?stackNodes.get(entry.id):undefined;const center=focus?focus.x+focus.width/2:drawingWidth/2;viewport.scrollLeft=saved?.scrollLeft??(view==='stacked'?Math.max(0,center*zoom-viewport.clientWidth/2):0);viewport.scrollTop=saved?.scrollTop??0;});
  return ()=>cancelAnimationFrame(frame);
 },[view]);
 useEffect(()=>{
  const viewport=canvasViewport.current;if(!viewport||!active||view!=='canvas'||initialFitted.current)return;
  const fitWhenActive=()=>{if(initialFitted.current||!editorActive.current||document.hidden||viewport.clientWidth<=0||viewport.clientHeight<=0||viewport.closest('[hidden],[inert]'))return;initialFitted.current=true;fitToGraph();observer.disconnect();document.removeEventListener('visibilitychange',fitWhenActive);};
  const observer=new ResizeObserver(fitWhenActive);observer.observe(viewport);
  document.addEventListener('visibilitychange',fitWhenActive);
  const frame=requestAnimationFrame(fitWhenActive);
  return ()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',fitWhenActive);};
 },[active,view]);
 const settingsDialog=useRef<HTMLDialogElement|null>(null);
 const settingsReturnFocus=useRef<HTMLElement|null>(null);
 const [settingsOpen,setSettingsOpen]=useState(false);
 const [sampleInput,setSampleInput]=useState<Json|undefined>(undefined);
 const currentGraph=useRef(g);currentGraph.current=g;
 function openSettings(id:string){tour.interrupt();settingsReturnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setSelected(id);setSettingsOpen(true);}
 useEffect(()=>{
  const dialog=settingsDialog.current;if(!dialog)return;
  if(settingsOpen&&!dialog.open)dialog.showModal();
  else if(!settingsOpen){
   if(dialog.open)dialog.close();
   const opener=settingsReturnFocus.current;settingsReturnFocus.current=null;
   if(opener?.isConnected&&!opener.closest('[hidden],[inert]')){
    opener.focus({preventScroll:true});
    const pane=opener.closest<HTMLElement>('.wf-settings-dialog:not([open])');
    if(pane){const target=opener.getBoundingClientRect(),bounds=pane.getBoundingClientRect(),top=bounds.top+pane.clientTop,bottom=top+pane.clientHeight;if(target.top<top)pane.scrollTop+=target.top-top;else if(target.bottom>bottom)pane.scrollTop+=target.bottom-bottom;}
   }else if(opener)dialog.closest('.wf-editor')?.querySelector<HTMLButtonElement>('[aria-label="Edit menu"]')?.focus({preventScroll:true});
  }
 },[settingsOpen]);
 const [drag,setDrag]=useState<{id:string;x:number;y:number}|null>(null);const dragRef=useRef<{id:string;startX:number;startY:number;originX:number;originY:number;pointerId:number}|null>(null);
 const tour=useWorkflowWalkthrough(g,canvasViewport,active,settingsOpen||custom||transfer||running||!!fragmentSession,buildReveal,narration);
 useLayoutEffect(()=>{
  const dialog=settingsDialog.current,editor=editorRoot.current,owner=dialog?.parentElement,win=editor?.ownerDocument.defaultView;
  if(!active||!inspectorOpen||settingsOpen||!dialog||!editor||!owner||!win)return;
  let frame=0;
  const measure=()=>{
   frame=0;if(!editorActive.current||dialog.hidden||editor.closest('[hidden],[inert]')||editor.ownerDocument.hidden)return;
   const visual=win.visualViewport,vx=visual?.offsetLeft??0,vy=visual?.offsetTop??0;
   const rect=(r:DOMRect):QuickInspectorRect=>({left:r.left-vx,top:r.top-vy,right:r.right-vx,bottom:r.bottom-vy});
   const card=editor.querySelector('.wf-node.is-selected'),menu=editor.querySelector('.wf-app-menus');
   const placement=quickInspectorPlacement(rect(editor.getBoundingClientRect()),card?rect(card.getBoundingClientRect()):null,{width:visual?.width??win.innerWidth,height:visual?.height??win.innerHeight},(menu?.getBoundingClientRect().bottom??editor.getBoundingClientRect().top)-vy);
   // The retained native dialog is a child of the editor's positioned body.
   // Prepare its closed-state placement even while the modal-close effect settles.
   const anchor=owner.getBoundingClientRect();
   dialog.style.setProperty('--wf-inspector-left',`${placement.left+vx-anchor.left-owner.clientLeft+owner.scrollLeft}px`);
   dialog.style.setProperty('--wf-inspector-top',`${placement.top+vy-anchor.top-owner.clientTop+owner.scrollTop}px`);
   dialog.style.setProperty('--wf-inspector-width',`${placement.width}px`);
   dialog.style.setProperty('--wf-inspector-height',`${placement.maxHeight}px`);
   if(placement.width<=0||placement.maxHeight<=0)dialog.style.visibility='hidden';else dialog.style.removeProperty('visibility');
  };
  const schedule=()=>{if(!frame)frame=win.requestAnimationFrame(measure);};
  measure();
  const observer=new ResizeObserver(schedule);observer.observe(editor);if(canvasViewport.current)observer.observe(canvasViewport.current);
  win.addEventListener('resize',schedule);win.addEventListener('scroll',schedule,true);editor.ownerDocument.addEventListener('visibilitychange',schedule);
  win.visualViewport?.addEventListener('resize',schedule);win.visualViewport?.addEventListener('scroll',schedule);
  return ()=>{if(frame)win.cancelAnimationFrame(frame);observer.disconnect();win.removeEventListener('resize',schedule);win.removeEventListener('scroll',schedule,true);editor.ownerDocument.removeEventListener('visibilitychange',schedule);win.visualViewport?.removeEventListener('resize',schedule);win.visualViewport?.removeEventListener('scroll',schedule);dialog.style.removeProperty('visibility');};
 },[active,inspectorOpen,settingsOpen,selected,g,view,display,zoom,drag]);
 const onChangeRef=useRef(onChange);onChangeRef.current=onChange;
 useEffect(()=>{onChangeRef.current?.(g);},[g]);
 useEffect(()=>{setLocalRun(current=>current?.snapshot===state?current:null);},[state]);
 const node=g.nodes.find(n=>n.id===selected);const nodeType=node?resolveNode(g,node).type:null;
 if(node)visitedSettings.current.add(node.id);
 const settingsNodes=[...(node?[node]:[]),...g.nodes.filter(n=>n.id!==selected&&visitedSettings.current.has(n.id))];
 function act(fn:()=>void):SaveOutcome {
  try {fn();setError('');return {ok:true};}
  catch(e) {
   const message=e instanceof Error?e.message:'Draft change refused';
   setError(message);return {ok:false,error:message};
  }
 }
 const [resourceNotice,setResourceNotice]=useState<string|null>(null);
 useImperativeHandle(ref,()=>({confirmReplacement,insertResource(selection){
  try {const nodeId=store.addResourceNode(selection);setError('');setResourceNotice(nodeId);openSettings(nodeId);return {ok:true,nodeId};}
  catch {const message='Resource insertion refused: check the reference, safe parameter bounds and 100-block graph limit. No draft change was made.';setError(message);return {ok:false,error:message};}
 }}),[store]);
 function connect(s=source,t=target,p=port){act(()=>store.connect(s,t,p));}
 function download(){const url=URL.createObjectURL(new Blob([store.exportJson()],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${g.id}.workflow-draft.json`;a.click();URL.revokeObjectURL(url);}
 function showExecutionInput(){const field=executionInput.current,details=field?.closest('details');if(!editorActive.current||!field||!details)return;setSettingsOpen(false);setInspectorOpen(false);details.open=true;requestAnimationFrame(()=>{if(editorActive.current&&field.isConnected&&!field.closest('[hidden],[inert]')){field.scrollIntoView({block:'nearest'});field.focus();}});}
 function showValidation(){const details=editorRoot.current?.querySelector<HTMLDetailsElement>('.wf-validation');if(details){details.open=true;details.scrollIntoView({block:'nearest'});details.querySelector('summary')?.focus();}}
 function showRegistry(){const details=editorRoot.current?.querySelector<HTMLDetailsElement>('.wf-manifest');if(details){details.open=true;details.querySelector('summary')?.focus();}}
 function deleteSelected(){if(!node||nodeType==='approval')return;act(()=>{store.deleteNode(node.id);setSelected(null);});}
 async function runLocal(){const snapshot=store.getSnapshot();tour.command(tour.player.stop);setRunning(true);try{const input=JSON.parse(seed);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Execution seed must be an object');setLocalRun(null);const result=await createWorkflowRunner(g,executionAdapters,{captureData:true}).run(input);if(store.getSnapshot()===snapshot&&currentGraph.current===g){setLocalRun({snapshot,result});if(result.trace.some(t=>t.status==='completed'))setSampleInput(input);setError('');}}catch(e){setError(e instanceof Error?e.message:'Execution refused');}finally{setRunning(false);}}
 function fresh(graph=createEmptyGraph()){if(!confirmReplacement())return;pendingSettings.current.clear();visitedSettings.current.clear();store.newWorkflow(graph);openedGraph.current=store.exportJson();settingsEdited.current=false;revealNodes.current.clear();revealEdges.current.clear();proposedWrapperIds.current.clear();setSelected(null);setSource('');setTarget('');setError('');setSampleInput(undefined);requestAnimationFrame(fitToGraph);}
 const missing=manifest.nodes.flatMap(node=>node.warnings.map(warning=>`${node.label}: ${warning}`));
 const menus:WorkflowAppMenu[]=[
  {id:'file',label:'File',items:[
   {id:'new',label:'New workflow',onSelect:()=>fresh()},
   {id:'import',label:'Import JSON',onSelect:()=>openTransfer('')},
   {id:'export',label:'Export JSON',onSelect:()=>openTransfer(store.exportJson())},
   {id:'download',label:'Download applied JSON',onSelect:download},
  ]},
  {id:'edit',label:'Edit',items:[
   {id:'undo',label:'Undo',disabled:!state.canUndo,onSelect:()=>store.undo()},
   {id:'redo',label:'Redo',disabled:!state.canRedo,onSelect:()=>store.redo()},
   {id:'settings',label:'Extended block controls…',disabled:!node,onSelect:()=>{if(node)openSettings(node.id);}},
   {id:'delete',label:'Delete selected block',disabled:!node||nodeType==='approval',onSelect:deleteSelected},
  ]},
  {id:'view',label:'View',items:[
   {id:'canvas',label:'Canvas view',kind:'radio',checked:view==='canvas',group:'Layout',onSelect:()=>changeView('canvas')},
   {id:'stacked',label:'Stacked view',kind:'radio',checked:view==='stacked',group:'Layout',onSelect:()=>changeView('stacked')},
   {id:'expanded',label:'Expanded blocks',kind:'radio',checked:display==='expanded',group:'Display',onSelect:()=>setDisplay('expanded')},
   {id:'compact',label:'Compact blocks',kind:'radio',checked:display==='compact',group:'Display',onSelect:()=>setDisplay('compact')},
   {id:'zoom-out',label:'Zoom out',disabled:zoom<=.01,group:'Zoom',onSelect:()=>setZoom(z=>Math.max(.01,z-.1))},
   {id:'zoom-reset',label:'Reset zoom to 100 percent',group:'Zoom',onSelect:()=>setZoom(1)},
   {id:'zoom-in',label:'Zoom in',disabled:zoom>=1.5,group:'Zoom',onSelect:()=>setZoom(z=>Math.min(1.5,z+.1))},
   {id:'fit',label:view==='stacked'?'Fit stacked workflow width':'Fit to graph',disabled:!active,group:'Zoom',onSelect:fitToGraph},
   {id:'palette',label:'Block palette',kind:'checkbox',checked:paletteOpen,group:'Panels',onSelect:()=>setPaletteOpen(v=>!v)},
   {id:'inspector',label:'Toggle node inspector',kind:'checkbox',checked:inspectorOpen,group:'Panels',onSelect:()=>setInspectorOpen(v=>!v)},
  ]},
  {id:'insert',label:'Insert',items:[
   {id:'blocks',label:'Add or search blocks',onSelect:()=>setPaletteOpen(true)},
   {id:'wrapper',label:'Review reusable block…',onSelect:openCustom},
  ]},
  {id:'run',label:'Run',items:[
   {id:'local',label:running?'Running…':'Run locally',disabled:running||!g.nodes.length,onSelect:runLocal},
   {id:'input',label:'Execution input and trace',onSelect:showExecutionInput},
   {id:'validation',label:'Validation warnings',onSelect:showValidation},
  ]},
  {id:'help',label:'Help',items:[
   {id:'explain',label:'Explain workflow',disabled:!g.nodes.length,onSelect:tour.show},
   {id:'registry',label:'Block registry',onSelect:showRegistry},
  ]},
 ];
 return <section ref={editorRoot} className="wf-editor" style={{'--wf-assembly-duration':`${Math.min(210,2000/Math.max(1,tour.plan.creationGroups.length)-8)}ms`,'--wf-assembly-state':tour.state.playing?'running':'paused'} as CSSProperties} data-workflow-view={view} data-presentation-motion={tour.motionEnabled?'on':'off'} aria-label="Workflow graph editor"><style>{WORKFLOW_CSS}</style>
  <WorkflowMenuBar menus={menus} active={active&&!settingsOpen&&!custom&&!transfer&&!fragmentSession}/>
  <header className="wf-header wf-toolbar" aria-label="Workflow workspace"><label className="wf-name"><span className="wf-workspace-type" aria-hidden="true">WORKFLOW / DESIGN</span><span className="wf-sr-only">Workflow name</span><input aria-label="Workflow name" value={g.name} onChange={e=>act(()=>store.rename(e.target.value))}/></label><span className="wf-draft">Draft · not deployed</span><button className="wf-run-action" title="Execute this in-memory graph locally, not a saved workspace revision" disabled={running||g.nodes.length===0} onClick={runLocal}>{running?'Running…':'Run locally'}</button></header>
  {error&&<div role="alert" className="wf-error">{error}</div>}
  {resourceNotice&&g.nodes.some(n=>n.id===resourceNotice&&n.type==='resource')&&!g.edges.some(e=>e.target===resourceNotice)&&<p role="status">Resource reference added without connections. Connect this block before execution and review its literal Inputs. Nothing was executed; the server rechecks active revision, function and project authority at execution.</p>}
  <div className={`wf-body ${paletteOpen?'has-palette':''} ${inspectorOpen?'has-inspector':''}`}><aside id="workflow-palette" hidden={!paletteOpen} className="wf-palette" aria-label="Block palette">
   <BlockComposer graph={g} entries={paletteEntries(g,category,search)} categories={PALETTE_CATEGORIES.map(label=>({label,count:paletteEntries(g,label).length}))} category={category} search={search} onCategory={setCategory} onSearch={setSearch} onAdd={type=>act(()=>setSelected(store.addNode(type)))} onDragStart={(event,type)=>{paletteDrag.current=type;event.dataTransfer.setData(PALETTE_DRAG_MIME,type);event.dataTransfer.effectAllowed='copy';}} onDragEnd={()=>{paletteDrag.current=null;}} onCustom={openCustom} onClose={()=>{setPaletteOpen(false);canvasViewport.current?.closest('.wf-editor')?.querySelector<HTMLButtonElement>('[aria-label="Insert menu"]')?.focus({preventScroll:true});}} canRequest={!!onRequestBlock} templates={(['approval','branch','http'] as const).map(kind=><button key={kind} onClick={()=>fresh(createWorkflowTemplate(kind))}>{kind==='approval'?'Human review':kind==='branch'?'Condition routing':'HTTP connector'} template</button>)}/>
  </aside>
  <div className="wf-main"><div className="wf-canvasbar"><strong className="wf-sr-only">Workflow canvas</strong><span className="wf-graph-count">{g.nodes.length} blocks · {g.edges.length} connections · {missing.length?`${missing.length} configuration warnings`:'Structure valid'}</span><BuildManifest manifest={manifest} proposedWrapperIds={proposedWrapperIds.current} onOpenNode={openSettings}/><span className="wf-view-summary" aria-label="Workflow view status" title="Change layout in the View menu: Canvas / Stacked (Vertical)">{view==='stacked'?'Stacked (Vertical)':'Canvas'} · {display} · {Math.round(zoom*100)}% · View menu</span></div>
   <div className={`wf-presentation ${tour.open?'has-walkthrough':''}`}><div className="wf-canvas-region"><CreationReplay tour={tour}/><div ref={canvasViewport} className="wf-scroll" tabIndex={0} role="region" aria-label={view==='stacked'?'Scrollable stacked workflow':'Scrollable workflow canvas'} onDragOver={e=>{if(paletteDrag.current&&Array.from(e.dataTransfer.types).includes(PALETTE_DRAG_MIME)){e.preventDefault();e.dataTransfer.dropEffect='copy';}}} onDrop={e=>{
 const type=paletteDropType(e.dataTransfer.getData(PALETTE_DRAG_MIME),paletteDrag.current,g);paletteDrag.current=null;
 if(!type)return;e.preventDefault();
 if(view==='stacked'){act(()=>setSelected(store.addNode(type)));return;}
 const viewport=e.currentTarget;const rect=viewport.getBoundingClientRect();
 const position=canvasDropPosition({x:e.clientX,y:e.clientY},{left:rect.left+viewport.clientLeft,top:rect.top+viewport.clientTop,width:viewport.clientWidth,height:viewport.clientHeight},viewport.scrollLeft,viewport.scrollTop,zoom);
 if(position)act(()=>setSelected(store.addNode(type,position)));
 }}><div className="wf-canvas" style={{width:drawingWidth*zoom,height:drawingHeight*zoom,minWidth:view==='stacked'?'100%':undefined}}><div className="wf-stage" style={{transform:`scale(${zoom})`,width:drawingWidth,left:view==='stacked'?'50%':undefined,marginLeft:view==='stacked'?-drawingWidth*zoom/2:undefined}}>
    <svg className="wf-edges" width={drawingWidth} height={drawingHeight} aria-label="Graph connections">{view==='stacked'&&<defs><marker id={`wf-stack-arrow-${tour.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path className="wf-stack-arrow" d="M0,0 L7,3.5 L0,7 Z"/></marker></defs>}{g.edges.map((e,index)=>{const a=g.nodes.find(n=>n.id===e.source)!,b=g.nodes.find(n=>n.id===e.target)!,vertical=stackEdges.get(e.id);const ax=(drag?.id===a.id?drag.x:a.position.x)+layout.width,ay=(drag?.id===a.id?drag.y:a.position.y)+layout.anchorY,bx=drag?.id===b.id?drag.x:b.position.x,by=(drag?.id===b.id?drag.y:b.position.y)+layout.anchorY;return <g key={e.id} data-explanation-route={tour.step?.edgeIds.includes(e.id)||undefined} data-creation-queued={tour.queuedEdges.has(e.id)||undefined} data-creation-current={tour.currentCreationEdges.has(e.id)||undefined}><path key={`${tour.state.creationCycle}:${tour.currentCreationEdges.has(e.id)}`} className={revealEdges.current.has(e.id)?'wf-reveal-edge':undefined} pathLength={1} style={{animationDelay:tour.currentCreationEdges.has(e.id)?'0ms':`${Math.min(index,8)*20}ms`}} onAnimationEnd={()=>revealEdges.current.delete(e.id)} markerEnd={vertical?`url(#wf-stack-arrow-${tour.id})`:undefined} d={vertical?.path??connectionPath(drag?.id===a.id?drag:a.position,drag?.id===b.id?drag:b.position,display)} /><text x={vertical?.labelX??(ax+bx)/2} y={vertical?.labelY??(ay+by)/2-8}>{vertical?vertical.label:e.sourcePort==='default'?'':e.sourcePort}</text></g>;})}</svg>
    {g.nodes.length===0&&<div className="wf-empty"><h3>No blocks yet</h3><p>Add a manual trigger from the palette, or open a template.</p><button onClick={()=>act(()=>setSelected(store.addNode('manual')))}>Add manual trigger</button></div>}
    {g.nodes.map((n,index)=>{const type=resolveNode(g,n).type,entry=manifest.nodes[index]!,stackNode=stackNodes.get(n.id),phase=tour.queuedNodes.has(n.id)?'queued':tour.currentCreation.has(n.id)?'arriving':'locked';return <article key={n.id} data-visual-assembly={tour.state.mode==='creation'||undefined} data-creation-queued={tour.queuedNodes.has(n.id)||undefined} data-creation-current={tour.currentCreation.has(n.id)||undefined} data-explanation-current={tour.step?.nodeId===n.id||undefined} aria-describedby={tour.step?.nodeId===n.id?`${tour.id}-step`:undefined} data-family={entry.family} data-config-warning={entry.warnings.length>0||undefined} onClick={e=>{if(e.target instanceof Element&&!e.target.closest('button,a,input,select,textarea,summary,[role="button"]'))selectNode(n.id);}} onDoubleClick={e=>{const control=e.target instanceof Element?e.target.closest('button,a,input,select,textarea,summary,[role="button"]'):null;if(control&&!control.classList.contains('wf-node-head'))return;e.currentTarget.querySelector<HTMLButtonElement>(".wf-node-head")?.focus({preventScroll:true});openSettings(n.id);}} title="Double-click to open block settings" className={`wf-node ${view==='stacked'?'is-stacked':''} ${display==='compact'?'is-compact':''} ${selected===n.id?'is-selected':''} ${source===n.id?'is-source':''}`} style={{width:layout.width,height:layout.height,left:stackNode?.x??(drag?.id===n.id?drag.x:n.position.x),top:stackNode?.y??(drag?.id===n.id?drag.y:n.position.y)}}>
     <div className="wf-node-assembly" data-creation-queued={tour.queuedNodes.has(n.id)||undefined} data-creation-current={tour.currentCreation.has(n.id)||undefined}><AssemblyPlate key={`${tour.state.creationCycle}:${phase}`} phase={phase} playing={tour.state.playing} durationMs={Math.min(210,2000/Math.max(1,tour.plan.creationGroups.length)-8)}/><div className={`wf-node-content${revealNodes.current.has(n.id)?' wf-reveal-node':''}`} style={{animationDelay:`${Math.min(index,8)*20}ms`}} onAnimationEnd={()=>revealNodes.current.delete(n.id)}><button className="wf-node-head" aria-describedby={run?`${tour.id}-local-${n.id}`:undefined} aria-label={`${view==='stacked'?'Select':'Select and drag'} ${n.label}`} onClick={()=>selectNode(n.id)} onPointerDown={e=>{if(view==='stacked'||e.button!==0)return;tour.interrupt();setSelected(n.id);e.currentTarget.setPointerCapture(e.pointerId);dragRef.current={id:n.id,startX:e.clientX,startY:e.clientY,originX:n.position.x,originY:n.position.y,pointerId:e.pointerId};}} onPointerMove={e=>{const d=dragRef.current;if(d?.id===n.id)setDrag({id:n.id,x:Math.max(0,Math.min(10000,d.originX+(e.clientX-d.startX)/zoom)),y:Math.max(0,Math.min(10000,d.originY+(e.clientY-d.startY)/zoom))});}} onPointerUp={e=>{const d=dragRef.current;if(d?.id===n.id){const x=Math.max(0,Math.min(10000,d.originX+(e.clientX-d.startX)/zoom)),y=Math.max(0,Math.min(10000,d.originY+(e.clientY-d.startY)/zoom));if(x!==d.originX||y!==d.originY)act(()=>store.updateNode(n.id,{position:{x,y}}));dragRef.current=null;setDrag(null);}}} onPointerCancel={()=>{dragRef.current=null;setDrag(null);}}><span className="wf-node-type"><span className="wf-node-glyph" aria-hidden="true">{BLOCK_GLYPH[type]}</span><code>{n.type}</code><span className="wf-node-origin" title={entry.kind==='wrapper'?'Reusable wrapper · graph declaration, not authorization':'Existing registry block'}>{entry.kind==='wrapper'?'Reusable wrapper':'Existing block'}</span></span><strong className="wf-node-title"><span className="wf-node-label" title={n.label}>{n.label}</span><NodeRunStatus id={`${tour.id}-local-${n.id}`} nodeId={n.id} run={run}/></strong></button>
     <div className="wf-node-meta" title={entry.configSummary}>{entry.warnings.length>0&&<span className="wf-node-warning" title={entry.warnings.join(' · ')}>! </span>}{entry.configSummary}</div><div className="wf-ports"><button title="Connect selected source to this input" aria-label={`Input port ${n.label}`} onClick={()=>{setTarget(n.id);if(source)connect(source,n.id);}}>JSON in</button>{(type==='branch'?['true','false']:['default']).map(p=><button key={p} aria-label={`Output ${p} port ${n.label}`} onClick={()=>{setSource(n.id);setPort(p as typeof port);setSelected(n.id);}}>{p==='default'?'JSON out':`out ${p}`}</button>)}</div>
    </div></div></article>;})}
   </div></div></div>{view==='stacked'&&<span className="wf-stack-note">Auto layout · scroll to explore · double-click for settings</span>}</div><WalkthroughPanel tour={tour} onOpenNode={openSettings}/></div>
   <details className="wf-connection-tools"><summary>Connect blocks</summary><div className="wf-connect"><label>Source<select aria-label="Connection source" value={source} onChange={e=>{setSource(e.target.value);const n=g.nodes.find(n=>n.id===e.target.value);setPort(n&&resolveNode(g,n).type==='branch'?'true':'default');}}><option value="">Choose block</option>{g.nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></label><label>Port<select aria-label="Connection port" value={port} onChange={e=>setPort(e.target.value as typeof port)}><option>default</option><option>true</option><option>false</option></select></label><label>Target<select aria-label="Connection target" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose block</option>{g.nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></label><button disabled={!source||!target} onClick={()=>connect()}>Connect blocks</button></div></details>
   <details className="wf-validation"><summary>Validation · {missing.length?`${missing.length} configuration warnings`:'structure valid'}</summary><div role="status"><strong>Graph valid · DAG v1</strong>{missing.length?<ul>{missing.map(m=><li key={m}>{m}</li>)}</ul>:<p>Draft structure is valid. Local run requires a manual root, output and configured adapters.</p>}<p>Connectors are not deployed. Human gates pause and cannot be approved by this editor.</p></div></details>
   <details className="wf-run"><summary>Local execution input &amp; trace</summary><p>Safe local data only — never secrets. Local runs capture per-node input/output for the debugger. Connectors and models are not called unless trusted adapters are configured.</p><label>Input JSON<textarea ref={executionInput} aria-label="Local input JSON" value={seed} onChange={e=>setSeed(e.target.value)}/></label>{run&&<><strong>{run.status.toUpperCase()}</strong>{run.reason&&<p>{run.reason}</p>}{run.pendingNodeId&&<p>Awaiting externally authenticated independent human for {run.pendingNodeId}. This browser cannot authorize it.</p>}<ol>{run.trace.map((t,i)=><li key={i}>{t.nodeId} · {t.status}{t.message&&` · ${t.message}`}</li>)}</ol>{run.status==='completed'&&<pre>{JSON.stringify(run.output,null,2)}</pre>}</>}</details>
  </div>
  <dialog id="workflow-inspector" hidden={!inspectorOpen&&!settingsOpen} ref={settingsDialog} className="wf-settings-dialog" role={settingsOpen?'dialog':'region'} aria-label={settingsOpen?'Block settings':'Block settings panel'} aria-modal={settingsOpen?true:undefined} onKeyDown={event=>{
   const dialog=event.currentTarget;if(!active||!dialog.open||event.key!=='Tab')return;
   const controls=[...dialog.querySelectorAll<HTMLElement>('button,input,textarea,select,summary,[tabindex]')].filter(element=>element.tabIndex>=0&&!element.matches(':disabled')&&element.getClientRects().length>0&&!element.closest('[hidden],[inert]')&&!['hidden','collapse'].includes(getComputedStyle(element).visibility));
   if(!controls.length){event.preventDefault();return;}
   const first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }} onCancel={()=>setSettingsOpen(false)} onClose={()=>setSettingsOpen(false)} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setSettingsOpen(false);}}}>
  {settingsOpen&&<header className="wf-settings-header"><div><span className="wf-kicker">BLOCK SETTINGS</span><h2>{node?.label}</h2></div><button type="button" aria-label="Close block settings" onClick={()=>setSettingsOpen(false)}>Close ×</button></header>}
  <aside className="wf-inspector" onInputCapture={()=>{settingsEdited.current=true;}} aria-label="Node inspector"><div className="wf-quick-header" hidden={settingsOpen}><strong>Quick controls</strong><button aria-label="Close quick controls" onClick={()=>{setInspectorOpen(false);requestAnimationFrame(()=>{if(editorActive.current)editorRoot.current?.querySelector<HTMLButtonElement>('.wf-node.is-selected .wf-node-head')?.focus({preventScroll:true});});}}>×</button></div><h3 hidden={!settingsOpen}>Full block controls</h3>{settingsNodes.map(item=><div key={item.id} hidden={item.id!==selected}><NodeSettings level={settingsOpen?'extended':'quick'} onOpenExtended={()=>openSettings(item.id)} onOpenExecutionInput={showExecutionInput} graph={g} node={item} onDraftChange={()=>{settingsEdited.current=true;}} onPendingChange={(part,dirty)=>{const key=`${item.id}:${part}`;if(dirty)pendingSettings.current.add(key);else pendingSettings.current.delete(key);}} hint={describeConfig(resolveNode(g,item).type)} run={run} sampleInput={sampleInput} update={patch=>act(()=>store.updateNode(item.id,patch))}/></div>)}{!node&&<p>Select a block to edit its saved configuration.</p>}{fragmentGuard&&<p role="alert" className="wf-error">{fragmentGuard}</p>}{node?.type==='unconfigured'&&<button onClick={openFragment}>Compose fragment</button>}<div className="wf-extended-graph" hidden={!settingsOpen}>{node&&<button className="wf-danger" disabled={nodeType==='approval'} onClick={()=>act(()=>{store.deleteNode(node.id);setSelected(null);})}>Delete node</button>}{nodeType==='approval'&&<p>Required human gate. Cannot remove or replace this node. Undo can retract your most recent draft addition.</p>}<h4>Connections</h4>{g.edges.length===0?<p>No connections yet.</p>:g.edges.map(e=><div className="wf-edge-row" key={e.id}><code>{g.nodes.find(n=>n.id===e.source)?.label} → {g.nodes.find(n=>n.id===e.target)?.label}{e.sourcePort&&` (${e.sourcePort})`}</code><button aria-label={`Delete connection ${e.id}`} onClick={()=>act(()=>store.deleteEdge(e.id))}>Remove</button></div>)}</div></aside></dialog>
  </div>
  {transfer&&<section className="wf-panel" aria-label="Draft JSON transfer"><h3>Import / export draft JSON</h3><p>Graph configs are exported as entered. Never store secrets in this draft. Import is strictly validated and cannot remove existing approval gates.</p><textarea ref={transferField} aria-label="Draft JSON" value={json} onChange={e=>setJson(e.target.value)}/><div><button onClick={()=>act(()=>{if(!confirmReplacement())return;store.importJson(json);pendingSettings.current.clear();visitedSettings.current.clear();settingsEdited.current=false;revealNodes.current.clear();revealEdges.current.clear();proposedWrapperIds.current.clear();closeTransfer();setSelected(null);setSampleInput(undefined);requestAnimationFrame(fitToGraph);})}>Apply imported draft</button><button onClick={download}>Download JSON</button><button onClick={closeTransfer}>Close</button></div></section>}
  {fragmentSession&&<WorkflowFragmentReview store={store} session={fragmentSession} active={active} onClose={()=>setFragmentSession(null)} onApplied={()=>{setFragmentSession(null);setSelected(null);setSettingsOpen(false);setSource('');setTarget('');setSampleInput(undefined);requestAnimationFrame(fitToGraph);}}/>}
  {custom&&<WrapperReview text={customText} prompt={blockPrompt} reviewed={reviewed} requesting={requesting} canRequest={!!onRequestBlock} error={error} onText={value=>{setCustomText(value);setReviewed(false);}} onPrompt={value=>{setBlockPrompt(value);setReviewed(false);}} onReviewed={setReviewed} onRequest={()=>void requestBlock()} onAdd={()=>act(()=>{store.addCustomBlock(customBlockSchema.parse(JSON.parse(customText)),reviewed);closeCustom();})} onClose={closeCustom}/>}
 </section>;
}
export function NodeSettings({graph,node,hint,update,run=null,sampleInput,onDraftChange,onPendingChange,level='extended',onOpenExtended,onOpenExecutionInput}:{graph:Graph;node:GraphNode;hint:string;onDraftChange?:()=>void;onPendingChange?:(part:'parameters'|'inputs',dirty:boolean)=>void;level?:'quick'|'extended';onOpenExtended?:()=>void;onOpenExecutionInput?:()=>void;
 update:(patch:Partial<GraphNode>)=>SaveOutcome;run?:RunResult|null;sampleInput?:Json|undefined}) {
 const [tab,setTab]=useState('Parameters');
 const quick=level==='quick',effective=resolveNode(graph,node),profile=blockControlProfile(effective.type);
 function dirty(part:'parameters'|'inputs'){onDraftChange?.();onPendingChange?.(part,true);}
 function save(part:'parameters'|'inputs',patch:Partial<GraphNode>){const result=update(patch);if(result.ok)onPendingChange?.(part,false);return result;}
 const configRevision=JSON.stringify([node.config,graph.customBlocks.find(b=>b.id===node.type)?.defaults]),mappingRevision=JSON.stringify(node.inputMappings);
 useEffect(()=>{onPendingChange?.('parameters',false);},[configRevision]);
 useEffect(()=>{onPendingChange?.('inputs',false);},[mappingRevision]);
 useEffect(()=>()=>{onPendingChange?.('parameters',false);onPendingChange?.('inputs',false);},[]);
 const tabs=['Inputs','Parameters','Results'];
 const outputs=(run?.trace??[]).flatMap(t=>{const details=localDetails(t);return t.status==='completed'&&details&&Object.hasOwn(details,'output')?[{nodeId:t.nodeId,output:details.output!}]:[];});
 return <section className="wf-node-settings" data-control-level={level} data-block-type={effective.type} aria-label={quick?'Quick block controls':'Extended block controls'}>
  <header className="wf-block-purpose"><span className="wf-kicker">{quick?'QUICK CONTROLS':'EXTENDED CONTROLS'} · {profile.title}</span><h4>{node.label}</h4><p>{profile.purpose}</p>{node.type!==effective.type&&<p>Reusable wrapper · {effective.type} behavior with reviewed defaults.</p>}</header>
  {effective.type==='manual'&&onOpenExecutionInput&&<button className="wf-manual-input-action" hidden={!quick} onClick={onOpenExecutionInput}>Edit local execution input</button>}
  <div className="wf-tabs" hidden={quick} role="tablist" aria-label="Node settings sections">{tabs.map(name=><button key={name} type="button" role="tab" id={`${node.id}-tab-${name}`} aria-controls={`${node.id}-panel-${name}`} aria-selected={tab===name} tabIndex={tab===name?0:-1} onClick={()=>setTab(name)} onKeyDown={e=>{let index=tabs.indexOf(name);if(e.key==='ArrowRight')index=(index+1)%tabs.length;else if(e.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else return;e.preventDefault();const next=tabs[index]!;setTab(next);e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[id="${node.id}-tab-${next}"]`)?.focus();}}>{name}</button>)}</div>
  <section role="tabpanel" id={`${node.id}-panel-Inputs`} aria-labelledby={`${node.id}-tab-Inputs`} hidden={quick||tab!=='Inputs'}>
   {effective.type==='manual'&&<section className="wf-trigger-inputs" aria-label="Trigger execution input"><p>The trigger starts with the original execution seed. Transform data with Set fields or a downstream input mapping; a trigger mapping does not replace its output.</p>{onOpenExecutionInput&&<button onClick={onOpenExecutionInput}>Edit local execution input</button>}{node.inputMappings!==undefined&&<button onClick={()=>save('inputs',{inputMappings:undefined})}>Clear legacy trigger mappings</button>}</section>}
   <div className="wf-node-input-mapper" hidden={effective.type==='manual'}><NodeInputMapper graph={graph} node={node} onDraftChange={()=>dirty('inputs')} sampleInput={sampleInput} outputs={outputs} update={inputMappings=>save('inputs',{inputMappings})}/></div>
  </section>
  <section role={quick?undefined:'tabpanel'} id={`${node.id}-panel-Parameters`} aria-labelledby={quick?undefined:`${node.id}-tab-Parameters`} hidden={!quick&&tab!=='Parameters'}>
   <NodeParameters graph={graph} node={node} level={level} onDraftChange={()=>dirty('parameters')} update={config=>save('parameters',{config})}/>
   <details className="wf-node-identity" hidden={quick}><summary>Block identity and position</summary><code>{node.id} / {node.type}</code><label>Label<input aria-label="Node label" value={node.label} onChange={event=>update({label:event.target.value})}/></label><div className="wf-position">{(['x','y'] as const).map(axis=><label key={axis}>{axis.toUpperCase()}<input aria-label={`Node ${axis} position`} type="number" min="0" max="10000" value={Math.round(node.position[axis])} onChange={event=>update({position:{...node.position,[axis]:Number(event.target.value)}})}/></label>)}</div><p>{hint}</p></details>
  </section><section role="tabpanel" id={`${node.id}-panel-Results`} aria-labelledby={`${node.id}-tab-Results`} hidden={quick||tab!=='Results'}><NodeRunResults nodeId={node.id} run={run}/></section>
  {onOpenExtended&&<button className="wf-extended-action" aria-label="Open block settings" hidden={!quick} onClick={onOpenExtended}>Extended controls…</button>}
  <p className="wf-block-boundary">{profile.boundary}</p>
 </section>;
}
