import {createEmptyGraph,type Graph} from './graph';
/** Deterministic graph fixture; no production adapters or simulated model calls. */
export function chain(types:string[]):Graph {return {...createEmptyGraph(),nodes:types.map((type,i)=>({id:`n${i}`,type,label:type,position:{x:i*250,y:0},config:type==='set'?{fields:{answer:42}}:{}})),edges:types.slice(1).map((_,i)=>({id:`e${i}`,source:`n${i}`,target:`n${i+1}`}))};}
export function mappings(g:Graph,index:number,value:unknown) {Object.assign(g.nodes[index]!,{inputMappings:value});}
