import {graphSchema,jsonValue,resolveNode,type Graph,type GraphNode,type Json,type InputMapping,type InputMappingSource} from '../../packages/workflow/graph';
import {safeMappingKey} from '../../packages/workflow/data';
import {useState} from 'react';
import {type SaveOutcome,type ValueType} from './NodeParameters';
export type {InputMapping} from '../../packages/workflow/graph';
export type MappingSource=InputMappingSource;
export {safeMappingKey} from '../../packages/workflow/data';
export function ancestorNodes(graph:Graph,nodeId:string):GraphNode[]{
 const seen=new Set<string>();const visit=(id:string)=>{for(const edge of graph.edges.filter(e=>e.target===id))if(!seen.has(edge.source)){seen.add(edge.source);visit(edge.source);}};visit(nodeId);return graph.nodes.filter(n=>seen.has(n.id)&&n.id!==nodeId);
}
export function observedFields(value:Json,limit=100):{path:(string|number)[];type:string}[]{
 const fields:{path:(string|number)[];type:string}[]=[];
 function visit(v:Json,path:(string|number)[]){if(fields.length>=Math.min(100,limit)||path.length>8)return;fields.push({path,type:v===null?'null':Array.isArray(v)?'array':typeof v});if(v&&typeof v==='object')for(const key of Object.keys(v)){if(!safeMappingKey(key))continue;visit((v as Record<string,Json>)[key]!,[...path,Array.isArray(v)?Number(key):key]);}}
 visit(value,[]);return fields;
}
export interface MappingRow {target:string;kind:MappingSource['kind'];nodeId:string;pathText:string;valueType:ValueType;valueText:string}
export interface ObservedOutput {nodeId:string;output:Json}
export function parseMappingRows(graph:Graph,node:GraphNode,rows:MappingRow[]):InputMapping[]{
 if(['manual','approval'].includes(resolveNode(graph,node).type))throw new Error('Input mappings are unavailable for manual triggers and human gates');
 if(rows.length>100)throw new Error('Maximum 100 mappings');
 const targets=new Set<string>(),ancestors=new Set(ancestorNodes(graph,node.id).map(n=>n.id));
 return rows.map(row=>{
  if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(row.target)||!safeMappingKey(row.target))throw new Error('Use a safe top-level target field');
  if(targets.has(row.target))throw new Error('Duplicate target field: '+row.target);targets.add(row.target);
  if(row.valueText.length>20000||row.pathText.length>2000)throw new Error('Mapping value or path is too large');
  let source:MappingSource;
  if(row.kind==='literal'){
   const value=row.valueType==='string'?row.valueText:row.valueType==='null'?null:JSON.parse(row.valueText);
   const actual=value===null?'null':Array.isArray(value)?'array':typeof value;
   if(actual!==row.valueType)throw new Error('Expected '+row.valueType+' literal');
   source={kind:'literal',value:jsonValue.parse(value)};
  }else{
   const path:unknown=JSON.parse(row.pathText);
   if(!Array.isArray(path)||path.length>8||!path.every(k=>typeof k==='string'?safeMappingKey(k):Number.isInteger(k)&&Number(k)>=0))throw new Error('Path must be a JSON array of safe field names and non-negative indices (maximum depth 8)');
   if(row.kind==='node'&&!ancestors.has(row.nodeId))throw new Error('Source must be an ancestor node');
   source=row.kind==='node'?{kind:'node',nodeId:row.nodeId,path}:{kind:'input',path};
  }
  return {target:row.target,source};
 });
}
export function applyMappingRows(graph:Graph,node:GraphNode,rows:MappingRow[],update:(mappings:InputMapping[]|undefined)=>SaveOutcome):SaveOutcome {
 try {const parsed=parseMappingRows(graph,node,rows);const mappings=parsed.length?parsed:undefined;graphSchema.parse({...graph,nodes:graph.nodes.map(n=>n.id===node.id?{...n,inputMappings:mappings}:n)});return update(mappings);}catch(e){return {ok:false,error:e instanceof Error?e.message:'Invalid mappings'};}
}
function mappingRows(node:GraphNode):MappingRow[]{
 const mappings=node.inputMappings??[];
 return mappings.map(({target,source})=>({target,kind:source.kind,nodeId:source.kind==='node'?source.nodeId:'',pathText:source.kind==='literal'?'[]':JSON.stringify(source.path),valueType:source.kind==='literal'?(source.value===null?'null':Array.isArray(source.value)?'array':typeof source.value as ValueType):'string',valueText:source.kind==='literal'?(typeof source.value==='string'?source.value:JSON.stringify(source.value)):''}));
}
interface MapperProps {graph:Graph;node:GraphNode;update:(mappings:InputMapping[]|undefined)=>SaveOutcome;sampleInput?:Json|undefined;outputs?:ObservedOutput[];onDraftChange?:()=>void}
export function NodeInputMapper(props:MapperProps){
 return <MappingForm key={JSON.stringify(props.node.inputMappings??[])} {...props}/>;
}
function MappingForm({graph,node,update,sampleInput,outputs=[],onDraftChange}:MapperProps){
 const [rows,setRows]=useState(()=>mappingRows(node)),[issue,setIssue]=useState(''),[status,setStatus]=useState('Saved input mappings');
 const ancestors=ancestorNodes(graph,node.id);
 function change(next:MappingRow[]){onDraftChange?.();setRows(next);setIssue('');setStatus('Unsaved input mappings');}
 function patch(index:number,values:Partial<MappingRow>){change(rows.map((r,i)=>i===index?{...r,...values}:r));}
 if(['manual','approval'].includes(resolveNode(graph,node).type))return <p>Input mappings are unavailable for manual triggers and human gates. Original workflow input is supplied at execution.</p>;
 return <div className="wf-mapper"><p>Explicit mappings replace this node’s input with the mapped object. No mappings keeps incoming data unchanged. Separate Apply from Parameters; never secrets or executable expressions.</p>
 <p>Observed example fields are not a guaranteed schema. Missing runtime paths block execution. No observed sample? Use a manual JSON path, such as ["customer",0,"name"].</p>
 {rows.map((row,index)=>{
  const observed=row.kind==='input'?sampleInput:row.kind==='node'?outputs.find(o=>o.nodeId===row.nodeId)?.output:undefined;
  return <fieldset className="wf-mapping-row" key={index}><legend>Mapping {index+1}</legend>
   <label>Target field<input aria-label={`Mapping ${index+1} target`} value={row.target} maxLength={64} onChange={e=>patch(index,{target:e.target.value})}/></label>
   <label>Source<select aria-label={`Mapping ${index+1} source`} value={row.kind==='node'?`node:${row.nodeId}`:row.kind} onChange={e=>patch(index,e.target.value.startsWith('node:')?{kind:'node',nodeId:e.target.value.slice(5)}:{kind:e.target.value as 'literal'|'input',nodeId:''})}><option value="literal">Literal value</option><option value="input">Original workflow input</option>{ancestors.map(n=><option key={n.id} value={`node:${n.id}`}>{n.label} · ancestor output</option>)}</select></label>
   {row.kind==='literal'?<><label>Literal type<select aria-label={`Mapping ${index+1} literal type`} value={row.valueType} onChange={e=>patch(index,{valueType:e.target.value as ValueType})}>{(['string','number','boolean','object','array','null'] as const).map(t=><option key={t}>{t}</option>)}</select></label><label>Literal value<input aria-label={`Mapping ${index+1} literal value`} value={row.valueText} disabled={row.valueType==='null'} maxLength={20000} onChange={e=>patch(index,{valueText:e.target.value})}/></label></>:<>
   {observed===undefined?<p>No observed sample for this source.</p>:<label>Observed example field<select aria-label={`Mapping ${index+1} observed field`} value="" onChange={e=>{if(e.target.value)patch(index,{pathText:e.target.value});}}><option value="">Choose an observed path / type</option>{observedFields(observed).map(f=><option key={JSON.stringify(f.path)} value={JSON.stringify(f.path)}>{JSON.stringify(f.path)} · {f.type}</option>)}</select></label>}
   <label>JSON path<input aria-label={`Mapping ${index+1} path`} value={row.pathText} maxLength={2000} onChange={e=>patch(index,{pathText:e.target.value})}/></label></>}
   <button aria-label={`Remove mapping ${index+1}`} onClick={()=>change(rows.filter((_,i)=>i!==index))}>Remove</button>
  </fieldset>;
 })}
 <button disabled={rows.length>=100} onClick={()=>change([...rows,{target:'',kind:'input',nodeId:'',pathText:'[]',valueType:'string',valueText:''}])}>Add mapping</button>
 {issue&&<p role="alert">{issue}</p>}<p role="status">{status}</p>
 <button onClick={()=>{const result=applyMappingRows(graph,node,rows,update);setIssue(result.ok?'':result.error);setStatus(result.ok?'Saved input mappings':'Invalid input mappings — not saved');}}>Apply input mappings</button>
 </div>;
}
