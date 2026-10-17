import {z} from 'zod';
import {validateGraph, resolveNode, type Graph, type GraphNode} from './graph';
import {boundedJson} from './data';
import {preservesWorkflowSteps} from './preservation';

export const WORKFLOW_COMPOSITION_LIMITS=Object.freeze({
  fragments:1,
  maxBytes:1_000_000,
  maxDepth:24,
  maxValues:20_000,
  maxWidth:100,
  maxNodes:100,
  maxEdges:100,
  maxCustomBlocks:50,
  maxNamespaceLength:32,
});

export interface WorkflowFragmentComposition {
  graph:Graph;
  slotId:string;
  namespace:string;
  fragment:{graph:Graph;entryId:string;exitId:string};
  protectedSteps?:string[];
  protectedGates?:string[];
}
export interface ComposedWorkflow {
  graph:Graph;
  ids:{
    nodes:Record<string,string>;
    edges:Record<string,string>;
    customBlocks:Record<string,string>;
  };
}

const identifier=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const requestSchema=z.object({
  graph:z.unknown(),
  slotId:identifier,
  namespace:identifier.max(WORKFLOW_COMPOSITION_LIMITS.maxNamespaceLength),
  fragment:z.object({graph:z.unknown(),entryId:identifier,exitId:identifier}).strict(),
  protectedSteps:z.array(identifier).max(100).default([]),
  protectedGates:z.array(identifier).max(100).default([]),
}).strict();

function checkNativeJson(value:unknown):void {
  const limits=WORKFLOW_COMPOSITION_LIMITS;
  if(!boundedJson(value,limits.maxBytes,limits.maxDepth,limits.maxValues)){
    throw new Error('Unsafe JSON shape or composition budget exceeded');
  }
  const pending:unknown[]=[value];
  while(pending.length){
    const current=pending.pop();
    if(current===null||typeof current!=='object')continue;
    // boundedJson already rejected accessors, inherited/custom shapes and cycles.
    if(Object.keys(current).length>limits.maxWidth)throw new Error('JSON width budget exceeded');
    pending.push(...Object.values(current));
  }
}

function checkFragmentBoundary(graph:Graph,entryId:string,exitId:string):void {
  const identity=(id:string)=>{
    const node=graph.nodes.find(node=>node.id===id);
    return node?.type==='set'
      &&node.inputMappings===undefined
      &&Object.keys(resolveNode(graph,node).config.fields as object).length===0;
  };
  if(entryId===exitId||!identity(entryId)||!identity(exitId)
    ||graph.edges.some(edge=>edge.target===entryId||edge.source===exitId)
    ||graph.nodes.some(node=>['manual','output'].includes(resolveNode(graph,node).type))){
    throw new Error('Invalid fragment boundary roles');
  }
  const reach=(start:string,reverse:boolean)=>{
    const seen=new Set<string>(),pending=[start];
    while(pending.length){
      const id=pending.pop()!;
      if(seen.has(id))continue;
      seen.add(id);
      for(const edge of graph.edges){
        if((reverse?edge.target:edge.source)===id)pending.push(reverse?edge.source:edge.target);
      }
    }
    return seen;
  };
  if(reach(entryId,false).size!==graph.nodes.length||reach(exitId,true).size!==graph.nodes.length){
    throw new Error('Invalid fragment boundary connectivity');
  }
}

function remapMappings(node:GraphNode,ids:Map<string,string>):GraphNode {
  if(node.inputMappings===undefined)return node;
  return {...node,inputMappings:node.inputMappings.map(mapping=>mapping.source.kind==='node'
    ?{...mapping,source:{...mapping.source,nodeId:ids.get(mapping.source.nodeId)??mapping.source.nodeId}}
    :mapping)};
}

function allocateIds(items:readonly {id:string}[],existing:readonly {id:string}[],prefix:string):Map<string,string> {
  const used=new Set(existing.map(item=>item.id));
  return new Map(items.map((item,index)=>{
    const base=`${prefix}${index}`;
    let candidate=base,suffix=2;
    while(used.has(candidate)){
      const tail=`_${suffix++}`;
      candidate=base.slice(0,64-tail.length)+tail;
    }
    used.add(candidate);
    return [item.id,candidate];
  }));
}

