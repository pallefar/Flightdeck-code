import {describe,it,expect} from 'vitest';
import {WorkflowEditorStore} from './store';
describe('editor draft state',()=>{
 it('authors editable connected nodes with undo redo and JSON roundtrip',()=>{
  const s=new WorkflowEditorStore();const a=s.addNode('manual'),b=s.addNode('set');
  s.connect(a,b);s.updateNode(b,{label:'Changed',position:{x:320,y:220},config:{fields:{name:'example'}}});
  expect(s.getSnapshot().graph.edges).toHaveLength(1);s.undo();expect(s.getSnapshot().graph.nodes[1]!.label).toBe('Set fields');s.redo();expect(s.getSnapshot().graph.nodes[1]!.label).toBe('Changed');
  const t=new WorkflowEditorStore();t.importJson(s.exportJson());expect(t.getSnapshot().graph).toEqual(s.getSnapshot().graph);
  s.deleteNode(b);expect(s.getSnapshot().graph.edges).toHaveLength(0);expect(()=>s.connect(a,a)).toThrow(/cycle/i);
 });
 it('requires review for reusable custom blocks and prevents removing or replacing human gates',()=>{
  const s=new WorkflowEditorStore();const block={id:'crm',label:'CRM',baseType:'http' as const,defaults:{method:'GET',service:'generic'},description:'Reviewed CRM connector'};
  expect(()=>s.addCustomBlock(block,false)).toThrow(/review/i);s.addCustomBlock(block,true);const n=s.addNode('crm');expect(s.getSnapshot().graph.nodes.find(x=>x.id===n)?.type).toBe('crm');
  const approval=s.addNode('approval');expect(()=>s.deleteNode(approval)).toThrow(/approval/i);expect(()=>s.updateNode(approval,{type:'set'})).toThrow(/approval/i);
  expect(()=>s.importJson(JSON.stringify({...s.getSnapshot().graph,nodes:[]}))).toThrow();
 });
});
