import {createEmptyGraph,graphSchema,builtinRegistry,customBlockSchema,resolveNode,type Graph,type GraphNode,type CustomBlock} from '../../packages/workflow/graph';
import type {ResourceSelection} from '../../packages/resources/contract';
import {configSchemas,jsonValue} from '../../packages/workflow/graph';
import {boundedJson} from '../../packages/workflow/data';
import {composeWorkflowFragment,WORKFLOW_COMPOSITION_LIMITS,type ComposedWorkflow} from '../../packages/workflow/composition';
/** Optional trusted application binding only; never read from fragment JSON. */
export interface FragmentProtection {readonly protectedSteps?:readonly string[];readonly protectedGates?:readonly string[]}
/** Opaque store-local review identity. Neither a grant nor an approval receipt. */
export interface FragmentReviewSession {readonly slotId:string}
interface FragmentReviewState {snapshot:string;revision:number;prepared?:ComposedWorkflow}

export interface EditorSnapshot {graph:Graph;canUndo:boolean;canRedo:boolean}
export class WorkflowEditorStore {
 private past:Graph[]=[];private future:Graph[]=[];private listeners=new Set<()=>void>();private state:EditorSnapshot;
 private readonly fragmentProtection:FragmentProtection;
 constructor(g:Graph=createEmptyGraph(),protection:FragmentProtection={}){this.state={graph:graphSchema.parse(g),canUndo:false,canRedo:false};this.fragmentProtection=structuredClone(protection);}
 private revision=0;
 private fragmentReviews=new WeakMap<FragmentReviewSession,FragmentReviewState>();
 beginFragmentReview(slotId:string):FragmentReviewSession {
  const g=this.state.graph;
  if(g.nodes.find(n=>n.id===slotId)?.type!=='unconfigured'||g.edges.filter(e=>e.target===slotId).length!==1||g.edges.filter(e=>e.source===slotId).length!==1||this.fragmentProtection.protectedSteps?.includes(slotId)||this.fragmentProtection.protectedGates?.includes(slotId))throw new Error('Eligible unprotected single-in/single-out draft slot required');
  const session=Object.freeze({slotId});
  this.fragmentReviews.set(session,{snapshot:this.exportJson(),revision:this.revision});return session;
 }
 previewFragment(session:FragmentReviewSession,draft:unknown):ComposedWorkflow {
  const review=this.currentFragmentReview(session);
  delete review.prepared;
  if(!boundedJson(draft,WORKFLOW_COMPOSITION_LIMITS.maxBytes,WORKFLOW_COMPOSITION_LIMITS.maxDepth,WORKFLOW_COMPOSITION_LIMITS.maxValues)||!draft||typeof draft!=='object'||Array.isArray(draft)||Object.keys(draft).some(k=>!['namespace','fragment'].includes(k)))throw new Error('Invalid bounded fragment JSON');
  const value=draft as {namespace:string;fragment:unknown};
  // Use the exact exported native snapshot, including object/array order. Internal
  // optional undefined form fields have no JSON representation, just as in Export.
  const result=composeWorkflowFragment({graph:JSON.parse(review.snapshot),slotId:session.slotId,namespace:value.namespace,fragment:value.fragment,...this.fragmentProtection});
  review.prepared=result;return structuredClone(result);
 }
 revokeFragmentPreview(session:FragmentReviewSession):void {const review=this.fragmentReviews.get(session);if(review)delete review.prepared;}
 cancelFragmentReview(session:FragmentReviewSession):void {this.fragmentReviews.delete(session);}
 applyReviewedFragment(session:FragmentReviewSession,reviewed:boolean):void {
  const review=this.currentFragmentReview(session);if(!review.prepared||reviewed!==true)throw new Error('Exact human fragment review required');
  this.commit(review.prepared.graph);this.fragmentReviews.delete(session);
 }
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private currentFragmentReview(session:FragmentReviewSession):FragmentReviewState {
  const review=this.fragmentReviews.get(session);
  if(!review||review.revision!==this.revision||review.snapshot!==this.exportJson())throw new Error('Graph changed or fragment review expired');
  return review;
 }
 private emit(g:Graph){this.revision++;this.state={graph:g,canUndo:!!this.past.length,canRedo:!!this.future.length};this.listeners.forEach(l=>l());}
 private commit(g:Graph){const parsed=graphSchema.parse(g);for(const n of this.state.graph.nodes.filter(n=>resolveNode(this.state.graph,n).type==='approval'))if(!parsed.nodes.some(p=>p.id===n.id&&p.type==='approval'))throw new Error('Required approval nodes cannot be removed or replaced');this.past.push(this.state.graph);if(this.past.length>100)this.past.shift();this.future=[];this.emit(parsed);}
 private nextId(prefix:string){const used=new Set([...this.state.graph.nodes,...this.state.graph.edges,...this.state.graph.customBlocks].map(x=>x.id));let i=1;while(used.has(`${prefix}${i}`))i++;return `${prefix}${i}`;}
 addNode(type:string,placement?:GraphNode['position']):string {const g=this.state.graph;const b=builtinRegistry.find(b=>b.type===type)??g.customBlocks.find(b=>b.id===type);if(!b)throw new Error('Unknown block type');const id=this.nextId('node');this.commit({...g,nodes:[...g.nodes,{id,type,label:b.label,position:placement??{x:80+(g.nodes.length%4)*280,y:100+Math.floor(g.nodes.length/4)*180},config:structuredClone(b.defaults)}]});return id;}
 /** A normal document edit: reference only, no activation authority or implicit edges. */
 addResourceNode(selection:ResourceSelection):string {
  if(!boundedJson(selection,12000)||Object.keys(selection).some(k=>!['resourceId','revision','functionId','parameters'].includes(k)))throw new Error('Invalid resource selection');
  const {resourceId,revision,functionId,parameters}=selection;
  const config=configSchemas.resource.required().parse({resourceId,revision,functionId});
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters)||!boundedJson(parameters,10000))throw new Error('Resource parameters must be a bounded safe JSON object');
  const pending:unknown[]=[parameters];
  while(pending.length){const value=pending.pop();if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){if(/secret|password|token|api.?key|authorization|credential|destination|endpoint|url|command|headers?/i.test(key))throw new Error('Resource parameters contain restricted connection fields');pending.push(child);}}
  const values=jsonValue.parse(parameters) as Record<string,import('../../packages/workflow/graph').Json>;
  const g=this.state.graph,id=this.nextId('node');
  this.commit({...g,nodes:[...g.nodes,{id,type:'resource',label:`Resource: ${functionId}`,position:{x:80+(g.nodes.length%4)*280,y:100+Math.floor(g.nodes.length/4)*180},config,inputMappings:Object.entries(values).map(([target,value])=>({target,source:{kind:'literal' as const,value}}))}]});
  return id;
 }
 connect(source:string,target:string,sourcePort:'default'|'true'|'false'='default'){const g=this.state.graph;if(g.edges.some(e=>e.source===source&&e.target===target&&e.sourcePort===sourcePort))throw new Error('Duplicate connection');this.commit({...g,edges:[...g.edges,{id:this.nextId('edge'),source,target,sourcePort}]});}
 deleteEdge(id:string){this.commit({...this.state.graph,edges:this.state.graph.edges.filter(e=>e.id!==id)});}
 updateNode(id:string,patch:Partial<Omit<GraphNode,'id'>>){const g=this.state.graph;this.commit({...g,nodes:g.nodes.map(n=>n.id===id?{...n,...patch}:n)});}
 rename(name:string){this.commit({...this.state.graph,name});}
 deleteNode(id:string){const g=this.state.graph;if(g.nodes.find(n=>n.id===id)?.type==='approval')throw new Error('Required approval nodes cannot be removed');this.commit({...g,nodes:g.nodes.filter(n=>n.id!==id),edges:g.edges.filter(e=>e.source!==id&&e.target!==id)});}
 undo(){const previous=this.past.pop();if(previous){this.future.push(this.state.graph);this.emit(previous);}}
 redo(){const next=this.future.pop();if(next){this.past.push(this.state.graph);this.emit(next);}}
 exportJson(){return JSON.stringify(this.state.graph,null,2);}
 importJson(text:string){if(text.length>1000000)throw new Error('Draft import too large');this.commit(graphSchema.parse(JSON.parse(text)));}
 addCustomBlock(block:CustomBlock,reviewed:boolean){if(!reviewed)throw new Error('Human review required before adding a custom block');const b=customBlockSchema.parse(block);this.commit({...this.state.graph,customBlocks:[...this.state.graph.customBlocks,b]});}
 /** Explicit new document, not a revision of an existing workflow. */
 newWorkflow(g:Graph=createEmptyGraph()){this.past=[];this.future=[];this.emit(graphSchema.parse(g));}
}
