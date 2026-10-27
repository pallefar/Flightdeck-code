import type {Json} from './graph';
import {scrub} from '../guardrails/src/scrub';

export const safeMappingKey=(key:string)=>!['__proto__','constructor','prototype'].includes(key)&&!/secret|password|token|api.?key|authorization|credential/i.test(key);

/** Iterative preflight before recursive schemas/stringification. No getters or custom prototypes. */
export function boundedJson(value:unknown,maxBytes:number,maxDepth=16,maxNodes=2000):value is Json {
 const pending:{value:unknown;depth:number;exit?:boolean}[]=[{value,depth:0}];const seen=new WeakSet<object>();let count=0;
 while(pending.length){
  const item=pending.pop()!;if(item.exit){seen.delete(item.value as object);continue;}if(item.depth>maxDepth||++count>maxNodes)return false;
  const v=item.value;
  if(v===null||typeof v==='boolean'||typeof v==='string')continue;
  if(typeof v==='number'){if(!Number.isFinite(v))return false;continue;}
  if(typeof v!=='object'||seen.has(v))return false;seen.add(v);pending.push({value:v,depth:item.depth,exit:true});
  const prototype=Object.getPrototypeOf(v);
  if(prototype!==null&&prototype!==(Array.isArray(v)?Array.prototype:Object.prototype))return false;
  if(Object.getOwnPropertySymbols(v).length)return false;
  if(Array.isArray(v)&&v.length>100)return false;
  const descriptors=Object.getOwnPropertyDescriptors(v);
  for(const [key,descriptor] of Object.entries(descriptors)){
   if(Array.isArray(v)&&key==='length')continue;
   if(!('value' in descriptor)||!descriptor.enumerable||['__proto__','constructor','prototype'].includes(key))return false;
   if(Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=v.length))return false;
   pending.push({value:descriptor.value,depth:item.depth+1});
  }
  if(Array.isArray(v)&&Object.keys(descriptors).length!==v.length+1)return false;
 }
 try{return new TextEncoder().encode(JSON.stringify(value)).length<=maxBytes;}catch{return false;}
}

/** Local-inspector snapshot, NOT a proof of anonymization. Omit rather than truncate oversized data. */
export function diagnosticSnapshot(value:Json,maxBytes:number):Json|undefined {
 if(!boundedJson(value,maxBytes))return undefined;
 const identityKey=(key:string)=>/name|email|e_mail|user.?id|person.?id|actor.?id|reviewer|initiator/i.test(key);
 const names:string[]=[];
 const collect=(v:Json):void=>{if(v&&typeof v==='object')for(const [key,child] of Object.entries(v)){if(/name/i.test(key)&&typeof child==='string')names.push(child);else collect(child);}};
 collect(value);
 const walk=(v:Json):Json=>{
  if(typeof v==='string')return scrub(v,{names,truncate:false});
  if(v===null||typeof v!=='object')return v;
  if(Array.isArray(v))return v.map(walk);
  const result:Record<string,Json>={};
  for(const [key,child] of Object.entries(v)){
   if(!safeMappingKey(key)||identityKey(key)||scrub(key,{names,truncate:false})!==key)continue;
   result[key]=walk(child);
  }
  return result;
 };
 const snapshot=walk(value);return boundedJson(snapshot,maxBytes)?snapshot:undefined;
}
