// DEVELOPMENT ONLY: no vendor provider exists here. Synthetic cassette provenance is explicit.
import assert from 'node:assert/strict';
import { writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect, Stream } from 'effect';
import { z } from 'zod';
import * as sdk from '@open-harness/sdk/core';
const { agent, workflow, phase, run } = sdk;
const checks=[];
const check=(id,test,detail={})=>{ assert.equal(test,true,id); checks.push({id,passed:true,...detail}); };
const events=new Map();
const busEvents=[];
const eventStore={
 append:(id,event)=>Effect.sync(()=>{const tape=events.get(id)??[]; tape.push(structuredClone(event)); events.set(id,tape);}),
 getEvents:id=>Effect.succeed(events.get(id)??[]),
 getEventsFrom:(id,pos)=>Effect.succeed((events.get(id)??[]).slice(pos)),
 listSessions:()=>Effect.succeed([...events.keys()]),
 deleteSession:id=>Effect.sync(()=>{events.delete(id);})
};
const eventBus={publish:(id,event)=>Effect.sync(()=>{busEvents.push({id,name:event.name});}),subscribe:()=>Stream.empty};
const recordings=new Map(); const loaded=[]; let recordingWrites=0; let providerCallbacks=0;
const recorder={
 load:hash=>Effect.sync(()=>{loaded.push(hash);return recordings.get(hash)??null;}),
 delete:hash=>Effect.sync(()=>{recordings.delete(hash);}),list:()=>Effect.succeed([]),
 startRecording:()=>Effect.sync(()=>{recordingWrites++;throw Error('DEVELOPMENT playback write forbidden');}),
 appendEvent:()=>Effect.sync(()=>{recordingWrites++;throw Error('DEVELOPMENT playback write forbidden');}),
 finalizeRecording:()=>Effect.sync(()=>{recordingWrites++;throw Error('DEVELOPMENT playback write forbidden');})
};
const runtime=Object.freeze({mode:'playback',eventStore,eventBus,recorder});
const provider=Object.freeze({name:'DEVELOPMENT_DISABLED_NO_VENDOR',model:'development-none-v1',config:{policyRevision:'development-v1'},stream:()=>{providerCallbacks++;throw Error('DEVELOPMENT provider must never execute');}});
const output=z.object({label:z.literal('SYNTHETIC DEVELOPMENT CASSETTE — NOT A PROVIDER COMPLETION')});
const makeAgent=(schema=output,p=provider)=>agent({name:'development-playback-agent',provider:p,output:schema,prompt:state=>`DEVELOPMENT PUBLIC FIXTURE ONLY: ${state.input}`,update:(out,draft)=>{draft.label=out.label;}});
const makeWorkflow=(a=makeAgent())=>workflow({name:'development-playback-workflow',initialState:{input:'',label:''},start:(input,draft)=>{draft.input=input;},phases:{read:phase({run:a,next:'done'}),done:phase.terminal()}});
const canonicalHash=(prompt,schema,p=provider)=>{
 const opts={model:p.model,...p.config}; const sorted=Object.fromEntries(Object.keys(opts).sort().map(k=>[k,opts[k]]));
 return 'sha256:'+createHash('sha256').update([`prompt:${prompt}`,`schema:${JSON.stringify(schema._def)}`,`options:${JSON.stringify(sorted)}`].join('|')).digest('hex');
};
let networkDenied=false;
await new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:9}); socket.once('error',e=>{networkDenied=e.code==='EPERM'||e.code==='EACCES';resolve();});socket.once('connect',()=>{socket.destroy();reject(Error('sandbox unexpectedly allowed network'));});});
check('sandbox-native-socket-denied',networkDenied);
check('actual-sdk-public-functions',[agent,workflow,phase,run].every(x=>typeof x==='function'));
check('sdk-no-public-execute-or-internal-services',!Object.hasOwn(sdk,'execute')&&!Object.hasOwn(sdk,'ProviderRecorder'));
const pure=workflow({name:'DEVELOPMENT pure no-agent workflow',initialState:{marker:''},start:(input,draft)=>{draft.marker=input;},phases:{done:phase.terminal()}});
const pureResult=await run(pure,{input:'DEVELOPMENT NO PROVIDER',runtime,sessionId:'development-pure'});
check('pure-workflow-runs-with-no-agent',pureResult.completed&&pureResult.state.marker==='DEVELOPMENT NO PROVIDER');
check('public-run-makes-home-directory-even-with-custom-stores',existsSync(process.env.HOME+'/.openscaffold'));
check('custom-stores-avoid-default-db',!existsSync(process.env.HOME+'/.openscaffold/scaffold.db'));
const prompt='DEVELOPMENT PUBLIC FIXTURE ONLY: fixed'; const hash=canonicalHash(prompt,output);
const cassette={hash,prompt,provider:provider.name,recordedAt:new Date('2026-10-18T00:00:00Z'),streamData:[{_tag:'TextDelta',delta:'SYNTHETIC DEVELOPMENT ONLY'}],result:{output:{label:'SYNTHETIC DEVELOPMENT CASSETTE — NOT A PROVIDER COMPLETION'},stopReason:'end_turn'}};
recordings.set(hash,cassette);
const seen=[];
const playback=await run(makeWorkflow(),{input:'fixed',runtime,sessionId:'development-playback',observer:{onEvent:event=>seen.push(event.name)}});
check('synthetic-playback-completes',playback.completed&&playback.state.label===cassette.result.output.label);
check('sdk-computed-request-hash-matches-source',loaded.at(-1)===hash);
check('playback-provider-callbacks-zero',providerCallbacks===0);
check('playback-recording-writes-zero',recordingWrites===0);
check('playback-observer-receives-synthetic-text-and-lifecycle',seen.includes('text:delta')&&seen.includes('agent:completed')&&seen.includes('workflow:completed'));
const persisted=await Effect.runPromise(eventStore.getEvents('development-playback'));
check('persisted-and-returned-ids-diverge',persisted.length===playback.events.length&&persisted.every((event,index)=>event.id!==playback.events[index].id));
const withoutId=values=>values.map(({id,...rest})=>rest);
check('custom-store-payload-name-time-readback',JSON.stringify(withoutId(persisted))===JSON.stringify(withoutId(playback.events)));
const missing=async(id,w,input)=>{
 let err;try{await run(w,{input,runtime,sessionId:id});}catch(e){err=e;}
 check(id,!!err&&String(err).includes('RecordingNotFound'));
};
await missing('prompt-mismatch-fails-no-fallback',makeWorkflow(),'changed');
await missing('model-mismatch-fails-no-fallback',makeWorkflow(makeAgent(output,{...provider,model:'development-other-v1'})),'fixed');
const altSchema=z.object({label:z.literal('SYNTHETIC DEVELOPMENT CASSETTE — NOT A PROVIDER COMPLETION'),other:z.string().optional()});
check('zod-object-schema-hash-collision',canonicalHash(prompt,altSchema)===hash);
const altResult=await run(makeWorkflow(makeAgent(altSchema)),{input:'fixed',runtime,sessionId:'development-schema-collision'});
check('compatible-different-object-schema-replays-same-cassette',altResult.completed&&altResult.state.label===cassette.result.output.label);
const renamedResult=await run(makeWorkflow(makeAgent(output,{...provider,name:'DIFFERENT_DEVELOPMENT_PROVIDER_NAME'})),{input:'fixed',runtime,sessionId:'development-provider-name-collision'});
check('provider-name-not-bound-by-replay-hash',renamedResult.completed);
let invalidErr;try{await run(makeWorkflow(makeAgent(z.object({differentRequired:z.number()}))),{input:'fixed',runtime,sessionId:'development-output-invalid'});}catch(e){invalidErr=e;}
check('replayed-output-is-schema-validated',!!invalidErr&&String(invalidErr).includes('AgentError'));
// A real underlying callback promise intentionally ignores abort. This is not a vendor send.
let releaseHeld; let enteredHeld;
const entered=new Promise(resolve=>{enteredHeld=resolve;});
let originalSettled=false;
const original=new Promise(resolve=>{releaseHeld=()=>{originalSettled=true;resolve(true);};});
const hitl=workflow({name:'DEVELOPMENT held-human-input',initialState:{},start:()=>{},phases:{human:phase({human:{type:'approval',prompt:'DEVELOPMENT HOLD ONLY — NO AUTHORITY'},next:'done'}),done:phase.terminal()}});
const handle=run(hitl,{input:'',runtime,sessionId:'development-abort',humanInput:{approval:()=>{enteredHeld();return original;},choice:async()=>{throw Error('unused');}}});
let outerSettled=false;const outer=Promise.resolve(handle).then(()=>{outerSettled=true;return 'completed';},e=>{outerSettled=true;return String(e);});
await entered;handle.pause();check('pause-only-local-flag',handle.isPaused===true);handle.abort();
await delay(30);
check('abort-outer-settles-before-original-callback',outerSettled&&!originalSettled);
check('abort-rejects-with-fixed-wrapper-message',(await outer).includes('Workflow aborted'));
releaseHeld();await original;
check('held-original-callback-explicitly-drained',originalSettled);
let releasePause;let enteredPause;const pauseEntered=new Promise(resolve=>{enteredPause=resolve;});
const paused=run(hitl,{input:'',runtime,sessionId:'development-pause',humanInput:{approval:()=>{enteredPause();return new Promise(resolve=>{releasePause=resolve;});},choice:async()=>''}});
await pauseEntered;paused.pause();releasePause(false);const pausedResult=await paused;
check('pause-does-not-stop-runtime',pausedResult.completed&&paused.isPaused===true);
check('hitl-false-is-data-not-automatic-denial',pausedResult.state.humanResponse?.approved===false&&pausedResult.exitPhase==='done');
check('final-provider-callbacks-zero',providerCallbacks===0);
check('final-recording-writes-zero',recordingWrites===0);
const report={provenance:'SYNTHETIC DEVELOPMENT ONLY. Actual @open-harness/sdk@0.1.1 core execution. No recorded real provider completion.',checks,passed:checks.length,providerCallbacks,recordingWrites,eventSessions:[...events.keys()],homeEntries:readdirSync(process.env.HOME),defaultDbExists:existsSync(process.env.HOME+'/.openscaffold/scaffold.db'),network:{osSandbox:'deny network*',sensitivity:'native loopback connect EPERM/EACCES; no external address attempted'},limitations:['No production integration','No vendor or plugin execution','Synthetic fixture only','This proves SDK behavior, not OS grants','Event IDs, wall-clock timestamps and durations are newly generated, not byte-identical live tapes']};
writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,providerCallbacks,recordingWrites,defaultDbExists:report.defaultDbExists}));
