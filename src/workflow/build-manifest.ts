import {builtinRegistry,resolveNode,type Graph,type Json} from '../../packages/workflow/graph';

export const BLOCK_FAMILIES:Record<string,string>={manual:'Triggers',http:'Connectors / AI',resource:'Connectors / AI',llm:'Connectors / AI',set:'Data',branch:'Logic / review',approval:'Logic / review',output:'Output / placeholders',unconfigured:'Output / placeholders'};

/** Describe schema-bound shape, never instruction bodies, literal values or vault identities. */
export function blockConfigSummary(type:string,config:Record<string,Json>):string {
 if(type==='set') {
  const fields=config.fields&&typeof config.fields==='object'&&!Array.isArray(config.fields)?Object.entries(config.fields):[];
  return `${fields.length} ${fields.length===1?'field':'fields'}${fields.length?` · ${fields.slice(0,3).map(([key,value])=>`${key}:${value===null?'null':Array.isArray(value)?'array':typeof value}`).join(', ')}${fields.length>3?'…':''}`:''}`;
 }
 return type==='manual'?'Supplied execution input':type==='output'?'Returns incoming data':type==='branch'?`${config.field??'Field missing'} · ${config.operator??'equals'}`:type==='http'?`${config.method??'GET'} · ${config.url?'HTTPS destination set':'URL missing'} · ${config.credentialRef?'vault reference set':'vault reference missing'}`:type==='llm'?`${config.instruction?'Instruction set':'Instruction missing'} · adapter required`:type==='resource'?`Revision ${config.revision??'missing'} · ${config.functionId??'function missing'} · reference only`:type==='approval'?`${config.reviewer?'Review queue set':'Reviewer missing'} · independent gate`:'Execution blocked';
}

export function workflowBuildManifest(graph:Graph) {
 const nodes=graph.nodes.map(node=>{
  const wrapper=graph.customBlocks.find(block=>block.id===node.type);
  const baseType=wrapper?.baseType??node.type;
  const registered=builtinRegistry.find(block=>block.type===baseType);
  let config:Record<string,Json>={},warnings:string[]=[];
  if(!registered)warnings=['Unknown registry type'];
  else {
   try {config=resolveNode(graph,node).config;}
   catch {warnings=['Configuration does not match its registry schema'];}
   if(!warnings.length)warnings=baseType==='http'&&(!config.url||!config.credentialRef)?['URL / credential reference missing']:baseType==='resource'&&(!config.resourceId||!config.revision||!config.functionId)?['Resource ID / active revision / function reference missing']:baseType==='approval'&&!config.reviewer?['Reviewer missing']:baseType==='llm'&&!config.instruction?['Instruction missing']:baseType==='branch'&&!config.field?['Condition field missing']:baseType==='unconfigured'?['Executor unconfigured']:[];
  }
  return {id:node.id,label:node.label,type:node.type,baseType:registered?baseType:null,kind:!registered?'unresolved' as const:wrapper?'wrapper' as const:'builtin' as const,family:BLOCK_FAMILIES[baseType]??'Unresolved',mappingCount:node.inputMappings?.length??0,defaultsSummary:registered?blockConfigSummary(baseType,wrapper?.defaults??registered.defaults):'No registered defaults',configSummary:registered?blockConfigSummary(baseType,config):'Unresolved registry type',warnings};
 });
 const wrappers=graph.customBlocks.map(block=>({id:block.id,label:block.label,baseType:block.baseType,description:block.description,defaultsSummary:blockConfigSummary(block.baseType,block.defaults),instanceCount:nodes.filter(node=>node.type===block.id).length}));
 return {nodes,wrappers,counts:{nodes:nodes.length,connections:graph.edges.length,existingBlocks:nodes.filter(node=>builtinRegistry.some(block=>block.type===node.type)).length,reusableWrappers:nodes.filter(node=>node.kind==='wrapper').length,wrapperDefinitions:wrappers.length,resourceReferences:nodes.filter(node=>node.baseType==='resource').length,mappings:nodes.reduce((total,node)=>total+node.mappingCount,0),mappedNodes:nodes.filter(node=>node.mappingCount>0).length,unresolved:nodes.filter(node=>node.kind==='unresolved'||node.baseType==='unconfigured').length,configurationWarnings:nodes.reduce((total,node)=>total+node.warnings.length,0)}};
}
