import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createWorkflowRunner,type RunResult} from '../../packages/workflow/engine';
import {createEmptyGraph} from '../../packages/workflow/graph';
import {NodeRunResults} from './NodeRunResults';
it('shows real captured node data and honest unavailable/not-run/blocked/skipped states',async()=>{
 const render=(run:RunResult|null)=>renderToStaticMarkup(createElement(NodeRunResults,{nodeId:'end',run}));
 expect(render(null)).toContain('Not run');
 expect(render({status:'completed',output:null,trace:[{nodeId:'end',status:'completed'}]})).toContain('Data unavailable');
 expect(render({status:'completed',output:null,trace:[{nodeId:'end',status:'skipped'}]})).toContain('Skipped');
 expect(render({status:'blocked',output:null,trace:[{nodeId:'end',status:'blocked',message:'Missing path'}]})).toContain('Missing path');
 const graph={...createEmptyGraph(),nodes:[{id:'start',type:'manual',label:'Start',config:{},position:{x:0,y:0}},{id:'end',type:'output',label:'End',config:{},position:{x:250,y:0}}],edges:[{id:'one',source:'start',target:'end'}]};
 const run=await createWorkflowRunner(graph,{}, {captureData:true}).run({count:42});
 const html=render(run);expect(html).toContain('42');expect(html).toContain('Measured duration');expect(html).toContain('Unavailable');expect(html).not.toContain('confidence');
});

it('shows selected branch and real blocked diagnostic without fabricated data',async()=>{
 const graph={...createEmptyGraph(),nodes:[{id:'start',type:'manual',label:'Start',config:{},position:{x:0,y:0}},{id:'route',type:'branch',label:'Route',config:{field:'ready',operator:'equals',value:true},position:{x:250,y:0}},{id:'yes',type:'output',label:'Yes',config:{},position:{x:500,y:0}},{id:'no',type:'output',label:'No',config:{},position:{x:500,y:200}}],edges:[{id:'one',source:'start',target:'route'},{id:'two',source:'route',target:'yes',sourcePort:'true' as const},{id:'three',source:'route',target:'no',sourcePort:'false' as const}]};
 const run=await createWorkflowRunner(graph,{}, {captureData:true}).run({ready:true});
 const html=renderToStaticMarkup(createElement(NodeRunResults,{nodeId:'route',run}));expect(html).toContain('Selected branch');expect(html).toContain('<dd>true</dd>');
 const skipped=renderToStaticMarkup(createElement(NodeRunResults,{nodeId:'no',run}));expect(skipped).toContain('Skipped');expect(skipped).not.toContain('<pre>');
});

it('labels privacy-filtered actual diagnostics honestly',async()=>{
 const graph={...createEmptyGraph(),nodes:[{id:'start',type:'manual',label:'Start',config:{},position:{x:0,y:0}},{id:'end',type:'output',label:'End',config:{},position:{x:250,y:0}}],edges:[{id:'one',source:'start',target:'end'}]};
 const run=await createWorkflowRunner(graph,{}, {captureData:true}).run({name:'Example Person',count:42});
 const html=renderToStaticMarkup(createElement(NodeRunResults,{nodeId:'end',run}));expect(html).toContain('privacy-filtered');expect(html).not.toContain('Example Person');expect(html).toContain('42');
});
