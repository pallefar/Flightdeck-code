import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createWorkflowRunner,type RunResult} from '../../packages/workflow/engine';
import {createEmptyGraph} from '../../packages/workflow/graph';
import {chain} from '../../packages/workflow/test-helpers';
import {NodeRunResults,NodeRunStatus,localNodeRunEntry} from './NodeRunResults';
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

it('selects the last matching local trace entry without mutating it and keeps Results on that entry',()=>{
 expect(typeof localNodeRunEntry).toBe('function');
 const run:RunResult={status:'completed',output:null,trace:[
  {nodeId:'end',status:'blocked',message:'Earlier diagnostic',details:{durationMs:1,errorCode:'EARLIER'}},
  {nodeId:'other',status:'skipped'},
  {nodeId:'end',status:'completed',details:{durationMs:2,input:{latest:42},output:{latest:43}}},
  {nodeId:'after',status:'completed'},
 ]};
 const before=JSON.stringify(run);run.trace.forEach(Object.freeze);Object.freeze(run.trace);
 expect(localNodeRunEntry('end',run)).toBe(run.trace[2]);
 expect(localNodeRunEntry('absent',run)).toBeUndefined();
 expect(localNodeRunEntry('end',null)).toBeUndefined();
 expect(localNodeRunEntry('end',{status:'blocked',output:null,trace:[]})).toBeUndefined();
 expect(JSON.stringify(run)).toBe(before);
 const html=renderToStaticMarkup(createElement(NodeRunResults,{nodeId:'end',run}));
 expect(html).toContain('<p role="status">Completed</p>');expect(html).toContain('43');
 expect(html).not.toContain('Earlier diagnostic');expect(html).not.toContain('EARLIER');
});

it('renders no local status before a run exists',()=>{
 expect(typeof NodeRunStatus).toBe('function');
 expect(renderToStaticMarkup(createElement(NodeRunStatus,{nodeId:'end',run:null}))).toBe('');
 expect(renderToStaticMarkup(createElement(NodeRunStatus,{nodeId:'end',run:null,id:'unused-status'}))).toBe('');
});

const renderStatus=(nodeId:string,run:RunResult|null)=>renderToStaticMarkup(createElement(NodeRunStatus,{nodeId,run}));
it.each(['completed','paused','blocked'] as const)('keeps an unrecorded node Not reached when the overall run is %s',status=>{
 const html=renderStatus('absent',{status,output:null,trace:[{nodeId:'other',status:'completed'}]});
 expect(html).toContain('<span class="wf-node-run-status" data-local-run-status="not-reached"');
 expect(html).toContain('>Not reached<');expect(html).not.toMatch(/\b(?:Completed|Skipped|Paused|Blocked|Queued|Running)\b/);
 expect(html).not.toMatch(/\b(?:role|tabindex|aria-live)=|<(?:button|a)\b/);
});
it('keeps every node Not reached after a real trace-less admission refusal',async()=>{
 const graph=chain(['manual','output','set']);const run=await createWorkflowRunner(graph).run();
 expect(run.status).toBe('blocked');expect(run.trace).toEqual([]);
 for(const node of graph.nodes){const html=renderStatus(node.id,run);expect(html).toContain('data-local-run-status="not-reached"');expect(html).toContain('>Not reached<');expect(html).not.toContain('Blocked');}
});

