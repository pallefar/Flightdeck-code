import assert from 'node:assert/strict';
import {composeWorkflowFragment} from '../packages/workflow/composition';
import {createEmptyGraph, validateGraph, type Graph, type GraphNode} from '../packages/workflow/graph';
import {createWorkflowRunner, type HumanAuthorization, type RunResult} from '../packages/workflow/engine';

// Offline, non-secret fixtures only. This verifier is NOT a production identity service.
const authorization:HumanAuthorization={humanName:'Independent fixture reviewer',proof:'nonsecret-fixture-proof'};
const node=(id:string,type:string,config:GraphNode['config']={}):GraphNode=>({id,type,label:id,position:{x:0,y:0},config});
const host:Graph={...createEmptyGraph('Local composition example'),nodes:[
  node('start','manual'),
  node('prepare','set',{fields:{prepared:true}}),
  node('slot','unconfigured',{description:'Explicit reviewed fragment insertion slot'}),
  node('review','approval',{reviewer:'Independent fixture reviewers',reason:'Review actual composed branch result'}),
  node('done','output'),
],edges:[
  {id:'a',source:'start',target:'prepare'},
  {id:'b',source:'prepare',target:'slot'},
  {id:'c',source:'slot',target:'review'},
  {id:'d',source:'review',target:'done'},
]};
const fragment:Graph={...createEmptyGraph('Reviewed exclusive branch fragment'),nodes:[
  node('entry','set'),
  {...node('choose','branch',{field:'selected',operator:'equals',value:true}),inputMappings:[{target:'selected',source:{kind:'input',path:['requested']}}]},
  node('yes','set',{fields:{path:'yes'}}),
  node('no','set',{fields:{path:'no'}}),
  node('exit','set'),
],edges:[
  {id:'a',source:'entry',target:'choose'},
  {id:'b',source:'choose',target:'yes',sourcePort:'true'},
  {id:'c',source:'choose',target:'no',sourcePort:'false'},
  {id:'d',source:'yes',target:'exit'},
  {id:'e',source:'no',target:'exit'},
]};
assert.equal(validateGraph(host).ok,true);
assert.equal(validateGraph(fragment).ok,true);
const composed=composeWorkflowFragment({graph:host,slotId:'slot',namespace:'demo',fragment:{graph:fragment,entryId:'entry',exitId:'exit'},protectedSteps:['start','prepare','review','done'],protectedGates:['review']});
assert.equal(validateGraph(composed.graph).ok,true);
const fixtureVerifier=(value:HumanAuthorization)=>value.humanName===authorization.humanName&&value.proof===authorization.proof;

async function runBranch(requested:boolean) {
  const runner=createWorkflowRunner(composed.graph,{authorizeHuman:async value=>fixtureVerifier(value)},{initiator:'Fixture creator'});
  const paused=await runner.run({requested});assert.equal(paused.status,'paused');
  const run=await runner.resume(paused,authorization);assert.equal(run.status,'completed');
  assert.deepEqual(run.output,{selected:requested,path:requested?'yes':'no'});
  return {status:run.status,output:run.output,skipped:run.trace.filter(entry=>entry.status==='skipped').map(entry=>entry.nodeId)};
}
const trueBranch=await runBranch(true);
const falseBranch=await runBranch(false);
let verifierCalls=0;
const runner=createWorkflowRunner(composed.graph,{authorizeHuman:async value=>{verifierCalls++;return fixtureVerifier(value);}},{initiator:'Fixture creator'});
const paused:RunResult=await runner.run({requested:true});assert.equal(paused.status,'paused');assert.equal(verifierCalls,0);
const self=await runner.resume(paused,{humanName:'Fixture creator',proof:authorization.proof});assert.equal(self.status,'blocked');assert.equal(verifierCalls,0);
const resumed=await runner.resume(paused,authorization);assert.equal(resumed.status,'completed');assert.equal(verifierCalls,1);
assert.equal((await runner.resume(paused,authorization)).status,'blocked');
console.log(JSON.stringify({
  scope:'Local declarative DAG composition; no agent SDK or external calls',
  nodeCount:composed.graph.nodes.length,
  trueBranch,falseBranch,
  independentApproval:{paused:paused.status,pendingNodeId:paused.pendingNodeId,selfApproval:self.status,resumed:resumed.status,output:resumed.output,verifierCalls},
},null,2));
