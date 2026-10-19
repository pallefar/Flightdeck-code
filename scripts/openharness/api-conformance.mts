// Compile-only published API conformance: no provider or network execution.
import { Effect, Stream } from 'effect';
import { z } from 'zod';
import { agent, workflow, phase, run, type AgentProvider, type RuntimeConfig, type WorkflowExecution } from '@open-harness/sdk/core';
const provider:AgentProvider={name:'DEVELOPMENT_DISABLED',model:'development-none',stream:()=>Stream.empty};
type State={input:string;count:number};
const a=agent<State,{count:number}>({name:'development',provider,output:z.object({count:z.number()}),prompt:s=>s.input,update:(o,d)=>{d.count=o.count;}});
const w=workflow<State,string,'read'|'done'>({name:'development',initialState:{input:'',count:0},start:(input,d)=>{d.input=input;},startPhase:'read',phases:{read:phase<State,'read'|'done'>({run:a,next:'done'}),done:phase.terminal<State,'read'|'done'>()}});
const runtime:RuntimeConfig={mode:'playback',eventStore:{append:()=>Effect.void,getEvents:()=>Effect.succeed([]),getEventsFrom:()=>Effect.succeed([]),listSessions:()=>Effect.succeed([]),deleteSession:()=>Effect.void},eventBus:{publish:()=>Effect.void,subscribe:()=>Stream.empty},recorder:{load:()=>Effect.succeed(null),delete:()=>Effect.void,list:()=>Effect.succeed([]),startRecording:()=>Effect.succeed('development'),appendEvent:()=>Effect.void,finalizeRecording:()=>Effect.void}};
// Function is deliberately not called.
export const compileOnly=():WorkflowExecution<State>=>run(w,{input:'DEVELOPMENT',runtime,humanInput:{approval:async()=>false,choice:async(_p,options)=>options[0]??''}});
