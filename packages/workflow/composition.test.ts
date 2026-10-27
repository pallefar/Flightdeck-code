import {describe, it, expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createEmptyGraph, validateGraph, type Graph, type GraphNode} from './graph';
import {createWorkflowRunner} from './engine';
import {composeWorkflowFragment} from './composition';

function node(id:string, type:string, config:GraphNode['config']={}):GraphNode {
  return {id, type, label:id, position:{x:0,y:0}, config};
}
function host():Graph {
  return {...createEmptyGraph('Host'), nodes:[node('start','manual'),node('slot','unconfigured',{description:'Reviewed replacement slot'}),node('done','output')], edges:[{id:'in',source:'start',target:'slot'},{id:'out',source:'slot',target:'done'}]};
}
function fragment():Graph {
  return {...createEmptyGraph('Reviewed fragment'), nodes:[node('entry','set'),node('work','set',{fields:{answer:42}}),node('exit','set')], edges:[{id:'a',source:'entry',target:'work'},{id:'b',source:'work',target:'exit'}]};
}
function branchFragment():Graph {
  return {...createEmptyGraph('Exclusive branch'),nodes:[node('entry','set'),node('choose','branch',{field:'selected',operator:'equals',value:true}),node('yes','set',{fields:{path:'yes'}}),node('no','set',{fields:{path:'no'}}),node('exit','set')],edges:[{id:'a',source:'entry',target:'choose'},{id:'b',source:'choose',target:'yes',sourcePort:'true'},{id:'c',source:'choose',target:'no',sourcePort:'false'},{id:'d',source:'yes',target:'exit'},{id:'e',source:'no',target:'exit'}]};
}

function request() {
  return {graph:host(),slotId:'slot',namespace:'part',fragment:{graph:fragment(),entryId:'entry',exitId:'exit'}};
}

async function compose(value:unknown) {return composeWorkflowFragment(value);}

describe('native JSON admission',()=>{
  it('rejects accessors anywhere before a getter or recursive schema can run',async()=>{
    let reads=0;
    const top=Object.defineProperty(request(),'graph',{enumerable:true,get(){reads++;return host();}});
    const nested=request();nested.fragment.graph.nodes[1]!.config=Object.defineProperty({},'fields',{enumerable:true,get(){reads++;return {};}});
    for(const value of [top,nested]) {
      let error:unknown;try{await compose(value);}catch(caught){error=caught;}
      expect(reads).toBe(0);expect(String(error)).toMatch(/JSON/);
    }
  });
  it('rejects non-native own shapes, cycles and explicit structural budgets',async()=>{
    let deep:unknown=true;for(let i=0;i<1000;i++)deep={child:deep};
    const cycle:Record<string,unknown>={};cycle.child=cycle;
    const hidden=Object.defineProperty({},'hidden',{value:true});
    const sparse=Array(1),extended=Object.assign([true],{extra:true});
    const values:unknown[]=[undefined,NaN,BigInt(1),()=>true,new Date(),Object.create({inherited:true}),{[Symbol('hidden')]:true},hidden,sparse,extended,cycle,deep,JSON.parse('{"__proto__":true}'),JSON.parse('{"constructor":true}'),JSON.parse('{"prototype":true}'),Array(101).fill(true),Object.fromEntries(Array.from({length:101},(_,i)=>[`a${i}`,true])),Array.from({length:100},()=>Array.from({length:100},()=>[true,true,true])),'é'.repeat(500001)];
    for(const fields of values){
      const input=request();Object.assign(input.fragment.graph.nodes[1]!.config,{fields});
      await expect(compose(input)).rejects.toThrow(/JSON/);
    }
  });
});

describe('composition envelope',()=>{
  it('requires one strict explicit fragment descriptor without normalizing identifiers',async()=>{
    for(const value of [null,[],{}, {...request(),extra:true},{...request(),namespace:'bad space'},{...request(),namespace:'a'.repeat(33)},{...request(),slotId:' slot'},{...request(),fragment:{...request().fragment,extra:true}},{...request(),protectedSteps:[1]}]) {
      await expect(compose(value)).rejects.toThrow(/request/);
    }
  });
});

