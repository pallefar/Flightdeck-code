import {expect,it} from 'vitest';
import {StudioController,TRANSCRIPT_LIMIT} from '../controller';
import {workflow,subapp} from './fixtures';

it('records one bounded user turn and one actual request marker, settles the same marker on response',async()=>{
 let release!:(value:Response)=>void;let calls=0;
 const controller=new StudioController(async()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 const pending=controller.submit({connectionId:'local',prompt:'<script>never execute</script>',projectId:'project-a'},'nonsecret-test');
 await controller.submit({connectionId:'local',prompt:'duplicate'},'nonsecret-test');
 expect(calls).toBe(1);
 expect(controller.getState().transcript).toEqual([
  expect.objectContaining({role:'you',text:'<script>never execute</script>',status:'settled',destination:{connectionId:'local',projectId:'project-a'}}),
  expect.objectContaining({role:'studio',status:'requesting',text:'Requesting routed draft'}),
 ]);
 const marker=controller.getState().transcript[1]?.id;
 release(new Response(JSON.stringify(workflow)));await pending;
 expect(controller.getState().transcript).toHaveLength(2);
 expect(controller.getState().transcript[1]).toMatchObject({id:marker,status:'settled',text:expect.stringContaining(workflow.determination.reason)});
 expect(controller.getState().acceptedRequestId).toBe(controller.getState().transcript[1]?.requestId);
});

it('scope reset discards private transcript and generated source, including late accepted results',async()=>{
 let release!:(value:Response)=>void;let count=0;
 const controller=new StudioController(async()=>++count===1?new Response(JSON.stringify(subapp())):new Promise(resolve=>{release=resolve;}));
 await controller.submit({connectionId:'local',prompt:'private app'},'old-principal');
 expect(controller.workbench.getState().rounds).toHaveLength(1);
 const pending=controller.submit({connectionId:'local',prompt:'old private request'},'old-principal');
 controller.reset();release(new Response(JSON.stringify(subapp())));await pending;
 expect(controller.getState().transcript).toEqual([]);
 expect(controller.getState().acceptedRequestId).toBeNull();
 expect(controller.workbench.getState().rounds).toEqual([]);
 expect(controller.workbench.getState().drafts.size).toBe(0);
});

it('clarification adds the explicit answers instead of repeating a user prompt and cannot replay a cancelled request',async()=>{
 const needs={status:'needs_input',questions:[{id:'country',question:'Which country?'}]};let calls=0;
 const controller=new StudioController(async()=>{calls++;return new Response(JSON.stringify(needs));});
 await controller.submit({connectionId:'local',prompt:'Review consultation'},'sentinel');
 await controller.answer({country:'DE'},'sentinel');
 expect(controller.getState().transcript[2]?.text).toBe('Answers\ncountry: DE');
 let release!:(response:Response)=>void;
 const cancelled=new StudioController(async()=>{calls++;return new Promise(resolve=>{release=resolve;});});
 const pending=cancelled.submit({connectionId:'local',prompt:'Cancel this'},'sentinel');cancelled.cancel();
 release(new Response(JSON.stringify(needs)));await pending;
 await cancelled.answer({country:'DE'},'sentinel');
 expect(calls).toBe(3);
 expect(cancelled.getState().transcript.map(turn=>turn.status)).toEqual(['settled','cancelled']);
});

it('bounds the session transcript and does not let mutable caller input alter reviewed context',async()=>{
 const review={status:'model-request-refused',decision:{decision:'approval-required',reason:'Review imported context',contentHash:'a'.repeat(64)},review:{hash:'b'.repeat(64),preview:'Bounded masked context',unchecked:['partial scan']}};
 const payloads:unknown[]=[];
 const controller=new StudioController(async(_url,init)=>{payloads.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify(review));});
 const request={connectionId:'local' as const,prompt:'Original prompt',projectId:'project-a',answers:{country:'DE'}};
 await controller.submit(request,'sentinel');request.prompt='Changed outside controller';request.answers.country='DK';
 await controller.approveSkillSend('sentinel');
 expect(payloads[1]).toEqual({connectionId:'local',prompt:'Original prompt',projectId:'project-a',answers:{country:'DE'},reviewedSkillHash:'b'.repeat(64)});
 for(let i=0;i<18;i++)await controller.submit({connectionId:'local',prompt:'x'.repeat(8000)},'sentinel');
 expect(controller.getState().transcript).toHaveLength(TRANSCRIPT_LIMIT);
 expect(new Set(controller.getState().transcript.map(turn=>turn.id)).size).toBe(TRANSCRIPT_LIMIT);
 expect(controller.getState().transcript.every(turn=>turn.text.length<=(turn.role==='you'?8000:2000))).toBe(true);
});
