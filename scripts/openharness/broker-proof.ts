// DEVELOPMENT ONLY. Real SDK + real Flightdeck read-only draft broker; no model port or vendor client.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Effect, Stream } from 'effect';
import { z } from 'zod';
import { agent, workflow, phase, run, ProviderError } from '@open-harness/sdk/core';
const { createDraftBroker } = await import(process.argv[2]!);
const checks: {id:string;passed:true}[]=[];
const check=(id:string,ok:boolean)=>{assert.equal(ok,true,id);checks.push({id,passed:true});};
const binding=Object.freeze({actorId:'DEVELOPMENT_PUBLIC_FIXTURE',workspaceId:'development-workspace',projectId:'development-project',modelId:'development-no-model',modelBindingId:'development-no-vendor',contextEpoch:'development-v1',policyEpoch:'development-read-only-v1'});
const policyCalls: string[]=[];
const broker=createDraftBroker({binding,protectedGraph:null,limits:{maxModelCalls:1,maxToolCalls:2,maxConcurrent:1,maxDurationMs:10000,maxInputBytes:512000,maxOutputBytes:512000,maxTotalOutputBytes:1000000,maxTokensPerCall:1,maxTotalOutputTokens:1,maxEvents:32},authorize:async request=>{policyCalls.push(request.action+':'+request.stage);return {allowed:request.action==='read_block_catalog',binding};}});
const pending=new Set<Promise<unknown>>();
const provider=Object.freeze({name:'DEVELOPMENT_FLIGHTDECK_LOCAL_READ_ONLY_BROKER',model:'development-no-model',config:{policyRevision:'development-read-only-v1'},stream:()=>Stream.fromEffect(Effect.tryPromise({try:()=>{
 const original=broker.invoke('read_block_catalog',{});
 pending.add(original);void original.then(()=>pending.delete(original),()=>pending.delete(original));
 return original.then(catalog=>{
  const value=catalog as {blocks:unknown[]};
  // This is the actual bounded broker's local result, not an invented vendor completion.
  return {_tag:'Result' as const,output:{blockCount:value.blocks.length,provenance:'DEVELOPMENT LOCAL BROKER; ZERO MODEL SENDS' as const},stopReason:'end_turn' as const};
 });
},catch:()=>new ProviderError({code:'UNKNOWN',message:'development broker refused',retryable:false})}))});
const local=agent<{blockCount:number}, {blockCount:number;provenance:'DEVELOPMENT LOCAL BROKER; ZERO MODEL SENDS'}>({name:'development-catalog-read',provider,output:z.object({blockCount:z.number().int().nonnegative(),provenance:z.literal('DEVELOPMENT LOCAL BROKER; ZERO MODEL SENDS')}),prompt:()=> 'DEVELOPMENT LOCAL BROKER ACTION ONLY',update:(out,draft)=>{draft.blockCount=out.blockCount;}});
const graph=workflow({name:'development-real-sdk-broker-seam',initialState:{blockCount:0},start:()=>{},phases:{catalog:phase({run:local,next:'done'}),done:phase.terminal()}});
const store={append:()=>Effect.void,getEvents:()=>Effect.succeed([]),getEventsFrom:()=>Effect.succeed([]),listSessions:()=>Effect.succeed([]),deleteSession:()=>Effect.void};
const bus={publish:()=>Effect.void,subscribe:()=>Stream.empty};
let result;
try {
 result=await run(graph,{input:'',runtime:{mode:'live',eventStore:store,eventBus:bus},sessionId:'development-real-sdk-broker-seam'});
 check('real-sdk-consumes-real-local-broker-result',result.completed&&result.state.blockCount>0);
 check('actual-broker-rechecks-before-after-return',JSON.stringify(policyCalls)===JSON.stringify(['read_block_catalog:before','read_block_catalog:after','read_block_catalog:return']));
 check('no-model-sends',broker.snapshot().modelCalls===0);
 let denied=false;try{await broker.invoke('shell',{});}catch{denied=true;}
 check('shell-is-not-registered',denied);
 check('denied-unknown-tool-never-reaches-policy-or-handler',policyCalls.length===3&&broker.snapshot().toolCalls===1);
} finally {
 await Promise.allSettled([...pending]); await broker.close();
}
check('original-broker-work-drained',pending.size===0&&broker.snapshot().pending===0);
const report={provenance:'DEVELOPMENT real @open-harness/sdk@0.1.1 + unchanged real Flightdeck createDraftBroker. Trusted synthetic read-only policy binding, not host authentication/grants. No model client, no live provider, no invented model completion.',checks,passed:checks.length,result:result!.state,snapshot:broker.snapshot(),policyCalls,productionIntegration:false};
writeFileSync(process.argv[3]!,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:checks.length,state:result!.state,modelSends:broker.snapshot().modelCalls,toolCalls:broker.snapshot().toolCalls}));