describe('explicit boundaries',()=>{
  it('replaces only a single-in/single-out builtin draft slot',async()=>{
    const absent=request();absent.slotId='absent';
    const regular=request();regular.graph.nodes[1]!.type='set';regular.graph.nodes[1]!.config={};
    const extraIn=request();extraIn.graph.edges.push({id:'extra',source:'start',target:'slot'});
    const extraOut=request();extraOut.graph.edges.push({id:'extra',source:'slot',target:'done'});
    for(const value of [absent,regular,extraIn,extraOut])await expect(compose(value)).rejects.toThrow(/slot/);
  });
  it('requires distinct identity-set entry/exit and every fragment node between them',async()=>{
    const same=request();same.fragment.exitId='entry';
    const absent=request();absent.fragment.entryId='absent';
    const changing=request();changing.fragment.graph.nodes[0]!.config={fields:{changed:true}};
    const mapped=request();mapped.fragment.graph.nodes[2]!.inputMappings=[];
    const trigger=request();trigger.fragment.graph.nodes[1]!.type='manual';trigger.fragment.graph.nodes[1]!.config={};
    const output=request();output.fragment.graph.nodes[1]!.type='output';output.fragment.graph.nodes[1]!.config={};
    const disconnected=request();disconnected.fragment.graph.nodes.push(node('unrelated','set'));
    const deadEnd=request();deadEnd.fragment.graph.nodes.push(node('dead','set'));deadEnd.fragment.graph.edges.push({id:'deadEdge',source:'work',target:'dead'});
    const intoEntry=request();intoEntry.fragment.entryId='work';
    const fromExit=request();fromExit.fragment.exitId='work';
    for(const value of [same,absent,changing,mapped,trigger,output,disconnected,deadEnd,intoEntry,fromExit])await expect(compose(value)).rejects.toThrow(/boundary/);
  });
});

describe('protected workflow structure',()=>{
  it('refuses replacement of a protected slot or missing authoritative bindings',async()=>{
    await expect(compose({...request(),protectedSteps:['slot']})).rejects.toThrow(/protect|preserv/);
    await expect(compose({...request(),protectedSteps:['missing']})).rejects.toThrow(/protect|preserv/);
    await expect(compose({...request(),protectedGates:['slot']})).rejects.toThrow(/protect|preserv/);
  });
  it('refuses disconnected host nodes and any existing or imported approval bypass',async()=>{
    const disconnected=request();disconnected.graph.nodes.push(node('unrelated','set'));
    const hostBypass=request();hostBypass.graph.nodes.splice(1,0,node('gate','approval',{reviewer:'Review team'}));hostBypass.graph.edges[0]!.source='gate';hostBypass.graph.edges.push({id:'review',source:'start',target:'gate'},{id:'bypass',source:'start',target:'done'});
    const partBypass=request();partBypass.fragment.graph.nodes=[node('entry','set'),node('choose','branch',{field:'ok',operator:'equals',value:true}),node('gate','approval',{reviewer:'Review team'}),node('exit','set')];
    partBypass.fragment.graph.edges=[{id:'a',source:'entry',target:'choose'},{id:'b',source:'choose',target:'gate',sourcePort:'true'},{id:'c',source:'choose',target:'exit',sourcePort:'false'},{id:'d',source:'gate',target:'exit'}];
    for(const value of [disconnected,hostBypass,partBypass])await expect(compose(value)).rejects.toThrow(/preserv/);
  });
});

describe('single active flow',()=>{
  it('refuses implicit fan-out and repeated branch ports before any runner is constructed',async()=>{
    const fanout=request();fanout.fragment.graph.nodes.splice(2,0,node('other','set'));fanout.fragment.graph.edges.push({id:'c',source:'work',target:'other'},{id:'d',source:'other',target:'exit'});
    const hostFanout=request();hostFanout.graph.nodes.splice(1,0,node('other','set'));hostFanout.graph.edges.push({id:'c',source:'start',target:'other'},{id:'d',source:'other',target:'done'});
    const duplicate=request();duplicate.fragment.graph=branchFragment();duplicate.fragment.graph.edges[2]!.sourcePort='true';
    const incomplete=request();incomplete.fragment.graph=branchFragment();incomplete.fragment.graph.edges.splice(2,1);incomplete.fragment.graph.nodes.splice(3,1);incomplete.fragment.graph.edges.pop();
    for(const value of [fanout,hostFanout,duplicate,incomplete])await expect(compose(value)).rejects.toThrow(/flow/);
  });
});

