import {describe,it,expect} from 'vitest';
import {WorkflowEditorStore} from './store';
import {createEmptyGraph,type Graph,type GraphNode} from '../../packages/workflow/graph';
function node(id:string,type:string,config:GraphNode['config']={}):GraphNode{return {id,type,label:id,config,position:{x:80,y:100}};}
export function fragmentHost():Graph{return {...createEmptyGraph('Local fragment host'),nodes:[node('start','manual'),node('slot','unconfigured',{description:'Local replacement'}),node('gate','approval',{reviewer:'Independent review'}),node('done','output')],edges:[{id:'a',source:'start',target:'slot'},{id:'b',source:'slot',target:'gate'},{id:'c',source:'gate',target:'done'}]};}
export function fragmentDraft(){return {namespace:'part',fragment:{entryId:'entry',exitId:'exit',graph:{...createEmptyGraph('Local reviewed example'),nodes:[node('entry','set'),node('work','set',{fields:{answer:42}}),node('exit','set')],edges:[{id:'a',source:'entry',target:'work'},{id:'b',source:'work',target:'exit'}]}}};}
describe('atomic local fragment review',()=>{
 it('reviews the store-owned graph and commits exactly one detached undoable edit',()=>{
  const store=new WorkflowEditorStore(fragmentHost()),before=store.exportJson();
  const session=store.beginFragmentReview('slot');
  const preview=store.previewFragment(session,fragmentDraft());
  expect(store.exportJson()).toBe(before);expect(store.getSnapshot().canUndo).toBe(false);
  const expected=JSON.stringify(preview.graph,null,2);
  store.applyReviewedFragment(session,true);
  expect(store.exportJson()).toBe(expected);expect(store.getSnapshot().graph.nodes.some(n=>n.id==='slot')).toBe(false);
  store.undo();expect(store.exportJson()).toBe(before);expect(store.getSnapshot().canUndo).toBe(false);
  store.redo();expect(store.exportJson()).toBe(expected);
 });
 it('expires review on every graph revision including undo back to identical bytes',()=>{
  for(const change of [ (s:WorkflowEditorStore)=>s.rename('Changed'),(s:WorkflowEditorStore)=>{s.rename('Changed');s.undo();},(s:WorkflowEditorStore)=>s.updateNode('slot',{label:'Changed slot'})]){
   const s=new WorkflowEditorStore(fragmentHost()),session=s.beginFragmentReview('slot');s.previewFragment(session,fragmentDraft());change(s);
   const before=s.exportJson(),snapshot=s.getSnapshot();expect(()=>s.applyReviewedFragment(session,true)).toThrow(/changed|expired/i);expect(s.exportJson()).toBe(before);expect(s.getSnapshot()).toBe(snapshot);
  }
 });
 it('detects out-of-band nested object key reordering even without an emitted edit',()=>{
  const h=fragmentHost();h.nodes[3]!.inputMappings=[{target:'obj',source:{kind:'literal',value:{a:1,b:2}}}];
  const s=new WorkflowEditorStore(h),session=s.beginFragmentReview('slot');s.previewFragment(session,fragmentDraft());
  const n=s.getSnapshot().graph.nodes[3]!;n.inputMappings=[{target:'obj',source:{kind:'literal',value:{b:2,a:1}}}];
  const before=s.exportJson();expect(()=>s.applyReviewedFragment(session,true)).toThrow(/changed|expired/i);expect(s.exportJson()).toBe(before);
 });
 it('revokes exact inspection on draft edit or cancellation and never retains a failed preview',()=>{
  const s=new WorkflowEditorStore(fragmentHost()),before=s.exportJson();
  let session=s.beginFragmentReview('slot');s.previewFragment(session,fragmentDraft());s.revokeFragmentPreview(session);
  expect(()=>s.applyReviewedFragment(session,true)).toThrow(/review/i);
  s.previewFragment(session,fragmentDraft());s.cancelFragmentReview(session);expect(()=>s.applyReviewedFragment(session,true)).toThrow(/expired/i);
  session=s.beginFragmentReview('slot');s.previewFragment(session,fragmentDraft());expect(()=>s.previewFragment(session,{})).toThrow();
  expect(()=>s.applyReviewedFragment(session,true)).toThrow(/review/i);expect(s.exportJson()).toBe(before);expect(s.getSnapshot().canUndo).toBe(false);
 });
 it('rejects accessor, oversized, foreign-host and protection-grant payloads before reading them',()=>{
  const s=new WorkflowEditorStore(fragmentHost()),before=s.getSnapshot();let reads=0;
  const getter=Object.defineProperty({},'namespace',{enumerable:true,get(){reads++;return 'part';}});
  const invalid=[getter,null,{...fragmentDraft(),graph:fragmentHost()},{...fragmentDraft(),protectedSteps:[]},{...fragmentDraft(),namespace:'a'.repeat(1000001)}];
  for(const draft of invalid){const session=s.beginFragmentReview('slot');expect(()=>s.previewFragment(session,draft)).toThrow();expect(()=>s.applyReviewedFragment(session,true)).toThrow();}
  expect(reads).toBe(0);expect(s.getSnapshot()).toBe(before);
 });
 it('starts only eligible unbound builtin slots and respects optional trusted protection bindings',()=>{
  const s=new WorkflowEditorStore(fragmentHost(),{protectedSteps:['slot']});expect(()=>s.beginFragmentReview('slot')).toThrow(/slot|protect/i);
  const ordinary=new WorkflowEditorStore(fragmentHost());for(const id of ['start','gate','done','absent'])expect(()=>ordinary.beginFragmentReview(id)).toThrow(/slot/i);
 });
 it('uses the exact native exported snapshot after a normal UI optional-mapping clear',()=>{
  const s=new WorkflowEditorStore(fragmentHost());s.updateNode('done',{inputMappings:undefined});const before=JSON.parse(s.exportJson());const session=s.beginFragmentReview('slot');
  const result=s.previewFragment(session,fragmentDraft());s.applyReviewedFragment(session,true);
  expect(s.getSnapshot().graph.nodes.find(n=>n.id==='done')).toEqual(before.nodes.find((n:GraphNode)=>n.id==='done'));expect(s.exportJson()).toBe(JSON.stringify(result.graph,null,2));
 });
 it('requires a literal human checkbox and keeps the prepared graph private from preview mutation',()=>{
  const s=new WorkflowEditorStore(fragmentHost()),session=s.beginFragmentReview('slot');const draft=fragmentDraft();const preview=s.previewFragment(session,draft);const expected=JSON.stringify(preview.graph,null,2);
  preview.graph.nodes[0]!.label='Mutated outside';draft.fragment.graph.nodes[1]!.config={fields:{changed:true}};
  expect(()=>s.applyReviewedFragment(session,'yes' as unknown as boolean)).toThrow(/review/i);
  s.applyReviewedFragment(session,true);expect(s.exportJson()).toBe(expected);
 });
 it('leaves redo intact on refusal and clears it only on successful reviewed apply',()=>{
  const s=new WorkflowEditorStore(fragmentHost());s.rename('Temporary');s.undo();const before=s.getSnapshot();
  const session=s.beginFragmentReview('slot');s.previewFragment(session,fragmentDraft());expect(()=>s.applyReviewedFragment(session,false)).toThrow(/review/i);expect(s.getSnapshot()).toBe(before);
  s.applyReviewedFragment(session,true);expect(s.getSnapshot().canRedo).toBe(false);expect(()=>s.applyReviewedFragment(session,true)).toThrow(/expired/i);
 });
});
