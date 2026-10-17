import {describe,it,expect} from 'vitest';
import * as walkthrough from './walkthrough';
import {createWorkflowTemplate} from './WorkflowEditor';
import {graphSchema} from '../../packages/workflow/graph';

describe('actual-graph walkthrough',()=>{
 it('explains actual dependency order without executing or mutating a graph',()=>{
  expect(walkthrough).toHaveProperty('createWalkthrough');
  const graph=createWorkflowTemplate('branch');
  graph.nodes=[graph.nodes[3]!,graph.nodes[1]!,graph.nodes[2]!,graph.nodes[0]!];
  graph.nodes[0]!.position={x:0,y:0};
  const before=JSON.stringify(graph);
  const plan=walkthrough.createWalkthrough(graphSchema.parse(graph));
  expect(plan.steps.map(step=>step.nodeId)).toEqual(['node0','node1','node3','node2']);
  expect(plan.steps[1]).toMatchObject({type:'branch',edgeIds:['edge0','edge1','edge2']});
  expect(plan.steps[1]!.explanation).toMatch(/both true and false.*alternatives/i);
  expect(plan.steps[1]!.explanation).toMatch(/not.*select/i);
  expect(plan.boundary).toBe('Design walkthrough · not an execution');
  expect(JSON.stringify(graph)).toBe(before);
 });
 it('explains effective wrapper defaults and mapping source shapes without private values',()=>{
  const graph=createWorkflowTemplate('http');
  graph.customBlocks=[{id:'wrapped',label:'Private customer wrapper',baseType:'set',description:'Private description',defaults:{fields:{ready:true,customer:'private literal'}}}];
  graph.nodes[1]!.type='wrapped';graph.nodes[1]!.config={};
  graph.nodes[1]!.label='Private customer name';
  graph.nodes[1]!.inputMappings=[{target:'copy',source:{kind:'input',path:['privatePath']}},{target:'fixed',source:{kind:'literal',value:'private literal'}},{target:'upstream',source:{kind:'node',nodeId:'node0',path:[]}}];
  const plan=walkthrough.createWalkthrough(graphSchema.parse(graph)),step=plan.steps[1]!;
  expect(step.explanation).toMatch(/2.*fields.*merge/i);
  expect(step.explanation).toMatch(/reusable wrapper.*set/i);
  expect(step.mappings).toEqual(['Original execution input · path with 1 segment','Literal · string · value omitted','Ancestor output · whole value']);
  expect(step.tip).toMatch(/object input.*overwrite/i);
  expect(plan.counts).toMatchObject({reusableWrappers:1,mappings:3});
  expect(JSON.stringify(plan)).not.toMatch(/Private customer|private literal|privatePath|Private description/);
 });
 it('distinguishes empty replacement mappings from unchanged incoming input',()=>{
  const graph=createWorkflowTemplate('branch');graph.nodes[2]!.inputMappings=[];
  const plan=walkthrough.createWalkthrough(graph);
  expect(plan.steps[2]!.mappings).toEqual(['Explicit empty mappings replace input with an empty object']);
  expect(plan.steps[3]!.mappings).toEqual(['No mapping override · incoming data is retained']);
 });
 it('describes the effective branch operator without reading condition names or comparison values aloud',()=>{
  const graph=createWorkflowTemplate('branch');graph.nodes[1]!.config={field:'privateField',operator:'exists'};
  const step=walkthrough.createWalkthrough(graph).steps[1]!;
  expect(step.explanation).toMatch(/tests whether the configured top-level field exists/i);
  expect(step.narration).not.toContain('privateField');
 });
 it.each([
  ['manual',/original execution input/i,/one manual root/i],
  ['http',/requires a configured trusted adapter.*not called/i,/destination.*vault/i],
  ['llm',/requires a configured trusted adapter.*not called/i,/not.*autonomous.*tool/i],
  ['resource',/requires a configured trusted adapter.*not called/i,/active revision.*authority/i],
  ['approval',/independent human pause.*not granted by.*walkthrough/i,/cannot approve/i],
  ['output',/returns incoming data.*no.*invented result/i,/terminal/i],
  ['unconfigured',/blocks execution/i,/configure.*replace/i],
 ] as const)('explains %s according to actual engine boundaries',(type,explanation,tip)=>{
  const graph=createWorkflowTemplate('approval');
  graph.nodes[1]!.type=type;
  graph.nodes[1]!.config=type==='approval'?{reviewer:'private reviewer',reason:'private reason'}:type==='unconfigured'?{description:'private placeholder'}:{};
  const step=walkthrough.createWalkthrough(graphSchema.parse(graph)).steps[1]!;
  expect(step.explanation).toMatch(explanation);expect(step.tip).toMatch(tip);
  expect(step.narration).not.toMatch(/private reviewer|private reason|private placeholder/);
 });
 it('reports whole-graph admission constraints and disconnected nodes without pretending a run can reach them',()=>{
  const graph=createWorkflowTemplate('branch');
  graph.nodes.push({id:'orphan',type:'set',label:'Detached',config:{fields:{}},position:{x:0,y:0}},{id:'root2',type:'manual',label:'Other trigger',config:{},position:{x:0,y:0}});
  const plan=walkthrough.createWalkthrough(graph);
  expect(plan.notices.join(' ')).toMatch(/exactly one manual root.*non-root.*connected/i);
  expect(plan.steps.find(step=>step.nodeId==='orphan')).toMatchObject({reachable:false});
  expect(plan.steps.find(step=>step.nodeId==='orphan')!.explanation).toMatch(/not reachable.*manual trigger/i);
  expect(plan.steps).toHaveLength(6);
 });
 it('explains conditional joins without inventing merge support or actual branch choice',()=>{
  const graph=createWorkflowTemplate('branch');
  graph.nodes[2]!.type='set';graph.nodes[2]!.config={fields:{}};graph.nodes[3]!.type='set';graph.nodes[3]!.config={fields:{}};
  graph.nodes.push({id:'joined',type:'output',label:'Joined',config:{},position:{x:0,y:0}});
  graph.edges.push({id:'joinA',source:'node2',target:'joined'},{id:'joinB',source:'node3',target:'joined'});
  const step=walkthrough.createWalkthrough(graphSchema.parse(graph)).steps[4]!;
  expect(step.tip).toMatch(/one active input.*multiple active inputs.*block.*no active input.*skip/i);
  expect(step.edgeIds).toEqual(['joinA','joinB']);
 });
 it('names required gate bypass and nonterminal outputs as execution constraints',()=>{
  const graph=createWorkflowTemplate('approval');
  graph.nodes.push({id:'bypass',type:'output',label:'Bypass',config:{},position:{x:0,y:0}});
  graph.edges.push({id:'unsafe',source:'node0',target:'bypass'},{id:'afterOutput',source:'node2',target:'bypass'});
  expect(walkthrough.createWalkthrough(graph).notices.join(' ')).toMatch(/output.*terminal.*bypass.*human/i);
 });
 it('covers a maximum graph once, deriving bounded creation groups from dependencies',()=>{
  const graph=createWorkflowTemplate('http');
  graph.nodes=Array.from({length:100},(_,index)=>({id:`step${index}`,type:index===0?'manual':index===99?'output':'set',label:'Private label',config:index===0||index===99?{}:{fields:{}},position:{x:0,y:0}}));
  graph.edges=graph.nodes.slice(1).map((node,index)=>({id:`link${index}`,source:`step${index}`,target:node.id}));
  graph.nodes.reverse();const plan=walkthrough.createWalkthrough(graphSchema.parse(graph));
  expect(plan.steps.map(step=>step.nodeId)).toEqual(Array.from({length:100},(_,i)=>`step${i}`));
  expect(plan.creationGroups.length).toBeLessThanOrEqual(12);
  expect(plan.creationGroups.flatMap(group=>group.nodeIds)).toEqual(plan.steps.map(step=>step.nodeId));
  expect(plan.creationGroups.flatMap(group=>group.edgeIds)).toHaveLength(99);
 });
});