function expectLocalStatus(nodeId:string,run:RunResult,status:string,label:string){
 const html=renderStatus(nodeId,run);
 expect(html).toContain(`data-local-run-status="${status}"`);expect(html).toContain(`>${label}<`);
 expect(html).not.toMatch(/\b(?:role|tabindex|aria-live)=|<(?:button|a)\b/);
 const results=renderToStaticMarkup(createElement(NodeRunResults,{nodeId,run}));
 expect(results).toContain(`<p role="status">${status==='not-reached'?'Not reached in this run':label}</p>`);
}
it.each([true,false])('renders actual completed and skipped node records from a real branch run with ready=%s',async ready=>{
 const graph=chain(['manual','branch','set','set','output']);graph.nodes[1]!.config={field:'ready',operator:'equals',value:true};
 graph.edges=[{id:'a',source:'n0',target:'n1'},{id:'b',source:'n1',target:'n2',sourcePort:'true'},{id:'c',source:'n1',target:'n3',sourcePort:'false'},{id:'d',source:'n2',target:'n4'},{id:'e',source:'n3',target:'n4'}];
 const run=await createWorkflowRunner(graph,{}, {captureData:true}).run({ready});
 expect(run.status).toBe('completed');expect(run.output).toEqual({ready,answer:42});
 expectLocalStatus('n0',run,'completed','Completed');expectLocalStatus('n1',run,'completed','Completed');
 expectLocalStatus('n2',run,ready?'completed':'skipped',ready?'Completed':'Skipped');
 expectLocalStatus('n3',run,ready?'skipped':'completed',ready?'Skipped':'Completed');
 expectLocalStatus('n4',run,'completed','Completed');
});
it('renders only the actual approval gate Paused and leaves its downstream Not reached',async()=>{
 const graph=chain(['manual','approval','output']);graph.nodes[1]!.config={reviewer:'Development reviewers'};
 const run=await createWorkflowRunner(graph,{}, {captureData:true}).run({ready:true});
 expect(run.status).toBe('paused');expect(run.pendingNodeId).toBe('n1');expect(run.trace.map(entry=>entry.nodeId)).toEqual(['n0','n1']);
 expectLocalStatus('n0',run,'completed','Completed');expectLocalStatus('n1',run,'paused','Paused');expectLocalStatus('n2',run,'not-reached','Not reached');
});
it.each(['approval','http'])('renders only the actual unconfigured %s block Blocked without downstream inference',async type=>{
 const graph=chain(['manual',type,'output']);const run=await createWorkflowRunner(graph,{}, {captureData:true}).run({ready:true});
 expect(run.status).toBe('blocked');expect(run.trace.map(entry=>entry.status)).toEqual(['completed','blocked']);
 expectLocalStatus('n0',run,'completed','Completed');expectLocalStatus('n1',run,'blocked','Blocked');expectLocalStatus('n2',run,'not-reached','Not reached');
});
it.each(['completed','skipped','paused','blocked'] as const)('renders a legacy %s trace record without requiring diagnostic details',status=>{
 const run:RunResult={status:'completed',output:null,trace:[{nodeId:'legacy',status}]};
 expectLocalStatus('legacy',run,status,status[0]!.toUpperCase()+status.slice(1));
 expect(renderStatus('legacy',run)).not.toMatch(/Selected branch|Observed branch|undefined|NaN/);
});
it('renders the latest duplicate node record rather than its earlier status or another node',()=>{
 const run:RunResult={status:'blocked',output:null,trace:[{nodeId:'gate',status:'skipped'},{nodeId:'other',status:'completed'},{nodeId:'gate',status:'paused'},{nodeId:'last',status:'blocked'}]};
 expectLocalStatus('gate',run,'paused','Paused');
});

