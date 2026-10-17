import {expect,it} from 'vitest';
import {StudioController} from '../controller';
import {checkConnection} from '../connection';
import {createAiBuilderFixture,DEVELOPMENT_TOKEN,DEVELOPMENT_PROJECT,WORKFLOW_REQUEST,SUBAPP_REQUEST,DEVELOPMENT_GRAPH} from './ai-builder.fixture';

it('accepts only actual routed HTTP artifacts, with an exact reviewed workflow context and real generated sub-app files',async()=>{
 const fixture=await createAiBuilderFixture();const origin=await fixture.app.listen({host:'127.0.0.1',port:0});
 const transport:typeof fetch=(url,init)=>fetch(new URL(String(url),origin),init);
 const controller=new StudioController(transport);
 try{
  const connection=await checkConnection(DEVELOPMENT_PROJECT,DEVELOPMENT_TOKEN,transport);
  expect(connection.selectedId).toBeNull();expect(connection.connections).toHaveLength(4);expect(fixture.modelCalls).toEqual([]);
  await controller.submit({connectionId:'local',prompt:WORKFLOW_REQUEST,projectId:DEVELOPMENT_PROJECT},DEVELOPMENT_TOKEN);
  expect(controller.getState().result?.status).toBe('model-request-refused');
  const first=controller.getState().result;if(first?.status!=='model-request-refused')throw new Error('review unavailable');
  expect(first.review?.hash).toMatch(/^[a-f0-9]{64}$/);
  await controller.approveSkillSend(DEVELOPMENT_TOKEN);
  const result=controller.getState().result;
  expect(result).toMatchObject({status:'workflow-proposed',graph:DEVELOPMENT_GRAPH,projectId:DEVELOPMENT_PROJECT});
  expect(controller.workbench.getState().rounds).toEqual([]);
  expect(controller.getState().transcript.map(turn=>turn.role)).toEqual(['you','studio','you','studio']);
  expect(fixture.modelCalls).toEqual(['determination','determination','workflow','graph']);
  await controller.submit({connectionId:'local',prompt:SUBAPP_REQUEST,projectId:DEVELOPMENT_PROJECT},DEVELOPMENT_TOKEN);
  expect(controller.getState().result).toMatchObject({status:'subapp-result',outcome:{status:'proposed'}});
  const candidate=controller.workbench.getState().rounds.at(-1)?.candidate;
  expect(candidate?.files.length).toBeGreaterThan(4);
  expect(candidate?.files.some(file=>file.kind==='web-module')).toBe(true);
  expect(candidate?.files.some(file=>file.kind==='manifest')).toBe(true);
  expect(controller.workbench.getState().runs.flatMap(run=>run.steps)).toEqual([]);
  await controller.submit({connectionId:'local',prompt:'Refuse invalid route',projectId:DEVELOPMENT_PROJECT},DEVELOPMENT_TOKEN);
  expect(controller.getState().result?.status).toBe('invalid_determination');
  expect(controller.workbench.getState().rounds).toHaveLength(1);
 }finally{await fixture.close();}
});
