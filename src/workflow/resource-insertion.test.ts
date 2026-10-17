import {expect,it} from 'vitest';
import {WorkflowEditorStore} from './store';
const ref={resourceId:'ba9acba0-752e-4c44-8c4a-603754b44a18',revision:2,functionId:'measure'};
it('inserts a reference with literal parameters in one undo without replacing the document',()=>{
 const s=new WorkflowEditorStore();s.addNode('manual');s.rename('Prior saved document');
 const before=s.getSnapshot().graph;const parameters={query:'reviewed',options:{limit:3},values:[1,true]};
 const id=s.addResourceNode({...ref,parameters});const after=s.getSnapshot().graph;
 expect(after.id).toBe(before.id);expect(after.name).toBe(before.name);expect(after.edges).toEqual(before.edges);
 expect(after.nodes.at(-1)).toMatchObject({id,type:'resource',config:ref,inputMappings:[{target:'query',source:{kind:'literal',value:'reviewed'}},{target:'options',source:{kind:'literal',value:{limit:3}}},{target:'values',source:{kind:'literal',value:[1,true]}}]});
 parameters.options.limit=99;expect(after.nodes.at(-1)?.inputMappings?.[1]?.source).toEqual({kind:'literal',value:{limit:3}});
 expect(before.nodes).toHaveLength(1);s.undo();expect(s.getSnapshot().graph).toEqual(before);s.redo();expect(s.getSnapshot().graph).toEqual(after);
});
it('rejects unsafe transactions without touching undo, redo or prior graph',()=>{
 const s=new WorkflowEditorStore();s.addNode('manual');s.rename('Changed');s.undo();
 const before=s.getSnapshot();let reads=0;const accessor=Object.defineProperty({},'query',{enumerable:true,get(){reads++;return 'unsafe';}});
 const cycle:Record<string,unknown>={};cycle.self=cycle;
 for(const parameters of [{headers:{accept:'json'}},{options:{destination:'private'}},{credentialRef:'vault'},accessor,cycle,[],null,{query:'x'.repeat(11000)}]) {
  expect(()=>s.addResourceNode({...ref,parameters})).toThrow();expect(s.getSnapshot()).toBe(before);
 }
 expect(reads).toBe(0);expect(()=>s.addResourceNode({...ref,revision:0,parameters:{}})).toThrow();
 expect(()=>s.addResourceNode({...ref,parameters:{},endpoint:'https://example.com'} as typeof ref & {parameters:unknown})).toThrow();
 s.redo();expect(s.getSnapshot().graph.name).toBe('Changed');
});
it('preserves explicit empty parameters and refuses graph capacity atomically',()=>{
 const s=new WorkflowEditorStore();const id=s.addResourceNode({...ref,parameters:{}});
 expect(s.getSnapshot().graph.nodes.find(n=>n.id===id)?.inputMappings).toEqual([]);
 for(let i=1;i<100;i++)s.addNode('set');const before=s.getSnapshot();
 expect(()=>s.addResourceNode({...ref,parameters:{}})).toThrow();expect(s.getSnapshot()).toBe(before);
 s.undo();expect(s.getSnapshot().graph.nodes).toHaveLength(99);
});