const localScope='Last local result for this applied graph; changes to execution input or unapplied settings have not been rerun.';
it('exposes bounded payload-free local scope as title and referenced text for a parent header button',()=>{
 const run:RunResult={status:'blocked',output:{sentinel:'RUN_OUTPUT_SENTINEL'},reason:'RUN_REASON_SENTINEL',pendingNodeId:'PENDING_NODE_SENTINEL',trace:[{
  nodeId:'NODE_ID_SENTINEL',status:'completed',message:'NODE_ERROR_MESSAGE_SENTINEL',humanName:'HUMAN_NAME_SENTINEL',
  details:{durationMs:987654321.123,errorCode:'ERROR_CODE_SENTINEL',input:{sentinel:'INPUT_SENTINEL'},output:{sentinel:'OUTPUT_SENTINEL',large:'X'.repeat(20000),selectedPort:'false'}},
 }]};
 const before=JSON.stringify(run);const id='local-run-description';
 const html=renderToStaticMarkup(createElement(NodeRunStatus,{nodeId:'NODE_ID_SENTINEL',run,id}));
 expect(html).toBe(`<span class="wf-node-run-status" data-local-run-status="completed" id="${id}" title="${localScope}">Completed<span class="wf-sr-only"> — ${localScope}</span></span>`);
 const header=renderToStaticMarkup(createElement('header',null,createElement('button',{'aria-describedby':id},'Open node settings'),createElement(NodeRunStatus,{nodeId:'NODE_ID_SENTINEL',run,id})));
 expect(header).toContain(`<button aria-describedby="${id}">Open node settings</button>${html}`);
 expect(html).not.toMatch(/SENTINEL|987654321|Selected branch|Observed branch|false|role=|tabindex=|aria-live=/);
 expect(html.length).toBeLessThan(800);expect(JSON.stringify(run)).toBe(before);
 expect(renderStatus('NODE_ID_SENTINEL',run)).not.toContain(' id=');
 const missing=renderStatus('absent',run);expect(missing).toContain(`title="${localScope}"`);expect(missing).toContain(`<span class="wf-sr-only"> — ${localScope}</span>`);
});

it.each([true,false])('describes only the observed branch port in actual details for ready=%s',async ready=>{
 const graph=chain(['manual','branch','output','output']);graph.nodes[1]!.config={field:'ready',operator:'equals',value:true};
 graph.edges=[{id:'a',source:'n0',target:'n1'},{id:'b',source:'n1',target:'n2',sourcePort:'true'},{id:'c',source:'n1',target:'n3',sourcePort:'false'}];
 const run=await createWorkflowRunner(graph,{}, {captureData:true}).run({ready,selectedPort:ready?'false':'true'});
 const port=ready?'true':'false';expect(localNodeRunEntry('n1',run)?.details?.selectedPort).toBe(port);
 const html=renderStatus('n1',run);const description=`${localScope} Observed branch: ${port}.`;
 expect(html).toContain(`title="${description}">Completed<span class="wf-sr-only"> — ${description}</span>`);
 for(const nodeId of ['n0','n2','n3','absent'])expect(renderStatus(nodeId,run)).not.toContain('Observed branch');
});
it('describes branch observation from the latest matching entry only',()=>{
 const run:RunResult={status:'completed',output:null,trace:[{nodeId:'route',status:'completed',details:{durationMs:1,selectedPort:'true'}},{nodeId:'other',status:'completed',details:{durationMs:1,selectedPort:'true'}},{nodeId:'route',status:'completed',details:{durationMs:1,selectedPort:'false'}}]};
 const html=renderStatus('route',run);expect(html).toContain('Observed branch: false.');expect(html).not.toContain('Observed branch: true.');
 run.trace.push({nodeId:'route',status:'completed'});
 expect(renderStatus('route',run)).not.toContain('Observed branch');
});

it.each([
 {name:'unrecognized string',value:'BRANCH_PAYLOAD_SENTINEL'},
 {name:'uppercase string',value:'TRUE'},
 {name:'padded string',value:'true '},
 {name:'boolean true',value:true},
 {name:'boolean false',value:false},
 {name:'positive number',value:1},
 {name:'zero',value:0},
 {name:'null',value:null},
 {name:'payload object',value:{payload:'BRANCH_PAYLOAD_SENTINEL'}},
])('does not describe or leak a malformed selectedPort: $name',({value})=>{
 const run:RunResult={status:'completed',output:null,trace:[{nodeId:'route',status:'completed',details:{durationMs:1}}]};
 // Deliberately malformed local DTO fixture; never a provider or production result.
 Object.assign(run.trace[0]!.details!,{selectedPort:value});
 const html=renderStatus('route',run);
 expect(html).toContain(`title="${localScope}">Completed<span class="wf-sr-only"> — ${localScope}</span>`);
 expect(html).not.toMatch(/Observed branch|BRANCH_PAYLOAD_SENTINEL|\[object Object\]/);
});
