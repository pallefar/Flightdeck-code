import {WORKFLOW_CSS} from './styles';
import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkflowEditorStore} from './store';
import {createWorkflowRunner} from '../../packages/workflow/engine';
import {NodeSettings} from './WorkflowEditor';
import {createEmptyGraph,type Graph} from '../../packages/workflow/graph';
import {ancestorNodes,observedFields,NodeInputMapper,parseMappingRows,applyMappingRows,type MappingRow} from './NodeInputMapper';
export function mappingFixture():Graph {return {...createEmptyGraph(),nodes:[{id:'start',type:'manual',label:'Start',position:{x:0,y:0},config:{}},{id:'edit',type:'set',label:'Edit',position:{x:250,y:0},config:{fields:{ready:true}}},{id:'end',type:'output',label:'End',position:{x:500,y:0},config:{}}],edges:[{id:'one',source:'start',target:'edit'},{id:'two',source:'edit',target:'end'}]};}
it('offers only ancestors and bounded own nested observed fields with real types',()=>{
 const graph=mappingFixture();expect(ancestorNodes(graph,'edit').map(n=>n.id)).toEqual(['start']);
 expect(observedFields({customer:{names:['Ada'],active:true}})).toContainEqual({path:['customer','names',0],type:'string'});
 expect(observedFields(JSON.parse('{"__proto__":{"bad":true},"token":"no","safe":null}'))).toEqual([{path:[],type:'object'},{path:['safe'],type:'null'}]);
 expect(observedFields({items:Array(100).fill(1)},5)).toHaveLength(5);
 const html=renderToStaticMarkup(createElement(NodeInputMapper,{graph,node:graph.nodes[1]!,update:()=>({ok:true as const})}));
 expect(html).toContain('Apply input mappings');expect(html).toContain('No observed sample');expect(html).not.toContain('Ada');
});

it('parses typed literals and validates mappings atomically before saving',()=>{
 const graph=mappingFixture(),node=graph.nodes[1]!;
 const row:MappingRow={target:'name',kind:'input',nodeId:'',pathText:'["customer","names",0]',valueType:'string',valueText:''};
 expect(parseMappingRows(graph,node,[row])).toEqual([{target:'name',source:{kind:'input',path:['customer','names',0]}}]);
 for(const [valueType,valueText,value] of [['string','123','123'],['number','1.5',1.5],['boolean','false',false],['null','',null],['object','{"a":true}',{a:true}],['array','[1]',[1]]] as const){
  expect(parseMappingRows(graph,node,[{...row,kind:'literal',valueType,valueText}])[0]!.source).toEqual({kind:'literal',value});
 }
 for(const bad of [{target:'token'},{pathText:'["constructor"]'},{pathText:'[true]'},{kind:'node' as const,nodeId:'end'},{kind:'literal' as const,valueType:'number' as const,valueText:'"bad"'}]){
  let saved=false;expect(applyMappingRows(graph,node,[{...row,...bad}],()=>{saved=true;return {ok:true};}).ok).toBe(false);expect(saved).toBe(false);
 }
 expect(applyMappingRows(graph,node,[row,row],()=>({ok:true})).ok).toBe(false);
 expect(applyMappingRows(graph,graph.nodes[0]!,[],()=>({ok:true})).ok).toBe(false);
 expect(applyMappingRows(graph,node,[row],()=>({ok:false,error:'Refused'}))).toEqual({ok:false,error:'Refused'});
 const html=renderToStaticMarkup(createElement(NodeInputMapper,{graph,node,update:()=>({ok:true as const}),sampleInput:{customer:{name:'Ada'}}}));
 expect(html).toContain('Add mapping');expect(html).toContain('Observed example');expect(html).toContain('never secrets');
});

it('saves mappings as one undo action and executes transformed real input with captured results',async()=>{
 const store=new WorkflowEditorStore(mappingFixture()),graph=store.getSnapshot().graph,node=graph.nodes[1]!;
 const row:MappingRow={target:'label',kind:'input',nodeId:'',pathText:'["customer","labels",0]',valueType:'string',valueText:''};
 expect(applyMappingRows(graph,node,[row],inputMappings=>{store.updateNode(node.id,{inputMappings});return {ok:true};})).toEqual({ok:true});
 const run=await createWorkflowRunner(store.getSnapshot().graph,{}, {captureData:true}).run({customer:{labels:['Ada']},discarded:true});
 expect(run.output).toEqual({label:'Ada',ready:true});
 expect(run.trace.find(t=>t.nodeId==='edit')?.details?.input).toEqual({label:'Ada'});
 store.undo();expect(store.getSnapshot().graph.nodes[1]).not.toHaveProperty('inputMappings');store.redo();
 const html=renderToStaticMarkup(createElement(NodeSettings,{graph:store.getSnapshot().graph,node:store.getSnapshot().graph.nodes[1]!,hint:'Hint',update:()=>({ok:true as const}),run}));
 for(const tab of ['Inputs','Parameters','Results'])expect(html).toContain('>'+tab+'</button>');
 expect(html).toContain('role="tablist"');expect(html).toContain('role="tabpanel"');expect(html).toContain('hidden=""');
});

it('styles keyboard tabs and bounded results with scoped host theme tokens',()=>{
 expect(WORKFLOW_CSS).toContain('.wf-tabs');expect(WORKFLOW_CSS).toContain('[aria-selected="true"]');expect(WORKFLOW_CSS).toContain('.wf-results pre');expect(WORKFLOW_CSS).toContain('var(--wf-accent)');
});

it('removing all mapping rows restores unchanged incoming data rather than an empty mapped object',async()=>{
 const store=new WorkflowEditorStore(mappingFixture());const graph=store.getSnapshot().graph,node=graph.nodes[1]!;
 expect(applyMappingRows(graph,node,[],inputMappings=>{store.updateNode(node.id,{inputMappings});return {ok:true};})).toEqual({ok:true});
 expect((await createWorkflowRunner(store.getSnapshot().graph).run({original:'kept'})).output).toEqual({original:'kept',ready:true});
});