function checkSingleFlow(graph:Graph):void {
  for(const node of graph.nodes){
    const outgoing=graph.edges.filter(edge=>edge.source===node.id);
    const branch=resolveNode(graph,node).type==='branch';
    const ambiguous=branch
      ?outgoing.length!==2||!outgoing.some(edge=>edge.sourcePort==='true')||!outgoing.some(edge=>edge.sourcePort==='false')
      :outgoing.length>1;
    if(ambiguous)throw new Error('Composition requires exclusive single-active flow');
  }
}

/**
 * Pure draft transformation of native JSON snapshots, never execution or authorization.
 * Exactly one explicit unprotected draft slot is replaced per call; no nested node type.
 */
export function composeWorkflowFragment(value:unknown):ComposedWorkflow {
  // This must precede every recursive schema and every read from the request.
  checkNativeJson(value);
  const parsed=requestSchema.safeParse(value);
  if(!parsed.success)throw new Error('Invalid composition request');
  const request=parsed.data;
  const host=validateGraph(request.graph),part=validateGraph(request.fragment.graph);
  if(!host.ok||!part.ok)throw new Error('Invalid graph');
  const g=host.graph,f=part.graph;
  const limits=WORKFLOW_COMPOSITION_LIMITS;
  if(g.nodes.length-1+f.nodes.length>limits.maxNodes
    ||g.edges.length+f.edges.length>limits.maxEdges
    ||g.customBlocks.length+f.customBlocks.length>limits.maxCustomBlocks){
    throw new Error('Expanded composition budget exceeded');
  }
  const slot=g.nodes.find(node=>node.id===request.slotId);
  if(slot?.type!=='unconfigured'
    ||g.edges.filter(edge=>edge.target===request.slotId).length!==1
    ||g.edges.filter(edge=>edge.source===request.slotId).length!==1){
    throw new Error('Replacement requires a single-in/single-out builtin draft slot');
  }
  checkFragmentBoundary(f,request.fragment.entryId,request.fragment.exitId);
  const gates=[...new Set([...request.protectedGates,...g.nodes.filter(node=>node.type==='approval').map(node=>node.id)])];
  if(request.protectedSteps.includes(request.slotId)||!preservesWorkflowSteps(g,request.protectedSteps,gates)){
    throw new Error('Protected steps or host structure not preserved');
  }

  // Validated local IDs are remapped by their own collection's snapshot order.
  // Prefixes do not contain the original IDs, so 64-character local IDs stay safe.
  const nodes=allocateIds(f.nodes,g.nodes,`${request.namespace}_n`);
  const edges=allocateIds(f.edges,g.edges,`${request.namespace}_e`);
  const blocks=allocateIds(f.customBlocks,g.customBlocks,`${request.namespace}_b`);
  const entryId=nodes.get(request.fragment.entryId)!;
  const exitId=nodes.get(request.fragment.exitId)!;
  const inserted=f.nodes.map(node=>({
    ...remapMappings(node,nodes),id:nodes.get(node.id)!,type:blocks.get(node.type)??node.type,
  }));
  // A host descendant explicitly selecting the slot output now selects its exit.
  const hostReferences=new Map([[request.slotId,exitId]]);
  const graph:Graph={...g,
    nodes:g.nodes.flatMap(node=>node.id===request.slotId?inserted:[remapMappings(node,hostReferences)]),
    edges:[
      ...g.edges.map(edge=>({...edge,
        source:edge.source===request.slotId?exitId:edge.source,
        target:edge.target===request.slotId?entryId:edge.target,
      })),
      ...f.edges.map(edge=>({...edge,
        id:edges.get(edge.id)!,source:nodes.get(edge.source)!,target:nodes.get(edge.target)!,
      })),
    ],
    customBlocks:[...g.customBlocks,...f.customBlocks.map(block=>({...block,id:blocks.get(block.id)!}))],
  };
  checkNativeJson(graph);
  const checked=validateGraph(graph);
  if(!checked.ok)throw new Error('Invalid composed graph');
  const retainedSteps=g.nodes.filter(node=>node.id!==request.slotId).map(node=>node.id);
  const allGates=checked.graph.nodes.filter(node=>node.type==='approval').map(node=>node.id);
  if(!preservesWorkflowSteps(checked.graph,retainedSteps,allGates)){
    throw new Error('Composed workflow steps or approval gates not preserved');
  }
  // One active path inductively forbids concurrent fan-in without inventing merges.
  checkSingleFlow(checked.graph);
  return {graph:checked.graph,ids:{
    nodes:Object.fromEntries(nodes),edges:Object.fromEntries(edges),customBlocks:Object.fromEntries(blocks),
  }};
}
