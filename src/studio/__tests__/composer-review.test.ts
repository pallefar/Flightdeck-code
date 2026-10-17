import {expect,it} from 'vitest';
import {StudioController} from '../controller';

// Deterministic nonsecret DTO fixtures, never vendor output or backend proof.
const hash='b'.repeat(64);
const review={status:'model-request-refused',decision:{decision:'approval-required',reason:'FIXTURE: review imported context',contentHash:'a'.repeat(64)},review:{hash,preview:'FIXTURE: bounded masked context',unchecked:['partial scan']}};
const json=()=>new Response(JSON.stringify(review));

it('revokes a settled review on composer edit without discarding the original session',async()=>{
  const payloads:unknown[]=[];
  const controller=new StudioController(async(_url,init)=>{payloads.push(JSON.parse(String(init?.body)));return json();});
  await controller.submit({connectionId:'local',prompt:'Original A',projectId:'project-a'},'NONSECRET_FIXTURE');
  const before=controller.getState(),workbench=controller.workbench.getState();
  expect((controller as unknown as {invalidateSkillSendReview?:unknown}).invalidateSkillSendReview).toBeTypeOf('function');
  controller.invalidateSkillSendReview();
  await controller.approveSkillSend('NONSECRET_FIXTURE');
  expect(payloads).toEqual([{connectionId:'local',prompt:'Original A',projectId:'project-a'}]);
  expect(controller.getState().transcript).toBe(before.transcript);
  expect(controller.getState().result).toBe(before.result);
  expect(controller.workbench.getState()).toBe(workbench);
});

it('does not re-arm original A review through clarification after the composer changed',async()=>{
  const payloads:unknown[]=[];
  const controller=new StudioController(async(_url,init)=>{
    payloads.push(JSON.parse(String(init?.body)));
    return payloads.length===1?new Response(JSON.stringify({status:'needs_input',questions:[{id:'country',question:'Which country?'}]})):json();
  });
  await controller.submit({connectionId:'local',prompt:'Original A'},'NONSECRET_FIXTURE');
  controller.invalidateSkillSendReview();
  await controller.answer({country:'DE'},'NONSECRET_FIXTURE');
  await controller.approveSkillSend('NONSECRET_FIXTURE');
  expect(payloads).toHaveLength(2);
  expect(controller.skillSendReviewCurrent).toBe(false);
});

it('keeps delayed A review revoked after edits and reversion until an explicit fresh request',async()=>{
  let release!:(response:Response)=>void;
  const payloads:unknown[]=[];
  const controller=new StudioController(async(_url,init)=>{payloads.push(JSON.parse(String(init?.body)));return payloads.length===1?new Promise(resolve=>{release=resolve;}):json();});
  const pending=controller.submit({connectionId:'local',prompt:'Original A',projectId:'project-a'},'NONSECRET_FIXTURE');
  controller.invalidateSkillSendReview(); // A -> B
  controller.invalidateSkillSendReview(); // B -> A: value equality cannot revive consent.
  release(json());await pending;
  const original=controller.getState().result;
  expect(controller.skillSendReviewCurrent).toBe(false);
  await controller.approveSkillSend('NONSECRET_FIXTURE');
  expect(payloads).toHaveLength(1);
  expect(controller.getState().result).toBe(original);
  await controller.submit({connectionId:'local',prompt:'New B',projectId:'project-a'},'NONSECRET_FIXTURE');
  expect(controller.skillSendReviewCurrent).toBe(true);
  expect(payloads[1]).toEqual({connectionId:'local',prompt:'New B',projectId:'project-a'});
  await controller.approveSkillSend('NONSECRET_FIXTURE');
  expect(payloads[2]).toEqual({connectionId:'local',prompt:'New B',projectId:'project-a',reviewedSkillHash:hash});
});

it('retains exact original request, answers and server hash when the composer is unchanged',async()=>{
  const payloads:unknown[]=[];
  const controller=new StudioController(async(_url,init)=>{payloads.push(JSON.parse(String(init?.body)));return json();});
  const request={connectionId:'local' as const,prompt:'Original A',projectId:'project-a',answers:{country:'DE'}};
  await controller.submit(request,'NONSECRET_FIXTURE');
  request.prompt='Caller-mutated B';request.answers.country='DK';
  expect(payloads).toHaveLength(1);
  await controller.approveSkillSend('NONSECRET_FIXTURE');
  expect(payloads[1]).toEqual({connectionId:'local',prompt:'Original A',projectId:'project-a',answers:{country:'DE'},reviewedSkillHash:hash});
});
