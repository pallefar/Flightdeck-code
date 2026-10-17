import {builtinRegistry,resolveNode,type BuiltinType,type Graph,type Json} from '../../packages/workflow/graph';
import {workflowBuildManifest} from './build-manifest';

export interface WalkthroughStep {
 nodeId:string;type:BuiltinType;title:string;explanation:string;tip:string;
 edgeIds:string[];mappings:string[];narration:string;reachable:boolean;
}
const boundary='Design walkthrough · not an execution' as const;
const baseExplanation:Record<BuiltinType,string>={
 manual:'Starts a real run with the original execution input. No input is supplied by this walkthrough.',
 http:'Requires a configured trusted adapter; it is not called by the walkthrough. The actual adapter result would become this step’s output.',
 resource:'Requires a configured trusted adapter; it is not called by the walkthrough. A resource reference alone does not grant access.',
 llm:'Requires a configured trusted adapter; it is not called by the walkthrough. No model response is invented.',
 set:'Configured fields merge into the incoming object. No values are calculated by this explanation.',
 branch:'A real run follows the selected output port. This explanation shows both true and false as alternatives; it does not select a route.',
 approval:'Independent human pause; authorization is not granted by this walkthrough. The real engine pauses for a separately authenticated human.',
 output:'Returns incoming data after any explicit input mappings. No invented result or transformed preview is shown.',
 unconfigured:'This placeholder blocks execution. Its description is an intent, not an implemented capability.',
};
const baseTip:Record<BuiltinType,string>={
 manual:'A real run requires one manual root, no incoming trigger connection, connected non-root nodes and an output.',
 http:'Review the destination policy and vault reference in trusted configuration. No inline credentials; an editor setting is not adapter authorization.',
 resource:'The trusted adapter checks the active revision, function and project authority again at execution. Review parameter mappings; a reference is not activation.',
 llm:'This is not an autonomous tool runner. Review the instruction and destination privately before a separately requested real run.',
 set:'Use object input. Configured fields overwrite matching incoming keys; this is a shallow merge, not executable code.',
 branch:'The condition reads one top-level field. Equals compares ordered JSON values; exists checks whether the field is defined. Both ports here are alternatives, not observed outcomes.',
 approval:'This editor cannot approve the gate. The actual reviewer must be independent of the initiator and authorized by the trusted verifier. Gate bypasses block the whole run.',
 output:'Keep outputs terminal. The last actually visited output sets the returned result; this tour does not predict which conditional output is visited.',
 unconfigured:'Configure or replace the placeholder with a supported block before running.',
};
function mappingDescriptions(node:Graph['nodes'][number]):string[]{
 if(node.inputMappings===undefined)return ['No mapping override · incoming data is retained'];
 if(node.inputMappings.length===0)return ['Explicit empty mappings replace input with an empty object'];
 return node.inputMappings.map(({source})=>{
  if(source.kind==='literal')return `Literal · ${source.value===null?'null':Array.isArray(source.value)?'array':typeof source.value} · value omitted`;
  const shape=source.path.length?`path with ${source.path.length} segment${source.path.length===1?'':'s'}`:'whole value';
  return `${source.kind==='input'?'Original execution input':'Ancestor output'} · ${shape}`;
 });
}
/** Pure, privacy-bounded explanation. No runner, adapter, graph mutation or seed inference. */
export function createWalkthrough(graph:Graph) {
 const done=new Set<string>(),ordered:Graph['nodes']=[];
 // Same dependency-ready rounds as the engine. Node array order breaks ties only.
 while(ordered.length<graph.nodes.length){
  const ready=graph.nodes.filter(node=>!done.has(node.id)&&graph.edges.filter(edge=>edge.target===node.id).every(edge=>done.has(edge.source)));
  if(!ready.length)break;
  for(const node of ready){ordered.push(node);done.add(node.id);}
 }
 const manual=graph.nodes.filter(node=>resolveNode(graph,node).type==='manual');
 const reach=(start:string,exclude?:string)=>{
  const found=new Set<string>(),pending=[start];
  while(pending.length){const id=pending.pop()!;if(id===exclude||found.has(id))continue;found.add(id);pending.push(...graph.edges.filter(edge=>edge.source===id).map(edge=>edge.target));}
  return found;
 };
 const reachable=new Set(manual.flatMap(node=>[...reach(node.id)]));
 const outputs=graph.nodes.filter(node=>resolveNode(graph,node).type==='output');
 const notices:string[]=[];
 if(manual.length!==1||graph.edges.some(edge=>manual.some(node=>node.id===edge.target))||graph.nodes.some(node=>!manual.some(root=>root.id===node.id)&&!graph.edges.some(edge=>edge.target===node.id))||!outputs.length)notices.push('Real execution requires exactly one manual root, no incoming trigger edge, all non-root nodes connected, and at least one output. This explanation also includes disconnected design parts.');
 if(outputs.some(node=>graph.edges.some(edge=>edge.source===node.id)))notices.push('Real execution requires every output to be terminal.');
 if(manual.length===1&&graph.nodes.some(node=>resolveNode(graph,node).type==='approval'&&outputs.some(output=>reach(manual[0]!.id,node.id).has(output.id))))notices.push('A path can bypass required independent human approval; the real engine blocks this graph.');
 const manifest=workflowBuildManifest(graph);
 const steps:WalkthroughStep[]=ordered.map((node,index)=>{
  const {type,config}=resolveNode(graph,node),wrapper=graph.customBlocks.find(block=>block.id===node.type);
  const title=`Step ${index+1} · ${builtinRegistry.find(entry=>entry.type===type)!.label}`;
  let explanation=baseExplanation[type],tip=baseTip[type];
  if(type==='branch')explanation+=config.operator==='exists'?' It tests whether the configured top-level field exists.':' It compares the configured top-level field with the configured value using ordered JSON equality.';
  if(type==='set')explanation=`${Object.keys(config.fields as Record<string,Json>).length} configured fields merge into the incoming object. No values are calculated by this explanation.`;
  if(wrapper)explanation=`Reusable wrapper of ${type}, using effective defaults and node overrides. ${explanation}`;
  if(!reachable.has(node.id))explanation=`Not reachable from a manual trigger in this design. ${explanation}`;
  if(graph.edges.filter(edge=>edge.target===node.id).length>1)tip+=' A join can proceed with one active input; multiple active inputs block in v1, and no active input means the node is skipped. This is not a merge block.';
  if(node.inputMappings?.length)tip+=' Explicit mappings replace incoming data; missing paths or skipped ancestor sources block rather than fall back.';
  const warningCount=manifest.nodes.find(entry=>entry.id===node.id)?.warnings.length??0;
  if(warningCount)tip+=` ${warningCount} configuration warning${warningCount===1?'':'s'} in the registry manifest; review settings before running.`;
  const mappings=mappingDescriptions(node);
  return {nodeId:node.id,type,title,explanation,tip,mappings,reachable:reachable.has(node.id),edgeIds:graph.edges.filter(edge=>edge.source===node.id||edge.target===node.id).map(edge=>edge.id),narration:`${title}. ${boundary}. ${explanation} Tip: ${tip}`};
 });
 const creationGroups:Array<{nodeIds:string[];edgeIds:string[]}>=[],size=Math.max(1,Math.ceil(steps.length/12));
 for(let index=0;index<steps.length;index+=size){
  const nodeIds=steps.slice(index,index+size).map(step=>step.nodeId);
  creationGroups.push({nodeIds,edgeIds:graph.edges.filter(edge=>nodeIds.includes(edge.target)).map(edge=>edge.id)});
 }
 return {boundary,steps,counts:manifest.counts,notices,creationGroups};
}
export type WalkthroughPlan=ReturnType<typeof createWalkthrough>;