describe('expanded budgets',()=>{
  it('accepts exactly the expanded node and custom-definition ceilings',async()=>{
    const input=request();input.graph.nodes=Array.from({length:98},(_,i)=>node(`n${i}`,i===0?'manual':i===1?'unconfigured':i===97?'output':'set',i===1?{description:'Slot'}:{}));input.slotId='n1';input.graph.edges=input.graph.nodes.slice(1).map((n,i)=>({id:`e${i}`,source:`n${i}`,target:n.id}));
    input.graph.customBlocks=Array.from({length:49},(_,i)=>({id:`b${i}`,label:'Reviewed',baseType:'set',defaults:{},description:''}));input.fragment.graph.customBlocks=[{id:'local',label:'Reviewed',baseType:'set',defaults:{},description:''}];
    const result=await compose(input);expect(result.graph.nodes).toHaveLength(100);expect(result.graph.customBlocks).toHaveLength(50);
    expect((await createWorkflowRunner(result.graph).run({})).status).toBe('completed');
  });
  it('checks aggregate node, edge and wrapper limits rather than only individual graphs',async()=>{
    const nodes=request();nodes.graph.nodes=Array.from({length:99},(_,i)=>node(`n${i}`,i===0?'manual':i===1?'unconfigured':i===98?'output':'set',i===1?{description:'Slot'}:{}));nodes.slotId='n1';nodes.graph.edges=nodes.graph.nodes.slice(1).map((n,i)=>({id:`e${i}`,source:`n${i}`,target:n.id}));
    const edges=request();edges.fragment.graph=branchFragment();edges.graph.nodes=[node('start','manual')];edges.graph.edges=[];
    let previous='start';
    for(let i=0;i<19;i++){
      edges.graph.nodes.push(node(`b${i}`,'branch',{field:'ok',operator:'equals',value:true}),node(`y${i}`,'set'),node(`n${i}`,'set'),node(`j${i}`,'set'));
      edges.graph.edges.push({id:`a${i}`,source:previous,target:`b${i}`},{id:`b${i}`,source:`b${i}`,target:`y${i}`,sourcePort:'true'},{id:`c${i}`,source:`b${i}`,target:`n${i}`,sourcePort:'false'},{id:`d${i}`,source:`y${i}`,target:`j${i}`},{id:`e${i}`,source:`n${i}`,target:`j${i}`});previous=`j${i}`;
    }
    edges.graph.nodes.push(node('slot','unconfigured',{description:'Slot'}),node('done','output'));edges.graph.edges.push({id:'in',source:previous,target:'slot'},{id:'out',source:'slot',target:'done'});
    const blocks=request();blocks.graph.customBlocks=Array.from({length:50},(_,i)=>({id:`b${i}`,label:'Reviewed',baseType:'set',defaults:{},description:''}));blocks.fragment.graph.customBlocks=[{id:'local',label:'Reviewed',baseType:'set',defaults:{},description:''}];
    for(const value of [nodes,edges,blocks]){
      const before=structuredClone(value);await expect(compose(value)).rejects.toThrow(/budget/);expect(value).toEqual(before);
    }
  });
});

describe('unchanged graph-schema admission',()=>{
  it('rejects cycles, invalid references, unsafe mappings and reserved/unknown definitions without mutation',async()=>{
    const unknown=request();unknown.fragment.graph.nodes[1]!.type='subflow';
    const cycle=request();cycle.fragment.graph.edges.push({id:'cycle',source:'exit',target:'entry'});
    const dangling=request();dangling.fragment.graph.edges[0]!.target='missing';
    const duplicate=request();duplicate.fragment.graph.nodes[1]!.id='entry';
    const badPort=request();badPort.fragment.graph.edges[0]!.sourcePort='true';
    const secret=request();secret.fragment.graph.nodes[1]!.config={fields:{nested:{password:'refused'}}};
    const reserved=request();reserved.fragment.graph.customBlocks=[{id:'set',label:'Override',baseType:'set',defaults:{},description:''}];
    const customApproval=request();Object.assign(customApproval.fragment.graph,{customBlocks:[{id:'gate',label:'Unsafe wrapper',baseType:'approval',defaults:{},description:''}]});
    const self=request();self.fragment.graph.nodes[1]!.inputMappings=[{target:'self',source:{kind:'node',nodeId:'work',path:[]}}];
    const path=request();path.fragment.graph.nodes[1]!.inputMappings=[{target:'value',source:{kind:'input',path:['constructor']}}];
    const deepPath=request();deepPath.fragment.graph.nodes[1]!.inputMappings=[{target:'value',source:{kind:'input',path:Array(17).fill('child')}}];
    const literal=request();literal.fragment.graph.nodes[1]!.inputMappings=[{target:'value',source:{kind:'literal',value:Array(10).fill('é'.repeat(1000))}}];
    for(const value of [unknown,cycle,dangling,duplicate,badPort,secret,reserved,customApproval,self,path,deepPath,literal]){
      const before=structuredClone(value);expect(validateGraph(value.fragment.graph).ok).toBe(false);
      await expect(compose(value)).rejects.toThrow('Invalid graph');expect(value).toEqual(before);
    }
  });
});

describe('unchanged runner integration',()=>{
  it('preserves inbound and internal branch ports with namespaced branch-wrapper defaults',async()=>{
    const input=request();input.fragment.graph=branchFragment();
    input.fragment.graph.customBlocks=[{id:'decide',label:'Reviewed condition',baseType:'branch',defaults:{field:'selected',operator:'equals',value:true},description:'Reviewed branch wrapper'}];
    input.fragment.graph.nodes[1]!.type='decide';input.fragment.graph.nodes[1]!.config={};
    input.fragment.graph.nodes[1]!.inputMappings=[{target:'selected',source:{kind:'input',path:['nested','ok']}}];
    input.graph.nodes.splice(1,0,node('route','branch',{field:'route',operator:'equals',value:true}),node('outside','set',{fields:{path:'outside'}}));
    input.graph.edges=[{id:'a',source:'start',target:'route'},{id:'in',source:'route',target:'slot',sourcePort:'true'},{id:'b',source:'route',target:'outside',sourcePort:'false'},{id:'out',source:'slot',target:'done',sourcePort:'default'},{id:'c',source:'outside',target:'done'}];
    const result=await compose(input);
    expect(result.graph.edges.find(e=>e.id==='in')).toEqual({id:'in',source:'route',target:'part_n0',sourcePort:'true'});
    expect(result.graph.edges.find(e=>e.id==='out')).toEqual({id:'out',source:'part_n4',target:'done',sourcePort:'default'});
    expect(result.graph.edges.filter(e=>e.source==='part_n1').map(e=>e.sourcePort)).toEqual(['true','false']);
    for(const selected of [true,false]){
      const run=await createWorkflowRunner(result.graph).run({route:true,nested:{ok:selected}});
      expect(run.status).toBe('completed');expect(run.output).toEqual({selected,path:selected?'yes':'no'});
      expect(run.trace.find(t=>t.nodeId==='part_n1')?.details?.selectedPort).toBe(selected?'true':'false');
      expect(run.trace.find(t=>t.nodeId===result.ids.nodes[selected?'no':'yes'])?.status).toBe('skipped');
    }
    const outside=await createWorkflowRunner(result.graph).run({route:false,nested:{ok:true}});
    expect(outside.output).toEqual({route:false,nested:{ok:true},path:'outside'});
    expect(outside.trace.filter(t=>t.nodeId.startsWith('part_')).every(t=>t.status==='skipped')).toBe(true);
  });
  it('retains protected manual/approval nodes and still requires two real independent pause capabilities',async()=>{
    const input=request();input.graph.nodes.splice(1,0,node('hostGate','approval',{reviewer:'Host reviewers',reason:'Original protected gate'}));
    input.graph.edges[0]!.source='hostGate';input.graph.edges.unshift({id:'review',source:'start',target:'hostGate'});
    input.fragment.graph.nodes[1]!.type='approval';input.fragment.graph.nodes[1]!.config={reviewer:'Fragment reviewers',reason:'Imported unavoidable gate'};
    const before=structuredClone(input);
    const result=await compose({...input,protectedSteps:['start','hostGate','done'],protectedGates:['hostGate']});
    for(const id of ['start','hostGate','done'])expect(result.graph.nodes.find(n=>n.id===id)).toEqual(before.graph.nodes.find(n=>n.id===id));
    const verifications:{nodeId:string;reviewer:string;initiator:string}[]=[];
    const runner=createWorkflowRunner(result.graph,{authorizeHuman:async(authorization,context)=>{
      verifications.push({nodeId:context.nodeId,reviewer:context.reviewer,initiator:context.initiator});
      return authorization.humanName==='Independent reviewer'&&authorization.proof==='fixture-only-verifier-proof';
    }},{initiator:'Creator'});
    const first=await runner.run({answer:42});expect(first.status).toBe('paused');expect(first.pendingNodeId).toBe('hostGate');expect(verifications).toEqual([]);
    expect((await runner.resume(first,{humanName:'Creator',proof:'fixture-only-verifier-proof'})).status).toBe('blocked');
    expect((await runner.resume({...first},{humanName:'Independent reviewer',proof:'fixture-only-verifier-proof'})).status).toBe('blocked');
    const second=await runner.resume(first,{humanName:'Independent reviewer',proof:'fixture-only-verifier-proof'});
    expect(second.status).toBe('paused');expect(second.pendingNodeId).toBe('part_n1');
    const complete=await runner.resume(second,{humanName:'Independent reviewer',proof:'fixture-only-verifier-proof'});
    expect(complete.status).toBe('completed');expect(complete.output).toEqual({answer:42});
    expect(verifications).toEqual([{nodeId:'hostGate',reviewer:'Host reviewers',initiator:'Creator'},{nodeId:'part_n1',reviewer:'Fragment reviewers',initiator:'Creator'}]);
    expect((await runner.resume(second,{humanName:'Independent reviewer',proof:'fixture-only-verifier-proof'})).status).toBe('blocked');
    expect(input).toEqual(before);
  });
  it('keeps an LLM node as one bounded injected adapter call, not an agent SDK',async()=>{
    const input=request();input.fragment.graph.nodes[1]!.type='llm';input.fragment.graph.nodes[1]!.config={instruction:'One deterministic fixture transform',model:'fixture-only'};
    const result=await compose(input);let calls=0;
    expect((await createWorkflowRunner(result.graph).run({value:7})).status).toBe('blocked');
    const adapters={llm:async(q:{instruction:string;input:unknown;signal:AbortSignal})=>{
      calls++;expect(q.instruction).toBe('One deterministic fixture transform');expect(q.input).toEqual({value:7});expect(q.signal).toBeInstanceOf(AbortSignal);return {fixture:'one adapter response'};
    }};
    const bounded=await createWorkflowRunner(result.graph,adapters,{maxSteps:1}).run({value:7});expect(bounded.status).toBe('blocked');expect(calls).toBe(0);
    const run=await createWorkflowRunner(result.graph,adapters,{maxSteps:100,timeoutMs:100}).run({value:7});
    expect(run.status).toBe('completed');expect(run.output).toEqual({fixture:'one adapter response'});expect(calls).toBe(1);
  });
  it('accepts shared native JSON and returns a fully detached graph from frozen snapshots',async()=>{
    const input=request();const shared={value:'kept'};input.fragment.graph.nodes[1]!.config={fields:{a:shared,b:shared}};
    const frozen=new WeakSet<object>();const freeze=(v:unknown):void=>{if(v===null||typeof v!=='object'||frozen.has(v))return;frozen.add(v);Object.values(v).forEach(freeze);Object.freeze(v);};freeze(input);
    const before=JSON.stringify(input);const result=await compose(input);
    const run=await createWorkflowRunner(result.graph).run({});expect(run.output).toEqual({a:{value:'kept'},b:{value:'kept'}});
    const fields=result.graph.nodes[2]!.config.fields as {a:{value:string};b:{value:string}};
    fields.a.value='detached';expect(fields.b.value).toBe('kept');
    result.graph.nodes[1]!.position.x=123;result.graph.nodes[2]!.config.fields={changed:true};
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('runnable deterministic example',()=>{
  it('executes the actual tsx example with deterministic branch and independent-approval results',()=>{
    const execution=spawnSync(process.execPath,['--import','tsx','examples/workflow-composition.ts'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',timeout:10000});
    expect(execution.status,execution.stderr).toBe(0);
    expect(JSON.parse(execution.stdout)).toEqual({
      scope:'Local declarative DAG composition; no agent SDK or external calls',
      nodeCount:9,
      trueBranch:{status:'completed',output:{selected:true,path:'yes'},skipped:['demo_n3']},
      falseBranch:{status:'completed',output:{selected:false,path:'no'},skipped:['demo_n2']},
      independentApproval:{paused:'paused',pendingNodeId:'review',selfApproval:'blocked',resumed:'completed',output:{selected:true,path:'yes'},verifierCalls:1},
    });
  });
});

describe('declarative fragment composition',()=>{
  it('namespaces actual wrapper definitions and remaps only declared node-reference fields',async()=>{
    const input=request();
    input.graph.customBlocks=[{id:'enrich',label:'Host wrapper',baseType:'set',defaults:{fields:{local:'incoming'}},description:'Reviewed host definition'}];
    input.graph.nodes.splice(1,0,node('before','enrich'));
    input.graph.edges[0]!.source='before';input.graph.edges.unshift({id:'beforeEdge',source:'start',target:'before'});
    input.graph.nodes.at(-1)!.inputMappings=[{target:'result',source:{kind:'node',nodeId:'slot',path:['selected']}},{target:'seed',source:{kind:'input',path:['original']}}];
    input.fragment.graph.customBlocks=[{id:'enrich',label:'Fragment wrapper',baseType:'set',defaults:{fields:{answer:42}},description:'Reviewed fragment definition'}];
    const work=input.fragment.graph.nodes[1]!;work.type='enrich';work.config={};
    work.inputMappings=[
      {target:'selected',source:{kind:'node',nodeId:'entry',path:['local']}},
      {target:'seed',source:{kind:'input',path:['original']}},
      {target:'literal',source:{kind:'literal',value:{entry:'entry',text:'No interpolation: entry'}}},
    ];
    const before=structuredClone(input);const result=await compose(input);
    expect(result.ids.customBlocks).toEqual({enrich:'part_b0'});
    expect(result.graph.customBlocks).toEqual([before.graph.customBlocks[0],{...before.fragment.graph.customBlocks[0],id:'part_b0'}]);
    const inserted=result.graph.nodes.find(n=>n.id==='part_n1')!;
    expect(inserted.type).toBe('part_b0');expect(inserted.config).toEqual({});
    expect(inserted.inputMappings).toEqual([{target:'selected',source:{kind:'node',nodeId:'part_n0',path:['local']}},...before.fragment.graph.nodes[1]!.inputMappings!.slice(1)]);
    expect(result.graph.nodes.at(-1)!.inputMappings![0]!.source).toEqual({kind:'node',nodeId:'part_n2',path:['selected']});
    const run=await createWorkflowRunner(result.graph).run({original:'seed',local:'original value'});
    expect(run.status).toBe('completed');expect(run.output).toEqual({result:'incoming',seed:'seed'});
    expect(input).toEqual(before);
  });

  it('allocates deterministic collision suffixes without concatenating long local IDs',async()=>{
    const input=request();
    input.graph.nodes[0]!.id='part_n0';input.graph.nodes[2]!.id='part_n0_2';
    input.graph.edges=[{id:'part_e0',source:'part_n0',target:'slot'},{id:'part_e0_2',source:'slot',target:'part_n0_2'}];
    const definition={id:'part_b0',label:'Existing',baseType:'set' as const,defaults:{fields:{}},description:'Reviewed'};
    input.graph.customBlocks=[definition,{...definition,id:'part_b0_2'}];
    input.fragment.graph.customBlocks=[{...definition,id:'local'}];
    input.fragment.graph.nodes[1]!.type='local';input.fragment.graph.nodes[1]!.config={};
    const long='A'.repeat(64);input.fragment.graph.nodes[0]!.id=long;input.fragment.entryId=long;input.fragment.graph.edges[0]!.source=long;
    const result=await compose(input);
    expect(result.ids.nodes[long]).toBe('part_n0_3');expect(result.ids.edges.a).toBe('part_e0_3');expect(result.ids.customBlocks.local).toBe('part_b0_3');
    expect(await compose(input)).toEqual(result);
    const maximum=await compose({...input,namespace:'A'.repeat(32)});
    for(const id of [...maximum.graph.nodes,...maximum.graph.edges,...maximum.graph.customBlocks].map(item=>item.id))expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
    expect((await createWorkflowRunner(result.graph).run({ok:true})).status).toBe('completed');
  });

  it('reuses a reviewed snapshot through explicit bounded calls without nested execution',async()=>{
    const input=request();input.graph.nodes.splice(2,0,node('slot2','unconfigured',{description:'Second explicit slot'}));
    input.graph.edges[1]!.target='slot2';input.graph.edges.push({id:'last',source:'slot2',target:'done'});
    input.graph.nodes.at(-1)!.inputMappings=[{target:'first',source:{kind:'node',nodeId:'slot',path:['answer']}},{target:'second',source:{kind:'node',nodeId:'slot2',path:['answer']}}];
    const before=structuredClone(input);const first=await compose(input);
    const second=await compose({...input,graph:first.graph,slotId:'slot2'});
    expect(second.ids.nodes).toEqual({entry:'part_n0_2',work:'part_n1_2',exit:'part_n2_2'});
    expect(second.graph.nodes.some(n=>n.type==='subflow'||n.type==='unconfigured')).toBe(false);
    expect((await createWorkflowRunner(second.graph).run({})).output).toEqual({first:42,second:42});
    expect(input).toEqual(before);expect(first.graph.nodes.some(n=>n.id==='slot2')).toBe(true);
  });
  it('treats prototype-shaped identifier values as literal IDs, never inherited dictionary lookups',async()=>{
    const input=request();input.fragment.graph.nodes[0]!.id='constructor';input.fragment.entryId='constructor';input.fragment.graph.edges[0]!.source='constructor';
    const result=await compose(input);expect(Object.hasOwn(result.ids.nodes,'constructor')).toBe(true);expect(result.ids.nodes.constructor).toBe('part_n0');
    expect((await createWorkflowRunner(result.graph).run({})).output).toEqual({answer:42});
  });
  it('flattens one explicit slot deterministically into the unchanged real runner',async()=>{
    const input=request();const before=JSON.stringify(input);
    const result=await compose(input);
    expect(result.graph.nodes.map(n=>n.id)).toEqual(['start','part_n0','part_n1','part_n2','done']);
    expect(result.graph.edges).toEqual([
      {id:'in',source:'start',target:'part_n0'},
      {id:'out',source:'part_n2',target:'done'},
      {id:'part_e0',source:'part_n0',target:'part_n1'},
      {id:'part_e1',source:'part_n1',target:'part_n2'},
    ]);
    expect(result.ids.nodes).toEqual({entry:'part_n0',work:'part_n1',exit:'part_n2'});
    expect(await compose(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    const run=await createWorkflowRunner(result.graph).run({seed:'kept'});
    expect(run.status).toBe('completed');expect(run.output).toEqual({seed:'kept',answer:42});
    expect(run.trace.map(t=>t.nodeId)).toEqual(['start','part_n0','part_n1','part_n2','done']);
  });
});
